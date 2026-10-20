import { describe, it, expect } from "vitest";
import * as atcFix from "../atc_fix";

const NIHOA = `(FPL-VJC780-IS
-A321/M-SDGHIRWYZ/LB1
-VVCR1350
-N0446F330 NIHOA1B NIHOA DCT KARAN W2 PCA/N0456F330 W2 BIGBO Q2 BISON
 BISON3H
-VVNB0137 VVVH VVCI
-PBN/A1B2C1D1L1O2S1S2 NAV/RNP2 DOF/260827 REG/VNA651
 C/15088 NICHOLS HERBERT KENNETH)
`;

const SAPEN = `(FPL-VJC1803-IS
-A21N/M-SDGHIRWYZ/LB1
-VVTS1245
-N0458F320 SAPEN5K SAPEN R468 ELMOP P629 MUBUS M633 TANEK/M075F320
 L301 VVZ/N0450F320 W29 ANBAS VITUR8
-VOHS0353 VABB VOBL
-PBN/A1B2C1D1L1O2S1S2 NAV/RNP2 DOF/260827 REG/VNA693
 C/1810 ISAGANI CAMILING HABAL)
`;

const HAN_SGN = `(FPL-VJC163-IS
-A21N/M-SDGHIRWYZ/LB1
-VVNB1425
-N0456F320 NAH3A NAH Q1 DOVIN DOVIN5D
-VVTS0155 VVCR
-PBN/A1B2C1D1L1O2S1S2 NAV/RNP2 DOF/260827 REG/VNA534
 C/4369 BYUNGSEUNG LEE)
`;

describe("split_blocks / parse_block", () => {
  it("keeps two blocks apart", () => {
    const text = NIHOA + "\n\n\n" + SAPEN;
    const blocks = atcFix.split_blocks(text);
    expect(blocks.length).toBe(2);
    expect(blocks[0].startsWith("(FPL-VJC780-IS")).toBe(true);
    expect(blocks[1].startsWith("(FPL-VJC1803-IS")).toBe(true);
    expect(blocks[0].trim().endsWith(")")).toBe(true);
    expect(blocks[0]).not.toContain("VJC1803");
  });

  it("reads dep/arr not aircraft type", () => {
    const got = atcFix.parse_block(NIHOA)!;
    expect(got.dep).toBe("VVCR");
    expect(got.arr).toBe("VVNB");
    expect(got.callsign).toBe("VJC780");
    expect(got.tokens[0].slice(0, 2)).toBe("-N");
  });
});

describe("sid/star expansion", () => {
  it("nihoa already expanded is not duplicated", () => {
    const [fixed] = atcFix.fix_block(NIHOA);
    expect((fixed.match(/NIHOA/g) || []).length).toBe(2);
    expect((fixed.match(/DCT KARAN/g) || []).length).toBe(1);
    expect(fixed).not.toContain("DCT KARAN DCT KARAN");
    expect(fixed).toContain("W2 PCA/N0456F330");
  });

  it("sapen keeps existing fix and star gets dct", () => {
    const rules = atcFix.load_rules();
    rules.no_expand = [];
    const [fixed] = atcFix.fix_block(SAPEN, rules);
    expect(fixed).toContain("SAPEN5K SAPEN R468");
    expect(fixed).not.toContain("SAPEN5K SAPEN DCT SAPEN");
    expect(fixed).toContain("DCT VITUR VITUR8");
    expect(fixed).toContain("TANEK/M075F320");
    expect(fixed).toContain("VVZ/N0450F320");
  });

  it("no_expand pair does not touch star", () => {
    const rules = atcFix.load_rules({ no_expand: ["VVTS-VOHS"] });
    const [fixed] = atcFix.fix_block(SAPEN, rules);
    expect(fixed).not.toContain("DCT VITUR VITUR8");
    expect(fixed).toContain("VITUR8");
  });
});

describe("fl", () => {
  it("han_sgn wrong fl becomes 320", () => {
    const block = HAN_SGN.replace("F320 NAH3A", "F300 NAH3A");
    const [fixed, notes, html] = atcFix.fix_block(block);
    expect(fixed).toContain("-N0456F320");
    expect(fixed).not.toContain("-N0456F300");
    expect(notes).toContain("FL 320");
    expect(fixed).toContain("NAH3A NAH");
    expect(html).toContain('span class="chg"');
    expect(html).toContain("F320");
  });

  it("metric k line is left alone", () => {
    const block = `(FPL-VJC926-IS
-A321/M-SDGHIRWYZ/SB1
-VVCI1655
-K0848S0810 DOKLA1A DOKLA DCT NAKHA R474 TEBAK
-RKSI0418 RKSS
 C/16143 KHUONG BA PHI)
`;
    const [fixed, notes] = atcFix.fix_block(block);
    expect(fixed).toContain("-K0848S0810");
    expect(notes.some((n) => n.startsWith("FL "))).toBe(false);
  });
});

describe("wrap/join", () => {
  it("fixing a long route does not bleed into the next fpl", () => {
    const longSid = `(FPL-VJC1-IS
-A320/M-S
-VVCR1200
-N0440F330 BACHU5A ATGAS W1 AAA W1 BBB W1 CCC W1 DDD W1 EEE W1 FFF W1 GGG
-VVNB0100 VVCI
 C/1 NAME)
`;
    const text = longSid + "\n\n" + HAN_SGN;
    const [fixed, log] = atcFix.fix_text(text);
    const blocks = atcFix.split_blocks(fixed);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("BACHU DCT ATGAS");
    expect(blocks[0]).not.toContain("VJC163");
    expect(blocks[1].startsWith("(FPL-VJC163-IS")).toBe(true);
    expect(log[1].callsign).toBe("VJC163");
  });

  it("join uses three blank lines", () => {
    const got = atcFix.join_fixed(["(FPL-A)", "(FPL-B)"]);
    expect(got).toBe("(FPL-A)\n\n\n\n(FPL-B)\n");
  });
});

describe("editor", () => {
  it("defaults include special sid and no_expand", () => {
    const doc = atcFix.editor_doc(null);
    const sids = new Set(doc.special_sid.map((r: any) => r.sid));
    expect(sids.has("NIHOA1B")).toBe(true);
    expect(sids.has("BACHU5A")).toBe(true);
    const pairs = new Set(doc.no_expand.map((r: any) => r.dep + "-" + r.arr));
    expect(pairs.has("VVTS-VOHS")).toBe(true);
    const fls = new Set(doc.fl.map((r: any) => `${r.dep},${r.arr},${r.fl}`));
    expect(fls.has("VVNB,VVTS,320")).toBe(true);
    const mus = new Set(doc.mumga.map((r: any) => r.dep + r.arr));
    expect(mus.has("VVDLVVNB")).toBe(true);
  });

  it("save replace drops deleted fl and accepts iata", () => {
    const { doc, editor } = atcFix.save_editor({
      fl: [{ dep: "HAN", arr: "SGN", fl: "350" }],
      special_sid: [{ sid: "NIHOA1B", expand: "NIHOA DCT KARAN" }],
      no_expand: [{ dep: "VVTS", arr: "VOHS" }],
      mumga: [{ dep: "VVDL", arr: "VVNB" }],
    });
    expect(doc.replace).toBe(true);
    const rules = atcFix.load_rules(doc);
    expect(rules.fl).toEqual({ VVNBVVTS: 350 });
    expect(rules.fl.VVCRVVNB).toBeUndefined();
    expect(rules.special_sid).toEqual({ NIHOA1B: "NIHOA DCT KARAN" });
    expect(rules.no_expand).toEqual(["VVTS-VOHS"]);
    expect(rules.mumga).toEqual(["VVDLVVNB"]);
    expect(editor.fl.length).toBe(1);
  });
});

describe("mumga point/fl", () => {
  it("custom point and fl are applied and round-trip", () => {
    const { doc, editor } = atcFix.save_editor({ mumga: [{ dep: "VVDL", arr: "VVNB", point: "MUMGA", fl: "270" }] });
    expect(editor.mumga[0]).toMatchObject({ point: "MUMGA", fl: "270" });
    const block = `(FPL-VJC1-IS
-A320/M-S
-VVDL1200
-N0440F270 DCT MUMGA W1 BBB
-VVNB0100 VVCI
 C/1 NAME)
`;
    const [fixed] = atcFix.fix_block(block, atcFix.load_rules(doc));
    expect(fixed).toContain("MUMGA/N0440F270");
  });
});
