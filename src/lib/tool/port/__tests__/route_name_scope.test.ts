import { describe, expect, it } from "vitest";
import { notamQ, routeNameRemote } from "../route_name_scope";
import { ofpNamedHits } from "../notam_check_tune";

// Flight flies A464 only in Australia (Brisbane FIR), then M771 north past Singapore's area.
const points = [
  { name: "TAMOP", lat: -27.5, lon: 152.8, airway: "", fir: "YBBB" },
  { name: "BN", lat: -24.0, lon: 150.0, airway: "A464", fir: "YBBB" },
  { name: "KEVAG", lat: -16.0, lon: 140.0, airway: "A464", fir: "YBBB" },
  { name: "DOLAX", lat: 2.0, lon: 108.0, airway: "M771", fir: "WIIF" },
];
const sin = {
  ident: "A2507/26",
  qfir: "WSJC",
  text: "Q) WSJC/QARXX/IV/NBO/E/000/999/0045S10502E\nE) REF AIP SINGAPORE ENR 3.2, ATS ROUTES M635 AND M774. AMEND A464-SJ-G579 TO READ A464 AVPIV LEGOL LAPOL G579.",
  e_field: "REF AIP SINGAPORE ENR 3.2, ATS ROUTES M635 AND M774. AMEND A464-SJ-G579 TO READ A464 AVPIV LEGOL LAPOL G579.",
};
const aus = {
  ident: "C1234/26",
  qfir: "YBBB",
  text: "Q) YBBB/QARLC/IV/NBO/E/245/600/2000S14500E150\nE) ATS RTE A464 CLSD",
  e_field: "ATS RTE A464 CLSD",
};

describe("same airway name in another FIR", () => {
  it("reads the NOTAM Q-line FIR and centre", () => {
    const q = notamQ(sin);
    expect(q.fir).toBe("WSJC");
    expect(q.lat).toBeCloseTo(-0.75, 2);
    expect(q.lon).toBeCloseTo(105.033, 2);
  });
  it("does not warn A464 for a Singapore NOTAM when our A464 is in Australia", () => {
    expect(routeNameRemote(sin, "A464", points)).toBe(true);
    expect(ofpNamedHits(sin, new Set(["A464", "M771"]), points)).not.toContain("A464");
  });
  it("still warns A464 for an Australian NOTAM on the A464 we fly", () => {
    expect(routeNameRemote(aus, "A464", points)).toBe(false);
    expect(ofpNamedHits(aus, new Set(["A464"]), points)).toContain("A464");
  });
  it("keeps the warning when the flight's position on the route is unknown", () => {
    expect(ofpNamedHits(sin, new Set(["A464"]))).toContain("A464");
    expect(routeNameRemote(sin, "A464", [{ name: "X", airway: "A464" }])).toBe(false);
  });
  it("same FIR without coordinates is never treated as a different route", () => {
    const noQ = { ...aus, text: "E) ATS RTE A464 CLSD" };
    expect(routeNameRemote(noQ, "A464", points)).toBe(false);
  });
});
