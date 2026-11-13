import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jp_navaid, parse_japan_sup_text } from "../aip_sup";

const fx = (n: string) => readFileSync(`src/lib/tool/port/__tests__/fixtures/${n}`, "utf8");
const nm = (a: [number, number], b: [number, number]) => {
  const mid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(mid));
};

describe("Japan SUP numbered-point areas with arcs", () => {
  it("uses the published Kajiki VOR position (AD 2.19 RJFK, KGE)", () => {
    expect(jp_navaid("Kajiki", "VOR")).toEqual([31.797542, 130.726103]);
    expect(jp_navaid("Unknownville", "VOR")).toBeNull();
  });

  it("177/26 South of Kyushu keeps 4 separate areas instead of fake 45 NM circles", () => {
    const t = parse_japan_sup_text(fx("jp_sup_177_26.txt"), "177/26");
    expect(Object.keys(t)).toEqual(["NR.1", "NR.2", "NR.3", "NR.4"]);
    const nr1 = t["NR.1"]!.ring;
    expect(nr1[0]).toEqual([32.17, 129.706111]); // (1) 321012N/1294222E
    // (2)->(3) follows the 45 NM arc of Kajiki VOR: every arc vertex sits on it.
    const kge = jp_navaid("Kajiki", "VOR")!;
    const i2 = nr1.findIndex((p) => p[0] === 32.17 && p[1] === 129.96);
    const i3 = nr1.findIndex((p) => p[0] === 32.044722 && p[1] === 129.893611);
    expect(i3 - i2).toBeGreaterThan(1);
    for (const p of nr1.slice(i2 + 1, i3)) expect(Math.abs(nm(p, kge) - 45)).toBeLessThan(0.5);
    // Whole area stays within ~20 NM of its first point (old bug drew 45 NM circles).
    for (const p of nr1) expect(nm(p, nr1[0]!)).toBeLessThan(20);
  });

  it("005/26 Okinawa names each area and bends EAGLE-CENTER along Naha VORTAC 50 NM", () => {
    const t = parse_japan_sup_text(fx("jp_sup_005_26.txt"), "5/26");
    expect(Object.keys(t)).toHaveLength(13);
    expect(t["MOOSE-SOUTH-LO"]).toBeDefined();
    const nhc = jp_navaid("Naha", "VORTAC")!;
    const ring = t["EAGLE-CENTER"]!.ring;
    expect(ring.length).toBeGreaterThan(8);
    expect(ring.filter((p) => Math.abs(nm(p, nhc) - 50) < 0.5).length).toBeGreaterThan(3);
  });

  it("023/26 ITRA picks the area title, not the excluded ITRA-N3 mention", () => {
    const t = parse_japan_sup_text(fx("jp_sup_023_26.txt"), "23/26");
    expect(Object.keys(t)).toHaveLength(21);
    expect(t["ITRA-N2"]).toBeDefined();
    expect(t["ITRA-S33"]).toBeDefined();
  });

  it("123/26 crane footprints are obstacles, not airspace", () => {
    expect(parse_japan_sup_text(fx("jp_sup_123_26.txt"), "123/26")).toEqual({});
  });
});
