// Port of aip_vn_chart.py — bản đồ Việt Nam (sân bay, route, waypoint, đài)
// từ AIP VATM đang hiệu lực. Pure parsing logic only; live fetch + cache
// happen in the handler (src/lib/tool/handlers/notam.server.ts).

export const CACHE_VER = 3;

export type ChartPt = [number, number];
export type ChartRoute = { name: string; pts: ChartPt[]; alts?: string[]; fixes?: string[]; cc?: string };
export type ChartWaypoint = { id: string; lat: number; lon: number };
export type ChartNavaid = { id: string; name: string; kind: string; lat: number; lon: number };
export type ChartAirport = { icao: string; name: string; lat?: number; lon?: number; iata?: string };
export type ChartIndexRow = { icao: string; name: string };

export type Chart = {
  ver: number;
  cycle: string;
  effective: string;
  airports: ChartAirport[];
  routes: ChartRoute[];
  waypoints: ChartWaypoint[];
  navaids: ChartNavaid[];
  pending?: boolean;
  lookup?: ChartWaypoint[];
};

export function empty(cycle = "", effective = ""): Chart {
  return { ver: CACHE_VER, cycle, effective, airports: [], routes: [], waypoints: [], navaids: [] };
}

const _PAIR = /<span class="SD"[^>]*>\s*([^<]*?)\s*<\/span>\s*<span class="sdParams"[^>]*>\s*([^<]+?)\s*<\/span>/gi;
const _ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const _COMPACT = /^(\d{4,7}(?:\.\d+)?)([NSEW])$/i;
const _AD = /<span class="SD"[^>]*>\s*([^<]+?)\s*<\/span>\s*<span class="sdParams"[^>]*>TAD_HP;TXT_NAME;(\d+)<\/span>[\s\S]{0,1500}?<span class="SD"[^>]*>\s*([A-Z]{4})\s*<\/span>\s*<span class="sdParams"[^>]*>TAD_HP;CODE_ICAO;\2<\/span>/gi;

const LAT_LO = 0.0, LAT_HI = 28.0;
const LON_LO = 95.0, LON_HI = 130.0;

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function dmsParts(num: string, hemi: string): number {
  const raw = String(num).trim();
  const h = String(hemi).toUpperCase();
  let whole: string, frac: number;
  if (raw.includes(".")) {
    const [w, fracS] = raw.split(".", 2);
    whole = w;
    const digitsOnly = (fracS || "").replace(/\D/g, "").slice(0, 6);
    frac = digitsOnly ? Number("0." + digitsOnly) : 0.0;
  } else {
    whole = raw;
    frac = 0.0;
  }
  let digits = whole.replace(/\D/g, "");
  let deg: number, mn: number, sec: number;
  if (h === "N" || h === "S") {
    if (digits.length <= 4) {
      digits = digits.padStart(4, "0");
      deg = parseInt(digits.slice(0, 2), 10);
      mn = parseInt(digits.slice(2, 4), 10);
      sec = frac;
    } else {
      digits = digits.padStart(6, "0");
      deg = parseInt(digits.slice(0, 2), 10);
      mn = parseInt(digits.slice(2, 4), 10);
      sec = parseInt(digits.slice(4, 6), 10) + frac;
    }
  } else {
    if (digits.length <= 5) {
      digits = digits.padStart(5, "0");
      deg = parseInt(digits.slice(0, 3), 10);
      mn = parseInt(digits.slice(3, 5), 10);
      sec = frac;
    } else {
      digits = digits.padStart(7, "0");
      deg = parseInt(digits.slice(0, 3), 10);
      mn = parseInt(digits.slice(3, 5), 10);
      sec = parseInt(digits.slice(5, 7), 10) + frac;
    }
  }
  let val = deg + mn / 60.0 + sec / 3600.0;
  if (h === "S" || h === "W") val = -val;
  return val;
}

function coord(raw: string): number | null {
  const m = _COMPACT.exec(String(raw || "").replace(/\s+/g, ""));
  if (!m) return null;
  let val: number;
  try {
    val = dmsParts(m[1] ?? "", m[2] ?? "");
  } catch {
    return null;
  }
  const hemi = (m[2] ?? "").toUpperCase();
  if ((hemi === "N" || hemi === "S") && !(val >= -90.0 && val <= 90.0)) return null;
  if ((hemi === "E" || hemi === "W") && !(val >= -180.0 && val <= 180.0)) return null;
  return val;
}

function inBox(lat: number, lon: number): boolean {
  return lat >= LAT_LO && lat <= LAT_HI && lon >= LON_LO && lon <= LON_HI;
}

type WalkRow = [string, string, string, string]; // table, field, fid, val

function* walk(html: string): Generator<WalkRow> {
  const re = new RegExp(_PAIR.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ""))) {
    const val = unescapeHtml((m[1] ?? "").replace(/\s+/g, " ")).trim();
    const parts = (m[2] ?? "").split(";").map((p) => p.trim());
    if (parts.length < 3 || !val) continue;
    yield [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", val];
  }
}

function latlon(pairs: WalkRow[]): ChartPt | null {
  let lat: number | null = null;
  let lon: number | null = null;
  for (const [, field, , val] of pairs) {
    if (field === "GEO_LAT" && lat === null) lat = coord(val);
    else if (field === "GEO_LONG" && lon === null) lon = coord(val);
  }
  if (lat === null || lon === null || !inBox(lat, lon)) return null;
  return [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
}

export function currentIssue(html: string): [string, string] {
  const chunks = (html || "").split(/(?:<h2[^>]*>)/i);
  let block = "";
  for (const chunk of chunks) {
    const head = chunk.slice(0, 120).replace(/<[^>]+>/g, " ").trim().toLowerCase();
    if (head.startsWith("currently effective")) {
      block = chunk;
      break;
    }
  }
  const m = /href="([^"]+?)\/html\/index-en-GB\.html"[^>]*>\s*([^<]+?)\s*</i.exec(block);
  if (!m) return ["", ""];
  const cycle = (m[1] ?? "").trim().split("/").pop() ?? "";
  const effective = (m[2] ?? "").replace(/\s+/g, " ").trim();
  return [cycle, effective];
}

export function parseAirports(html: string): ChartIndexRow[] {
  const out: ChartIndexRow[] = [];
  const seen = new Set<string>();
  const re = new RegExp(_AD.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ""))) {
    const code = (m[3] ?? "").trim().toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ icao: code, name: unescapeHtml((m[1] ?? "").replace(/\s+/g, " ")).trim() });
  }
  return out;
}

export function parseArp(html: string): ChartPt | null {
  const latBy = new Map<string, number>();
  for (const [table, field, fid, val] of walk(html)) {
    if (table !== "TAD_HP") continue;
    if (field === "GEO_LAT") {
      const got = coord(val);
      if (got !== null) latBy.set(fid, got);
    } else if (field === "GEO_LONG") {
      const lon = coord(val);
      const lat = latBy.get(fid);
      if (lat !== undefined && lon !== null && inBox(lat, lon)) {
        return [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
      }
    }
  }
  const rowRe = new RegExp(_ROW.source, "gi");
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html || ""))) {
    const row = rm[1] ?? "";
    const plain = row.replace(/<[^>]+>/g, " ");
    if (!plain.includes("ARP coordinates")) continue;
    const pt = latlon([...walk(row)]);
    if (pt !== null) return pt;
  }
  return null;
}

function segFloor(pairs: WalkRow[]): string {
  let lower = "", unit = "", over = "", overUnit = "";
  for (const [table, field, , val] of pairs) {
    if (table !== "TRTE_SEG") continue;
    const text = val.trim();
    if (field === "VAL_DIST_VER_LOWER_OVRDE") over = text;
    else if (field === "UOM_DIST_VER_LOWER_OVRDE") overUnit = text.toUpperCase();
    else if (field === "VAL_DIST_VER_LOWER") lower = text;
    else if (field === "UOM_DIST_VER_LOWER") unit = text.toUpperCase();
  }
  if (over) {
    if (overUnit === "M") return over + "m";
    if (overUnit === "FT") return over;
    return overUnit ? over + overUnit.toLowerCase() : over;
  }
  if (!lower) return "";
  if (unit === "FL") return "FL" + lower;
  if (unit === "M") return lower + "m";
  return lower;
}

export function parseRoutes(html: string): ChartRoute[] {
  const routes: ChartRoute[] = [];
  let cur: { name: string; pts: ChartPt[]; alts: string[] } | null = null;
  let pending = "";
  const rowRe = new RegExp(_ROW.source, "gi");
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html || ""))) {
    const row = rm[1] ?? "";
    const pairs = [...walk(row)];
    if (!pairs.length) continue;
    let desig = "";
    for (const [table, field, , val] of pairs) {
      if (field === "TXT_DESIG" && table.includes("ROUTE")) {
        desig = val;
        break;
      }
    }
    if (desig) {
      if (cur && cur.pts.length >= 2) routes.push(cur);
      cur = { name: desig, pts: [], alts: [] };
      pending = "";
      continue;
    }
    if (cur === null) continue;
    const floor = segFloor(pairs);
    const pt = latlon(pairs);
    if (pt === null) {
      if (floor) pending = floor;
      continue;
    }
    const last = cur.pts[cur.pts.length - 1];
    const isNew = !cur.pts.length || !(last && last[0] === pt[0] && last[1] === pt[1]);
    if (!isNew) {
      if (floor) pending = floor;
      continue;
    }
    if (cur.pts.length) {
      cur.alts.push(pending);
      pending = "";
    }
    cur.pts.push(pt);
    if (floor) pending = floor;
  }
  if (cur && cur.pts.length >= 2) {
    const c = cur;
    if (c.alts.length >= c.pts.length) c.alts = c.alts.slice(0, c.pts.length - 1);
    const out: ChartRoute = { name: c.name, pts: c.pts };
    if (c.alts.some((a) => a)) out.alts = c.alts;
    routes.push(out);
  }
  return routes;
}

export function parseWaypoints(html: string): ChartWaypoint[] {
  const out: ChartWaypoint[] = [];
  const seen = new Set<string>();
  const rowRe = new RegExp(_ROW.source, "gi");
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html || ""))) {
    const row = rm[1] ?? "";
    const pairs = [...walk(row)];
    let ident = "";
    for (const [table, field, , val] of pairs) {
      if (table === "TDESIGNATED_POINT" && field === "CODE_ID") {
        ident = val.trim().toUpperCase();
        break;
      }
    }
    const pt = latlon(pairs);
    if (!ident || pt === null || seen.has(ident)) continue;
    seen.add(ident);
    out.push({ id: ident, lat: pt[0], lon: pt[1] });
  }
  return out;
}

export function parseNavaids(html: string): ChartNavaid[] {
  const out: ChartNavaid[] = [];
  const seen = new Set<string>();
  const rowRe = new RegExp(_ROW.source, "gi");
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html || ""))) {
    const row = rm[1] ?? "";
    const pairs = [...walk(row)];
    let ident = "", name = "", kind = "";
    for (const [table, field, , val] of pairs) {
      if (table !== "TNAVAID") continue;
      if (field === "CODE_ID" && !ident) ident = val.trim().toUpperCase();
      else if (field === "TXT_NAME" && !name) name = val.trim();
      else if (field === "CODE_TYPE" && !kind) kind = val.trim();
    }
    const pt = latlon(pairs);
    if (!ident || pt === null || seen.has(ident)) continue;
    seen.add(ident);
    out.push({ id: ident, name, kind, lat: pt[0], lon: pt[1] });
  }
  return out;
}

export function withFixes(routes: ChartRoute[], waypoints: ChartWaypoint[]): ChartRoute[] {
  const index = new Map<string, string>();
  for (const point of waypoints) {
    try {
      const key = `${Math.round(Number(point.lat) * 1e5) / 1e5}:${Math.round(Number(point.lon) * 1e5) / 1e5}`;
      if (!index.has(key)) index.set(key, String(point.id || ""));
    } catch {
      continue;
    }
  }
  return routes.map((route) => {
    const names: string[] = [];
    for (const pt of route.pts || []) {
      try {
        const key = `${Math.round(Number(pt[0]) * 1e5) / 1e5}:${Math.round(Number(pt[1]) * 1e5) / 1e5}`;
        names.push(index.get(key) ?? "");
      } catch {
        names.push("");
      }
    }
    return { ...route, fixes: names };
  });
}

export function tagIata(airports: ChartAirport[], table: Record<string, string>): ChartAirport[] {
  return airports.map((row) => {
    const iata = table[String(row.icao || "").toUpperCase()];
    return iata ? { ...row, iata } : { ...row };
  });
}

export function slimLookup(points: ChartWaypoint[]): ChartWaypoint[] {
  const out: ChartWaypoint[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    const ident = String(point.id || "").trim().toUpperCase();
    const lat = Math.round(Number(point.lat) * 1e5) / 1e5;
    const lon = Math.round(Number(point.lon) * 1e5) / 1e5;
    if (!ident || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const key = `${ident}:${lat}:${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: ident, lat, lon });
  }
  return out;
}
