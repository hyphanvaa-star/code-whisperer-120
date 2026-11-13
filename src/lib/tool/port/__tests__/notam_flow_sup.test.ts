import { describe, it, expect } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG } from "../notam_assess";
const T = (s: string) => new Date(s);
const f = () => ({
  etd: T("2026-11-13T01:00:00Z"), eta: T("2026-11-13T06:00:00Z"), roles: { VVPQ: "DEP", RKSI: "ARR" } as any,
  firs: { ZJSA: [T("2026-11-13T01:00:00Z"), T("2026-11-13T04:00:00Z")], RJJJ: [T("2026-11-13T03:00:00Z"), T("2026-11-13T05:00:00Z")] } as any,
  points: [{ lat: 33, lon: 126, name: "P1", fl_ft: 35000, time_utc: "2026-11-13T04:00:00Z" }] as any,
  tokens: new Set(["M753"]), sid: null, star: null, acType: "A321",
});
describe("flow control and resolved AIP SUP", () => {
  it("FIR CTOT procedure is briefing, not manual", () => {
    const e = "SANYA FIR(ZJSA)EXECUTE OCS(ONE CTOT SOLUTION)PROCEDURE,ALL ACFT OVERFLYING SANYA FIR(ZJSA) SHALL OPERATE CTOT.";
    const r = assessNotam({ qfir: "ZJSA", start: "2026-09-21 01:38", end: "2027-03-20 15:59", lower: "0", upper: "999", text: `Q)ZJSA/QPFCA/IV/NBO/A/0/999\nE)${e}`, e_field: e }, "ZJSA", "FIR", f(), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("BRIEFING INFO");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("AIP SUP area already drawn and far from route is NO IMPACT", () => {
    const e = "IWAKUNI TEMPO RESERVED AIRSPACE ACT AS FLW, ITRA-E SFC/FL250\nRMK: REF AIP SUP 023/26";
    const r = assessNotam({ qfir: "RJJJ", start: "2026-11-12 22:00", end: "2026-11-13 13:30", lower: "0", upper: "250", text: `Q)RJJJ/QRACA/IV/NBO/E/0/250\nE)${e}`, e_field: e,
      sup_geoms: [{ name: "ITRA-E", shape: "polygon", ring: [[34, 132], [34.5, 132.5], [34, 133]] }] }, "RJJJ", "FIR", f(), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NO IMPACT");
  });
  it("AIP SUP without data stays manual", () => {
    const e = "TEMPO RESERVED AIRSPACE ACT. REF AIP SUP 999/26";
    const r = assessNotam({ qfir: "RJJJ", start: "2026-11-12 22:00", end: "2026-11-13 13:30", lower: "0", upper: "250", text: `Q)RJJJ/QRACA/IV/NBO/E/0/250\nE)${e}`, e_field: e }, "RJJJ", "FIR", f(), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
  });
});
