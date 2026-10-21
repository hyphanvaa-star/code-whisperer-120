import { describe, it, expect } from "vitest";
import { checkAgainstStd } from "../pibwx_time";

const std = new Date("2026-10-20T05:10:00Z");
const pib = (system = "26-10-20 02:10", validity = "26-10-20 05:10") => `SYSTEM TIME: ${system}\nBULLETIN VALIDITY PERIOD: ${validity} TO 26-10-21 05:10`;

describe("PIB/WX time vs STD (4h)", () => {
  it("reads exactly the WX ETD header shown by the user", () => {
    const result = checkAgainstStd("E.T.D.: 05:10 UTC 20 Oct 2026", std, 4, "wx");
    expect(result.ok).toBe(true);
    expect(result.nearest?.toISOString()).toBe("2026-10-20T05:10:00.000Z");
  });
  it("reads PIB YY-MM-DD as year-month-day, with both marked fields", () => {
    const result = checkAgainstStd(pib(), std, 4, "pib");
    expect(result.ok).toBe(true);
    expect(result.fields.map((f) => f.time.toISOString())).toEqual(["2026-10-20T02:10:00.000Z", "2026-10-20T05:10:00.000Z"]);
  });
  it("accepts exactly 6h before and after STD", () => {
    expect(checkAgainstStd("E.T.D.: 23:10 UTC 19 Oct 2026", std).ok).toBe(true);
    expect(checkAgainstStd("E.T.D.: 11:10 UTC 20 Oct 2026", std).ok).toBe(true);
  });
  it("rejects over 6h even by one minute", () => {
    expect(checkAgainstStd("E.T.D.: 23:09 UTC 19 Oct 2026", std).ok).toBe(false);
    expect(checkAgainstStd("E.T.D.: 11:11 UTC 20 Oct 2026", std).ok).toBe(false);
  });
  it("never rescues stale WX with current METAR, TAF or NOTAM body dates", () => {
    expect(checkAgainstStd("E.T.D.: 05:10 UTC 12 Oct 2026\nMETAR VVTS 200510Z\nTAF 20/10/2026 05:10\nB)2610200510", std).ok).toBe(false);
  });
  it("rejects body-only dates without the required header", () => {
    expect(checkAgainstStd("VVTS 200510Z\nISSUED 20OCT26 0510\n2026-10-20 05:10\n2610200510", std).ok).toBe(false);
  });
  it("rejects stale PIB SYSTEM TIME even when validity is current", () => {
    const result = checkAgainstStd(pib("26-10-12 02:10"), std, 4, "pib");
    expect(result.ok).toBe(false);
    expect(result.field).toBe("SYSTEM TIME");
  });
  it("rejects stale PIB validity even with current SYSTEM TIME and current validity end", () => {
    expect(checkAgainstStd(pib("26-10-20 02:10", "26-10-12 05:10"), std, 4, "pib").ok).toBe(false);
  });
  it("requires both PIB fields and does not fall back to WX", () => {
    expect(checkAgainstStd("SYSTEM TIME: 26-10-20 02:10\nE.T.D.: 05:10 UTC 20 Oct 2026", std, 4, "pib").ok).toBe(false);
  });
  it("supports line breaks between header labels and values", () => {
    expect(checkAgainstStd("E. T. D. :\n05:10 UTC\n20 Oct 2026", std).ok).toBe(true);
    expect(checkAgainstStd("SYSTEM\nTIME:\n26-10-20 02:10\nBULLETIN VALIDITY\nPERIOD:\n26-10-20 05:10", std, 4, "pib").ok).toBe(true);
  });
  it("compares absolute UTC across midnight", () => {
    expect(checkAgainstStd("E.T.D.: 23:10 UTC 19 Oct 2026", new Date("2026-10-20T01:10:00Z")).ok).toBe(true);
  });
  it("rejects invalid calendar dates and times", () => {
    expect(checkAgainstStd("E.T.D.: 05:10 UTC 31 Feb 2026", std).ok).toBe(false);
    expect(checkAgainstStd(pib("26-10-20 25:10"), std, 4, "pib").ok).toBe(false);
  });
  it("cannot use a header from a later page", () => {
    expect(checkAgainstStd("no header\fE.T.D.: 05:10 UTC 20 Oct 2026", std).ok).toBe(false);
  });
  it("rejects a file with no readable time", () => {
    expect(checkAgainstStd("no dates here", std).ok).toBe(false);
  });
});
