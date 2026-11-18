// Listed ATS route segments ("1. W195: N401609E1024104 - MORIT.") and their
// coordinate endpoints. Chinese NOTAMs often write a segment end as raw
// coordinates instead of the fix name the OFP uses; this module resolves such a
// coordinate against the flight's own track by position only (never by guessing
// a name). Browser-safe, no imports besides the great-circle helper.
import { gcNm } from "./route_name_scope";

type P = Record<string, unknown>;

/** Max distance (NM) from the flight's track for a coordinate endpoint to count as on the route. */
export const SEG_COORD_SNAP_NM = 3;

// Endpoint name in a listed segment: "YINCHUAN VOR'YHD'" -> YHD, "DOMVA" -> DOMVA.
function segPoint(raw: string): string {
  const q = /'([A-Z]{2,5})'/.exec(raw);
  if (q) return q[1]!;
  const w = raw.trim().split(/\s+/).pop() ?? "";
  return w.replace(/[^A-Z0-9]/g, "");
}

/** Numbered/listed ATS route segments "1. W215 : A - B." (two or more, or one with list numbering). */
export function atsSegmentList(E: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  const re = /(?:^|[\s.])(?:\d{1,2}[.)]\s*)?([A-Z]{1,2}\d{1,4}[A-Z]?)\s*:\s*([A-Z][A-Z0-9' ]*?)\s*-\s*([A-Z][A-Z0-9' ]*?)\s*(?=[.,;\n]|$)/g;
  for (const m of E.matchAll(re)) {
    const a = segPoint(m[2]!), b = segPoint(m[3]!);
    if (a && b) out.push([m[1]!, a, b]);
  }
  return out;
}

/**
 * Coordinate endpoint → [lat, lon]. Accepts N401609E1024104, N4016E10241,
 * 401609N1024104E and 4016N10241E. Anything else (fix names) → null.
 */
export function segCoord(raw: string): [number, number] | null {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  let m = /^([NS])(\d{4}|\d{6})([EW])(\d{5}|\d{7})$/.exec(s);
  let hs: string, la: string, hw: string, lo: string;
  if (m) [, hs, la, hw, lo] = m as unknown as [string, string, string, string, string];
  else {
    m = /^(\d{4}|\d{6})([NS])(\d{5}|\d{7})([EW])$/.exec(s);
    if (!m) return null;
    [, la, hs, lo, hw] = m as unknown as [string, string, string, string, string];
  }
  const dms = (d: string, degLen: number) => {
    const deg = +d.slice(0, degLen), min = +d.slice(degLen, degLen + 2), sec = d.length > degLen + 2 ? +d.slice(degLen + 2) : 0;
    return min < 60 && sec < 60 ? deg + min / 60 + sec / 3600 : NaN;
  };
  let lat = dms(la, 2), lon = dms(lo, 3);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat > 90 || lon > 180) return null;
  if (hs === "S") lat = -lat;
  if (hw === "W") lon = -lon;
  return [lat, lon];
}

const ll = (p: P | undefined): [number, number] | null => {
  const lat = Number(p?.lat), lon = Number(p?.lon);
  return p && Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? [lat, lon] : null;
};
const nameOf = (p: P | undefined) => String(p?.name ?? "").toUpperCase().trim();

/** Distance (NM) from `c` to leg a→b and the leg fraction of the closest point (local flat approximation). */
function legDist(c: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const k = Math.cos((c[0] * Math.PI) / 180);
  const ax = (a[1] - c[1]) * k, ay = a[0] - c[0], bx = (b[1] - c[1]) * k, by = b[0] - c[0];
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return [Math.hypot(ax + t * dx, ay + t * dy) * 60, t];
}

export interface CoordOnTrack {
  /** Track index used for FL/time (nearest point, or the closer end of the leg). */
  index: number;
  /** "~BUVEM" when a track point sits on the coordinate, else "BUVEM–MORIT" for the leg it lies on. */
  label: string;
  nm: number;
}

/** Where a coordinate endpoint lies on the flight's track, within SEG_COORD_SNAP_NM; null when off-track or unknown. */
export function coordOnTrack(raw: string, points?: P[] | null, maxNm = SEG_COORD_SNAP_NM): CoordOnTrack | null {
  const c = segCoord(raw);
  if (!c || !points?.length) return null;
  let best: CoordOnTrack | null = null;
  points.forEach((p, i) => {
    const q = ll(p);
    if (!q) return;
    const nm = gcNm(c, q);
    if (nm <= maxNm && (!best || nm < best.nm)) best = { index: i, label: nameOf(p) ? "~" + nameOf(p) : "", nm };
  });
  if (best) return best;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = ll(points[i]), b = ll(points[i + 1]);
    if (!a || !b) continue;
    const [nm, t] = legDist(c, a, b);
    if (nm <= maxNm && (!best || nm < (best as CoordOnTrack).nm)) {
      const na = nameOf(points[i]), nb = nameOf(points[i + 1]);
      best = { index: t < 0.5 ? i : i + 1, label: na && nb ? `${na}–${nb}` : "", nm };
    }
  }
  return best;
}

/** Endpoint is on this flight's route: a named fix in `known`, or a coordinate lying on the track. */
function endpointOnRoute(x: string, known: Set<string>, points?: P[] | null): boolean {
  return segCoord(x) ? !!coordOnTrack(x, points) : known.has(x);
}

/**
 * Coordinate endpoints of listed closed segments that concern this flight, for red
 * highlighting next to the airway/fix hits. A coordinate counts when its segment is
 * flown: the airway is already a route hit and the other end is on route, or both
 * ends are on the track (coordinate by position).
 */
export function segmentCoordHits(E: string, known: Set<string>, hits: Set<string>, points?: P[] | null): string[] {
  const out = new Set<string>();
  for (const [awy, a, b] of atsSegmentList(E)) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!segCoord(x) || !endpointOnRoute(y, known, points)) continue;
      if (hits.has(awy) || coordOnTrack(x, points)) out.add(x);
    }
  }
  return [...out];
}
