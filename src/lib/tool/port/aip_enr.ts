// Port of aip_enr.py — ENR 5.1 polygon danger/restricted (parsing logic only).
// Không bịa: thiếu tọa độ thì trả rỗng. Live multi-source network fetch (CAAM/VNAIC/
// KOCA/AAI/CAAT) is not ported (needs long-running scheduled jobs); see handler report.

export type Pt = [number, number];

const MAX_DEG = 10.0;

const CATA_HEAD = /\bCATA\s+(\d+[A-Z]?)\b/gi;
const MOA_HEAD = /\bMOA\s+(\d+[A-Z]?)\b/gi;
const IN_ID = /\b((?:VI|VA|VE|VO)[DRP])\s*(\d{1,4}[A-Z]?)\b/i;

const ROW = /<tr\b[^>]*>(.*?)<\/tr>/gis;
const TAG = /<[^>]+>/g;
const PARAMS = /<span class="sdParams"[^>]*>.*?<\/span>/gis;
const DMS = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s+(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])/gi;
const BTN = /BTN\s+LAT\s+(\d{6}(?:\.\d+)?)([NS])\s*,?\s*(\d{6}(?:\.\d+)?)([NS])\s*,?\s*and\s+LONG\s+(\d{6,7}(?:\.\d+)?)([EW])\s*,?\s*(\d{6,7}(?:\.\d+)?)([EW])/i;
const IN_BTN = /bounded by\s+(\d{6}(?:\.\d+)?)([NS])\s+to\s+(\d{6}(?:\.\d+)?)([NS])\s*(?:and|;|,)\s+(\d{6,7}(?:\.\d+)?)([EW])\s+to\s+(\d{6,7}(?:\.\d+)?)([EW])/i;
const RAD = /(?:within|circle|radius|centred|centered).{0,80}?(\d+(?:\.\d+)?)\s*(KM|NM|MILES?|FT|M)\b.{0,120}?(\d{6}(?:\.\d+)?)([NS])\s+(\d{6,7}(?:\.\d+)?)([EW])/is;
const RAD2 = /(\d{6}(?:\.\d+)?)([NS])\s+(\d{6,7}(?:\.\d+)?)([EW]).{0,80}?(\d+(?:\.\d+)?)\s*(KM|NM|MILES?|FT|M)\b.{0,40}?(?:radius|centred|centered|circle)/is;
const RAD3 = /(\d+(?:\.\d+)?)\s*(KM|NM|MILES?|FT|M)\b\s+radius.{0,100}?(\d{6}(?:\.\d+)?)([NS])\s+(\d{6,7}(?:\.\d+)?)([EW])/is;
const DM = /(\d{4}(?:\.\d+)?)([NS])\s+(\d{5}(?:\.\d+)?)([EW])/gi;
const DIAM = /(\d+(?:\.\d+)?)\s*(KM|NM|MILES?|FT|M)\b\s+in diameter.{0,100}?(\d{4,6}(?:\.\d+)?)([NS])\s+(\d{5,7}(?:\.\d+)?)([EW])/is;
const CODE = /<span class="SD"[^>]*>\s*([A-Z]{2,4}[DRP]?\d+[A-Z]?)\s*<\/span>\s*<span class="sdParams"[^>]*>TAIRSPACE;CODE_ID/i;
const KR_STRONG = /<strong[^>]*>\s*(RK\s+[DRP]\s*\d+[A-Z]?)\b/i;
const KR_SKIP = /outlines of circles|center 1 and center 2/i;

function plain(html: string): string {
  let blob = (html || "").replace(PARAMS, " ");
  blob = blob.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  blob = blob.replace(TAG, " ");
  blob = blob.replace(/&nbsp;|&amp;/g, " ");
  return blob.replace(/\s+/g, " ").trim();
}

export function _dmsParts(num: string, hemi: string): number {
  const raw = String(num).trim();
  const h = String(hemi).toUpperCase();
  let whole: string, frac: number;
  if (raw.includes(".")) {
    const [w, fs] = raw.split(".", 2);
    whole = w;
    const digits = fs.replace(/\D/g, "").slice(0, 6);
    frac = parseFloat("0." + (digits || "0"));
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
  return Math.round(val * 1e6) / 1e6;
}

function pt(latn: string, ns: string, lonn: string, ew: string): Pt {
  return [_dmsParts(latn, ns), _dmsParts(lonn, ew)];
}

function bboxOk(ring: Pt[]): boolean {
  if (ring.length < 3) return false;
  const lats = ring.map((p) => p[0]);
  const lons = ring.map((p) => p[1]);
  return Math.max(...lats) - Math.min(...lats) <= MAX_DEG && Math.max(...lons) - Math.min(...lons) <= MAX_DEG;
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dlon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dlon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dlon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function dest(lat: number, lon: number, brg: number, distNm: number): Pt {
  const R = 3440.065;
  const d = distNm / R;
  const br = (brg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [Math.round((p2 * 180) / Math.PI * 1e6) / 1e6, Math.round((l2 * 180) / Math.PI * 1e6) / 1e6];
}

function circle(lat: number, lon: number, radiusNm: number, n = 16): Pt[] {
  if (radiusNm <= 0 || radiusNm >= 80) return [];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(dest(lat, lon, (360.0 * i) / n, radiusNm));
  return out;
}

function nm(val: number, unit: string): number {
  const u = String(unit || "").toUpperCase();
  if (u === "NM" || u === "MILE" || u === "MILES") return val;
  if (u === "KM") return val / 1.852;
  if (u === "M") return val / 1852.0;
  if (u === "FT") return val / 6076.12;
  return 0.0;
}

export function _ringOf(text: string): Pt[] {
  const blob = String(text || "");
  const btn = BTN.exec(blob);
  if (btn) {
    const lat1 = _dmsParts(btn[1], btn[2]);
    const lat2 = _dmsParts(btn[3], btn[4]);
    const lon1 = _dmsParts(btn[5], btn[6]);
    const lon2 = _dmsParts(btn[7], btn[8]);
    const [loLat, hiLat] = [Math.min(lat1, lat2), Math.max(lat1, lat2)];
    const [loLon, hiLon] = [Math.min(lon1, lon2), Math.max(lon1, lon2)];
    const ring: Pt[] = [[hiLat, loLon], [hiLat, hiLon], [loLat, hiLon], [loLat, loLon]];
    return bboxOk(ring) ? ring : [];
  }
  const inBtn = IN_BTN.exec(blob);
  if (inBtn) {
    const lat1 = _dmsParts(inBtn[1], inBtn[2]);
    const lat2 = _dmsParts(inBtn[3], inBtn[4]);
    const lon1 = _dmsParts(inBtn[5], inBtn[6]);
    const lon2 = _dmsParts(inBtn[7], inBtn[8]);
    const [loLat, hiLat] = [Math.min(lat1, lat2), Math.max(lat1, lat2)];
    const [loLon, hiLon] = [Math.min(lon1, lon2), Math.max(lon1, lon2)];
    const ring: Pt[] = [[hiLat, loLon], [hiLat, hiLon], [loLat, hiLon], [loLat, loLon]];
    return bboxOk(ring) ? ring : [];
  }
  const pts: Pt[] = [];
  DMS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DMS.exec(blob))) {
    const p = pt(m[1] + m[2] + m[3], m[4], m[5] + m[6] + m[7], m[8]);
    if (pts.length && p[0] === pts[pts.length - 1][0] && p[1] === pts[pts.length - 1][1]) continue;
    if (pts.length >= 3 && p[0] === pts[0][0] && p[1] === pts[0][1]) break;
    pts.push(p);
  }
  if (pts.length >= 3 && bboxOk(pts)) return pts;
  const rad = RAD.exec(blob);
  if (rad) {
    const val = nm(parseFloat(rad[1]), rad[2]);
    const [lat, lon] = pt(rad[3], rad[4], rad[5], rad[6]);
    return circle(lat, lon, val);
  }
  const rad2 = RAD2.exec(blob);
  if (rad2) {
    const [lat, lon] = pt(rad2[1], rad2[2], rad2[3], rad2[4]);
    const val = nm(parseFloat(rad2[5]), rad2[6]);
    return circle(lat, lon, val);
  }
  const rad3 = RAD3.exec(blob);
  if (rad3) {
    const val = nm(parseFloat(rad3[1]), rad3[2]);
    const [lat, lon] = pt(rad3[3], rad3[4], rad3[5], rad3[6]);
    return circle(lat, lon, val);
  }
  const dm: Pt[] = [];
  DM.lastIndex = 0;
  while ((m = DM.exec(blob))) {
    const p = pt(m[1], m[2], m[3], m[4]);
    if (dm.length && p[0] === dm[dm.length - 1][0] && p[1] === dm[dm.length - 1][1]) continue;
    if (dm.length >= 3 && p[0] === dm[0][0] && p[1] === dm[0][1]) break;
    dm.push(p);
  }
  if (dm.length >= 3 && bboxOk(dm)) return dm;
  const diam = DIAM.exec(blob);
  if (diam) {
    const val = nm(parseFloat(diam[1]), diam[2]) / 2.0;
    const [lat, lon] = pt(diam[3], diam[4], diam[5], diam[6]);
    return circle(lat, lon, val);
  }
  return [];
}

/** Bảng ENR 5.1 (CAAM / VNAIC) → {WMD21: ring, VVD20: ring, …}. */
export function parseEnrHtml(html: string): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  ROW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW.exec(html || ""))) {
    const row = m[1];
    const hit = CODE.exec(row);
    if (!hit) continue;
    const ident = hit[1].toUpperCase().replace(/[\s\-]+/g, "");
    const cells = row.split(/<\/td>/i);
    const first = cells.length ? plain(cells[0]) : plain(row);
    const ring = _ringOf(first).length >= 3 ? _ringOf(first) : _ringOf(plain(row));
    if (ring.length < 3) continue;
    if (!(ident in out)) out[ident] = ring;
  }
  return out;
}

/** KOCA ENR 5.2 — ``MOA 80 SEO-HAE-JUNG-BU`` + tọa độ. */
export function parseKrMoaHtml(html: string): Record<string, Pt[]> {
  let blob = plain(html);
  const cut = /AIR DEFENCE IDENTIFICATION|\bKADIZ\b|2 AIR DEFENCE/i.exec(blob);
  if (cut) blob = blob.slice(0, cut.index);
  const hits: RegExpExecArray[] = [];
  MOA_HEAD.lastIndex = 0;
  let h: RegExpExecArray | null;
  while ((h = MOA_HEAD.exec(blob))) hits.push(h);
  const out: Record<string, Pt[]> = {};
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const ident = `MOA${hit[1].toUpperCase()}`;
    const end = i + 1 < hits.length ? hits[i + 1].index! : blob.length;
    const piece = blob.slice(hit.index! + hit[0].length, end);
    let ring: Pt[] = [];
    for (const chunk of piece.split(/to the beginning/i)) {
      const got = _ringOf(chunk);
      if (got.length >= 3) ring = got;
    }
    if (ring.length >= 3 && !(ident in out)) out[ident] = ring;
  }
  return out;
}

/** KOCA ENR 5.3 — ``CATA 2 JEJU ISLAND`` + tọa độ. */
export function parseKrCataHtml(html: string): Record<string, Pt[]> {
  let blob = plain(html);
  const cut = /Permanently sited/i.exec(blob);
  if (cut) blob = blob.slice(0, cut.index);
  const hits: RegExpExecArray[] = [];
  CATA_HEAD.lastIndex = 0;
  let h: RegExpExecArray | null;
  while ((h = CATA_HEAD.exec(blob))) hits.push(h);
  const out: Record<string, Pt[]> = {};
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const ident = `CATA${hit[1].toUpperCase()}`;
    const end = i + 1 < hits.length ? hits[i + 1].index! : blob.length;
    const ring = _ringOf(blob.slice(hit.index! + hit[0].length, end));
    if (ring.length >= 3 && !(ident in out)) out[ident] = ring;
  }
  return out;
}

/** KOCA ENR 5.1 — ``RK D99`` trong <strong>, không có TAIRSPACE;CODE_ID. */
export function parseKrEnrHtml(html: string): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  ROW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW.exec(html || ""))) {
    const row = m[1];
    const hit = KR_STRONG.exec(row);
    if (!hit) continue;
    const ident = hit[1].toUpperCase().replace(/[\s_\-]+/g, "");
    const cells = row.split(/<\/td>/i);
    const first = cells.length ? plain(cells[0]) : plain(row);
    if (KR_SKIP.test(first)) continue;
    const ring = _ringOf(first).length >= 3 ? _ringOf(first) : _ringOf(plain(row));
    if (ring.length < 3) continue;
    if (!(ident in out)) out[ident] = ring;
  }
  return out;
}

/** AAI ENR 5.1 — ``VID 129 Sidwan Khas`` + tọa độ cột lateral. */
export function parseInEnrHtml(html: string): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  ROW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW.exec(html || ""))) {
    const row = m[1];
    const cells = row.split(/<\/td>/i);
    if (!cells.length) continue;
    const first = plain(cells[0]);
    const hit = IN_ID.exec(first);
    if (!hit) continue;
    const ident = `${hit[1].toUpperCase()}${hit[2].toUpperCase()}`;
    const lateral = cells.length > 1 ? plain(cells[1]) : plain(row);
    const ring = _ringOf(lateral).length >= 3 ? _ringOf(lateral) : _ringOf(plain(row));
    if (ring.length < 3) continue;
    if (!(ident in out)) out[ident] = ring;
  }
  return out;
}
