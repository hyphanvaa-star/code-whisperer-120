// Fallback route source: waypoint coordinates from the OFP NAV LOG
// (tokens like N21100E105595 = N21°10.0' E105°59.5') when JetPlan KML is unavailable.
export interface NavPoint { name: string; lon: number; lat: number; alt_m: number; fl_ft: number; ete_min: number; airway: string; fir: string }

const COORD = /\b([NS])(\d{2})(\d{2})(\d)?\s?([EW])(\d{3})(\d{2})(\d)?\b/g;
const NAME = /\b([A-Z][A-Z0-9]{1,5})\b/g;
const SKIP = new Set(["FL", "FIR", "AWY", "MSA", "TAS", "GS", "ETO", "ATO", "TOC", "TOD", "FUEL", "REM", "DIST", "TIME", "NAV", "LOG", "WIND", "TEMP", "MAG", "TRK", "HDG", "UTC", "EET", "CFP", "FRQ", "FREQ", "MN", "ZT", "CT", "AFOB", "EFOB", "ATA", "ETA"]);

const deg = (d: string, m: string, t: string | undefined) => parseInt(d, 10) + (parseInt(m, 10) + (t ? parseInt(t, 10) / 10 : 0)) / 60;

export function parseNavlog(text: string): { points: NavPoint[]; line: [number, number][] } {
  const lines = String(text || "").split(/\r?\n/);
  const points: NavPoint[] = [];
  let lastName = "";
  for (const raw of lines) {
    const ln = raw.toUpperCase();
    COORD.lastIndex = 0;
    const hits = [...ln.matchAll(COORD)];
    if (!hits.length) {
      // a pure name line can precede its coordinate line
      const names = [...ln.matchAll(NAME)].map((m) => m[1]!).filter((n) => !SKIP.has(n) && !/^\d/.test(n));
      if (names.length) lastName = (names.length >= 2 ? names[1] : names[0])!;
      continue;
    }
    for (const h of hits) {
      const lat = deg(h[2]!, h[3]!, h[4]) * (h[1] === "S" ? -1 : 1);
      const lon = deg(h[6]!, h[7]!, h[8]) * (h[5] === "W" ? -1 : 1);
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) continue;
      const before = ln.slice(0, h.index!);
      const names = [...before.matchAll(NAME)].map((m) => m[1]!).filter((n) => !SKIP.has(n));
      const name = (names.length >= 2 ? names[1] : names[0]) || lastName || `${h[1]}${h[2]}${h[5]}${h[6]}`;
      const prev = points[points.length - 1];
      if (prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lon - lon) < 1e-6) continue;
      points.push({ name, lat, lon, alt_m: 0, fl_ft: 0, ete_min: 0, airway: "", fir: "" });
    }
    lastName = "";
  }
  // OFPs often repeat the NAV LOG (e.g. alternate section); keep the first pass only.
  const seen = new Set<string>();
  const uniq: NavPoint[] = [];
  for (const p of points) {
    const k = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  return { points: uniq, line: uniq.map((p) => [p.lon, p.lat]) };
}
