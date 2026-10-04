// Port of briefing_release.py — Official Briefing for Flight Release sheet
// (text/HTML/PDF rendering + edit-field round trip). No DB/Flask/FliteBrief
// here; handlers/briefing_release.server.ts wires this into the web app.
import { IATA_ICAO } from "./limits_check";

export class BriefReleaseError extends Error {}

export const FLIGHT_PERMITS = "TO/LDG/OVF Seasonal permit";
export const PERMIT_ADDR = "TO/LDG/OVF";
export const PERMIT_KIND = "Seasonal permit";

export const WEATHER_SIDE = "Weather\n(Check\nAviator for\nthe latest\nWX)";
export const NOTAM_SIDE = "NOTAM\n(Check\nNOTAM\nfolder for\ndetails)";
export const OPS_SIDE = "A/C OPS\nLimitations";
export const PERMIT_SIDE = "Flight\nPermits";
export const NOTES_SIDE = "NOTES by\nDispatcher";

export const NOTES_RED =
  "FOR PILOTS WHO HAVE CERTIFIED CATIIIS:\n" +
  "ALL FLIGHT EXPECTED TO LAND IN HAN/SGN AND CAT II/III DESTINATION: " +
  "(IF NOT COMPLETE 5 PRACTICES) IS REQUIRED TO CONDUCT AUTOLAND IN CAT I " +
  "W/X WITH SIMULATED CAT II/III PROCEDURES.\n" +
  "Due to a data update of performance factors between MOC and FOE, pilots " +
  "are required to cross-check the performance factor in the aircraft and " +
  'the CFP, and inform OMC if there is any significant difference."';

export const NOTES_LINES = [
  "Weather (Check Aviator for the latest WX)",
  "NOTAM (Check NOTAM folder for details)",
  "FOR PILOTS WHO HAVE CERTIFIED CATIIIS:",
  "ALL FLIGHT EXPECTED TO LAND IN HAN/SGN AND CAT II/III DESTINATION: " +
    "(IF NOT COMPLETE 5 PRACTICES) IS REQUIRED TO CONDUCT AUTOLAND IN CAT I " +
    "W/X WITH SIMULATED CAT II/III PROCEDURES. Due to a data update of " +
    "performance factors between MOC and FOE, pilots are required to " +
    "cross-check the performance factor in the aircraft and the CFP, and " +
    "inform OMC if there is any significant difference.",
];

export const PIC_ACK_LINES = [
  "The Flight Crew study complete and detailed information in all flight " +
    "preparation documents.",
  "If any doubts arise or discussion is needed, the PIC promptly contacts " +
    "dispatch via microsoft team: OMC",
  "By receiving and reviewing this sheet, the PIC acknowledges his/her " +
    "understanding of all details in the flight preparation package uploaded " +
    "by the duty flight dispatcher.",
];

export const PIC_ACK = PIC_ACK_LINES.join("\n");

export const LOGO_SRC = "/static/vjc-brief-logo.png";

const _NOT_ICAO = new Set([
  "ALTN", "THEN", "PAGE", "TIME", "WIND", "FUEL", "DIST", "PLAN", "TRIP",
  "FROM", "WITH", "THAT", "THIS", "HAVE", "NONE",
]);

export function toIcao(code: unknown): string {
  const raw = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length === 4 && /^[A-Z]+$/.test(raw) && !_NOT_ICAO.has(raw)) return raw;
  if (raw.length === 3) return IATA_ICAO[raw] ?? "";
  return "";
}

export function formatReg(reg: unknown): string {
  const s = String(reg ?? "").trim().split(/\s+/).join(" ").toUpperCase();
  let m = /^(?:VN[\s-]?)?A?[\s-]?(\d{3})$/.exec(s);
  if (m) return `VN-A${m[1]}`;
  const compact = s.replace(/[^A-Z0-9]/g, "");
  m = /^(?:VN)?A?(\d{3})$/.exec(compact);
  return m ? `VN-A${m[1]}` : s;
}

export function slash(codes: (string | null | undefined)[]): string {
  return codes.filter((c): c is string => !!c).join("/");
}

export function notamCell(text: unknown): string {
  const s = String(text ?? "").trim();
  if (!s || s.toUpperCase() === "NO SIG") return "";
  return s;
}

export function padNotams(raw: unknown, single: unknown = null): string[] {
  if (Array.isArray(raw)) {
    const cells = raw.slice(0, 5).map(notamCell);
    while (cells.length < 5) cells.push("");
    return cells;
  }
  const one = notamCell(single !== null && single !== undefined ? single : raw);
  return [one, one, one, one, one];
}

function notamsFromPayload(data: Record<string, unknown>): string[] {
  const keys = ["notam0", "notam1", "notam2", "notam3", "notam4"];
  if (keys.some((k) => k in data && data[k] !== null && data[k] !== undefined)) {
    return keys.map((k) => notamCell(data[k]));
  }
  return padNotams(data["notams"], data["notam"]);
}

export function notamOf(sheet: ReleaseSheet, idx: number): string {
  const cells = padNotams(sheet.notams ?? null);
  return idx >= 0 && idx < cells.length ? cells[idx] : "";
}

export function wrapTaf(text: string, width = 86): string {
  let blob = String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
  blob = blob.replace(/\s+(TEMPO|BECMG|PROB\d{0,2}|FM\d{0,6})\b/g, "  $1");
  return wrapText(blob, width);
}

/** textwrap.fill-like greedy word wrap (break_long_words=False). */
function wrapText(blob: string, width: number): string {
  const words = blob.split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (trial.length <= width || !line) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

interface FlightLike {
  callsign?: string | null;
  dep_icao?: string | null;
  dep_iata?: string | null;
  dest_icao?: string | null;
  dest_iata?: string | null;
  reg?: string | null;
  dest_alt1?: string | null;
  dest_alt2?: string | null;
  raw?: Record<string, unknown> | null;
  id?: number | string | null;
}

export function destAltsOf(flight: FlightLike): string[] {
  const raw = [
    flight.dest_alt1 ?? "",
    flight.dest_alt2 ?? "",
    (flight.raw?.["dest_alt3"] as string | undefined) ?? "",
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const code = toIcao(String(item ?? ""));
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export interface AircraftRow {
  reg?: unknown;
  defect?: unknown;
  [key: string]: unknown;
}

export function defectsFor(reg: unknown, aircraft: Iterable<unknown> | null | undefined): string[] {
  const want = formatReg(reg);
  if (!want) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of aircraft ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as AircraftRow;
    const got = formatReg(String(r.reg ?? ""));
    if (got !== want) continue;
    const text = String(r.defect ?? "").split(/\s+/).filter(Boolean).join(" ");
    const key = text.toUpperCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

export interface TafRecord {
  nil?: boolean;
  raw?: string | null;
  issue?: string | null;
}

export function tafRaw(icao: string, tafs: Record<string, TafRecord> | null | undefined): string {
  const rec = (tafs ?? {})[(icao ?? "").toUpperCase()];
  if (!rec) return "NIL";
  if (rec.nil) return (rec.raw || "NIL").trim() || "NIL";
  const raw = (rec.raw ?? "").trim();
  return raw || "NIL";
}

function rxPrefix(rec: TafRecord | null | undefined): string {
  if (!rec) return "";
  const issue = String(rec.issue ?? "").trim();
  return /^\d{6}$/.test(issue) ? `Rx ${issue}Z ` : "";
}

export function tafBlock(icao: string, tafs: Record<string, TafRecord> | null | undefined): string {
  const rec = icao ? (tafs ?? {})[icao.toUpperCase()] : null;
  const body = tafRaw(icao, tafs);
  const prefix = rxPrefix(rec);
  if (body === "NIL") return (prefix + "NIL").trim();
  if (prefix && !body.toUpperCase().startsWith("RX ")) return prefix + body;
  return body;
}

export function defectBullets(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    let text = item.trim();
    if (!text) continue;
    text = text.replace(/^[-•]\s*/, "");
    if (!/^FM\b/i.test(text)) text = "FM: " + text;
    out.push("- " + text);
  }
  return out;
}

export interface WxBlock {
  label: string;
  icaos: string[];
  texts: string[];
}

export interface ReleaseSheet {
  callsign: string;
  published_at: string;
  dep: string;
  dest: string;
  dest_alts: string[];
  enroute_alts: string[];
  reg: string;
  defects: string[];
  wx: WxBlock[];
  ofp_note: string;
  notes: string;
  permit_addr: string;
  permit_kind: string;
  sig_wx: string;
  notams: string[];
}

export function newSheet(partial: Partial<ReleaseSheet> & Pick<ReleaseSheet, "callsign" | "published_at" | "dep" | "dest" | "dest_alts" | "enroute_alts" | "reg" | "defects" | "wx">): ReleaseSheet {
  return {
    ofp_note: "",
    notes: NOTES_RED,
    permit_addr: PERMIT_ADDR,
    permit_kind: PERMIT_KIND,
    sig_wx: "NO SIG",
    notams: ["", "", "", "", ""],
    ...partial,
  };
}

export function altsSlash(sheet: ReleaseSheet, kind: "dest" | "enroute"): string {
  return kind === "dest" ? slash(sheet.dest_alts) : slash(sheet.enroute_alts);
}
