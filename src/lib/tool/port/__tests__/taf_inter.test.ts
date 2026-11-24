import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as taf from "../taf";
import * as extraWx from "../extra_wx";

// TAF YSSY thực tế của VJ85 (24/11/2026): INTER của Úc nằm sau FM.
const YSSY =
  "TAF YSSY 240229Z 2403/2506 16020KT 9999 -DZ SCT012 BKN018 " +
  "FM241100 14010KT 9999 NSW BKN032 " +
  "INTER 2403/2404 5000 SHRA SCT010 BKN014 " +
  "TEMPO 2404/2408 4000 DZ SCT008 BKN012 " +
  "INTER 2408/2413 5000 DZ SCT010 BKN014=";

function advice(staIso: string) {
  const rec = taf.parseTafBlock(YSSY)!;
  return taf.adviceForFlight("YSSY", staIso, { YSSY: rec }) as any;
}

describe("TAF INTER (Úc)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.UTC(2026, 10, 24, 3, 0))); });
  afterAll(() => { vi.useRealTimers(); });

  it("INTER is split into its own group with its own window", () => {
    const rec = taf.parseTafBlock(YSSY)!;
    const fm = rec.groups.find((g) => g.kind === "FM")!;
    expect(fm.text).toBe("14010KT 9999 NSW BKN032");
    const inter = rec.groups.filter((g) => g.kind === "INTER");
    expect(inter.length).toBe(2);
    expect(inter[0]!.start).toBe("2026-11-24T03:00:00.000Z");
    expect(inter[0]!.end).toBe("2026-11-24T04:00:00.000Z");
  });

  it("VJ85 landing 22:42Z is good weather with no extra", () => {
    const out = advice("2026-11-24T22:42:00.000Z");
    expect(out.status).toBe("ok");
    expect(out.extra_need).toBe(0);
  });

  it("INTER still counts when landing inside its window", () => {
    const out = advice("2026-11-24T10:00:00.000Z");
    expect(out.status).toBe("bad");
    expect(out.tip).toContain("INTER");
  });

  it("time pair 2403/2404 is not read as 2403 m visibility", () => {
    const need = extraWx.needOfText("INTER 2403/2404 5000 SHRA SCT030");
    expect(need.vis).toBe(5000);
    expect(need.band).toBe("A");
    expect(need.minutes).toBe(extraWx.needOfText("5000 SHRA SCT030").minutes);
  });

  it("RMK Q values are not read as visibility", () => {
    const need = extraWx.needOfText("14010KT 9999 NSW SCT030 RMK T 22 24 Q 1015 1014");
    expect(need.vis).toBe(9999);
    expect(need.minutes).toBe(0);
  });
});
