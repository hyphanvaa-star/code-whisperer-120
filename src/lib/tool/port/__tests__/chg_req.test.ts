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
  it("đọc tên DSP dạng 'DISPATCHER:' và dòng crew dính chữ (OFP VJC345)", () => {
    const ofp = [
      "VIETJETAIR DISPATCH FLIGHT RELEASE VJC345",
      "-DISPATCHER BRIEFING ......./.......",
      "- DISPATCHER: PHAN THANH HY",
      "END OF DISPATCH FLIGHT RELEASE VJC345",
      "CAPT 6065 GASSER AH FO 8763 IVAN LLODISPATCHER PHAN THANH HY",
    ].join("\n");
    expect(ofpDispatcher(ofp)).toBe("PHAN THANH HY");
    expect(ofpDispatcher("CAPT 6065 GASSER AH FO 8763 IVAN LLODISPATCHER NGUYEN VAN A")).toBe("NGUYEN VAN A");
  });
  it("không lấy dòng checklist làm tên DSP", () => {
    expect(ofpDispatcher("-DISPATCHER BRIEFING ......./.......\nDISPATCHER BRIEFING")).toBe("");
    expect(ofpDispatcher("VIETJETAIR DISPATCH FLIGHT RELEASE VJC345")).toBe("");
  });
});
