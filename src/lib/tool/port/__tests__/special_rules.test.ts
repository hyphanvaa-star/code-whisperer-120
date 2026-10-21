import { describe, expect, it } from "vitest";
import { srEvaluate } from "../../../special-rules";

const row = { rule: "DOMESTIC_ONLY", acs: ["REG:VNA202", "REG:VNA640"], apts: [] };

describe("giới hạn đặc biệt chọn sẵn", () => {
  it("VNA202 chỉ bay nội địa: bay quốc tế bị báo đỏ", () => {
    const h = srEvaluate(row, { reg: "VN-A202", ac: "A321", dep: "VVTS", dest: "RKSI" }, []);
    expect(h.map((x) => [x.role, x.sev])).toEqual([["DEST", "critical"]]);
  });
  it("VNA640 bay nội địa thì không báo", () => {
    expect(srEvaluate(row, { reg: "VNA640", ac: "A321", dep: "SGN", dest: "HAN" }, [])).toEqual([]);
  });
  it("tàu khác không bị áp dụng", () => {
    expect(srEvaluate(row, { reg: "VNA698", ac: "A321", dep: "VVTS", dest: "RKSI" }, [])).toEqual([]);
  });
  it("nhóm tàu do admin tạo được áp dụng", () => {
    const g = [{ name: "Nội địa", items: ["REG:VNA811", "TYPE:A333"] }];
    const r = { rule: "DOMESTIC_ONLY", acs: ["GROUP:Nội địa"], apts: [] };
    expect(srEvaluate(r, { reg: "VNA999", ac: "A333", dep: "VVNB", dest: "VHHH" }, g)).toHaveLength(1);
    expect(srEvaluate(r, { reg: "VNA811", ac: "A321", dep: "VVNB", dest: "WSSS" }, g)).toHaveLength(1);
  });
  it("cấm dùng sân Việt Nam làm dự bị đến", () => {
    const r = { rule: "NO_DEST_ALT", acs: ["ALL"], apts: ["VVCR"] };
    expect(srEvaluate(r, { reg: "VNA1", ac: "A320", dep: "VVTS", dest: "VVNB", alt1: "CXR" }, [])[0]?.role).toBe("ALT1");
  });
});
