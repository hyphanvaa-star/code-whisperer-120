import { describe, it, expect } from "vitest";
import { Weights, flytimeVerdicts } from "../ofp_weights";

function w(trip: number, pct: number, era: { icao?: string; min?: number; fail?: boolean } = {}) {
  const x = new Weights(1);
  x.trip_time_min = trip;
  x.route_res_pct = pct;
  x.route_res_min = 10;
  x.era_icao = era.icao ?? null;
  x.era_time_min = era.min ?? null;
  x.era_ops_fail = Boolean(era.fail);
  return x;
}
const ok = (x: Weights) => (flytimeVerdicts(x).rres as { ok: boolean | null }).ok;

describe("Cont Fuel/ERA rule", () => {
  it("ERA present over 60 min on a ≥3h flight is valid", () => {
    expect(ok(w(347, 3, { icao: "UNAA", min: 68 }))).toBe(true);
  });
  it("≥3h flight without ERA is an error", () => {
    expect(ok(w(347, 3))).toBe(false);
  });
  it("≥3h flight with AIR OPS invalid ERA is an error", () => {
    expect(ok(w(347, 3, { icao: "UNAA", min: 40, fail: true }))).toBe(false);
  });
  it("<3h flight with AIR OPS invalid ERA is not an error", () => {
    expect(ok(w(120, 5, { icao: "VVDN", min: 30, fail: true }))).toBe(true);
  });
  it("<3h flight without ERA is not an error", () => {
    expect(ok(w(120, 5))).toBe(true);
  });
});
