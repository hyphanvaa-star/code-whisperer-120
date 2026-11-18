import { describe, expect, it } from "vitest";
import { pcVersionBelow } from "../port/pc_version";

describe("Trợ lý PC phải từ bản 6.9 mới nhận tài khoản AviWeb từ web", () => {
  it("bản 6.6 và 6.8 là cũ", () => {
    expect(pcVersionBelow("6.6", "6.9")).toBe(true);
    expect(pcVersionBelow("6.8", "6.9")).toBe(true);
  });
  it("bản 6.9 và 6.10 đủ mới", () => {
    expect(pcVersionBelow("6.9", "6.9")).toBe(false);
    expect(pcVersionBelow("6.10", "6.9")).toBe(false);
  });
  it("không rõ bản thì coi là cũ", () => {
    expect(pcVersionBelow("", "6.9")).toBe(true);
  });
});
