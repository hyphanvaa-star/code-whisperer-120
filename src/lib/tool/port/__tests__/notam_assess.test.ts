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
const run = (n: Record<string, unknown>, code = "VVTS", kind = "AD", f = flight(), c = cfg) =>
  assessNotam({ ...base, ...n }, code, kind, f, c);

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
    const area = run({ e_field: "PJE WI 3NM RADIUS OF 1400N10748E PROHIBITED", coords: "1400N10748E003", lower: "0", upper: "100" }, "VVHM", "FIR", flight(), { ...cfg, alt_buffer_ft: 0 });
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

describe("listed ATS route closures (A5783/26 style)", () => {
  const E = "FLW SEGMENT OF ATS RTE CLOSED BTN 6,300M(INCLUSIVE) AND 9,200M(INCLUSIVE):\n1. W215 : YINCHUAN VOR'YHD' - DOMVA.\n2. W213 : GUYUAN VOR'GUY'- APESU.\n3. W214 : JINGNING VOR'JIG'- BIGUX.\n4. W1 : ANLOC - BIVIM.\n5. B330 : BIGUX - KIDIX.";
  it("segment on route is CRITICAL, not a NAVAID miss", () => {
    const r = run({ e_field: E, lower: "207", upper: "301", f_field: "FL207", g_field: "FL301" }, "VVHM", "FIR",
      flight({ points: pts.map((p) => p.fl_ft ? { ...p, fl_ft: 25000 } : p) }));
    expect(r.match_type).toBe("ROUTE-SEGMENT");
    expect(r.level).toBe("CRITICAL");
  });
  it("no listed segment on route is NO IMPACT via ROUTE-SEGMENT", () => {
    const r = run({ e_field: E.replace("4. W1 : ANLOC - BIVIM.", "") }, "VVHM", "FIR");
    expect(r.match_type).toBe("ROUTE-SEGMENT");
    expect(r.level).toBe("NO IMPACT");
  });
});

describe("operational keyword catalogue", () => {
  it("TORA reduced at DEP needs manual check", () => {
    expect(run({ e_field: "RWY 25L TORA REDUCED TO 2100M" }).level).toBe("NEED MANUAL CHECK");
  });
  it("no fuel at DEP needs manual check", () => {
    expect(run({ e_field: "JET A1 FUEL NOT AVBL" }).level).toBe("NEED MANUAL CHECK");
  });
  it("curfew at DEP needs manual check", () => {
    expect(run({ e_field: "AD CURFEW 1600-2200 NO DEP" }).level).toBe("NEED MANUAL CHECK");
  });
  it("PAPI unavailable is briefing", () => {
    expect(run({ e_field: "PAPI RWY 25L NOT AVBL" }).level).toBe("BRIEFING INFO");
  });
  it("NDB unserviceable is briefing", () => {
    expect(run({ e_field: "LOCATOR NDB TS U/S" }).level).toBe("BRIEFING INFO");
  });
  it("frequency change is briefing", () => {
    expect(run({ e_field: "TWR FREQ CHANGED TO 118.700" }).level).toBe("BRIEFING INFO");
  });
  it("runway closure is still critical", () => {
    expect(run({ e_field: "RWY 07L/25R CLSD" }).level).toBe("CRITICAL");
  });
});
