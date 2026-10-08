import type { Jobs, Routes } from "../types";
import * as store from "../store.server";
import { getJson, setJson } from "../store.server";
import { loadFlights } from "../core/gantts.server";
import { loadBriefingData } from "../briefing-data.server";
import { callsignKey, parseCallsigns } from "../port/notam_pin";
import {
  BriefReleaseError,
  buildSheet,
  applyFields,
  toFields,
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
  if (parseCallsigns(flight).length > 1) throw new BriefReleaseError("Tờ briefing xem từng chuyến — nhập một số hiệu.");
  const days = 2;
  const flights = await loadFlights(days);
  const want = callsignKey(flight);
  return flights.find((f) => {
    const cs = (f.callsign || "").toUpperCase();
    return callsignKey(cs) === want || String(f.id) === flight.trim();
  });
}

async function draft(ctx: Parameters<Routes[string]>[0], flight: string, applyEdits: boolean): Promise<ReleaseSheet> {
  const f = await findFlight(flight);
  if (!f) throw new BriefReleaseError(`Không tìm thấy chuyến ${flight}.`);
  return draftFromFlight(f, {
    ...await loadBriefingData(ctx),
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
      const sheet = applyFields(await draft(ctx, cs, true), body);
      await setJson(ctx, editSettingKey(sheet.callsign), toFields(sheet));
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
      // Clear first: a transient OFP failure must not leave a supposedly cleared edit behind.
      const existing = await findFlight(flight);
      if (!existing) throw new BriefReleaseError(`Không tìm thấy chuyến ${flight}.`);
      const { error } = await ctx.supabase.from("app_settings").delete().eq("key", editSettingKey(existing.callsign));
      if (error) throw new Error(error.message);
      const sheet = await draft(ctx, flight, false);
      return toDict(sheet, { edit: true, edited: false });
    } catch (exc) {
      return { error: errorMessage(exc) };
    }
  },

  "POST /api/briefing/export": async (ctx) => {
    const body = await ctx.json();
    // Xuất hàng loạt (nút "Xuất briefing"): nhận danh sách callsign, chạy nền
    // và trả job id — tiến trình stream qua /api/stream, cuối cùng gửi link
    // tải ZIP về thẳng máy người dùng (không cần trợ lý PC).
    if (Array.isArray(body["callsigns"])) {
      const callsigns = (body["callsigns"] as unknown[]).map((c) => String(c)).filter(Boolean);
      if (!callsigns.length) return { error: "chưa có chuyến nào" };
      const { jobId } = await import("../jobs");
      return {
        id: jobId("briefing_export", {
          callsigns,
          days: Number(body["days"] ?? 2) || 2,
          sector_ids: (body["sector_ids"] as unknown[] | undefined) ?? [],
        }),
      };
    }
    const flight = String(body["flight"] ?? body["callsign"] ?? "").trim();
    if (!flight) return { error: "Thiếu số hiệu chuyến." };
    try {
      let sheet: ReleaseSheet;
      if (body["fields"] && typeof body["fields"] === "object") {
        sheet = applyFields(await draft(ctx, flight, true), body["fields"] as Record<string, unknown>);
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
  // Tải file ZIP đã xuất về máy (link trong thông báo kết thúc job).
  "GET /api/briefing/export.zip": async (ctx) => {
    const name = String(ctx.params.get("f") ?? "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!name) return new Response("Thiếu tên file.", { status: 400 });
    const buf = await store.getFile(ctx, `briefing/${name}`);
    if (!buf) return new Response("File đã hết hạn — xuất lại briefing.", { status: 404 });
    return new Response(new Blob([buf], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  },
};

export const jobs: Jobs = {
  // Port of web.py briefing export: soạn PDF từng chuyến rồi nén thành một
  // file ZIP đặt trong kho; thông báo kết thúc kèm link tải thẳng về máy.
  briefing_export: async (params, emit, ctx) => {
    const t0 = Date.now();
    const callsigns = ((params["callsigns"] as string[] | undefined) ?? []).map((c) => c.trim()).filter(Boolean);
    const days = Number(params["days"] ?? 2) || 2;
    const sectorIds = new Set(((params["sector_ids"] as unknown[] | undefined) ?? []).map((x) => String(x)));
    if (!callsigns.length) {
      emit({ type: "line", text: "✗ Không có chuyến nào để xuất.", cls: "bad" });
      emit({ type: "end", code: 1, elapsed: 0, ok: 0, failed: 1 });
      return;
    }
    const { zipSync } = await import("fflate");
    const flights = await loadFlights(days);
    const byId = new Map(flights.map((f) => [String(f.id), f]));
    const files: Record<string, Uint8Array> = {};
    const sources = await loadBriefingData(ctx);
    let ok = 0, failed = 0, skipped = 0;
    for (let i = 0; i < callsigns.length; i++) {
      const cs = callsigns[i];
      if (!cs) continue;
      emit({ type: "line", text: `· soạn briefing ${cs}…`, progress: i / callsigns.length });
      try {
        // Ưu tiên đúng sector người dùng đã chọn ở bảng chọn route.
        let f = sectorIds.size ? flights.find((x) => sectorIds.has(String(x.id)) && (x.callsign || "").toUpperCase() === cs.toUpperCase()) : undefined;
        if (!f) {
          const want = cs.toUpperCase();
          f = flights.find((x) => {
            const c = (x.callsign || "").toUpperCase();
            return c === want || c.replace(/[^A-Z0-9]/g, "") === want.replace(/[^A-Z0-9]/g, "");
          });
        }
        if (!f) {
          emit({ type: "line", text: `✗ ${cs}: không tìm thấy chuyến`, cls: "bad" });
          failed++;
          continue;
        }
        const sheet = await draftFromFlight(f, {
          ...sources,
          fetchPdf: fetchOfpPdf,
          pdfText: ofpPdfText,
          applyEdits: true,
          loadEdits: (c) => getJson(ctx, editSettingKey(c), null),
        });
        const pdf = await toPdf(sheet);
        const name = pdfFilename(sheet);
        files[name] = pdf;
        await store.putFile(ctx, `briefing/${name}`, pdf, "application/pdf");
        emit({ type: "line", text: `✓ ${cs} → ${name}`, cls: "ok" });
        ok++;
      } catch (exc) {
        emit({ type: "line", text: `✗ ${cs}: ${errorMessage(exc)}`, cls: "bad" });
        failed++;
      }
    }
    let download = "";
    if (ok) {
      const zipName = `briefing-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}.zip`;
      await store.putFile(ctx, `briefing/${zipName}`, zipSync(files), "application/zip");
      download = `/api/briefing/export.zip?f=${zipName}`;
      emit({ type: "line", text: `· đã nén ${ok} file PDF vào ${zipName}`, cls: "sys" });
    }
    emit({
      type: "end", code: failed ? 2 : 0, elapsed: (Date.now() - t0) / 1000,
      ok, failed, skipped, folder: "tải về máy", download,
    });
  },
};

export { buildSheet, toPdf, pdfFilename, draftFromFlight, fetchOfpPdf, ofpPdfText, findFlight };
