import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module
import { owaAutoPlan, owaAutoBackoff } from "../owa-auto-login.js";

const T0 = 1_000_000_000;
const base = { openedAt: T0, state: "unknown", busy: false, booted: false, lastTryAt: 0, fails: 0, otherTabAt: 0 };

describe("owaAutoPlan", () => {
  it("logs in automatically 30 s after opening the web, not before", () => {
    expect(owaAutoPlan({ ...base, now: T0 + 29_000 }).run).toBe(false);
    expect(owaAutoPlan({ ...base, now: T0 + 30_000 })).toEqual({ run: true, why: "boot" });
  });

  it("re-logs in whenever Outlook Web is not OK", () => {
    const later = { ...base, booted: true, lastTryAt: T0 + 30_000, now: T0 + 3_600_000 };
    expect(owaAutoPlan({ ...later, state: "stale" }).run).toBe(true);
    expect(owaAutoPlan({ ...later, state: "error" }).run).toBe(true);
    expect(owaAutoPlan({ ...later, state: "healthy" }).run).toBe(false);
  });

  it("never opens another login while one runs or MFA waits for a person", () => {
    expect(owaAutoPlan({ ...base, now: T0 + 60_000, busy: true }).run).toBe(false);
    expect(owaAutoPlan({ ...base, now: T0 + 60_000, state: "interactive_required" }).run).toBe(false);
  });

  it("only one tab tries at a time", () => {
    expect(owaAutoPlan({ ...base, now: T0 + 60_000, otherTabAt: T0 + 10_000 }).run).toBe(false);
    expect(owaAutoPlan({ ...base, now: T0 + 200_000, otherTabAt: T0 + 10_000 }).run).toBe(true);
  });

  it("waits 2, 5 then 15 minutes after failed automatic tries", () => {
    expect(owaAutoBackoff(1)).toBe(120_000);
    expect(owaAutoBackoff(2)).toBe(300_000);
    expect(owaAutoBackoff(5)).toBe(900_000);
    const failed = { ...base, booted: true, state: "stale", lastTryAt: T0, fails: 1 };
    expect(owaAutoPlan({ ...failed, now: T0 + 119_000 }).run).toBe(false);
    expect(owaAutoPlan({ ...failed, now: T0 + 120_000 }).run).toBe(true);
  });
});
