import { describe, expect, it } from "vitest";
import { awcFirSigmets, briefingSigmetText, fbFirSigmets, sigmetFirWindows, sigmetUnread, SIGMET_MARGIN_MIN, SIGMET_NIL, SIGMET_NO_TIME, type FirSigmetRead } from "../briefing_sigmet";
import { draftFromFlight, SIG_WX_AUTO, toFields, toText } from "../briefingRelease";

const T = (s: string) => Date.parse(s);
const H = 3600_000;
// ETD 04:00Z, ETA 08:00Z; ZJSA from +0034, VHHK +0059, ZGZU +0153, ZSHA +0203.
const ofp = "(FPL-VJC5288-IS\n-VVCR0400\n-ZSHC0400 ZSNB\n-PBN/A1 EET/ZJSA0034 VHHK0059 ZGZU0153 ZSHA0203 SEL/CKDJ CODE/888173)";
const flown = { from: T("2026-11-04T04:00:00Z"), to: T("2026-11-04T08:00:00Z") };
const windows = () => sigmetFirWindows(flown, ofp, "VVHM", "ZSHA");
const sig = (text: string, from: string, to: string) => ({ text, from: T(from), to: T(to) });
const ok = (...items: ReturnType<typeof sig>[]): FirSigmetRead => ({ status: "ok", items });
const allNone = (): Record<string, FirSigmetRead> => ({ VVHM: ok(), ZJSA: ok(), VHHK: ok(), ZGZU: ok(), ZSHA: ok() });

describe("Briefing SIGMET windows", () => {
  it("uses a 1 hour safety margin", () => expect(SIGMET_MARGIN_MIN).toBe(60));
  it("derives FIR entry/exit from ETD + EET, departure FIR from ETD, last FIR to ETA", () => {
    expect(windows().map((w) => [w.fir, new Date(w.from).toISOString().slice(11, 16), new Date(w.to).toISOString().slice(11, 16)])).toEqual([
      ["VVHM", "04:00", "04:34"], ["ZJSA", "04:34", "04:59"], ["VHHK", "04:59", "05:53"], ["ZGZU", "05:53", "06:03"], ["ZSHA", "06:03", "08:00"],
    ]);
  });
  it("a delayed ETD moves every FIR window", () => {
    const late = sigmetFirWindows({ from: flown.from + 3 * H, to: flown.to + 3 * H }, ofp, "VVHM", "ZSHA");
    expect(new Date(late[2]!.from).toISOString()).toBe("2026-11-04T07:59:00.000Z");
  });
  it("without a departure time nothing is windowed", () => {
    expect(sigmetFirWindows(null, ofp, "VVHM")).toEqual([]);
    expect(briefingSigmetText([], {})).toBe(SIGMET_NO_TIME);
  });
});

describe("Briefing SIGMET selection", () => {
  const hk = "VHHK SIGMET 2 VALID 040330/040730 VHHH- VHHK HONG KONG FIR EMBD TS FCST TOP FL500 NC=";
  it("keeps a SIGMET valid while the flight is inside that FIR, grouped by FIR without a source", () => {
    const text = briefingSigmetText(windows(), { ...allNone(), VHHK: ok(sig(hk, "2026-11-04T03:30:00Z", "2026-11-04T07:30:00Z")) });
    expect(text).toBe(`VHHK\n${hk}`);
    expect(text).not.toMatch(/FliteBrief|NOAA/i);
  });
  it("drops a SIGMET that ended more than 1 hour before FIR entry", () => {
    // VHHK entry 04:59 → limit 03:59.
    expect(briefingSigmetText(windows(), { ...allNone(), VHHK: ok(sig(hk, "2026-11-03T23:00:00Z", "2026-11-04T03:58:00Z")) })).toBe(SIGMET_NIL);
  });
  it("drops a SIGMET that starts more than 1 hour after FIR exit", () => {
    // VHHK exit 05:53 → limit 06:53.
    expect(briefingSigmetText(windows(), { ...allNone(), VHHK: ok(sig(hk, "2026-11-04T06:54:00Z", "2026-11-04T10:00:00Z")) })).toBe(SIGMET_NIL);
  });
  it("keeps SIGMETs inside the 1 hour margin on both sides", () => {
    const before = briefingSigmetText(windows(), { ...allNone(), VHHK: ok(sig(hk, "2026-11-03T23:00:00Z", "2026-11-04T03:59:00Z")) });
    const after = briefingSigmetText(windows(), { ...allNone(), VHHK: ok(sig(hk, "2026-11-04T06:53:00Z", "2026-11-04T10:00:00Z")) });
    expect(before).toContain(hk);
    expect(after).toContain(hk);
  });
  it("the same SIGMET is taken once the flight is delayed into its validity", () => {
    const reads = { ...allNone(), VHHK: ok(sig(hk, "2026-11-04T08:00:00Z", "2026-11-04T12:00:00Z")) };
    expect(briefingSigmetText(windows(), reads)).toBe(SIGMET_NIL);
    const late = sigmetFirWindows({ from: flown.from + 3 * H, to: flown.to + 3 * H }, ofp, "VVHM", "ZSHA");
    expect(briefingSigmetText(late, reads)).toContain(hk);
  });
  it("NIL only when every FIR was read; an unread FIR is named, never NIL", () => {
    expect(briefingSigmetText(windows(), allNone())).toBe(SIGMET_NIL);
    const text = briefingSigmetText(windows(), { ...allNone(), ZGZU: { status: "unread" } });
    expect(text).toBe(sigmetUnread("ZGZU"));
    expect(text).not.toContain(SIGMET_NIL);
  });
  it("removes a cancelled SIGMET together with its cancellation and repeated bulletins", () => {
    const cnl = "VHHK SIGMET 3 VALID 040500/040730 VHHH- VHHK HONG KONG FIR CNL SIGMET 2 040330/040730=";
    const other = "VHHK SIGMET 4 VALID 040500/040900 VHHH- VHHK HONG KONG FIR SEV TURB FCST FL300/380 NC=";
    const read = ok(sig(hk, "2026-11-04T03:30:00Z", "2026-11-04T07:30:00Z"), sig(cnl, "2026-11-04T05:00:00Z", "2026-11-04T07:30:00Z"),
      sig(other, "2026-11-04T05:00:00Z", "2026-11-04T09:00:00Z"), sig(other, "2026-11-04T05:00:00Z", "2026-11-04T09:00:00Z"));
    expect(briefingSigmetText(windows(), { ...allNone(), VHHK: read })).toBe(`VHHK\n${other}`);
  });
});

describe("Briefing SIGMET sources", () => {
  const fb = [{ firs: [{ icao: "WAAF" }], fir_sigmet: [{ icao: "WAAF", sigmet_number: "22", start_date: "2026-11-25T23:30:00+00:00", end_date: "2026-11-26T05:30:00+00:00",
    sigmet_text: "WAAF SIGMET 22 VALID 252330/260530 WAAA- WAAF UJUNG PANDANG FIR VA\r\r\nERUPTION MT IBU PSN N0129 E12738 SFC/FL070 MOV E 10KT NC=" }] }];
  it("reads FliteBrief FIR SIGMETs with their validity and joins wrapped lines", () => {
    const read = fbFirSigmets(fb);
    expect(read).toEqual({ status: "ok", items: [{ from: T("2026-11-25T23:30:00Z"), to: T("2026-11-26T05:30:00Z"),
      text: "WAAF SIGMET 22 VALID 252330/260530 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT IBU PSN N0129 E12738 SFC/FL070 MOV E 10KT NC=" }] });
  });
  it("FliteBrief FIR with an empty list is read-and-none; a missing FIR block is unread", () => {
    expect(fbFirSigmets([{ firs: [{ icao: "VVHM" }], fir_sigmet: [] }])).toEqual({ status: "ok", items: [] });
    expect(fbFirSigmets(null).status).toBe("unread");
    expect(fbFirSigmets([{ airfields: [{ icao: "VVTS" }], firs: [] }]).status).toBe("unread");
    expect(fbFirSigmets([{ firs: [{}], fir_sigmet: [{ sigmet_text: "X", start_date: "", end_date: "" }] }]).status).toBe("unread");
  });
  it("NOAA fallback filters by FIR; an unreadable feed stays unread", () => {
    const list = [{ firId: "WSJC", rawSigmet: "WSJC SIGMET 3 VALID 040400/040800 WSSS-", validTimeFrom: T("2026-11-04T04:00:00Z") / 1000, validTimeTo: T("2026-11-04T08:00:00Z") / 1000 },
      { firId: "WIIF", rawSigmet: "WIIF SIGMET 1", validTimeFrom: 1, validTimeTo: 2 }];
    expect(awcFirSigmets("WSJC", list)).toEqual({ status: "ok", items: [{ from: T("2026-11-04T04:00:00Z"), to: T("2026-11-04T08:00:00Z"), text: "WSJC SIGMET 3 VALID 040400/040800 WSSS-" }] });
    expect(awcFirSigmets("VVHM", list)).toEqual({ status: "ok", items: [] });
    expect(awcFirSigmets("WSJC", null).status).toBe("unread");
  });
});

describe("Briefing draft fills En-route SIG Wx", () => {
  const flight = { id: 1, callsign: "VJC5288", reg: "VN-A575", dep_icao: "VVCR", dest_icao: "ZSHC", raw: { std: "2026-11-04T04:00:00Z" } };
  const base = { fetchPdf: () => new Uint8Array([1]), pdfText: () => ofp };
  const fresh = "VHHK\nVHHK SIGMET 9 VALID 040500/040900 VHHH- NEW=";
  it("auto text reaches the sheet and its text export", async () => {
    const sheet = await draftFromFlight(flight, { ...base, sigmetFor: () => fresh });
    expect(sheet.sig_wx).toBe(fresh);
    expect(toText(sheet)).toContain("VHHK SIGMET 9");
  });
  it("a hand-edited cell is kept", async () => {
    const saved = { sig_wx: "MOD TURB EXP OVER VHHK", [SIG_WX_AUTO]: "NIL" };
    expect((await draftFromFlight(flight, { ...base, sigmetFor: () => fresh, loadEdits: () => saved })).sig_wx).toBe("MOD TURB EXP OVER VHHK");
  });
  it("a saved copy of the old auto text never hides fresh SIGMETs", async () => {
    const old = "VHHK\r\nVHHK SIGMET 2 VALID 040330/040730 VHHH- OLD=";
    const saved = { notes: "MY NOTE", sig_wx: old, [SIG_WX_AUTO]: "VHHK\nVHHK SIGMET 2 VALID 040330/040730 VHHH- OLD=" };
    const sheet = await draftFromFlight(flight, { ...base, sigmetFor: () => fresh, loadEdits: () => saved });
    expect(sheet.sig_wx).toBe(fresh);
    expect(sheet.notes).toBe("MY NOTE");
    expect(toFields(sheet)[SIG_WX_AUTO]).toBeUndefined();
  });
  it("edits saved before SIGMET existed with an empty cell take fresh SIGMETs", async () => {
    expect((await draftFromFlight(flight, { ...base, sigmetFor: () => fresh, loadEdits: () => ({ notes: "N", sig_wx: "" }) })).sig_wx).toBe(fresh);
  });
  it("a failed source leaves the cell untouched", async () => {
    const sheet = await draftFromFlight(flight, { ...base, sigmetFor: () => { throw new Error("down"); }, loadEdits: () => ({ sig_wx: "MANUAL" }) });
    expect(sheet.sig_wx).toBe("MANUAL");
  });
});
