// Port of notam_check.py tune_places / tune_places_domestic plus the helpers they
// need: head_vi (Vietnamese NOTAM summary), SID/STAR procedure matching, ATS-route /
// flow-control / airport drop_why classifiers, and the small OFP-text parsers
// (api/ofp.py parse_fpl_airports / parse_eet_firs / parse_eet_fir_times /
// parse_enroute_alts / extract_fpl_block) that tune_places depends on.
//
// NOT ported (geometry engine of notam_track.py — polygon/circle NOTAM geoms,
// geom_track_near, notam_alt_band, is_operator_policy, is_route_advisory, sup_keys):
// those always threw/были optional in the original too (guarded by try/except or by
// "if not geoms: return ''"), so here they are stubbed to the same no-geoms /
// no-policy-match fallback — tune_why still runs its EET/time-window and
// text-based classifiers faithfully, it just never drops a NOTAM purely for being
// a polygon >5 NM off the real track.
import type { Flight } from "../core/models";
import {
  normIcao,
  airportParentFir,
} from "./notam_check";
import {
  notamGeoms,
  notamAltBand,
  geomTrackNear,
  isOperatorPolicy,
  isRouteAdvisory,
  type Notam,
  type TrackPoint,
} from "./notam_track";

// --------------------------------------------------------------------------- //
// api/ofp.py text parsers (minimal subset needed by tune_places)
// --------------------------------------------------------------------------- //

const ICAO4 = /\b[A-Z]{4}\b/g;
const NOT_AIRPORT = new Set([
  "TALT", "ALTN", "THEN", "PAGE", "TIME", "WIND", "FUEL", "DIST",
  "PLAN", "TRIP", "FROM", "WITH", "THAT", "THIS", "HAVE", "NONE",
  "RALT", "TAKE", "OFF",
]);

function uniqIcao(codes: string[], skip?: Set<string>): string[] {
  const drop = new Set<string>(NOT_AIRPORT);
  for (const c of skip ?? []) if (c) drop.add(c.toUpperCase());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of codes) {
    const code = (raw || "").trim().toUpperCase();
    if (code.length !== 4 || !/^[A-Z]{4}$/.test(code)) continue;
    if (drop.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

const TALT_RE = /\bTALT\/([A-Z]{4})\b/;
const TAKEOFF_ALT_RE = /TAKE[ \t]*OFF[ \t]+ALT(?:N|ERNATE)?\b(?:[ \t]*[:=][ \t]*|[ \t]+)([A-Z]{4})\b/i;
const RALT_START = /\bRALT\//i;
const RALT_STOP = /\b(?:TALT|RMK|EET|SEL|CODE|OPR|PER|DOF|NAV|DAT|PBN|STS|REG)\//i;
const EET_START = /\bEET\//i;
const EET_STOP = /\b(?:SEL|CODE|OPR|PER|RALT|TALT|RMK|PBN|NAV|DOF|REG|DAT|STS|COM|DEP|DEST)\//i;
const EET_TOKEN = /\b([A-Z]{4})(\d{4})\b/g;
const FPL_AIRPORT_LINE = /^-([A-Z]{4})\d{4}\b(.*)$/;
const ENROUTE_ALT_EQ = /^[ \t]*ENROUTE[ \t]+ALT(?:ERNATE)?[ \t]*=[ \t]*([^\n]*)/im;
const ENROUTE_ALTN_HDR = /^[ \t]*ENROUTE[ \t]+ALTN[ \t]*:/im;
const ENROUTE_ALTN_ROW = /^[ \t]*([A-Z]{4})\/[A-Z]{3}\b/;

export function extractFplBlock(text: string): string {
  const src = text || "";
  const start = src.indexOf("(FPL-");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

function matchAll(re: RegExp, text: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
}

function parseRalt(text: string): string[] {
  const src = text || "";
  const start = RALT_START.exec(src);
  if (!start) return [];
  const rest = src.slice(start.index! + start[0].length);
  const stop = RALT_STOP.exec(rest);
  const blob = (stop ? rest.slice(0, stop.index) : rest).toUpperCase();
  return uniqIcao(matchAll(ICAO4, blob).map((m) => m[0]));
}

function parseEnrouteAltLine(text: string): string[] {
  const m = ENROUTE_ALT_EQ.exec(text || "");
  if (!m) return [];
  return uniqIcao(matchAll(ICAO4, (m[1] || "").toUpperCase()).map((x) => x[0]));
}

function parseEnrouteAltnBlock(text: string): string[] {
  const src = text || "";
  const m = ENROUTE_ALTN_HDR.exec(src);
  if (!m) return [];
  const codes: string[] = [];
  const rest = src.slice(m.index! + m[0].length);
  for (const line of rest.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    const row = ENROUTE_ALTN_ROW.exec(stripped);
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

export function parseEetFirs(text: string): string[] {
  const block = extractFplBlock(text);
  let src = block || text || "";
  let start = EET_START.exec(src);
  if (!start && block) {
    start = EET_START.exec(text || "");
    src = text || "";
  }
  if (!start) return [];
  const rest = src.slice(start.index! + start[0].length);
  const stop = EET_STOP.exec(rest);
  const blob = (stop ? rest.slice(0, stop.index) : rest).toUpperCase();
  const glued = matchAll(EET_TOKEN, blob).map((m) => m[1]);
  if (glued.length) return uniqIcao(glued);
  return uniqIcao(matchAll(ICAO4, blob).map((m) => m[0]));
}

export function parseEetFirTimes(text: string): Array<[string, number]> {
  const block = extractFplBlock(text);
  let src = block || text || "";
  let start = EET_START.exec(src);
  if (!start && block) {
    start = EET_START.exec(text || "");
    src = text || "";
  }
  if (!start) return [];
  const rest = src.slice(start.index! + start[0].length);
  const stop = EET_STOP.exec(rest);
  const blob = (stop ? rest.slice(0, stop.index) : rest).toUpperCase();
  const out: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (const m of matchAll(EET_TOKEN, blob)) {
    const code = m[1];
    if (seen.has(code)) continue;
    seen.add(code);
    const hhmm = m[2];
    out.push([code, parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2), 10)]);
  }
  return out;
}

export function parseFplAirports(text: string): { dep: string; arr: string; alts: string[]; talt: string } {
  const block = extractFplBlock(text) || text || "";
  let dep = "", arr = "";
  let alts: string[] = [];
  for (const rawLine of block.split("\n")) {
    const m = FPL_AIRPORT_LINE.exec(rawLine.trim());
    if (!m) continue;
    const code = m[1].toUpperCase();
    const rest = (m[2] || "").trim();
    if (!dep) { dep = code; continue; }
    arr = code;
    alts = uniqIcao(matchAll(ICAO4, rest.toUpperCase()).map((x) => x[0]), new Set([dep, arr]));
    break;
  }
  let talt = "";
  const found = TALT_RE.exec(block) || TALT_RE.exec(text || "") || TAKEOFF_ALT_RE.exec(text || "");
  if (found) talt = found[1].toUpperCase();
  return { dep, arr, alts, talt };
}

// --------------------------------------------------------------------------- //
// ident / Q-letters / blob helpers (mirrors of the ones already private in
// port/notam_check.ts — re-declared locally because they are not exported there)
// --------------------------------------------------------------------------- //

type N = Record<string, unknown>;

function qLetters(raw: unknown): string {
  let letters = String(raw ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.startsWith("Q")) letters = letters.slice(1);
  if (letters.length === 2) return letters;
  if (letters.length === 4) return letters.slice(0, 2);
  return "";
}

function notamBlob(notam: N): string {
  return ["e_field", "text", "subject", "condition"].map((k) => String(notam[k] ?? "")).join(" ").toUpperCase();
}

function subjOf(notam: N): string {
  return qLetters(notam.qsubj) || qLetters(notam.subject);
}
function condOf(notam: N): string {
  return qLetters(notam.qcond) || qLetters(notam.condition);
}

// --------------------------------------------------------------------------- //
// head_vi — Vietnamese one-line NOTAM summary
// --------------------------------------------------------------------------- //

const HEAD_RADIUS = /RADIUS\s+(\d+(?:[.,]\d+)?)\s*NM/i;
const HEAD_FG = /F\)\s*(\S+)\s+G\)\s*(.+?)(?:\n|$)/i;
const HEAD_DRONE = ["UNMANNED", "UAV", "UAS", "DRONE", "RPAS", "UNMANNED ACFT"];
const HEAD_A = /\bA\)\s*([A-Z]{4})\b/;
const HEAD_TWY = /\bTWY\s+([A-Z0-9]{1,4}(?:\s*(?:[/,]|AND)\s*[A-Z0-9]{1,4})*)/i;
const HEAD_RTE = /\b(?:ATS\s+RTE|ATS\s+ROUTE|RNAV\s+RTE|AWY|RTE)\s+([A-Z]{1,3}\d{1,4}(?:\s*\/\s*[A-Z]{1,3}\d{1,4})*)/i;
const HEAD_MISSION = /MISSION\s+NAME\s*:\s*([A-Z0-9][A-Z0-9._ -]{0,40})/i;

const HEAD_SUBJ: Record<string, string> = {
  FA: "sân bay", FB: "phanh", FC: "thi công",
  MR: "RWY", MT: "TWY", MP: "sân đỗ", MN: "apron", MD: "cự ly công bố",
  WU: "tàu không người lái", WM: "bắn", WP: "nhảy dù", WG: "tàu lượn",
  WL: "khinh khí cầu", WF: "pháo hoa", WS: "chim", WW: "núi lửa",
  WE: "diễn tập", WD: "phá nổ", WT: "bay mô hình",
  WR: "vùng hạn chế", RR: "vùng hạn chế", RD: "vùng nguy hiểm",
  RP: "vùng cấm", RT: "vùng tạm giữ", RA: "không lưu", RM: "vùng quân sự",
  AR: "ATS route", AX: "ATS route", AT: "ATS route", CR: "ATS route",
  NM: "navaid", NV: "VOR", NB: "NDB", ND: "DME", NA: "navaid",
  OL: "đèn chướng ngại", OB: "chướng ngại",
  LE: "đèn RWY", LA: "đèn tiếp cận", LP: "PAPI", LG: "đèn TWY",
  CA: "tiếp cận", CP: "holding", PI: "thủ tục tiếp cận",
  IC: "ILS", IL: "localizer", IG: "glide path", IT: "ILS",
  PA: "tiếp cận",
};
const HEAD_COND: Record<string, string> = {
  LC: "đóng", AU: "không khả dụng", AS: "hỏng",
  CA: "kích hoạt", CD: "hủy kích hoạt", LW: "diễn ra",
  LP: "hạn chế", LT: "hạn chế", CS: "thay đổi", CH: "thay đổi",
  CG: "hạ cấp", AH: "giờ hoạt động", TT: "kích hoạt",
};
const HEAD_KEEP = new Set([
  "RWY", "TWY", "ILS", "VOR", "DME", "NDB", "CAT", "PAR", "RNAV", "ATS",
  "FIR", "SFC", "AGL", "AMSL", "PAPI", "GNSS", "GPS", "SID", "STAR",
  "APCH", "LOC", "H24", "PERM", "UFN", "IFR", "VFR", "WIP", "NM",
  "FL", "IAP", "RNP", "PBN", "TACAN", "ATIS", "CATI", "CATII", "CATIII",
]);
const HEAD_STOP = /\b(?:TO|OF|THE|AND|WITH|FROM|THAN|THEN|AS|FLW|RMK|REF|THIS|THAT|WILL|BE|MAY|VIA|INTO|ONTO|AT|ON|IN|OR|BY)\b/gi;
const HEAD_EN: Array<[string, string]> = [
  ["INSTRUMENT APPROACH PROCEDURE", "thủ tục tiếp cận"],
  ["INSTRUMENT APPROACH", "tiếp cận bằng thiết bị"],
  ["UNMANNED AIRCRAFT", "tàu không người lái"],
  ["UNMANNED ACFT", "tàu không người lái"],
  ["WILL TAKE PLACE", "diễn ra"],
  ["AIRSPACE RESERVATION", "giữ vùng trời"],
  ["AIRSPACE BLOCKED", "vùng trời đóng"],
  ["AIRSPACE BLOCK", "vùng trời đóng"],
  ["FLOW CONTROL PROCEDURE", "kiểm soát luồng"],
  ["FLOW CONTROL", "kiểm soát luồng"],
  ["PRECISION APPROACH RADAR", "PAR"],
  ["NOT AVBL FOR CIV ACFT", "không khả dụng cho tàu bay dân sự"],
  ["NOT AVBL FOR CIVIL ACFT", "không khả dụng cho tàu bay dân sự"],
  ["NOT AVAILABLE FOR CIV ACFT", "không khả dụng cho tàu bay dân sự"],
  ["NOT AVAILABLE FOR CIVIL", "không khả dụng cho dân sự"],
  ["DUE TO WORK IN PROGRESS", "vì đang thi công"],
  ["WORK IN PROGRESS", "đang thi công"],
  ["PAR APCH TO RWY", "PAR tiếp cận RWY"],
  ["PAR APCH", "PAR tiếp cận"],
  ["APCH TO RWY", "tiếp cận RWY"],
  ["DOWNGRADED TO", "hạ xuống"],
  ["DOWNGRADED", "hạ cấp"],
  ["ILS CATEGORY", "ILS CAT"],
  ["RNAV ROUTE", "RNAV route"],
  ["ATS ROUTE", "ATS route"],
  ["TEMPO DANGER AREA", "vùng nguy hiểm tạm"],
  ["RESTRICTED AREA", "vùng hạn chế"],
  ["PROHIBITED AREA", "vùng cấm"],
  ["DANGER AREA", "vùng nguy hiểm"],
  ["OBSTACLE LIGHTS", "đèn chướng ngại"],
  ["OBSTACLE LIGHT", "đèn chướng ngại"],
  ["AIRCRAFT STAND", "sân đỗ"],
  ["CIVIL AIRCRAFT", "tàu bay dân sự"],
  ["CIV ACFT", "tàu bay dân sự"],
  ["GUN FIRING", "bắn"],
  ["LIVE FIRING", "bắn đạn thật"],
  ["MILITARY EXERCISE", "diễn tập quân sự"],
  ["NOT AVAILABLE", "không khả dụng"],
  ["NOT AVBL", "không khả dụng"],
  ["UNSERVICEABLE", "hỏng"],
  ["HOURS OF SERVICE", "giờ hoạt động"],
  ["MISSION NAME", "nhiệm vụ"],
  ["LIMITED TO", "hạn chế"],
  ["AERODROME", "sân bay"],
  ["AIRPORT", "sân bay"],
  ["PROCEDURE", "thủ tục"],
  ["APPROACH", "tiếp cận"],
  ["CATEGORY", "CAT"],
  ["RUNWAY", "RWY"],
  ["TAXIWAY", "TWY"],
  ["APRON", "apron"],
  ["CLOSED", "đóng"],
  ["CLSD", "đóng"],
  ["ACTIVATED", "kích hoạt"],
  ["TRIGGERED", "kích hoạt"],
  ["LIMITED", "hạn chế"],
  ["AVAILABLE", "khả dụng"],
  ["INSTALLED", "lắp"],
  ["CHANGED", "thay đổi"],
  ["PARACHUTE", "nhảy dù"],
  ["GLIDER", "tàu lượn"],
  ["BALLOON", "khinh khí cầu"],
  ["FIREWORKS", "pháo hoa"],
  ["EXERCISE", "diễn tập"],
  ["OBSTACLE", "chướng ngại"],
  ["LIGHTS", "đèn"],
  ["VOLCANIC", "núi lửa"],
  ["AIRCRAFT", "tàu bay"],
  ["ACFT", "tàu bay"],
  ["MAINTENANCE", "bảo trì"],
  ["CONSTRUCTION", "thi công"],
  ["THRESHOLD", "ngưỡng"],
  ["DISPLACED", "dời"],
  ["SUSPENDED", "tạm ngưng"],
  ["CANCELLED", "hủy"],
  ["CANCELED", "hủy"],
  ["REDUCED", "giảm"],
  ["INCREASED", "tăng"],
  ["DEPARTURE", "khởi hành"],
  ["ARRIVAL", "đến"],
  ["LANDING", "hạ cánh"],
  ["TAKE-OFF", "cất cánh"],
  ["TAKEOFF", "cất cánh"],
  ["VISUAL", "mắt"],
  ["TEMPO", "tạm"],
];

function headAltToken(raw: string): string {
  let s = String(raw ?? "").trim().split(/[,;]/)[0].trim();
  s = s.replace(/(\d)\s*FT\b/gi, "$1 ft");
  s = s.replace(/\bFT\b/gi, "ft");
  return s;
}

function headAlt(notam: N): string {
  let f = String(notam.f_field ?? "").trim();
  let g = String(notam.g_field ?? "").trim();
  if (!f || !g) {
    const m = HEAD_FG.exec(String(notam.text ?? ""));
    if (m) { f = f || m[1]; g = g || m[2].trim(); }
  }
  f = headAltToken(f); g = headAltToken(g);
  if (!f || !g) return "";
  return `${f}–${g}`;
}

function headRadius(blob: string): string {
  const m = HEAD_RADIUS.exec(blob || "");
  if (!m) return "";
  return `${m[1].replace(".", ",")} NM`;
}

function headTwy(blob: string): string {
  const m = HEAD_TWY.exec(blob || "");
  if (!m) return "";
  let ids = m[1].toUpperCase().replace(/\s+AND\s+/g, "/");
  ids = ids.replace(/\s*\/\s*/g, "/");
  return `TWY ${ids}`;
}

function headRoute(blob: string): string {
  const m = HEAD_RTE.exec(blob || "");
  return m ? m[1].toUpperCase().replace(/\s+/g, "") : "";
}

function headMission(blob: string): string {
  const m = HEAD_MISSION.exec(blob || "");
  return m ? m[1].replace(/\s+/g, " ").trim().replace(/^[ .-]+|[ .-]+$/g, "") : "";
}

function headNorm(raw: string): string {
  let s = String(raw ?? "").split(/\s+/).filter(Boolean).join(" ");
  s = s.replace(/\bCATEGORY\s*3\b/gi, "CAT III");
  s = s.replace(/\bCATEGORY\s*2\b/gi, "CAT II");
  s = s.replace(/\bCATEGORY\s*1\b/gi, "CAT I");
  s = s.replace(/\bCAT(?:EGORY)?\s*III\b/gi, "CAT III");
  s = s.replace(/\bCAT(?:EGORY)?\s*II\b/gi, "CAT II");
  s = s.replace(/\bCAT(?:EGORY)?\s*I\b/gi, "CAT I");
  return s;
}

function headScrub(raw: string): string {
  let s = String(raw ?? "").split(/\bREF\b/i)[0];
  s = s.replace(HEAD_STOP, " ");
  s = s.replace(/\s+[.,;:]+/g, "");
  return s.replace(/\s+/g, " ").trim().replace(/^[ /,\-—:.]+|[ /,\-—:.]+$/g, "");
}

function headEnLeft(raw: string): number {
  const s = raw || "";
  let n = 0;
  for (const m of s.matchAll(/[A-Za-z]{4,}/g)) {
    const u = m[0].toUpperCase();
    if (HEAD_KEEP.has(u)) continue;
    if (/^[A-Z]{1,3}\d{1,4}$/.test(u)) continue;
    const idx = m.index ?? 0;
    const prev = idx ? s[idx - 1] : "";
    const next = idx + m[0].length < s.length ? s[idx + m[0].length] : "";
    if (prev === "-" || next === "-") continue;
    n++;
  }
  return n;
}

function headELine(notam: N): string {
  let e = String(notam.e_field ?? "").trim();
  e = e.replace(/^E\)\s*/i, "");
  e = e.split("\n")[0];
  e = e.split(/\bREF\b/i)[0];
  return e.replace(/\s+/g, " ").trim().replace(/^[ .;]+|[ .;]+$/g, "");
}

function headEnVi(raw: string): string {
  let out = headNorm(String(raw ?? "").split(/\s+/).filter(Boolean).join(" "));
  if (!out) return "";
  const sorted = [...HEAD_EN].sort((a, b) => b[0].length - a[0].length);
  for (const [en, vi] of sorted) {
    out = out.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), vi);
  }
  return headScrub(out);
}

function headRicher(a: string, b: string): boolean {
  if (!a) return false;
  if (!b) return true;
  if (headEnLeft(b) > headEnLeft(a)) return true;
  if (/\b(?:RWY|CAT|TWY|PAR|ILS)\b/i.test(a) && !/\b(?:RWY|CAT|TWY|PAR|ILS)\b/i.test(b)) return true;
  return a.length > b.length + 6;
}

function headCode(notam: N, icao: string): string {
  const code = String(icao || notam.icao || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (code.length === 4) return code;
  const m = HEAD_A.exec(String(notam.text ?? "").toUpperCase());
  return m ? m[1] : "";
}

function headJoin(code: string, core: string, ...tail: string[]): string {
  let c = String(core ?? "").replace(/\s+/g, " ").trim().replace(/^[ —,]+|[ —,]+$/g, "");
  const extra = tail.filter(Boolean).join(", ");
  let left: string;
  if (code && c && !c.toUpperCase().startsWith(code)) left = `${code} ${c}`;
  else left = c || code;
  if (extra && !left.includes(extra)) return left ? `${left}, ${extra}` : extra;
  return left;
}

export function headVi(notam: N, icao = ""): string {
  const code = headCode(notam, icao);
  const blob = ["subject", "condition", "e_field", "text", "qsubj"].map((k) => String(notam[k] ?? "")).join(" ").toUpperCase();
  const subj = qLetters(notam.qsubj) || qLetters(notam.subject);
  const cond = qLetters(notam.qcond) || qLetters(notam.condition);
  const drone = subj === "WU" || HEAD_DRONE.some((p) => blob.includes(p));
  const tempoDanger = blob.includes("TEMPO DANGER");
  const danger = tempoDanger || blob.includes("DANGER AREA");
  const radius = headRadius(blob);
  const alt = headAlt(notam);
  const rwy = pairRwyLabels(closedRwysOf(notam));
  const twy = headTwy(blob);
  const rte = headRoute(blob);
  const mission = headMission(blob);
  const closed = ["LC", "CA", "AJ"].includes(cond) || blob.includes("CLSD") || blob.includes("CLOSED");
  const rwyShut = subj === "MR" || /\b(?:RWY|RUNWAY)\b.{0,24}\b(?:CLSD|CLOSED)\b/.test(blob);

  if (drone) {
    const left = [code, "tàu không người lái"].filter(Boolean).join(" ");
    const mid = [tempoDanger ? "vùng nguy hiểm tạm" : (danger ? "vùng nguy hiểm" : ""), radius].filter(Boolean).join(" ");
    if (left && mid) {
      const out = `${left} — ${mid}`;
      return alt ? `${out}, ${alt}` : out;
    }
    if (left && alt) return `${left} — ${alt}`;
    return left;
  }

  if (rwyShut) {
    if (rwy.length) return headJoin(code, `đóng RWY ${rwy.join(", ")}`, alt);
    if (closed) return headJoin(code, "đóng RWY", alt);
  }
  const procs = notamSidStarProcs(notam);
  if (procs.length) {
    const short = procs.slice(0, 6);
    const extra = procs.length > 6 ? "…" : "";
    const hits = ((notam.sid_star_hit_names as string[]) || []).filter(Boolean).map((x) => normProc(x));
    if (hits.length) return headJoin(code, "SID/STAR dính " + hits.join(", "), alt);
    return headJoin(code, "SID/STAR không dùng " + short.join(", ") + extra, alt);
  }
  if (subj === "FA" && (
    ["LC", "CA", "AJ"].includes(cond) ||
    ["AD CLSD", "AD CLOSED", "AERODROME CLOSED", "AERODROME CLSD", "AIRPORT CLOSED", "APT CLSD", "CLOSED TO ALL ACFT", "AD NOT AVBL", "AERODROME NOT AVBL"].some((p) => blob.includes(p))
  )) {
    return headJoin(code, "sân đóng", alt);
  }
  if (twy && (subj === "MT" || closed)) {
    const act = closed ? "đóng" : (HEAD_COND[cond] || "");
    return headJoin(code, `${act} ${twy}`.trim(), alt);
  }
  if (subj === "WM" || ["GUN FIR", "LIVE FIR", "ARTILLERY", "FIRING RANGE", "WEAPON FIR", "ROCKET FIR", "GUNNERY", "FRNG EXER", "LIVE AMMUNITION", "SHELLING"].some((p) => blob.includes(p))) {
    return headJoin(code, "bắn", radius, alt);
  }
  if (["AR", "AX", "AT"].includes(subj) || rte || [
    "ATS RTE", "ATS ROUTE", "RNAV RTE", "RE-ROUTE", "REROUTE",
    "RTE NOT AVBL", "AWY NOT AVBL", "AIRWAY NOT AVBL",
    "DCT NOT AVBL", "ROUTE CLOSED", "RTE CLSD", "AWY CLSD",
  ].some((p) => blob.includes(p))) {
    const act = (blob.includes("NOT AVBL") || blob.includes("CLSD") || ["AU", "LC"].includes(cond))
      ? "không khả dụng" : (HEAD_COND[cond] || "");
    return headJoin(code, ["ATS route", rte, act].filter(Boolean).join(" "), alt);
  }
  if (danger) {
    const kind = tempoDanger ? "vùng nguy hiểm tạm" : "vùng nguy hiểm";
    const act = HEAD_COND[cond] || (/ ACT/.test(` ${blob}`) ? "kích hoạt" : "");
    return headJoin(code, `${kind} ${act}`.trim(), radius, alt);
  }
  if (["WR", "RR"].includes(subj) || blob.includes("RESTRICTED AREA")) {
    const act = HEAD_COND[cond] || (/ ACT/.test(` ${blob}`) ? "kích hoạt" : "");
    return headJoin(code, `vùng hạn chế ${act}`.trim(), radius, alt);
  }
  if (blob.includes("U/S") || blob.includes("UNSERVICEABLE")) {
    const topic = HEAD_SUBJ[subj] || headEnVi(String(notam.subject ?? ""));
    return headJoin(code, `${topic} hỏng`.trim(), alt);
  }

  const topic = HEAD_SUBJ[subj] || headEnVi(String(notam.subject ?? ""));
  let action = HEAD_COND[cond] || headEnVi(String(notam.condition ?? ""));
  if (!action && (blob.includes(" ACTIVATED") || /\bACT\b/.test(blob))) action = "kích hoạt";
  let obj = twy || rte || mission;
  if (obj && topic && topic.toUpperCase().includes(obj.toUpperCase())) obj = "";
  const qCore = headScrub([topic, obj, action].filter(Boolean).join(" "));
  const eVi = headEnVi(headELine(notam));
  if (eVi && (!qCore || headEnLeft(qCore) >= 1 || headRicher(eVi, qCore))) {
    return headJoin(code, eVi, radius, alt);
  }
  if (qCore) return headJoin(code, qCore, radius, alt);
  if (eVi) return headJoin(code, eVi, radius, alt);
  return headJoin(code, topic || action, radius, alt);
}

// --------------------------------------------------------------------------- //
// RWY designator helpers
// --------------------------------------------------------------------------- //

const RWY_HEAD = /\b(?:RWY|RUNWAY)S?\b\s*([0-9LCR/, AND-]{1,40})/gi;
const RWY_DES = /\d{1,2}[LCR]?/g;

function rwyDes(raw: string): string {
  const s = String(raw ?? "").toUpperCase().replace(/[^0-9LCR]/g, "");
  const m = /^(\d{1,2})([LCR]?)$/.exec(s);
  if (!m) return "";
  return `${String(parseInt(m[1], 10)).padStart(2, "0")}${m[2]}`;
}

function rwyRecip(des: string): string {
  const m = /^(\d{2})([LCR]?)$/.exec(des);
  if (!m) return "";
  const n = ((parseInt(m[1], 10) + 17) % 36) + 1;
  const flip: Record<string, string> = { L: "R", R: "L" };
  const side = flip[m[2]] ?? m[2];
  return `${String(n).padStart(2, "0")}${side}`;
}

export function pairRwyLabels(designators: string[]): string[] {
  const left = designators.map(rwyDes).filter(Boolean);
  const used = new Set<string>();
  const labels: string[] = [];
  for (const des of left) {
    if (used.has(des)) continue;
    const rec = rwyRecip(des);
    if (rec && left.includes(rec) && !used.has(rec)) {
      labels.push(`${des}/${rec}`);
      used.add(des); used.add(rec);
    } else {
      labels.push(des);
      used.add(des);
    }
  }
  return labels;
}

export function closedRwysOf(notam: N): string[] {
  const blob = notamBlob(notam);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const chunk of blob.matchAll(RWY_HEAD)) {
    for (const tok of (chunk[1] || "").toUpperCase().match(RWY_DES) || []) {
      const des = rwyDes(tok);
      if (des && !seen.has(des)) { seen.add(des); found.push(des); }
    }
  }
  return found;
}

// --------------------------------------------------------------------------- //
// SID/STAR procedure matching
// --------------------------------------------------------------------------- //

const SIDSTAR_HINT = /\b(?:SID|STAR|RNAV\s+SID|RNAV\s+STAR|PBN\s+PROCEDURE|FLT\s+PROCEDURES?|FLIGHT\s+PROCEDURES?|HLDG\s+PATTERN|HOLDING\s+PATTERN)\b/i;
const PROC_ITEM = /\b([A-Z]{2,5})\s+(\d{1,2}[A-Z](?:\s*\/\s*\d{1,2}[A-Z])*)\b/g;
const PROC_COMPACT = /\b([A-Z]{2,5}\d{1,2}[A-Z])\b/g;
const HLDG_FIX = /\b(?:HLDG|HOLDING)\s+PATTERN\s*:?\s*([A-Z]{5})\b/gi;
const OFP_SID_LINE = /\bSID(?:\s+RWY\s+\S+)?\s*[:.\-]\s*([A-Z]{2,5}\s*\d{0,2}[A-Z]?)\b/gi;
const OFP_STAR_LINE = /\bSTAR(?:\s+RWY\s+\S+)?\s*[:.\-]\s*([A-Z]{2,5}\s*\d{0,2}[A-Z]?)\b/gi;
const PROC_SKIP = new Set(["RWY", "TWY", "FIR", "FL", "NM", "CAT", "ILS", "VOR", "DME", "QNH", "QFE", "UTC", "NOTAM", "SEE", "AND", "THE", "FOR", "ACT", "DUE", "USE", "DO", "TO"]);
const FPL_FIX = /\b([A-Z]{5})\b/g;
const FPL_AWY = /\b([A-Z]{1,2}\d{1,4})\b/g;
const FPL_CRUISE = /-[A-Z]\d{4}F(\d{3})\b/;

function normProc(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function procStem(key: string): string {
  const raw = normProc(key);
  const m = /^([A-Z]{2,5})\d/.exec(raw);
  return m ? m[1] : raw;
}

function expandProcFamily(name: string, variants: string): string[] {
  const base = String(name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (base.length < 2 || PROC_SKIP.has(base)) return [];
  const out: string[] = [];
  for (const bit of String(variants ?? "").toUpperCase().split(/[/,]+/)) {
    const ver = bit.replace(/[^A-Z0-9]/g, "");
    if (!ver || /^\d{2}[LCR]$/.test(ver)) continue;
    if (!/^\d{1,2}[A-Z]$/.test(ver)) continue;
    out.push(base + ver);
  }
  return out;
}

export function notamSidStarProcs(notam: N | string): string[] {
  if (isTaxiwayNotam(notam)) return [];
  const blob = (typeof notam === "object" ? notamBlob(notam) : String(notam ?? "")).toUpperCase();
  if (!SIDSTAR_HINT.test(blob)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = normProc(name);
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key); out.push(key);
  };
  for (const m of blob.matchAll(PROC_ITEM)) {
    for (const key of expandProcFamily(m[1], m[2])) add(key);
  }
  for (const m of blob.matchAll(HLDG_FIX)) add(m[1]);
  return out;
}

export function ofpSidStarProcs(ofpText: string): Set<string> {
  const raw = String(ofpText ?? "").toUpperCase();
  const blob = extractFplBlock(raw) || raw;
  const out = new Set<string>();
  for (const rx of [OFP_SID_LINE, OFP_STAR_LINE]) {
    for (const m of raw.matchAll(rx)) {
      const key = normProc(m[1]);
      if (key.length >= 3) out.add(key);
    }
  }
  for (const m of blob.matchAll(PROC_COMPACT)) {
    const key = m[1];
    const nameM = /^([A-Z]{2,5})/.exec(key);
    if (nameM && PROC_SKIP.has(nameM[1])) continue;
    if (/^[A-Z]{2,5}\d{2}[LCR]$/.test(key)) continue;
    out.add(key);
  }
  return out;
}

export function sidStarHitsOf(notam: N, ofpText: string, tokens?: Set<string>): string[] {
  if (isTaxiwayNotam(notam)) return [];
  const banned = new Set(notamSidStarProcs(notam));
  if (!banned.size) return [];
  const filed = ofpSidStarProcs(ofpText);
  const used = new Set(filed);
  for (const t of tokens ?? []) if (t) used.add(normProc(t));
  const hit = new Set([...banned].filter((x) => used.has(x)));
  if (!filed.size) {
    const stems = new Set([...used].map(procStem).filter(Boolean));
    for (const proc of banned) if (stems.has(procStem(proc))) hit.add(proc);
  } else {
    const bare = new Set([...filed].filter((p) => !/\d/.test(normProc(p))).map(procStem));
    for (const proc of banned) {
      const stem = procStem(proc);
      if (stem && bare.has(stem) && stem !== proc) hit.add(proc);
    }
  }
  return [...hit].sort();
}

function fplTokens(ofpText: string): Set<string> {
  const blob = (extractFplBlock(ofpText) || ofpText || "").toUpperCase();
  const out = new Set<string>();
  for (const m of blob.matchAll(FPL_FIX)) out.add(m[1]);
  for (const m of blob.matchAll(FPL_AWY)) {
    const tok = m[1];
    if (tok.startsWith("F") && tok.length === 4) continue;
    out.add(tok);
  }
  for (const t of ofpSidStarProcs(ofpText)) out.add(t);
  return out;
}

export function plannedFlOf(_flight: Flight, ofpText = ""): number {
  // cached_planned_fl (OFP-PDF cache) is not available in this runtime — fall
  // back straight to the FPL cruise FL token, same as the Python function does
  // when the cache is empty.
  const blob = ofpText || "";
  const m = FPL_CRUISE.exec(blob.toUpperCase());
  return m ? parseInt(m[1], 10) : 0;
}

// --------------------------------------------------------------------------- //
// locations_of / flight_airfields / domestic_airports / track_scope / fir_windows
// --------------------------------------------------------------------------- //

export type Loc = { dep: string; arr: string; alts: string[]; talt: string; ralts: string[]; firs: string[]; source: string };

export function locationsOf(flight: Flight, ofpText = ""): Loc {
  let dep = "", arr = "", talt = "";
  let alts: string[] = [];
  let ralts: string[] = [];
  let firs: string[] = [];
  let source = "gantts";
  if (ofpText) {
    const p = parseFplAirports(ofpText);
    dep = p.dep; arr = p.arr; alts = p.alts; talt = p.talt;
    firs = parseEetFirs(ofpText);
    ralts = parseEnrouteAlts(ofpText, arr || flight.dest_icao);
    if (dep || arr || alts.length || talt || ralts.length || firs.length) source = "ofp";
  }
  if (!dep) dep = flight.dep_icao;
  if (!arr) arr = flight.dest_icao;
  if (!alts.length) {
    const rawAlts = [flight.dest_alt1, flight.dest_alt2, String((flight.raw as Record<string, unknown> | undefined)?.dest_alt3 ?? "")];
    const skip = new Set([normIcao(dep), normIcao(arr)]);
    alts = rawAlts.map((x) => normIcao(x)).filter((c) => c && !skip.has(c));
  }
  // cached_talt (OFP-PDF cache) unavailable in this runtime; talt stays as parsed.
  const skipRalt = new Set([normIcao(dep), normIcao(arr), normIcao(talt), ...alts.map((a) => normIcao(a))]);
  ralts = ralts.map((x) => normIcao(x)).filter((c) => c && !skipRalt.has(c));
  return {
    dep: normIcao(dep), arr: normIcao(arr),
    alts: alts.map(normIcao).filter(Boolean),
    talt: normIcao(talt), ralts,
    firs: firs.map(normIcao).filter(Boolean),
    source,
  };
}

export function flightAirfields(flight: Flight, ofpText = ""): Array<[string, string]> {
  const loc = locationsOf(flight, ofpText);
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  const add = (raw: string, role: string) => {
    const code = normIcao(raw);
    if (!code || seen.has(code)) return;
    seen.add(code); out.push([code, role]);
  };
  add(loc.dep, "DEP");
  add(loc.arr, "ARR");
  for (const alt of loc.alts) add(alt, "ALT");
  add(loc.talt, "TALT");
  for (const ralt of loc.ralts) add(ralt, "RALT");
  return out;
}

function isDomesticFlight(flight: Flight): boolean {
  const dep = normIcao(flight.dep_icao), dest = normIcao(flight.dest_icao);
  return dep.length >= 2 && dest.length >= 2 && dep.slice(0, 2) === dest.slice(0, 2);
}

export function domesticAirports(flights: Flight[], ofpTexts?: Record<number, string>): Set<string> {
  const texts = ofpTexts ?? {};
  const out = new Set<string>();
  for (const flight of flights) {
    if (!isDomesticFlight(flight)) continue;
    const loc = locationsOf(flight, texts[flight.id] ?? "");
    const prefix = (loc.dep || normIcao(flight.dep_icao)).slice(0, 2);
    if (prefix.length < 2) continue;
    const take = (raw: string) => { const code = normIcao(raw); if (code && code.slice(0, 2) === prefix) out.add(code); };
    take(loc.dep); take(loc.arr); take(loc.talt);
    for (const alt of loc.alts) take(alt);
  }
  return out;
}

export function trackScope(flight: Flight, ofpText = "", places: N[] = []): [Set<string>, Set<string>] {
  const loc = locationsOf(flight, ofpText);
  const air = new Set<string>();
  for (const [code] of flightAirfields(flight, ofpText)) if (code) air.add(code);
  const firs = new Set((loc.firs || []).map(normIcao).filter(Boolean));
  const dep = loc.dep || normIcao(flight.dep_icao);
  let depFir = "";
  for (const place of places || []) {
    if (String(place.code ?? "").toUpperCase() === dep) {
      depFir = airportParentFir(dep, String(place.fir ?? ""));
      if (depFir) break;
    }
  }
  if (!depFir) depFir = airportParentFir(dep);
  if (depFir) firs.add(depFir);
  return [air, firs];
}

export function firWindows(flight: Flight, ofpText = "", depFir = ""): Record<string, [Date, Date]> {
  const std = aware(flight.std || flight.etd);
  const sta = aware(flight.sta || flight.eta) || std;
  if (!std) return {};
  const eet = ofpText ? parseEetFirTimes(ofpText) : [];
  const out: Record<string, [Date, Date]> = {};
  if (eet.length) {
    for (let i = 0; i < eet.length; i++) {
      const [rawCode, minute] = eet[i];
      const code = normIcao(rawCode);
      if (!code) continue;
      const start = addMin(std, minute || 0);
      const stop = i + 1 < eet.length ? addMin(std, eet[i + 1][1] || 0) : (sta || start);
      out[code] = [start, stop || start];
    }
    const firstM = eet[0][1] || 0;
    const dep = normIcao(depFir);
    if (dep && !out[dep]) out[dep] = [std, firstM ? addMin(std, firstM) : (sta || std)];
  } else {
    const dep = normIcao(depFir);
    if (dep) out[dep] = [std, sta || std];
  }
  return out;
}

function addMin(d: Date, min: number): Date { return new Date(d.getTime() + min * 60_000); }
function aware(d: Date | null | undefined): Date | null { return d ?? null; }

// --------------------------------------------------------------------------- //
// build_tune_ctx
// --------------------------------------------------------------------------- //

type TuneCtx = Record<string, unknown>;

export function buildTuneCtx(flight: Flight, ofpText = ""): TuneCtx {
  const loc = locationsOf(flight, ofpText);
  const roles: Record<string, string> = {};
  for (const [code, role] of flightAirfields(flight, ofpText)) roles[code] = role;
  const used = new Set(Object.keys(roles));
  const eet = ofpText ? parseEetFirTimes(ofpText) : [];
  const firs = new Set(eet.map(([code]) => normIcao(code)));
  for (const c of loc.firs || []) firs.add(normIcao(c));
  const std = aware(flight.std || flight.etd);
  const sta = aware(flight.sta || flight.eta) || std;
  const firLo: Record<string, Date> = {};
  const firHi: Record<string, Date> = {};
  const padMs = 3600_000;
  if (std && eet.length) {
    for (let i = 0; i < eet.length; i++) {
      const [rawCode, minute] = eet[i];
      const code = normIcao(rawCode);
      if (!code) continue;
      const start = addMin(std, minute || 0);
      const stop = i + 1 < eet.length ? addMin(std, eet[i + 1][1] || 0) : (sta || start);
      firLo[code] = new Date(start.getTime() - padMs);
      firHi[code] = new Date((stop || start).getTime() + padMs);
    }
  }
  const cruise = plannedFlOf(flight, ofpText);
  const tokens = fplTokens(ofpText);
  return {
    used, roles, firs, std, sta, fir_lo: firLo, fir_hi: firHi,
    cruise_fl: cruise, cruise_ft: cruise ? cruise * 100 : 0, tokens,
    fpl: (extractFplBlock(ofpText) || ofpText || "").toUpperCase(),
    dep: loc.dep || "", arr: loc.arr || "",
  };
}

export function extraOfpTokens(points?: Array<Record<string, unknown>> | null): Set<string> {
  const out = new Set<string>();
  for (const pt of points || []) {
    if (!pt || typeof pt !== "object") continue;
    for (const key of ["name", "airway", "awy"]) {
      const name = String((pt as N)[key] ?? "").toUpperCase().replace(/\s+/g, "");
      if (name === "" || name === "DCT") continue;
      if (name.startsWith("F") && name.length === 4 && /^\d+$/.test(name.slice(1))) continue;
      if (/^[A-Z]{1,2}\d{1,4}$/.test(name) || /^[A-Z]{5}$/.test(name) || (name.length === 3 && /^[A-Z]+$/.test(name) && !FLOW_STOP_3.has(name))) {
        out.add(name);
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------------- //
// classifiers used by tune_why
// --------------------------------------------------------------------------- //

const TWY_SUBJ = new Set(["MT", "MX"]);
const APRON_SUBJ = new Set(["MN", "MP"]);
const FIRE_SUBJ = new Set(["RD", "WM", "WR", "RA", "RM", "RP"]);
const NOFLY_SUBJ = new Set(["RO", "RR", "RT"]);
const NOFLY_RE = /\b(?:FLT\s+|FLIGHT\s+)?(?:OPS|OPERATIONS?)\s+(?:ARE\s+)?PROHIBITED\b|\bOVERFLYING\s+OF\s+PROHIBITED\b|\bPROHIBITED\s+(?:WI|WITHIN)\b/i;
const OBST_LIGHT_SUBJ = new Set(["OL"]);
const FLOW_SUBJ = new Set(["PF"]);
const FLOW_RE = /\bFLOW\s*CTL\b|\bFLOW\s+CONTROL\b|\bATFM\b|\bTFC\s+FLOW\b|\bTRAFFIC\s+FLOW\b/i;
const FLOW_DIR_RE = /\b(WESTBOUND|WEST[- ]BOUND|WBND|WBD)\b|\b(EASTBOUND|EAST[- ]BOUND|EBND|EBD)\b|\b(NORTHBOUND|NORTH[- ]BOUND|NBND|NBD)\b|\b(SOUTHBOUND|SOUTH[- ]BOUND|SBND|SBD)\b/gi;
const FLOW_CARDINAL: Record<string, string> = { E: "eastbound", W: "westbound", N: "northbound", S: "southbound" };
const FLOW_OPP: Record<string, string> = { E: "W", W: "E", N: "S", S: "N" };
const FLOW_RTE_RE = /\b(?:ATS\s+)?RTE\s*:?\s*([A-Z]{1,2}\d{1,4}(?:\s*[/,\s]\s*[A-Z]{1,2}\d{1,4})*)/gi;
const FLOW_DEP_FM_RE = /\bDEP(?:ARTING)?\s+(?:FM|FROM)\s+((?:[A-Z]{4}(?:\s*(?:AND|\/|,)\s*)?)+)/gi;
const NAVAID_CODE = /\b([A-Z]{3})\s+(?:DVOR|VOR(?:DME)?|DME|NDB)\b|\(([A-Z]{3})\)/gi;
const FLOW_STOP_5 = new Set(["ABOVE", "BELOW", "AFTER", "WHILE", "UNDER", "LIMIT", "LEVEL", "ROUTE", "TRACK", "BASED", "MIGHT", "SHALL", "APPLY", "AVAIL", "PLACE", "THERE", "WHERE", "THESE", "THOSE", "OTHER", "FIRST", "UNTIL", "BEING", "USING", "WHICH", "ABOUT", "THEIR", "HOURS", "TIMES", "AREAS", "JAPAN", "FLWS", "WHITE", "BEACH", "BLACK", "GREEN", "SMALL", "LARGE", "AVOID", "CITY", "EXTRA", "FLTCK", "CHECK", "NOTAM", "DAILY", "NIGHT", "LOCAL", "TOTAL", "VALID", "MAINT", "WORKS", "CLOSE", "FUELS", "ADVSD", "HOLDS", "DELAY"]);
const FLOW_STOP_4 = new Set(["WILL", "TAKE", "FROM", "ONLY", "THIS", "THAT", "WITH", "AREA", "FLOW", "OVER", "INTO", "ALSO", "THEN", "WHEN", "TIME", "HOUR", "PLUS", "BOTH", "EACH", "SOME", "SUCH", "MUST", "HAVE", "BEEN", "THEY", "THEM", "YOUR", "THAN", "DUE", "FOR", "AND", "THE", "NOT", "MAY", "ALL", "ANY", "TFC", "ACT", "AVBL", "UFN", "EST", "PERM", "REF", "TEL", "RMK", "FLW", "ALT", "CTL", "LDG", "DEP", "ARR", "VIA"]);
const FLOW_STOP_3 = new Set(["THE", "AND", "FOR", "UTC", "FIR", "ATS", "RTE", "FLT", "EXP", "VIA", "ATC", "SEP", "DLY", "ABV", "BTN", "ADD", "ALL", "NOT", "MAY", "ALSO", "FM", "TO", "OR", "AS", "OF", "IN", "ON", "BY", "AT", "DRG", "TFC", "ACT", "AVBL", "REF", "RMK", "ALT", "CTL", "DEP", "ARR", "EET", "FLW"]);
const TWY_RE = /\b(?:TWY|TAXIWAY)S?\b/;
const LIGHT_RE = /\b(?:LIGHT(?:S|ING)?|LGT(?:S|D|ING)?)\b/;
const OBST_LIGHT_RE = /\bOBST(?:ACLE)?S?\s+(?:LIGHT|LGT)S?\b|\b(?:LIGHT|LGT)S?\s+(?:ON\s+)?OBST(?:ACLE)?S?\b/;
const OBST_WITHDRAWN_COND = new Set(["AW"]);
const OBST_WITHDRAWN_RE = /\bOBSTACLE\s+COMPLETELY\s+WITHDRAWN\b|\bOBST(?:ACLE)?S?\b.{0,60}\b(?:COMPLETELY\s+)?WITHDRAWN\b|\b(?:DAY\s+)?MARKING\s+ERASED\b|\bOBST(?:ACLE)?S?\b.{0,40}\bERASED\b/;
const APRON_RE = /\b(?:APRON|APRONS|ACFT\s+STANDS?|AIRCRAFT\s+STANDS?|PARKING\s+STANDS?)\b|\bSTANDS\b/;
const FIRE_RE = /GUN\s+FIR|LIVE\s+FIR|FIRING\s+RANGE|WEAPON\s+FIR|ARTILLERY|\bROCKET\b|\bGUNNERY\b|\bMISSILE\b|\bFRNG\s+EXER\b|DANGER\s+AREA|RESTRICTED\s+AREA|PROHIBITED\s+AREA/;
const ROUTE_SUBJ = new Set(["AR", "AX", "AT", "CR"]);
const ROUTE_PHRASE = ["ATS RTE", "ATS ROUTE", "RNAV RTE", "RNAV ROUTE", "CDR ARE ESTABLISHED", "CDR ESTABLISHED", "RE-ROUTE", "REROUTE", "RTE NOT AVBL", "AWY NOT AVBL", "AIRWAY NOT AVBL", "DCT NOT AVBL", "ROUTE CLOSED", "RTE CLSD", "AWY CLSD"];
const VFR_ONLY_RE = /\b(?:ALL\s+)?(?:SMALL\s+)?VFR\s+ACFT\b|\bVFR\s+(?:ACFT\s+)?ONLY\b|\bONLY\s+(?:FOR\s+)?VFR\b|\bFOR\s+VFR\s+(?:ACFT|ONLY)\b/i;
const BALLOON_SUBJ = new Set(["WL"]);
const BALLOON_RE = /\bFREE\s+BALLOON\b|\bHEAVY\s+BALLOON\b|\bBALLOON\s+RELEAS|\bASCENT\s+OF\s+(?:FREE\s+)?BALLOON\b|\bHAPS\b/i;
const KITE_SUBJ = new Set(["WC"]);
const KITE_RE = /\bCAPTIVE\s+BALLOON\b|\bKITE\b/i;
const EXER_SUBJ = new Set(["WE", "WP", "WB", "WA"]);
const EXER_RE = /\bEXERCISE\b|\bFRNG\s+EXER\b|\bFORMATION\s+FLIGHT\b|\bFORMATION\s+FLT\b|\bGROUP\s+FLT\b|\bPARACHUT|\bCARGO\s+DROP\b|\bAEROBATIC|\bAIR\s+SHOW\b|\bAIRSHOW\b|\bCIVIL\s+TRAINING|\bTRAINING\s+AND\s+TESTING|\bTRAINING\s+AREA\b|\bTEMPO\s+TRAINING\b/i;

export function isTaxiwayNotam(notam: N | string): boolean {
  if (typeof notam === "string") return TWY_RE.test(notam.toUpperCase());
  if (!notam || typeof notam !== "object") return false;
  if (TWY_SUBJ.has(subjOf(notam))) return true;
  return TWY_RE.test(notamBlob(notam));
}

function operatorPolicyDropWhy(notam: N): string {
  return isOperatorPolicy(notam as Notam) ? "chính sách khai thác/đăng ký (operator policy)" : "";
}

function obstWithdrawnDropWhy(notam: N): string {
  const subj = subjOf(notam), cond = condOf(notam);
  const blob = notamBlob(notam);
  if (subj === "OB" && OBST_WITHDRAWN_COND.has(cond)) return "chướng ngại đã rút";
  if (OBST_WITHDRAWN_RE.test(blob)) return "chướng ngại đã rút";
  return "";
}

function fplAwyTokens(blob: string): Set<string> {
  const out = new Set<string>();
  for (const m of blob.matchAll(FPL_AWY)) {
    const tok = m[1];
    if (tok.startsWith("FL")) continue;
    if (tok.startsWith("F") && /^\d+$/.test(tok.slice(1)) && tok.length === 4) continue;
    out.add(tok);
  }
  return out;
}

function flowAwyTokens(blob: string): Set<string> { return fplAwyTokens(blob); }

function flowNamedTokens(blob: string): Set<string> {
  const text = (blob || "").toUpperCase();
  const out = flowAwyTokens(text);
  for (const m of text.matchAll(FPL_FIX)) if (!FLOW_STOP_5.has(m[1])) out.add(m[1]);
  for (const m of text.matchAll(/\b([A-Z]{4})\b/g)) {
    const tok = m[1];
    if (FLOW_STOP_4.has(tok)) continue;
    if (/^[A-Z]{4}$/.test(tok)) out.add(tok);
  }
  return out;
}

function flowListedAwys(blob: string): Set<string> {
  const out = new Set<string>();
  for (const m of (blob || "").matchAll(FLOW_RTE_RE)) for (const t of flowAwyTokens(m[1])) out.add(t);
  return out;
}

function flowDepFrom(blob: string): Set<string> {
  const out = new Set<string>();
  for (const m of (blob || "").matchAll(FLOW_DEP_FM_RE)) {
    for (const code of (m[1].toUpperCase().match(/[A-Z]{4}/g) || [])) {
      const n = normIcao(code);
      if (n) out.add(n);
    }
  }
  return out;
}

function cardinalOfLl(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const dlat = lat2 - lat1, dlon = lon2 - lon1;
  if (Math.abs(dlat) < 0.15 && Math.abs(dlon) < 0.15) return "";
  if (Math.abs(dlon) >= Math.abs(dlat)) return dlon > 0 ? "E" : "W";
  return dlat > 0 ? "N" : "S";
}

function flightCardinal(ctx: TuneCtx): string {
  const raw = String(ctx.heading ?? "").trim().toUpperCase();
  if (FLOW_CARDINAL[raw]) return raw;
  const pts = ((ctx.points as Array<Record<string, unknown>>) || []).filter((p) => p && typeof p === "object");
  if (pts.length >= 2) {
    const a = pts[0], b = pts[pts.length - 1];
    try {
      return cardinalOfLl(Number(a.lat), Number(a.lon), Number(b.lat), Number(b.lon));
    } catch { return ""; }
  }
  return "";
}

function notamCardinals(blob: string): Set<string> {
  const found = new Set<string>();
  for (const m of (blob || "").matchAll(FLOW_DIR_RE)) {
    if (m[1]) found.add("W");
    if (m[2]) found.add("E");
    if (m[3]) found.add("N");
    if (m[4]) found.add("S");
  }
  return found;
}

function isFlowControl(notam: N): boolean {
  const subj = subjOf(notam);
  if (FLOW_SUBJ.has(subj)) return true;
  return FLOW_RE.test(notamBlob(notam));
}

function flowDropWhy(notam: N, ctx: TuneCtx): string {
  if (!isFlowControl(notam)) return "";
  const blob = notamBlob(notam);
  const ours = flightCardinal(ctx);
  const dirs = notamCardinals(blob);
  if (ours && dirs.size === 1) {
    const ndir = [...dirs][0];
    if (FLOW_OPP[ours] === ndir) return `flow control ${FLOW_CARDINAL[ndir]} (chuyến ${FLOW_CARDINAL[ours]})`;
  }
  const tokens = new Set((ctx.tokens as Set<string>) || []);
  const used = new Set((ctx.used as Set<string>) || []);
  for (const code of [ctx.dep, ctx.arr]) {
    const n = normIcao(String(code ?? ""));
    if (n) used.add(n);
  }
  const awys = flowListedAwys(blob);
  if (awys.size && tokens.size && [...awys].every((a) => !tokens.has(a)) && !ofpNamedHits(notam, tokens).length) {
    return "flow control khác route OFP (" + [...awys].sort().join("/") + ")";
  }
  const deps = flowDepFrom(blob);
  const flightDep = normIcao(String(ctx.dep ?? ""));
  if (deps.size && flightDep && !deps.has(flightDep)) {
    return "flow control DEP FM " + [...deps].sort().join("/");
  }
  const named = flowNamedTokens(blob);
  const known = new Set([...tokens, ...used]);
  if (named.size && known.size && [...named].every((n) => !known.has(n))) {
    return "flow control khác route OFP";
  }
  return "";
}

function navaidTokens(blob: string): Set<string> {
  const out = new Set<string>();
  for (const m of (blob || "").matchAll(NAVAID_CODE)) {
    const tok = (m[1] || m[2] || "").toUpperCase();
    if (tok && !FLOW_STOP_3.has(tok)) out.add(tok);
  }
  return out;
}

function isAtsRouteNotam(notam: N): boolean {
  const subj = subjOf(notam);
  if (ROUTE_SUBJ.has(subj)) return true;
  const blob = notamBlob(notam);
  if (ROUTE_PHRASE.some((p) => blob.includes(p))) return true;
  if (flowListedAwys(blob).size) return true;
  if (isRouteAdvisory(notam as Notam)) return true;
  return false;
}

function ofpNamedHits(notam: N, tokens: Set<string>): string[] {
  if (isTaxiwayNotam(notam)) return [];
  const known = new Set([...tokens].filter(Boolean).map((t) => String(t).toUpperCase()));
  if (!known.size) return [];
  const blob = notamBlob(notam);
  const listed = flowListedAwys(blob);
  const awys = listed.size ? listed : flowAwyTokens(blob);
  const fixes = new Set([...blob.matchAll(FPL_FIX)].map((m) => m[1]).filter((t) => !FLOW_STOP_5.has(t)));
  const navaids = navaidTokens(blob);
  const skip = new Set<string>();
  for (const proc of notamSidStarProcs(notam)) {
    skip.add(proc);
    const stem = procStem(proc);
    if (stem) skip.add(stem);
  }
  const union = new Set([...awys, ...fixes, ...navaids]);
  return [...union].filter((x) => known.has(x) && !skip.has(x)).sort();
}

function atsRouteDropWhy(notam: N, ctx: TuneCtx): string {
  if (isFlowControl(notam)) return "";
  if (!isAtsRouteNotam(notam)) return "";
  const tokens = new Set((ctx.tokens as Set<string>) || []);
  if (!tokens.size) return "";
  if (ofpNamedHits(notam, tokens).length) return "";
  const blob = notamBlob(notam);
  const awys = flowListedAwys(blob).size ? flowListedAwys(blob) : flowAwyTokens(blob);
  if (awys.size && [...awys].every((a) => !tokens.has(a))) {
    return "ATS route khác OFP (" + [...awys].sort().join("/") + ")";
  }
  return "";
}

function airportDropWhy(notam: N, ctx: TuneCtx): string {
  let why = operatorPolicyDropWhy(notam);
  if (why) return why;
  const subj = subjOf(notam);
  const blob = notamBlob(notam);
  if (isTaxiwayNotam(notam)) return "TWY";
  if (OBST_LIGHT_SUBJ.has(subj) || OBST_LIGHT_RE.test(blob)) return "obstacle light";
  why = obstWithdrawnDropWhy(notam);
  if (why) return why;
  if ((subj.length === 2 && subj[0] === "L") || LIGHT_RE.test(blob)) return "đèn / lighting";
  if (APRON_SUBJ.has(subj) || APRON_RE.test(blob)) return "apron / aircraft stand";
  why = flowDropWhy(notam, ctx);
  if (why) return why;
  return atsRouteDropWhy(notam, ctx);
}

function isFireArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (FIRE_SUBJ.has(subj)) return true;
  return FIRE_RE.test(notamBlob(notam));
}
function isProhibitedArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (NOFLY_SUBJ.has(subj)) return true;
  return NOFLY_RE.test(notamBlob(notam));
}
function isUavArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (subj === "WU") return true;
  const blob = notamBlob(notam);
  return ["UNMANNED", "UAV", "UAS", "DRONE", "RPAS"].some((p) => blob.includes(p));
}
function isBalloonArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (BALLOON_SUBJ.has(subj)) return true;
  return BALLOON_RE.test(notamBlob(notam));
}
function isKiteArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (KITE_SUBJ.has(subj)) return true;
  return KITE_RE.test(notamBlob(notam));
}
function isExerciseArea(notam: N): boolean {
  const subj = subjOf(notam);
  if (EXER_SUBJ.has(subj)) return true;
  return EXER_RE.test(notamBlob(notam));
}

function firAreaKind(notam: N): string {
  if (isFireArea(notam)) return "vùng bắn";
  if (isProhibitedArea(notam)) return "vùng cấm bay";
  if (isUavArea(notam)) return "vùng drone";
  if (isBalloonArea(notam)) return "khinh khí cầu";
  if (isKiteArea(notam)) return "bóng bay / diều";
  if (isExerciseArea(notam)) {
    const blob = notamBlob(notam);
    const subj = subjOf(notam);
    if (/\bFORMATION\s+(?:FLIGHT|FLT)\b|\bGROUP\s+FLT\b/.test(blob)) return "nhóm bay";
    if (["WB", "WA"].includes(subj) || /\bAEROBATIC|\bAIR\s*SHOW\b/.test(blob)) return "aerobatics";
    return "diễn tập";
  }
  return "";
}

function firVfrDropWhy(notam: N): string {
  const blob = notamBlob(notam);
  const hasIfr = /\bIFR\b/.test(blob);
  const traffic = String(notam.traffic ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (traffic && traffic.includes("V") && !traffic.includes("I")) return "chỉ VFR (không IFR)";
  if (VFR_ONLY_RE.test(blob) && !hasIfr) return "chỉ VFR (không IFR)";
  if (!traffic && /\bVFR\b/.test(blob) && !hasIfr) return "chỉ VFR (không IFR)";
  return "";
}

function firObstLightDropWhy(notam: N): string {
  const subj = subjOf(notam);
  if (OBST_LIGHT_SUBJ.has(subj) || OBST_LIGHT_RE.test(notamBlob(notam))) return "obstacle light";
  return "";
}

const TUNE_FIRE_NM = 5.0;
const TUNE_FL_PAD_FT = 5000;

// Port of notam_check.fir_fire_drop_why using notam_track's geometry engine
// (notamGeoms / geomTrackNear / notamAltBand) now that it is ported.
function firFireDropWhy(notam: N, points: unknown[]): string {
  const kind = firAreaKind(notam);
  if (!kind) return "";
  const pts = (points || []) as TrackPoint[];
  if (!pts.length) return "";
  const geoms = notamGeoms(notam as Notam);
  if (!geoms.length) return "";
  const [lo, hi] = notamAltBand(notam as Notam);
  let anyClose = false;
  let anyFlHit = false;
  let farNm: number | null = null;
  const flSeen: Array<[number, string]> = [];
  for (const geom of geoms) {
    const near = geomTrackNear(geom, pts);
    const dist = near.dist_nm ?? 1e9;
    if (dist > TUNE_FIRE_NM) {
      farNm = farNm === null ? dist : Math.min(farNm, dist);
      continue;
    }
    anyClose = true;
    const flFt = near.fl_ft || 0;
    const name = near.name || "";
    if (flFt <= 0) continue;
    flSeen.push([flFt, name]);
    if (hi >= 90000) { anyFlHit = true; continue; }
    const loPad = lo - TUNE_FL_PAD_FT;
    const hiPad = hi + TUNE_FL_PAD_FT;
    if (loPad <= flFt && flFt <= hiPad) anyFlHit = true;
  }
  if (!anyClose) {
    const shown = farNm ?? 1e9;
    return `${kind} cách route ${shown.toFixed(0)} NM (>${TUNE_FIRE_NM.toFixed(0)} NM)`;
  }
  if (hi < 90000 && flSeen.length && !anyFlHit) {
    const [flFt, name] = flSeen.reduce((a, b) => (b[0] > a[0] ? b : a));
    let bit = `${kind}: dải F/G ±5000 (FL${Math.max(0, Math.floor((lo - TUNE_FL_PAD_FT) / 100))}` +
      `–FL${Math.floor((hi + TUNE_FL_PAD_FT) / 100)}) không tới FL${Math.floor(flFt / 100)}`;
    if (name) bit += ` ${name}`;
    return bit;
  }
  return "";
}

function fmtHhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const TUNE_WHEN_LO_H = 1.0;
const TUNE_WHEN_HI_H = 2.0;

function bcOk(notam: N, lo: Date | null, hi: Date | null): boolean {
  if (!lo || !hi) return true;
  const start = parseNotamWhenLocal(notam.start);
  const end = parseNotamWhenLocal(notam.end, true);
  if (start && start > hi) return false;
  if (end && end < lo) return false;
  return true;
}

// local re-export to avoid a circular import on parseNotamWhen name collisions
function parseNotamWhenLocal(raw: unknown, endOfDay = false): Date | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseNotamWhen } = require("./notam_check") as typeof import("./notam_check");
  return parseNotamWhen(raw, endOfDay);
}

function dFieldOf(notam: N): string {
  const raw = String(notam.d_field ?? notam.dField ?? notam.itemD ?? notam.schedule ?? "").trim();
  if (raw) return raw;
  const blob = String(notam.text ?? "");
  const hit = /^D\)\s*(.+)$/im.exec(blob);
  return hit ? hit[1].trim() : "";
}

const D_PAIR = /(?<!\d)(\d{4})\s*[/\-–]\s*(\d{4})(?!\d)/g;
const D_ALWAYS = new Set(["H24", "H 24", "ZERO RATE", "H24."]);
const D_UNK = new Set(["HJ", "HN", "SR-SS", "SR/SS", "SS-SR", "SS/SR"]);
const DOW: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

type DSpec = { always: boolean; days?: Set<number>; spans?: Array<[number, number, number, number]> };

function hhmmPair(a: string, b: string): [number, number, number, number] | null {
  const h1 = parseInt(a.slice(0, 2), 10), m1 = parseInt(a.slice(2), 10);
  const h2 = parseInt(b.slice(0, 2), 10), m2 = parseInt(b.slice(2), 10);
  if ([h1, h2, m1, m2].some(Number.isNaN) || h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  return [h1, m1, h2, m2];
}

function parseDSpec(raw: string): DSpec | null {
  const text = String(raw ?? "").replace(/\s+/g, " ").toUpperCase().trim().replace(/^\.+|\.+$/g, "");
  if (!text) return null;
  if (D_ALWAYS.has(text) || text.startsWith("H24")) return { always: true };
  if (D_UNK.has(text) || text.startsWith("HJ") || text.startsWith("HN")) return null;
  let days: Set<number> | undefined;
  const parts = text.split(/\bEXC\b/);
  const body = parts[0], excl = parts.length > 1 ? parts[1] : "";
  if (body.includes("DAILY") || body.includes("DLY")) days = new Set([0, 1, 2, 3, 4, 5, 6]);
  const mspan = /\b(MON|TUE|WED|THU|FRI|SAT|SUN)\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN)\b/.exec(body);
  if (mspan) {
    const a = DOW[mspan[1]], b = DOW[mspan[2]];
    days = new Set();
    if (a <= b) for (let i = a; i <= b; i++) days.add(i);
    else { for (let i = a; i < 7; i++) days.add(i); for (let i = 0; i <= b; i++) days.add(i); }
  } else if (days === undefined) {
    const found = Object.keys(DOW).filter((w) => new RegExp(`\\b${w}\\b`).test(body)).map((w) => DOW[w]);
    if (found.length) days = new Set(found);
  }
  if (excl) {
    const skip = new Set(Object.keys(DOW).filter((w) => new RegExp(`\\b${w}\\b`).test(excl)).map((w) => DOW[w]));
    days = new Set([...(days ?? new Set([0, 1, 2, 3, 4, 5, 6]))].filter((d) => !skip.has(d)));
  }
  const spans: Array<[number, number, number, number]> = [];
  for (const m of text.matchAll(D_PAIR)) {
    const pair = hhmmPair(m[1], m[2]);
    if (pair) spans.push(pair);
  }
  if (!spans.length) return null;
  return { always: false, days, spans };
}

function dScheduleOk(notam: N, when: Date, padH = 2.0, until?: Date | null): boolean {
  const spec = parseDSpec(dFieldOf(notam));
  if (spec === null || spec.always) return true;
  const lo = new Date(when.getTime() - padH * 3600_000);
  const hi = until ? until : new Date(when.getTime() + padH * 3600_000);
  const start = parseNotamWhenLocal(notam.start);
  const end = parseNotamWhenLocal(notam.end, true);
  const days = spec.days;
  const spans = spec.spans || [];
  const day0 = new Date(lo.getTime() - 86400_000);
  day0.setUTCHours(0, 0, 0, 0);
  const nDays = Math.floor((hi.getTime() - day0.getTime()) / 86400_000) + 3;
  for (let i = 0; i < Math.max(1, nDays); i++) {
    const day = new Date(day0.getTime() + i * 86400_000);
    if (days && !days.has(day.getUTCDay())) continue;
    for (const [h1, m1, h2, m2] of spans) {
      const fm0 = new Date(day); fm0.setUTCHours(h1, m1, 0, 0);
      let to0 = new Date(day); to0.setUTCHours(h2, m2, 0, 0);
      if (to0.getTime() <= fm0.getTime()) to0 = new Date(to0.getTime() + 86400_000);
      let fm = fm0, to = to0;
      if (start && to < start) continue;
      if (end && fm > end) continue;
      if (start && fm < start) fm = start;
      if (end && to > end) to = end;
      if (fm <= hi && to >= lo) return true;
    }
  }
  return false;
}

function rwyRoleOf(role: string, place: N, ctx: TuneCtx | null): string {
  const raw = String(role ?? "").trim().toUpperCase();
  if (raw === "DEP" || raw === "ARR") return raw;
  const code = normIcao(String(place.code ?? "")) || String(place.code ?? "").toUpperCase();
  if (ctx) {
    const roles = (ctx.roles as Record<string, string>) || {};
    const mapped = String(roles[code] ?? "").trim().toUpperCase();
    if (mapped === "DEP" || mapped === "ARR") return mapped;
    if (code && code === normIcao(String(ctx.dep ?? ""))) return "DEP";
    if (code && code === normIcao(String(ctx.arr ?? ""))) return "ARR";
  }
  return raw;
}

const RWY_WIN_LO_H = 1.0;
const RWY_WIN_HI_H = 2.0;

function rwyWindow(role: string, ctx: TuneCtx | null): [Date | null, Date | null] {
  if (!ctx) return [null, null];
  const r = String(role ?? "").trim().toUpperCase();
  const std = ctx.std as Date | null, sta = ctx.sta as Date | null;
  const lo = RWY_WIN_LO_H * 3600_000, hi = RWY_WIN_HI_H * 3600_000;
  if (r === "DEP") return std ? [new Date(std.getTime() - lo), new Date(std.getTime() + hi)] : [null, null];
  if (r === "ARR") return sta ? [new Date(sta.getTime() - lo), new Date(sta.getTime() + hi)] : [null, null];
  return [null, null];
}

export function rwyInFlightWin(notam: N, role: string, ctx: TuneCtx | null): boolean {
  const [lo, hi] = rwyWindow(role, ctx);
  if (!lo || !hi) return true;
  if (!bcOk(notam, lo, hi)) return false;
  return dScheduleOk(notam, lo, 0.0, hi);
}
void rwyRoleOf; // kept for parity / future RWY-summary port

const TUNE_PAD_H = 1.0;
void TUNE_PAD_H;

function placeWindow(place: N, ctx: TuneCtx): [Date | null, Date | null] {
  const code = normIcao(String(place.code ?? "")) || String(place.code ?? "").toUpperCase();
  const std = ctx.std as Date | null, sta = ctx.sta as Date | null;
  const padMs = 3600_000;
  const isFir = String(place.kind ?? "").toUpperCase() === "FIR" || String(place.kind ?? "").toUpperCase() === "F";
  if (isFir) {
    const firLo = (ctx.fir_lo as Record<string, Date>) || {};
    const firHi = (ctx.fir_hi as Record<string, Date>) || {};
    return [firLo[code] || std, firHi[code] || sta];
  }
  const role = String(((ctx.roles as Record<string, string>) || {})[code] ?? "");
  if ((role === "DEP" || role === "TALT") && std) return [new Date(std.getTime() - padMs), new Date(std.getTime() + padMs)];
  if (role === "RALT" && std) return [new Date(std.getTime() - padMs), new Date((sta || std).getTime() + padMs)];
  if (sta) return [new Date(sta.getTime() - padMs), new Date(sta.getTime() + 2 * 3600_000)];
  if (std) return [new Date(std.getTime() - padMs), new Date(std.getTime() + padMs)];
  return [null, null];
}
void placeWindow; // referenced for parity with Python's _place_window (not required by tune_why itself)

function firWhenWindow(_notam: N, place: N, ctx: TuneCtx): [Date | null, Date | null, string] {
  // Geometry-based nearest-point timing (notam_track.geom_track_near) is not
  // ported; fall straight to the EET fir_win fallback, same as Python when
  // `geoms` is empty.
  const code = normIcao(String(place.code ?? ""));
  const win = ((ctx.fir_win as Record<string, [Date, Date]>) || {})[code];
  if (win) {
    const [entry, exit] = win;
    if (entry) {
      const lo = new Date(entry.getTime() - TUNE_WHEN_LO_H * 3600_000);
      const hi = new Date((exit || entry).getTime() + TUNE_WHEN_HI_H * 3600_000);
      return [lo, hi, `${fmtHhmm(lo)}–${fmtHhmm(hi)}`];
    }
  }
  return [null, null, ""];
}

function firTimeDropWhy(notam: N, place: N, ctx: TuneCtx): string {
  const [lo, hi, label] = firWhenWindow(notam, place, ctx);
  if (!lo || !hi) return "";
  if (!bcOk(notam, lo, hi)) return `B)/C) ngoài cửa sổ ${label}`;
  if (!dScheduleOk(notam, lo, 0, hi)) return `D) ngoài cửa sổ ${label}`;
  return "";
}

function firDropWhy(notam: N, place: N, ctx: TuneCtx): string {
  let why = operatorPolicyDropWhy(notam);
  if (why) return why;
  why = firObstLightDropWhy(notam);
  if (why) return why;
  why = obstWithdrawnDropWhy(notam);
  if (why) return why;
  why = firVfrDropWhy(notam);
  if (why) return why;
  why = flowDropWhy(notam, ctx);
  if (why) return why;
  why = atsRouteDropWhy(notam, ctx);
  if (why) return why;
  why = firTimeDropWhy(notam, place, ctx);
  if (why) return why;
  return firFireDropWhy(notam, (ctx.points as unknown[]) || []);
}

function isFir(place: N): boolean {
  return String(place.kind ?? "").toUpperCase() === "FIR" || String(place.kind ?? "").toUpperCase() === "F";
}

export function tuneWhy(notam: N, place: N, ctx: TuneCtx): string {
  const mode = String(ctx.mode ?? "track").trim().toLowerCase();
  const code = normIcao(String(place.code ?? "")) || String(place.code ?? "").toUpperCase();
  const fir = isFir(place);
  const keepAir = (ctx.keep_air as Set<string>) || new Set<string>();
  const keepFir = (ctx.keep_fir as Set<string>) || new Set<string>();
  if (mode === "domestic") {
    if (fir) return "FIR không lấy khi lọc quốc nội";
    if (keepAir.size && !keepAir.has(code)) return `sân ${code} không phải DEP/DEST/TALT/ALT quốc nội`;
    return airportDropWhy(notam, ctx);
  }
  if (fir) {
    if (keepFir.size && !keepFir.has(code)) return `FIR ${code} không trên EET / FIR sân đi`;
    return firDropWhy(notam, place, ctx);
  }
  if (keepAir.size && !keepAir.has(code)) return `sân ${code} không phải DEP/DEST/RALT/ALT của chuyến`;
  const why = airportDropWhy(notam, ctx);
  if (why) return why;
  return firFireDropWhy(notam, (ctx.points as unknown[]) || []);
}

// --------------------------------------------------------------------------- //
// stamp_ofp_heads / stamp_sid_star_hits / _apply_tune / tune_places(_domestic)
// --------------------------------------------------------------------------- //

const OFP_HEAD_NOTE = /(?:\s*[—–-]\s*)?có dính tới [A-Z0-9/]+-OFP cần xem lại/i;

function ofpHeadNote(hits: string[]): string {
  if (!hits.length) return "";
  return "có dính tới " + hits.join("/") + "-OFP cần xem lại";
}

function applyOfpHead(notam: N, tokens: Set<string>, icao = ""): string {
  if (isTaxiwayNotam(notam)) {
    notam.ofp_hits = [];
    return String(notam.head_vi ?? "").trim() || headVi(notam, icao);
  }
  const hits = ofpNamedHits(notam, tokens);
  notam.ofp_hits = hits;
  const code = headCode(notam, icao);
  let base: string;
  if (hits.length && isFlowControl(notam)) {
    base = headJoin(code, "kiểm soát luồng");
  } else {
    base = String(notam.head_vi ?? "").trim() || headVi(notam, icao);
    base = base.replace(OFP_HEAD_NOTE, "").trim().replace(/^[ —–,-]+|[ —–,-]+$/g, "");
  }
  const note = ofpHeadNote(hits);
  if (note) base = base ? `${base} — ${note}` : note;
  notam.head_vi = base;
  return base;
}

function stampOfpHeads(places: N[], tokens: Set<string>, points?: Array<Record<string, unknown>> | null): Set<string> {
  const known = new Set([...tokens, ...extraOfpTokens(points)]);
  for (const place of places || []) {
    const code = String(place.code ?? "");
    for (const notam of (place.notams as N[] | undefined) || []) {
      if (notam && typeof notam === "object") applyOfpHead(notam, known, code);
    }
  }
  return known;
}

function stampSidStarHits(places: N[], flights: Flight[], texts?: Record<number, string>): void {
  const t = texts || {};
  for (const place of places || []) {
    const code = String(place.code ?? "");
    for (const notam of (place.notams as N[] | undefined) || []) {
      if (!notam || typeof notam !== "object") continue;
      if (isTaxiwayNotam(notam)) {
        notam.sid_star = []; notam.sid_star_hits = []; notam.sid_star_hit_names = [];
        continue;
      }
      const procs = notamSidStarProcs(notam);
      notam.sid_star = procs;
      if (!procs.length) {
        notam.sid_star_hits = []; notam.sid_star_hit_names = [];
        continue;
      }
      const hits: N[] = [];
      const names: string[] = [];
      for (const flight of flights || []) {
        const ofp = String(t[flight.id] ?? "");
        const tokens = ofp ? fplTokens(ofp) : new Set<string>();
        const matched = sidStarHitsOf(notam, ofp, tokens);
        if (!matched.length) continue;
        let role = "";
        for (const [icao, raw] of flightAirfields(flight, ofp)) {
          if (icao === normIcao(code)) { role = raw; break; }
        }
        const ctx = buildTuneCtx(flight, ofp);
        if ((role === "DEP" || role === "ARR") && !rwyInFlightWin(notam, role, ctx)) continue;
        const cs = (flight.callsign || "").trim().toUpperCase();
        hits.push({ cs, procs: matched, id: flight.id, role });
        for (const proc of matched) if (!names.includes(proc)) names.push(proc);
      }
      notam.sid_star_hits = hits;
      notam.sid_star_hit_names = names;
      notam.head_vi = headVi(notam, code);
    }
  }
}

function applyTune(places: N[], ctx: TuneCtx): [Record<string, string>, number, number] {
  const dropped: Record<string, string> = {};
  let keepN = 0, dropN = 0;
  for (const place of places) {
    const code = String(place.code ?? "").toUpperCase();
    const notams = (place.notams as N[] | undefined) || [];
    notams.forEach((notam, i) => {
      if (!notam || typeof notam !== "object") return;
      const ident = String(notam.ident ?? "").trim() || `#${i}`;
      const reason = tuneWhy(notam, place, ctx);
      if (reason) { dropped[`${code}\t${ident}`] = reason; dropN++; }
      else keepN++;
    });
  }
  return [dropped, keepN, dropN];
}

function collectExtras(places: N[]) {
  const heads: Record<string, string> = {};
  const ofpMap: Record<string, string[]> = {};
  const sidMap: Record<string, N[]> = {};
  const sidProcs: Record<string, string[]> = {};
  for (const place of places || []) {
    const code = String(place.code ?? "").toUpperCase();
    const notams = (place.notams as N[] | undefined) || [];
    notams.forEach((notam, i) => {
      if (!notam || typeof notam !== "object") return;
      const ident = String(notam.ident ?? "").trim() || `#${i}`;
      const key = `${code}\t${ident}`;
      if (notam.head_vi) heads[key] = String(notam.head_vi);
      if ((notam.ofp_hits as string[] | undefined)?.length) ofpMap[key] = [...(notam.ofp_hits as string[])];
      if ((notam.sid_star_hits as N[] | undefined)?.length) sidMap[key] = [...(notam.sid_star_hits as N[])];
      if ((notam.sid_star as string[] | undefined)?.length) sidProcs[key] = [...(notam.sid_star as string[])];
    });
  }
  return { heads, ofpMap, sidMap, sidProcs };
}

export function tunePlaces(
  flight: Flight,
  places: N[],
  opts: { ofpText?: string; trackPoints?: Array<Record<string, unknown>> } = {},
): Record<string, unknown> {
  const ofpText = opts.ofpText ?? "";
  const trackPoints = opts.trackPoints ?? [];
  const loc = locationsOf(flight, ofpText);
  const [air, firs] = trackScope(flight, ofpText, places);
  const dep = loc.dep || normIcao(flight.dep_icao);
  let depFir = "";
  for (const place of places) {
    if (String(place.code ?? "").toUpperCase() === dep) {
      depFir = airportParentFir(dep, String(place.fir ?? ""));
      if (depFir) break;
    }
  }
  if (!depFir) depFir = airportParentFir(dep);
  const extra = buildTuneCtx(flight, ofpText);
  const tokens = new Set([...((extra.tokens as Set<string>) || []), ...extraOfpTokens(trackPoints)]);
  const ctx: TuneCtx = {
    mode: "track",
    keep_air: air,
    keep_fir: firs,
    points: trackPoints,
    std: flight.std || flight.etd || null,
    sta: flight.sta || flight.eta || null,
    fir_win: firWindows(flight, ofpText, depFir),
    dep: loc.dep || flight.dep_icao,
    arr: loc.arr || flight.dest_icao,
    cruise_fl: plannedFlOf(flight, ofpText),
    tokens,
    used: (extra.used as Set<string>) || new Set(),
  };
  const [dropped, keepN, dropN] = applyTune(places, ctx);
  stampSidStarHits(places, [flight], { [flight.id]: ofpText });
  stampOfpHeads(places, tokens, trackPoints);
  const { heads, ofpMap, sidMap, sidProcs } = collectExtras(places);
  return {
    ok: true,
    mode: "track",
    callsign: (flight.callsign || "").trim(),
    dep: ctx.dep || flight.dep_icao,
    dest: ctx.arr || flight.dest_icao,
    cruise_fl: ctx.cruise_fl || 0,
    kept: keepN,
    dropped,
    drop_n: dropN,
    keep_air: [...air].sort(),
    keep_fir: [...firs].sort(),
    heads,
    ofp_hits: ofpMap,
    sid_star_hits: sidMap,
    sid_star: sidProcs,
    ofp_tokens: [...tokens].sort(),
  };
}

export function tunePlacesDomestic(
  flights: Flight[],
  places: N[],
  opts: { ofpTexts?: Record<number, string>; dsp?: string } = {},
): Record<string, unknown> {
  const ofpTexts = opts.ofpTexts ?? {};
  const dsp = opts.dsp ?? "";
  const keepAir = domesticAirports(flights, ofpTexts);
  const ctx: TuneCtx = { mode: "domestic", keep_air: keepAir, keep_fir: new Set<string>(), points: [] };
  const [dropped, keepN, dropN] = applyTune(places, ctx);
  stampSidStarHits(places, flights, ofpTexts);
  const { heads, sidMap, sidProcs } = collectExtras(places);
  return {
    ok: true,
    mode: "domestic",
    callsign: dsp,
    dep: "",
    dest: "",
    cruise_fl: 0,
    kept: keepN,
    dropped,
    drop_n: dropN,
    keep_air: [...keepAir].sort(),
    keep_fir: [] as string[],
    heads,
    sid_star_hits: sidMap,
    sid_star: sidProcs,
  };
}
