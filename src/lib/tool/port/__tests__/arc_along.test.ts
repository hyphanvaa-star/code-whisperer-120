import { describe, it, expect } from "vitest";
import { parseAreas } from "../notam_track";
const E = `
AIR DEFENCE FIRING ACT INPR WI AREA:
POINT A 191436.00N 0845342.00E
POINT B 190723.43N 0853556.19E
THEN ALONG CLOCKWISE ARC OF CIRCLE OF RADIUS 40.50NM CENTERED AT
191436.00N 0845342.00E TO
POINT C 183336.66N 0845344.68E AND
POINT A 191436.00N 0845342.00E
AND
ARMY FLY INPR WI COORD:
POINT A 191740.33N 0845512.40E
POINT B 191044.80N 0844722.85E
POINT C 185601.96N 0845238.50E
POINT D 191219.81N 0851455.09E AND
POINT A 191740.33N 0845512.40E
DRG THE ACT FLW RTE/RTE SEGMENTS ARE NOT AVBL
`;
describe("A2003/26 clockwise arc sector + second polygon", () => {
  it("draws a sector (not a circle) and a separate 4-point army area", () => {
    const g = parseAreas(E);
    expect(g.length).toBe(2);
    expect(g.every((x) => x.shape === "polygon")).toBe(true);
    expect(g[0]!.ring[0]![0]).toBeCloseTo(19.2433, 3); // starts at centre A
    expect(g[0]!.ring.length).toBeGreaterThan(10); // arc B→C sampled
    expect(g[1]!.ring.length).toBe(4);
  });
});
