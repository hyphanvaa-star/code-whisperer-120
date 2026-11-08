import { describe, it, expect } from "vitest";
import { maParse, maBand, maCheck } from "../manual_area";

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
  it("rejects fewer than three points", () => expect(maParse("2100N10530E - 2130N10530E")).toBeNull());
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
});
