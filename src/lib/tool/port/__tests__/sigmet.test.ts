import { describe, it, expect } from "vitest";
import { sigmetItems, sgVolcanoPsn } from "../sigmet";

const NOW = 1795090000;
const sq = (lat: number, lon: number) => [
  { lat, lon }, { lat: lat + 1, lon }, { lat: lat + 1, lon: lon + 1 }, { lat, lon },
];
const base = {
  firId: "WAAF", firName: "WAAF UJUNG PANDANG", seriesId: "14", hazard: "VA",
  qualifier: "ERUPTION MT DUKONO", base: 0, top: 7000, geom: "AREA",
  validTimeFrom: NOW - 3600, validTimeTo: NOW + 3600, dir: "NW", spd: "5", chng: "NC",
  rawSigmet: "WAAF SIGMET 14 VALID WAAF UJUNG PANDANG FIR VA ERUPTION MT DUKONO PSN N0142 E12754 VA CLD OBS AT 0910Z SFC/FL070 FCST 1510Z VA CLD",
  coords: sq(1.5, 127.5),
};

describe("sigmet items", () => {
  it("converts feet to flight levels and keeps the volcano position", () => {
    const [it0] = sigmetItems([base], NOW);
    expect(it0!.base_fl).toBe(0);
    expect(it0!.top_fl).toBe(70);
    expect(it0!.volcano).toEqual({ name: "DUKONO", lat: 1.7, lon: 127.9 });
  });
  it("drops SIGMETs that have already expired", () => {
    expect(sigmetItems([{ ...base, validTimeTo: NOW - 1 }], NOW)).toHaveLength(0);
  });
  it("drops SIGMETs outside the dispatch network region", () => {
    expect(sigmetItems([{ ...base, coords: sq(14.4, -90.9) }], NOW)).toHaveLength(0);
  });
  it("marks the repeated polygon of the same bulletin as the forecast position", () => {
    const out = sigmetItems([base, { ...base, coords: sq(2, 127) }], NOW);
    expect(out.map((x) => x.kind)).toEqual(["obs", "fcst"]);
  });
  it("keeps every ring of a multi-area SIGMET", () => {
    const out = sigmetItems([{ ...base, hazard: "TS", coords: [sq(10, 110), sq(12, 112)] }], NOW);
    expect(out[0]!.rings).toHaveLength(2);
    expect(out[0]!.volcano).toBeNull();
  });
  it("reads southern/western volcano positions", () => {
    expect(sgVolcanoPsn("PSN S0806 E11255")).toEqual({ lat: -8.1, lon: 112.9167 });
  });
});
