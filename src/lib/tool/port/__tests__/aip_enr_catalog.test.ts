import { describe, it, expect } from "vitest";
import { enrIdsInText, enrRing } from "../aip_enr_catalog";

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
});
