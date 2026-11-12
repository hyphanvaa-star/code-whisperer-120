import { describe, expect, it } from "vitest";
import { ciTaxiCell, expectedCiTaxi, parseCiTaxi } from "../ofp_ci_taxi";

const db = {
  ci_rows: [{ id: "domestic", region: "Domestic", a320: "13", a321ceo: "17", a321neo: "22", a330: "30", airports: ["SGN", "HAN"] }],
  domestic: new Set(["SGN", "HAN"]), neo: new Set(["VN-A648"]), taxi_oct: { "SGN|A21N": "180" },
};

describe("CI / Taxi validation", () => {
  it("reads CI and TAXI from OFP text", () => {
    expect(parseCiTaxi("TRIP TIME    3.16      CI 14\nTAXI                       120   . .")).toEqual({ ci: 14, taxi: 120 });
  });
  it("passes when CI and taxi match the tables for the aircraft and departure", () => {
    const exp = expectedCiTaxi(db, { dep: "SGN", arr: "HAN", acType: "A321", reg: "VN-A648" });
    expect(ciTaxiCell(exp, { ci: 22, taxi: 180 }, "SGN").ok).toBe(true);
  });
  it("fails on a wrong CI or taxi", () => {
    const exp = expectedCiTaxi(db, { dep: "SGN", arr: "HAN", acType: "A321", reg: "VN-A648" });
    expect(ciTaxiCell(exp, { ci: 17, taxi: 180 }, "SGN").ok).toBe(false);
    expect(ciTaxiCell(exp, { ci: 22, taxi: 200 }, "SGN").ok).toBe(false);
  });
  it("uses standard taxi 200 / A333 500 when the airport is not listed", () => {
    expect(expectedCiTaxi(db, { dep: "HAN", arr: "SGN", acType: "A320", reg: "X" }).taxi).toBe(200);
    expect(expectedCiTaxi(db, { dep: "HAN", arr: "SGN", acType: "A330", reg: "X" }).taxi).toBe(500);
  });
});
