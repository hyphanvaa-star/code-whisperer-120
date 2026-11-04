import { describe, expect, it } from "vitest";
import { buildSheet, draftFromFlight, NOTES_RED, sheetFromFields, toPdf } from "../briefingRelease";
import { readPreviousBriefing, restorePreviousBriefing } from "../briefingPrevious";
import { mkdirSync, writeFileSync } from "node:fs";
const flight = { id: 12, callsign: "VJC161", dep_icao: "VVNB", dest_icao: "VVTS", dest_alt1: "VVCR", dest_alt2: "VVCT", reg: "VN-A551", raw: { std: "2026-11-04T01:00:00Z" } };
const sheet = () => buildSheet(flight, "RALT/VVDN", { tafs: { VVNB: { nil: false, issue: "181600", raw: "TAF VVNB FRESH_WX" } } });

describe("Briefing creation and aircraft replacement", () => {
  it("leaves new dispatcher notes empty instead of CAT III text", () => {
    expect(sheet().notes).toBe("");
    expect(sheetFromFields({ callsign: "VJC161" }).notes).toBe("");
  });
  it("removes the legacy automatic note on creation but preserves manually entered notes", async () => {
    const opts = { fetchPdf: () => new Uint8Array([1]), pdfText: () => "RALT/VVDN" };
    expect((await draftFromFlight(flight, { ...opts, loadEdits: () => ({ notes: NOTES_RED }) })).notes).toBe("");
    expect((await draftFromFlight(flight, { ...opts, loadEdits: () => ({ notes: "MY MANUAL NOTE" }) })).notes).toBe("MY MANUAL NOTE");
  });
  it("reads all six actual NOTAM cells and notes/permits without mixing old WX or MEL", async () => {
    const old = sheet();
    old.notams = ["A1234/26\nE) DEP CLOSED", "DEST CUSTOM", "ALT ONE", "ENROUTE CUSTOM", "FIR CUSTOM", "ALT TWO"];
    old.notes = "DISPATCHER OLD NOTE"; old.permit_addr = "TO/LDG/OVF"; old.permit_kind = "CUSTOM PERMIT";
    old.wx[0].texts = ["OLD WEATHER MUST NOT COPY"];
    const bytes = await toPdf(old);
    const previous = await readPreviousBriefing(bytes, "VJC161");
    expect(previous.notams).toEqual(old.notams);
    expect(previous.notes).toBe("DISPATCHER OLD NOTE");
    expect(previous.permit_kind).toBe("CUSTOM PERMIT");
    const fresh = sheet(); fresh.reg = "VN-A636"; fresh.defects = ["NEW MEL"];
    const swapped = restorePreviousBriefing(fresh, previous);
    expect(swapped.wx[0].texts.join(" ")).toContain("FRESH_WX");
    expect(swapped.reg).toBe("VN-A636"); expect(swapped.defects).toEqual(["NEW MEL"]);
    expect(swapped.notes).toBe(""); expect(swapped.notams).toEqual(old.notams);
    mkdirSync("/tmp/briefing", { recursive: true });
    writeFileSync("/tmp/briefing/replaced.pdf", await toPdf(swapped));
    writeFileSync("/tmp/briefing/new.pdf", await toPdf(sheet()));
  }, 60000);
  it("preserves intentionally empty NOTAM and notes rather than inventing values", async () => {
    const old = sheet();
    const previous = await readPreviousBriefing(await toPdf(old), "VJC161");
    expect(previous.notams).toEqual(["", "", "", "", "", ""]);
    expect(previous.notes).toBe("");
  }, 60000);
  it("rejects a PDF for another flight before replacement", async () => {
    await expect(readPreviousBriefing(await toPdf(sheet()), "VJC3908")).rejects.toThrow("không đúng số hiệu");
  }, 60000);
  it("leaves dispatcher notes empty during replacement even when the old briefing had notes", async () => {
    const old = sheet(); old.notes = NOTES_RED;
    const previous = await readPreviousBriefing(await toPdf(old), "VJC161");
    const swapped = restorePreviousBriefing(sheet(), previous);
    expect(swapped.notes).toBe("");
  }, 60000);
  it("reads continuation pages without losing the last NOTAM or dispatcher note", async () => {
    const old = sheet(); old.notams[0] = "A1234/26\n" + "RESTRICTION ".repeat(1500) + "END_OF_OLD_NOTAM"; old.notes = "END_OF_OLD_NOTE";
    const previous = await readPreviousBriefing(await toPdf(old), "VJC161");
    expect(previous.notams[0]).toContain("END_OF_OLD_NOTAM");
    expect(previous.notes).toBe("END_OF_OLD_NOTE");
  }, 60000);
});