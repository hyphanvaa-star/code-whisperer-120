import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-10-10T06:00:00Z");
const eta = new Date("2026-10-10T08:00:00Z");
const f: AssessFlight = {
  etd, eta, roles: { VVTS: "DEP", VVNB: "ARR" },
  firs: { VVHM: [etd, new Date("2026-10-10T07:00:00Z")] },
  points: [
    { lat: 10.8, lon: 106.65, fl_ft: 0, ete_min: 0, name: "VVTS" },
    { lat: 14.0, lon: 107.8, fl_ft: 35000, ete_min: 40, name: "ANLOC" },
    { lat: 21.2, lon: 105.8, fl_ft: 0, ete_min: 120, name: "VVNB" },
  ],
  tokens: new Set(["ANLOC"]), sid: null, star: null, acType: "A321",
};
const base = { start: "2026-10-10 00:00", end: "2026-10-11 00:00", lower: "0", upper: "600", qfir: "VVHM" };
const run = (e: string, extra: Record<string, unknown> = {}) => assessNotam({ ...base, e_field: e, ...extra }, "VVHM", "FIR", f, DEFAULT_ASSESS_CFG);

describe("NOTAM is read in full", () => {
  it("restricted area with a VHF/HF radio sentence is not reduced to BRIEFING INFO", () => {
    const r = run("TEMPORARY RESTRICTED AREA ACTIVATED. CARRIAGE AND USE OF TWO RADIOS VIA VHF OR HF. RADIO NOT AVBL OUTSIDE SECTOR. REF SERVICE VARIATION MAP");
    expect(r.level).toBe("NEED MANUAL CHECK");
    expect(r.unidentified_area).toBe(true);
  });
  it("comms-only outage still stays BRIEFING INFO", () => {
    const r = run("VHF FREQ 123.4 U/S");
    expect(r.level).toBe("BRIEFING INFO");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("restricted area with coordinates crossing the route is CRITICAL, not unidentified", () => {
    const r = run("RESTRICTED AREA ACT WI 10NM RADIUS OF 1400N10748E. VHF FREQ U/S", { coords: "1400N10748E010" });
    expect(r.level).toBe("CRITICAL");
    expect(r.unidentified_area).toBeFalsy();
  });
});
