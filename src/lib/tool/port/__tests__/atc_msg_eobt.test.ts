import { describe, expect, it } from "vitest";
import * as atcChg from "../atc_chg";

const fields = {
  callsign: "VJC820", dep: "VVTS", arr: "RJTT", item13: "VVTS1020", dof: "DOF/261120",
  type: "A21N", wake: "M", equip: "SDGHIRWYZ/LB1", pbn: "-18/PBN/A1B1 REG/VNA523",
} as any;

describe("msg_eobts — giờ điện đổi giờ", () => {
  it("CHG DLA: đầu điện giữ AviWeb 1020, -13/ lấy ETD mới 1120", () => {
    const t = atcChg.msg_eobts("CHG DLA", { avi: "1020", etd: "1120", std: "1020" });
    expect(t).toEqual({ base: "1020", fresh: "1120", src: "AVI" });
    const f = { ...fields, item13: atcChg.set_eobt(fields.item13, t.base) };
    const msg = atcChg.render_msg("CHG DLA", f, { utc: t.fresh });
    expect(msg.startsWith("(CHG-VJC820-VVTS1020-RJTT-DOF/261120")).toBe(true);
    expect(msg).toContain("-13/VVTS1120");
    expect(msg).not.toContain("-13/VVTS1020");
  });

  it("DLA: dòng điện mang giờ mới 1120", () => {
    const t = atcChg.msg_eobts("DLA", { avi: "1020", etd: "1120" });
    const f = { ...fields, item13: atcChg.set_eobt(fields.item13, t.base) };
    expect(atcChg.render_msg("DLA", f, { utc: t.fresh })).toBe("(DLA-VJC820-VVTS1120-RJTT-DOF/261120)");
  });

  it("CHG TIME thiếu AviWeb: đầu điện lấy STD gốc, không lấy ETD", () => {
    expect(atcChg.msg_eobts("CHG TIME", { etd: "1120", std: "1020" })).toEqual({ base: "1020", fresh: "1120", src: "STD" });
  });

  it("CHG A/C thiếu AviWeb: vẫn định danh theo ETD hiện tại, không có giờ mới", () => {
    expect(atcChg.msg_eobts("CHG A/C", { etd: "1120", std: "1020" })).toEqual({ base: "1120", fresh: "", src: "ETD" });
  });
});
