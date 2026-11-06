// Port of briefing_release.py — Official Briefing for Flight Release sheet
// (text/HTML/PDF rendering + edit-field round trip). No DB/Flask/FliteBrief
// here; handlers/briefing_release.server.ts wires this into the web app.
import { IATA_ICAO } from "./limits_check";
import { applyToSheet, isNotamPlaceholder, type PinStore, type SheetPinContext } from "./notam_pin";

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

export const LOGO_SRC = "/static/vj-logo.png";

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

export const sigWxText = notamCell;

export function padNotams(raw: unknown, single: unknown = null): string[] {
  if (Array.isArray(raw)) {
    const cells = raw.slice(0, 6).map(notamCell);
    while (cells.length < 6) cells.push("");
    return cells;
  }
  const one = notamCell(single !== null && single !== undefined ? single : raw);
  return [one, one, one, one, one, one];
}

function notamsFromPayload(data: Record<string, unknown>): string[] {
  const keys = ["notam0", "notam1", "notam2", "notam3", "notam4", "notam5"];
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

/** Off/on-block window (UTC ms) from FliteBrief flight; ETD/ETA preferred, STD/STA fallback. */
export function flightWindowOf(flight: FlightLike): { from: number; to: number } | null {
  const r = (flight.raw ?? {}) as Record<string, unknown>;
  const t = (...keys: string[]) => {
    for (const k of keys) { const v = r[k]; if (v) { const n = Date.parse(String(v)); if (Number.isFinite(n)) return n; } }
    return NaN;
  };
  const from = t("etd", "std", "atd");
  let to = t("eta", "sta", "ata");
  if (!Number.isFinite(from)) return null;
  if (!Number.isFinite(to) || to < from) to = from + 6 * 3600 * 1000;
  return { from, to };
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

export const LOW_EGT_NOTES = [
  "Crew shall select the highest FLEX temperature available in the FlySmart Take-off application while ensuring the required take-off margin is maintained.",
  "Observe the required engine warm-up and cooling times.",
  "PACKs OFF for take-off (except A321neo).",
  "Keep A/THR ON during flight and use Managed Speed throughout all phases of flight, unless otherwise instructed by ATC.",
];
const LOW_EGT_KEYS = new Set(LOW_EGT_NOTES.map((n) => n.toUpperCase()));
export function isLowEgtNote(line: string): boolean {
  return LOW_EGT_KEYS.has(line.trim().replace(/^[-•]\s*/, "").toUpperCase());
}

export function defectBullets(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    let text = item.trim();
    if (!text) continue;
    text = text.replace(/^[-•]\s*/, "");
    if (isLowEgtNote(text)) continue;
    text = text.replace(/^FM:?\s*/i, "");
    out.push("- " + text);
    if (/\bLOW\s+EGT/i.test(text)) out.push(...LOW_EGT_NOTES.map((n) => "  • " + n));
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
    notes: "",
    permit_addr: PERMIT_ADDR,
    permit_kind: PERMIT_KIND,
    sig_wx: "",
    notams: ["", "", "", "", "", ""],
    ...partial,
  };
}

export function altsSlash(sheet: ReleaseSheet, kind: "dest" | "enroute"): string {
  return kind === "dest" ? slash(sheet.dest_alts) : slash(sheet.enroute_alts);
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function aptLabel(title: string, icaos: string[]): string {
  return icaos.length ? `${title} (${slash(icaos)})` : title;
}

function htmlLines(text: string): string {
  return (text ?? "").split("\n").map(escapeHtml).join("<br>");
}

function slashHtml(codes: string[]): string {
  return codes.filter(Boolean).map(escapeHtml).join("/<wbr>");
}

function aptHtml(title: string, icaos: string[]): string {
  if (!icaos.length) return escapeHtml(title);
  return `${escapeHtml(title)}<br>(${slashHtml(icaos)})`;
}

/** Two+ destination alternates → separate NOTAM rows (alt 1, then the rest). */
export function splitDestAlts(sheet: ReleaseSheet): string[][] | null {
  const da = sheet.dest_alts.filter(Boolean);
  return da.length >= 2 ? [[da[0]], da.slice(1)] : null;
}

function tafHtml(texts: string[]): string {
  if (!texts.length) return "NIL";
  return texts.map((t) => htmlLines(wrapTaf(t))).join("<br><br>");
}

function notamHtml(text: string): string {
  const blob = notamCell(text);
  let cls = "br-c3 br-nosig";
  if (!isNotamPlaceholder(blob)) cls += " br-notam-full";
  return `<td class='${cls}'>${htmlLines(blob)}</td>`;
}

function picAckRows(): string {
  return PIC_ACK_LINES.map((line, i) => {
    if (i === 0) {
      return (
        "<tr>" +
        `<td class='br-c1' rowspan='${PIC_ACK_LINES.length}'>PIC Ack</td>` +
        `<td class='br-c23' colspan='2'>${escapeHtml(line)}</td>` +
        "</tr>"
      );
    }
    return `<tr><td class='br-c23' colspan='2'>${escapeHtml(line)}</td></tr>`;
  }).join("");
}

export function toHtml(sheet: ReleaseSheet): string {
  const depL = `Dept. APT (${escapeHtml(sheet.dep || "—")})`;
  const destL = `Dest. APT (${escapeHtml(sheet.dest || "—")})`;
  const destAltL = aptHtml("Dest. Alternate(s)", sheet.dest_alts);
  const enrAltL = aptHtml("Enr. Alternate(s)", sheet.enroute_alts);

  const deptWx = sheet.wx[0] ? tafHtml(sheet.wx[0].texts) : "NIL";
  const destWx = sheet.wx[1] ? tafHtml(sheet.wx[1].texts) : "NIL";
  const daltWx = sheet.wx[2] ? tafHtml(sheet.wx[2].texts) : "NIL";
  const enrWx = sheet.wx[3] ? tafHtml(sheet.wx[3].texts) : "NIL";

  const bullets = defectBullets(sheet.defects);
  const defectHtml = bullets.length ? bullets.map((b) => escapeHtml(b)).join("<br>") : "";
  const tech = "Check Tech log<br>for updates<br>" + escapeHtml(`REG: ${sheet.reg || "—"}`);
  const nt = padNotams(sheet.notams);
  const nosig = nt.map((t) => notamHtml(t));
  const split = splitDestAlts(sheet);
  const sigCell = `<td class='br-c3 br-nosig'>${escapeHtml(sigWxText(sheet.sig_wx))}</td>`;

  return `
<div class="br-sheet-doc">
  <div class="br-head">
    <img class="br-logo" src="${escapeHtml(LOGO_SRC)}" alt="vietjetAir.com" width="140" height="25">
    <div class="br-title">Official Briefing for Flight Release: ${escapeHtml(sheet.callsign)}</div>
  </div>
  <div class="br-pub"><i>Published at:</i> <span>${escapeHtml(sheet.published_at)}</span></div>
  <table class="br-grid">
    <colgroup>
      <col class="br-c1">
      <col class="br-c2">
      <col class="br-c3">
    </colgroup>
    <tr>
      <td class="br-c1" rowspan="5">${htmlLines(WEATHER_SIDE)}</td>
      <td class="br-c2">${depL}</td>
      <td class="br-c3 br-taf">${deptWx}</td>
    </tr>
    <tr>
      <td class="br-c2">${destL}</td>
      <td class="br-c3 br-taf">${destWx}</td>
    </tr>
    <tr>
      <td class="br-c2">${destAltL}</td>
      <td class="br-c3 br-taf">${daltWx}</td>
    </tr>
    <tr>
      <td class="br-c2">${enrAltL}</td>
      <td class="br-c3 br-taf">${enrWx}</td>
    </tr>
    <tr>
      <td class="br-c2">En-route SIG Wx</td>
      ${sigCell}
    </tr>
    <tr>
      <td class="br-c1" rowspan="${split ? 6 : 5}">${htmlLines(NOTAM_SIDE)}</td>
      <td class="br-c2">${depL}</td>
      ${nosig[0]}
    </tr>
    <tr>
      <td class="br-c2">${destL}</td>
      ${nosig[1]}
    </tr>
    <tr>
      <td class="br-c2">${split ? aptHtml("Dest. Alternate 1", split[0]) : destAltL}</td>
      ${nosig[2]}
    </tr>${split ? `
    <tr>
      <td class="br-c2">${aptHtml("Dest. Alternate 2", split[1])}</td>
      ${nosig[5]}
    </tr>` : ""}
    <tr>
      <td class="br-c2">${enrAltL}</td>
      ${nosig[3]}
    </tr>
    <tr>
      <td class="br-c2">FIR(s)</td>
      ${nosig[4]}
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(OPS_SIDE)}</td>
      <td class="br-c2">${tech}</td>
      <td class="br-c3 br-defect">${defectHtml}</td>
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(PERMIT_SIDE)}</td>
      <td class="br-c2">${escapeHtml(sheet.permit_addr)}</td>
      <td class="br-c3">${escapeHtml(sheet.permit_kind)}</td>
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(NOTES_SIDE)}</td>
      <td class="br-c23 br-notes" colspan="2">${htmlLines(sheet.notes)}</td>
    </tr>
    ${picAckRows()}
  </table>
</div>
`.trim();
}

function editArea(name: string, text: string, extra = ""): string {
  const cls = ("bf-in " + extra).trim();
  return `<textarea class='${cls}' data-bf='${escapeHtml(name)}' spellcheck='false'>${escapeHtml(text || "")}</textarea>`;
}

function editInp(name: string, text: string, extra = "bf-icao"): string {
  const cls = extra || "bf-icao";
  return `<input class='${cls}' data-bf='${escapeHtml(name)}' value='${escapeHtml(text || "")}' spellcheck='false' autocomplete='off'>`;
}

function wxBlob(sheet: ReleaseSheet, idx: number): string {
  if (idx >= sheet.wx.length) return "NIL";
  const texts = (sheet.wx[idx].texts || []).filter(Boolean);
  return texts.length ? texts.join("\n\n") : "NIL";
}

export function toEditHtml(sheet: ReleaseSheet): string {
  const depL = `Dept. APT (${editInp("dep", sheet.dep || "")})`;
  const destL = `Dest. APT (${editInp("dest", sheet.dest || "")})`;
  const destAltL =
    "Dest. Alternate(s)<br>(" + editInp("dest_alts", slash(sheet.dest_alts), "bf-icao bf-wide") + ")";
  const enrAltL =
    "Enr. Alternate(s)<br>(" + editInp("enroute_alts", slash(sheet.enroute_alts), "bf-icao bf-wide") + ")";
  const tech = "Check Tech log<br>for updates<br>REG: " + editInp("reg", sheet.reg || "", "bf-icao");
  const defectTxt = defectBullets(sheet.defects).join("\n");
  const sig = editArea("sig_wx", sigWxText(sheet.sig_wx), "bf-center");
  const nt = padNotams(sheet.notams);
  const n0 = editArea("notam0", nt[0], "bf-notam");
  const n1 = editArea("notam1", nt[1], "bf-notam");
  const n2 = editArea("notam2", nt[2], "bf-notam");
  const n3 = editArea("notam3", nt[3], "bf-notam");
  const n4 = editArea("notam4", nt[4], "bf-notam");
  const n5 = editArea("notam5", nt[5], "bf-notam");
  const split = splitDestAlts(sheet);
  const hiddenCs = `<input type='hidden' data-bf='callsign' value='${escapeHtml(sheet.callsign)}'>`;
  const depStatic = `Dept. APT (${escapeHtml(sheet.dep || "—")})`;
  const destStatic = `Dest. APT (${escapeHtml(sheet.dest || "—")})`;
  const destAltStatic = aptHtml("Dest. Alternate(s)", sheet.dest_alts);
  const enrAltStatic = aptHtml("Enr. Alternate(s)", sheet.enroute_alts);

  return `
<div class="br-sheet-doc bf-edit-doc">
  ${hiddenCs}
  <div class="br-head">
    <img class="br-logo" src="${escapeHtml(LOGO_SRC)}" alt="vietjetAir.com" width="140" height="25">
    <div class="br-title">Official Briefing for Flight Release: ${escapeHtml(sheet.callsign)}</div>
  </div>
  <div class="br-pub"><i>Published at:</i> ${editInp("published_at", sheet.published_at, "bf-pub")}</div>
  <table class="br-grid">
    <colgroup>
      <col class="br-c1">
      <col class="br-c2">
      <col class="br-c3">
    </colgroup>
    <tr>
      <td class="br-c1" rowspan="5">${htmlLines(WEATHER_SIDE)}</td>
      <td class="br-c2">${depL}</td>
      <td class="br-c3 br-taf">${editArea("wx0", wxBlob(sheet, 0))}</td>
    </tr>
    <tr>
      <td class="br-c2">${destL}</td>
      <td class="br-c3 br-taf">${editArea("wx1", wxBlob(sheet, 1))}</td>
    </tr>
    <tr>
      <td class="br-c2">${destAltL}</td>
      <td class="br-c3 br-taf">${editArea("wx2", wxBlob(sheet, 2))}</td>
    </tr>
    <tr>
      <td class="br-c2">${enrAltL}</td>
      <td class="br-c3 br-taf">${editArea("wx3", wxBlob(sheet, 3))}</td>
    </tr>
    <tr>
      <td class="br-c2">En-route SIG Wx</td>
      <td class="br-c3 br-nosig">${sig}</td>
    </tr>
    <tr>
      <td class="br-c1" rowspan="${split ? 6 : 5}">${htmlLines(NOTAM_SIDE)}</td>
      <td class="br-c2">${depStatic}</td>
      <td class="br-c3 br-nosig">${n0}</td>
    </tr>
    <tr>
      <td class="br-c2">${destStatic}</td>
      <td class="br-c3 br-nosig">${n1}</td>
    </tr>
    <tr>
      <td class="br-c2">${split ? aptHtml("Dest. Alternate 1", split[0]) : destAltStatic}</td>
      <td class="br-c3 br-nosig">${n2}</td>
    </tr>${split ? `
    <tr>
      <td class="br-c2">${aptHtml("Dest. Alternate 2", split[1])}</td>
      <td class="br-c3 br-nosig">${n5}</td>
    </tr>` : `<input type='hidden' data-bf='notam5' value=''>`}
    <tr>
      <td class="br-c2">${enrAltStatic}</td>
      <td class="br-c3 br-nosig">${n3}</td>
    </tr>
    <tr>
      <td class="br-c2">FIR(s)</td>
      <td class="br-c3 br-nosig">${n4}</td>
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(OPS_SIDE)}</td>
      <td class="br-c2">${tech}</td>
      <td class="br-c3 br-defect">${editArea("defects", defectTxt)}</td>
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(PERMIT_SIDE)}</td>
      <td class="br-c2">${editArea("permit_addr", sheet.permit_addr)}</td>
      <td class="br-c3">${editArea("permit_kind", sheet.permit_kind)}</td>
    </tr>
    <tr>
      <td class="br-c1">${htmlLines(NOTES_SIDE)}</td>
      <td class="br-c23 br-notes" colspan="2">${editArea("notes", sheet.notes, "bf-notes")}</td>
    </tr>
    ${picAckRows()}
  </table>
</div>
`.trim();
}

// --- minimal port of api/ofp.py's RALT / ENROUTE ALT parsing (item 18) ---
const ICAO4_RE = /\b[A-Z]{4}\b/g;
function uniqIcao(codes: string[], skip?: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const code = c.toUpperCase();
    if (!toIcao(code) || ["TALT", "RALT", "TAKE"].includes(code) || seen.has(code) || (skip && skip.has(code))) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

const RALT_START_RE = /\bRALT\s*\/\s*/i;
const RALT_STOP_RE = /\b(?:TALT|RMK|EET|SEL|CODE|OPR|PER|DOF|NAV|DAT|PBN|STS|REG)\s*\//i;

export function parseRalt(text: string): string[] {
  const src = text || "";
  const start = RALT_START_RE.exec(src);
  if (!start) return [];
  const rest = src.slice(start.index + start[0].length);
  const stop = RALT_STOP_RE.exec(rest);
  const blob = stop ? rest.slice(0, stop.index) : rest;
  return uniqIcao(blob.toUpperCase().match(ICAO4_RE) ?? []);
}

const ENROUTE_ALT_EQ_RE = /^[ \t]*ENROUTE[ \t]+ALT(?:ERNATE)?[ \t]*=[ \t]*([^\n]*)/im;
function parseEnrouteAltLine(text: string): string[] {
  const m = ENROUTE_ALT_EQ_RE.exec(text || "");
  if (!m) return [];
  return uniqIcao(m[1].toUpperCase().match(ICAO4_RE) ?? []);
}

const ENROUTE_ALTN_HDR_RE = /ENROUTE\s*ALTN\s*:/i;
const ENROUTE_ALTN_ROW_RE = /^([A-Z]{4})\//;
function parseEnrouteAltnBlock(text: string): string[] {
  const m = ENROUTE_ALTN_HDR_RE.exec(text || "");
  if (!m) return [];
  const codes: string[] = [];
  const rest = (text || "").slice(m.index + m[0].length);
  for (const line of rest.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    const row = ENROUTE_ALTN_ROW_RE.exec(stripped);
    if (!row) break;
    codes.push(row[1].toUpperCase());
  }
  return uniqIcao(codes);
}

export function parseEnrouteAlts(text: string, destIcao = ""): string[] {
  const skip = destIcao ? new Set([destIcao.trim().toUpperCase()]) : undefined;
  const ralt = uniqIcao(parseRalt(text), skip);
  if (ralt.length) return ralt;
  const labelled = uniqIcao(parseEnrouteAltLine(text), skip);
  if (labelled.length) return labelled;
  return uniqIcao(parseEnrouteAltnBlock(text), skip);
}

export interface BuildSheetOpts {
  tafs?: Record<string, TafRecord> | null;
  aircraft?: Iterable<unknown> | null;
  now?: Date | null;
  reg?: string;
}

export function buildSheet(flight: FlightLike, ofpText: string, opts: BuildSheetOpts = {}): ReleaseSheet {
  const dep = toIcao(flight.dep_icao) || toIcao(flight.dep_iata);
  const dest = toIcao(flight.dest_icao) || toIcao(flight.dest_iata);
  const destAlts = destAltsOf(flight);
  const enroute = parseEnrouteAlts(ofpText || "", dest);
  const useReg = formatReg(opts.reg || flight.reg);
  const defects = defectsFor(useReg, opts.aircraft ?? null);
  const tafs = opts.tafs ?? {};

  const wx = (title: string, codes: string[]): WxBlock => {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const c of codes) {
      if (c && !seen.has(c)) {
        seen.add(c);
        uniq.push(c);
      }
    }
    return { label: aptLabel(title, uniq), icaos: uniq, texts: uniq.map((c) => tafBlock(c, tafs)) };
  };

  const published = opts.now ?? new Date();
  const src = parseRalt(ofpText || "").length ? "RALT/" : "ENROUTE ALT";

  return newSheet({
    callsign: (flight.callsign || "").trim().toUpperCase(),
    published_at: formatPublishedAt(published),
    dep,
    dest,
    dest_alts: destAlts,
    enroute_alts: enroute,
    reg: useReg,
    defects,
    wx: [
      wx("Dept. APT", dep ? [dep] : []),
      wx("Dest. APT", dest ? [dest] : []),
      wx("Dest. Alternate(s)", destAlts),
      wx("Enr. Alternate(s)", enroute),
    ],
    ofp_note: src,
  });
}

function formatPublishedAt(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = months[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mon} ${yyyy} ${hh}:${mm} UTC`;
}

export function toText(sheet: ReleaseSheet): string {
  const lines: string[] = [
    `Official Briefing for Flight Release: ${sheet.callsign}`,
    `Published at: ${sheet.published_at}`,
    "",
  ];
  for (const block of sheet.wx) {
    if (!block.icaos.length) {
      lines.push(block.label, "NIL", "");
      continue;
    }
    lines.push(block.label);
    for (const text of block.texts) lines.push(text);
    lines.push("");
  }

  const destAlt = aptLabel("Dest. Alternate(s)", sheet.dest_alts);
  const enrAlt = aptLabel("Enr. Alternate(s)", sheet.enroute_alts);
  const nt = padNotams(sheet.notams);
  lines.push(
    `En-route SIG Wx                          ${sigWxText(sheet.sig_wx)}`,
    `Dept. APT (${sheet.dep || "—"})                         ${nt[0]}`,
    `Dest. APT (${sheet.dest || "—"})                         ${nt[1]}`,
    ...(splitDestAlts(sheet)
      ? [`${aptLabel("Dest. Alternate 1", splitDestAlts(sheet)![0])}                         ${nt[2]}`,
         `${aptLabel("Dest. Alternate 2", splitDestAlts(sheet)![1])}                         ${nt[5]}`]
      : [`${destAlt}                         ${nt[2]}`]),
    `${enrAlt}                         ${nt[3]}`,
    `FIR(s)                                   ${nt[4]}`,
    "",
    "A/C OPS Limitations",
    "Check Tech log for updates",
    `REG: ${sheet.reg || "—"}`,
  );
  const noteLines = sheet.notes === NOTES_RED ? NOTES_LINES : (sheet.notes || "").split("\n");
  lines.push(...defectBullets(sheet.defects));
  lines.push(
    "",
    "Flight Permits",
    `${sheet.permit_addr} ${sheet.permit_kind}`.trim(),
    "",
    "NOTES by Dispatcher",
    ...noteLines,
    "",
    "PIC Ack",
    PIC_ACK,
    "",
  );
  return lines.join("\n");
}

export function pdfFilename(sheet: ReleaseSheet): string {
  const cs = (sheet.callsign || "FLIGHT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${cs}_Briefing.pdf`;
}

export function editKey(callsign: unknown): string {
  const raw = String(callsign ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return "VJC" + raw;
  if (raw.startsWith("VJC")) return raw;
  if (raw.startsWith("VJ") && /^\d+$/.test(raw.slice(2))) return "VJC" + raw.slice(2);
  return raw;
}

/**
 * Saved hand-edit identity: callsign + scheduled UTC date (STD, never the
 * delayed ETD) + route. Returns "" when any part is missing so a sector
 * without full identity never reads or writes another day's saved copy.
 */
export function editIdentity(flight: FlightLike & { std?: Date | string | null }): string {
  const cs = editKey(flight.callsign);
  const r = (flight.raw ?? {}) as Record<string, unknown>;
  const stdRaw = r["std"] ?? flight.std ?? null;
  const t = stdRaw instanceof Date ? stdRaw.getTime() : Date.parse(String(stdRaw ?? ""));
  const dep = String(flight.dep_icao || flight.dep_iata || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const dest = String(flight.dest_icao || flight.dest_iata || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cs || !Number.isFinite(t) || !dep || !dest) return "";
  const date = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  return `${cs}.${date}.${dep}-${dest}`;
}

export function parseIcaos(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\/,;\s]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    let code = toIcao(part);
    if (!code) {
      const compact = String(part).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (compact.length === 4 && /^[A-Z]+$/.test(compact) && !_NOT_ICAO.has(compact)) code = compact;
    }
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export function parseDefects(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split("\n");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let text = line.trim();
    text = text.replace(/^[-•]\s*/, "");
    text = text.replace(/^FM:\s*/i, "");
    if (isLowEgtNote(text)) continue;
    const key = text.toUpperCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function wxTextsOf(data: Record<string, unknown>, idx: number, fallback: string[]): string[] {
  const key = `wx${idx}`;
  if (key in data && data[key] !== null && data[key] !== undefined) {
    const blob = String(data[key]).trim();
    if (!blob) return ["NIL"];
    const parts = blob.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : [blob];
  }
  const wx = data["wx"];
  if (Array.isArray(wx) && idx < wx.length) {
    const block = wx[idx];
    if (block && typeof block === "object") {
      const texts = ((block as Record<string, unknown>)["texts"] as unknown[] | undefined ?? [])
        .map(String)
        .filter((t) => t.trim());
      return texts.length ? texts : fallback.length ? fallback : ["NIL"];
    }
    if (typeof block === "string" && block.trim()) return [block.trim()];
  }
  return fallback.length ? fallback : ["NIL"];
}

export function toFields(sheet: ReleaseSheet): Record<string, unknown> {
  return {
    callsign: sheet.callsign,
    published_at: sheet.published_at,
    dep: sheet.dep,
    dest: sheet.dest,
    dest_alts: [...sheet.dest_alts],
    enroute_alts: [...sheet.enroute_alts],
    reg: sheet.reg,
    defects: [...sheet.defects],
    wx: sheet.wx.map((b) => ({ label: b.label, icaos: [...b.icaos], texts: [...b.texts] })),
    sig_wx: sheet.sig_wx,
    notams: padNotams(sheet.notams),
    permit_addr: sheet.permit_addr,
    permit_kind: sheet.permit_kind,
    notes: sheet.notes,
    ofp_note: sheet.ofp_note,
  };
}

export function sheetFromFields(data: Record<string, unknown>): ReleaseSheet {
  const cs = editKey(data["callsign"]) || String(data["callsign"] ?? "").trim().toUpperCase();
  const dep = toIcao(data["dep"]) || String(data["dep"] ?? "").toUpperCase().trim();
  const dest = toIcao(data["dest"]) || String(data["dest"] ?? "").toUpperCase().trim();
  const destAlts = parseIcaos(data["dest_alts"]);
  const enroute = parseIcaos(data["enroute_alts"]);

  const titles = ["Dept. APT", "Dest. APT", "Dest. Alternate(s)", "Enr. Alternate(s)"];
  const codesList: string[][] = [dep ? [dep] : [], dest ? [dest] : [], destAlts, enroute];
  const wxBlocks: WxBlock[] = codesList.map((codes, i) => {
    let fallback: string[] = [];
    const wx = data["wx"];
    if (Array.isArray(wx) && i < wx.length && wx[i] && typeof wx[i] === "object") {
      fallback = ((wx[i] as Record<string, unknown>)["texts"] as unknown[] | undefined ?? []).map(String);
    }
    return { label: aptLabel(titles[i], codes), icaos: [...codes], texts: wxTextsOf(data, i, fallback) };
  });

  const notes = data["notes"] === null || data["notes"] === undefined ? "" : String(data["notes"]);
  return newSheet({
    callsign: cs,
    published_at: String(data["published_at"] ?? "").trim(),
    dep,
    dest,
    dest_alts: destAlts,
    enroute_alts: enroute,
    reg: formatReg(data["reg"]),
    defects: parseDefects(data["defects"]),
    wx: wxBlocks,
    ofp_note: String(data["ofp_note"] ?? ""),
    notes,
    permit_addr: String(data["permit_addr"] ?? PERMIT_ADDR),
    permit_kind: String(data["permit_kind"] ?? PERMIT_KIND),
    sig_wx: sigWxText(data["sig_wx"]),
    notams: notamsFromPayload(data),
  });
}

export function toDict(sheet: ReleaseSheet, opts: { edit?: boolean; edited?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ok: true,
    callsign: sheet.callsign,
    published_at: sheet.published_at,
    dep: sheet.dep,
    dest: sheet.dest,
    dest_alts: sheet.dest_alts,
    enroute_alts: sheet.enroute_alts,
    reg: sheet.reg,
    defects: sheet.defects,
    ofp_note: sheet.ofp_note,
    html: toHtml(sheet),
    text: toText(sheet),
    edited: Boolean(opts.edited),
  };
  if (opts.edit) {
    out["edit_html"] = toEditHtml(sheet);
    out["fields"] = toFields(sheet);
  }
  return out;
}

export type FetchOfpPdf = (flightId: number) => Promise<Uint8Array | null> | Uint8Array | null;
export type PdfTextExtractor = (blob: Uint8Array) => Promise<string> | string;
export type EditsStore = {
  load: (callsign: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
};

export interface DraftFromFlightOpts extends BuildSheetOpts {
  fetchPdf: FetchOfpPdf;
  pdfText: PdfTextExtractor;
  applyEdits?: boolean;
  loadEdits?: (callsign: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  pins?: PinStore;
  pinContext?: (sheet: ReleaseSheet, ofpText: string) => Promise<SheetPinContext> | SheetPinContext;
}

/** Merge partial saved edits without throwing away fresh OFP/WX/defect fields. */
export function applyFields(sheet: ReleaseSheet, data: Record<string, unknown>): ReleaseSheet {
  const base = toFields(sheet);
  if ([0, 1, 2, 3, 4, 5].some((i) => data[`notam${i}`] !== undefined)) {
    sheet.notams.forEach((cell, i) => { base[`notam${i}`] = cell; });
  }
  const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== undefined));
  return sheetFromFields({ ...base, ...changes, callsign: sheet.callsign });
}

export async function draftFromFlight(flight: FlightLike, opts: DraftFromFlightOpts): Promise<ReleaseSheet> {
  const blob = await opts.fetchPdf(Number(flight.id));
  if (!blob) {
    throw new BriefReleaseError(
      `Chưa có OFP cho ${flight.callsign || flight.id} — chờ OMC release.`,
    );
  }
  const text = await opts.pdfText(blob);
  let sheet = buildSheet(flight, text, opts);
  const identity = editIdentity(flight);
  if (opts.applyEdits !== false && opts.loadEdits && identity) {
    const saved = await opts.loadEdits(identity);
    if (saved) sheet = applyFields(sheet, { ...saved, ...(saved.notes === NOTES_RED ? { notes: "" } : {}) });
  }
  if (opts.pins) {
    const ctx = await opts.pinContext?.(sheet, text) ?? {};
    applyToSheet(sheet, opts.pins, { ...ctx, flightWindow: ctx.flightWindow ?? flightWindowOf(flight) });
  }
  return sheet;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Three-column Letter sheet; embedded Unicode font and full NOTAM content. */
export async function toPdf(sheet: ReleaseSheet): Promise<Uint8Array> {
  const { renderBriefingPdf } = await import("./briefingPdf");
  return renderBriefingPdf(sheet);
}
