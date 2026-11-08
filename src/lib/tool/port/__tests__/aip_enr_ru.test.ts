import { describe, it, expect } from "vitest";
import { enrIdsInText, enrGeoms, enrCatalogue } from "../aip_enr_catalog";

describe("Russia ENR 5.1 catalogue", () => {
  it("resolves Russian areas inside any Russian FIR", () => {
    expect(enrIdsInText("ULP1 ACT", "ULLL")).toContain("ULP1");
    // Subregion prefixes span FIR codes: an UN* area can appear in an Irkutsk NOTAM.
    expect(enrIdsInText("UNR1200 ACTIVATED", "UIII")).toContain("UNR1200");
  });
  it("does not resolve Russian ids outside Russia", () => {
    expect(enrIdsInText("ULP1 ACT", "UAAA")).toEqual([]);
    expect(enrIdsInText("UUR201 ACT", "VVHM")).toEqual([]);
  });
  it("keeps published polygons and circles", () => {
    expect(enrGeoms("ULP1")[0]!.ring.length).toBe(5);
    const p4 = enrGeoms("ULP4")[0]!;
    expect(p4.shape).toBe("circle");
    expect(p4.radius_nm).toBeCloseTo(5 / 1.852, 2);
  });
  it("uses the outer circle for stacked tiers", () => {
    expect(enrGeoms("ULR112")[0]!.radius_nm).toBeCloseTo(6 / 1.852, 2);
  });
  it("builds ellipses, arcs and route corridors from their published definitions", () => {
    expect(enrGeoms("UUP56")[0]!.ring.length).toBe(36);
    expect(enrGeoms("UHP316")[0]!.ring.length).toBeGreaterThan(10);
    expect(enrGeoms("UHR1469").length).toBeGreaterThan(5);
  });
  it("never invents areas whose boundary follows the state border", () => {
    expect(enrGeoms("ULP3")).toEqual([]);
    expect(enrGeoms("ULR38")).toEqual([]);
  });
  it("lists Russia in the Database catalogue", () => {
    expect(enrCatalogue().filter(r => r.countryCode === "RU").length).toBeGreaterThan(2600);
  });
});
