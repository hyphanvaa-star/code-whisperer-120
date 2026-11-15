import { describe, expect, it } from "vitest";
import { assessNotam, atsRouteList, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

// A3194/26 ZHWH: new flight routes written as FPL chains across line breaks.
const E3194 = `THE NEW FLIGHT ROUTES ARE PRIMARY FLIGHTS ROUTES. SEND FPL
ACCORDING TO THE NEW FLIGHTS ROUTES. IF THERE IS ANY TEMPORARY
CHANGE, FLW ATC INSTRUCTIONS:
1. FLIGHTS ROUTE FROM ZSSS, ZSPD, ZSNB, ZSZS VIA
PIKAS-G330-UNTAN-G345-OLRIS-R343-LUOGANG VOR 'HFE'-B208 TO FUYANG
VOR 'FYG' AND A POINT BEYOND FUYANG VOR 'FYG':
ZSSS/ZSPD/ZSNB/ZSZS VIA
PIKAS-G330-PIMOL-V14-NOBEM-W73-VEMEX-W163-LUOGANG VOR
'HFE'-B208-FUYANG VOR 'FYG', THEN JOIN THE EXISTING FLIGHTS ROUTE.
2. FLIGHTS ROUTE FROM ZSSS, ZSPD VIA
PIKAS-G330-UNTAN-G345-OLRIS-R343-MADUK-W51-LEGIV-W164-ADGOL-W50 TO
XISHUI VOR 'XSH' AND A POINT BEYOND XISHUI VOR 'XSH':
3. FLIGHTS ROUTE FROM ZSNT, ZSCG, ZSYA VIA
BENNIU NDB'ZJ'-G345-OLRIS-R343-MADUK-W51-LEGIV-W164-VILID AND A
POINT BEYOND VILID: ZSNT/ZSCG/ZSYA-BENNIU NDB
'ZJ'-G345-PIMUS-V11-DOGVI-W545-VEMEX-W73-MADUK-W51- LEGIV-
W164-VILID, THEN JOIN THE EXISTING FLIGHTS ROUTE.`;
const A3194 = {
  ident: "A3194/26", qfir: "ZHWH", scope: "E", start: "2026-07-30 07:43", end: "2026-12-31 15:59", lower: "0", upper: "999",
  text: `Q)ZSHA/QARXX/IV//E/0/999\nA)ZHWH B)2607300743 C)2612311559\nE)${E3194}`, e_field: E3194,
};
const etd = new Date("2026-11-15T02:00:00Z");
const eta = new Date("2026-11-15T06:00:00Z");
const mk = (tokens: string[], names: string[] = []): AssessFlight => ({
  etd, eta, roles: { VVNB: "DEP", RJGG: "ARR" },
  firs: { VVHN: [etd, new Date("2026-11-15T03:00:00Z")], ZHWH: [new Date("2026-11-15T03:00:00Z"), new Date("2026-11-15T04:00:00Z")] },
  points: [
    { lat: 21.2, lon: 105.8, fl_ft: 0, ete_min: 0, name: "VVNB" },
    ...names.map((n, i) => ({ lat: 28 + i, lon: 114 + i, fl_ft: 37000, ete_min: 90 + i * 10, name: n })),
    { lat: 34.86, lon: 136.8, fl_ft: 0, ete_min: 240, name: "RJGG" },
  ],
  tokens: new Set(tokens), sid: null, star: null, acType: "A321",
});

describe("full ATS route scan", () => {
  it("reads every airway in FIX-AWY-FIX chains, across line breaks", () => {
    const r = atsRouteList(E3194, "QARXX");
    for (const a of ["G330", "G345", "R343", "B208", "V14", "W73", "W163", "W51", "W164", "W50", "V11", "W545"]) expect(r).toContain(a);
    expect(r).not.toContain("ZSSS");
  });
  it("A3194/26 is kept for a flight flying R343", () => {
    const res = assessNotam(A3194, "ZHWH", "FIR", mk(["A581", "R343"]), DEFAULT_ASSESS_CFG);
    expect(res.level).toBe("NEED MANUAL CHECK");
    expect(res.match_type).toBe("ATS-ROUTE-LIST");
  });
  it("a flown fix (OLRIS) keeps the NOTAM even when no listed airway is flown", () => {
    const res = assessNotam(A3194, "ZHWH", "FIR", mk(["A581", "OLRIS"], ["OLRIS"]), DEFAULT_ASSESS_CFG);
    expect(res.level).toBe("NEED MANUAL CHECK");
  });
  it("drops only when no listed airway or fix is on the FPL", () => {
    const res = assessNotam(A3194, "ZHWH", "FIR", mk(["A1", "KAPLI"], ["KAPLI"]), DEFAULT_ASSESS_CFG);
    expect(res.level).toBe("NO IMPACT");
  });
  it("a route chain without route wording or Q-code is still read", () => {
    expect(atsRouteList("ACFT FLY ABCDE-A1-FGHIJ-R343-KLMNO.", "")).toEqual(["A1", "R343"]);
  });
  it("one unflown segment never clears another flown route in the same NOTAM", () => {
    const e = "ATS RTE SEGMENT A1 (ABCDE-FGHIJ) CLSD. ALSO R343 OLRIS - MADUK CLSD BTN FL300 AND FL400.";
    const n = { ident: "A1/26", qfir: "ZHWH", scope: "E", start: "2026-11-15 00:00", end: "2026-11-15 12:00", lower: "300", upper: "400",
      text: `Q)ZHWH/QARLC/IV/NBO/E/300/400\nE)${e}`, e_field: e };
    const res = assessNotam(n, "ZHWH", "FIR", mk(["R343"]), DEFAULT_ASSESS_CFG);
    expect(res.level).not.toBe("NO IMPACT");
  });
  it("coordinates, NOTAM refs and aircraft types are not airways", () => {
    expect(atsRouteList("RTE A1 AVBL. REF NOTAM A3194/26. N1234 E10512 TO N1300E10600. B738 ACFT ONLY.", "QARXX")).toEqual(["A1"]);
  });
});
