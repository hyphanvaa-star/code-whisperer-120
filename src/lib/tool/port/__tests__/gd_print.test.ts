import { describe, expect, it } from "vitest";
import {
  containsFlight,
  digitsOf,
  flightsOf,
  normalizeReg,
  prettyReg,
  regsMatch,
  sameReg,
} from "../gd_print";

describe("gd_print pure helpers (port of gd_print.py)", () => {
  it("digitsOf lấy số hiệu", () => {
    expect(digitsOf("3948")).toBe("3948");
    expect(digitsOf("VJC3948")).toBe("3948");
    expect(digitsOf("VJ 3948")).toBe("3948");
    expect(digitsOf("")).toBe("");
  });

  it("flightsOf tách nhiều số hiệu, bỏ trùng", () => {
    expect(flightsOf("3948 3900")).toEqual(["3948", "3900"]);
    expect(flightsOf("3948, 3900; 3948")).toEqual(["3948", "3900"]);
    expect(flightsOf("")).toEqual([]);
  });

  it("containsFlight khớp số đứng một mình, không dính 39480", () => {
    expect(containsFlight("VJC3948 SGN-HAN", "3948")).toBe(true);
    expect(containsFlight("39480", "3948")).toBe(false);
    expect(containsFlight("abc", "3948")).toBe(false);
    expect(containsFlight("VJ3948", "")).toBe(false);
  });

  it("normalizeReg / sameReg", () => {
    expect(normalizeReg("VN-A651")).toBe("VNA651");
    expect(normalizeReg("vna 651")).toBe("VNA651");
    expect(sameReg("VN-A651", "VNA651")).toBe(true);
    expect(sameReg("VN-A651", "VN-A652")).toBe(false);
    expect(sameReg("", "VNA651")).toBe(false);
  });

  it("prettyReg thêm gạch cho VN-Axxx", () => {
    expect(prettyReg("VNA651")).toBe("VN-A651");
    expect(prettyReg("vn-a651")).toBe("VN-A651");
    expect(prettyReg("HS-ABC")).toBe("HS-ABC");
  });

  it("regsMatch so với danh sách crewlist", () => {
    expect(regsMatch("VN-A651", ["VN-A650", "VN-A651"])).toBe(true);
    expect(regsMatch("VN-A651", ["VN-A650"])).toBe(false);
    expect(regsMatch("", ["VN-A651"])).toBe(false);
  });
});
