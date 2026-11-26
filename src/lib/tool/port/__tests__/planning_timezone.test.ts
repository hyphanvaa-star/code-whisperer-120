import { describe, expect, it } from "vitest";
import { Db, etd_utc_when, eta_utc_hhmm, public_flights, render_fpl } from "../fpl_tool";

describe("Planning airport timezone lookup", () => {
  const flight = { row: 1, flt: "5029", date: "26/11/26", dep: "TXN", arr: "HAN", etd: "17:45", eta: "19:00" };
  it("empty legacy TXN offset keeps UTC+08 and yields 0945 in Planning and REQ", () => {
    const db = new Db({ tz: [["TXN", ""], ["ZSTX", "  "]], flights: [flight] });
    expect(public_flights(db, [], null)[0]?.['utc']).toBe("0945");
    expect(render_fpl(db, flight, { extra: 0, seq: 1 })).toContain("ETD÷0945");
    expect(etd_utc_when(db, flight)?.toISOString()).toBe("2026-11-26T09:45:00.000Z");
  });
  it("resolves TXN/ZSTX and TSN/ZBTJ to the same airport offsets", () => {
    const db = new Db({});
    for (const code of ["TXN", "ZSTX", "TSN", "ZBTJ"]) expect(db.timezone(code)).toBe("08:00");
    expect(eta_utc_hhmm(db, { ...flight, arr: "ZBTJ", eta: "20:00" })).toBe("1200");
  });
  it("keeps valid nonempty configured offsets for both airport codes", () => {
    const db = new Db({ tz: [[" txn ", " 08:30 "]] });
    expect(db.timezone("TXN")).toBe("08:30");
    expect(db.timezone("ZSTX")).toBe("08:30");
  });
  it("unknown airports remain missing rather than being treated as UTC", () => {
    const db = new Db({ tz: [["TXN", null]] });
    expect(public_flights(new Db({ flights: [{ ...flight, dep: "ZZZZ" }] }), [], null)[0]?.['utc']).toBe("");
    expect(db.timezone("TXN")).toBe("08:00");
  });
});