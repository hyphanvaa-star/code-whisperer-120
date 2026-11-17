import { describe, expect, it } from "vitest";
import { notamGeoms, VOLCANO_BUFFER_NM } from "../notam_track";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const mk = (id: string, q: string, E: string) => ({
  ident: id, qfir: "RPHI", scope: "W", start: "2026-11-10 00:00", end: "2027-01-10 00:00", lower: "0", upper: "110",
  text: `Q)RPHI/${q}/IV/NBO/AE/000/110/1315N12341E005\nA)RPHI B)2611100000 C)2701100000\nE)${E}\nF)SFC G)FL110`, e_field: E,
});
const MAYON = mk("A1234/26", "QWWLW", "MAYON VOLCANO (1315N 12341E) ALERT LEVEL 3. FLT OPS ARE ADZ TO AVOID FLY CLOSE TO THE VOLCANO.");

describe("volcano NOTAM areas", () => {
  it("a single summit point becomes a 10 NM buffer circle", () => {
    const g = notamGeoms(MAYON);
    expect(g).toHaveLength(1);
    expect(g[0]!.shape).toBe("circle");
    expect(g[0]!.radius_nm).toBe(10);
    expect(VOLCANO_BUFFER_NM).toBe(10);
    expect(g[0]!.lat).toBeCloseTo(13.25, 2);
    expect(g[0]!.lon).toBeCloseTo(123.683, 2);
    expect(g[0]!.name).toContain("MAYON");
  });
  it("several separate volcano points each get their own 10 NM circle", () => {
    const n = mk("A1235/26", "QWWLW", "MAYON VOLCANO (1315N 12341E) ALERT LEVEL 3. BULUSAN VOLCANO (1246N 12403E) ALERT LEVEL 1. TAAL VOLCANO (1401N 12059E) ALERT LEVEL 1.");
    const g = notamGeoms(n);
    expect(g.map((x) => x.shape)).toEqual(["circle", "circle", "circle"]);
    expect(g.every((x) => x.radius_nm === 10)).toBe(true);
  });
  it("chained ash cloud coordinates are drawn as the full polygon", () => {
    const n = mk("A1236/26", "QWWLW", "VOLCANIC ASH CLOUD OBS WI 1300N 12300E - 1330N 12400E - 1230N 12430E - 1300N 12300E SFC/FL250");
    const g = notamGeoms(n);
    expect(g).toHaveLength(1);
    expect(g[0]!.shape).toBe("polygon");
    expect(g[0]!.ring.length).toBeGreaterThanOrEqual(3);
  });
  it("an explicit radius in the NOTAM wins over the 10 NM default", () => {
    const n = mk("A1237/26", "QWWLW", "KANLAON VOLCANO ERUPTION. AVOID AREA WI 6NM RADIUS OF 1024N 12307E.");
    const g = notamGeoms(n);
    expect(g[0]!.shape).toBe("circle");
    expect(g[0]!.radius_nm).toBe(6);
  });
  it("a track 5 NM from the summit below FL110 is not dropped and is not unidentified", () => {
    const f: AssessFlight = {
      etd: new Date("2026-11-17T02:00:00Z"), eta: new Date("2026-11-17T05:00:00Z"),
      roles: { RPLL: "DEP", RPVM: "ARR" }, firs: { RPHI: [new Date("2026-11-17T02:00:00Z"), new Date("2026-11-17T05:00:00Z")] },
      points: [
        { lat: 13.0, lon: 123.5, fl_ft: 9000, ete_min: 30, name: "AAA" },
        { lat: 13.25, lon: 123.77, fl_ft: 9000, ete_min: 40, name: "BBB" },
        { lat: 13.5, lon: 124.0, fl_ft: 9000, ete_min: 50, name: "CCC" },
      ],
      tokens: new Set<string>(), sid: null, star: null, acType: "A321",
    };
    const r = assessNotam(MAYON, "RPHI", "FIR", f, DEFAULT_ASSESS_CFG);
    expect(r.level).not.toBe("NO IMPACT");
    expect(r.unidentified_area).toBeFalsy();
  });
});
