import { describe, expect, it } from "vitest";
import { attentionCode, attentionLabel, attentionOf, blockMissingTafs, isTafEmpty, needsAttention, patchBriefingAttentionPage, sigmetUnreadFirs, stripTafHint, tafTemplate } from "../briefing_attention";
import { applyFields, buildSheet, toDict, toEditHtml } from "../briefingRelease";
import { sigmetUnread, SIGMET_NO_TIME } from "../briefing_sigmet";

const flight = { id: 1, callsign: "VJC821", dep_icao: "VVTS", dest_icao: "VVBM", reg: "VN-A123", std: new Date("2026-11-26T05:00:00Z") };
const TAF_TS = "TAF VVTS 260500Z 2606/2706 09008KT 9999 SCT020";

describe("briefing attention", () => {
  it("uses the agreed paste template", () => {
    expect(tafTemplate("VVBM")).toBe("TAF VVBM [Dán TAF vào đây]");
  });

  it("flags only airports without a forecast", () => {
    expect(isTafEmpty("NIL")).toBe(true);
    expect(isTafEmpty("Rx 260500Z NIL")).toBe(true);
    expect(isTafEmpty("TAF VVBM NIL")).toBe(true);
    expect(isTafEmpty(tafTemplate("VVBM"))).toBe(true);
    expect(isTafEmpty(TAF_TS)).toBe(false);
    expect(blockMissingTafs({ icaos: ["VVTS", "VVBM"], texts: [TAF_TS, "NIL"] })).toEqual(["VVBM"]);
    expect(blockMissingTafs({ icaos: ["VVTS", "VVBM"], texts: [TAF_TS] })).toEqual(["VVBM"]);
  });

  it("prints an untouched template as NIL and keeps a pasted TAF", () => {
    expect(stripTafHint(tafTemplate("VVBM"))).toBe("TAF VVBM NIL");
    expect(stripTafHint("TAF VVBM [Dán TAF vào đây] 2606/2706 VRB03KT 9999")).toBe("TAF VVBM 2606/2706 VRB03KT 9999");
    expect(stripTafHint(TAF_TS)).toBe(TAF_TS);
  });

  it("names unread FIRs and never counts a read NIL", () => {
    expect(sigmetUnreadFirs(`VVHM\nSIGMET 1 ...\n\n${sigmetUnread("WAAF")}`)).toEqual(["WAAF"]);
    expect(sigmetUnreadFirs("NIL")).toEqual([]);
    const a = attentionOf({ wx: [], sig_wx: SIGMET_NO_TIME });
    expect(a.noTime).toBe(true);
    expect(needsAttention(a)).toBe(true);
    expect(needsAttention(attentionOf({ wx: [{ icaos: ["VVTS"], texts: [TAF_TS] }], sig_wx: "NIL" }))).toBe(false);
  });

  it("edit form offers the template, marks the cell and reports the flight", () => {
    const sheet = buildSheet(flight, "", { tafs: { VVTS: { raw: TAF_TS } } });
    sheet.sig_wx = sigmetUnread("WAAF");
    const html = toEditHtml(sheet);
    expect(html).toContain("TAF VVBM [Dán TAF vào đây]");
    expect(html).toContain("Thiếu TAF: VVBM");
    expect(html).toContain("data-bf-attn='taf:VVBM|fir:WAAF'");
    expect(toDict(sheet)["attention"]).toBe("taf:VVBM|fir:WAAF");
    expect(attentionLabel("taf:VVBM|fir:WAAF")).toBe("thiếu TAF VVBM · chưa đọc được SIGMET WAAF");
  });

  it("clears the warning once the dispatcher pastes a TAF and fixes SIG Wx; untouched template stays flagged", () => {
    const sheet = buildSheet(flight, "", { tafs: { VVTS: { raw: TAF_TS } } });
    sheet.sig_wx = sigmetUnread("WAAF");
    const untouched = applyFields(sheet, { wx1: tafTemplate("VVBM") });
    expect(untouched.wx[1]?.texts).toEqual(["TAF VVBM NIL"]);
    expect(attentionCode(attentionOf(untouched))).toBe("taf:VVBM|fir:WAAF");
    const fixed = applyFields(sheet, { wx1: "TAF VVBM 260500Z 2606/2706 VRB03KT 9999", sig_wx: "NIL" });
    expect(attentionCode(attentionOf(fixed))).toBe("");
    expect(toEditHtml(fixed)).not.toContain("bf-miss");
  });

  it("page patch refuses a page without the edit anchors", () => {
    expect(() => patchBriefingAttentionPage("<html></html>")).toThrow();
  });
});
