import { describe, expect, it } from "vitest";
import { rwyClosedText } from "../rwy_closed";
import { parseSchedule, scheduleActiveAt } from "../notam_assess";

describe("runway closure is recognised in any common wording", () => {
  it.each([
    "RWY 25R/07L TEMPO CLOSED",
    "RWY 10R/28L TEMPO CLSD. REF AIRAC AIP SUP 54/26",
    "RWY11 CLOSED DUE TO MAINT",
    "RWY CLOSED",
    "RUNWAY 07L/25R TEMPORARILY CLOSED",
    "RWY 07L/25R AND RWY 07R/25L CLSD",
    "RWY 07L, 07R ARE CLSD",
    "RWY 11/29 WILL BE COMPLETELY CLOSED",
    "RWY 02/20 (3048M) CLSD DUE WIP",
    "RWY 16L/34R PARTIALLY CLSD",
    "RWY 16L/34R NOT AVBL",
    "RWY 09 NOT AVBL FOR TKOF AND LDG",
    "RWY 09/27 U/S",
    "CLOSURE OF RWY 10R/28L",
    "CLOSED RWY 11",
    "RWY 25R/07L\nTEMPO CLOSED",
  ])("%s", (e) => expect(rwyClosedText(e)).toBe(true));
  it.each([
    "RWY 25R ILS U/S",
    "TWY A BTN RWY 25R AND TWY B CLSD",
    "RWY 25L TORA REDUCED TO 2100M",
    "RWY 07L PAPI NOT AVBL",
    "PAPI RWY 25L NOT AVBL",
    "ILS RWY 07R U/S",
    "RWY 07 NOT AVBL FOR INTERSECTION DEP",
    "RWY 25R CL LGT U/S",
    "CLSD RWY SHOULDER NORTH SIDE",
    "RWY 11 END LGT CLSD",
    "TWY M CLSD. RWY 25L OPS NML",
  ])("not a runway closure: %s", (e) => expect(rwyClosedText(e)).toBe(false));
});

describe("item D schedule accepts the usual free wording", () => {
  const at = (d: string, iso: string) => scheduleActiveAt(parseSchedule(d), new Date(iso), null);
  it("U5363/26 — 1830-2230 ON NOV 24 AND 28 leaves the 27th free", () => {
    const s = parseSchedule("1830-2230 ON NOV 24 AND 28");
    expect(s.unsupported).toEqual([]);
    expect(at("1830-2230 ON NOV 24 AND 28", "2026-11-27T19:00:00Z")).toBe(false);
    expect(at("1830-2230 ON NOV 24 AND 28", "2026-11-24T19:00:00Z")).toBe(true);
    expect(at("1830-2230 ON NOV 24 AND 28", "2026-11-28T22:00:00Z")).toBe(true);
    expect(at("1830-2230 ON NOV 24 AND 28", "2026-11-28T10:00:00Z")).toBe(false);
  });
  it.each([
    ["NOV 24 AND 28 1830-2230", "2026-11-24T19:00:00Z", true],
    ["NOVEMBER 24TH & 28TH BTN 1830 AND 2230", "2026-11-28T19:00:00Z", true],
    ["24NOV, 28NOV 18:30-22:30 UTC", "2026-11-27T19:00:00Z", false],
    ["EVERY MONDAY AND FRIDAY FROM 1830Z TO 2230Z", "2026-11-27T19:00:00Z", true], // Friday
    ["EVERY MONDAY AND FRIDAY FROM 1830Z TO 2230Z", "2026-11-26T19:00:00Z", false],
    ["MON THRU FRI 0100-0500 EXCEPT WEDNESDAY", "2026-11-25T02:00:00Z", false], // Wednesday
    ["MON THRU FRI 0100-0500 EXCEPT WEDNESDAY", "2026-11-26T02:00:00Z", true],
    ["EACH DAY 0100-0500", "2026-11-26T02:00:00Z", true],
  ] as const)("%s @ %s", (d, iso, want) => {
    expect(parseSchedule(d).unsupported).toEqual([]);
    expect(at(d, iso)).toBe(want);
  });
  it("wording that could change the meaning stays not understood", () => {
    expect(parseSchedule("EVERY 2 DAYS 0100-0500").unsupported.length).toBeGreaterThan(0);
    expect(parseSchedule("ODD DAYS 0100-0500").unsupported.length).toBeGreaterThan(0);
    expect(parseSchedule("SR MINUS30-SS PLUS30").unsupported.length).toBeGreaterThan(0);
  });
});

import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

describe("the three reported NOTAMs no longer land in manual check", () => {
  // VJC6856 USSS-VVPQ, alternates VVTS and ZUTF, evening of 27 NOV.
  const etd = new Date("2026-11-27T12:00:00Z"), eta = new Date("2026-11-27T20:00:00Z");
  const f: AssessFlight = {
    etd, eta, roles: { USSS: "DEP", VVPQ: "ARR", VVTS: "ALT", ZUTF: "ALT" }, firs: {},
    points: [], tokens: new Set(), sid: null, star: null, acType: "A321",
  };
  const run = (n: Record<string, unknown>, code: string) =>
    assessNotam({ lower: "0", upper: "999", ...n }, code, "AD", f, DEFAULT_ASSESS_CFG);
  it("A4307/26 VVTS — RWY 25R/07L TEMPO CLOSED is a runway closure, not an alternate manual check", () => {
    const r = run({ start: "2026-11-10 18:00", end: "2026-12-09 23:00", d_field: "DAILY 1800-2300", e_field: "RWY 25R/07L TEMPO CLOSED" }, "VVTS");
    expect(r.match_type).toBe("RWY-CLOSED");
    expect(r.level).not.toBe("NEED MANUAL CHECK");
  });
  it("A4495/26 VVPQ — RWY 10R/28L TEMPO CLSD with an AIP SUP reference is graded as a runway closure", () => {
    const r = run({ start: "2026-11-20 00:00", end: "2026-12-20 00:00", e_field: "RWY 10R/28L TEMPO CLSD. REF AIRAC AIP SUP 54/26" }, "VVPQ");
    expect(r.match_type).toBe("RWY-CLOSED");
    expect(r.level).toBe("CRITICAL");
  });
  it("U5363/26 ZUTF — closed only on NOV 24 and 28, so the 27th is not affected", () => {
    const r = run({ start: "2026-11-24 18:30", end: "2026-11-28 22:30", d_field: "1830-2230 ON NOV 24 AND 28", e_field: "RWY11 CLOSED DUE TO MAINT" }, "ZUTF");
    expect(r.level).toBe("NO IMPACT");
  });
});
