import { describe, it, expect } from "vitest";
import { maParse, maBand, maCheck } from "../manual_area";

const HN: [number, number] = [21 + 30 / 3600, 105 + 30 / 60 + 45 / 3600];

describe("manual area paste", () => {
  it("reads DMS/DM polygon points", () => {
    const a = maParse("275324S 1524511E - 2800S15300E - 280000S 1520000E - 275324S 1524511E")!;
    expect(a.shape).toBe("polygon");
    expect(a.ring.length).toBe(3);
    expect(a.ring[0]![0]).toBeCloseTo(-(27 + 53 / 60 + 24 / 3600), 5);
    expect(a.ring[0]![1]).toBeCloseTo(152 + 45 / 60 + 11 / 3600, 5);
  });
  it("reads centre + radius in km", () => {
    const a = maParse("RADIUS 18.52KM CENTERED 2100N10530E")!;
    expect(a.shape).toBe("circle");
    expect(a.radius_nm).toBeCloseTo(10, 3);
  });
  it("a single pasted point becomes a point", () => {
    const a = maParse("210030N 1053045E")!;
    expect(a.shape).toBe("point");
    expect(a.lat).toBeCloseTo(HN[0], 5);
    expect(a.lon).toBeCloseTo(HN[1], 5);
  });
  it("two pasted points become a line", () => {
    const a = maParse("2100N10530E - 2130N10530E")!;
    expect(a.shape).toBe("line");
    expect(a.ring).toEqual([[21, 105.5], [21.5, 105.5]]);
  });
  it("reads hemisphere-first coordinates", () => {
    const a = maParse("N210030 E1053045")!;
    expect(a.lat).toBeCloseTo(HN[0], 5);
    expect(a.lon).toBeCloseTo(HN[1], 5);
    expect(maParse("N2100 E10530 - N2130 E10600 - N2110 E10630")!.ring.length).toBe(3);
  });
  it("reads degree/minute/second symbols and spaced DMS", () => {
    for (const s of [`21°00'30"N 105°30'45"E`, "21 00 30 N 105 30 45 E", "N21 00 30 E105 30 45"]) {
      const a = maParse(s)!;
      expect(a.shape).toBe("point");
      expect(a.lat).toBeCloseTo(HN[0], 5);
      expect(a.lon).toBeCloseTo(HN[1], 5);
    }
  });
  it("reads degrees with decimal minutes", () => {
    const a = maParse("21 15.5N 105 42.3E")!;
    expect(a.lat).toBeCloseTo(21 + 15.5 / 60, 5);
    expect(a.lon).toBeCloseTo(105 + 42.3 / 60, 5);
  });
  it("reads Google Maps decimal pairs", () => {
    const a = maParse("21.0285, 105.8542")!;
    expect(a.shape).toBe("point");
    expect(a.lat).toBeCloseTo(21.0285, 6);
    expect(a.lon).toBeCloseTo(105.8542, 6);
    expect(maParse("-33.86, 151.21")!.lat).toBeCloseTo(-33.86, 6);
  });
  it("uses the Q-line centre + radius when the text has no other coordinates", () => {
    const a = maParse("Q) VVHN/QRDCA/IV/BO/W/000/240/2102N10548E010\nE) TEMPO DANGER AREA ACT")!;
    expect(a.shape).toBe("circle");
    expect(a.from).toBe("qline");
    expect(a.radius_nm).toBe(10);
    expect(a.lat).toBeCloseTo(21 + 2 / 60, 5);
  });
  it("ignores the Q-line centre when item E lists the boundary", () => {
    const a = maParse("Q) VVHN/QRDCA/IV/BO/W/000/240/2102N10548E010\nE) AREA 2100N10530E - 2130N10530E - 2130N10600E")!;
    expect(a.shape).toBe("polygon");
    expect(a.ring.length).toBe(3);
  });
  it("does not read 10NM as a latitude", () => expect(maParse("RADIUS 10NM")).toBeNull());
  it("parses altitude bands", () => {
    expect(maBand("SFC-FL240")).toEqual([0, 240]);
    expect(maBand("5000FT - FL150")).toEqual([50, 150]);
    expect(maBand("abc")).toBeNull();
  });
  it("detects a leg crossing the area between waypoints", () => {
    const area = maParse("2100N10500E - 2100N10600E - 2200N10600E - 2200N10500E")!;
    const r = maCheck(area, [{ lat: 21.5, lon: 104, fl_ft: 30000, name: "A" }, { lat: 21.5, lon: 107, fl_ft: 30000, name: "B" }], [0, 240]);
    expect(r.inside).toBe(true);
    expect(r.flHit).toBe(false);
  });
  it("reports distance when outside", () => {
    const area = maParse("RADIUS 10NM 2100N10500E")!;
    const r = maCheck(area, [{ lat: 22, lon: 105, fl_ft: 10000 }], null);
    expect(r.inside).toBe(false);
    expect(r.dist_nm!).toBeGreaterThan(45);
  });
  it("measures a point against the track legs", () => {
    // Track along latitude 21°N; point 10' north = 10 NM.
    const r = maCheck(maParse("2110N10530E")!, [{ lat: 21, lon: 105, fl_ft: 30000, name: "A" }, { lat: 21, lon: 106, fl_ft: 30000, name: "B" }], null);
    expect(r.dist_nm!).toBeCloseTo(10, 0);
    expect(r.inside).toBe(false);
    expect(r.name).toBe("A-B");
  });
  it("flags a track crossing a pasted line", () => {
    const r = maCheck(maParse("2030N10530E - 2130N10530E")!, [{ lat: 21, lon: 105, fl_ft: 30000, name: "A" }, { lat: 21, lon: 106, fl_ft: 30000, name: "B" }], [250, 350]);
    expect(r.inside).toBe(true);
    expect(r.dist_nm).toBe(0);
    expect(r.flHit).toBe(true);
  });
  it("measures polygon distance to the nearest edge, not just corners", () => {
    // Edge at 21°N spans 104–106°E; track point 30' south of its middle = 30 NM.
    const area = maParse("2100N10400E - 2100N10600E - 2200N10500E")!;
    const r = maCheck(area, [{ lat: 20.5, lon: 105 }], null);
    expect(r.dist_nm!).toBeCloseTo(30, 0);
  });
});
