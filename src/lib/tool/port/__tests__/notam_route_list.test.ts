import { describe, expect, it } from "vitest";
import { assessNotam, atsRouteList, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-11-13T02:00:00Z");
const eta = new Date("2026-11-13T07:00:00Z");
const mk = (tokens: string[]): AssessFlight => ({
  etd, eta, roles: { VVPQ: "DEP", RKSI: "ARR" },
  firs: { VVHM: [etd, new Date("2026-11-13T03:00:00Z")], ZJSA: [new Date("2026-11-13T03:00:00Z"), new Date("2026-11-13T04:00:00Z")] },
  points: [
    { lat: 10.17, lon: 103.99, fl_ft: 0, ete_min: 0, name: "VVPQ" },
    { lat: 12.0, lon: 108.0, fl_ft: 35000, ete_min: 40, name: "OSOTE" },
    { lat: 37.46, lon: 126.44, fl_ft: 0, ete_min: 300, name: "RKSI" },
  ],
  tokens: new Set(tokens), sid: null, star: null, acType: "A321",
});
const E4392 = "DUE TO BAD WX, LARGE SCALE WX DEV (LSWD) APPLIED ON ROUTES\nL642, N892, M771 AND L625 WI HO CHI MINH FIR:\n- L642, N892: FL320, FL360, FL400\n- M771, L625: FL310, FL350, FL390.";
const A4392 = {
  ident: "A4392/26", qfir: "VVHM", scope: "E", start: "2026-11-13 02:07", end: "2026-11-13 12:00", lower: "0", upper: "999",
  text: `Q)VVHM/QARLT/IV/NBO/E/0/999\nA)VVHM B)2611130207 C)2611131200\nE)${E4392}\nF)SFC G)UNL`, e_field: E4392,
};

describe("ATS route list NOTAM", () => {
  it("reads every listed route designator", () => {
    expect(atsRouteList(E4392)).toEqual(["L642", "N892", "M771", "L625"]);
  });
  it("flight not on any listed route is NO IMPACT and not unidentified", () => {
    const r = assessNotam(A4392, "VVHM", "FIR", mk(["M753", "OSOTE"]), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NO IMPACT");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("flight on a listed route stays NEED MANUAL CHECK without UNIDENTIFIED AREA", () => {
    const r = assessNotam(A4392, "VVHM", "FIR", mk(["M771", "OSOTE"]), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.match_type).toBe("ATS-ROUTE-LIST");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("flow control procedure in the FIR is not an unidentified area", () => {
    const e = "FLOW CONTROL PROCEDURE ACTIVATED.";
    const r = assessNotam({ ident: "A4848/26", qfir: "ZJSA", scope: "A", start: "2026-09-21 01:38", end: "2027-03-20 15:59", lower: "0", upper: "999",
      text: `Q)ZJSA/QPFCA/I/NBO/A/0/999\nE)${e}`, e_field: e }, "ZJSA", "FIR", mk(["M753"]), DEFAULT_ASSESS_CFG);
    expect(r.unidentified_area).toBeFalsy();
  });
  it("military activity without coordinates in the FIR is still UNIDENTIFIED AREA", () => {
    const e = "MIL EXER WILL TAKE PLACE WI HO CHI MINH FIR.";
    const r = assessNotam({ ident: "A1/26", qfir: "VVHM", scope: "W", start: "2026-11-13 00:00", end: "2026-11-13 12:00", lower: "0", upper: "999",
      text: `Q)VVHM/QWMLW/IV/BO/W/0/999\nE)${e}`, e_field: e }, "VVHM", "FIR", mk(["M753"]), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.unidentified_area).toBe(true);
  });
});
