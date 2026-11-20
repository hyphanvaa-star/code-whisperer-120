import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error browser-safe JS module without types
import { nmPinBarPlan, nmPinCsKey } from "../notam-pin-bar.js";

describe("NOTAM pin bar targets the tracked flight", () => {
  it("does not show or prefill an older pinned flight (VJC5880) while tracking VJC5230", () => {
    const p = nmPinBarPlan("VJC5230", ["VJC5880"]);
    expect(p.label).toBe("+ Ghim VJC5230");
    expect(p.input).toBe("VJC5230");
    expect(p.pinnedHere).toBe(false);
    expect(p.pinned).toEqual(["VJC5880"]);
  });

  it("marks the tracked flight as pinned once it is", () => {
    const p = nmPinBarPlan("5230", ["VJC5880", "VJC5230"]);
    expect(p.label).toBe("Đã ghim VJC5230 ✓");
    expect(p.pinnedHere).toBe(true);
  });

  it("falls back to a blank Add chuyến without a tracked flight", () => {
    const p = nmPinBarPlan("", ["VJC5880"]);
    expect(p.label).toBe("Add chuyến");
    expect(p.input).toBe("");
  });

  it("normalises callsigns like the server", () => {
    expect(nmPinCsKey("vj820")).toBe("VJC820");
    expect(nmPinCsKey("820")).toBe("VJC820");
  });

  it("is wired into the tool page shim", () => {
    const shim = readFileSync("src/routes/tool-page.ts", "utf8");
    expect(shim).toContain("notamPinBarScript");
    expect(shim).toContain("nmPinBarPlan(");
  });
});
