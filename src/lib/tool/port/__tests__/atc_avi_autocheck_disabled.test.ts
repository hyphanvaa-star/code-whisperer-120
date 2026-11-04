import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/tool/page.html", "utf8");

describe("ATC avi auto-check disabled", () => {
  it("does not auto-trigger the AviWeb EOBT check from CHG/DLA cells", () => {
    // Người trực muốn tự bấm nút Check ATC avi, không chạy ngầm nữa.
    expect(page).not.toContain("setTimeout(vAviAutoCheck");
  });

  it("keeps the manual Check ATC avi run available", () => {
    expect(page).toContain('"/api/atc/check"');
    expect(page).toContain('title="Check trạng thái FPL trên AviWeb (Selenium chạy nền)"');
  });

  it("tells the dispatcher to press Check ATC avi when EOBT is missing", () => {
    expect(page).toContain("bấm nút Check ATC avi để tự lấy");
  });
});
