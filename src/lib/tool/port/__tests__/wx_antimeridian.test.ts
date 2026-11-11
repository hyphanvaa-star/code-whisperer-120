import { describe, expect, it } from "vitest";
import { kmlFeatures, pacificLongitudes, type GeoFeature } from "../wx_overlay";
import { jmaStorm } from "../storms";

const lons = (pts: number[][]) => pts.map((p) => p[0]);

describe("storm shapes crossing the 180° date line", () => {
  it("keeps a track from −179° to +178° continuous (no line across the map)", () => {
    const kml = `<kml><Document><Placemark><name>track</name><LineString><coordinates>
      -172,15 -179,16 178.2,17 174,18</coordinates></LineString></Placemark></Document></kml>`;
    const [f] = kmlFeatures(kml);
    const xs = lons(f!.geometry.coordinates as number[][]);
    expect(xs).toEqual([188, 181, 178.2, 174]);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeLessThan(180);
  });

  it("keeps the 34 kt danger swath polygon narrow across 180°", () => {
    const poly: GeoFeature = {
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [[[-176, 14], [176, 14], [175, 20], [-177, 20], [-176, 14]]] },
    };
    const [f] = pacificLongitudes([poly]);
    const ring = (f!.geometry.coordinates as number[][][])[0]!;
    const xs = lons(ring);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(15);
    expect(xs[0]).toBe(184);
  });

  it("moves central Pacific storm points next to 180° and leaves Asia storms unchanged", () => {
    const pts: GeoFeature[] = [
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-165, 12] } },
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [125, 15] } },
    ];
    const out = pacificLongitudes(pts).map((f) => (f.geometry.coordinates as number[])[0]);
    expect(out).toEqual([195, 125]);
  });

  it("JMA track crossing 180° stays continuous", () => {
    const { features } = jmaStorm([
      { part: "title", name: { en: "PENA" } },
      { part: "track", center: [15, -179] },
      { part: "forecast", center: [16, 178] },
    ]);
    const line = features.find((f) => f.geometry.type === "LineString")!;
    expect(lons(line.geometry.coordinates as number[][])).toEqual([181, 178]);
  });
});
