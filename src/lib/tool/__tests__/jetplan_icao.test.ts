import { describe, expect, it } from "vitest";
import { planBelongsTo, pickPlan, type PlanRow } from "../handlers/jetplan_icao.server";

describe("planBelongsTo", () => {
  it("chấp nhận trang View ICAO đúng callsign", () => {
    const html = "<html><body>(FPL-VJC859-IS<br>-A321/M-SDE2E3FGHIRWYZ/LB1<br>-RPLL1945</body></html>";
    expect(planBelongsTo(html, "VJC859")).toBe(true);
  });
  it("từ chối trang của chuyến khác", () => {
    const html = "<html><body>(FPL-VJC394-IS<br>-A321/M<br>-VVTS0745</body></html>";
    expect(planBelongsTo(html, "VJC859")).toBe(false);
  });
  it("không nhầm VJC85 với VJC859 (ranh giới từ)", () => {
    const html = "<html><body>(FPL-VJC859-IS</body></html>";
    expect(planBelongsTo(html, "VJC85")).toBe(false);
  });
});

describe("pickPlan", () => {
  const row = (plan: number, callsign: string, t: number): PlanRow => ({ plan, pod: "", poa: "", etd: "", callsign, t });
  it("chọn plan gần giờ muốn nhất", () => {
    const t0 = Date.UTC(2026, 9, 25, 19, 45);
    const rows = [row(7763, "VJC859", t0), row(7700, "VJC859", t0 - 20 * 3600e3)];
    expect(pickPlan(rows, "VJC859", t0)?.plan).toBe(7763);
  });
  it("bỏ plan ngoài ±18h", () => {
    const t0 = Date.UTC(2026, 9, 25, 19, 45);
    const rows = [row(7763, "VJC859", t0 - 30 * 3600e3)];
    expect(pickPlan(rows, "VJC859", t0)).toBeNull();
  });
});
