// Port of aip_lookup.py — toạ độ vùng đặt tên: gazetteer sẵn + OpenAIP theo quốc gia của FIR.
// OpenAIP xuất từ ENR 5.x công khai (https://storage.openaip.net).

export type Pt = [number, number];

const OPENAIP = "https://storage.openaip.net/openaip-system-exports/{cc}_asp.json";
const UA = { "User-Agent": "DispatchBoard-NOTAM/1.0" };
const TTL_S = 6 * 3600;
const MAX_DEG = 8.0;

const cache = new Map<string, { at: number; idx: Record<string, Pt[]> }>();

// FIR / prefix → mã nước OpenAIP.
const FIR_CC: Record<string, string> = {
  RJJJ: "jp", RJOO: "jp", RCAA: "tw", RPHI: "ph",
  RKRR: "kr", RKPC: "kr",
  VHHK: "hk", VHHH: "hk",
  VVHM: "vn", VVTS: "vn",
  VTBB: "th", VIDF: "in", VABF: "in", VECF: "in",
  VOMM: "in", VOMF: "in",
  VGFR: "bd", VGHS: "bd",
  WMFC: "my", WMKK: "my",
  WIIF: "id", WIII: "id", WAAF: "id",
  WSJC: "sg", WSSS: "sg",
  YMMM: "au", YBBB: "au",
  ZBPE: "cn", ZGZU: "cn", ZHWH: "cn", ZJSA: "cn",
  ZLHW: "cn", ZYSH: "cn",
};

export function countryOf(fir: string): string {
  const code = String(fir || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (code in FIR_CC) return FIR_CC[code];
  if (code.startsWith("RJ") || code.startsWith("RO")) return "jp";
  if (code.startsWith("RC")) return "tw";
  if (code.startsWith("RK")) return "kr";
  if (code.startsWith("VH")) return "hk";
  if (code.startsWith("VV")) return "vn";
  if (code.startsWith("VT")) return "th";
  if (code.startsWith("VG")) return "bd";
  if (code.startsWith("VI") || code.startsWith("VA") || code.startsWith("VE") || code.startsWith("VO")) return "in";
  if (code.startsWith("WM")) return "my";
  if (code.startsWith("WI") || code.startsWith("WA")) return "id";
  if (code.startsWith("WS")) return "sg";
  if (code.startsWith("RP")) return "ph";
  if (code.startsWith("Y")) return "au";
  if (code.startsWith("Z")) return "cn";
  return "";
}

function norm(name: string): string {
  return String(name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

// Mã vùng ICAO → OpenAIP (WSD/WMD nằm trong file MY dù FIR là Singapore).
const AREA_CC: [string, string][] = [
  ["WMD", "my"], ["WMR", "my"], ["WMP", "my"],
  ["WSD", "my"], ["WSR", "my"], ["WSP", "my"],
  ["WBD", "my"], ["WBR", "my"], ["WBP", "my"],
  ["WAR", "id"], ["WAD", "id"], ["WAP", "id"],
  ["WIR", "id"], ["WID", "id"], ["WIP", "id"],
  ["VVD", "vn"], ["VVR", "vn"], ["VVP", "vn"],
  ["VGD", "bd"], ["VGR", "bd"], ["VGP", "bd"],
  ["VED", "in"], ["VEP", "in"], ["VEF", "in"], ["VER", "in"],
  ["VTD", "th"], ["VTR", "th"], ["VTP", "th"],
  ["RJD", "jp"], ["RJR", "jp"], ["RJP", "jp"], ["JSDF", "jp"],
  ["RKD", "kr"], ["RKR", "kr"], ["RKP", "kr"],
  ["RPD", "ph"], ["RPR", "ph"], ["RPP", "ph"],
  ["VHD", "hk"], ["VHR", "hk"], ["VHP", "hk"],
  ["ZBD", "cn"], ["ZBR", "cn"], ["ZBP", "cn"],
];

export function _ccsFor(ident: string, fir: string): string[] {
  const out: string[] = [];
  const add = (cc: string) => {
    const c = String(cc || "").toLowerCase().trim();
    if (c && !out.includes(c)) out.push(c);
  };
  add(countryOf(fir));
  const key = norm(ident);
  for (const [pref, cc] of AREA_CC) {
    if (key.startsWith(pref)) {
      add(cc);
      break;
    }
  }
  // Singapore FIR: nhiều WMD/WSD chỉ có trong export Malaysia.
  if (countryOf(fir) === "sg") add("my");
  else if (countryOf(fir) === "my") add("sg");
  return out;
}

export function _digitBoundaryPrefix(short: string, long: string): boolean {
  if (!short || !long.startsWith(short)) return false;
  if (long.length === short.length) return true;
  return !/\d/.test(long[short.length]);
}

export function _pickRing(idx: Record<string, Pt[]>, key: string): Pt[] {
  const got = idx[key] || [];
  if (got.length >= 3) return got;
  if (key.length < 4) return [];
  const hits: [string, Pt[]][] = [];
  for (const [name, pts] of Object.entries(idx)) {
    if (pts.length < 3) continue;
    if (_digitBoundaryPrefix(key, name) || _digitBoundaryPrefix(name, key)) {
      hits.push([name, pts]);
    }
  }
  if (!hits.length) return [];
  hits.sort((a, b) => {
    const da = Math.abs(a[0].length - key.length);
    const db = Math.abs(b[0].length - key.length);
    if (da !== db) return da - db;
    return a[0].length - b[0].length;
  });
  return hits[0][1];
}

function ringOf(geom: { type?: string; coordinates?: unknown } | null | undefined): Pt[] {
  if (!geom || typeof geom !== "object") return [];
  const coords = geom.coordinates as unknown[] | undefined;
  const kind = String(geom.type || "");
  let pts: unknown[] = [];
  if (kind === "Polygon" && coords) pts = (coords[0] as unknown[]) || [];
  else if (kind === "MultiPolygon" && coords) {
    const outer = (coords[0] as unknown[]) || [[]];
    pts = (outer[0] as unknown[]) || [];
  }
  const out: Pt[] = [];
  const seen = new Set<string>();
  for (const pair of pts) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
  }
  let ring = out;
  if (ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return [];
  const lats = ring.map((p) => p[0]);
  const lons = ring.map((p) => p[1]);
  if (Math.max(...lats) - Math.min(...lats) > MAX_DEG || Math.max(...lons) - Math.min(...lons) > MAX_DEG) return [];
  return ring;
}

type OpenAipRow = { name?: string; geometry?: { type?: string; coordinates?: unknown } };

function indexItems(rows: OpenAipRow[]): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  for (const row of rows) {
    const name = String(row.name || "");
    const key = norm(name);
    if (key.length < 3) continue;
    const ring = ringOf(row.geometry || {});
    if (ring.length < 3) continue;
    if (!(key in out)) out[key] = ring;
  }
  return out;
}

export async function _loadCountry(cc: string): Promise<Record<string, Pt[]>> {
  const code = String(cc || "").toLowerCase().trim();
  if (!code) return {};
  const now = Date.now() / 1000;
  const hit = cache.get(code);
  if (hit && now - hit.at < TTL_S) return hit.idx;
  try {
    const resp = await fetch(OPENAIP.replace("{cc}", code), { headers: UA });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as unknown;
    const rows: unknown[] = Array.isArray(raw) ? raw : (raw as { features?: unknown[] })?.features || [];
    const flat: OpenAipRow[] = [];
    for (const item of rows) {
      if (item && typeof item === "object" && "properties" in (item as Record<string, unknown>)) {
        const obj = item as { properties?: Record<string, unknown>; geometry?: unknown; name?: unknown };
        const props: OpenAipRow = { ...(obj.properties || {}) } as OpenAipRow;
        if (!("geometry" in (obj.properties || {}))) props.geometry = (obj.geometry as OpenAipRow["geometry"]) || {};
        if (!("name" in (obj.properties || {}))) props.name = (obj.name as string) || "";
        flat.push(props);
      } else if (item && typeof item === "object") {
        flat.push(item as OpenAipRow);
      }
    }
    const idx = indexItems(flat);
    cache.set(code, { at: now, idx });
    return idx;
  } catch {
    cache.set(code, { at: now, idx: {} });
    return {};
  }
}

/** Polygon OpenAIP trùng tên vùng. Không bịa nếu không có. */
export async function ring(ident: string, opts: { fir?: string } = {}): Promise<Pt[]> {
  const key = norm(ident);
  if (key.length < 3) return [];
  for (const cc of _ccsFor(ident, opts.fir || "")) {
    const got = _pickRing(await _loadCountry(cc), key);
    if (got.length >= 3) return got;
  }
  return [];
}

/** Nạp OpenAIP vài nước hay bay — tracking khỏi chờ JSON từng FIR. */
export async function warmup(): Promise<void> {
  const ccs = ["vn", "jp", "kr", "th", "my", "id", "tw", "ph", "hk", "sg"];
  await Promise.all(ccs.map((cc) => _loadCountry(cc)));
}
