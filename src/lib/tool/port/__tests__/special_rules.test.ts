import { describe, expect, it } from "vitest";
import { srEvaluate, srOnlyAircraftDisplay } from "../../../special-rules";

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

import { srEvaluate as _ev } from "../../../special-rules";
describe("NOT group exception", () => {
  const groups = [{ name: "TDB", items: ["REG:VNA580", "REG:VNA673"] }];
  const row = { rule: "NO_OPS_APTS", acs: ["NOT:GROUP:TDB"], apts: ["VVPC", "VVPQ"] };
  it("blocks aircraft outside the list to PQC", () => {
    expect(_ev(row as never, { reg: "VN-A522", dep: "VVTS", dest: "VVPQ" } as never, groups as never).length).toBe(1);
  });
  it("allows listed aircraft to UIH", () => {
    expect(_ev(row as never, { reg: "VN-A580", dep: "VVTS", dest: "VVPC" } as never, groups as never).length).toBe(0);
  });
});

describe("ONLY_ACS_APTS", () => {
  const row = { rule: "ONLY_ACS_APTS", acs: ["REG:VNA580"], apts: ["VVPC", "VVPQ"] };
  it("unticked aircraft to PQC is critical", () => {
    expect(_ev(row as never, { reg: "VN-A522", dep: "VVTS", dest: "VVPQ" } as never, []).length).toBe(1);
  });
  it("ticked aircraft allowed", () => {
    expect(_ev(row as never, { reg: "VN-A580", dep: "VVPC", dest: "VVTS" } as never, []).length).toBe(0);
  });
  it("unticked aircraft elsewhere ok", () => {
    expect(_ev(row as never, { reg: "VN-A522", dep: "VVTS", dest: "VVNB" } as never, []).length).toBe(0);
  });
  it.each(["VN-A580", "VN-A522"])("%s departing VVPC to another airport is unrestricted", reg => {
    expect(srEvaluate(row, {reg, dep: "VVPC", dest: "VVNB"}, [])).toEqual([]);
    expect(srOnlyAircraftDisplay(row, {reg, dep: "VVPC", dest: "VVNB"}, [])).toEqual([]);
  });
  it("unticked aircraft arriving VVPC is critical", () => {
    expect(srEvaluate(row, {reg: "VN-A522", dep: "VVNB", dest: "VVPC"}, []).map(h => [h.role, h.sev])).toEqual([["DEST", "critical"]]);
  });
});

describe("allowed aircraft LIMIT display", () => {
  const row = {rule: "ONLY_ACS_APTS", acs: ["REG:VNA580"], apts: ["VVPC", "VVPQ"]};
  it.each(["VVPC", "VVPQ"])("selected aircraft arriving at %s gets success", dest => {
    expect(srOnlyAircraftDisplay(row, {reg: "VN-A580", dep: "VVTS", dest}, [])[0]?.severity).toBe("success");
  });
  it("unselected aircraft arriving at VVPQ stays critical", () => {
    expect(srOnlyAircraftDisplay(row, {reg: "VN-A522", dep: "VVTS", dest: "VVPQ"}, [])[0]?.severity).toBe("critical");
  });
  it("selected aircraft elsewhere has no green verdict", () => {
    expect(srOnlyAircraftDisplay(row, {reg: "VN-A580", dep: "VVTS", dest: "VVNB"}, [])).toEqual([]);
  });
  it("missing aircraft identity cannot produce success", () => {
    expect(srOnlyAircraftDisplay(row, {dep: "VVTS", dest: "VVPC"}, []).some(h => h.severity === "success")).toBe(false);
  });
});
