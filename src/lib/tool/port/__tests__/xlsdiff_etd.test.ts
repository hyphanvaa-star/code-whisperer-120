import { describe, it, expect } from "vitest";
import { detectMapping } from "../excelcmp_compare";
import { delayKind, delayMin, changeChanged, rowsForUi, type Leg, type Change, type DiffResult } from "../xlsdiff";

function leg(opts: { std?: string; etd?: string; day?: string } = {}): Leg {
  const hm = (s?: string) => {
    if (!s) return null;
    const [h, m] = s.split(":").map(Number);
    return { h: h!, m: m! };
  };
  const day = opts.day ?? "2026-08-22";
  return {
    rowNo: 1, flt: "VJ100", digits: "100", dep: "SGN", arr: "HAN",
    day: new Date(`${day}T00:00:00Z`),
    std: hm(opts.std ?? "10:00"), etd: hm(opts.etd),
    reg: "VN-A100", crewRaw: "", crew: new Set(), dhd: new Set(),
  };
}
function chg(old: Leg, now: Leg): Change {
  return { flt: now.flt, dep: now.dep, arr: now.arr, old, new: now };
}

describe("xlsdiff ETD delay logic", () => {
  it("empty ETD both sides is not delay even if STD differs", () => {
    const c = chg(leg({ std: "10:00" }), leg({ std: "12:00" }));
    expect(delayKind(c)).toBe("");
    expect(delayMin(c)).toBeNull();
    expect(changeChanged(c)).toBe(false);
  });

  it("ETD appearing is first delay against STD", () => {
    const c = chg(leg({ std: "10:00" }), leg({ std: "10:00", etd: "10:45" }));
    expect(delayKind(c)).toBe("first");
    expect(delayMin(c)).toBe(45);
    expect(changeChanged(c)).toBe(true);
  });

  it("same ETD is not another delay", () => {
    const c = chg(leg({ std: "10:00", etd: "11:00" }), leg({ std: "10:00", etd: "11:00" }));
    expect(delayKind(c)).toBe("");
    expect(delayMin(c)).toBeNull();
    expect(changeChanged(c)).toBe(false);
  });

  it("ETD changing again is retime", () => {
    const c = chg(leg({ std: "10:00", etd: "11:00" }), leg({ std: "10:00", etd: "11:30" }));
    expect(delayKind(c)).toBe("retime");
    expect(delayMin(c)).toBe(30);
  });

  it("ETD equal to STD is not counted", () => {
    const c = chg(leg({ std: "10:00" }), leg({ std: "10:00", etd: "10:00" }));
    expect(delayMin(c) || 0).toBe(0);
    expect(changeChanged(c)).toBe(false);
  });
});

describe("xlsdiff mapping", () => {
  it("STD and ETD are separate columns", () => {
    const mp = detectMapping(["DATE", "FLT", "DEP", "ARR", "STD", "ETD", "REG"]);
    expect(mp["std"]).toBe("STD");
    expect(mp["etd"]).toBe("ETD");
  });

  it("UI row shows ETD not STD", () => {
    const c = chg(leg({ std: "10:00" }), leg({ std: "10:00", etd: "10:45" }));
    const res: DiffResult = { oldFile: "a.xlsx", newFile: "b.xlsx", changes: [c], oldLegs: 1, newLegs: 1, oldDays: [], newDays: [], warn: "" };
    const rows = rowsForUi(res);
    expect(rows.length).toBe(1);
    expect(rows[0]!["std_new"]).toBe("10:00");
    expect((rows[0]!["delay"] as Record<string, unknown>)["from"]).toBe("");
    expect((rows[0]!["delay"] as Record<string, unknown>)["to"]).toBe("10:45");
    expect((rows[0]!["delay"] as Record<string, unknown>)["kind"]).toBe("first");
  });
});
