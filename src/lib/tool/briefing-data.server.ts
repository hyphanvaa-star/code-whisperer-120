import type { Ctx } from "./types";
import { getJson } from "./store.server";
import { emptyStore, type PinStore } from "./port/notam_pin";
import { parseEetFirs } from "./port/notam_check_tune";
import { airportParentFir } from "./port/notam_check";
import type { DraftFromFlightOpts } from "./port/briefingRelease";

/** All briefing paths read the same cached operational sources, never manufacture NIL. */
export async function loadBriefingData(ctx: Ctx): Promise<Pick<DraftFromFlightOpts, "tafs" | "aircraft" | "pins" | "pinContext">> {
  const [wx, limits, pins] = await Promise.all([
    getJson<{ tafs?: NonNullable<DraftFromFlightOpts["tafs"]> }>(ctx, "wx.taf", {}),
    getJson<{ aircraft?: unknown[] }>(ctx, "limits", {}),
    getJson<PinStore>(ctx, "notam.pins", emptyStore()),
  ]);
  return {
    tafs: wx?.tafs ?? {},
    aircraft: limits?.aircraft ?? [],
    pins: pins ?? emptyStore(),
    pinContext: (sheet, text) => ({
      firs: [...new Set([...parseEetFirs(text), ...[sheet.dep, sheet.dest, ...sheet.dest_alts, ...sheet.enroute_alts].map((code) => airportParentFir(code)).filter(Boolean)])],
    }),
  };
}