import { describe, expect, it } from "vitest";
import AU_DAH from "../../data/au_dah.json";
import { expand_au_area_ids } from "../aip_sup";

describe("Australian DAH bundle", () => {
  it("has polygons for areas named in C1232/26", () => {
    const ids = expand_au_area_ids("AIRSPACE BRIEFING GROUP MBX TO R224A AND R224B");
    expect(ids).toEqual(["R224A", "R224B"]);
    const rings = AU_DAH.rings as Record<string, number[][]>;
    for (const id of ids) expect(rings[id]!.length).toBeGreaterThanOrEqual(3);
  });
});
