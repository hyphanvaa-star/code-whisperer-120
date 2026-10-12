import { describe, it, expect } from "vitest";
import * as atcChg from "../atc_chg";

const FPL = `(FPL-VJC136-IS
-A321/M-SDGHIRWYZ/LB1
-VVTS0500
-N0456F330 BIXEX5U BIXEX
-VVNB0155 VVCR
-PBN/A1B2C1D1L1O2S1S2 NAV/RNP2 DOF/261003 REG/VNA542
 RMK/TCAS EQUIPPED)
`;

describe("kind", () => {
  it("reg only is CHG", () => {
    expect(atcChg.kind({ reg_changed: true, delay_changed: false })).toBe("CHG");
  });
  it("delay only is DLA", () => {
    expect(atcChg.kind({ reg_changed: false, delay_changed: true })).toBe("DLA");
  });
  it("both is CHG DLA", () => {
    expect(atcChg.kind({ reg_changed: true, delay_changed: true })).toBe("CHG DLA");
  });
  it("crew only is blank", () => {
    expect(atcChg.kind({ reg_changed: false, delay_changed: false })).toBe("");
  });
});

describe("render", () => {
  it("DLA shifts eobt and keeps dof", () => {
    const fields = atcChg.fields_from_fpl(FPL)!;
    expect(fields).toBeTruthy();
    const got = atcChg.render("DLA", fields, { delay_min: 60 });
    expect(got).toBe("(DLA-VJC136-VVTS0600-VVNB-DOF/261003)");
  });

  it("CHG uses new type and old time", () => {
    const fields = atcChg.fields_from_fpl(FPL)!;
    const got = atcChg.render("CHG", fields, { new_type: "A21N" });
    expect(got).toContain("(CHG-VJC136-VVTS0500-VVNB-DOF/261003");
    expect(got).toContain("-9/A21N/M");
    expect(got).toContain("-10/SDGHIRWYZ/LB1");
    expect(got).not.toContain("-13/");
    expect(got).toContain("-18/PBN/");
  });

  it("CHG DLA keeps original EOBT in header and new time in 13", () => {
    const fields = atcChg.fields_from_fpl(FPL)!;
    const got = atcChg.render("CHG DLA", fields, { delay_min: 60, new_type: "A21N" });
    expect(got).toContain("(CHG-VJC136-VVTS0500-VVNB-DOF/261003");
    expect(got).toContain("-13/VVTS0600");
    // OFP đã làm lại theo ETD: header lấy STD gốc, không cộng delay hai lần
    const g2 = atcChg.render("CHG DLA", { ...fields, item13: "VVTS0600" }, { delay_min: 60, orig_eobt: "0500" });
    expect(g2).toContain("(CHG-VJC136-VVTS0500-");
    expect(g2).toContain("-13/VVTS0600");
    expect(got).toContain("-9/A21N/M");
  });
});

describe("normalize_msg_kind / msg_filename", () => {
  it("aliases CHG subtypes", () => {
    expect(atcChg.normalize_msg_kind("cnl")).toBe("CNL");
    expect(atcChg.normalize_msg_kind("DLA")).toBe("DLA");
    expect(atcChg.normalize_msg_kind("CHG A/C")).toBe("CHG A/C");
    expect(atcChg.normalize_msg_kind("CHG A/C AND DLA")).toBe("CHG A/C AND DLA");
    expect(atcChg.normalize_msg_kind("CHG ALT")).toBe("CHG ALT");
    expect(atcChg.normalize_msg_kind("CHG TIME")).toBe("CHG TIME");
    expect(atcChg.normalize_msg_kind("CHG ROUTE")).toBe("CHG ROUTE");
    expect(atcChg.normalize_msg_kind("CHG RMK")).toBe("CHG RMK");
    expect(atcChg.msg_filename("CHG TIME")).toBe("CHG-TIME.txt");
  });
});

describe("render_msg", () => {
  const fields = atcChg.fields_from_fpl(FPL)!;

  it("CNL uses original ident", () => {
    expect(atcChg.render_msg("CNL", fields)).toBe("(CNL-VJC136-VVTS0500-VVNB-DOF/261003)");
  });

  it("DLA puts new eobt in header", () => {
    expect(atcChg.render_msg("DLA", fields, { utc: "0615" })).toBe(
      "(DLA-VJC136-VVTS0615-VVNB-DOF/261003)",
    );
  });

  it("CHG TIME keeps header and puts new eobt in 13", () => {
    const got = atcChg.render_msg("CHG TIME", fields, { utc: "0615" });
    expect(got).toContain("(CHG-VJC136-VVTS0500-VVNB-DOF/261003");
    expect(got).toContain("-13/VVTS0615)");
  });

  it("CHG A/C no time", () => {
    const got = atcChg.render_msg("CHG A/C", fields, { ac: "A21N", utc: "0600" });
    expect(got).toContain("-9/A21N/M");
    expect(got).toContain("-10/SDGHIRWYZ/LB1");
    expect(got).not.toContain("-13/");
  });

  it("CHG A/C AND DLA", () => {
    const got = atcChg.render_msg("CHG A/C AND DLA", fields, { ac: "A21N", utc: "0600" });
    expect(got).toContain("(CHG-VJC136-VVTS0500-VVNB-DOF/261003");
    expect(got).toContain("-9/A21N/M");
    expect(got).toContain("-10/SDGHIRWYZ/LB1");
    expect(got).toContain("-13/VVTS0600");
  });

  it("CHG ALT uses only grid dest + alts", () => {
    const got = atcChg.render_msg("CHG ALT", fields, { talt: "CXR", alt1: "SGN", alt2: "NGO" });
    expect(got).toContain("-16/VVNB0155 VVTS");
    expect(got).not.toContain("VVCR");
    expect(got).not.toContain("NGO");
    expect(got).not.toContain("DAD");
  });

  it("CHG ALT does not copy OFP alts", () => {
    const got = atcChg.render_msg("CHG ALT", fields, {});
    expect(got).toContain("-16/VVNB0155)");
    expect(got).not.toContain("VVCR");
  });

  it("CHG A/C AND DLA always has item13", () => {
    const got = atcChg.render_msg("CHG A/C AND DLA", fields, { ac: "A21N" });
    expect(got).toContain("-13/VVTS0500");
    const html = atcChg.msg_html(got, { need: ["-13/"] });
    expect(html).toContain('class="need"');
    expect(html).toContain("-13/VVTS0500");
  });

  it("CHG ROUTE copies full OFP item15", () => {
    const got = atcChg.render_msg("CHG ROUTE", fields, { route: "JUNK", fl: "100" });
    expect(got).toContain("-15/N0456F330 BIXEX5U BIXEX");
    expect(got).not.toContain("F100");
    expect(got).not.toContain("JUNK");
  });

  it("CHG RMK copies full item18", () => {
    const got = atcChg.render_msg("CHG RMK", fields, {});
    expect(got).toContain("-18/PBN/");
    expect(got).toContain("RMK/TCAS EQUIPPED");
    expect(got).not.toContain("-18/RMK/)");
  });

  it("CHG RMK keeps item18 and appends extra", () => {
    const got = atcChg.render_msg("CHG RMK", fields, { extra: "60M" });
    expect(got).toContain("PBN/");
    expect(got).toContain("RMK/TCAS EQUIPPED");
    expect(got).toContain("EXTRA 60M");
  });
});
