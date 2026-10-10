import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import {
  fleetVerdict,
  verdictOf,
  hitCutsArea,
  hitOnRoute,
  awySegmentAffects,
} from "../notam_verdict";
import { runDomesticFleet } from "../notam_track";
const flight = new Flight({
  id: 1,
  callsign: "VJC1",
  dep_icao: "VVTS",
  dest_icao: "VVNB",
  std: new Date("2026-10-10T06:00:00Z"),
  sta: new Date("2026-10-10T08:00:00Z"),
});
const hit = {
  ident: "A1/26",
  icao: "VVHN",
  kind: "FIR",
  qsubj: "WM",
  shape: "polygon",
  impact: "hot",
  dist_nm: 0,
};
const section = (v: ReturnType<typeof verdictOf>, key: string) =>
  v.sections.find((s) => s.key === key);
describe("Original NOTAM verdict parity", () => {
  it("does not turn distant, unresolved, dot or above-ceiling areas into affected flights", () => {
    for (const patch of [
      { dist_nm: 50 },
      { dist_nm: null },
      { dist_nm: "" },
      { shape: "dot" },
      { impact: "ref" },
      { impact: "dot" },
    ]) {
      const h = { ...hit, ...patch };
      expect(hitCutsArea(h)).toBe(false);
      const v = verdictOf([], flight, [h]);
      const fleet = fleetVerdict([
        {
          cs: flight.callsign,
          dep: flight.dep_icao,
          dest: flight.dest_icao,
          hit_count: 1,
          verdict: v,
        },
      ]);
      expect(v.status).toBe("clear");
      expect(fleet.risk).toBe(0);
      expect(section(v, "area")?.hit).toBe(false);
    }
  });
  it("area must cut route within 0.05 NM; ETA/D filters do not hide route cuts in original summary", () => {
    expect(hitCutsArea({ ...hit, dist_nm: 0.06 })).toBe(false);
    const v = verdictOf([], flight, [{ ...hit, eta_ok: false, d_ok: false }, hit]);
    expect(v.status).toBe("risk");
    expect(section(v, "area")?.groups?.[0].rows).toHaveLength(1);
    expect(hitOnRoute({ ...hit, dist_nm: 10 })).toBe(true);
    expect(hitOnRoute({ ...hit, dist_nm: 10.01 })).toBe(false);
  });
  it("original fleet merge groups ATS by flight, GPS by place, deduplicates RWY, and counts verdict risk", () => {
    const r = { label: "VVDN", value: "17R/35L", ident: "A2810/26", icao: "VVDN" };
    const g = { label: "VVHM", value: "J0003/26", ident: "J0003/26", icao: "VVHM" };
    const a = { label: "W2", value: "A3587/26", ident: "A3587/26" };
    const v = fleetVerdict([
      {
        id: 1,
        cs: "VJC439",
        dep: "VVNB",
        dest: "VVPC",
        hit_count: 99,
        verdict: {
          status: "risk",
          sections: [
            { key: "rwy", hit: true, rows: [r] },
            { key: "ats", hit: true, rows: [a] },
            { key: "gps", hit: true, rows: [g] },
          ],
        },
      },
      {
        id: 2,
        cs: "VJC145",
        dep: "VVNB",
        dest: "VVTS",
        hit_count: 99,
        verdict: {
          status: "clear",
          sections: [
            { key: "rwy", hit: true, rows: [r] },
            { key: "ats", hit: true, rows: [a] },
            { key: "gps", hit: true, rows: [g] },
          ],
        },
      },
    ]);
    expect(v.risk).toBe(1);
    expect(v.headline).toContain("có RWY đóng");
    expect(v.sections.find((s) => s.key === "rwy")?.rows).toEqual([r]);
    expect(v.sections.find((s) => s.key === "ats")?.groups?.map((g) => g.title)).toEqual([
      "VJC439 VVNB–VVPC:",
      "VJC145 VVNB–VVTS:",
    ]);
    expect(v.sections.find((s) => s.key === "gps")?.groups).toEqual([
      { title: "VVHM", rows: [{ ...g, label: "" }] },
    ]);
  });
  it("reads airport closures independently from military geometry and respects per-flight airport scope/time", () => {
    const p = {
      kind: "A",
      code: "VVNB",
      uses: [{ cs: "VJC1", role: "ARR" }],
      notams: [
        {
          ident: "AD1",
          qsubj: "FA",
          qcond: "LC",
          start: "2026-10-10T07:00:00Z",
          end: "2026-10-10T09:00:00Z",
        },
      ],
    };
    expect(section(verdictOf([p], flight, []), "ad")?.hit).toBe(true);
    expect(
      section(verdictOf([{ ...p, uses: [{ cs: "VJC2", role: "ARR" }] }], flight, []), "ad")?.hit,
    ).toBe(false);
    expect(
      section(
        verdictOf(
          [{ ...p, notams: [{ ...p.notams[0], start: "2026-10-11T07:00:00Z" }] }],
          flight,
          [],
        ),
        "ad",
      )?.hit,
    ).toBe(false);
  });
  it("checks the published airway slice, not just the shared airway name", () => {
    const n = { e_field: "W2: VIN - NAH" };
    expect(awySegmentAffects(n, [{ name: "OTHER", airway: "W2" }])).toBe(false);
    expect(awySegmentAffects(n, [{ name: "VIN", airway: "W2" }])).toBe(true);
    expect(
      awySegmentAffects(n, [{ name: "MIDDLE", airway: "W2", lat: 11, lon: 101 }], {
        ver: 1,
        cycle: "",
        effective: "",
        airports: [],
        waypoints: [],
        navaids: [],
        routes: [
          {
            name: "W2",
            fixes: ["VIN", "MIDDLE", "NAH", "OTHER"],
            pts: [
              [10, 100],
              [11, 101],
              [12, 102],
              [13, 103],
            ],
          },
        ],
      }),
    ).toBe(true);
  });
  it("domestic fleet loads OFP per flight and returns real verdict sections even with no KML", async () => {
    const texts: number[] = [];
    const result = await runDomesticFleet(
      [flight, new Flight({ id: 2, dep_icao: "VVTS", dest_icao: "RJTT" })],
      {
        fetchOfpText: async (f) => {
          texts.push(f.id);
          return "(FPL-VJC1-IS-A320/M-S/C-VVTS0600-N0450F330 W2-VVNB0200-PBN/A1)";
        },
        fetchPlaces: async () => [],
        fetchAllPlaces: async () => [],
        fetchTrack: async () => ({
          track: { plan: "", via: "", points: [], line: [] },
          error: "No KML",
        }),
      },
    );
    expect(texts).toEqual([1]);
    if (!("fleet_verdict" in result)) throw new Error("missing fleet verdict");
    expect(result.fleet_verdict.sections).toHaveLength(8);
    expect(result.fleet_verdict.risk).toBe(0);
  });
});
