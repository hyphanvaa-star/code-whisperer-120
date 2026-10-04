import type { Jobs, Routes } from "../types";
import * as store from "../store.server";
import { getJson, setJson } from "../store.server";
import { loadFlights } from "../core/gantts.server";
import {
  BriefReleaseError,
  buildSheet,
  sheetFromFields,
  toDict,
  toPdf,
  pdfFilename,
  draftFromFlight,
  editKey,
  type ReleaseSheet,
} from "../port/briefingRelease";

// Port of web.py's "/api/briefing/release" group (briefing_release.py).
//
// OFP text comes from FliteBrief the same way jobs.atc_check / ofp_weights do
// (fbGet(`/webapi/sectors/{id}/ofp`) → PDF bytes → unpdf text extraction).
// Saved hand-edits replace the local briefing_edits/<key>.json file with an
// app_settings row keyed "briefing_edit.<key>".

function errorMessage(exc: unknown): string {
  if (exc instanceof BriefReleaseError) return exc.message;
  if (exc instanceof Error) return `${exc.constructor.name}: ${exc.message}`;
  return String(exc);
}

async function ofpPdfText(blob: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(blob);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function fetchOfpPdf(sectorId: number): Promise<Uint8Array | null> {
  const { fbGet } = await import("@/lib/flitebrief.server");
  const res = await fbGet(`/webapi/sectors/${sectorId}/ofp`, "application/pdf");
  if (!res.ok || res.status === 204) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength ? buf : null;
}

function editSettingKey(callsign: string): string {
  return `briefing_edit.${editKey(callsign)}`;
}

async function loadEdits(ctx: Parameters<Routes[string]>[0], callsign: string) {
  return getJson<Record<string, unknown> | null>(ctx, editSettingKey(callsign), null);
}

async function findFlight(flight: string) {
  const days = 2;
  const flights = await loadFlights(days);
  const want = flight.trim().toUpperCase();
  return flights.find((f) => {
    const cs = (f.callsign || "").toUpperCase();
    return cs === want || cs.replace(/[^A-Z0-9]/g, "") === want.replace(/[^A-Z0-9]/g, "") || String(f.id) === want;
  });
}

async function draft(ctx: Parameters<Routes[string]>[0], flight: string, applyEdits: boolean): Promise<ReleaseSheet> {
  const f = await findFlight(flight);
  if (!f) throw new BriefReleaseError(`Không tìm thấy chuyến ${flight}.`);
  return draftFromFlight(f, {
    fetchPdf: fetchOfpPdf,
    pdfText: ofpPdfText,
    applyEdits,
    loadEdits: (cs) => loadEdits(ctx, cs),
  });
}

export const routes: Routes = {
  "POST /api/briefing/release": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] ?? "").trim();
    if (!flight) return { error: "Nhập số hiệu chuyến, ví dụ 869." };
    try {
      const sheet = await draft(ctx, flight, true);
      const saved = await loadEdits(ctx, sheet.callsign);
      return toDict(sheet, { edit: true, edited: !!saved });
    } catch (exc) {
      return { error: errorMessage(exc) };
    }
  },

  "POST /api/briefing/edit/save": async (ctx) => {
    const body = await ctx.json();
    const cs = String(body["callsign"] ?? "").trim();
    if (!cs) return { error: "Thiếu số hiệu chuyến." };
    try {
      const sheet = sheetFromFields({ ...body, callsign: cs });
      await setJson(ctx, editSettingKey(sheet.callsign), { ...body, callsign: sheet.callsign });
      const out = toDict(sheet, { edit: true, edited: true });
      out["saved"] = true;
      return out;
    } catch (exc) {
      return { error: errorMessage(exc) };
    }
  },

  "POST /api/briefing/edit/clear": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] ?? body["callsign"] ?? "").trim();
    if (!flight) return { error: "Thiếu số hiệu chuyến." };
    try {
      const sheet = await draft(ctx, flight, false);
      await setJson(ctx, editSettingKey(sheet.callsign), null);
      return toDict(sheet, { edit: true, edited: false });
    } catch (exc) {
      return { error: errorMessage(exc) };
    }
  },

  "POST /api/briefing/export": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] ?? body["callsign"] ?? "").trim();
    if (!flight) return { error: "Thiếu số hiệu chuyến." };
    try {
      let sheet: ReleaseSheet;
      if (body["fields"] && typeof body["fields"] === "object") {
        sheet = sheetFromFields({ ...(body["fields"] as Record<string, unknown>), callsign: flight });
      } else {
        sheet = await draft(ctx, flight, true);
      }
      const pdf = await toPdf(sheet);
      const name = pdfFilename(sheet);
      await store.putFile(ctx, `briefing/${name}`, pdf, "application/pdf");
      await setJson(ctx, `briefing_release.pdf.${sheet.callsign}`, { name, at: Date.now() });
      return { ok: true, file: name, path: `briefing/${name}` };
    } catch (exc) {
      return { error: errorMessage(exc) };
    }
  },

  "GET /api/briefing/release.pdf": async (ctx) => {
    const flight = String(ctx.params.get("flight") ?? ctx.params.get("callsign") ?? "").trim();
    if (!flight) return new Response("Thiếu số hiệu chuyến.", { status: 400 });
    try {
      const sheet = await draft(ctx, flight, true);
      const pdf = await toPdf(sheet);
      return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfFilename(sheet)}"`,
        },
      });
    } catch (exc) {
      return new Response(errorMessage(exc), { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  },
};

export const jobs: Jobs = {};

export { buildSheet, toPdf, pdfFilename };
