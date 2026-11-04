import { test, expect } from "vitest";
import { vnToUtc } from "../../handlers/fpl.server";
test("tz", () => { expect(vnToUtc("10:50","RKSI")).toBe("0150"); expect(vnToUtc("10:50","VVTS")).toBe("0350"); });
