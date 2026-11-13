import { describe, it, expect } from "vitest";
import { enrIdsInText, enrGeoms } from "../aip_enr_catalog";

const AUP = "AIRSPACE USE PLAN (AUP) TSA/TRA ACT AS FLW: 1 TRA503(A) PUNE 0130 1130 FL325 FL460 2 TRA 508C SHIKRA 15 TRA609(B) HASHIMARA";

describe("India ENR 5.2 TRA/TSA", () => {
  it("resolves listed TRAs inside an Indian FIR", () => {
    const ids = enrIdsInText(AUP, "VECF");
    expect(ids).toContain("INTRA503A");
    expect(ids).toContain("INTRA508C");
    expect(enrGeoms("INTRA503A")[0].ring.length).toBeGreaterThanOrEqual(3);
  });
  it("leaves border-following areas unresolved", () => {
    expect(enrIdsInText(AUP, "VECF")).not.toContain("INTRA609B");
  });
  it("never resolves TRA numbers outside India", () => {
    expect(enrIdsInText(AUP, "RJJJ")).toEqual([]);
  });
  it("draws published TSA circles as circles", () => {
    expect(enrGeoms("INTSA605")[0].shape).toBe("circle");
  });
});
