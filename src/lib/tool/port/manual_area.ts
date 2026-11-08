// Browser-safe parser + track check for dispatcher-pasted airspace coordinates.
// Every function is self-contained so the tool-page shim can inline it via toString().

export type MaPt = [number, number];
export interface MaArea { shape: "polygon" | "circle"; ring: MaPt[]; lat?: number; lon?: number; radius_nm?: number }
export interface MaTrackPt { lat: number; lon: number; fl_ft?: number; name?: string }
export interface MaResult { dist_nm: number | null; inside: boolean; name: string; fl: number | null; flHit: boolean | null }

/** Parse "210030N 1053045E - 2130N10530E …" (DMS/DM/D, optional decimals) and "RADIUS 10NM CENTERED …". */
export function maParse(text: string): MaArea | null {
  const T = String(text || "").toUpperCase().replace(/[°º'"’”]/g, " ");
  const re = /(\d{2,6}(?:\.\d+)?)\s*([NS])[\s,\/]*(\d{3,7}(?:\.\d+)?)\s*([EW])/g;
  const conv = (raw: string, degLen: number): number | null => {
    const [int, dec = ""] = raw.split(".");
    const d = int!.slice(0, degLen), rest = int!.slice(degLen);
    let v = +d;
    if (rest.length === 0) v = +(int + (dec ? "." + dec : ""));
    else if (rest.length === 2) v += +(rest + (dec ? "." + dec : "")) / 60;
    else if (rest.length === 4) v += +rest.slice(0, 2) / 60 + +(rest.slice(2) + (dec ? "." + dec : "")) / 3600;
    else return null;
    return v;
  };
  const pts: MaPt[] = [];
  for (const m of T.matchAll(re)) {
    const la = conv(m[1]!, 2), lo = conv(m[3]!, 3);
    if (la === null || lo === null || la > 90 || lo > 180) continue;
    pts.push([m[2] === "S" ? -la : la, m[4] === "W" ? -lo : lo]);
  }
  const rad = /(?:RADIUS|RAD|R)\s*(?:OF\s*)?(\d+(?:\.\d+)?)\s*(NM|KM|M)\b/.exec(T) || /(\d+(?:\.\d+)?)\s*(NM|KM)\s*RADIUS/.exec(T);
  if (rad && pts.length >= 1 && pts.length <= 2) {
    const n = +rad[1]!, u = rad[2];
    const nm = u === "KM" ? n / 1.852 : u === "M" ? n / 1852 : n;
    return { shape: "circle", ring: [], lat: pts[0]![0], lon: pts[0]![1], radius_nm: nm };
  }
  if (pts.length >= 3) {
    const a = pts[0]!, z = pts[pts.length - 1]!;
    const ring = Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9 ? pts.slice(0, -1) : pts;
    if (ring.length >= 3) return { shape: "polygon", ring };
  }
  return null;
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

/** Closest approach of the flight track to the area (0 when a track point/leg is inside). */
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
  // Densify legs so a leg crossing the area between waypoints is detected.
  const pts: (MaTrackPt & { fl_ft?: number })[] = [];
  for (let i = 0; i < track.length; i++) {
    const a = track[i]!; pts.push(a);
    const b = track[i + 1]; if (!b) continue;
    const steps = Math.min(200, Math.ceil(nm([a.lat, a.lon], [b.lat, b.lon]) / 5));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      pts.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, fl_ft: (a.fl_ft || 0) + ((b.fl_ft || 0) - (a.fl_ft || 0)) * t, name: `${a.name || ""}-${b.name || ""}` });
    }
  }
  let best: { d: number; p: MaTrackPt | null; in: boolean } = { d: Infinity, p: null, in: false };
  for (const p of pts) {
    let d: number, isIn = false;
    if (area.shape === "circle") { d = Math.max(0, nm([p.lat, p.lon], [area.lat!, area.lon!]) - (area.radius_nm || 0)); isIn = d === 0; }
    else if (inside([p.lat, p.lon], area.ring)) { d = 0; isIn = true; }
    else d = Math.min(...area.ring.map((v) => nm([p.lat, p.lon], v)));
    if (d < best.d) best = { d, p, in: isIn };
  }
  if (!best.p) return { dist_nm: null, inside: false, name: "", fl: null, flHit: null };
  const fl = best.p.fl_ft ? Math.round(best.p.fl_ft / 100) : null;
  return { dist_nm: best.d, inside: best.in, name: best.p.name || "", fl, flHit: band && fl !== null ? fl >= band[0] && fl <= band[1] : null };
}
