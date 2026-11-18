import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import { namedRouteLive } from "../notam_track";
import { verdictOf } from "../notam_verdict";

// A4397/26: W8 (PQU - TUNPO) closed only on the 17th and 19th, 0000-0400Z, GND-FL080; no coordinates.
const notam = {
  ident: "A4397/26", subject: "ATS ROUTE", condition: "CLOSED", qsubj: "AR", qcond: "LC",
  start: "202611170000", end: "202611190400", d_field: "17 19 0000-0400",
  f_field: "GND", g_field: "FL080",
  e_field: "DUE TO FIRING ACT DO NOT USE ATS RTE SEGMENT W8 (PQU - TUNPO).",
  text: "DUE TO FIRING ACT DO NOT USE ATS RTE SEGMENT W8 (PQU - TUNPO).",
};
const mk = (std: string) => new Flight({
  id: 718, callsign: "VJC718", dep_icao: "VVPQ", dest_icao: "VVDN",
  std: new Date(std), sta: new Date(new Date(std).getTime() + 3600_000),
});
const pts = [
  { lat: 10.2, lon: 103.9, name: "VVPQ", ete_min: 0, fl_ft: 0 },
  { lat: 10.5, lon: 104.5, name: "TUNPO", ete_min: 9, fl_ft: 9800 },
  { lat: 16.0, lon: 108.2, name: "VVDN", ete_min: 60, fl_ft: 0 },
];

describe("named ATS route NOTAM crossing time", () => {
  it("drops a flight crossing TUNPO at 0609Z on the 18th (outside D 17/19 0000-0400, ±1h)", () => {
    expect(namedRouteLive(notam, mk("2026-11-18T06:00:00Z"), pts, ["TUNPO", "W8"])).toBe(false);
  });
  it("drops a 17th flight crossing at 0509Z — more than 1h after 0400Z", () => {
    expect(namedRouteLive(notam, mk("2026-11-17T05:00:00Z"), pts, ["TUNPO", "W8"])).toBe(false);
  });
  it("keeps a 17th flight crossing at 0209Z inside the window", () => {
    expect(namedRouteLive(notam, mk("2026-11-17T02:00:00Z"), pts, ["TUNPO", "W8"])).toBe(true);
  });
  it("drops an in-window crossing above FL080 + 10000 ft buffer", () => {
    const high = pts.map((p) => (p.name === "TUNPO" ? { ...p, fl_ft: 19000 } : p));
    expect(namedRouteLive(notam, mk("2026-11-17T02:00:00Z"), high, ["TUNPO", "W8"])).toBe(false);
  });
  it("verdict ATS route section obeys the gate for text-only route NOTAMs", () => {
    const f = mk("2026-11-18T06:00:00Z");
    const places = [{ code: "VVHM", kind: "FIR", notams: [notam] }];
    const ofp = "VVPQ TUNPO W8 PQU VVDN";
    const ats = (gate: boolean) => verdictOf(places, f, [], ofp, pts, null, 10000, () => gate)
      .sections.find((s) => s.key === "ats")?.rows ?? [];
    expect(ats(true).length).toBeGreaterThan(0);
    expect(ats(false)).toHaveLength(0);
  });
});
