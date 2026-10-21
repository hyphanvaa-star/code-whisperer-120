import { describe, it, expect } from "vitest";
import { cloudHitsFlight } from "../notam_pin";

const U = (s: string) => Date.parse(s);
const VVVH = "A)VVVH B)202610210635 C)202610310800\nD)DAILY 0635-0800\nE)VINH DOM AD NOT AVBL";
const RKRR = "A)RKRR B)202609290719 C)202610311500\nE)GPS UNRELIABLE";

describe("cloud NOTAM time filter (±2h)", () => {
  it("no D: takes when B–C covers the flight", () => {
    expect(cloudHitsFlight(RKRR, { from: U("2026-10-21T01:00Z"), to: U("2026-10-21T03:00Z") })).toBe(true);
  });
  it("no D: skips when flight after C+2h", () => {
    expect(cloudHitsFlight(RKRR, { from: U("2026-11-01T01:00Z"), to: U("2026-11-01T03:00Z") })).toBe(false);
  });
  it("D hit within 2h buffer is taken", () => {
    // flight 01:00-04:40Z, +2h = 06:40Z overlaps 0635
    expect(cloudHitsFlight(VVVH, { from: U("2026-10-22T01:00Z"), to: U("2026-10-22T04:40Z") })).toBe(true);
  });
  it("D missed even with buffer is skipped", () => {
    expect(cloudHitsFlight(VVVH, { from: U("2026-10-22T00:00Z"), to: U("2026-10-22T02:00Z") })).toBe(false);
  });
  it("in D but before B is skipped", () => {
    expect(cloudHitsFlight(VVVH, { from: U("2026-10-20T06:00Z"), to: U("2026-10-20T07:00Z") })).toBe(false);
  });
});
