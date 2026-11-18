import { describe, expect, it } from "vitest";
import { rwyInFlightWin, rwyRoleOf } from "../notam_check_tune";

// A4307/26 VVTS: RWY 25R/07L TEMPO CLOSED, D)DAILY 1800-2300.
const rwy = {
  ident: "A4307/26", start: "2026-11-10T18:00:00Z", end: "2026-12-09T23:00:00Z",
  d_field: "DAILY 1800-2300",
  text: "A)VVTS B)2611101800 C)2612092300\nD)DAILY 1800-2300\nE)RWY 25R/07L TEMPO CLOSED",
  e_field: "RWY 25R/07L TEMPO CLOSED",
};
const ctx = (stdIso: string, staIso: string) => ({
  std: new Date(stdIso), sta: new Date(staIso), dep: "VVPQ", arr: "VVDN", roles: { VVPQ: "DEP", VVDN: "ARR", VVTS: "ALT" },
});

describe("RWY closure at a destination alternate follows the flight time", () => {
  it("day flight using VVTS as alternate is outside the 1800-2300 closure", () => {
    const c = ctx("2026-11-18T05:00:00Z", "2026-11-18T06:10:00Z");
    const role = rwyRoleOf("", { code: "VVTS", kind: "A" }, c);
    expect(role).toBe("ALT");
    expect(rwyInFlightWin(rwy, role, c)).toBe(false);
  });
  it("evening flight arriving near 1900Z still counts", () => {
    const c = ctx("2026-11-18T17:50:00Z", "2026-11-18T19:00:00Z");
    expect(rwyInFlightWin(rwy, "ALT", c)).toBe(true);
  });
});
