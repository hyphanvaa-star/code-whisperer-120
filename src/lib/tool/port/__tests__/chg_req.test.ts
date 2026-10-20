import { describe, it, expect } from "vitest";
import { extraMinutesText, ofpDispatcher } from "../fpl_tool";
describe("REQ đổi tàu/crew", () => {
  it("extra lấy theo phút", () => {
    expect(extraMinutesText("0:20")).toBe("20M");
    expect(extraMinutesText("1:05")).toBe("65M");
    expect(extraMinutesText("0:00")).toBe("0");
    expect(extraMinutesText(null)).toBe("0");
  });
  it("giữ tên DSP từ OFP cũ", () => {
    expect(ofpDispatcher("CAPT 13330 KONOVALO   FO 13054 LE ANH DISPATCHER PHAN THANH HY\nROUTE X")).toBe("PHAN THANH HY");
  });
});
