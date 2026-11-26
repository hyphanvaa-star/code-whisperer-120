import type { Ctx } from "./types";
import { getJson } from "./store.server";
import { emptyStore, type PinStore } from "./port/notam_pin";
import { parseEetFirs } from "./port/notam_check_tune";
import { airportParentFir, apply24h, normIcao, placeFromPayload } from "./port/notam_check";
import { fbJson } from "../flitebrief.server";
import { flightWindowOf, type DraftFromFlightOpts } from "./port/briefingRelease";
import { awcFirSigmets, briefingSigmetText, fbFirSigmets, sigmetFirWindows, type FirSigmetRead } from "./port/briefing_sigmet";

const COUNT_TTL = 10 * 60 * 1000;
const COUNT_TIMEOUT = 6000;
const countCache = new Map<string, { at: number; n: number }>();

const PAYLOAD_TTL = 3 * 60 * 1000;
const payloadCache = new Map<string, { at: number; payload: Record<string, unknown> }>();

/** One FliteBrief place read shared by NOTAM counts and SIGMETs; null = portal not read. */
async function portalPayload(icao: string): Promise<Record<string, unknown> | null> {
  const hit = payloadCache.get(icao);
  if (hit && Date.now() - hit.at < PAYLOAD_TTL) return hit.payload;
  try {
    const raw = await Promise.race([
      fbJson<unknown>(`/webapi/icaos/${icao}`),
      new Promise<null>((r) => setTimeout(() => r(null), COUNT_TIMEOUT)),
    ]);
    const payload = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object" || !Object.keys(payload).length) return null;
    payloadCache.set(icao, { at: Date.now(), payload });
    return payload;
  } catch {
    return null;
  }
}

/** 24h NOTAM count from the FliteBrief portal; null = portal not read (never invent NIL).
 *  Successful reads are cached 10 min per worker; a slow portal times out to null. */
async function portalCount(code: string, want: string): Promise<number | null> {
  const icao = normIcao(code);
  if (!icao) return null;
  const key = `${want}:${icao}`;
  const hit = countCache.get(key);
  if (hit && Date.now() - hit.at < COUNT_TTL) return hit.n;
  try {
    const payload = await portalPayload(icao);
    if (!payload) return null;
    const place = placeFromPayload(icao, payload, want);
    if (place.error && !(place.notams as unknown[])?.length) return null;
    const n = Number(apply24h(place).notam_count ?? 0) || 0;
    countCache.set(key, { at: Date.now(), n });
    return n;
  } catch {
    return null;
  }
}

const AWC_ISIGMET = "https://aviationweather.gov/api/data/isigmet?format=json";
let awcCache: { at: number; list: unknown[] } | null = null;

/** NOAA international SIGMET feed, used only for FIRs FliteBrief could not read; null = not read. */
async function awcSigmets(): Promise<unknown[] | null> {
  if (awcCache && Date.now() - awcCache.at < PAYLOAD_TTL) return awcCache.list;
  try {
    const res = await fetch(AWC_ISIGMET, { headers: { "User-Agent": "Mozilla/5.0 dispatch-board" }, signal: AbortSignal.timeout(COUNT_TIMEOUT) });
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    awcCache = { at: Date.now(), list };
    return list;
  } catch {
    return null;
  }
}

/** FIR of an airport: fixed national mapping first, else the FIR FliteBrief lists for it. */
async function firOfAirport(code: string): Promise<string> {
  const icao = normIcao(code);
  if (!icao) return "";
  const fixed = airportParentFir(icao);
  if (fixed) return fixed;
  const payload = await portalPayload(icao);
  const airfield = ((payload?.["airfields"] as Record<string, unknown>[] | undefined) ?? [])[0];
  return airportParentFir(icao, String(airfield?.["fir"] ?? ""));
}

/** En-route SIG Wx text: SIGMETs of every FIR on the route that touch the time the flight is inside it. */
const sigmetFor: NonNullable<DraftFromFlightOpts["sigmetFor"]> = async (flight, sheet, ofpText) => {
  const [depFir, destFir] = await Promise.all([firOfAirport(sheet.dep), firOfAirport(sheet.dest)]);
  const windows = sigmetFirWindows(flightWindowOf(flight), ofpText, depFir, destFir);
  const firs = [...new Set(windows.map((w) => w.fir))];
  const reads: Record<string, FirSigmetRead> = {};
  await Promise.all(firs.map(async (fir) => { reads[fir] = fbFirSigmets(await portalPayload(fir)); }));
  const missing = firs.filter((fir) => reads[fir]?.status !== "ok");
  if (missing.length) {
    const list = await awcSigmets();
    for (const fir of missing) reads[fir] = awcFirSigmets(fir, list);
  }
  return briefingSigmetText(windows, reads);
};

/** All briefing paths read the same cached operational sources, never manufacture NIL. */
export async function loadBriefingData(ctx: Ctx): Promise<Pick<DraftFromFlightOpts, "tafs" | "aircraft" | "pins" | "pinContext" | "sigmetFor">> {
  const [wx, limits, pins] = await Promise.all([
    getJson<{ tafs?: NonNullable<DraftFromFlightOpts["tafs"]> }>(ctx, "wx.taf", {}),
    getJson<{ aircraft?: unknown[] }>(ctx, "limits", {}),
    getJson<PinStore>(ctx, `notam.pins:${ctx.userId}`, emptyStore()),
  ]);
  return {
    tafs: wx?.tafs ?? {},
    aircraft: limits?.aircraft ?? [],
    pins: pins ?? emptyStore(),
    sigmetFor,
    pinContext: async (sheet, text) => {
      const firs = [...new Set([...parseEetFirs(text), ...[sheet.dep, sheet.dest, ...sheet.dest_alts, ...sheet.enroute_alts].map((code) => airportParentFir(code)).filter(Boolean)])];
      const keys = new Set<string>();
      for (const c of [sheet.dep, sheet.dest, ...sheet.dest_alts, ...sheet.enroute_alts]) if (c) keys.add(`A:${String(c).toUpperCase()}`);
      for (const f of firs) if (f) keys.add(`FIR:${String(f).toUpperCase()}`);
      const counts: Record<string, number | null> = {};
      await Promise.all([...keys].map(async (k) => {
        const [want, code] = k.split(":");
        counts[k] = await portalCount(code, want);
      }));
      return { firs, counts };
    },
  };
}
