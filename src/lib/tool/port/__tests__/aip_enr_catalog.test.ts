import { describe, it, expect } from "vitest";
import { enrIdsInText, enrRing, namedEnrIds } from "../aip_enr_catalog";
import { notamGeoms } from "../notam_track";

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
  it("resolves RP-R72 LIPA to the published ENR 5.1 closed boundary", () => {
    expect(enrIdsInText("RP-R72 RPR72 ACT", "RPHI")).toEqual(["RPR72"]);
    expect(enrRing("RPR72")).toEqual([
      [13.856666666666666, 120.9875],
      [13.95611111111111, 121.05222222222221],
      [14.061388888888889, 121.12444444444444],
      [14.061388888888889, 121.23333333333333],
      [13.95611111111111, 121.23333333333333],
      [13.720555555555556, 121.23333333333333],
      [13.720555555555556, 121.12444444444444],
      [13.856666666666666, 120.9875],
    ]);
    expect(enrIdsInText("RP-R72 ACT", "RJJJ")).toEqual([]);
  });
  it.each([
    ["RPHI", "RP-R72 ACT", "RPR72"],
    ["RJJJ", "WARNING AREA W-181 (GOLF GOLF) ACT", "RJW181"],
  ])("draws named AIP polygons instead of Q-line centre-only pins in %s", (fir, text, key) => {
    const ids = enrIdsInText(text, fir);
    const geoms = notamGeoms({
      text, qfir: fir,
      sup_geoms: ids.map(name => ({ name, shape: "polygon", ring: enrRing(name), source: "aip" })),
    });
    expect(geoms).toEqual([{ name: key, shape: "polygon", ring: enrRing(key), source: "aip" }]);
  });
  it("does not create a boundary for an unknown named area", () => {
    expect(enrIdsInText("RP-R9999 W-9999", "RPHI")).toEqual([]);
    expect(enrRing("RPR9999")).toEqual([]);
  });
  it("recognizes Taiwan, Laos and Indonesian country-qualified names only in their FIRs", () => {
    expect(namedEnrIds("RC-R7 RCR7 ACT", "RCAA")).toEqual(["RCR7"]);
    expect(namedEnrIds("VL-D3 ACT", "VLVT")).toEqual(["VLD3"]);
    expect(namedEnrIds("WI-R12 WA-D4 ACT", "WAAF")).toEqual(["WIR12", "WAD4"]);
    expect(namedEnrIds("RC-R7 VL-D3 WI-R12 ACT", "RPHI")).toEqual([]);
  });
  it("never substitutes a parent boundary for an unknown suffixed area", () => {
    expect(enrIdsInText("RP-R72A ACT", "RPHI")).toEqual([]);
    expect(enrIdsInText("W-181A ACT", "RJJJ")).toEqual([]);
  });
  it("protects stored boundaries from mutations by callers", () => {
    const ring = enrRing("RJW181");
    ring[0][0] = 0;
    expect(enrRing("RJW181")[0][0]).toBe(25.6875);
  });
});
