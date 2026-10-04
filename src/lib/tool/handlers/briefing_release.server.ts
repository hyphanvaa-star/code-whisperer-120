import type { Jobs, Routes } from "../types";
import {
  BriefReleaseError,
  buildSheet,
  sheetFromFields,
  toDict,
  toPdf,
  pdfFilename,
} from "../port/briefingRelease";

// Port of web.py's "/api/briefing/release" group (briefing_release.py).
//
// The original tool pulls the OFP PDF from FliteBrief, extracts its text
// with atc_ezfw.pdf_text (PyMuPDF), and persists hand-edited sheets to a
// local JSON file per callsign (briefing_edits/<key>.json) so "fresh"
// re-opens restore the dispatcher's edits. This runtime has no local
// filesystem and no FliteBrief session yet, so:
//  - /api/briefing/release always returns the "no OFP yet" error unless the
//    caller already has OFP text to hand (kept here as an honest surface,
//    not a fake success) — ports for jobs.atc_check / owa_pib show the real
//    FliteBrief fetch pattern this would eventually reuse.
//  - edit save/clear round-trips entirely through the posted fields (no
//    server-side persistence yet), matching to_fields/sheet_from_fields so
//    the client can keep showing the edited sheet after a save.

function errorMessage(exc: unknown): string {
  if (exc instanceof BriefReleaseError) return exc.message;
  if (exc instanceof Error) return `${exc.constructor.name}: ${exc.message}`;
  return String(exc);
}

export const routes: Routes = {
  "POST /api/briefing/release": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] ?? "").trim();
    if (!flight) return { error: "Nhập số hiệu chuyến, ví dụ 869." };
    // No FliteBrief/OFP session is wired into this runtime yet (see note
    // above) — the honest result is the same "chưa có OFP" error the
    // Python tool returns before a sector has been release-fetched.
    return {
      error: `Chưa có OFP cho ${flight} — chờ OMC release.`,
    };
  },

  "POST /api/briefing/edit/save": async (ctx) => {
    const body = await ctx.json();
    const cs = String(body["callsign"] ?? "").trim();
    if (!cs) return { error: "Thiếu số hiệu chuyến." };
    try {
      const sheet = sheetFromFields({ ...body, callsign: cs });
      const out = toDict(sheet, { edit: true, edited: true });
      out["saved"] = true;
      return out;
    } catch (exc) {
      if (exc instanceof BriefReleaseError) return { error: exc.message };
      return { error: errorMessage(exc) };
    }
  },

  "POST /api/briefing/edit/clear": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] ?? body["callsign"] ?? "").trim();
    if (!flight) return { error: "Thiếu số hiệu chuyến." };
    // No saved-edit store on this runtime to clear (see note above); report
    // the same "no OFP" state draft_from_flight(apply_edits=False) would.
    return { error: `Chưa có OFP cho ${flight} — chờ OMC release.` };
  },
};

export const jobs: Jobs = {};

// Re-exported for future wiring once a FliteBrief OFP source exists here.
export { buildSheet, toPdf, pdfFilename };
