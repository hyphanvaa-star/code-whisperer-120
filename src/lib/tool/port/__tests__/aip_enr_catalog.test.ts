import { describe, it, expect } from "vitest";
import { enrIdsInText, enrRing, namedEnrIds } from "../aip_enr_catalog";

describe("bundled ENR catalog", () => {
  it("resolves Singapore danger areas written as WS(D)-44", () => {
    expect(enrIdsInText("E)DANGER AREA WS(D)-44 ACT")).toEqual(["WSD44"]);
    expect(enrRing("WSD44").length).toBeGreaterThanOrEqual(3);
  });
  it("resolves Malaysian restricted areas with a space", () => {
    expect(enrIdsInText("WMR 226 ACTIVE")).toEqual(["WMR226"]);
  });
  it("ignores unknown ids", () => {
    expect(enrIdsInText("WSD999 ACT")).toEqual([]);
  });
  it("normalizes Manila RP-R72 variants to the same area", () => {
    expect(namedEnrIds("RP-R72 RPR-72 RP R72 RPR72 ACT", "RPHI")).toEqual(["RPR72"]);
  });
  it("normalizes Japan W-181 and RJW-181 without confusing longer IDs", () => {
    expect(namedEnrIds("WARNING AREA W-181 (GOLF GOLF) RJW-181", "RJJJ")).toEqual(["RJW181"]);
    expect(namedEnrIds("W-1810 ACT", "RJJJ")).toEqual(["RJW1810"]);
  });
  it("resolves W-181 to the four vertices published in Japan ENR 5.1", () => {
    expect(enrIdsInText("WARNING AREA W-181 (GOLF GOLF) ACT", "RJJJ")).toEqual(["RJW181"]);
    expect(enrRing("RJW181")).toEqual([
      [25.6875, 130.74777777777777],
      [25.4375, 131.6977777777778],
      [24.3875, 130.79777777777778],
      [24.8875, 130.06444444444446],
    ]);
    expect(enrIdsInText("WARNING AREA W-181 ACT", "RPHI")).toEqual([]);
    expect(enrIdsInText("W-1810 ACT", "RJJJ")).toEqual([]);
  });
  it("does not use Japanese or Philippine aliases in another FIR", () => {
    expect(namedEnrIds("W-181 RJW-181 RP-R72", "VVHM")).toEqual([]);
    expect(namedEnrIds("W-181 ACT")).toEqual([]);
  });
  it("does not create a boundary for an unknown named area", () => {
    expect(enrIdsInText("RP-R9999 W-9999", "RPHI")).toEqual([]);
    expect(enrRing("RPR9999")).toEqual([]);
  });
});
