import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-11-13T06:00:00Z");
const eta = new Date("2026-11-13T11:00:00Z");
const f: AssessFlight = {
  etd, eta, roles: { VVPQ: "DEP", RKSI: "ARR" },
  firs: { VVHM: [etd, new Date("2026-11-13T07:00:00Z")] },
  points: [
    { lat: 10.17, lon: 103.99, fl_ft: 0, ete_min: 0, name: "VVPQ" },
    { lat: 37.46, lon: 126.44, fl_ft: 0, ete_min: 300, name: "RKSI" },
  ],
  tokens: new Set(), sid: null, star: null, acType: "A321",
};
const STANDS = "Q)VVHM/QMPLC/IV/BO/A/0/999/1010N10359E\nE)REF AIRAC AIP SUP 54/26 WEF 29 OCT 2026: THE FLW AREA TEMPO CLOSED UNTIL TO 2359 ON 25 NOV 2026 - ITEM 2.1.1: EXTENDED APN 1D, INCLUDING 5 STANDS FOR ACFT CODE C: 20, 21, 22, 23, 24.";
const base = { start: "2026-10-22 15:04", end: "2026-11-25 23:59", lower: "0", upper: "999", qfir: "VVHM", scope: "A" };
const run = (text: string, e: string, extra: Record<string, unknown> = {}) =>
  assessNotam({ ...base, text, e_field: e, ...extra }, "VVPQ", "A", f, DEFAULT_ASSESS_CFG);

describe("aerodrome ground NOTAM citing AIP SUP", () => {
  it("stand closure at DEP is BRIEFING INFO, never UNIDENTIFIED AREA", () => {
    const r = run(STANDS, STANDS.split("E)")[1]!);
    expect(r.level).toBe("BRIEFING INFO");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("ground Q-code without stand/twy words stays manual but not unidentified", () => {
    const e = "REF AIP SUP 54/26 VALID UNTIL 25 NOV 2026 MOVEMENT AREA CHANGES";
    const r = run(`Q)VVHM/QMAXX/IV/BO/A/0/999/1010N10359E\nE)${e}`, e);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("restricted area citing AIP SUP is still UNIDENTIFIED AREA", () => {
    const e = "RESTRICTED AREA ACT. REF AIP SUP 12/26 VALID";
    const r = assessNotam({ ...base, scope: "W", text: `Q)VVHM/QRRCA/IV/BO/W/0/600/1010N10359E\nE)${e}`, e_field: e }, "VVHM", "FIR", f, DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.unidentified_area).toBe(true);
  });
});
