import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, ENROUTE_LOW_PORT_NM, lowEnroutePortDistNm, type AssessFlight } from "../notam_assess";

// VVTS → VTBS crossing VDPP (Phnom Penh FIR) as an en-route FIR.
const etd = new Date("2026-11-22T06:00:00Z");
const eta = new Date("2026-11-22T07:30:00Z");
const f: AssessFlight = {
  etd, eta, roles: { VVTS: "DEP", VTBS: "ARR" },
  firs: {
    VVHM: [etd, new Date("2026-11-22T06:08:00Z")],
    VDPP: [new Date("2026-11-22T06:08:00Z"), new Date("2026-11-22T06:50:00Z")],
    VTBB: [new Date("2026-11-22T06:50:00Z"), eta],
  },
  points: [
    { lat: 10.82, lon: 106.65, fl_ft: 0, ete_min: 0, name: "VVTS", fir: "VVHM" },
    { lat: 10.95, lon: 106.2, fl_ft: 6000, ete_min: 6, name: "CLIMB1", fir: "VVHM" },
    { lat: 11.1, lon: 105.9, fl_ft: 9000, ete_min: 9, name: "CLIMB2", fir: "VDPP" },
    { lat: 12.2, lon: 103.5, fl_ft: 33000, ete_min: 35, name: "MID", fir: "VDPP" },
    { lat: 13.3, lon: 102.2, fl_ft: 33000, ete_min: 55, name: "BORDR", fir: "VTBB" },
    { lat: 13.69, lon: 100.75, fl_ft: 0, ete_min: 90, name: "VTBS", fir: "VTBB" },
  ],
  tokens: new Set(), sid: null, star: null, acType: "A321",
};
const run = (coords: string, e: string) => assessNotam({
  start: "2026-11-22 00:00", end: "2026-11-23 00:00", lower: "0", upper: "080", qfir: "VDPP", coords,
  text: `Q)VDPP/QRDCA/IV/BO/W/000/080/${coords}\nE)${e}`, e_field: e,
}, "VDPP", "FIR", f, DEFAULT_ASSESS_CFG);

describe("en-route FIR NOTAM below FL100 near DEP/ARR", () => {
  it("uses 50 NM as the keep radius", () => {
    expect(ENROUTE_LOW_PORT_NM).toBe(50);
  });
  it("area ~35 NM from DEP VVTS in en-route FIR VDPP is kept and graded (not dropped)", () => {
    const r = run("1105N10607E005", "DANGER AREA ACT WI 5NM RADIUS OF 1105N10607E SFC-FL080");
    expect(r.level).not.toBe("NO IMPACT");
    expect(r.reasons.join(" ")).toContain("≤ 50 NM");
  });
  it("area > 50 NM from both DEP and ARR in en-route FIR VDPP is NO IMPACT", () => {
    const r = run("1212N10330E005", "DANGER AREA ACT WI 5NM RADIUS OF 1212N10330E SFC-FL080");
    expect(r.level).toBe("NO IMPACT");
    expect(r.reasons.join(" ")).toContain("> 50 NM");
  });
  it("distance is measured to the closest of DEP/ARR", () => {
    const n = { coords: "1105N10607E005", text: "Q)VDPP/QRDCA/IV/BO/W/000/080/1105N10607E005\nE)X", e_field: "X" };
    const d = lowEnroutePortDistNm(n, f);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(50);
  });
});
