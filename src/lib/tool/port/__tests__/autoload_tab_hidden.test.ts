import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/tool/page.html", "utf8");

describe("Auto-download tab hidden", () => {
  it("hides the Tự động tải and Check ATC avi tab buttons", () => {
    expect(page).toContain('id="mFpl"');
    expect(page).toContain('id="mFpl" role="tab" aria-selected="false" style="display:none"');
    expect(page).toContain('id="mAtcCheck"');
    expect(page).toContain('id="mAtcCheck" role="tab" aria-selected="false" style="display:none"');
  });

  it("keeps the FPL scan and Omni auto loops running from boot", () => {
    // fplWatchStartUi chạy lúc mở trang: quét FPL 15s và Omni 1 giờ vẫn chạy nền.
    expect(page).toContain("function fplWatchStartUi(){");
    expect(page).toContain("setInterval(omniAutoPoll, 10000)");
    expect(page).toContain("fplWatchStartUi();");
  });

  it("keeps the Omni auto checkbox and status fields in the DOM", () => {
    expect(page).toContain('id="omniAuto"');
    expect(page).toContain('id="omniClock"');
    expect(page).toContain('id="omniAgeVal"');
  });
});
