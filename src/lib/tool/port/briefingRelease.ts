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
