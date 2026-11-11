import { describe, expect, it } from "vitest";
import { sameAimsRange, summarizeAimsChanges, watchRange } from "../aims_watch";
import type { DiffResult, Leg } from "../xlsdiff";

const leg = (o: Partial<Leg>): Leg => ({
  rowNo: 1, flt: "VJ123", digits: "123", dep: "SGN", arr: "HAN", day: new Date(Date.UTC(2026, 10, 11)),
  std: { h: 10, m: 0 }, etd: null, reg: "VN-A528", crewRaw: "", crew: new Set(["1001", "1002"]), dhd: new Set(), ...o,
});
const res = (changes: DiffResult["changes"]): DiffResult => ({ oldFile: "a", newFile: "b", changes, oldLegs: 0, newLegs: 0, oldDays: [], newDays: [], warn: "" });

describe("AIMS auto-check", () => {
  it("reports an aircraft change with old and new registration", () => {
    const out = summarizeAimsChanges(res([{ flt: "VJ123", dep: "SGN", arr: "HAN", old: leg({}), new: leg({ reg: "VN-A668" }) }]), false);
    expect(out).toHaveLength(1);
    expect(out[0]!.kinds).toEqual(["reg"]);
    expect(out[0]!.text).toContain("VN-A528 → VN-A668");
    expect(out[0]!.day).toBe("11/11");
  });

  it("reports crew in/out and a new ETD", () => {
    const out = summarizeAimsChanges(res([{ flt: "VJ123", dep: "SGN", arr: "HAN", old: leg({}), new: leg({ crew: new Set(["1001", "2002"]), etd: { h: 10, m: 30 } }) }]), false);
    expect(out[0]!.kinds).toEqual(["crew", "time"]);
    expect(out[0]!.text).toContain("vào 2002");
    expect(out[0]!.text).toContain("ra 1002");
    expect(out[0]!.text).toContain("+30");
  });

  it("stays silent when nothing changed", () => {
    expect(summarizeAimsChanges(res([{ flt: "VJ123", dep: "SGN", arr: "HAN", old: leg({}), new: leg({}) }]), true)).toEqual([]);
  });

  it("counts added/removed sectors only for the same AIMS range", () => {
    const r = res([{ flt: "VJ9", dep: "SGN", arr: "DAD", old: null, new: leg({ flt: "VJ9" }) }]);
    expect(summarizeAimsChanges(r, false)).toEqual([]);
    expect(summarizeAimsChanges(r, true)[0]!.kinds).toEqual(["added"]);
    expect(sameAimsRange("AIMS 1111-1211 09h10.xlsx", "AIMS 1111-1211 15h30.xlsx")).toBe(true);
    expect(sameAimsRange("AIMS 1011-1111 09h10.xlsx", "AIMS 1111-1211 15h30.xlsx")).toBe(false);
    expect(sameAimsRange("crewlist 11.xlsx", "AIMS 1111-1211 15h30.xlsx")).toBe(false);
  });

  it("uses the ops day that started at the saved from-time (VN)", () => {
    // 11/11 03:00 VN = 10/11 20:00Z → still the 10/11 04:55 ops day
    expect(watchRange(Date.UTC(2026, 10, 10, 20, 0), "04:55")).toEqual({ start: "2026-11-10", end: "2026-11-11" });
    // 11/11 05:00 VN
    expect(watchRange(Date.UTC(2026, 10, 10, 22, 0), "04:55")).toEqual({ start: "2026-11-11", end: "2026-11-12" });
  });
});
