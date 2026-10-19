import { describe, it, expect } from "vitest";
import { checkAgainstStd } from "../pibwx_time";

const std = new Date(Date.UTC(2026, 9, 19, 6, 40));

describe("PIB/WX time vs STD (4h)", () => {
  it("rejects a file dated 12/10 for a 19/10 flight", () => {
    expect(checkAgainstStd("ISSUED 12OCT26 0530", std).ok).toBe(false);
  });
  it("accepts a file within 4h of STD", () => {
    expect(checkAgainstStd("Issued: 19/10/2026 03:10", std).ok).toBe(true);
  });
  it("rejects a file 5h from STD", () => {
    expect(checkAgainstStd("2026-10-19 01:30", std).ok).toBe(false);
  });
  it("reads METAR day-time group", () => {
    expect(checkAgainstStd("VVTS 190400Z 18005KT", std).ok).toBe(true);
    expect(checkAgainstStd("VVTS 120400Z 18005KT", std).ok).toBe(false);
  });
  it("rejects a file with no readable time", () => {
    expect(checkAgainstStd("no dates here", std).ok).toBe(false);
  });
});
