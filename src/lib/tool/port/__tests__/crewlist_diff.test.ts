import { describe, it, expect } from "vitest";
import { mergeCrewlistDiff } from "../crewlist_diff";
import type { DiffResult, Leg } from "../xlsdiff";

const leg = (crew: string[], reg = "VN-A630"): Leg => ({
  rowNo: 1, flt: "352", digits: "352", dep: "SGN", arr: "BMV",
  day: new Date(Date.UTC(2026, 9, 20)), std: { h: 18, m: 15 }, etd: null, reg,
  crewRaw: crew.join(";"), crew: new Set(crew), dhd: new Set(),
} as unknown as Leg);
const res = (o: Leg, n: Leg): DiffResult => ({ oldFile: "a", newFile: "b", changes: [{ flt: "352", dep: "SGN", arr: "BMV", old: o, new: n }], oldLegs: 1, newLegs: 1, oldDays: [], newDays: [], warn: "" } as DiffResult);

describe("mergeCrewlistDiff", () => {
  it("adds a crew-only row when two crewlists differ", () => {
    const rows: Array<Record<string, unknown>> = [];
    expect(mergeCrewlistDiff(rows, res(leg(["17430"]), leg(["13064"])))).toBe(1);
    expect((rows[0]!["crew"] as { out: string[]; in: string[] })).toMatchObject({ out: ["17430"], in: ["13064"] });
  });
  it("ignores flights whose crew did not change", () => {
    const rows: Array<Record<string, unknown>> = [];
    expect(mergeCrewlistDiff(rows, res(leg(["1960"], "VN-A535"), leg(["1960"], "VN-A551")))).toBe(0);
    expect(rows.length).toBe(0);
  });
  it("attaches crew change to an existing FPL VER row of the same flight", () => {
    const rows: Array<Record<string, unknown>> = [{ flt: "352", route: "SGN-BMV", day_new: "20/10", crew: { changed: false } }];
    mergeCrewlistDiff(rows, res(leg(["17430"]), leg(["13064"])));
    expect(rows.length).toBe(1);
    expect((rows[0]!["crew"] as { changed: boolean }).changed).toBe(true);
  });
});
