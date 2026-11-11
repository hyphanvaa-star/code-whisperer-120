import { describe, expect, it } from "vitest";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";
import { notamGeoms } from "../notam_track";
import { enrRing } from "../aip_enr_catalog";

// VT D41A (Chiang Mai area) is in the bundled Thai ENR 5.1 catalogue. The track filter
// receives the NOTAM without the shapes attached at Check NOTAM time, so it must still
// find the published boundary and never flag the NOTAM as UNIDENTIFIED AREA.
const ring = enrRing("VTD41A");
const [clat, clon] = ring.reduce(([a, b], [x, y]) => [a + x / ring.length, b + y / ring.length], [0, 0]);
const etd = new Date("2026-11-11T06:00:00Z");
const eta = new Date("2026-11-11T08:00:00Z");
const flight = (lonShift: number): AssessFlight => ({
  etd, eta, roles: { VTBS: "DEP", ZPPP: "ARR" },
  firs: { VTBB: [etd, eta] },
  points: [
    { lat: clat - 3, lon: clon + lonShift, fl_ft: 35000, ete_min: 20, name: "AAAAA" },
    { lat: clat, lon: clon + lonShift, fl_ft: 35000, ete_min: 40, name: "BBBBB" },
    { lat: clat + 3, lon: clon + lonShift, fl_ft: 35000, ete_min: 60, name: "CCCCC" },
  ],
  tokens: new Set(), sid: null, star: null, acType: "A321",
});
const notam = {
  start: "2026-11-11 00:00", end: "2026-11-12 00:00", lower: "0", upper: "600", qfir: "VTBB",
  e_field: "MIL FLYING TRAINING DUE TO VT D41A ACT. REF AIP THAILAND ENR 5.1",
};

describe("named ENR area resolved from the catalogue during track assessment", () => {
  it("catalogue has VT D41A", () => {
    expect(ring.length).toBeGreaterThanOrEqual(3);
  });
  it("notamGeoms finds VT D41A without sup_geoms", () => {
    expect(notamGeoms(notam).some((g) => g.name.startsWith("VTD41A") && g.shape === "polygon")).toBe(true);
  });
  it("route through VT D41A is CRITICAL and not unidentified", () => {
    const r = assessNotam(notam, "VTBB", "FIR", flight(0), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("CRITICAL");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("route 300 NM away from VT D41A is NO IMPACT, not unidentified", () => {
    const r = assessNotam(notam, "VTBB", "FIR", flight(5), DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("NO IMPACT");
    expect(r.unidentified_area).toBeFalsy();
  });
});
