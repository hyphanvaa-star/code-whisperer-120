// International SIGMET (AWC isigmet JSON) → compact map items for the NOTAM map.
// Browser-safe and pure: the server handler fetches, this module only shapes.

export type SgPt = [number, number]; // [lat, lon]
export interface SgItem {
  id: string;
  fir: string;
  fir_name: string;
  hazard: string;        // TS | TURB | ICE | MTW | TC | VA | …
  qualifier: string;
  base_fl: number | null;
  top_fl: number | null;
  from: number;          // unix seconds
  to: number;
  dir: string;
  spd: string;
  chng: string;
  kind: "obs" | "fcst";
  rings: SgPt[][];
  volcano: { name: string; lat: number; lon: number } | null;
  raw: string;
}

/** Dispatch network window (Vietjet: SE/E Asia, India, Australia, Central Asia). */
export const SG_REGION = { s: -48, n: 66, w: 40, e: 182 };

type RawPt = { lat?: unknown; lon?: unknown };
type Raw = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(+v!) ? null : +v!);
const fl = (ft: unknown): number | null => { const n = num(ft); return n === null ? null : Math.round(n / 100); };

function ringOf(list: unknown): SgPt[] {
  if (!Array.isArray(list)) return [];
  const out: SgPt[] = [];
  for (const p of list as RawPt[]) {
    const la = num(p && p.lat), lo = num(p && p.lon);
    if (la === null || lo === null) continue;
    out.push([la, lo]);
  }
  return out.length >= 3 ? out : [];
}

function ringsOf(r: Raw): SgPt[][] {
  const c = r["coords"];
  if (!Array.isArray(c) || !c.length) return [];
  if (Array.isArray(c[0])) return (c as unknown[]).map(ringOf).filter((x) => x.length);
  const one = ringOf(c);
  return one.length ? [one] : [];
}

/** "PSN N0142 E12754" / "PSN S0806 E11255" → decimal degrees. */
export function sgVolcanoPsn(raw: string): { lat: number; lon: number } | null {
  const m = /PSN\s+([NS])(\d{2})(\d{2})\s*([EW])(\d{3})(\d{2})/.exec(String(raw || "").toUpperCase());
  if (!m) return null;
  const lat = (+m[2]! + +m[3]! / 60) * (m[1] === "S" ? -1 : 1);
  const lon = (+m[5]! + +m[6]! / 60) * (m[4] === "W" ? -1 : 1);
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

function volcanoName(q: string, raw: string): string {
  const s = (q || "").toUpperCase();
  const m = /\bMT\s+([A-Z][A-Z\- ]+)/.exec(s) || /\bVOLCAN\s+([A-Z][A-Z\- ]+)/.exec(s);
  if (m) return m[1]!.trim();
  const r = /\bVA\s+(?:ERUPTION\s+)?(?:MT\s+)?([A-Z][A-Z\-]+(?:\s[A-Z][A-Z\-]+)?)\s+PSN/.exec(String(raw || "").toUpperCase());
  return r ? r[1]!.trim() : s.replace(/^ERUPTION\s+/, "").trim();
}

function inRegion(rings: SgPt[][], box = SG_REGION): boolean {
  for (const ring of rings) for (const [la, lo] of ring) {
    const l = lo < 0 ? lo + 360 : lo;
    if (la >= box.s && la <= box.n && l >= box.w && l <= box.e) return true;
  }
  return false;
}

/** Shape the AWC list: drop expired/out-of-region rows; repeated raw = OBS then FCST polygon. */
export function sigmetItems(list: unknown, nowSec: number, box = SG_REGION): SgItem[] {
  if (!Array.isArray(list)) return [];
  const seen: Record<string, number> = {};
  const out: SgItem[] = [];
  for (const r of list as Raw[]) {
    if (!r || typeof r !== "object") continue;
    const raw = String(r["rawSigmet"] ?? "").trim();
    const to = num(r["validTimeTo"]) ?? 0, from = num(r["validTimeFrom"]) ?? 0;
    const idx = (seen[raw] = (seen[raw] ?? -1) + 1);
    if (to && to <= nowSec) continue;
    const rings = ringsOf(r);
    if (!rings.length || !inRegion(rings, box)) continue;
    const hazard = String(r["hazard"] ?? "").toUpperCase();
    const qualifier = String(r["qualifier"] ?? "").trim();
    const fir = String(r["firId"] ?? r["icaoId"] ?? "").toUpperCase();
    const kind: "obs" | "fcst" = idx > 0 && /\bFCST\b/.test(raw.toUpperCase()) ? "fcst" : "obs";
    const psn = hazard === "VA" ? sgVolcanoPsn(raw) : null;
    out.push({
      id: `${fir}-${String(r["seriesId"] ?? "")}-${from}-${idx}`,
      fir,
      fir_name: String(r["firName"] ?? fir),
      hazard,
      qualifier,
      base_fl: fl(r["base"]),
      top_fl: fl(r["top"]),
      from, to,
      dir: String(r["dir"] ?? "") || "",
      spd: String(r["spd"] ?? "") || "",
      chng: String(r["chng"] ?? "") || "",
      kind,
      rings,
      volcano: psn ? { name: volcanoName(qualifier, raw), ...psn } : null,
      raw,
    });
  }
  return out;
}
