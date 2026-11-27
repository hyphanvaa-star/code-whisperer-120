import { describe, expect, it } from "vitest";
import { isPcWaitTimeout, pcDest } from "../pc_drive";

describe("pcDest", () => {
  it("keeps D: when the PC has a D drive", () => {
    expect(pcDest("D:\\", true, "briefing")).toBe("D:\\");
    expect(pcDest("D:\\MEL", undefined, "mel")).toBe("D:\\MEL");
  });
  it("moves subfolders to C: when there is no D drive", () => {
    expect(pcDest("D:\\MEL", false, "mel")).toBe("C:\\MEL");
  });
  it("never saves briefing into the bare C:\\ root", () => {
    expect(pcDest("D:\\", false, "briefing")).toBe("C:\\Briefing");
    expect(pcDest("C:\\", true, "briefing")).toBe("C:\\Briefing");
    expect(pcDest("c:", false, "omni")).toBe("C:\\OMC");
  });
});

describe("isPcWaitTimeout", () => {
  it("separates a queued job from a write the PC refused", () => {
    expect(isPcWaitTimeout(new Error("hết thời gian chờ trợ lý PC — kiểm tra trợ lý"))).toBe(true);
    expect(isPcWaitTimeout(new Error("[Errno 13] Permission denied: 'C:\\\\VJC6856_Briefing.pdf'"))).toBe(false);
  });
});
