import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-11-13T10:05:00Z");
const eta = new Date("2026-11-13T15:00:00Z");
const f: AssessFlight = {
  etd, eta, roles: { VVPQ: "DEP", RKSI: "ARR", VVTS: "RALT", RKTU: "ALT" },
  ralt_arr: { VVTS: [new Date("2026-11-13T10:29:00Z"), new Date("2026-11-13T12:29:00Z")] },
  firs: {}, points: [
    { lat: 10.17, lon: 103.99, fl_ft: 0, ete_min: 0, name: "VVPQ" },
    { lat: 37.46, lon: 126.44, fl_ft: 0, ete_min: 295, name: "RKSI" },
  ],
  tokens: new Set(), sid: null, star: null, acType: "A321",
};
const base = { start: "2026-11-06 07:00", end: "2026-12-25 07:00", lower: "0", upper: "999", scope: "A" };
const run = (apt: string, fir: string, q: string, e: string) =>
  assessNotam({ ...base, qfir: fir, text: `Q)${fir}/${q}/IV/BO/A/0/999/1049N10639E\nA)${apt}\nE)${e}`, e_field: e }, apt, "A", f, DEFAULT_ASSESS_CFG);

describe("stand/taxiway at DEP and alternates", () => {
  it("A4305 TWY marking erasure at enroute alternate VVTS is NO IMPACT", () => {
    expect(run("VVTS", "VVHM", "QMAHW", "ERASURE OF MARKINGS IN THE FOLLOWING AREA: - ALONG TWY P1 - 61M FM CL OF TWY P1 TO THE EAST.").level).toBe("NO IMPACT");
  });
  it("A4304 WIP beside RWY 25R/07L at VVTS stays BRIEFING INFO", () => {
    expect(run("VVTS", "VVHM", "QMAHW", "WORK IN PROGRESS ON AREAS, DETAIL AS FLW: - AREA 1: PORTION FM THR RWY 25R/07L TO 200M FM THR RWY 25R/07L").level).toBe("BRIEFING INFO");
  });
  it("A1548 stands/TXL at destination alternate RKTU is NO IMPACT", () => {
    expect(run("RKTU", "RKRR", "QMPLC", "TXL BEHIND ACFT STAND NR 1 TO NR 9 NOT AVBL FOR ACFT ICAO CODE D AND ABOVE DUE TO WORK IN PROGRESS").level).toBe("NO IMPACT");
  });
  it("stand closure at arrival airport is still BRIEFING INFO", () => {
    expect(run("RKSI", "RKRR", "QMPLC", "ACFT STAND 101 TO 105 CLSD").level).toBe("BRIEFING INFO");
  });
});
