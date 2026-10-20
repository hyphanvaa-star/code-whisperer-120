import { describe, expect, it } from "vitest";
import { sameOpsDay } from "../../handlers/fpl.server";

describe("sameOpsDay", () => {
  it("1876 STD 17:40Z 20/10 khớp ngày bảng 20/10 (ngày UTC)", () => {
    expect(sameOpsDay("2026-10-20T17:40:00Z", "20/10/2026")).toBe(true);
  });
  it("3901 STD 18:15Z 20/10 vẫn khớp ngày bảng 21/10 (ngày VN)", () => {
    expect(sameOpsDay("2026-10-20T18:15:00Z", "21/10/2026")).toBe(true);
  });
  it("không khớp ngày khác hẳn", () => {
    expect(sameOpsDay("2026-10-20T10:00:00Z", "22/10/2026")).toBe(false);
  });
});
