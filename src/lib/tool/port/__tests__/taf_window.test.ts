import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as taf from "../taf";

const TAF_TSRA_FROM_0700 =
  "TAF VVTS 112300Z 1200/1306 24008KT 9999 SCT017 " +
  "TEMPO 1207/1210 24016G30KT 4000 TSRA SCT015 FEW017CB " +
  "TEMPO 1210/1214 5000 SHRA SCT015 FEW017CB=";
const TAF_ALL_GOOD =
  "TAF VVTS 112300Z 1200/1306 24008KT 9999 SCT017 TEMPO 1207/1210 20010KT 9999 SCT020=";

function at(hh: number, mm = 0): string {
  return new Date(Date.UTC(2026, 7, 12, hh, mm)).toISOString();
}

function advice(raw: string, staIso: string) {
  const rec = taf.parseTafBlock(raw)!;
  const store = { VVTS: rec };
  return taf.adviceForFlight("VVTS", staIso, store) as any;
}

describe("taf window advice", () => {
  // Original test assumes the clock is on the TAF issue day (12/08/2026).
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.UTC(2026, 7, 12, 0, 30))); });
  afterAll(() => { vi.useRealTimers(); });
  it("landing before tempo is not flagged", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(5, 42));
    expect(out.status).toBe("ok");
    expect(out.tip).toContain("04:42–06:42Z");
  });

  it("upcoming bad weather is still reported", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(5, 42));
    expect(out.status).toBe("ok");
    expect(out.tip).toContain("ngoài khung");
    expect(out.tip).toContain("07:00Z");
    expect(out.tip).toContain("18 phút");
    expect(out.tip).toContain("TSRA");
  });

  it("window peak is higher than the exact minute", () => {
    const raw = "TAF VVTS 012300Z 0200/0306 00000KT CAVOK FM020630 24015KT 2000 TSRA BKN008CB=";
    const rec = taf.parseTafBlock(raw)!;
    const when = new Date(Date.UTC(2026, 9, 2, 6, 0));
    const store = { VVTS: rec };
    const one = taf.advise("VVTS", when, store);
    const win = taf.adviceWindow("VVTS", when, store);
    expect(win.extra_need).toBeGreaterThan(Math.trunc(one.extra_need || 0));
    expect(win.segments.some((s) => s.hit)).toBe(true);
  });

  it("landing inside tempo is still flagged", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(8, 0));
    expect(out.status).toBe("bad");
    expect(out.label).toBe("WX xấu - cần extra");
    expect(out.extra_need).toBe(45);
  });

  it("window edge touching tempo start counts", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(6, 0));
    expect(out.status).toBe("bad");
  });

  it("one minute before edge does not count", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(5, 59));
    expect(out.status).toBe("ok");
  });

  it("no heads up when upcoming weather is fine", () => {
    const out = advice(TAF_ALL_GOOD, at(5, 42));
    expect(out.status).toBe("ok");
    expect(out.tip).not.toContain("ngoài khung");
  });

  it("no heads up for weather far beyond window", () => {
    const out = advice(TAF_TSRA_FROM_0700, at(3, 0));
    expect(out.status).toBe("ok");
    expect(out.tip).not.toContain("ngoài khung");
  });
});
