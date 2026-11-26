// SIGMET text for the Briefing "En-route SIG Wx" cell. Pure and browser-safe:
// the server reads FliteBrief / NOAA, this module only windows, filters and formats.
import { parseEetFirTimes } from "./notam_check_tune";

/** Safety margin applied before FIR entry and after FIR exit. */
export const SIGMET_MARGIN_MIN = 60;
export const SIGMET_NIL = "NIL";
export const SIGMET_NO_TIME = "FLIGHT TIME UNKNOWN - SIGMET NOT CHECKED";
export const sigmetUnread = (fir: string) => `${fir}: SIGMET NOT AVAILABLE - CHECK MANUALLY`;

export interface BriefSigmet { from: number; to: number; text: string } // UTC ms
/** `unread` = the source could not be read; never the same as "no SIGMET". */
export type FirSigmetRead = { status: "ok"; items: BriefSigmet[] } | { status: "unread" };
export interface FirWindow { fir: string; from: number; to: number }

const icao4 = (v: unknown) => { const s = String(v ?? "").trim().toUpperCase(); return /^[A-Z]{4}$/.test(s) ? s : ""; };
const flat = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();

/**
 * Entry/exit time of every FIR on the route, in flying order. Entry = departure + OFP EET,
 * exit = entry of the next FIR (last FIR: arrival). The departure FIR runs from departure.
 */
export function sigmetFirWindows(window: { from: number; to: number } | null, ofpText: string, depFir = "", destFir = ""): FirWindow[] {
  if (!window || !Number.isFinite(window.from)) return [];
  const end = Number.isFinite(window.to) && window.to >= window.from ? window.to : window.from;
  const eet = parseEetFirTimes(ofpText || "")
    .map(([code, minute]) => ({ fir: icao4(code), at: window.from + (minute || 0) * 60_000 }))
    .filter((row) => row.fir);
  const out: FirWindow[] = [];
  const dep = icao4(depFir), dest = icao4(destFir);
  const first = eet[0];
  if (dep && !eet.some((row) => row.fir === dep)) out.push({ fir: dep, from: window.from, to: first ? first.at : end });
  eet.forEach((row, i) => {
    const next = eet[i + 1];
    out.push({ fir: row.fir, from: row.at, to: Math.max(row.at, next ? next.at : end) });
  });
  if (dest && !out.some((row) => row.fir === dest)) {
    const last = eet[eet.length - 1];
    out.push({ fir: dest, from: last ? last.at : window.from, to: end });
  }
  return out;
}

/** FliteBrief `/webapi/icaos/<FIR>` payload → SIGMETs; `unread` when the FIR block is absent. */
export function fbFirSigmets(payloadIn: unknown): FirSigmetRead {
  const payload = (Array.isArray(payloadIn) ? payloadIn[0] : payloadIn) as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return { status: "unread" };
  const firs = payload["firs"], rows = payload["fir_sigmet"];
  if (!Array.isArray(rows) || !Array.isArray(firs) || !firs.length) return { status: "unread" };
  const items: BriefSigmet[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const text = flat(row["sigmet_text"]);
    const from = Date.parse(String(row["start_date"] ?? "")), to = Date.parse(String(row["end_date"] ?? ""));
    // A row without readable validity cannot be windowed, so the FIR is not trusted.
    if (!text || !Number.isFinite(from) || !Number.isFinite(to)) return { status: "unread" };
    items.push({ from, to, text });
  }
  return { status: "ok", items };
}

/** NOAA AWC international SIGMET JSON → SIGMETs of one FIR; `unread` when the feed is not a list. */
export function awcFirSigmets(fir: string, list: unknown): FirSigmetRead {
  if (!Array.isArray(list)) return { status: "unread" };
  const want = icao4(fir);
  const items: BriefSigmet[] = [];
  for (const row of list as Record<string, unknown>[]) {
    if (!row || typeof row !== "object" || icao4(row["firId"]) !== want) continue;
    const text = flat(row["rawSigmet"]);
    const from = Number(row["validTimeFrom"]) * 1000, to = Number(row["validTimeTo"]) * 1000;
    if (!text || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    items.push({ from, to, text });
  }
  return { status: "ok", items };
}

const SIG_ID = /\bSIGMET\s+([A-Z]?\d+)\s+VALID\s+(\d{6}\/\d{6})/;
const SIG_CNL = /\bCNL\s+SIGMET\s+([A-Z]?\d+)\s+(\d{6}\/\d{6})/;

/** Drop cancellation bulletins together with the SIGMET they cancel, and repeated texts. */
function inForce(items: BriefSigmet[]): BriefSigmet[] {
  const cancelled = new Set<string>();
  for (const item of items) { const m = SIG_CNL.exec(item.text.toUpperCase()); if (m) cancelled.add(`${m[1]}|${m[2]}`); }
  const seen = new Set<string>();
  return items.filter((item) => {
    const upper = item.text.toUpperCase();
    if (SIG_CNL.test(upper)) return false;
    const id = SIG_ID.exec(upper);
    if (id && cancelled.has(`${id[1]}|${id[2]}`)) return false;
    if (seen.has(upper)) return false;
    seen.add(upper);
    return true;
  });
}

/** A SIGMET is kept only when its validity touches the time the flight is inside that FIR (± margin). */
export function sigmetInWindow(item: BriefSigmet, window: FirWindow, marginMin = SIGMET_MARGIN_MIN): boolean {
  const margin = marginMin * 60_000;
  return item.from <= window.to + margin && item.to >= window.from - margin;
}

/** Cell text: SIGMETs grouped by FIR in flying order; NIL only when every FIR was read and has none. */
export function briefingSigmetText(windows: FirWindow[], reads: Record<string, FirSigmetRead | undefined>): string {
  if (!windows.length) return SIGMET_NO_TIME;
  const blocks: string[] = [];
  for (const window of windows) {
    const read = reads[window.fir];
    if (!read || read.status !== "ok") { blocks.push(sigmetUnread(window.fir)); continue; }
    const hits = inForce(read.items).filter((item) => sigmetInWindow(item, window)).sort((a, b) => a.from - b.from);
    if (hits.length) blocks.push([window.fir, ...hits.map((item) => item.text)].join("\n"));
  }
  return blocks.length ? blocks.join("\n\n") : SIGMET_NIL;
}

/** Compare cell texts ignoring line-ending / spacing differences added by the edit form. */
export const sameSigmetText = (a: unknown, b: unknown) => flat(a) === flat(b);
