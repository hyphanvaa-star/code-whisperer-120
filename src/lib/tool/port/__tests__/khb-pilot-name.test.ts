import { describe, expect, it } from "vitest";
import { limitKhbPilotName } from "../../../khb-pilot-name";
import { _person } from "../fpl_tool";

describe("KHB CAPT/FO name limit", () => {
  it("keeps ID and only first/last name groups above 30 characters", () => {
    expect(limitKhbPilotName("9180 AUCANCELA PADILLA DIEGO ARMANDO")).toBe("9180 AUCANCELA ARMANDO");
    expect(_person("9180", "AUCANCELA PADILLA DIEGO ARMANDO")).toBe("9180 AUCANCELA ARMANDO");
  });
  it("counts ID and spaces in the 30 character limit", () => {
    const thirty = "9180 AUCANCELA PADILLA ARMANDOOO";
    expect(Array.from(thirty).length).toBe(30);
    expect(limitKhbPilotName(thirty)).toBe(thirty);
    expect(limitKhbPilotName(thirty + "O")).toBe("9180 AUCANCELA ARMANDOOOO");
  });
  it("does not count ID as a name group or shorten names under the limit", () => {
    expect(limitKhbPilotName("9180 AUCANCELA ARMANDO")).toBe("9180 AUCANCELA ARMANDO");
    expect(limitKhbPilotName("9180 ABCDEFGHIJKLM NOPQRSTUVWXYZ")).toBe("9180 ABCDEFGHIJKLM NOPQRSTUVWXY");
  });
  it("caps unusually long first/last groups and counts Unicode characters", () => {
    expect(Array.from(limitKhbPilotName("9180 ABCDEFGHIJKLM MIDDLE NOPQRSTUVWXYZ")).length).toBe(30);
    expect(limitKhbPilotName("9180 NGUYỄN VĂN AN")).toBe("9180 NGUYỄN VĂN AN");
    expect(limitKhbPilotName("AUCANCELA PADILLA DIEGO ARMANDO EXTRA")).toBe("AUCANCELA EXTRA");
  });
});