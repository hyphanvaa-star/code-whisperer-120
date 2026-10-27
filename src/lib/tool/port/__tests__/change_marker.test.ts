import { describe, it, expect } from "vitest";
import { changeTone, mergeChangeSource } from "../change_marker";

describe("changeTone", () => {
  it("chỉ FPL VER đổi → tím", () => {
    expect(changeTone("fpl", false)).toBe("fpl");
  });
  it("chỉ Crewlist đổi → cam", () => {
    expect(changeTone("crew", false)).toBe("crew");
  });
  it("cả FPL lẫn Crewlist đổi → đỏ", () => {
    expect(changeTone("both", false)).toBe("both");
  });
  it("đã khớp FliteBrief → xanh lá dù nguồn nào", () => {
    expect(changeTone("fpl", true)).toBe("ok");
    expect(changeTone("crew", true)).toBe("ok");
    expect(changeTone("both", true)).toBe("ok");
  });
  it("không có thay đổi → không tô màu", () => {
    expect(changeTone(null, false)).toBeNull();
    expect(changeTone(null, true)).toBeNull();
  });
});

describe("mergeChangeSource", () => {
  it("crew + fpl = both", () => {
    expect(mergeChangeSource("crew", "fpl")).toBe("both");
    expect(mergeChangeSource("fpl", "crew")).toBe("both");
  });
  it("cùng nguồn giữ nguyên", () => {
    expect(mergeChangeSource("crew", "crew")).toBe("crew");
  });
  it("một phía trống lấy phía còn lại", () => {
    expect(mergeChangeSource(null, "fpl")).toBe("fpl");
    expect(mergeChangeSource("both", null)).toBe("both");
  });
});
