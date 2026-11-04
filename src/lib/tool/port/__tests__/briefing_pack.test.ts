import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bpParsePack, bpCompare, bpWebIds, bpNewIds, bpDueRescan } from "../briefing_pack";

const text = readFileSync(join(__dirname, "fixtures/quick_pack_vj5288.txt"), "utf8");

describe("briefing pack", () => {
  it("parses VJ5288 pack: 167 NOTAMs over 18 places", () => {
    const p = bpParsePack(text);
    expect(Object.keys(p).length).toBe(18);
    expect(Object.values(p).reduce((n, v) => n + v.length, 0)).toBe(167);
    expect(p.RCTP.length).toBe(56);
  });
  it("compares only places both sides have", () => {
    const pack = { VVCR: ["A3953/26"], RCTP: ["A0001/26"] };
    const web = bpWebIds([{ code: "VVCR", notams: [{ ident: "A3953/26" }] }]);
    expect(bpCompare(pack, web)).toEqual({ common: ["VVCR"], packCount: 1, missing: [] });
    const r = bpCompare({ VVCR: ["A3953/26", "A9999/26"] }, web);
    expect(r.missing).toEqual([{ loc: "VVCR", id: "A9999/26" }]);
  });
  it("55 -> 57 reports 2 new; expired ones are ignored", () => {
    const base = Array.from({ length: 55 }, (_, i) => `A${1000 + i}/26`);
    expect(bpNewIds(base, [...base, "A2000/26", "A2001/26"]).length).toBe(2);
    expect(bpNewIds(base, base.slice(3))).toEqual([]);
  });
  it("rescan due only in the hour before departure", () => {
    const dep = 10 * 3600_000;
    expect(bpDueRescan(dep, dep - 61 * 60_000, false)).toBe(false);
    expect(bpDueRescan(dep, dep - 59 * 60_000, false)).toBe(true);
    expect(bpDueRescan(dep, dep - 59 * 60_000, true)).toBe(false);
    expect(bpDueRescan(dep, dep + 1, false)).toBe(false);
  });
});
