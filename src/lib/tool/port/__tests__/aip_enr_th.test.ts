import { describe, it, expect } from "vitest";
import { enrIdsInText } from "../aip_enr_catalog";
import { notamGeoms } from "../notam_track";
import { assessNotam, atsRouteList, DEFAULT_ASSESS_CFG } from "../notam_assess";

const mk = (e: string, q = "QRDCA") => ({ ident: "J7430/26", qfir: "VTBB", scope: "E", start: "2026-11-16 10:00", end: "2026-11-19 14:00", lower: "0", upper: "999",
  text: `Q)VTBB/${q}/IV/BO/E/0/999/1528N10250E\nE)${e}\nF)GND G)UNL`, e_field: e });
const RMK = "\nRMK:ACFT MAY FILE FPL ON AFFECTED RTE BUT EXP RADAR VECTORED BY ATC";
const flight = () => ({ dep_icao: "VVNB", dest_icao: "VTBS", roles: {}, firs: {}, tokens: new Set(["W21", "DAN", "KRT"]),
  points: [{ name: "DAN", lat: 16.08, lon: 103.58, fl: 340, ete_min: 50 }, { name: "KRT", lat: 14.93, lon: 102.1, fl: 340, ete_min: 65 }],
  etd: new Date("2026-11-16T10:00:00Z"), eta: new Date("2026-11-16T11:30:00Z") }) as never;

describe("Thailand ENR areas", () => {
  it("VT D30W AREA 2 resolves only Area 2", () => {
    expect(enrIdsInText("VT D30W AREA 2 TEMPO ACT", "VTBB")).toEqual(["VTD30W2"]);
    expect(enrIdsInText("VT D30W AREA 1 TEMPO ACT", "VTBB")).toEqual(["VTD30W1"]);
  });
  it("J7430 draws a polygon", () => {
    expect(notamGeoms(mk("VT D30W AREA 2 TEMPO ACT" + RMK) as never).some((g) => g.shape === "polygon")).toBe(true);
  });
  it("danger area designator is never an ATS route", () => {
    expect(atsRouteList("VT D30W AREA 2 TEMPO ACT" + RMK, "QRDCA")).toEqual([]);
  });
  it("J7430 is not MINOR via ATS-ROUTE-LIST", () => {
    const r = assessNotam(mk("VT D30W AREA 2 TEMPO ACT" + RMK) as never, "VTBB", "FIR", flight(), DEFAULT_ASSESS_CFG);
    expect(r.match_type).not.toBe("ATS-ROUTE-LIST");
  });
  it("unknown Thai danger area is UNIDENTIFIED AREA", () => {
    const r = assessNotam(mk("VT D99 AREA 2 TEMPO ACT" + RMK) as never, "VTBB", "FIR", flight(), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.unidentified_area).toBe(true);
  });
});
