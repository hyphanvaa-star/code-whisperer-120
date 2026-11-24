import { describe, expect, it } from "vitest";
import { ofpNamedHits } from "../notam_check_tune";
import { routeNameRemote } from "../route_name_scope";
import { isRouteFlLimitOnly } from "../route_fl_limit";
import { assessedVerdict } from "../notam_summary";

// A4525/26 VVHM: level-limit list written as bullets, no "RTE:" prefix, no Q-line centre.
const E = "DUE TO BAD WX, LARGE SCALE WX DEV (LSWD) APPLIED ON ROUTES\nL642 AND M771 WI HO CHI MINH FIR:\n- L642: FL320, FL360, FL400\n- M771: FL310, FL350, FL390.";
const A4525 = {
  ident: "A4525/26", qfir: "VVHM", scope: "E",
  text: `Q)VVHM/QARLT/IV/NBO/E/0/999\nA)VVHM B)2611240200 C)2611241000\nE)${E}\nF)SFC G)UNL`, e_field: E,
};
// VJC889 VVDN–WSSS: the L642 legs carry another FIR label than the NOTAM, but the flight is in VVHM next to them.
const points = [
  { name: "DAN", lat: 16.05, lon: 108.2, airway: "", fir: "VVHM" },
  { name: "AC", lat: 11.0, lon: 108.6, airway: "W1", fir: "VVHM" },
  { name: "MIGOS", lat: 7.0, lon: 107.0, airway: "L642", fir: "WSJC" },
  { name: "WSSS", lat: 1.36, lon: 103.99, airway: "L642", fir: "WSJC" },
];

describe("ATS route names in any layout", () => {
  it("bulleted '- L642: FL…' list is a route hit for a flight on L642", () => {
    expect(ofpNamedHits(A4525, new Set(["L642", "W1"]))).toEqual(["L642"]);
  });
  it("route listed only in prose ('ON ROUTES L642 AND M771') still hits even when another line says RTE:", () => {
    const e = "RTE: W1 FLOW CTL. ALSO APPLIED ON ROUTES L642 AND M771.";
    const n = { ident: "A1/26", qfir: "VVHM", text: `Q)VVHM/QPFCA/IV/NBO/E/0/999\nE)${e}`, e_field: e };
    expect(ofpNamedHits(n, new Set(["L642"]))).toEqual(["L642"]);
  });
  it("a flight inside the NOTAM FIR next to the route is never 'another route with the same name'", () => {
    expect(routeNameRemote(A4525, "L642", points)).toBe(false);
    expect(ofpNamedHits(A4525, new Set(["L642"]), points)).toEqual(["L642"]);
  });
  it("retired FIR code VVTS is the same FIR as VVHM", () => {
    const pts = [{ name: "X", lat: 9, lon: 108, airway: "L642", fir: "VVTS" }];
    expect(routeNameRemote(A4525, "L642", pts)).toBe(false);
  });
});

describe("route FL limit is informational", () => {
  it("ATS ROUTE LIMITED TO / FL list is a level limit only", () => {
    expect(isRouteFlLimitOnly(A4525)).toBe(true);
  });
  it("a closure is never a level limit", () => {
    const e = "ATS RTE L642 SEGMENT AAA-BBB CLSD BTN FL320 AND FL400.";
    expect(isRouteFlLimitOnly({ text: `Q)VVHM/QARLC/IV/NBO/E/320/400\nE)${e}`, e_field: e })).toBe(false);
  });
  it("FL-limit-only ATS row stays green and keeps the flight clear", () => {
    const base = { status: "risk", sections: [{ key: "ats", hit: true, rows: [
      { label: "L642 · giới hạn FL", value: "A4525/26", ident: "A4525/26", icao: "VVHM", hit: true, soft: true },
    ] }] };
    const v = assessedVerdict(base, [], () => []);
    expect(v.status).toBe("clear");
    expect(v.sections[0]!.answer).toBe("giới hạn FL");
  });
  it("a hard ATS row still makes the flight risk", () => {
    const base = { status: "risk", sections: [{ key: "ats", hit: true, rows: [
      { label: "L642", value: "A1/26", ident: "A1/26", icao: "VVHM", hit: true },
    ] }] };
    expect(assessedVerdict(base, [], () => []).status).toBe("risk");
  });
});
