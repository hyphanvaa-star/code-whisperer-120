import { describe, it, expect } from "vitest";
import { enrIdsInText, enrGeoms, enrRing } from "../aip_enr_catalog";

// AIP Singapore ENR 5.1/5.2/5.3 (effective 29 OCT 2026).
describe("Singapore ENR 5 areas", () => {
  it("draws Pasir Laba sub-areas WSD11A/WSD11B from A3369/26 and A3370/26", () => {
    expect(enrIdsInText("E)DANGER AREA WSD11A ACT", "WSJC")).toEqual(["WSD11A"]);
    expect(enrIdsInText("E)DANGER AREA WSD11B ACT", "WSJC")).toEqual(["WSD11B"]);
    expect(enrRing("WSD11A")[0]).toEqual([1.430556, 103.673333]);
    expect(enrRing("WSD11A")).toHaveLength(6);
    expect(enrRing("WSD11B")).toHaveLength(6);
  });
  it("keeps published circles for prohibited/restricted/danger areas", () => {
    expect(enrGeoms("WSP3")[0]).toMatchObject({ shape: "circle", radius_nm: 0.8 });
    expect(enrGeoms("WSR38")[0]).toMatchObject({ shape: "circle", radius_nm: 1 });
    expect(enrGeoms("WSD36")[0]).toMatchObject({ shape: "circle", radius_nm: 0.1 });
  });
  it("adds polygon areas missing before (WSD34, WSD35, WSP24)", () => {
    for (const id of ["WSD34", "WSD35", "WSP24"]) expect(enrRing(id).length).toBeGreaterThanOrEqual(3);
  });
  it("resolves Malaysian areas published in AIP Singapore inside WSJC", () => {
    expect(enrIdsInText("DANGER AREA WMD227 ACT", "WSJC")).toEqual(["WMD227"]);
  });
  it("draws ENR 5.2 training area C and the ENR 5.3 balloon 60 NM area by name", () => {
    expect(enrIdsInText("LIGHT AIRCRAFT TRAINING AREA C ACT", "WSJC")).toEqual(["WSLATAC"]);
    expect(enrGeoms("WS53BALLOON")[0]).toMatchObject({ shape: "circle", radius_nm: 60 });
  });
  it("never draws areas whose boundary follows another airspace", () => {
    expect(enrIdsInText("RESTRICTED AREA WSR6 ACT", "WSJC")).toEqual([]);
  });
});
