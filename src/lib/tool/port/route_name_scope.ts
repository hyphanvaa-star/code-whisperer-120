// Route-name scope: ICAO airway / navaid identifiers are not globally unique
// (A464 exists in both Australia and Singapore). A NOTAM naming a route only
// concerns OUR flight when the flight flies that name near the NOTAM's own
// FIR/centre. Browser-safe, no imports.

type P = Record<string, unknown>;

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
export function gcNm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ICAO4 = /^[A-Z]{4}$/;
const COORD = /(\d{2})(\d{2})([NS])\s*(\d{3})(\d{2})([EW])(\d{3})?/;

export interface NotamQ { fir: string; lat: number | null; lon: number | null; radius: number }

/** FIR, centre and radius from the NOTAM Q-line (or its coords field). */
export function notamQ(n: P): NotamQ {
  const blob = `${String(n.text ?? "")}\n${String(n.e_field ?? "")}`.toUpperCase();
  const qLine = blob.split("\n").find((l) => l.trim().startsWith("Q)")) || "";
  let fir = String(n.qfir ?? "").trim().toUpperCase();
  if (!ICAO4.test(fir)) fir = (/Q\)\s*([A-Z]{4})\s*\//.exec(qLine)?.[1]) || "";
  const src = (qLine && COORD.test(qLine.split("/").pop() || "")) ? (qLine.split("/").pop() || "") : String(n.coords ?? "").toUpperCase();
  const m = COORD.exec(src);
  if (!m) return { fir, lat: null, lon: null, radius: 0 };
  let lat = parseInt(m[1]!, 10) + parseInt(m[2]!, 10) / 60;
  if (m[3] === "S") lat = -lat;
  let lon = parseInt(m[4]!, 10) + parseInt(m[5]!, 10) / 60;
  if (m[6] === "W") lon = -lon;
  return { fir, lat, lon, radius: m[7] ? parseInt(m[7], 10) : 0 };
}

const key = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "");

/** Track points where the flight flies `token` (airway legs incl. their entry point, or a named fix/navaid). */
export function flownPoints(token: string, points: P[]): P[] {
  const t = key(token), out = new Set<number>();
  points.forEach((p, i) => {
    if (key(p.airway) === t) { out.add(i); if (i > 0) out.add(i - 1); }
    else if (key(p.name) === t) out.add(i);
  });
  return [...out].sort((a, b) => a - b).map((i) => points[i]!)
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
}

/** Extra distance beyond the NOTAM radius before a same-name route counts as a different route. */
export const ROUTE_NAME_MARGIN_NM = 300;

/**
 * True when every place the flight uses `token` is clearly elsewhere than the NOTAM:
 * a different FIR (when both sides carry ICAO FIR codes) and/or farther than the
 * NOTAM radius + margin from its Q-line centre. Unknown positions stay "not remote"
 * so nothing is hidden without evidence.
 */
export function routeNameRemote(n: P, token: string, points?: P[] | null): boolean {
  if (!points?.length) return false;
  const ours = flownPoints(token, points);
  if (!ours.length) return false;
  const q = notamQ(n);
  const firs = new Set(ours.map((p) => key(p.fir)).filter((f) => ICAO4.test(f)));
  const firKnown = !!q.fir && firs.size > 0;
  if (firKnown && firs.has(q.fir)) return false;
  if (q.lat != null && q.lon != null) {
    if (q.radius >= 999 && firKnown) return true;
    const limit = (q.radius >= 999 ? 999 : q.radius) + ROUTE_NAME_MARGIN_NM;
    const near = Math.min(...ours.map((p) => gcNm([q.lat!, q.lon!], [Number(p.lat), Number(p.lon)])));
    return near > limit;
  }
  return firKnown;
}
