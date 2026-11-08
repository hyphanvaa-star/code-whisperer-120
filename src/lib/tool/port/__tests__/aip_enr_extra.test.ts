import { describe, it, expect } from "vitest";
import { enrIdsInText, enrGeoms, enrCatalogue } from "../aip_enr_catalog";

describe("Czech + Kazakhstan ENR 5.1/5.2 catalogue", () => {
  it("resolves Kazakhstan restricted/prohibited areas inside UA FIRs", () => {
    expect(enrIdsInText("UAR1 ACT FL260/GND", "UAAA")).toContain("UAR1");
    const p1 = enrGeoms("UAP1")[0]!;
    expect(p1.shape).toBe("circle");
    expect(p1.radius_nm).toBeCloseTo(2 / 1.852, 2);
  });
  it("does not resolve UA ids outside Kazakhstan", () => {
    expect(enrIdsInText("UAR1 ACT", "VVHM")).toEqual([]);
  });
  it("resolves Czech TSA/TRA written with or without the LK prefix in LKAA", () => {
    expect(enrIdsInText("TSA21 ACT", "LKAA")).toContain("LKTSA21");
    expect(enrIdsInText("LKTRA93 ACTIVE", "LKAA")).toContain("LKTRA93");
    expect(enrGeoms("LKP1")[0]!.ring.length).toBe(6);
  });
  it("draws both parts of a composite Z area", () => {
    expect(enrGeoms("LKTRA11Z").length).toBe(2);
  });
  it("never invents areas whose boundary follows the state border", () => {
    expect(enrGeoms("LKR1")).toEqual([]);
  });
  it("lists both countries in the Database catalogue", () => {
    const rows = enrCatalogue();
    expect(rows.filter(r => r.countryCode === "KZ").length).toBeGreaterThan(240);
    expect(rows.filter(r => r.countryCode === "CZ").length).toBeGreaterThan(110);
  });
});
