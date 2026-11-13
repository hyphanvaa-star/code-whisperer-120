import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-11-13T02:00:00Z");
const eta = new Date("2026-11-13T07:00:00Z");
const flight = (points: AssessFlight["points"]): AssessFlight => ({
  etd, eta, roles: { VVPQ: "DEP", RKSI: "ARR" },
  firs: { RJJJ: [new Date("2026-11-13T04:00:00Z"), new Date("2026-11-13T06:00:00Z")] },
  points, tokens: new Set(["M753"]), sid: null, star: null, acType: "A321",
});
// VVPQ → Taiwan → RKSI: hundreds of NM west of Hyogo.
const far = flight([
  { lat: 10.17, lon: 103.99, fl_ft: 0, ete_min: 0, name: "VVPQ" },
  { lat: 24.0, lon: 122.0, fl_ft: 37000, ete_min: 150, name: "TWN" },
  { lat: 37.46, lon: 126.44, fl_ft: 0, ete_min: 300, name: "RKSI" },
]);
// A track passing right over Ono-shi, Hyogo at FL200.
const over = flight([
  { lat: 34.0, lon: 132.0, fl_ft: 20000, ete_min: 240, name: "AAA" },
  { lat: 34.86, lon: 134.97, fl_ft: 20000, ete_min: 260, name: "ONO" },
  { lat: 35.5, lon: 137.0, fl_ft: 20000, ete_min: 280, name: "BBB" },
]);
const E = "BALLOON:\nRELEASING POINT: 345120N1345802E\n(ONO-SHI IN HYOGO)\nRELEASING TIME: 12TH 1800 2100\n13TH-18TH 0000 0300 0600 0900 1200 1500 1800 2100\n19TH 0000 0300 0600 0900 1200 1500\nFLOATING TIME: APRX 1HR/EACH";
const R1976 = {
  ident: "R1976/26", qfir: "RJJJ", scope: "W", start: "2026-11-12 18:00", end: "2026-11-19 16:00", lower: "0", upper: "263",
  text: `Q)RJJJ/QWLLW/IV/M/O/263\nA)RJJJ B)2611121800 C)2611191600\nE)${E}\nF)SFC G)26248FT AMSL`, e_field: E,
};

describe("NOTAM with a single coordinate in item E", () => {
  it("balloon release point far from the track is NO IMPACT, not unidentified", () => {
    const r = assessNotam(R1976, "RJJJ", "FIR", far, DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NO IMPACT");
    expect(r.match_type).toBe("GEOMETRY");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("balloon release point under the track is not dropped", () => {
    const r = assessNotam(R1976, "RJJJ", "FIR", over, DEFAULT_ASSESS_CFG);
    expect(r.level).not.toBe("NO IMPACT");
    expect(r.unidentified_area).toBeFalsy();
  });
});
