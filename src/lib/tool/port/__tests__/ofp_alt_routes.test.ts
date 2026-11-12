import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseAltRoutes } from "../ofp_alt_routes";

const ofp = readFileSync(join(__dirname, "fixtures/quick_pack_vj5288.txt"), "utf8");

describe("parseAltRoutes (explicit ROUTE TO … ALTERNATE headings)", () => {
  const r = parseAltRoutes(ofp, "ZSHC");

  it("ALT1 is the ZSHC→ZSNJ alternate leg, not the main VVCR→ZSHC route", () => {
    const names = r.alt1!.points.map((p) => p.name);
    expect(r.alt1!.icao).toBe("ZSNJ");
    expect(names[0]).toBe("DER24");
    expect(names[names.length - 1]).toBe("ZSNJ");
    expect(names).not.toContain("CR300");
    expect(names).not.toContain("M771");
  });

  it("ALT2 is the ZSHC→ZSNB alternate leg", () => {
    const names = r.alt2!.points.map((p) => p.name);
    expect(r.alt2!.icao).toBe("ZSNB");
    expect(names[names.length - 1]).toBe("ZSNB");
    expect(names).toContain("SUPAR");
    expect(names).not.toContain("VVCR");
  });
});
