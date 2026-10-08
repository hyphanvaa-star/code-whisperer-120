import { describe, it, expect } from "vitest";
import { fplVerPair } from "../handlers/owa.server";
describe("fplVerPair", () => {
  it("picks VER 14 as new and VER 13 as old", () => {
    expect(fplVerPair(["FLIGHT PLAN ON 08 OCT – VER 13.xlsx", "FLIGHT PLAN ON 08 OCT – VER 14.xlsx", "hy6_3.xlsx"]))
      .toEqual({ new: "FLIGHT PLAN ON 08 OCT – VER 14.xlsx", old: "FLIGHT PLAN ON 08 OCT – VER 13.xlsx" });
  });
});
