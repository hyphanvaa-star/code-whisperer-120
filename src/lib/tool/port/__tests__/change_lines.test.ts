import { describe, it, expect } from "vitest";
import { diffLines } from "../change_lines";

describe("diffLines", () => {
  it("shows only added and removed items", () => {
    const prev = { curfew: [{ code: "THD", start: "16:00", end: "23:00" }, { code: "PXU", start: "14:00", end: "23:00" }] };
    const next = { curfew: [{ code: "THD", start: "16:00", end: "23:00" }, { code: "VII", start: "06:30", end: "08:00" }] };
    expect(diffLines(prev, next)).toEqual({
      added: ["Giờ cấm bay (curfew) › VII: cấm 06:30 – 08:00"],
      removed: ["Giờ cấm bay (curfew) › PXU: cấm 14:00 – 23:00"],
    });
  });
});
