import { describe, it, expect } from "vitest";
import { fplVerPair } from "../handlers/owa.server";
describe("fplVerPair", () => {
  it("picks FPL 04 NOV VER 12 without ON above VER 11", () => {
    expect(fplVerPair(["FLIGHT PLAN ON 04 NOV - VER 11.xlsx", "FPL 04 NOV - VER 12.xlsx"]))
      .toEqual({new: "FPL 04 NOV - VER 12.xlsx", old: "FLIGHT PLAN ON 04 NOV - VER 11.xlsx"});
  });
  it("never uses another flight date as the previous revision", () => {
    expect(fplVerPair(["FLIGHT PLAN ON 03 NOV - VER 20.xlsx", "FPL 04 NOV - VER 12.xlsx"]))
      .toEqual({new: "FPL 04 NOV - VER 12.xlsx", old: ""});
  });
  it("picks VER 14 as new and VER 13 as old", () => {
    expect(fplVerPair(["FLIGHT PLAN ON 08 OCT – VER 13.xlsx", "FLIGHT PLAN ON 08 OCT – VER 14.xlsx", "hy6_3.xlsx"]))
      .toEqual({ new: "FLIGHT PLAN ON 08 OCT – VER 14.xlsx", old: "FLIGHT PLAN ON 08 OCT – VER 13.xlsx" });
  });
});
