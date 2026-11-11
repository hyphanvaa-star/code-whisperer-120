import { describe, it, expect } from "vitest";
import { notamDActiveNear } from "../notam_track";

const pass = new Date(Date.UTC(2026, 10, 11, 7, 0)); // VJC973 passes ~07:00Z on 11 NOV

describe("TRACKING-HIT respects D) schedule at pass time", () => {
  it("A3043/26: D) dates exclude NOV 11 → not active", () => {
    expect(notamDActiveNear({ d_field: "NOV 01 06 07 08 13 14 21 22 0000-1000" }, pass)).toBe(false);
  });
  it("A2863/26: NOV 11 1730-2130 while flight passes 07:00Z → not active", () => {
    expect(notamDActiveNear({ d_field: "NOV 11 1730-2130" }, pass)).toBe(false);
  });
  it("D) window covering pass time → active", () => {
    expect(notamDActiveNear({ d_field: "NOV 11 0600-0800" }, pass)).toBe(true);
  });
  it("no D) field → active", () => {
    expect(notamDActiveNear({}, pass)).toBe(true);
  });
});
