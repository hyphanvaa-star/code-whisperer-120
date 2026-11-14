import { describe, it, expect } from "vitest";
import { enrIdsInText, enrRing, namedEnrIds, enrGeoms, enrCatalogue } from "../aip_enr_catalog";
import { notamGeoms } from "../notam_track";

describe("bundled ENR catalog", () => {
  it("lists the same drawable areas by country without losing cross-FIR ownership", () => {
    const rows = enrCatalogue();
    expect(rows).toHaveLength(3960);
    expect(new Set(rows.map(row => row.id)).size).toBe(3960);
    expect(rows.find(row => row.id === "RPR72")?.countryCode).toBe("PH");
    expect(rows.find(row => row.id === "RJW181")?.countryCode).toBe("JP");
    expect(rows.find(row => row.id === "RCDONGSHA")?.countryCode).toBe("TW");
    expect(rows.find(row => row.id === "RCDONGSHA")?.fir).toBe("VHHK");
    for (const row of rows) expect(row.geometry).toEqual(enrGeoms(row.id)[0]);
  });
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
  it("resolves RP-R72 LIPA to its own 2025 AIP ring up to 8000 FT", () => {
    expect(enrIdsInText("RP-R72 RPR72 ACT", "RPHI")).toEqual(["RPR72"]);
    expect(enrRing("RPR72")?.[0][0]).toBeCloseTo(13.8567, 3);
  });
  it.each([
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
  it("draws the published Philippine 2 NM circle even without NOTAM coordinates", () => {
    expect(enrIdsInText("RP-P1 ACTIVE", "RPHI")).toEqual(["RPP1"]);
    const geoms = enrGeoms("RPP1");
    expect(geoms).toEqual([{ name: "RPP1", shape: "circle", ring: [], lat: 14.593611111111112, lon: 120.99138888888889, radius_nm: 2, source: "aip" }]);
    expect(notamGeoms({ text: "RP-P1 ACTIVE", qfir: "RPHI", sup_geoms: geoms })).toEqual(geoms);
  });
  it("converts the published 60 metre radius without enlarging it to 60 NM", () => {
    expect(enrGeoms("RPD29")[0].radius_nm).toBeCloseTo(60 / 1852, 10);
  });
  it("resolves published Japanese names without numeric codes only in Japan", () => {
    expect(enrIdsInText("CAMP SCHWAB ACT", "RJJJ")).toEqual(["RJCAMPSCHWAB"]);
    expect(enrGeoms("RJCAMPSCHWAB")[0].ring[0]).toEqual([26 + 31/60 + 46/3600, 127 + 59/60 + 39/3600]);
    expect(enrIdsInText("CAMP SCHWAB ACT", "RPHI")).toEqual([]);
  });
  it("keeps W-173A distinct from W-173 and draws its exact published ring", () => {
    expect(enrIdsInText("WARNING AREA W-173A ACT", "RJJJ")).toEqual(["RJW173A"]);
    expect(enrRing("RJW173A").length).toBe(6);
    expect(enrRing("RJW173A")).not.toEqual(enrRing("RJW173"));
  });
  it("draws Taiwan RCR5 directly from the published ENR polygon", () => {
    expect(enrIdsInText("RC-R5 ACTIVE", "RCAA")).toEqual(["RCR5"]);
    expect(enrGeoms("RCR5")[0].ring[0]).toEqual([23.85, 118.9]);
    expect(enrIdsInText("RC-R5 ACTIVE", "RPHI")).toEqual([]);
  });
  it("keeps Dongsha and Nansha within their published Hong Kong and Manila FIRs", () => {
    expect(enrIdsInText("DONGSHA ACT", "VHHK")).toEqual(["RCDONGSHA"]);
    expect(enrIdsInText("NANSHA ACT", "RPHI")).toEqual(["RCNANSHA"]);
    expect(enrIdsInText("DONGSHA NANSHA ACT", "RCAA")).toEqual([]);
    expect(enrGeoms("RCNANSHA")[0].radius_nm).toBe(10);
  });
  it("converts the published Taiwan 5 KM circle and leaves incomplete multi-part RCR7 unresolved", () => {
    expect(enrGeoms("RCR50")[0].radius_nm).toBeCloseTo(5000/1852, 10);
    expect(enrIdsInText("RCR7 ACT", "RCAA")).toEqual([]);
  });
});
