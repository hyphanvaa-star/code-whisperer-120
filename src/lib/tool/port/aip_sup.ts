// Port of aip_sup.py — AIP SUP → polygon parsers (pure, no network / fs / ctx).
// Never fabricate rings: every function below only emits a ring when the source
// text actually gives ≥3 coordinates (or an explicit circle/arc description).
// Network + cache (Japan SWIM login, Australia Airservices / DAH PDFs, Taiwan
// eAIP HTML, store-backed cache) lives in ../aip_sup.server.ts.

export type Pt = [number, number];
export type RingTable = Record<string, { name: string; ring: Pt[] }>;

const EARTH_NM = 3440.065;

function destPoint(lat: number, lon: number, brgDeg: number, distNm: number): Pt {
  const rlat = (lat * Math.PI) / 180, rlon = (lon * Math.PI) / 180, brg = (brgDeg * Math.PI) / 180;
  const ang = distNm / EARTH_NM;
  const lat2 = Math.asin(Math.sin(rlat) * Math.cos(ang) + Math.cos(rlat) * Math.sin(ang) * Math.cos(brg));
  const lon2 = rlon + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(rlat), Math.cos(ang) - Math.sin(rlat) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, (((lon2 * 180) / Math.PI + 540) % 360) - 180];
}

function bearingTo(from: Pt, to: Pt): number {
  const [lat1, lon1] = [(from[0] * Math.PI) / 180, (from[1] * Math.PI) / 180];
  const [lat2, lon2] = [(to[0] * Math.PI) / 180, (to[1] * Math.PI) / 180];
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Port of aip_sua._arc: interior points of the arc (ctr,radius) from `from` to `to`. */
function arcPoints(ctr: Pt, from: Pt, to: Pt, radiusNm: number, clockwise: boolean, n = 12): Pt[] {
  if (radiusNm <= 0) return [];
  const brgA = bearingTo(ctr, from);
  const brgB = bearingTo(ctr, to);
  const span = clockwise ? (brgB - brgA + 360) % 360 : (brgA - brgB + 360) % 360;
  if (span < 0.5) return [];
  const steps = Math.max(2, Math.round((n * span) / 360));
  const out: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    const frac = i / steps;
    const brg = clockwise ? (brgA + span * frac) % 360 : (brgA - span * frac + 360) % 360;
    out.push(destPoint(ctr[0], ctr[1], brg, radiusNm));
  }
  return out;
}

function ptsEqual(a: Pt, b: Pt): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// ---------- generic DD MM SS N/E coord scanner ----------
const _COORD = /(\d{2})(\d{2})(\d{2})\s*N\s*\/?\s*(\d{3})(\d{2})(\d{2})\s*E/gi;

function llFromMatch(m: RegExpExecArray): Pt {
  const lat = +m[1]! + +m[2]! / 60 + +m[3]! / 3600;
  const lon = +m[4]! + +m[5]! / 60 + +m[6]! / 3600;
  return [round6(lat), round6(lon)];
}
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function coords(blob: string): Pt[] {
  const pts: Pt[] = [];
  const rx = new RegExp(_COORD.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(blob || ""))) {
    const p = llFromMatch(m);
    if (pts.length && ptsEqual(p, pts[pts.length - 1]!)) continue;
    if (pts.length >= 3 && ptsEqual(p, pts[0]!)) break;
    pts.push(p);
  }
  return pts;
}

const _COORD_SPLIT = /(\d{2})(\d{2})(\d{2})\s*N[\s/]+(\d{3})(\d{2})(\d{2})\s*E/gi;
const _COORD_COMPACT = /(\d{2})(\d{2})(\d{2})N(\d{3})(\d{2})(\d{2})E/gi;
// TAIKI / balloon maps: ``4200N/14200E`` (DDMM / DDDMM, no seconds).
const _COORD_DM_SLASH = /(?<!\d)(\d{2})(\d{2})\s*N\s*\/\s*(\d{3})(\d{2})\s*E(?!\d)/gi;

function llFromDm(m: RegExpExecArray): Pt {
  const lat = +m[1]! + +m[2]! / 60;
  const lon = +m[3]! + +m[4]! / 60;
  return [round6(lat), round6(lon)];
}

function coordsRe(blob: string, rx: RegExp, stopClosed = true, dm = false): Pt[] {
  const pts: Pt[] = [];
  const re = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob || ""))) {
    const p = dm ? llFromDm(m) : llFromMatch(m);
    if (pts.length && ptsEqual(p, pts[pts.length - 1]!)) continue;
    if (stopClosed && pts.length >= 3 && ptsEqual(p, pts[0]!)) break;
    pts.push(p);
  }
  return pts;
}

function nmApart(a: Pt, b: Pt): number {
  const dlat = (a[0] - b[0]) * 60;
  const mid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dlon = (a[1] - b[1]) * 60 * Math.cos(mid);
  return Math.hypot(dlat, dlon);
}

function clusterPts(pts: Pt[], gapNm: number): Pt[][] {
  const groups: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of pts) {
    if (cur.length && nmApart(cur[cur.length - 1]!, p) > gapNm) {
      if (cur.length >= 3) groups.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length >= 3) groups.push(cur);
  return groups;
}

/** Cắt trang bản đồ ``ATTACHMENT-2``, không cắt câu See ATTACHMENT / 参照. */
function bodyBeforeMap(blob: string): string {
  const hit = /^ATTACHMENT(?:\s*-?\s*\d+)?\s*$/im.exec(blob || "");
  return hit ? (blob || "").slice(0, hit.index) : blob || "";
}

/** PDF để caption ``ATTACHMENT-n`` *sau* hình — lấy đoạn chữ trước caption. */
function attachmentBlocks(blob: string): [string, string][] {
  const bits = (blob || "").split(/ATTACHMENT\s*-?\s*(\d+)/i);
  if (bits.length < 2) return [];
  const out: [string, string][] = [];
  let pre = bits[0]!;
  let i = 1;
  while (i < bits.length) {
    const num = bits[i]!;
    out.push([num, pre]);
    pre = bits[i + 1] ?? "";
    i += 2;
  }
  if (pre.trim()) {
    const last = out[out.length - 1];
    const nxt = last && /^\d+$/.test(last[0]) ? String(+last[0] + 1) : "1";
    out.push([nxt, pre]);
  }
  return out;
}

const _ATT_LABELS: Record<string, string> = { "2": "ASCEND", "3": "FLOAT", "4": "FALL" };

/** Vùng ``4200N/14200E`` trên ATTACHMENT-2/3/4 (TAIKI balloon). */
function parseDmAttachmentMaps(blob: string, prefix: string): RingTable {
  const out: RingTable = {};
  for (const [num, piece] of attachmentBlocks(blob)) {
    const pts = coordsRe(piece, _COORD_DM_SLASH, true, true);
    if (pts.length < 3) continue;
    if (!/^\d+$/.test(num)) continue;
    const n = String(+num);
    const key = _ATT_LABELS[n] ?? `NR.${n}`;
    const name = prefix ? `${prefix}-${key}` : key;
    out[key] = { name, ring: pts };
  }
  return out;
}

const _NAMED = /\b((?:ITRA|LION|MOOSE|TIGER|EAGLE|EDIX)(?:-[A-Z0-9]+)+)\b/gi;
const _SPLIT = /(?:temporary\s+training\s+area|training\s+area|臨時訓練空域)\s*Nr\.?\s*(\d+)/gi;

/** Toạ độ trên trang bản đồ ATTACHMENT — HAPS / balloon SUP. */
function parseJapanAttachments(blob: string, supKey: string, prefix: string): RingTable {
  let tag = prefix || (/HAPS|BALLOON|重気球/i.test(blob || "") ? "HAPS" : "");
  tag = tag || (supKey ? `SUP-${supKey}` : "SUP");
  const maps = parseDmAttachmentMaps(blob, tag);
  if (Object.keys(maps).length) return maps;
  const attMatch = /^ATTACHMENT(?:\s*-?\s*\d+)?\s*$/im.exec(blob);
  const body = attMatch ? blob.slice(attMatch.index + attMatch[0].length) : blob;
  const out: RingTable = {};
  if (tag === "HAPS") {
    const splitPts = coordsRe(body, _COORD_SPLIT);
    const local = splitPts.filter((p) => p[0] >= 36.0 && p[0] <= 40.0 && p[1] >= 139.8 && p[1] <= 143.05);
    const localSet = new Set(local.map((p) => p.join(",")));
    const ocean = splitPts.filter((p) => !localSet.has(p.join(",")));
    if (local.length >= 3) out["CLIMB"] = { name: `${tag}-CLIMB`, ring: local };
    if (ocean.length >= 3) out["FLOAT"] = { name: `${tag}-FLOAT`, ring: ocean };
    const pads = coordsRe(body, _COORD_COMPACT, false);
    clusterPts(pads, 3.0).forEach((ring, i) => {
      out[`REL.${i + 1}`] = { name: `${tag}-RELEASE-${i + 1}`, ring };
    });
  }
  if (Object.keys(out).length) return out;
  const ring = coords(body);
  if (ring.length >= 3) out["NR.1"] = { name: tag, ring };
  return out;
}

function prefixOf(text: string): string {
  const u = (text || "").toUpperCase();
  if (u.includes("HYAKURI") || (text || "").includes("百里")) return "HYAKURI";
  if (u.includes("EAST OF TOHOKU") || (text || "").includes("東北東方")) return "E-TOHOKU";
  if (u.includes("WEST OF TOHOKU") || (text || "").includes("東北西方")) return "W-TOHOKU";
  if (u.includes("IWAKUNI") || u.includes("ITRA")) return "ITRA";
  if (u.includes("OKINAWA")) return "OKINAWA";
  if (u.includes("KYUSHU")) return "KYUSHU";
  if (u.includes("TAIKI") || (text || "").includes("大樹")) return "TAIKI";
  if (u.includes("HAPS") || u.includes("HEAVY BALLOON") || (text || "").includes("重気球")) return "HAPS";
  return "";
}

/** Bảng NR.n / ITRA-* / vòng bán kính / một polygon không tên từ PDF SUP Nhật. */
export function parse_japan_sup_text(text: string, supKey = ""): RingTable {
  const blob = String(text || "");
  const prefix = prefixOf(blob);
  const radii = parseJapanRadiusAreas(blob, prefix);
  if (Object.keys(radii).length) return radii;
  let out: RingTable = {};
  const named = [...blob.matchAll(new RegExp(_NAMED.source, "gi"))];
  if (named.length) {
    for (let i = 0; i < named.length; i++) {
      const hit = named[i]!;
      const ident = hit[1]!.toUpperCase();
      const end = i + 1 < named.length ? named[i + 1]!.index! : blob.length;
      const piece = bodyBeforeMap(blob.slice(hit.index! + hit[0].length, end));
      const ring = coords(piece);
      if (ring.length < 3) continue;
      out[ident] = { name: ident, ring };
    }
  }
  if (Object.keys(out).length) return out;
  const chunks = blob.split(new RegExp(_SPLIT.source, "gi"));
  if (chunks.length >= 3) {
    for (let i = 1; i + 1 < chunks.length; i += 2) {
      const n = chunks[i]!;
      let piece = bodyBeforeMap(chunks[i + 1] || "");
      piece = piece.split(/Controlling unit/i)[0] || "";
      const ring = coords(piece);
      if (ring.length < 3) continue;
      const nr = `NR.${parseInt(n, 10)}`;
      const name = prefix ? `${prefix}-NR.${parseInt(n, 10)}` : `SUP-${supKey}-${nr}`;
      out[nr] = { name, ring };
    }
  }
  if (Object.keys(out).length) return out;
  const ring = coords(bodyBeforeMap(blob));
  if (ring.length >= 3) {
    const name = prefix || (supKey ? `SUP-${supKey}` : "SUP");
    out["NR.1"] = { name, ring };
    return out;
  }
  return parseJapanAttachments(blob, supKey, prefix);
}

function auPtParts(latd: string, latm: string, lats: string, ns: string, lond: string, lonm: string, lons: string, ew: string): Pt {
  let lat = +latd + +latm / 60 + +lats / 3600;
  if (ns.toUpperCase() === "S") lat = -lat;
  let lon = +lond + +lonm / 60 + +lons / 3600;
  if (ew.toUpperCase() === "W") lon = -lon;
  return [round6(lat), round6(lon)];
}

function jpPt(m: RegExpExecArray): Pt {
  const g = m.groups!;
  return auPtParts(g.latd!, g.latm!, g.lats!, "N", g.lond!, g.lonm!, g.lons!, "E");
}

function jpCircle(ctr: Pt, radNm: number, n = 24): Pt[] {
  if (radNm <= 0 || radNm >= 80) return [];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(destPoint(ctr[0], ctr[1], (360 * i) / n, radNm));
  return out;
}

/** Vòng trừ quạt ``between A° and B°`` (chiều tăng góc, MAG≈TRUE). */
function jpCircleMinusFan(ctr: Pt, radNm: number, brgA: number, brgB: number, n = 36): Pt[] {
  if (radNm <= 0 || radNm >= 80) return [];
  const a = ((brgA % 360) + 360) % 360;
  const b = ((brgB % 360) + 360) % 360;
  const start = b, end = a;
  const span = ((end - start) % 360 + 360) % 360;
  if (span < 1.0) return jpCircle(ctr, radNm, n);
  const steps = Math.max(12, Math.round((n * span) / 360));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const brg = (start + (span * i) / steps) % 360;
    out.push(destPoint(ctr[0], ctr[1], brg, radNm));
  }
  return out;
}

const _JP_AREA_HEAD = /\(\s*(?<n>\d+)\s*\)\s*(?<title>[^\n]{0,80})/gi;

function jpAreaTitle(blob: string, pos: number): string {
  let title = "";
  for (const hit of blob.matchAll(new RegExp(_JP_AREA_HEAD.source, "gi"))) {
    if (hit.index! <= pos) title = (hit.groups!.title || "").replace(/\s+/g, " ").trim();
    else break;
  }
  const u = title.toUpperCase();
  if (u.includes("KINKASAN") || title.includes("金華山")) return "KINKASAN";
  if (u.includes("MATSUSHIMA") || u.includes("RJST") || title.includes("松島")) return "MATSUSHIMA-RJST";
  return title ? title.slice(0, 40) : "";
}

// SUP 055/26 Kinkasan: ``radius of 18km(10NM) from … (381641N1413447E),
// excluding fan-shaped … between 225° MAG and 360° MAG``.
const _JP_RADIUS =
  /(?:radius|半径)\s*(?:of\s*)?(?:[\d.]+\s*km\s*)?\(?\s*(?<nm>[\d.]+)\s*NM\s*\)?.{0,160}?(?<latd>\d{2})(?<latm>\d{2})(?<lats>\d{2})\s*N\s*\/?\s*(?<lond>\d{3})(?<lonm>\d{2})(?<lons>\d{2})\s*E(?:.{0,220}?excluding\s+fan-shaped\s+airspace\s+between\s+(?<a>\d{1,3})\s*°?\s*MAG\s+and\s+(?<b>\d{1,3})\s*°?\s*MAG)?/gis;

/** Vòng bán kính / vòng trừ quạt từ mô tả Area (n) SUP Nhật. */
function parseJapanRadiusAreas(blob: string, prefix: string): RingTable {
  const out: RingTable = {};
  let i = 0;
  for (const hit of (blob || "").matchAll(new RegExp(_JP_RADIUS.source, "gis"))) {
    i += 1;
    const ctr = jpPt(hit as unknown as RegExpExecArray);
    const rad = parseFloat(hit.groups!.nm!);
    let ring: Pt[];
    if (hit.groups!.a && hit.groups!.b) {
      ring = jpCircleMinusFan(ctr, rad, parseFloat(hit.groups!.a), parseFloat(hit.groups!.b));
    } else {
      ring = jpCircle(ctr, rad);
    }
    if (ring.length < 3) continue;
    const label = jpAreaTitle(blob, hit.index!) || `AREA-${i}`;
    const nr = `NR.${i}`;
    const name = prefix ? `${prefix}-${label}` : label;
    out[nr] = { name, ring };
  }
  return out;
}

const _AU_LL = /(\d{2})(\d{2})(\d{2})\s*([NS])\s+(\d{3})(\d{2})(\d{2})\s*([EW])/gi;
const _AU_AREA = /\b(?:Y[A-Z]{3}\/)?([MDRP]\d{3,4}[A-Z]?)(?![0-9])/gi;
const _AU_RUN = /\b([MRDP]\d{3,4})([A-Z]{2,})\b/gi;
// M = military operating area (YBBB/M277A DARWIN).
const _AU_DAH_ID = /\bY[A-Z]{3}\/([MRDP]\d{3,4}[A-Z]?)(?![0-9])/gi;
// ``YBBB/WILLIAMTOWN CTA C9`` — bước CTA, không phải R/D/M/P.
const _AU_CTA_ID =
  /\bY[A-Z]{3}(?:-Y[A-Z]{3})?\/(?<name>[A-Z][A-Z0-9'.\/\-]*(?:\s+[A-Z][A-Z0-9'.\/\-]*){0,6}\s+CTA\s+[A-Z]\d{1,2})\b/gi;
// Sông / đường bộ trong LATERAL LIMITS — không có toạ độ, không bịa dây cung.
const _AU_ALONG_OTHER = /then along (?!the\s+(?:counter[\s-]*clockwise|clockwise)\s+arc\b)/i;
const _AU_CIRCLE =
  /A circle(?:\s+of)?\s+radius\s+(?<rad>[\d.]+)\s*NM\s+centr(?:e|ed)(?:\s+on)?\s+(?<clat>\d{2})(?<clatm>\d{2})(?<clats>\d{2})(?<cns>[NS])\s+(?<clond>\d{3})(?<clonm>\d{2})(?<clons>\d{2})(?<cew>[EW])/gi;
const _AU_ARC =
  /then along the (?<dir>counter[\s-]*clockwise|clockwise) arc of a circle radius\s+(?<rad>[\d.]+)\s*NM\s+centre\s+(?<clat>\d{2})(?<clatm>\d{2})(?<clats>\d{2})(?<cns>[NS])\s+(?<clond>\d{3})(?<clonm>\d{2})(?<clons>\d{2})(?<cew>[EW])/gi;
// H141/26 Funny Farm: ``Within 3NM radius of 280739S 1494224E``.
const _AU_WITHIN =
  /Within\s+(?:a\s+)?(?<rad>[\d.]+)\s*NM\s+radius\s+of\s+(?<clat>\d{2})(?<clatm>\d{2})(?<clats>\d{2})(?<cns>[NS])\s+(?<clond>\d{3})(?<clonm>\d{2})(?<clons>\d{2})(?<cew>[EW])/gi;
// ``YBBB/TDA ‘FUNNY FARM’`` / ``YBBB/TRA ‘FUNNYL’`` — không phải R/D DAH.
const _AU_TEMP = /\bY[A-Z]{3}\/(?<kind>TDA|TRA)\b/gi;

function auCoords(blob: string): Pt[] {
  const pts: Pt[] = [];
  for (const hit of (blob || "").matchAll(new RegExp(_AU_LL.source, "gi"))) {
    const p = auPtParts(hit[1]!, hit[2]!, hit[3]!, hit[4]!, hit[5]!, hit[6]!, hit[7]!, hit[8]!);
    if (pts.length && ptsEqual(p, pts[pts.length - 1]!)) continue;
    if (pts.length >= 3 && ptsEqual(p, pts[0]!)) break;
    pts.push(p);
  }
  return pts;
}

function auCirclePt(g: Record<string, string | undefined>): Pt {
  return auPtParts(g.clat!, g.clatm!, g.clats!, g.cns!, g.clond!, g.clonm!, g.clons!, g.cew!);
}

function auCircle(m: { groups?: Record<string, string | undefined> }): Pt[] {
  const g = m.groups!;
  const ctr = auCirclePt(g);
  const rad = parseFloat(g.rad || "0");
  if (rad <= 0) return [];
  const out: Pt[] = [];
  for (let i = 0; i < 24; i++) out.push(destPoint(ctr[0], ctr[1], (360 * i) / 24, rad));
  return out;
}

function auRing(blob: string): Pt[] {
  const chunk = blob.split(/VERTICAL LIMITS/i)[0] || "";
  const circ = execFirst(_AU_CIRCLE, chunk) || execFirst(_AU_WITHIN, chunk);
  const hasArc = execFirst(_AU_ARC, chunk) !== null;
  if (circ && !hasArc) {
    const extra = auCoords(chunk.slice(0, circ.index) + chunk.slice(circ.index + circ[0].length));
    if (extra.length < 3) return auCircle(circ);
  }
  const ring: Pt[] = [];
  let pos = 0;
  const re = new RegExp(_AU_ARC.source, "gi");
  let arc: RegExpExecArray | null;
  while ((arc = re.exec(chunk))) {
    ring.push(...auCoords(chunk.slice(pos, arc.index)));
    const nxt = auCoords(chunk.slice(arc.index + arc[0].length));
    const dir = (arc.groups!.dir || "").toLowerCase();
    const clockwise = !dir.includes("counter");
    const ctr = auCirclePt(arc.groups!);
    const rad = parseFloat(arc.groups!.rad || "0");
    if (ring.length && nxt.length && rad > 0) {
      ring.push(...arcPoints(ctr, ring[ring.length - 1]!, nxt[0]!, rad, clockwise, 12));
    }
    pos = arc.index + arc[0].length;
  }
  ring.push(...auCoords(chunk.slice(pos)));
  return ring;
}

function execFirst(rx: RegExp, blob: string): RegExpExecArray | null {
  const re = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags.replace("g", "") : rx.flags);
  return re.exec(blob);
}

/** ``R225ABCDEF`` / ``M277ABCD`` → từng ô; ``R232`` / ``YBBB/D615`` giữ nguyên. */
export function expand_au_area_ids(text: string): string[] {
  const blob = String(text || "").toUpperCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const spans: [number, number][] = [];
  const add = (key: string) => {
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };
  for (const m of blob.matchAll(new RegExp(_AU_RUN.source, "gi"))) {
    const pref = m[1]!.toUpperCase(), letters = m[2]!.toUpperCase();
    for (const ch of letters) add(pref + ch);
    spans.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of blob.matchAll(new RegExp(_AU_AREA.source, "gi"))) {
    if (spans.some(([a, b]) => a <= m.index! && m.index! < b)) continue;
    const tail = blob.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    if (/^\/\d/.test(tail)) continue;
    add(m[1]!.toUpperCase());
  }
  return out;
}

/** Bảng kích hoạt SUP Úc: ``AREA VERTICAL LIMIT(S)`` — H115 / H119. */
export function au_sup_area_ids(text: string): string[] {
  const blob = String(text || "");
  const hit = /AREA\s+VERTICAL\s+LIMITS?[\s\S]+/i.exec(blob);
  let chunk = hit ? hit[0] : blob;
  chunk = chunk.split(/\n\s*2\.\d|\n\s*Page\s+\d/i)[0] || "";
  return expand_au_area_ids(chunk);
}

/** Chỉ nhận ranh bằng toạ độ và cung tròn. Bỏ CTA đi theo sông/xa lộ. */
function auLateralPlain(piece: string): boolean {
  const chunk = piece.split(/VERTICAL LIMITS/i)[0] || "";
  return !_AU_ALONG_OTHER.test(chunk);
}

/** ``YBBB/R232`` và ``YBBB/WILLIAMTOWN CTA C9`` + LATERAL LIMITS trong DAH. */
export function parse_australia_dah_text(text: string): Record<string, Pt[]> {
  const blob = String(text || "");
  const hits: [number, number, string, boolean][] = [];
  for (const hit of blob.matchAll(new RegExp(_AU_DAH_ID.source, "gi"))) {
    hits.push([hit.index!, hit.index! + hit[0].length, hit[1]!.toUpperCase(), false]);
  }
  for (const hit of blob.matchAll(new RegExp(_AU_CTA_ID.source, "gi"))) {
    const name = (hit.groups!.name || "").replace(/\s+/g, " ").trim().toUpperCase();
    hits.push([hit.index!, hit.index! + hit[0].length, name, true]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  const out: Record<string, Pt[]> = {};
  for (let i = 0; i < hits.length; i++) {
    const [, end, ident, cta] = hits[i]!;
    const nxt = i + 1 < hits.length ? hits[i + 1]![0] : blob.length;
    const piece = blob.slice(end, nxt);
    if (!/LATERAL/i.test(piece)) continue;
    if (cta && !auLateralPlain(piece)) continue;
    const ring = auRing(piece);
    if (ring.length >= 3 && !(ident in out)) out[ident] = ring;
  }
  return out;
}

/** ``YBBB/TDA ‘FUNNY FARM’`` → ``TDA FUNNY FARM``. */
function auTempName(kind: string, piece: string): string {
  const head = piece.split(/\b(?:LATERAL|VERTICAL|ROCKET|HOURS|CONTACT|CONTROLLING)\b/i)[0] || "";
  let name = head.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  const code = kind.toUpperCase();
  if (!name) return code;
  if (name.startsWith(code + " ")) return name;
  return `${code} ${name}`;
}

/** ``YMMM/D426C`` + LATERAL LIMITS — bỏ ``proximity of R639C`` trước TRA. */
function auAreaIsDefined(blob: string, hit: RegExpExecArray, piece: string): boolean {
  const prefix = blob.slice(Math.max(0, hit.index! - 6), hit.index!);
  if (/Y[A-Z]{3}\/$/i.test(prefix)) return true;
  const lat = /LATERAL\s+LIMITS/i.exec(piece);
  if (!lat) return false;
  const temp = execFirst(_AU_TEMP, piece);
  if (temp && temp.index! < lat.index!) return false;
  return true;
}

/** Danger/restricted Úc: ``YMMM/D426A`` + LATERAL LIMITS; TDA/TRA vòng tròn. */
export function parse_australia_sup_text(text: string, supKey = ""): RingTable {
  const blob = String(text || "");
  const out: RingTable = {};
  const temps = [...blob.matchAll(new RegExp(_AU_TEMP.source, "gi"))];
  for (let i = 0; i < temps.length; i++) {
    const hit = temps[i]!;
    const end = i + 1 < temps.length ? temps[i + 1]!.index! : blob.length;
    const piece = blob.slice(hit.index! + hit[0].length, end);
    const u = piece.toUpperCase();
    if (!u.includes("LATERAL") && !u.includes("LIMITS")) continue;
    const ring = auRing(piece);
    if (ring.length < 3) continue;
    const name = auTempName(hit.groups!.kind!, piece);
    let key = name, n = 2;
    while (key in out) { key = `${name}-${n}`; n++; }
    out[key] = { name, ring };
  }
  const hits = [...blob.matchAll(new RegExp(_AU_AREA.source, "gi"))];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const ident = hit[1]!.toUpperCase();
    const end = i + 1 < hits.length ? hits[i + 1]!.index! : blob.length;
    const piece = blob.slice(hit.index! + hit[0].length, end);
    if (ident in out) continue;
    const u = piece.toUpperCase();
    if (!u.includes("LATERAL") && !u.includes("LIMITS")) continue;
    if (!auAreaIsDefined(blob, hit, piece)) continue;
    const ring = auRing(piece);
    if (ring.length < 3) continue;
    out[ident] = { name: ident, ring };
  }
  if (Object.keys(out).length) return out;
  let n = 1;
  const seenCirc = new Set<string>();
  for (const rx of [_AU_WITHIN, _AU_CIRCLE]) {
    for (const circ of blob.matchAll(new RegExp(rx.source, "gi"))) {
      const ring = auCircle(circ);
      if (ring.length < 3) continue;
      const ctr = auCirclePt(circ.groups!);
      const keyPt = `${(+circ.groups!.rad!).toFixed(4)}|${ctr[0].toFixed(5)}|${ctr[1].toFixed(5)}`;
      if (seenCirc.has(keyPt)) continue;
      seenCirc.add(keyPt);
      const label = supKey ? `${supKey}-${n}` : `NR.${n}`;
      out[`NR.${n}`] = { name: label, ring };
      n++;
    }
    if (Object.keys(out).length) break;
  }
  if (Object.keys(out).length) return out;
  const ring = auCoords(blob);
  if (ring.length >= 3) out["NR.1"] = { name: supKey || "SUP", ring };
  return out;
}

const _TW_LL = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*N\s*[,/]?\s+(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*E/gi;
// ``Operational hours: Daily 2200-1000UTC`` — đem so với giờ bay trên OFP.
const _TW_HOURS = /Operational\s+hours?\s*:\s*(?<dly>DAILY|DLY)?\s*(?<fm>\d{4})\s*-\s*(?<to>\d{4})/i;

/** Polygon ``241000N 1203100E- 235400N ...`` từ eAIP Đài Loan (HTML/text). */
export function parse_taiwan_sup_text(text: string, supKey = ""): RingTable {
  let blob = String(text || "").replace(/<[^>]+>/g, " ");
  blob = blob.replace(/&nbsp;|&#160;/gi, " ");
  const pts: Pt[] = [];
  for (const m of blob.matchAll(new RegExp(_TW_LL.source, "gi"))) {
    const lat = +m[1]! + +m[2]! / 60 + parseFloat(m[3]!) / 3600;
    const lon = +m[4]! + +m[5]! / 60 + parseFloat(m[6]!) / 3600;
    const p: Pt = [round6(lat), round6(lon)];
    if (pts.length && ptsEqual(p, pts[pts.length - 1]!)) continue;
    if (pts.length >= 3 && ptsEqual(p, pts[0]!)) break;
    pts.push(p);
  }
  if (pts.length < 3) return {};
  let name: string;
  if (/\bArea\s*B\b/i.test(blob)) name = "AREA-B";
  else if (/\bTOWER\s+CRANES?\b/i.test(blob)) name = supKey ? `SUP ${supKey}` : "TOWER CRANE";
  else name = supKey || "SUP";
  return { "NR.1": { name, ring: pts } };
}

/** ``Operational hours: Daily 2200-1000UTC`` → ``DAILY 2200-1000``. */
export function parse_taiwan_sup_hours(text: string): string {
  const blob = String(text || "").replace(/<[^>]+>/g, " ");
  const m = _TW_HOURS.exec(blob);
  if (!m) return "";
  const head = m.groups!.dly ? "DAILY " : "";
  return `${head}${m.groups!.fm}-${m.groups!.to}`;
}

export const _internal = { destPoint, arcPoints, coords, auRing, auCoords };
