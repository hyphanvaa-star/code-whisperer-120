import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse_thailand_sup_html, th_boundary_ring, th_cycles, th_sup_href } from "../aip_sup";

const nm = (a: [number, number], b: [number, number]) => {
  const mid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(mid));
};
const PSL: [number, number] = [16 + 46 / 60 + 13.2 / 3600, 100 + 17 / 60 + 28.9 / 3600];

describe("Thailand AIP SUP 37/26 ATOE AREA", () => {
  const table = parse_thailand_sup_html(readFileSync("src/lib/tool/port/__tests__/fixtures/th_sup_37_26.html", "utf8"), "37/26");

  it("yields exactly one area named ATOE AREA", () => {
    expect(Object.keys(table)).toEqual(["NR.1"]);
    expect(table["NR.1"]!.name).toBe("ATOE AREA");
  });
  it("starts at 161700N 1002200E and keeps the nine published points after the arc", () => {
    const ring = table["NR.1"]!.ring;
    expect(ring[0]).toEqual([16.283333, 100.366667]);
    expect(ring).toContainEqual([16.583333, 100.766667]);
    expect(ring).toContainEqual([15, 102]);
    expect(ring[ring.length - 1]).toEqual([15.416667, 100.366667]);
  });
  it("never uses the PSL VOR centre as a vertex", () => {
    expect(table["NR.1"]!.ring.some((q) => nm(q, PSL) < 1)).toBe(false);
  });
  it("draws the 30 NM arc around PSL VOR between the start and 163500N 1004600E", () => {
    const ring = table["NR.1"]!.ring;
    const end = ring.findIndex((q) => q[0] === 16.583333 && q[1] === 100.766667);
    const arc = ring.slice(1, end);
    expect(arc.length).toBeGreaterThan(5);
    for (const q of arc) expect(Math.abs(nm(q, PSL) - 30)).toBeLessThan(0.5);
  });
});

describe("Thailand eAIP helpers", () => {
  it("falls back to the chord when an arc end is off the stated radius", () => {
    const ring = th_boundary_ring("Start from 161700N1002200E then follow the arc 30 NM clockwise from XYZ VOR (164613.2N 1001728.9E) to 150000N 1020000E, 144300N 1012300E");
    expect(ring).toEqual([[16.283333, 100.366667], [15, 102], [14.716667, 101.383333]]);
  });
  it("finds 37/26 in the CAAT index and ignores 7/26 or 137/26", () => {
    const idx = '<a href="../../../2026-11-23/html/eSUP/VT-eSUP-26-37-A-en-GB.html">37/26</a><a href="x/VT-eSUP-26-07-A-en-GB.html">07/26</a>';
    expect(th_sup_href(idx, "37/26")).toBe("../../../2026-11-23/html/eSUP/VT-eSUP-26-37-A-en-GB.html");
    expect(th_sup_href(idx, "7/26")).toBe("x/VT-eSUP-26-07-A-en-GB.html");
    expect(th_sup_href(idx, "137/26")).toBe("");
  });
  it("lists publication folders newest first", () => {
    const home = '<a href="2026-10-29-AIRAC/html/index-en-GB.html"></a><a href="2026-12-24-AIRAC/html/index-en-GB.html"></a><a href="2026-11-26-AIRAC/html/index-en-GB.html"></a>';
    expect(th_cycles(home)).toEqual(["2026-12-24-AIRAC", "2026-11-26-AIRAC", "2026-10-29-AIRAC"]);
  });
});

import { assessNotam, DEFAULT_ASSESS_CFG } from "../notam_assess";

describe("NOTAM citing Thailand AIP SUP 37/26 once the area is drawn", () => {
  const T = (s: string) => new Date(s);
  const ring = parse_thailand_sup_html(readFileSync("src/lib/tool/port/__tests__/fixtures/th_sup_37_26.html", "utf8"), "37/26")["NR.1"]!.ring;
  const e = "MILITARY AIR EXERCISE ATOE WILL TAKE PLACE. REF AIP SUP 37/26";
  const notam = { qfir: "VTBB", start: "2026-11-23 01:00", end: "2026-11-26 10:00", lower: "0", upper: "250", scope: "W",
    text: `Q)VTBB/QRTCA/IV/BO/W/000/250\nE)${e}`, e_field: e, sup_geoms: [{ name: "ATOE AREA", shape: "polygon", ring }] };
  const flight = (lat: number, lon: number, fl: number) => ({
    etd: T("2026-11-23T01:00:00Z"), eta: T("2026-11-23T04:00:00Z"), roles: { VVTS: "DEP", VTCC: "ARR" } as any,
    firs: { VTBB: [T("2026-11-23T01:30:00Z"), T("2026-11-23T03:30:00Z")] } as any,
    points: [{ lat, lon, name: "P1", fl_ft: fl, time_utc: "2026-11-23T02:00:00Z" }, { lat: lat + 0.5, lon: lon - 0.2, name: "P2", fl_ft: fl, time_utc: "2026-11-23T02:10:00Z" }] as any,
    tokens: new Set<string>(), sid: null, star: null, acType: "A321",
  });

  it("is no longer a manual AIP SUP check or an unidentified area", () => {
    const r = assessNotam(notam, "VTBB", "FIR", flight(15.8, 101.2, 20000), DEFAULT_ASSESS_CFG);
    expect(r.match_type).not.toBe("AIP-SUP");
    expect(r.unidentified_area).toBeFalsy();
  });
  it("a flight through the area at FL200 inside the hours is CRITICAL", () => {
    expect(assessNotam(notam, "VTBB", "FIR", flight(15.8, 101.2, 20000), DEFAULT_ASSESS_CFG).level).toBe("CRITICAL");
  });
  it("a flight far from the area is NO IMPACT", () => {
    expect(assessNotam(notam, "VTBB", "FIR", flight(8.0, 98.5, 20000), DEFAULT_ASSESS_CFG).level).toBe("NO IMPACT");
  });
});
