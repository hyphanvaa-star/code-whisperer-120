import { describe, expect, it } from "vitest";
import { buildSheet, parseEnrouteAlts, toHtml, toText, applyFields, draftFromFlight, toPdf, editIdentity } from "../briefingRelease";
import { applyToSheet, emptyStore, itemFrom, joinNotam, NOTAM_NIL, NOTAM_NO_OPS } from "../notam_pin";
import { PDFDocument } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";

const flight = { id: 21638165, callsign: "VJC869", reg: "VN-A575", dep_icao: "RKPK", dest_icao: "VVTS", dest_alt1: "VVCR", dest_alt2: "VVCT", raw: { std: "2026-08-31T23:10:00Z" } };
const ofp = `CFP 7843 VJC869 RKPK TO VVTS
TAKE OFF ALT RKSI
ENROUTE ALT = VVDN
Enroute
RVSM
(FPL-VJC869-IS
-RKPK2310
-VVTS0449 VVCR VVCT
-PBN/A1B2 NAV/RNP2 REG/VNA575
 RALT/RKPK RKPC RCTP RPLC VVDN VVTS TALT/RKSI RMK/TCAS EQUIPPED
-E/0637 P/TBN)`;
const tafs = Object.fromEntries(["RKPK", "VVTS", "VVCR", "VVCT", "RKPC", "RCTP", "RPLC", "VVDN"].map((icao) => [icao, { icao, nil: false, issue: "311100", raw: `TAF ${icao} 311100Z 3112/0118 21006KT 9999 SCT030=` }]));
const sheet = () => buildSheet(flight, ofp, { tafs, aircraft: [{ reg: "VN-A575", defect: "NO ADF1 DATA (INTM)" }], now: new Date("2026-08-31T13:16:00Z") });

describe("Python Briefing parity", () => {
  it("keeps RALT airports, excludes destination/TALT and empty labelled lines", () => {
    expect(parseEnrouteAlts(ofp, "VVTS")).toEqual(["RKPK", "RKPC", "RCTP", "RPLC", "VVDN"]);
    expect(parseEnrouteAlts("ENROUTE ALT =\nEnroute\nRVSM", "VVTS")).toEqual([]);
    expect(parseEnrouteAlts("RALT/RKPC\nRCTP\n REG/VNA575", "VVTS")).toEqual(["RKPC", "RCTP"]);
  });
  it("includes cached TAF and tail defects, leaves SIG Wx blank", () => {
    const text = toText(sheet());
    expect(text).toContain("TAF RKPK");
    expect(text).toContain("TAF VVCR");
    expect(text).toContain("NO ADF1 DATA (INTM)");
    expect(text).not.toContain("NO SIG");
    expect(text).not.toContain("RKSI");
  });
  it("keeps placeholder NOTAM cells centered", () => {
    const s = sheet(); s.notams = [NOTAM_NIL, NOTAM_NO_OPS, "", "", ""];
    expect(toHtml(s)).not.toContain("br-notam-full");
  });
  it("partial edits retain all other operational fields and ignore null", () => {
    const original = sheet();
    const edited = applyFields(original, { notam0: "A1234/26 NOTAMN DEP ONLY", reg: null });
    expect(edited.dep).toBe(original.dep);
    expect(edited.reg).toBe(original.reg);
    expect(edited.wx).toEqual(original.wx);
    expect(edited.notams).toEqual(["A1234/26 NOTAMN DEP ONLY", "", "", "", "", ""]);
  });
  it("pins full airport/FIR NOTAM text after saved edits, not unrelated cloud pins", async () => {
    const pins = emptyStore();
    pins.cloud = [itemFrom({ ident: "A1234/26", code: "RKPK", text: "A1234/26 NOTAMN\nQ) FULL\nE) RUNWAY CLOSED" }), itemFrom({ ident: "A9876/26", code: "EGLL", text: "UNRELATED" }), itemFrom({ ident: "B1234/26", code: "RJJJ", kind: "FIR", text: "B1234/26\nE) FIR RESTRICTION" })];
    const s = await draftFromFlight(flight, { tafs, fetchPdf: () => new Uint8Array([1]), pdfText: () => ofp, pins, pinContext: () => ({ firs: ["RJJJ"] }), loadEdits: () => ({ notam1: "CUSTOM DEST" }) });
    expect(s.notams[0]).toContain("Q) FULL");
    expect(s.notams[1]).toBe("CUSTOM DEST");
    expect(s.notams[4]).toContain("FIR RESTRICTION");
    expect(s.notams.join("\n")).not.toContain("UNRELATED");
  });
  it("replaces same-ident NOTAM and never invents NIL without a portal count", () => {
    const joined = joinNotam("A1234/26\nE) OLD\n\nB9999/26\nE) KEEP", { ident: "A1234/26", text: "A1234/26\nE) NEW" });
    expect(joined).not.toContain("OLD"); expect(joined).toContain("KEEP");
    const s = sheet(); applyToSheet(s, emptyStore()); expect(s.notams).toEqual(["", "", "", "", "", ""]);
    applyToSheet(s, emptyStore(), { counts: { "A:RKPK": 0, "A:VVTS": 2 } });
    expect(s.notams.slice(0, 2)).toEqual([NOTAM_NIL, NOTAM_NO_OPS]);
  });
  it("splits two destination alternates into separate NOTAM cells with own rules", () => {
    const s = sheet();
    applyToSheet(s, emptyStore(), { counts: { "A:VVCR": 3, "A:VVCT": 0 } });
    expect(s.notams[2]).toBe(NOTAM_NO_OPS); expect(s.notams[5]).toBe(NOTAM_NIL);
    const html = toHtml(s);
    expect(html).toContain("Dest. Alternate 1<br>(VVCR)"); expect(html).toContain("Dest. Alternate 2<br>(VVCT)");
    expect(toText(s)).toContain("Dest. Alternate 2 (VVCT)");
  });
  it("exports a one-page Letter table with Unicode font", async () => {
    const s = sheet(); s.notams[0] = "A1234/26\nE) Nội dung NOTAM đầy đủ";
    const pdf = await toPdf(s);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    const { extractText } = await import("unpdf");
    expect((await extractText(pdf.slice(), { mergePages: true })).text).toContain("Nội dung NOTAM đầy đủ");
    mkdirSync("/tmp/browser/briefing", { recursive: true });
    writeFileSync("/tmp/browser/briefing/sample.pdf", pdf);
  });
  it("continues very long NOTAMs without losing the final text", async () => {
    const s = sheet(); s.notams[0] = "A1234/26\nE) " + "OPERATIONAL RESTRICTION ".repeat(700) + "END_OF_NOTAM";
    const pdf = await toPdf(s);
    const { extractText } = await import("unpdf");
    expect((await extractText(pdf, { mergePages: true })).text).toContain("END_OF_NOTAM");
  }, 60000);
});
describe("saved briefing edit identity", () => {
  const today = { ...flight, callsign: "VJC821", raw: { std: "2026-11-04T16:00:00Z", etd: "2026-11-05T01:00:00Z" } };
  it("keys by callsign + STD UTC date + route, ignoring a delayed ETD", () => {
    expect(editIdentity(today)).toBe("VJC821.20261104.RKPK-VVTS");
  });
  it("same flight number on 26 Oct gets a different key", () => {
    expect(editIdentity({ ...today, raw: { std: "2026-10-26T16:00:00Z" } })).toBe("VJC821.20261026.RKPK-VVTS");
  });
  it("missing date never produces a key", () => {
    expect(editIdentity({ ...today, raw: {} })).toBe("");
  });
  it("draft never applies another day's saved copy", async () => {
    const store: Record<string, Record<string, unknown>> = { "VJC821.20261026.RKPK-VVTS": { notam1: "OLD 26 OCT" } };
    const seen: string[] = [];
    const s = await draftFromFlight(today, { tafs, fetchPdf: () => new Uint8Array([1]), pdfText: () => ofp, loadEdits: (k) => { seen.push(k); return store[k] ?? null; } });
    expect(seen).toEqual(["VJC821.20261104.RKPK-VVTS"]);
    expect(s.notams[1]).not.toBe("OLD 26 OCT");
  });
});
describe("LOW EGT ops notes", async () => {
  const { defectBullets, parseDefects, LOW_EGT_NOTES } = await import("../briefingRelease");
  it("adds the 4 notes under LOW EGT only and survives edit round-trip", () => {
    const b = defectBullets(["LOW EGT", "BRAKE NO #2 IS OUT OF LIMIT"]);
    expect(b).toHaveLength(6);
    expect(b[1]).toContain("highest FLEX temperature");
    expect(b[4]).toContain("Managed Speed");
    expect(parseDefects(b.join("\n"))).toEqual(["LOW EGT", "BRAKE NO #2 IS OUT OF LIMIT"]);
    expect(defectBullets(["APU INOP"])).toHaveLength(1);
    expect(LOW_EGT_NOTES).toHaveLength(4);
  });
});
