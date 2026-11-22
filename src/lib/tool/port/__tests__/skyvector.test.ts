import { describe, expect, it } from "vitest";
import { svAiracCycle, svParseInit, svPrevCycle, SV_DEFAULT_BASE } from "../skyvector";

describe("SkyVector edition", () => {
  it("computes the AIRAC cycle in effect", () => {
    expect(svAiracCycle(Date.UTC(2026, 10, 22))).toBe(2611);
    expect(svAiracCycle(Date.UTC(2026, 9, 28))).toBe(2610);
    expect(svAiracCycle(Date.UTC(2026, 9, 29))).toBe(2611);
    expect(svAiracCycle(Date.UTC(2026, 10, 26))).toBe(2612);
    expect(svAiracCycle(Date.UTC(2026, 0, 22))).toBe(2601);
  });
  it("steps back across a year boundary", () => {
    expect(svAiracCycle(Date.UTC(2027, 0, 25))).toBe(2701);
    expect(svPrevCycle(2701, Date.UTC(2027, 0, 25))).toBe(2613);
    expect(svPrevCycle(2611, Date.UTC(2026, 10, 22))).toBe(2610);
  });
  it("reads edition and tile server from SkyVector init", () => {
    expect(svParseInit({ edition: 2611, tileservers: "https://t.skyvector.com/ABPNMzP6pI9L,https://t.skyvector.com/ABPNMzP6pI9L" }))
      .toEqual({ base: "https://t.skyvector.com/ABPNMzP6pI9L", edition: 2611 });
    expect(svParseInit({ edition: 2612, tileservers: "https://evil.example/x" })).toEqual({ base: SV_DEFAULT_BASE, edition: 2612 });
    expect(svParseInit({ edition: "abc" })).toBeNull();
  });
});
