import { describe, it, expect } from "vitest";
import { notamGeoms } from "../notam_track";

const E = `NO OR MNM LIGHTING TO AND WI FOLLOWING BALTIC SEA AREA:
545000N010000
0E-543000N0120000E-545500N0125000E-545500N0142200E-534000N0142200E-54
2700N0130000E-540000N0105000E-542400N0110700E-541900N0104200E-543200N
010000E
-545000N0100000E ONLY WITHIN GERMAN TERRITORY.`;

describe("line-wrapped NOTAM coordinates", () => {
  it("keeps EDWW M3011/26 Baltic area inside northern Germany", () => {
    const g = notamGeoms({ text: `Q)EDWW/QWELW/IV/BO/0/100/5418N01211E\nE)${E}`, e_field: E });
    const ring = g[0]!.ring;
    expect(ring.length).toBe(10);
    for (const [lat, lon] of ring) {
      expect(lat).toBeGreaterThan(53.5); expect(lat).toBeLessThan(55);
      expect(lon).toBeGreaterThan(9.9); expect(lon).toBeLessThan(14.5);
    }
  });
});

import { maParse } from "../manual_area";
describe("manual paste of line-wrapped coordinates", () => {
  it("keeps the pasted EDWW Baltic area in northern Germany", () => {
    const ring = maParse(E)!.ring;
    expect(ring.length).toBe(10);
    for (const [lat, lon] of ring) { expect(lat).toBeGreaterThan(53.5); expect(lon).toBeGreaterThan(9.9); expect(lon).toBeLessThan(14.5); }
  });
});
