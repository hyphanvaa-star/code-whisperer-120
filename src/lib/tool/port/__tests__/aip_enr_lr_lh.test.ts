import { describe, it, expect } from "vitest";
import { enrIdsInText, enrGeoms } from "../aip_enr_catalog";
import { notamGeoms, iterLatLon } from "../notam_track";
import { maParse } from "../manual_area";

const mk = (fir: string, e: string) => ({ ident: "A1234/26", qfir: fir, scope: "W", start: "2026-11-24 06:00", end: "2026-11-24 14:00",
  text: `Q)${fir}/QRDCA/IV/BO/W/000/100/4630N02345E010\nE)${e}`, e_field: e });

describe("Romania ENR 5.1/5.2 areas (LRBB)", () => {
  it("LRD03A BOGATA-TURDA resolves to its published polygon", () => {
    expect(enrIdsInText("LRD03A BOGATA-TURDA ACT", "LRBB")).toEqual(["LRD03A"]);
    const g = enrGeoms("LRD03A")[0]!;
    expect(g.shape).toBe("polygon");
    expect(g.ring[0]).toEqual([46.55, 23.783333]);
  });
  it("NOTAM spelling without the leading zero finds the zero-padded AIP area", () => {
    expect(enrIdsInText("LRD3A ACT", "LRBB")).toEqual(["LRD03A"]);
  });
  it("LRTRA20G and bare TRA 20G inside LRBB resolve", () => {
    expect(enrIdsInText("LRTRA20G ACT", "LRBB")).toEqual(["LRTRA20G"]);
    expect(enrIdsInText("TRA 20G ACT", "LRBB")).toEqual(["LRTRA20G"]);
  });
  it("a parent TRA name draws every published sub-area", () => {
    expect(enrIdsInText("LRTRA2 ACT", "LRBB")).toEqual(["LRTRA2"]);
    expect(enrIdsInText("LRTRA3 ACT", "LRBB").sort()).toEqual(["LRTRA3G", "LRTRA3L"]);
  });
  it("Romanian areas never resolve inside another FIR", () => {
    expect(enrIdsInText("LRD03A ACT", "LHCC")).toEqual([]);
    expect(enrIdsInText("TRA 20G ACT", "LHCC")).toEqual([]);
  });
  it("NOTAM naming LRD10B draws a boundary", () => {
    expect(notamGeoms(mk("LRBB", "MIL FLT ACTIVITIES IN LRD10B CINCU") as never).some((g) => g.shape === "polygon")).toBe(true);
  });
});

describe("Hungary ENR 5.1/5.2/5.5 areas (LHCC)", () => {
  it("LHD2A HAJMASKER resolves", () => {
    expect(enrIdsInText("LHD2A HAJMASKER ACT", "LHCC")).toEqual(["LHD2A"]);
  });
  it("LHTRA22 stands for all sub-areas A–F; LHTRA22B only for B", () => {
    expect(enrIdsInText("LHTRA22 ACT", "LHCC").length).toBe(6);
    expect(enrIdsInText("LH TRA 22B ACT", "LHCC")).toEqual(["LHTRA22B"]);
  });
  it("glider area LHSG100 resolves", () => {
    expect(enrIdsInText("LHSG100 ACT", "LHCC")).toEqual(["LHSG100"]);
  });
  it("border-following areas stay unresolved, never guessed", () => {
    expect(enrIdsInText("LHTRA53L ACT", "LHCC")).toEqual([]);
  });
});

describe("European decimal-comma coordinates", () => {
  it("495750,21N0172420,95E reads as 49°57'50.21\"N 017°24'20.95\"E", () => {
    const p = iterLatLon("495750,21N0172420,95E")[0]!;
    expect(p[0]).toBeCloseTo(49 + 57 / 60 + 50.21 / 3600, 5);
    expect(p[1]).toBeCloseTo(17 + 24 / 60 + 20.95 / 3600, 5);
  });
  it("LKAA polygon with comma seconds draws inside Czechia", () => {
    const e = "TEMPO RESTRICTED AREA ACT WI AREA: 495750,21N0172420,95E - 495512,10N0173015,40E - 495130,00N0172210,00E - 495750,21N0172420,95E";
    const g = notamGeoms(mk("LKAA", e) as never).find((x) => x.shape === "polygon")!;
    expect(g.ring.length).toBe(3);
    for (const [lat, lon] of g.ring) { expect(lat).toBeGreaterThan(49.8); expect(lat).toBeLessThan(50); expect(lon).toBeGreaterThan(17.3); expect(lon).toBeLessThan(17.6); }
  });
  it("pasted comma-second coordinates parse in the manual area tool", () => {
    const a = maParse("495750,21N0172420,95E")!;
    expect(a.shape).toBe("point");
    expect(a.ring[0]![0]).toBeCloseTo(49.9640, 3);
  });
});
