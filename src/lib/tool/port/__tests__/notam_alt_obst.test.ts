import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const f: AssessFlight = {
  etd: new Date("2026-11-13T10:05:00Z"), eta: new Date("2026-11-13T15:07:00Z"),
  roles: { VVPQ: "DEP", RKSI: "ARR", RCTP: "RALT" },
  ralt_arr: { RCTP: [new Date("2026-11-13T13:09:00Z"), new Date("2026-11-13T13:09:00Z")] },
  firs: {}, points: [
    { lat: 10.17, lon: 103.99, fl_ft: 0, ete_min: 0, name: "VVPQ" },
    { lat: 37.46, lon: 126.44, fl_ft: 0, ete_min: 300, name: "RKSI" },
  ], tokens: new Set(), sid: null, star: null, acType: "A321",
};
const run = (q: string, e: string, g = "UNL") => assessNotam({ start: "2026-08-01 00:00", end: "2027-07-01 00:00", qfir: "RCAA", scope: "A", lower: "0", upper: "999", g_field: g,
  text: `Q)RCAA/${q}/IV/M/A/0/999/2504N12113E\nA)RCTP\nE)${e}\nF)SFC G)${g}`, e_field: e }, "RCTP", "A", f, DEFAULT_ASSESS_CFG);

describe("NOTAMs at an en-route alternate", () => {
  it("A3647 GP antenna 15M AGL is NO IMPACT", () => {
    expect(run("QOBCE", "OBST ERECTED DUE TO NEW GP ANTENNA WIP, INFO AS FLW: 1.COORD: 250344.75N 1211338.96E 2.MAX HGT: 15M AGL", "200FT AMSL").level).toBe("NO IMPACT");
  });
  it("A3047 crane 600FT citing AIP SUP is NO IMPACT", () => {
    expect(run("QOBCE", "AIP SUP 21/26 WEF 30 AUG 2026 TIL 01 JUL 2027, A CRANE AT TAIPEI/TAIWAN TAOYUAN INTERNATIONAL AIRPORT.", "600FT AMSL").level).toBe("NO IMPACT");
  });
  it("A4024 taxiway E code limit is NO IMPACT", () => {
    expect(run("QMXLT", "PORTION OF TWY E BTN TWY P(EXCLUDED) AND TWY Q(EXCLUDED) ONLY AVBL FOR ACFT WITH CODE LETTER A, B, C, D, E.").level).toBe("NO IMPACT");
  });
  it("A2638 code F ground manoeuvring citing AIP SUP is NO IMPACT", () => {
    expect(run("QMXXX", "AIP SUP 19/26 WEF 03 AUG 2026 TIL 31 DEC 2027, GROUND MANEUVERING RESTRICTIONS FOR AERODROME REFERENCE CODE F AIRCRAFT AT TAIPEI/TAIWAN TAOYUAN INTERNATIONAL AIRPORT.").level).toBe("NO IMPACT");
  });
  it("runway closure at the alternate is still graded", () => {
    expect(run("QMRLC", "RWY 05L/23R CLSD").level).not.toBe("NO IMPACT");
  });
});

describe("crane NOTAMs at a destination alternate (VABB, VJC1805)", () => {
  const g: AssessFlight = { ...f, roles: { VVTS: "DEP", VAAH: "ARR", VABB: "ALT" }, ralt_arr: {} };
  const runB = (e: string, gg: string) => assessNotam({ start: "2026-08-01 00:00", end: "2027-07-01 00:00", qfir: "VABF", scope: "A", lower: "0", upper: "999", g_field: gg,
    text: `Q)VABF/QOBCE/IV/M/A/0/2/1905N07251E\nA)VABB\nE)${e}\nF)SFC G)${gg}`, e_field: e }, "VABB", "A", g, DEFAULT_ASSESS_CFG);
  it("A1443 crane with ARP distance in metres is NO IMPACT", () => {
    expect(runB("TEMPO OBST CRANE ERECTED AT LCA 190444.65N 0725042.60E. RADIUS OF CRANE OPS 52M. BRG DIST FM VABB ARP IS 237.64DEG/2589M.UPPER HGT 170.6FT AMSL.", "200FT AMSL").level).toBe("NO IMPACT");
  });
  it("A1258 crane is NO IMPACT", () => {
    expect(runB("TEMPO OBST CRANE ERECTED AT LCA 190609.69N 0725229.01E. RADIUS OF CRANE OPS 55M. BRG DIST FM VABB ARP IS 36.52DEG/1539.91M. UPPER HGT 354.33FT AMSL.", "400FT AMSL").level).toBe("NO IMPACT");
  });
});
