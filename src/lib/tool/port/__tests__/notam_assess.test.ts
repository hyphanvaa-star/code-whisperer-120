import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, parseSchedule, scheduleActiveAt, type AssessFlight } from "../notam_assess";

const etd = new Date("2026-10-10T06:00:00Z");
const eta = new Date("2026-10-10T08:00:00Z");
const pts = [
  { lat: 10.8, lon: 106.65, fl_ft: 0, ete_min: 0, name: "VVTS" },
  { lat: 11.5, lon: 107.0, fl_ft: 15000, ete_min: 10, name: "VIDEN" },
  { lat: 14.0, lon: 107.8, fl_ft: 35000, ete_min: 40, name: "ANLOC" },
  { lat: 18.0, lon: 106.5, fl_ft: 35000, ete_min: 90, name: "BIVIM" },
  { lat: 21.2, lon: 105.8, fl_ft: 0, ete_min: 120, name: "VVNB" },
];
const flight = (patch: Partial<AssessFlight> = {}): AssessFlight => ({
  etd, eta,
  roles: { VVTS: "DEP", VVNB: "ARR" },
  firs: { VVHM: [etd, new Date("2026-10-10T07:00:00Z")], VVHN: [new Date("2026-10-10T07:00:00Z"), eta] },
  points: pts, tokens: new Set(["W1", "ANLOC", "BIVIM", "VIDEN2G"]),
  sid: "VIDEN2G", star: null, acType: "A321", ...patch,
});
const base = { start: "2026-10-10 00:00", end: "2026-10-11 00:00", lower: "0", upper: "999", qfir: "VVHM" };
const cfg = DEFAULT_ASSESS_CFG;
const run = (n: Record<string, unknown>, code = "VVTS", kind = "AD", f = flight()) =>
  assessNotam({ ...base, ...n }, code, kind, f, cfg);

describe("five-level NOTAM assessment", () => {
  it("ALL TWY CLSD at DEP during ETD is CRITICAL, not dropped", () => {
    expect(run({ e_field: "ALL TWY CLSD DUE WIP" }).level).toBe("CRITICAL");
  });
  it("one taxiway closed is BRIEFING INFO", () => {
    expect(run({ e_field: "TWY E3 CLSD" }).level).toBe("BRIEFING INFO");
  });
  it("area with radius farther than radius + 5 NM is NO IMPACT", () => {
    const r = run({ e_field: "MIL EXER WI 5NM RADIUS OF 0500N10000E", coords: "0500N10000E005" }, "VVHM", "FIR");
    expect(r.level).toBe("NO IMPACT");
  });
  it("same FIR, no coordinates, no segment is NEED MANUAL CHECK", () => {
    expect(run({ e_field: "ATC SECTOR REORGANISATION IN PROGRESS" }, "VVHM", "FIR").level).toBe("NEED MANUAL CHECK");
  });
  it("missing B or C is NEED MANUAL CHECK", () => {
    expect(run({ e_field: "TWY E3 CLSD", end: "" }).level).toBe("NEED MANUAL CHECK");
  });
  it("VFR-only NOTAM is NO IMPACT", () => {
    expect(run({ e_field: "VFR FLIGHTS NOT PERMITTED IN AREA" }, "VVHM", "FIR").level).toBe("NO IMPACT");
  });
  it("planned FL outside lower/upper is NO IMPACT, but ATS segment on route is BRIEFING INFO", () => {
    const area = run({ e_field: "PJE WI 3NM RADIUS OF 1400N10748E PROHIBITED", coords: "1400N10748E003", lower: "0", upper: "100" }, "VVHM", "FIR");
    expect(area.level).toBe("NO IMPACT");
    const seg = run({ e_field: "ATS RTE SEGMENT W1 (ANLOC-BIVIM) CLSD", lower: "0", upper: "100" }, "VVHM", "FIR");
    expect(seg.level).toBe("BRIEFING INFO");
  });
  it("SID on FPL active only after SID exit even with 180 min delay is NO IMPACT", () => {
    const r = run({ e_field: "VIDEN2G SID NOT AVBL", start: "2026-10-10 12:00", end: "2026-10-10 14:00" });
    expect(r.level).toBe("NO IMPACT");
  });
  it("SID on FPL active during SID is CRITICAL, or DELAY-ONLY when only after delay", () => {
    expect(run({ e_field: "VIDEN2G SID NOT AVBL" }).level).toBe("CRITICAL");
    const late = run({ e_field: "VIDEN2G SID NOT AVBL", start: "2026-10-10 06:30", end: "2026-10-10 07:00" });
    expect(late.level).toBe("DELAY-ONLY");
    expect(late.earliest_impact_delay_minutes).toBeGreaterThan(0);
  });
  it("navaid not on FPL is not an airport match even when field A is the destination", () => {
    const r = run({ e_field: "DVOR/DME 'XXX' U/S" }, "VVNB");
    expect(r.level).toBe("NO IMPACT");
  });
  it("schedule DAILY with EXC weekday", () => {
    const s = parseSchedule("DAILY 0100-0300 EXC SAT");
    expect(scheduleActiveAt(s, new Date("2026-10-10T02:00:00Z"), null)).toBe(false); // Saturday
    expect(scheduleActiveAt(s, new Date("2026-10-11T02:00:00Z"), null)).toBe(true);
  });
});
