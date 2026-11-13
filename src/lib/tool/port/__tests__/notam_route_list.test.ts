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

const RJJJ_FIR = (n: { ident: string; e: string; q?: string }) => ({
  ident: n.ident, qfir: "RJJJ", scope: "E", start: "2026-11-12 21:00", end: "2026-11-13 21:00", lower: "0", upper: "999",
  text: `Q)RJJJ/${n.q ?? "QANCA"}/I/NBO/E/0/999\nA)RJJJ B)2611122100 C)2611132100\nE)${n.e}\nF)SFC G)UNL`, e_field: n.e,
});
const E2714 = "CDR ARE ESTABLISHED AS FLW,\nRTE PERIOD MNM APPLICABLE ALT\n1) Z16 2611131300/2611132100 MEA\n2) Z17 2611122100/2611122200 MEA\nZ17 2611131300/2611132100 MEA\n3) Z18 2611122100/2611122200 MEA\nZ18 2611131300/2611132100 MEA\n4) Z21 2611122100/2611122200 MEA\n5) Z101 2611131300/2611132100 MEA\n9) Z182 2611122100/2611122200 MEA\nRMK: REF AIP ENR3.3";
const E2711 = "CDR ARE ESTABLISHED AS FLW,\nRTE PERIOD MNM APPLICABLE ALT\n1) Z29 2611131500/2611132100 MEA\n2) Z31 2611131500/2611132100 MEA\n3) Z32 2611131500/2611132100 MEA\n4) Z34 2611131500/2611132100 MEA\nRMK: REF AIP ENR3.3";
const mkJ = (tokens: string[]): AssessFlight => ({ ...mk(tokens), firs: { RJJJ: [etd, eta] } });

describe("ATS route list formats", () => {
  it("numbered CDR table lists every route", () => {
    expect(atsRouteList(E2714, "QANCA")).toEqual(["Z16", "Z17", "Z18", "Z21", "Z101", "Z182"]);
    expect(atsRouteList(E2711, "QANCA")).toEqual(["Z29", "Z31", "Z32", "Z34"]);
  });
  it("flattened numbered list still lists the routes", () => {
    expect(atsRouteList(E2711.replace(/\n/g, " "), "QANCA")).toEqual(["Z29", "Z31", "Z32", "Z34"]);
  });
  it("CDR on routes the flight does not fly is NO IMPACT, not named airspace", () => {
    for (const [id, e] of [["Q2714/26", E2714], ["Q2711/26", E2711]] as const) {
      const r = assessNotam(RJJJ_FIR({ ident: id, e }), "RJJJ", "FIR", mkJ(["Y11", "OSOTE"]), DEFAULT_ASSESS_CFG);
      expect(r.level).toBe("NO IMPACT");
      expect(r.match_type).toBe("ATS-ROUTE-LIST");
      expect(r.unidentified_area).toBeFalsy();
    }
  });
  it("CDR on a route the flight flies stays NEED MANUAL CHECK", () => {
    const r = assessNotam(RJJJ_FIR({ ident: "Q2711/26", e: E2711 }), "RJJJ", "FIR", mkJ(["Z31", "OSOTE"]), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.match_type).toBe("ATS-ROUTE-LIST");
  });
  it("status, ON/VIA and bulleted forms", () => {
    expect(atsRouteList("A1, B2 AND R339 CLSD.", "QARLC")).toEqual(["A1", "B2", "R339"]);
    expect(atsRouteList("ACFT ON UL642/UM771 SHALL MAINTAIN FL300 OR BLW.", "QARAU")).toEqual(["UL642", "UM771"]);
    expect(atsRouteList("FLW ATS RTE NOT AVBL:\n- Y711\n- Q10 FL300-FL400\n* T1 BTN ABC AND DEF", "QARLC")).toEqual(["Y711", "Q10", "T1"]);
    expect(atsRouteList("ROUTES A1 B2 R3 CLSD", "")).toEqual(["A1", "B2", "R3"]);
  });
  it("taxiways, aircraft types and coordinates are not routes", () => {
    expect(atsRouteList("TWY A1, B2 AND C3 CLSD.", "QMXLC")).toEqual([]);
    expect(atsRouteList("TAXI ROUTE A1 CLSD", "QMXLC")).toEqual([]);
    expect(atsRouteList("RTE AVBL FOR A321 ACFT ONLY", "QARLT")).toEqual([]);
    expect(atsRouteList("ROUTE RESTRICTION AREA:\nN12 34 56 E105 12 00", "QARLT")).toEqual([]);
  });
});
