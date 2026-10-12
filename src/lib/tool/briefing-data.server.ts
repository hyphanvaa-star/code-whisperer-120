import type { Ctx } from "./types";
import { getJson } from "./store.server";
import { emptyStore, type PinStore } from "./port/notam_pin";
import { parseEetFirs } from "./port/notam_check_tune";
import { airportParentFir, apply24h, normIcao, placeFromPayload } from "./port/notam_check";
import { fbJson } from "../flitebrief.server";
import type { DraftFromFlightOpts } from "./port/briefingRelease";

const COUNT_TTL = 10 * 60 * 1000;
const COUNT_TIMEOUT = 6000;
const countCache = new Map<string, { at: number; n: number }>();

/** 24h NOTAM count from the FliteBrief portal; null = portal not read (never invent NIL).
 *  Successful reads are cached 10 min per worker; a slow portal times out to null. */
async function portalCount(code: string, want: string): Promise<number | null> {
  const icao = normIcao(code);
  if (!icao) return null;
  const key = `${want}:${icao}`;
  const hit = countCache.get(key);
  if (hit && Date.now() - hit.at < COUNT_TTL) return hit.n;
  try {
    const payload = await Promise.race([
      fbJson<Record<string, unknown>>(`/webapi/icaos/${icao}`),
      new Promise<null>((r) => setTimeout(() => r(null), COUNT_TIMEOUT)),
    ]);
    if (!payload || (typeof payload === "object" && !Object.keys(payload).length)) return null;
    const place = placeFromPayload(icao, payload, want);
    if (place.error && !(place.notams as unknown[])?.length) return null;
    const n = Number(apply24h(place).notam_count ?? 0) || 0;
    countCache.set(key, { at: Date.now(), n });
    return n;
  } catch {
    return null;
  }
}

/** All briefing paths read the same cached operational sources, never manufacture NIL. */
export async function loadBriefingData(ctx: Ctx): Promise<Pick<DraftFromFlightOpts, "tafs" | "aircraft" | "pins" | "pinContext">> {
  const [wx, limits, pins] = await Promise.all([
    getJson<{ tafs?: NonNullable<DraftFromFlightOpts["tafs"]> }>(ctx, "wx.taf", {}),
    getJson<{ aircraft?: unknown[] }>(ctx, "limits", {}),
    getJson<PinStore>(ctx, `notam.pins:${ctx.userId}`, emptyStore()),
  ]);
  return {
    tafs: wx?.tafs ?? {},
    aircraft: limits?.aircraft ?? [],
    pins: pins ?? emptyStore(),
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
