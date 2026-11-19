// Browser-safe parser + track check for dispatcher-pasted airspace coordinates.
// Every function is self-contained so the tool-page shim can inline it via toString().

export type MaPt = [number, number];
export interface MaArea {
  shape: "polygon" | "circle" | "point" | "line";
  ring: MaPt[];
  lat?: number; lon?: number; radius_nm?: number;
  /** "qline" when the circle comes from the NOTAM Q-line centre + radius only. */
  from?: "qline";
}
export interface MaTrackPt { lat: number; lon: number; fl_ft?: number; name?: string }
export interface MaResult { dist_nm: number | null; inside: boolean; name: string; fl: number | null; flHit: boolean | null }

/**
 * Parse pasted coordinates in any common style and decide the shape:
 *  - compact DMS/DM/D, hemisphere after ("210030N 1053045E", "2130N10530E") or before ("N210030 E1053045");
 *  - spaced / symbol DMS ("21°00'30\"N 105°30'45\"E", "21 15.5N 105 42.3E");
 *  - decimal degrees with or without hemisphere ("21.0285N 105.8542E", "21.0285, 105.8542");
 *  - "RADIUS 10NM CENTERED …", "WI 5NM OF …", NOTAM Q-line "…/2102N10548E010".
 * 1 point → point, 2 → line, ≥3 → polygon, point + radius → circle.
 */
export function maParse(text: string): MaArea | null {
  let T = String(text || "").toUpperCase().replace(/[°º˚'"’‘”“′″]/g, " ");
  const comp = (raw: string, degLen: number): number | null => {
    const [int = "", dec = ""] = raw.split(".");
    const f = dec ? "." + dec : "";
    if (int.length <= degLen) return +(int + f);
    const d = +int.slice(0, degLen), rest = int.slice(degLen);
    if (rest.length === 2) { const m = +(rest + f); return m < 60 ? d + m / 60 : null; }
    if (rest.length === 4) {
      const m = +rest.slice(0, 2), s = +(rest.slice(2) + f);
      return m < 60 && s < 60 ? d + m / 60 + s / 3600 : null;
    }
    return null;
  };
  const dms = (d: string, m?: string, s?: string): number | null => {
    const mm = m ? +m : 0, ss = s ? +s : 0;
    return mm < 60 && ss < 60 ? +d + mm / 60 + ss / 3600 : null;
  };
  const mk = (la: number | null, ns: string, lo: number | null, ew: string): MaPt | null =>
    la === null || lo === null || !isFinite(la) || !isFinite(lo) || la > 90 || lo > 180 ? null : [ns === "S" ? -la : la, ew === "W" ? -lo : lo];

  // NOTAM Q-line centre + 3-digit radius: used only when the text has no other coordinates.
  let q: { p: MaPt; r: number } | null = null;
  const qm = /Q\)[^\n]*?\/(\d{4}[NS]\d{5}[EW])(\d{3})(?!\d)/.exec(T) || /^\s*(\d{4}[NS]\d{5}[EW])(\d{3})\s*$/.exec(T);
  if (qm) {
    const c = /(\d{4})([NS])(\d{5})([EW])/.exec(qm[1]!)!;
    const p = mk(comp(c[1]!, 2), c[2]!, comp(c[3]!, 3), c[4]!);
    if (p) q = { p, r: +qm[2]! };
    const at = qm.index + qm[0].indexOf(qm[1]!), len = qm[1]!.length + 3;
    T = T.slice(0, at) + " ".repeat(len) + T.slice(at + len);
  }

  type Rule = [RegExp, (m: string[]) => MaPt | null];
  const N = "(\\d{1,2}(?:\\.\\d+)?)";
  const suffix: Rule[] = [
    [new RegExp(`(?<![\\d.])(\\d{1,2})\\s+${N}(?:\\s+${N})?\\s*([NS])(?![A-Z])[\\s,\\/]*(?<![\\d.])(\\d{1,3})\\s+${N}(?:\\s+${N})?\\s*([EW])(?![A-Z])`, "g"),
      (m) => mk(dms(m[1]!, m[2], m[3]), m[4]!, dms(m[5]!, m[6], m[7]), m[8]!)],
    [/(?<![\d.])(\d{1,6}(?:\.\d+)?)\s*([NS])(?![A-Z])[\s,\/]*(\d{1,7}(?:\.\d+)?)\s*([EW])(?![A-Z])/g,
      (m) => mk(comp(m[1]!, 2), m[2]!, comp(m[3]!, 3), m[4]!)],
  ];
  const prefix: Rule[] = [
    [new RegExp(`(?<![A-Z0-9])([NS])\\s*(\\d{1,2})\\s+${N}(?:\\s+${N})?(?![\\d.])[\\s,\\/]*([EW])\\s*(\\d{1,3})\\s+${N}(?:\\s+${N})?(?![\\d.])`, "g"),
      (m) => mk(dms(m[2]!, m[3], m[4]), m[1]!, dms(m[6]!, m[7], m[8]), m[5]!)],
    [/(?<![A-Z0-9])([NS])\s*(\d{1,6}(?:\.\d+)?)(?![\d.])[\s,\/]*([EW])\s*(\d{1,7}(?:\.\d+)?)(?![\d.])/g,
      (m) => mk(comp(m[2]!, 2), m[1]!, comp(m[4]!, 3), m[3]!)],
  ];
  const run = (src: string, rules: Rule[]): MaPt[] => {
    const found: { i: number; p: MaPt }[] = [];
    let s = src;
    for (const [re, f] of rules) {
      s = s.replace(re, (...a: unknown[]) => {
        const m = a.slice(0, -2).map((x) => (x === undefined ? undefined : String(x))) as string[];
        const p = f(m);
        if (!p) return m[0]!;
        found.push({ i: a[a.length - 2] as number, p });
        return " ".repeat(m[0]!.length);
      });
    }
    return found.sort((x, y) => x.i - y.i).map((x) => x.p);
  };
  const sp = run(T, suffix), pp = run(T, prefix);
  let pts = pp.length > sp.length ? pp : sp;
  if (!pts.length) {
    // Plain decimal pairs (Google Maps / GPS): "21.0285, 105.8542".
    for (const m of T.matchAll(/(?<![\d.A-Z])(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)(?![\d.])/g)) {
      const la = +m[1]!, lo = +m[2]!;
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) pts.push([la, lo]);
    }
  }
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1]);

  const rad = /\b(?:RADIUS|RAD|R)\s*(?:OF\s*)?(\d+(?:\.\d+)?)\s*(NM|KM|M)\b/.exec(T)
    || /(\d+(?:\.\d+)?)\s*(NM|KM)\s*(?:RADIUS|RAD)\b/.exec(T)
    || /\b(?:WI|WITHIN)\s*(\d+(?:\.\d+)?)\s*(NM|KM)\b/.exec(T);
  const toNm = (n: number, u: string) => (u === "KM" ? n / 1.852 : u === "M" ? n / 1852 : n);
  if (rad && pts.length >= 1 && pts.length <= 2) {
    return { shape: "circle", ring: [], lat: pts[0]![0], lon: pts[0]![1], radius_nm: toNm(+rad[1]!, rad[2]!) };
  }
  if (!pts.length) {
    if (q && q.r > 0 && q.r < 999) return { shape: "circle", ring: [], lat: q.p[0], lon: q.p[1], radius_nm: rad ? toNm(+rad[1]!, rad[2]!) : q.r, from: "qline" };
    return null;
  }
  if (pts.length >= 3) {
    const a = pts[0]!, z = pts[pts.length - 1]!;
    const ring = Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9 ? pts.slice(0, -1) : pts;
    if (ring.length >= 3) return { shape: "polygon", ring };
    pts = ring;
  }
  if (pts.length === 2) return { shape: "line", ring: pts };
  return { shape: "point", ring: [pts[0]!], lat: pts[0]![0], lon: pts[0]![1] };
}

/** Parse "SFC-FL240", "FL100 - FL300", "5000FT-FL150" into [loFL, hiFL]; empty → null. */
export function maBand(text: string): [number, number] | null {
  const T = String(text || "").toUpperCase().trim();
  if (!T) return null;
  const one = (s: string): number | null => {
    s = s.trim();
    if (/^(SFC|GND|MSL)$/.test(s)) return 0;
    if (/^(UNL|UNLTD|UNLIMITED)$/.test(s)) return 999;
    let m = /^FL\s*(\d{2,3})$/.exec(s); if (m) return +m[1]!;
    m = /^(\d{3,5})\s*(FT|AMSL|MSL|FT AMSL)?$/.exec(s); if (m) return Math.round(+m[1]! / 100);
    return null;
  };
  const parts = T.split(/\s*(?:-|–|TO)\s*/);
  if (parts.length !== 2) return null;
  const lo = one(parts[0]!), hi = one(parts[1]!);
  return lo === null || hi === null ? null : [Math.min(lo, hi), Math.max(lo, hi)];
}

/** Closest approach of the flight track to the area/point/line (0 when the track enters the area or crosses the line). */
export function maCheck(area: MaArea, track: MaTrackPt[], band: [number, number] | null): MaResult {
  const R = 3440.065, rad = Math.PI / 180;
  const nm = (a: MaPt, b: MaPt) => {
    const dl = (b[0] - a[0]) * rad, dn = (b[1] - a[1]) * rad;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const inside = (p: MaPt, ring: MaPt[]) => {
    let odd = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i]!, [yj, xj] = ring[j]!;
      if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  // Distance (NM) from p to segment a-b on a local flat projection, never more than the nearer endpoint.
  const segD = (p: MaPt, a: MaPt, b: MaPt) => {
    const k = Math.cos(p[0] * rad) * 60;
    const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * 60, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * 60;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    return Math.min(Math.hypot(ax + t * dx, ay + t * dy), nm(p, a), nm(p, b));
  };
  // Parameter t on a-b where it crosses c-d (flat projection), or null.
  const cross = (a: MaPt, b: MaPt, c: MaPt, d: MaPt): number | null => {
    const k = Math.cos(((a[0] + b[0] + c[0] + d[0]) / 4) * rad);
    const P = (v: MaPt) => [v[1] * k, v[0]];
    const [x1, y1] = P(a), [x2, y2] = P(b), [x3, y3] = P(c), [x4, y4] = P(d);
    const den = (x1! - x2!) * (y3! - y4!) - (y1! - y2!) * (x3! - x4!);
    if (Math.abs(den) < 1e-12) return null;
    const t = ((x1! - x3!) * (y3! - y4!) - (y1! - y3!) * (x3! - x4!)) / den;
    const u = -((x1! - x2!) * (y1! - y3!) - (y1! - y2!) * (x1! - x3!)) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  };
  const edges = (ring: MaPt[], closed: boolean) => {
    const out: [MaPt, MaPt][] = [];
    for (let i = 0; i + 1 < ring.length; i++) out.push([ring[i]!, ring[i + 1]!]);
    if (closed && ring.length > 2) out.push([ring[ring.length - 1]!, ring[0]!]);
    return out;
  };
  const between = (a: MaTrackPt, b: MaTrackPt, t: number): MaTrackPt => ({
    lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
    fl_ft: (a.fl_ft || 0) + ((b.fl_ft || 0) - (a.fl_ft || 0)) * t, name: `${a.name || ""}-${b.name || ""}`,
  });
  // Densify legs so a leg passing the area between waypoints is detected.
  const pts: MaTrackPt[] = [];
  for (let i = 0; i < track.length; i++) {
    const a = track[i]!; pts.push(a);
    const b = track[i + 1]; if (!b) continue;
    const steps = Math.min(200, Math.ceil(nm([a.lat, a.lon], [b.lat, b.lon]) / 5));
    for (let k = 1; k < steps; k++) pts.push(between(a, b, k / steps));
  }
  const ring = area.ring || [];
  const centre: MaPt = [area.lat ?? ring[0]?.[0] ?? 0, area.lon ?? ring[0]?.[1] ?? 0];
  const sides = area.shape === "polygon" ? edges(ring, true) : area.shape === "line" ? edges(ring, false) : [];
  let best: { d: number; p: MaTrackPt | null; in: boolean } = { d: Infinity, p: null, in: false };
  if (area.shape === "line") {
    for (let i = 0; i + 1 < track.length && !best.in; i++) {
      const a = track[i]!, b = track[i + 1]!;
      const t = cross([a.lat, a.lon], [b.lat, b.lon], ring[0]!, ring[1]!);
      if (t !== null) best = { d: 0, p: between(a, b, t), in: true };
    }
  }
  if (!best.in) for (const p of pts) {
    const v: MaPt = [p.lat, p.lon];
    let d: number, isIn = false;
    if (area.shape === "circle") { d = Math.max(0, nm(v, centre) - (area.radius_nm || 0)); isIn = d === 0; }
    else if (area.shape === "point") d = nm(v, centre);
    else if (area.shape === "polygon" && inside(v, ring)) { d = 0; isIn = true; }
    else d = Math.min(...sides.map(([a, b]) => segD(v, a, b)));
    if (d < best.d) best = { d, p, in: isIn };
  }
  if (!best.p) return { dist_nm: null, inside: false, name: "", fl: null, flHit: null };
  const fl = best.p.fl_ft ? Math.round(best.p.fl_ft / 100) : null;
  return { dist_nm: best.d, inside: best.in, name: best.p.name || "", fl, flHit: band && fl !== null ? fl >= band[0] && fl <= band[1] : null };
}
