import { describe, expect, it } from "vitest";
import { enrCatalogue, enrIdsInText } from "../aip_enr_catalog";

describe("Japan ENR 5.2 / 5.3 named areas", () => {
  it("resolves JSDF training areas in a MIL ACT NOTAM", () => {
    expect(enrIdsInText("MIL TRG ACT WI AREA 1 SFC-5000FT", "RJJJ")).toEqual(["RJAREA1"]);
    expect(enrIdsInText("MIL ACT IN AREA H", "RJJJ")).toEqual(["RJAREAH"]);
    expect(enrIdsInText("JSDF TRG AREA A-1", "RJJJ")).toEqual(expect.arrayContaining(["RJAREAA-11", "RJAREAA-12"]));
  });
  it("resolves civil training areas", () => {
    expect(enrIdsInText("CIVIL ACFT TRG AREA HK 1-1 ACT", "RJJJ")).toEqual(["RJHK1-1"]);
    expect(enrIdsInText("TRG AREA KS3-2", "RJJJ")).toEqual(["RJKS3-2"]);
  });
  it("never resolves Japanese area names outside Japan", () => {
    expect(enrIdsInText("MIL ACT WI AREA 1", "VVHM")).toEqual([]);
  });
  it("lists the areas under Japan in the database", () => {
    const jp = enrCatalogue().filter(a => a.id.startsWith("RJAREA") || /^RJ(HK|TH|KK|CK|CS|KS|SM)\d/.test(a.id));
    expect(jp.length).toBeGreaterThan(130);
    expect(jp.every(a => a.countryCode === "JP")).toBe(true);
  });
});
