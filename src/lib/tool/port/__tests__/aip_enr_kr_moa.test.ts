import { describe, it, expect } from "vitest";
import { enrIdsInText, enrCatalogue } from "../aip_enr_catalog";

describe("Korea MOA / CATA", () => {
  it("resolves MOA and CATA spellings inside RKRR", () => {
    expect(enrIdsInText("AIRSPACE RESERVATION WI MOA 2H ACT", "RKRR")).toEqual(["MOA2H"]);
    expect(enrIdsInText("RK MOA-1 ACT", "RKRR")).toEqual(["MOA1"]);
    expect(enrIdsInText("CIVIL ACFT TRG WI CATA 4A", "RKRR")).toEqual(["CATA4A"]);
  });
  it("never resolves them outside Korea", () => {
    expect(enrIdsInText("MOA 1 ACT", "VVHM")).toEqual([]);
    expect(enrIdsInText("CATA 2 ACT", "RJJJ")).toEqual([]);
  });
  it("lists MOA/CATA under Korea, not Macau/Cambodia", () => {
    const cat = enrCatalogue();
    expect(cat.find(a => a.id === "MOA1")?.countryCode).toBe("KR");
    expect(cat.find(a => a.id === "CATA1")?.fir).toBe("RKRR");
    expect(cat.filter(a => a.countryCode === "KR").length).toBe(214);
    expect(cat.some(a => a.countryCode === "MO" || a.countryCode === "KH")).toBe(false);
  });
});
