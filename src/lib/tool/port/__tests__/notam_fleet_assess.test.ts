import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import { assessDomesticPlaces } from "../notam_fleet_assess";
import { notamCounts } from "../notam_counts";

const vip = { ident: "A4430/26", qsubj: "FA", qcond: "XX", e_field: "DEP/ARR ACFT MAY BE DLA DUE TO VIP MOV.",
  start: "2026-11-17T16:30:00Z", end: "2026-11-17T16:40:00Z" };
const rwyOff = { ident: "A4307/26", qsubj: "MR", qcond: "LC", e_field: "RWY 07L/25R CLSD DUE TO WIP.",
  start: "2026-11-18T20:00:00Z", end: "2026-11-18T22:00:00Z" };
const unused = { ident: "A9999/26", qsubj: "MR", qcond: "LC", e_field: "RWY 03/21 CLSD.",
  start: "2026-11-17T00:00:00Z", end: "2026-11-18T00:00:00Z" };
const noB = { ident: "A1111/26", qsubj: "FA", qcond: "LC", e_field: "AD CLSD.", start: "", end: "" };
const arr = new Flight({ id: 1, callsign: "VJC130", dep_icao: "VVTS", dest_icao: "VVNB",
  std: new Date("2026-11-17T14:35:00Z"), sta: new Date("2026-11-17T16:35:00Z") });
const late = new Flight({ id: 2, callsign: "VJC164", dep_icao: "VVTS", dest_icao: "VVNB",
  std: new Date("2026-11-17T20:00:00Z"), sta: new Date("2026-11-17T22:00:00Z") });
const mk = () => [
  { code: "VVNB", kind: "A", notams: [{ ...vip }, { ...noB }] },
  { code: "VVTS", kind: "A", notams: [{ ...rwyOff }] },
  { code: "VVDB", kind: "A", notams: [{ ...unused }] },
];

describe("Check NOTAM quốc nội grades every NOTAM against the fleet", () => {
  it("fills the CRUCIAL / MANUAL CHECK / MINOR counters instead of all zero", () => {
    const places = mk();
    assessDomesticPlaces(places, [arr, late].map((flight) => ({ flight, ofpText: "", points: [] })));
    const c = notamCounts({ places });
    expect(c.total).toBe(4);
    expect(c.impact).toBe(1);
    expect(c.manual).toBe(1);
    expect(c.noimpact).toBe(2);
  });
  it("VIP MOV is CRUCIAL and names the arriving flight in the reason", () => {
    const places = mk();
    assessDomesticPlaces(places, [late, arr].map((flight) => ({ flight, ofpText: "", points: [] })));
    const n = places[0].notams[0] as Record<string, unknown>;
    expect(n.level).toBe("CRITICAL");
    expect(n.vip_hold).toBe(true);
    expect(String((n.reasons as string[])[0])).toMatch(/^VJC130 VVTS–VVNB:/);
    expect(n.flights_hit).toEqual(["VJC130 VVTS–VVNB"]);
  });
  it("an airport no domestic flight uses is MINOR", () => {
    const places = mk();
    assessDomesticPlaces(places, [{ flight: arr, ofpText: "", points: [] }]);
    expect((places[2].notams[0] as Record<string, unknown>).level).toBe("NO IMPACT");
    expect((places[2].notams[0] as Record<string, unknown>).match_type).toBe("OUT-OF-SCOPE");
  });
});
