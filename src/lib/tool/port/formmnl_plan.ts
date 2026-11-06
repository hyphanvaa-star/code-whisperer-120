// FORM MNL plan identity: browser-safe helpers that turn a KHB Crewlist row
// (local date + local ETD + UTC ETD, IATA route) into the exact sector, then
// pick that day's CFP (plan_no) from the FliteBrief catalogue and verify a
// JetPlan View ICAO page belongs to it.
import iataIcao from "../data/iata-icao.json";

const IATA = iataIcao as Record<string, string>;

/** IATA → ICAO (ICAO codes pass through); unknown codes return "". */
export function mnlIcao(code: string): string {
  const c = String(code || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (c.length === 4) return c;
  if (c.length === 3) return IATA[c] || "";
  return "";
}

function ymd(date: string): [number, number, number] | null {
  const d = String(date || "");
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return [+m[1]!, +m[2]!, +m[3]!];
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(d);
  if (!m) return null;
  let y = +m[3]!;
  if (y < 100) y += 2000;
  return [y, +m[2]!, +m[1]!];
}
function hm(s: string): [number, number] | null {
  const m = /(\d{1,2}):?(\d{2})/.exec(String(s || ""));
  return m ? [+m[1]!, +m[2]!] : null;
}

/**
 * UTC departure instant of a Crewlist row. The Crewlist date is the LOCAL
 * date, so a UTC ETD can fall on the previous/next UTC day (VJ859 07/11
 * 03:45 local = 06/11 1945Z). Pick the UTC day whose implied UTC offset is a
 * real timezone offset (−12..+14 h), nearest to zero. Returns 0 if unknown.
 */
export function mnlUtcTime(date: string, etdLocal: string, utc: string): number {
  const d = ymd(date), u = hm(utc);
  if (!d || !u) return 0;
  const base = Date.UTC(d[0], d[1] - 1, d[2], u[0], u[1]);
  const l = hm(etdLocal);
  if (!l) return base;
  const local = Date.UTC(d[0], d[1] - 1, d[2], l[0], l[1]);
  let best = base, bestOff = Infinity;
  for (const k of [0, -1, 1]) {
    const t = base + k * 864e5, off = (local - t) / 3600e3;
    if (off < -12 || off > 14) continue;
    if (Math.abs(off) < Math.abs(bestOff)) { best = t; bestOff = off; }
  }
  return best;
}

export type MnlFlight = { callsign: string; std: Date | string | null; dep_icao?: string; dest_icao?: string; dep_iata?: string; dest_iata?: string; plan_no?: string };

const digitsOf = (s: string) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");

/**
 * The day's CFP from the FliteBrief catalogue: same flight number and route,
 * STD within 6 h of the Crewlist UTC ETD, nearest unique sector. Returns ""
 * when absent or ambiguous so a wrong day's plan is never used.
 */
export function pickFlightPlan(flights: MnlFlight[], q: { digits: string; dep: string; arr: string; t: number }): string {
  const want = digitsOf(q.digits), dep = mnlIcao(q.dep), arr = mnlIcao(q.arr);
  if (!want || !q.t || !dep || !arr) return "";
  const hits: { d: number; plan: string }[] = [];
  for (const f of flights || []) {
    if (digitsOf(f.callsign) !== want) continue;
    const fd = mnlIcao(f.dep_icao || f.dep_iata || ""), fa = mnlIcao(f.dest_icao || f.dest_iata || "");
    if (fd !== dep || fa !== arr) continue;
    const std = f.std ? new Date(f.std).getTime() : NaN;
    if (!Number.isFinite(std)) continue;
    const d = Math.abs(std - q.t);
    if (d > 6 * 3600e3) continue;
    const plan = String(f.plan_no || "").replace(/\D/g, "");
    if (plan) hits.push({ d, plan });
  }
  hits.sort((a, b) => a.d - b.d);
  if (!hits.length) return "";
  if (hits.length > 1 && hits[1]!.d === hits[0]!.d && hits[1]!.plan !== hits[0]!.plan) return "";
  return hits[0]!.plan;
}

/** A JetPlan View ICAO page belongs to the callsign (form input or ICAO "-VJC859"). */
export function planBelongsTo(html: string, callsign: string): boolean {
  const h = String(html || "").toUpperCase(), cs = callsign.toUpperCase();
  const input = /<INPUT\b[^>]*\bNAME\s*=\s*["']?CALLSIGN["']?[^>]*>/.exec(h)?.[0];
  if (input) {
    const v = /\bVALUE\s*=\s*["']([^"']*)["']/.exec(input)?.[1]?.trim();
    if (v != null) return v === cs;
  }
  return new RegExp("-" + cs + "\\b").test(h);
}
