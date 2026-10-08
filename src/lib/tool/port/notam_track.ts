import { parseEetFirTimes, flightAirfields as tuneAirfields } from "./notam_check_tune";
import AIP_CATALOG from "./aip_catalog.json";
// Port of notam_track.py — đối chiếu NOTAM 24H với track KML: toạ độ, FL, FIR, giờ.
// Scope note (see final report): the AIP/SUA/ENR/DAH polygon gazetteer (aip_sua.py,
// aip_jp.py, aip_sup.py, aip_lookup.ring) and the JetPlan KML fetch (jetplan_kml.py)
// are NOT ported here (separate un-ported modules, out of this task's scope). Geometry
// extraction therefore only covers Q-line/E-field coordinates (iterLatLon, q coords,
// bearing/distance, radius/center) — NOTAM that only name a published area without
// coordinates in the text are skipped exactly like the original would without its
// AIP catalog (no fabricated shapes). Track points come from an injected fetcher the
// handler supplies; with no KML port the handler reports an explicit error and this
// module degrades distance to `null` ("không tính được") instead of faking 0/huge NM.
import type { Flight } from "../core/models";

export const EARTH_NM = 3440.065;
export const CORRIDOR_NM = 10.0;
export const Q_FIR_RADIUS_NM = 80.0;
export const E_CIRCLE_MAX_NM = 400.0;
export const ETA_PAD_H = 2.0;
const BRG_DEFAULT_NM = 5.0;

export type Pt = [number, number];
export interface Geom {
  name: string;
  shape: "polygon" | "circle" | "dot" | "line";
  ring: Pt[];
  lat?: number;
  lon?: number;
  radius_nm?: number;
  source?: string;
  lo?: number;
  hi?: number;
  windows?: { fm: string; to: string; lo: number; hi: number }[];
}
export type Notam = Record<string, unknown>;
export type Place = Record<string, unknown>;
export interface TrackPoint {
  lat: number;
  lon: number;
  fl_ft?: number;
  ete_min?: number;
  name?: string;
  fir?: string;
  eta?: string;
  eta_z?: string;
}
export interface Track {
  plan: string;
  via: string;
  points: TrackPoint[];
  line: unknown[];
}

const _NO_FLY_SUBJ = new Set([
  "RA", "RD", "RM", "RO", "RP", "RR", "RT",
  "WR", "WM", "WE", "WU", "WP", "WV", "WA", "WB", "WC", "WG", "WH", "WL",
]);
const _CLOSED_COND = new Set(["CA", "LC", "AJ"]);
const _OBST_GONE_COND = new Set(["AW"]);
const _FIRE_WORDS = ["ROCKET", "GUN FIR", "LIVE FIR", "ARTILLERY", "MISSILE", "FIRING RANGE", "WEAPON FIR"];
const _AREA_WORDS = [
  "DANGER AREA", "RESTRICTED AREA", "PROHIBITED AREA", "TEMPO RESTRICTED", "TEMPORARY RESTRICTED",
  "RESTRICTED WI", "NO FLY", "NO-FLY", "P-AREA", "R-AREA", "D-AREA", "TEMPO SEGREG",
  "SPECIAL USE AIRSPACE", "AIRSPACE RESERVATION", "AIRSPACE BLOCKED", "AIRSPACE BLOCK",
  "OPERATIONS ARE PROHIBITED", "OVERFLYING OF PROHIBITED", "PROHIBITED WITHIN",
  "RAINMAKING", "CLOUD SEED", "AIRSPACE USE PLAN", "AMC-MANAGEABLE", "TSA/TRA",
  "UNMANNED ACFT", "UAV", "UAS", "DRONE", "RPAS", "TRAINING AREA", "TEMPO TRAINING",
  "FRNG EXER", "CARGO DROP", "PARACHUT", "GROUP FLT", "FORMATION",
  "FREE BALLOON", "HEAVY BALLOON", "BALLOON RELEAS", "HAPS", "CAPTIVE BALLOON", "KITE",
];
const _OPERATOR_POLICY = new RegExp(
  "(?:NOT\\s+(?:AVBL|AVAILABLE)\\s+FOR.{0,60}REGISTERED\\s+(?:ACFT|AIRCRAFT)" +
    "|REGISTERED\\s+(?:ACFT|AIRCRAFT).{0,80}(?:NOT\\s+(?:AVBL|AVAILABLE)|PROHIBITED)" +
    "|OPERATED\\s*/\\s*OWNED\\s+OR\\s+LEASED\\s+BY" +
    "|(?:AIRLINES?|OPERATORS)\\s+INCLUDING\\s+MILITARY\\s+FLIGHTS)",
  "is",
);
const _ROUTE_ADVISORY = new RegExp(
  "(?:ENCOURAGED\\s+TO\\s+FPL\\s+VIA" +
    "|IN\\s+ADDN\\s+TO\\s+RTE\\s+AVBL" +
    "|ATS\\s+RTE\\s+[A-Z0-9]+\\s+.{0,80}ALSO\\s+AVBL" +
    "|TFC\\s+CONGESTION\\s+EXP" +
    "|RE[\\s\\-]?RTE\\s+DYNAMICALLY" +
    "|\\bPACOTS\\b" +
    "|\\bFLEX\\s+ROUTE\\b" +
    "|\\bNAR\\s+ROUTE\\b)",
  "is",
);
const _CLOSED_WORDS = ["CLSD", "CLOSED", "PROHIBITED", "NOT AVBL FOR ACFT", "ENTRY PROHIBITED", "ACFT PROHIBITED"];

const _COORD = /(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?/i;
const _LL =
  /(?<!\d)(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?\s*([NS])\s*(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)?\s*([EW])/i;
const _LL_COMPACT = /(?<!\d)(\d{4,6}\.\d+)([NS])\s+(?<!\d)(\d{5,7}\.\d+)([EW])/i;
const _LL_HYP = /(\d{2})-(\d{2}(?:\.\d+)?)([NS])\s+(\d{3})-(\d{2}(?:\.\d+)?)([EW])/i;
const _RADIUS_NM = /(?:RADIUS(?:\s+OF)?|\bRAD\b|WI)\s*(\d+(?:\.\d+)?)\s*(NM|KM|METERS?|METRES?|FEET|FT|M)\b(?:\s+RAD(?:IUS)?)?/i;
const _RADIUS_NM_TRAIL = /(\d+(?:\.\d+)?)\s*(NM|KM|METERS?|METRES?|FEET|FT|M)\s+RADIUS\b/i;
const _CENTER_AT = /\bCENT(?:ERED|RED|ER|RE)(?:\s+ON)?\b/gi;
const _Q_LINE = /Q\)[A-Z]{4}\/Q([A-Z]{4})/i;
const _BRG_DIST =
  /(?:BRG|BEARING|RDL|RADIAL)\s*(\d{1,3})(?:\s*(?:DEG(?:REES?)?|MAG|T|TRUE))?.{0,50}?(?:DIST(?:ANCE)?)\s*(\d+(?:\.\d+)?)\s*(NM|KM)?.{0,40}?(?:FM|FROM)\s+([A-Z]{2,5})(?:\s+(?:NDB|VOR|DME|VORTAC|TACAN|FIX|VORDME))?/is;
const _DIST_BRG =
  /(?:DIST(?:ANCE)?)\s*(\d+(?:\.\d+)?)\s*(NM|KM)?.{0,40}?(?:FM|FROM)\s+([A-Z]{2,5}).{0,50}?(?:BRG|BEARING|RDL|RADIAL)\s*(\d{1,3})/is;
const _RDL_SLASH = /(?:RDL|RADIAL)\s*(\d{1,3})\s*\/\s*(\d+(?:\.\d+)?)\s*(NM|KM)?\s+(?:FM\s+|FROM\s+)?([A-Z]{2,5})/i;
const _FL = /FL\s*(\d{2,3})/i;
const _FT = /(\d{3,5})\s*FT\b/i;
const _ICAO_CC =
  "(?:RK|RJ|RO|RP|RC|VV|WM|WS|WB|WI|WA|VT|VH|VG|VE|VA|VO|VI|ZG|ZB|ZH|ZL|ZY|ZJ|ZS|ZW|ZK)";
const _ICAO_DRP = new RegExp(`\\b(${_ICAO_CC})\\s*[-/]?\\s*\\(?\\s*([DRP])\\s*\\)?\\s*[-/]?\\s*(\\d{1,4}[A-Z]?)(?:\\s*/\\s*(\\d{1,4}[A-Z]?))?\\b`, "gi");
const _AREA_PREFIX =
  "JSDF|VVD|VVR|VVP|VGD|VGR|VGP|VED|VEP|VEF|VER|VAD|VAR|VAP|VID|VIR|VIP|VOD|VOR|VOP|" +
  "VTD|VTR|VTP|VHD|VHR|VHP|WMD|WMR|WMP|WSD|WSR|WSP|WBD|WBR|WBP|WAR|WAD|WAP|WIR|WID|WIP|" +
  "RJD|RJR|RJP|RKD|RKR|RKP|RPD|RPR|RPP|ZBD|ZBR|ZBP";
const _AREA_ID = new RegExp(`\\b((?:${_AREA_PREFIX})[-\\s]?\\d{1,4}(?:[A-Z]?)(?:/\\d{1,4})?)\\b`, "gi");

function toLL(latd: number, latm: number, lats: number, ns: string, lond: number, lonm: number, lons: number, ew: string): Pt {
  let lat = latd + latm / 60 + lats / 3600;
  if (ns.toUpperCase() === "S") lat = -lat;
  let lon = lond + lonm / 60 + lons / 3600;
  if (ew.toUpperCase() === "W") lon = -lon;
  return [lat, lon];
}

function destPoint(lat: number, lon: number, brgDeg: number, distNm: number): Pt {
  const rlat = (lat * Math.PI) / 180, rlon = (lon * Math.PI) / 180, brg = (brgDeg * Math.PI) / 180;
  const ang = distNm / EARTH_NM;
  const lat2 = Math.asin(Math.sin(rlat) * Math.cos(ang) + Math.cos(rlat) * Math.sin(ang) * Math.cos(brg));
  const lon2 = rlon + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(rlat), Math.cos(ang) - Math.sin(rlat) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, (((lon2 * 180) / Math.PI + 540) % 360) - 180];
}

function toNm(val: number, unit: string | undefined): number {
  const u = (unit || "NM").toUpperCase();
  if (u.startsWith("KM")) return val / 1.852;
  if (u.startsWith("FT") || u === "FEET") return val / 6076.12;
  if (u === "M" || u.startsWith("METER") || u.startsWith("METRE")) return val / 1852;
  return val;
}

export function iterLatLon(text: string): Pt[] {
  const out: Pt[] = [];
  const seen = new Set<string>();
  const add = (lat: number, lon: number) => {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (seen.has(key)) return;
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return;
    seen.add(key);
    out.push([lat, lon]);
  };
  const raw = String(text || "").replace(/^Q\).*$/gm, "");
  for (const m of raw.matchAll(new RegExp(_LL_COMPACT, "gi"))) {
    const [latNum, ns, lonNum, ew] = [m[1], m[2], m[3], m[4]];
    try {
      const [latd, latm, lats] = splitCompact(latNum, true);
      const [lond, lonm, lons] = splitCompact(lonNum, false);
      add(...toLL(latd, latm, lats, ns, lond, lonm, lons, ew));
    } catch { /* skip */ }
  }
  for (const m of raw.matchAll(new RegExp(_LL, "gi"))) {
    const [latd, latm, lats, ns, lond, lonm, lons, ew] = [m[1], m[2], m[3] ?? "0", m[4], m[5], m[6], m[7] ?? "0", m[8]];
    if (+latm >= 60 || +lats >= 60 || +lonm >= 60 || +lons >= 60) continue;
    add(...toLL(+latd, +latm, +lats, ns, +lond, +lonm, +lons, ew));
  }
  for (const m of raw.matchAll(new RegExp(_LL_HYP, "gi"))) {
    const [latd, latm, ns, lond, lonm, ew] = [m[1], m[2], m[3], m[4], m[5], m[6]];
    if (+latm >= 60 || +lonm >= 60) continue;
    add(...toLL(+latd, +latm, 0, ns, +lond, +lonm, 0, ew));
  }
  for (const m of raw.matchAll(/(?<!\d)(\d{2})\s+(\d{2})\s+(\d{2}(?:\.\d+)?)?\s*([NS])\s+(\d{2,3})\s+(\d{2})\s+(\d{2}(?:\.\d+)?)?\s*([EW])/gi)) {
    if (+m[2] >= 60 || +(m[3] || 0) >= 60 || +m[6] >= 60 || +(m[7] || 0) >= 60) continue;
    add(...toLL(+m[1], +m[2], +(m[3] || 0), m[4], +m[5], +m[6], +(m[7] || 0), m[8]));
  }
  for (const m of raw.matchAll(/([NS])(\d{4}(?:\d{2}(?:\.\d+)?)?)\s*([EW])(\d{5}(?:\d{2}(?:\.\d+)?)?)/gi)) {
    try {
      const [a, b, c] = splitCompact(m[2], true), [d, e, f] = splitCompact(m[4], false);
      add(...toLL(a, b, c, m[1], d, e, f, m[3]));
    } catch { /* invalid position */ }
  }
  return out;
}

function splitCompact(num: string, isLat: boolean): [number, number, number] {
  let whole: string, fracS: string;
  if (num.includes(".")) [whole, fracS] = num.split(".", 2);
  else { whole = num; fracS = ""; }
  let d: string, m: string, s: string;
  if (isLat) {
    if (whole.length === 5) whole = whole.padStart(6, "0");
    if (whole.length === 6) [d, m, s] = [whole.slice(0, 2), whole.slice(2, 4), whole.slice(4, 6)];
    else if (whole.length === 4) [d, m, s] = [whole.slice(0, 2), whole.slice(2, 4), "0"];
    else throw new Error(num);
  } else {
    if (whole.length === 7) [d, m, s] = [whole.slice(0, 3), whole.slice(3, 5), whole.slice(5, 7)];
    else if (whole.length === 5) [d, m, s] = [whole.slice(0, 3), whole.slice(3, 5), "0"];
    else if (whole.length === 6) {
      const deg3 = +whole.slice(0, 3), minDD = +whole.slice(2, 4);
      if (deg3 > 180 || (deg3 < 100 && minDD < 60)) [d, m, s] = [whole.slice(0, 2), whole.slice(2, 4), whole.slice(4, 6)];
      else [d, m, s] = [whole.slice(0, 3), whole.slice(3, 4), whole.slice(4, 6)];
    }
    else throw new Error(num);
  }
  if (fracS) s = `${parseInt(s, 10)}.${fracS}`;
  if (+m >= 60 || +s >= 60) throw new Error(num);
  return [+d, +m, +s];
}

export function parseCoords(raw: unknown): [number, number, number] | null {
  const text = String(raw ?? "").replace(/\s+/g, "");
  const m = _COORD.exec(text);
  if (!m) return null;
  if (m.index > 0 && /\d/.test(text[m.index - 1] ?? "")) return null;
  let lat = parseInt(m[1]!, 10) + parseInt(m[2]!, 10) / 60;
  if (m[3]!.toUpperCase() === "S") lat = -lat;
  let lon = parseInt(m[4]!, 10) + parseInt(m[5]!, 10) / 60;
  if (m[6]!.toUpperCase() === "W") lon = -lon;
  const radius = m[7] ? parseFloat(m[7]) : 0;
  return [lat, lon, radius];
}

export function qCoordsOf(notam: Notam): [number, number, number] | null {
  const field = parseCoords(notam.coords);
  const blob = `${notam.text ?? ""}\n${notam.e_field ?? ""}`;
  let qHit: [number, number, number] | null = null;
  for (const line of blob.split("\n")) {
    if (line.trim().toUpperCase().startsWith("Q)")) {
      qHit = parseCoords(line);
      if (qHit) break;
    }
  }
  if (qHit === null) qHit = parseCoords(blob);
  if (field && qHit) {
    if ((field[2] || 0) <= 0 && (qHit[2] || 0) > 0) return qHit;
    return field;
  }
  return field || qHit;
}

function eRadiusNm(text: string): number | null {
  const raw = String(text || "");
  for (const rx of [_RADIUS_NM, _RADIUS_NM_TRAIL]) {
    for (const m of raw.matchAll(new RegExp(rx, "gi"))) {
      const start = Math.max(0, m.index! - 12);
      const prefix = raw.slice(start, m.index).toUpperCase();
      if (prefix.includes("DIST")) continue;
      return toNm(parseFloat(m[1]!), m[2]);
    }
  }
  return null;
}

function eCenter(text: string): Pt | null {
  const raw = String(text || "").replace(/^Q\).*$/gm, "");
  for (const m of raw.matchAll(_CENTER_AT)) {
    const pts = iterLatLon(raw.slice(m.index! + m[0].length, m.index! + m[0].length + 80));
    if (pts.length) return pts[0] ?? null;
  }
  return null;
}

function eCircleGeom(blob: string, ids: string[]): Geom | null {
  const center = eCenter(blob);
  if (center === null) return null;
  const extra = eRadiusNm(blob);
  if (extra === null || extra <= 0 || extra >= E_CIRCLE_MAX_NM) return null;
  let name = "";
  for (const ident of ids) {
    if (/^RK[PR]-/i.test(ident)) { name = ident; break; }
  }
  if (!name && ids.length) name = ids[0]!;
  return { name, shape: "circle", lat: center[0], lon: center[1], radius_nm: extra, ring: [], source: "e-field" };
}

function parseBrgDist(text: string): { brg: number; dist_nm: number; fix: string } | null {
  const raw = String(text || "").replace(/^Q\).*$/gm, "");
  const m = _BRG_DIST.exec(raw) || _DIST_BRG.exec(raw) || _RDL_SLASH.exec(raw);
  if (!m) return null;
  let brg: number, dist: number, unit: string | undefined, fix: string;
  if (m === _BRG_DIST.exec(raw)) { brg = +m[1]! % 360; dist = toNm(+m[2]!, m[3]); fix = (m[4] || "").toUpperCase(); }
  else if (_DIST_BRG.test(raw) && m.length === 5 && /^\d/.test(m[1] || "")) { dist = toNm(+m[1]!, m[2]); fix = (m[3] || "").toUpperCase(); brg = +m[4]! % 360; }
  else { brg = +m[1]! % 360; dist = toNm(+m[2]!, m[3]); fix = (m[4] || "").toUpperCase(); }
  if (dist <= 0 || dist > 500) return null;
  return { brg, dist_nm: dist, fix };
}

function brgGeom(text: string, origin: [number, number, number] | null): Geom | null {
  const spec = parseBrgDist(text);
  if (!spec || !origin) return null;
  const [lat, lon] = destPoint(origin[0], origin[1], spec.brg, spec.dist_nm);
  let rad = eRadiusNm(text);
  if (rad === null) rad = BRG_DEFAULT_NM;
  const brg = Math.round(spec.brg);
  const dist = spec.dist_nm;
  const distS = Math.abs(dist - Math.round(dist)) < 0.05 ? String(Math.round(dist)) : String(dist);
  return {
    name: `${spec.fix} BRG${brg}/${distS}NM`, shape: "circle", lat, lon, radius_nm: rad, ring: [], source: "brg",
  };
}

export function namedAreaIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const blob = String(text || "");
  for (const m of blob.matchAll(new RegExp(_AREA_ID, "gi"))) {
    const body = m[1]!.replace(/\s+/g, "").toUpperCase();
    const slash = /^([A-Z]{3,4})-?(\d{1,4})(?:\/(\d{1,4}))?([A-Z]?)$/.exec(body);
    if (!slash) continue;
    const [, prefix, a, b, suf] = slash;
    for (const num of [a, b]) {
      if (!num) continue;
      const key = `${prefix}-${num}${suf || ""}`;
      if (!seen.has(key)) { seen.add(key); out.push(key); }
    }
  }
  for (const m of blob.toUpperCase().matchAll(_ICAO_DRP)) {
    const [, cc, kind, a, b] = m;
    for (const num of [a, b]) {
      if (!num) continue;
      const key = `${cc}${kind}-${num}`;
      if (!seen.has(key)) { seen.add(key); out.push(key); }
    }
  }
  return out;
}

/** AIP SUP numbers referenced by a NOTAM: "AIP SUP 055/26", "SUP H141/26", "AIP SUPPLEMENT 12/26". */
export function supKeys(blob: string): string[] {
  const out: string[] = [];
  const re = /\b(?:AIP\s+)?SUP(?:PLEMENT)?\s*(?:NR\.?|NO\.?)?\s*([A-Z]?)\s*(\d{1,3})\s*\/\s*(\d{2})\b/gi;
  for (const m of String(blob || "").matchAll(re)) {
    const norm = `${(m[1] || "").toUpperCase()}${Number(m[2])}/${m[3]}`;
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

// Public entry: geometry list for a NOTAM. Shapes from the text come first; when the
// text has no polygon, rings resolved beforehand from AIP SUP / DAH (handler attaches
// them as `sup_geoms`, see aip_sup.server.ts) are used — never fabricated.
function catalogId(raw: string): string {
  const s = raw.toUpperCase().replace(/[\s_]+/g, "");
  const m = s.replace(/[^A-Z0-9]+/g, "").match(/^([A-Z]{3,4})(\d{1,4}[A-Z]?)$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

/** Vùng đã công bố trong AIP/AIP SUP (danh mục gốc notam_track.py) — NOTAM gọi tên thì vẽ đúng hình. */
export function catalogGeoms(blob: string): Geom[] {
  const u = blob.toUpperCase();
  const out: Geom[] = [];
  const seen = new Set<string>();
  const rings = AIP_CATALOG.rings as unknown as Record<string, [number, number][]>;
  const circles = AIP_CATALOG.circles as unknown as Record<string, [number, number, number]>;
  for (const key of [...Object.keys(rings), ...Object.keys(circles)].sort((a, b) => b.length - a.length)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "\\s*-?\\s*");
    const re = new RegExp(`(?<![A-Z0-9-])${esc}(?![A-Z0-9]|-[A-Z])`);
    if (!re.test(u) || seen.has(catalogId(key))) continue;
    if ([...seen].some((k) => k.startsWith(key + "-"))) continue;
    seen.add(catalogId(key));
    if (rings[key]) out.push({ name: key, shape: "polygon", ring: rings[key], source: "aip" } as Geom);
    else { const [lat, lon, r] = circles[key]!; out.push({ name: key, shape: "circle", lat, lon, radius_nm: r, ring: [], source: "aip" } as unknown as Geom); }
  }
  return out;
}

export function notamGeoms(notam: Notam): Geom[] {
  const catBlob = `${String(notam.text ?? "")}\n${String(notam.e_field ?? "")}`;
  const cat = catalogGeoms(catBlob);
  const own = notamGeomsText(notam);
  const sup = [...cat, ...((notam.sup_geoms as Geom[] | undefined) ?? [])];
  const blob = `${String(notam.text ?? "")}\n${String(notam.e_field ?? "")}`;
  const ids = namedAreaIds(blob).concat([...blob.toUpperCase().matchAll(/\b((?:ITRA|LION|MOOSE|TIGER|EAGLE|EDIX)(?:-[A-Z0-9]+)+)\b/g)].map((m) => m[1]!));
  if (cat.length) return sup.filter((g, i) => sup.findIndex((x) => x.name === g.name) === i);
  if (sup.length && ids.length) {
    // NOTAM gọi tên vùng (LION-…, ITRA-…) có trong AIP SUP → ưu tiên vòng SUP, bỏ vòng tự dựng.
    const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const want = new Set(ids.map(norm));
    const named = sup.filter((g) => [...want].some((w) => norm(g.name).includes(w)));
    if (named.length) return named;
    // SUP không có đúng tên vùng mà NOTAM đã tự cho đủ toạ độ → dùng hình của NOTAM.
    if (own.some((g) => g.shape === "polygon" || g.shape === "line")) return own;
    return sup;
  }
  if (sup.length && !own.some((g) => g.shape === "polygon" || g.shape === "line")) {
    return [...sup, ...own.filter((g) => g.shape !== "dot")];
  }
  return own;
}

// "THE LINE CONNECTING A TO B IS THE MINOR ARC WITH A RADIUS OF 50NM FM C" — cạnh A→B
// của polygon là cung tròn tâm C, không phải đỉnh C. Câu này bị tách khỏi danh sách đỉnh.
const _LLS = String.raw`\d{4,6}(?:\.\d+)?\s*[NS]\s*\d{5,7}(?:\.\d+)?\s*[EW]`;
const _ARC_STMT = new RegExp(
  String.raw`(?:THE\s+)?(?:LINE|BOUNDARY|SIDE)\s+(?:CONNECTING|BTN|BETWEEN)\s+(${_LLS})\s+(?:TO|AND)\s+(${_LLS})\s*,?\s*IS\s+(?:THE\s+|AN?\s+)?(MINOR|MAJOR|CLOCKWISE|COUNTER[-\s]?CLOCKWISE|ANTI[-\s]?CLOCKWISE)?\s*ARC\s+(?:WITH\s+)?(?:A\s+)?(?:RADIUS\s+(?:OF\s+)?)?(\d+(?:\.\d+)?)\s*(NM|KM)\s*(?:RADIUS\s+)?(?:FM|FROM|CENT(?:ERED|RED)\s+(?:ON|AT)|AROUND)\s+(${_LLS})\.?`,
  "gi",
);
// "B THEN ALONG CLOCKWISE ARC OF CIRCLE OF RADIUS 40.5NM CENTERED AT C TO [POINT X] D"
const _ARC_ALONG = new RegExp(
  String.raw`(${_LLS})\s*,?\s*(?:THEN\s+)?(?:ALONG\s+)?(?:THE\s+|AN?\s+)?(MINOR|MAJOR|CLOCKWISE|COUNTER[-\s]?CLOCKWISE|ANTI[-\s]?CLOCKWISE)?\s*ARC\s+(?:OF\s+(?:A\s+)?CIRCLE\s+)?(?:WITH\s+)?(?:OF\s+)?(?:A\s+)?RADIUS\s+(?:OF\s+)?(\d+(?:\.\d+)?)\s*(NM|KM)\s*,?\s*(?:CENT(?:ERED|RED|RE)\s+(?:ON|AT)|FM|FROM)\s+(${_LLS})\s*,?\s*TO\s+(?:POINT\s+[A-Z0-9]+\s+)?(${_LLS})`,
  "gi",
);
interface ArcSpec { a: Pt; b: Pt; c: Pt; kind: string; rad: number }
function brgOf(c: Pt, p: Pt): number {
  const [p1, l1, p2, l2] = [c[0], c[1], p[0], p[1]].map((d) => (d * Math.PI) / 180);
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function arcPoints(spec: ArcSpec, from: Pt, to: Pt): Pt[] {
  const b0 = brgOf(spec.c, from), b1 = brgOf(spec.c, to);
  const cw = (b1 - b0 + 360) % 360; // độ quét theo chiều kim đồng hồ
  const k = spec.kind.toUpperCase().replace(/[-\s]/g, "");
  let sweep: number; // dương = CW, âm = CCW
  if (k === "CLOCKWISE") sweep = cw;
  else if (k === "COUNTERCLOCKWISE" || k === "ANTICLOCKWISE") sweep = cw - 360;
  else if (k === "MAJOR") sweep = cw >= 180 ? cw : cw - 360;
  else sweep = cw <= 180 ? cw : cw - 360; // MINOR / mặc định
  const r0 = nmDist(spec.c[0], spec.c[1], from[0], from[1]);
  const r1 = nmDist(spec.c[0], spec.c[1], to[0], to[1]);
  const steps = Math.max(4, Math.ceil(Math.abs(sweep) / 4));
  const out: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    out.push(destPoint(spec.c[0], spec.c[1], b0 + sweep * t, spec.rad > 0 ? spec.rad : r0 + (r1 - r0) * t));
  }
  return out;
}
function extractArcs(raw: string): { text: string; arcs: ArcSpec[] } {
  const arcs: ArcSpec[] = [];
  const text = raw.replace(_ARC_STMT, (_m, a: string, b: string, kind: string | undefined, rad: string, unit: string, c: string) => {
    const pa = iterLatLon(a)[0], pb = iterLatLon(b)[0], pc = iterLatLon(c)[0];
    if (pa && pb && pc) arcs.push({ a: pa, b: pb, c: pc, kind: kind || "MINOR", rad: toNm(+rad, unit) });
    return " ";
  }).replace(_ARC_ALONG, (_m, a: string, kind: string | undefined, rad: string, unit: string, c: string, b: string) => {
    const pa = iterLatLon(a)[0], pb = iterLatLon(b)[0], pc = iterLatLon(c)[0];
    if (pa && pb && pc) arcs.push({ a: pa, b: pb, c: pc, kind: kind || "MINOR", rad: toNm(+rad, unit) });
    return ` ${a} ${b} `;
  });
  return { text, arcs };
}
const samePt = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4;
function applyArcs(ring: Pt[], arcs: ArcSpec[]): Pt[] {
  if (!arcs.length || ring.length < 2) return ring;
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    out.push(p);
    const fwd = arcs.find((s) => samePt(s.a, p) && samePt(s.b, q));
    const rev = fwd ? undefined : arcs.find((s) => samePt(s.b, p) && samePt(s.a, q));
    if (fwd) out.push(...arcPoints(fwd, p, q));
    else if (rev) out.push(...arcPoints(rev, q, p).reverse());
  }
  return out;
}

/** The original parse_areas order: radius sites, deployment points, separate boundaries. */
export function parseAreas(text: string): Geom[] {
  const raw = text.replace(/^\s*Q\).*$/gim, '');
  const pts = iterLatLon(raw);
  const boundary = /BOUNDED|JOINING|STRAIGHT\s+LINES|\bWI\s+AREA\b|\bALONG\b|\bPOLYGON\b/i.test(raw);
  const rad = /\bARC\b/i.test(raw) ? null : eRadiusNm(raw);
  if (!boundary && /\bRAD(?:IUS)?\b/i.test(raw) && rad !== null && rad > 0 && rad < E_CIRCLE_MAX_NM && pts.length >= 2) {
    return pts.map(([lat, lon]) => ({ name: '', shape: 'circle', lat, lon, radius_nm: rad, ring: [], source: 'e-field' }));
  }
  if (!boundary && !/\d{4,7}\s*[NS]\s*\d{5,8}\s*[EW]\s*-\s*\d{4,7}\s*[NS]/i.test(raw)) {
    const dots: Geom[] = [];
    for (const m of raw.matchAll(/\(\s*(\d+)\s*\)\s*([A-Z][A-Z0-9][A-Z0-9 \-/.']{0,48}?)\s*:\s*(\d{4,7}\s*[NS]\s*\d{5,8}\s*[EW])/gi)) {
      if (/^PLACE\b/i.test(m[2])) break;
      const p = iterLatLon(m[3])[0];
      if (p) dots.push({ name: m[2].trim(), shape: 'dot', lat: p[0], lon: p[1], radius_nm: 0, ring: [], source: 'e-field' });
    }
    if (dots.length >= 2) return dots;
  }
  const chunks = raw.split(new RegExp(`(?=(?:AREA|DANGER AREA|RESTRICTED AREA|PROHIBITED AREA)\\s+[A-Z]{2,4}[-\\s]?\\d{1,4}|(?:AREA\\s+)?(?:${_AREA_PREFIX})[-\\s]?\\d{1,4})`, 'i'));
  const pieces = chunks.length > 1 ? chunks : raw.split(/(?=\(\s*\d+\s*\)\s*PLACE\s*:)/i);
  const out: Geom[] = [];
  for (const piece of pieces) {
    const { text: clean, arcs } = extractArcs(piece);
    // Strip only explicit arc centers, never every coordinate following FM/FROM.
    const hubs: Pt[] = [];
    for (const m of piece.matchAll(/(?:ARC|RADIUS)[\s\S]{0,100}?(?:FM|FROM|CENT(?:ERED|RED|RE)\s+ON)\s*(\d{4,6}(?:\.\d+)?\s*[NS]\s*\d{5,7}(?:\.\d+)?\s*[EW])/gi)) {
      const p = iterLatLon(m[1])[0]; if (p) hubs.push(p);
    }
    const flat = iterLatLon(clean).filter(p => !hubs.some(h => samePt(p, h)));
    const line = /\bALONG\b|\bEITHER\s+SIDE\s+OF\s+A\s+LINE\b/i.test(clean);
    // Nhiều vùng liệt kê liền nhau: mỗi vùng đóng lại khi quay về điểm đầu của nó.
    const rings: Pt[][] = [];
    let cur: Pt[] = [];
    for (const p of flat) {
      if (!line && cur.length >= 3 && samePt(p, cur[0]!)) { rings.push(cur); cur = []; continue; }
      cur.push(p);
    }
    if (cur.length) rings.push(cur);
    if (process.env.DBG) console.log(flat.length, rings.map(r=>r.length), hubs);
    const place = /\(\s*(\d+)\s*\)\s*PLACE\s*:/i.exec(piece);
    const name = namedAreaIds(piece)[0] || (place ? `PLACE ${Number(place[1])}` : '');
    for (const r0 of rings) {
      const ring = applyArcs(r0, arcs);
      if (ring.length < (line ? 2 : 3)) continue;
      out.push({ name, shape: line ? 'line' : 'polygon', ring, source: 'e-field' });
    }
  }
  return out;
}

function notamGeomsText(notam: Notam): Geom[] {
  const tx = String(notam.text ?? "");
  const ef = String(notam.e_field ?? "");
  const blob = `${tx}\n${ef}`;
  const areas: Geom[] = parseAreas(ef) || [];
  if (!areas.length) areas.push(...parseAreas(tx));
  const { text: raw, arcs } = extractArcs(blob.replace(/^Q\).*$/gm, ""));
  const along = /\bALONG\b/i.test(raw);
  const ring = applyArcs(iterLatLon(raw), arcs);
  if (!areas.length && ring.length >= 3 && !along) areas.push({ name: "", shape: "polygon", ring, source: 'e-field' });
  else if (!areas.length && ring.length >= 2 && along) areas.push({ name: "", shape: "line", ring, source: 'e-field' });
  const ids = namedAreaIds(blob);
  const origin = qCoordsOf(notam);
  const point = brgGeom(blob, origin);
  if (point) areas.push(point);
  const eCirc = arcs.length ? null : eCircleGeom(blob, ids);
  if (eCirc !== null) return [eCirc];
  if (areas.length) return areas;
  const extra = eRadiusNm(blob);
  const center = eCenter(blob);
  if (extra !== null && extra >= E_CIRCLE_MAX_NM) return [];
  if (extra !== null && extra >= Q_FIR_RADIUS_NM && center === null) return [];
  if (extra !== null && (center || origin)) {
    const [lat, lon] = center ? center : [origin![0], origin![1]];
    return [{ name: "", shape: "circle", lat, lon, radius_nm: extra, ring: [] }];
  }
  if (extra !== null) {
    const pts = iterLatLon(blob);
    if (pts.length) return [{ name: "", shape: "circle", lat: pts[0]![0], lon: pts[0]![1], radius_nm: extra, ring: [] }];
  }
  const sites = iterLatLon(ef || tx);
  if (sites.length > 0 && sites.length <= 2) {
    const drift = /FLOATING\s+DISTANCE\s*:?\s*(\d+(?:\.\d+)?)\s*(KM|NM|M)\b/i.exec(blob);
    const radius = drift ? toNm(+drift[1], drift[2]) : 0;
    return sites.map(([lat, lon]) => ({ name: '', shape: radius > 0 ? 'circle' : 'dot', lat, lon, radius_nm: radius, ring: [], source: 'e-field' }));
  }
  if (origin) {
    const rad = extra ?? origin[2] ?? 0;
    if (rad >= Q_FIR_RADIUS_NM) return [];
    if (rad > 0) return [{ name: "", shape: "circle", lat: origin[0], lon: origin[1], radius_nm: rad, ring: [] }];
    return [{ name: "", shape: "dot", lat: origin[0], lon: origin[1], radius_nm: 0, ring: [], source: "pin" }];
  }
  return [];
}

function ftOf(raw: unknown, def: number | null = null): number | null {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text || ["UNL", "UNLIM", "UNLIMITED", "PERM"].includes(text)) return def;
  if (["SFC", "GND", "GROUND", "MSL"].includes(text)) return 0;
  const fl = _FL.exec(text);
  if (fl) return parseInt(fl[1]!, 10) * 100;
  const ft = _FT.exec(text);
  if (ft) return parseInt(ft[1]!, 10);
  const digits = text.replace(/\D/g, "");
  if (digits) { const val = parseInt(digits, 10); return val < 1000 ? val * 100 : val; }
  return def;
}

export function notamAltBand(notam: Notam): [number, number] {
  let lo: number | null = null, hi: number | null = null;
  const fFt = ftOf(notam.f_field);
  const gFt = ftOf(notam.g_field);
  if (fFt !== null) lo = fFt;
  if (gFt !== null) hi = gFt;
  if (lo === null && notam.lower != null && notam.lower !== "") { const n = Number(notam.lower); if (!Number.isNaN(n)) lo = n * 100; }
  if (hi === null && notam.upper != null && notam.upper !== "") { const n = Number(notam.upper); if (!Number.isNaN(n)) hi = n * 100; }
  return [lo ?? 0, hi ?? 99999];
}

export function flOverlap(flFt: number, lo: number, hi: number, padFt = 500): boolean {
  if (hi < lo) [lo, hi] = [hi, lo];
  return lo - padFt <= flFt && flFt <= hi + padFt;
}

function hasPhrase(blob: string, needle: string): boolean {
  if (/[^A-Z0-9]/.test(needle)) return blob.includes(needle);
  return new RegExp(`(?<![A-Z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Z0-9])`).test(blob);
}

export function isOperatorPolicy(notam: Notam): boolean {
  const blob = ["subject", "condition", "text", "e_field"].map((k) => String(notam[k] ?? "")).join(" ");
  return _OPERATOR_POLICY.test(blob);
}
export function isRouteAdvisory(notam: Notam): boolean {
  const blob = ["subject", "condition", "text", "e_field"].map((k) => String(notam[k] ?? "")).join(" ");
  return _ROUTE_ADVISORY.test(blob);
}

function qSubjOf(notam: Notam): string {
  return String(notam.qsubj ?? "").toUpperCase();
}
function qCondOf(notam: Notam): string {
  return String(notam.qcond ?? "").toUpperCase();
}

export function isNoFly(notam: Notam): boolean {
  if (isOperatorPolicy(notam) || isRouteAdvisory(notam)) return false;
  const subj = qSubjOf(notam);
  const cond = qCondOf(notam);
  const blob = ["subject", "condition", "text", "e_field"].map((k) => String(notam[k] ?? "")).join(" ").toUpperCase();
  if (_NO_FLY_SUBJ.has(subj)) return true;
  if (subj === "AU" && (_CLOSED_COND.has(cond) || _CLOSED_WORDS.some((w) => hasPhrase(blob, w)))) return true;
  if (_FIRE_WORDS.some((w) => hasPhrase(blob, w))) return true;
  if (_AREA_WORDS.some((w) => hasPhrase(blob, w))) return true;
  if (hasPhrase(blob, "AIRSPACE") && _CLOSED_WORDS.some((w) => hasPhrase(blob, w))) return true;
  if (/\bACT(?:IVAT(?:ED|ION)?)?\b/.test(blob)) {
    const ids = namedAreaIds(blob);
    if (ids.length) return true;
  }
  return false;
}

export function isObstacleErected(notam: Notam): boolean {
  if (qSubjOf(notam) !== "OB") return false;
  return !_OBST_GONE_COND.has(qCondOf(notam));
}

function parseNotamWhenLocal(raw: unknown, endOfDay = false): Date | null {
  let text = String(raw ?? "").trim();
  const PERM = new Set(["", "PERM", "UFN", "EST", "WIE", "NONE"]);
  if (!text || PERM.has(text.toUpperCase())) return null;
  text = text.replace(/Z/g, "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 12) {
    const y = +digits.slice(0, 4), mo = +digits.slice(4, 6) - 1, d = +digits.slice(6, 8);
    const h = +digits.slice(8, 10), mi = +digits.slice(10, 12);
    const dt = new Date(Date.UTC(y, mo, d, h, mi));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (digits.length >= 8) {
    const y = +digits.slice(0, 4), mo = +digits.slice(4, 6) - 1, d = +digits.slice(6, 8);
    const dt = new Date(Date.UTC(y, mo, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

export function notamOverlapsEta(notam: Notam, eta: Date, padH = ETA_PAD_H): boolean {
  const lo = new Date(eta.getTime() - padH * 3600_000);
  const hi = new Date(eta.getTime() + padH * 3600_000);
  const start = parseNotamWhenLocal(notam.start);
  const end = parseNotamWhenLocal(notam.end, true);
  if (start === null && end === null) return true;
  if (start !== null && start > hi) return false;
  if (end !== null && end < lo) return false;
  return true;
}

export function firKey(raw: string): string {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, " ").replace(" FIR", "").trim();
  return /^[A-Z]{4}$/.test(s) ? s : s;
}

export function firAt(eteMin: number, eet: [string, number][], depFir = ""): string {
  if (!eet.length) return firKey(depFir);
  let current = firKey(depFir);
  for (const [code, minute] of eet) {
    if (eteMin < minute) return current;
    current = firKey(code);
  }
  return current;
}

function isAirport(place: Place, notam: Notam): boolean {
  if (place.kind === "A") return true;
  const scope = String(notam.scope ?? "").toUpperCase();
  return scope.includes("A") && !scope.includes("E") && !scope.includes("W");
}

function nmDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const [p1, l1, p2, l2] = [lat1, lon1, lat2, lon2].map((d) => (d * Math.PI) / 180);
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * EARTH_NM;
}

function segNm(lat: number, lon: number, a: Pt, b: Pt): number {
  const d0 = nmDist(lat, lon, a[0], a[1]);
  const d1 = nmDist(lat, lon, b[0], b[1]);
  const ab = nmDist(a[0], a[1], b[0], b[1]);
  if (ab < 0.05) return Math.min(d0, d1);
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2 * Math.PI) / 180) * 60;
  const y = (b[0] - a[0]) * 60;
  const px = (lon - a[1]) * Math.cos(((a[0] + lat) / 2 * Math.PI) / 180) * 60;
  const py = (lat - a[0]) * 60;
  const den = x * x + y * y;
  const t = den <= 0 ? 0 : Math.max(0, Math.min(1, (px * x + py * y) / den));
  return Math.hypot(px - t * x, py - t * y);
}

interface Near { dist_nm: number | null; idx: number; fl_ft: number; ete_min: number; name: string }

export function trackDistance(lat: number, lon: number, points: TrackPoint[]): Near {
  let best: Near = { dist_nm: 1e9, idx: 0, fl_ft: 0, ete_min: 0, name: "" };
  if (!points.length) return { ...best, dist_nm: null };
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    let d = nmDist(lat, lon, pt.lat, pt.lon);
    if (i + 1 < points.length) {
      const nxt = points[i + 1]!;
      d = Math.min(d, segNm(lat, lon, [pt.lat, pt.lon], [nxt.lat, nxt.lon]));
    }
    if (best.dist_nm === null || d < best.dist_nm) {
      best = { dist_nm: d, idx: i, fl_ft: pt.fl_ft || 0, ete_min: pt.ete_min || 0, name: pt.name || "" };
    }
  }
  return best;
}

function centroid(ring: Pt[]): Pt {
  const lat = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const lon = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return [lat, lon];
}

function inside(lat: number, lon: number, ring: Pt[]): boolean {
  const n = ring.length;
  let odd = false, j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = ring[i]!, [yj, xj] = ring[j]!;
    if (yi > lat !== yj > lat) {
      const den = yj - yi || 1e-12;
      if (lon < ((xj - xi) * (lat - yi)) / den + xi) odd = !odd;
    }
    j = i;
  }
  return odd;
}

export function geomTrackNear(geom: Geom, points: TrackPoint[]): Near {
  const best: Near = { dist_nm: null, idx: 0, fl_ft: 0, ete_min: 0, name: "" };
  if (!points.length) return best;
  if (geom.shape === "circle" || geom.shape === "dot") {
    const near = trackDistance(geom.lat!, geom.lon!, points);
    if (geom.shape === "circle" && near.dist_nm !== null) {
      near.dist_nm = Math.max(0, near.dist_nm - (geom.radius_nm || 0));
    }
    return near;
  }
  const ring = geom.ring || [];
  if (geom.shape === "line") {
    if (ring.length < 2) return best;
    let b = best;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!, c = ring[i + 1]!;
      for (const pt of points) {
        const d = segNm(pt.lat, pt.lon, a, c);
        if (b.dist_nm === null || d < b.dist_nm) b = { dist_nm: d, idx: 0, fl_ft: pt.fl_ft || 0, ete_min: pt.ete_min || 0, name: pt.name || "" };
      }
    }
    for (const [lat, lon] of ring) {
      const near = trackDistance(lat, lon, points);
      if (near.dist_nm !== null && (b.dist_nm === null || near.dist_nm < b.dist_nm)) b = near;
    }
    return b;
  }
  if (ring.length < 3) return best;
  for (const pt of points) {
    if (inside(pt.lat, pt.lon, ring)) return { dist_nm: 0, idx: 0, fl_ft: pt.fl_ft || 0, ete_min: pt.ete_min || 0, name: pt.name || "" };
  }
  let b = best;
  for (const [lat, lon] of ring) {
    const near = trackDistance(lat, lon, points);
    if (near.dist_nm !== null && (b.dist_nm === null || near.dist_nm < b.dist_nm)) b = near;
  }
  return b;
}

export function stampEta(points: TrackPoint[], flight: Flight): TrackPoint[] {
  const start = flight.std || flight.etd;
  if (!start) return points;
  return points.map((pt) => {
    const eta = new Date(start.getTime() + (pt.ete_min || 0) * 60_000);
    const hh = String(eta.getUTCHours()).padStart(2, "0");
    const mi = String(eta.getUTCMinutes()).padStart(2, "0");
    return { ...pt, eta: `${hh}${mi}`, eta_z: `${hh}:${mi}Z` };
  });
}

export function pointTime(flight: Flight, eteMin: number): Date {
  const raw = flight.etd || flight.std || new Date();
  return new Date(raw.getTime() + (eteMin || 0) * 60_000);
}

export function isDomesticFlight(flight: Flight): boolean {
  const dep = (flight.dep_icao || "").toUpperCase();
  const dest = (flight.dest_icao || "").toUpperCase();
  return dep.length >= 2 && dest.length >= 2 && dep.slice(0, 2) === dest.slice(0, 2);
}

/** Simplified port of flight_airfields (no OFP-text RALT/TALT extraction — out of scope). */
export function flightAirfields(flight: Flight): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, role: string) => {
    const code = (raw || "").toUpperCase();
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push([code, role]);
  };
  add(flight.dep_icao, "DEP");
  add(flight.dest_icao, "ARR");
  add(flight.dest_alt1, "ALT");
  add(flight.dest_alt2, "ALT");
  return out;
}

function routePin(
  points: TrackPoint[], eet: [string, number][], depFir: string, code: string,
  airport: boolean, used: Set<string>, flight: Flight,
): Geom | null {
  if (!points.length) return null;
  let pick: TrackPoint | null = null;
  if (airport) {
    for (const pt of points) if ((pt.name || "").toUpperCase() === code) { pick = pt; break; }
    if (!pick && used.has(code)) {
      pick = code === (flight.dep_icao || "").toUpperCase() ? points[0]! : points[points.length - 1]!;
    }
  } else {
    for (const pt of points) {
      const fir = firKey(pt.fir || "") || firAt(pt.ete_min || 0, eet, depFir);
      if (fir === code) { pick = pt; break; }
    }
  }
  if (!pick) return null;
  return { name: "", shape: "dot", lat: pick.lat, lon: pick.lon, radius_nm: 0, ring: [], source: "pin" };
}

export interface Hit extends Record<string, unknown> {
  dist_nm: number | null;
  reasons: string[];
}

function hitsFor(
  flight: Flight, place: Place, notam: Notam, points: TrackPoint[], eet: [string, number][],
  used: Set<string>, firs: Set<string>, depFir: string,
): Hit[] {
  let obstacle = false;
  if (!isNoFly(notam)) {
    if (!isObstacleErected(notam)) return [];
    obstacle = true;
  }
  const code = String(place.code ?? "").toUpperCase();
  const qfir = String(notam.qfir ?? code).toUpperCase();
  const airport = isAirport(place, notam);
  const [lo, hi] = notamAltBand(notam);
  if (place.kind === "FIR" && !firs.has(code) && !firs.has(qfir)) return [];
  let geoms = notamGeoms(notam).filter(
    (g) => !(g.shape === "circle" && (g.radius_nm || 0) >= Q_FIR_RADIUS_NM && !["e-field", "brg"].includes(g.source || "")),
  );
  if (obstacle) {
    geoms = geoms.filter((g) => ["polygon", "circle"].includes(g.shape) && g.source !== "pin");
    if (!geoms.length) return [];
  }
  if (!geoms.length) {
    if (isOperatorPolicy(notam) || isRouteAdvisory(notam)) return [];
    const hasHint = qCoordsOf(notam) !== null || namedAreaIds(String(notam.text ?? "") + " " + String(notam.e_field ?? "")).length > 0 || iterLatLon(String(notam.text ?? "") + " " + String(notam.e_field ?? "")).length > 0;
    if (!hasHint) return [];
    if (airport && !used.has(code)) return [];
    const pin = routePin(points, eet, depFir, code, airport, used, flight);
    if (!pin) return [];
    geoms = [pin];
  }
  const out: Hit[] = [];
  for (const geom of geoms) {
    const near = geomTrackNear(geom, points);
    const geomDist = near.dist_nm;
    const dist = airport && used.has(code) && geom.source === "pin" ? 0 : geomDist;
    const flFt = near.fl_ft || 0;
    const eteMin = near.ete_min || 0;
    const wpt = near.name || "";
    const when = pointTime(flight, eteMin);
    let gLo = lo, gHi = hi;
    if (geom.lo != null) gLo = geom.lo;
    if (geom.hi != null) gHi = geom.hi;
    const flOk = !flFt || flOverlap(flFt, gLo, gHi);
    const ring = (geom.ring || []).map(([a, b]) => [a, b]);
    let lat: number, lon: number, radius: number;
    if (geom.shape === "circle" || geom.shape === "dot") { lat = geom.lat!; lon = geom.lon!; radius = geom.radius_nm || 0; }
    else if (ring.length) { [lat, lon] = centroid(ring as Pt[]); radius = 0; }
    else continue;
    const area = (geom.name || "").toUpperCase();
    const reasons: string[] = [];
    if (area) reasons.push(area);
    if (geom.source === "brg") reasons.push("bearing/dist từ navaid");
    const src = geom.source || "";
    if (src === "e-field" && geom.shape === "dot") reasons.push("một điểm — chấm đỏ");
    else if (geom.shape === "dot" || src === "pin") reasons.push("không vẽ được vùng — chấm cam");
    if (dist === null) reasons.push("không có track để tính khoảng cách");
    else if (dist <= 0.05) reasons.push("cắt route");
    else reasons.push(`cách route ${dist.toFixed(0)} NM`);
    reasons.push("FIR " + (qfir || code));
    if (flFt) {
      reasons.push(`FL${Math.floor(flFt / 100)} trong ${gLo}-${gHi} ft`);
      if (!flOk) reasons.push("cruise trên trần vùng");
    }
    if (notamOverlapsEta(notam, when)) {
      reasons.push("giờ " + `${String(when.getUTCHours()).padStart(2, "0")}:${String(when.getUTCMinutes()).padStart(2, "0")}Z` + " ±2h");
    } else reasons.push("trong 24H (ngoài ±2h ETA)");
    const eTxt = String(notam.e_field ?? notam.text ?? "").replace(/^Q\).*$/gm, "").replace(/\s+/g, " ").trim();
    out.push({
      ident: notam.ident ?? "", icao: code, kind: place.kind ?? "", name: place.name ?? "", area,
      shape: geom.shape || "polygon", ring,
      subject: notam.subject ?? "", condition: notam.condition ?? "",
      text: notam.text ?? notam.e_field ?? "", summary: eTxt.slice(0, 220),
      lat, lon, radius_nm: radius, fl_lo: gLo, fl_hi: gHi, fl_ft: flFt,
      dist_nm: dist,
      impact: geom.shape === "dot" && src === "e-field" ? "point" : geom.shape === "dot" ? "dot" : flFt && !flOk ? "ref" : "hot",
      source: src, ete_min: eteMin, wpt, reasons,
      start: notam.start ?? "", end: notam.end ?? "", severity: notam.severity ?? 0,
      purpose: notam.purpose ?? "", scope: notam.scope ?? "",
      qsubj: qSubjOf(notam), qcond: qCondOf(notam),
      eta_ok: notamOverlapsEta(notam, when),
    });
  }
  return out;
}

export function compare(flight: Flight, places: Place[], track: Track, ofpText = ""): Hit[] {
  const points = track.points || [];
  // Như notam_track.py: EET/FIR + sân ALT/TALT/RALT lấy từ OFP, không chỉ DEP/ARR.
  const eet: [string, number][] = ofpText ? (parseEetFirTimes(ofpText) as [string, number][]) : [];
  const used = new Set((ofpText ? tuneAirfields(flight, ofpText) : flightAirfields(flight)).map(([c]) => c));
  let depFir = "";
  for (const place of places) {
    if (place.kind === "A" && place.code === (flight.dep_icao || "").toUpperCase()) {
      depFir = String(place.fir ?? "");
      break;
    }
  }
  const firs = new Set<string>(eet.map(([c]) => c));
  if (depFir) firs.add(depFir);
  for (const place of places) if (place.kind === "FIR" && place.code) firs.add(String(place.code).toUpperCase());
  const hits: Hit[] = [];
  for (const place of places) {
    if (place.error || !place.kind) continue;
    for (const notam of (place.notams as Notam[] | undefined) ?? []) {
      hits.push(...hitsFor(flight, place, notam, points, eet, used, firs, depFir));
    }
  }
  hits.sort((a, b) => {
    const ad = a.dist_nm === null ? 1 : 0, bd = b.dist_nm === null ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (a.dist_nm || 0) - (b.dist_nm || 0);
  });
  return hits;
}

export function fleetVerdict(items: { cs: string; dep: string; dest: string; hit_count: number }[]) {
  const n = items.length;
  const riskN = items.filter((it) => it.hit_count > 0).length;
  const bits = [`${n} chuyến quốc nội`];
  if (riskN) bits.push(`${riskN} chuyến dính`);
  return { status: riskN ? "risk" : "clear", headline: bits.join(" · "), sections: [], flights: n, risk: riskN };
}

// run()/run_domestic_fleet(): orchestration kept thin — network (NOTAM fetch, OFP,
// JetPlan KML) is injected by the handler so this module stays free of server-only
// imports; see handlers/notam_track.server.ts for the FliteBrief wiring.
export interface RunDeps {
  fetchPlaces: (flight: Flight, ofpText?: string) => Promise<Place[]>;
  fetchOfpText?: (flight: Flight) => Promise<string>;
  fetchTrack: (flight: Flight) => Promise<{ track: Track; error: string }>;
  onProgress?: (text: string) => void;
}

export async function run(flight: Flight, deps: RunDeps) {
  deps.onProgress?.("Đang lấy OFP");
  const trackP = deps.fetchTrack(flight);
  const ofpText = deps.fetchOfpText ? await deps.fetchOfpText(flight).catch(() => "") : "";
  deps.onProgress?.("Đang lấy NOTAM sân và FIR theo OFP");
  const [places, trackRes] = await Promise.all([deps.fetchPlaces(flight, ofpText), trackP]);
  deps.onProgress?.("Đang đối chiếu vùng");
  let track = trackRes.track;
  if (track.points?.length) track = { ...track, points: stampEta(track.points, flight) };
  const hits = compare(flight, places, track, ofpText);
  return {
    ok: true,
    flight: {
      id: flight.id, callsign: flight.callsign, dep: flight.dep_icao, dest: flight.dest_icao,
      std: flight.std ? flight.std.toISOString() : "", sta: flight.sta ? flight.sta.toISOString() : "",
      etd: flight.etd ? flight.etd.toISOString() : "", reg: flight.reg, plan_no: flight.plan_no || "",
    },
    jetplan: { plan: track.plan || "", via: track.via || "", error: trackRes.error },
    track: track.points || [],
    line: track.line || [],
    hits, hit_count: hits.length, places,
    notams: places.reduce((a, p) => a + ((p.notams as unknown[] | undefined)?.length ?? 0), 0),
    window: "24h",
  };
}

export async function runDomesticFleet(flights: Flight[], deps: RunDeps & { fetchAllPlaces: (flights: Flight[]) => Promise<Place[]> }) {
  const wanted = flights.filter(isDomesticFlight);
  if (!wanted.length) return { ok: false, error: "không có chuyến quốc nội", places: [] };
  deps.onProgress?.("Đang lấy NOTAM sân và FIR");
  const places = await deps.fetchAllPlaces(wanted);
  deps.onProgress?.("NOTAM đã xong");
  const tracks: Record<string, unknown> = {};
  const pack: { id: number; cs: string; dep: string; dest: string; tracked: boolean; hit_count: number; kml_error: string }[] = [];
  // Tải track song song (pool 8) — tuần tự từng chuyến quá chậm với cả đội bay.
  const trackResults = new Map<number, { track: Track; error: string }>();
  let nextIdx = 0, doneCount = 0;
  const worker = async () => {
    while (nextIdx < wanted.length) {
      const f = wanted[nextIdx++];
      trackResults.set(f.id, await deps.fetchTrack(f));
      doneCount++;
      deps.onProgress?.(`Đang đối chiếu ${doneCount}/${wanted.length} · ${f.callsign || f.id}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, wanted.length) }, worker));
  for (const flight of wanted) {
    const trackRes = trackResults.get(flight.id)!;
    let track = trackRes.track;
    if (track.points?.length) track = { ...track, points: stampEta(track.points, flight) };
    const hits = compare(flight, places, track);
    const row = {
      id: flight.id, cs: flight.callsign || "", dep: flight.dep_icao || "", dest: flight.dest_icao || "",
      tracked: !!(track.points?.length || track.line?.length), hit_count: hits.length, kml_error: trackRes.error,
    };
    pack.push(row);
    tracks[String(flight.id)] = {
      ok: true, fleet_src: true,
      flight: {
        id: flight.id, callsign: flight.callsign, dep: flight.dep_icao, dest: flight.dest_icao,
        std: flight.std ? flight.std.toISOString() : "", sta: flight.sta ? flight.sta.toISOString() : "",
        reg: flight.reg, plan_no: flight.plan_no || "",
      },
      jetplan: { plan: track.plan || "", via: track.via || "", error: trackRes.error },
      track: track.points || [], line: track.line || [], hits, hit_count: hits.length,
    };
  }
  return {
    ok: true, fleet: true, scope: "domestic-track", places, tracks, fleet_rows: pack,
    fleet_verdict: fleetVerdict(pack),
  };
}
