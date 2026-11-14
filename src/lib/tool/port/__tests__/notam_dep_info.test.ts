import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const f: AssessFlight = {
  etd: new Date("2026-11-13T19:35:00Z"), eta: new Date("2026-11-14T03:00:00Z"),
  roles: { YMML: "DEP", VVTS: "ARR" }, firs: {}, points: [
    { lat: -37.67, lon: 144.84, fl_ft: 0, ete_min: 0, name: "YMML" },
    { lat: 10.82, lon: 106.65, fl_ft: 0, ete_min: 445, name: "VVTS" },
  ], tokens: new Set(), sid: null, star: null, acType: "A321",
};
const run = (q: string, e: string, d?: string) => assessNotam({ start: "2026-08-01 00:00", end: "2027-07-01 00:00", qfir: "YMMM", scope: "A", lower: "0", upper: "999", d_field: d,
  text: `Q)YMMM/${q}/IV/BO/A/0/999/3740S14450E\nA)YMML\nE)${e}`, e_field: e }, "YMML", "A", f, DEFAULT_ASSESS_CFG);

describe("information-only NOTAMs at the departure airport", () => {
  it("C2212 flying fox wildlife hazard is BRIEFING INFO", () => {
    expect(run("QFAHX", "INCREASED WILDLIFE HAZARD (GREY HEADED FLYING FOX) IN VCY ALL RWY THR TRANSITING AD SOUTH WEST TO NORTH EAST BTN 50FT AGL AND 100FT AGL.").level).toBe("BRIEFING INFO");
  });
  it("C2191 lit cranes 591FT AMSL are BRIEFING INFO", () => {
    expect(run("QOBCE", "MULTIPLE OBST CRANES (2) (LIT) 591FT AMSL ERECTED PSN 374108.22S 1445218.70E BRG 104 MAG 2815M FM ARP INFRINGES INNER HORIZONTAL SFC BY 74FT").level).toBe("BRIEFING INFO");
  });
  it("C2013 AD beacon is BRIEFING INFO", () => {
    expect(run("QLBXX", "AD BEACON OPERATIONAL ALTN '10 WG' H24 LOCATED TOP OF ATC TWR").level).toBe("BRIEFING INFO");
  });
  it("C1618 chart/ERSA amendment is BRIEFING INFO", () => {
    expect(run("QFAXX", "CHARTS RELATED TO THE AERODROME AMD AMD THE FLW: 2. AERODROME OBSTRUCTION CHART TYPE A: JUNE 2026 AMD ENR SUP AUSTRALIA (ERSA)").level).toBe("BRIEFING INFO");
  });
  it("runway closure at departure stays CRITICAL", () => {
    expect(run("QMRLC", "RWY 16/34 CLSD").level).toBe("CRITICAL");
  });
});
