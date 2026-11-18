import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import { extraOfpTokens, tunePlaces, tuneTrackPoints } from "../notam_check_tune";

const flight = new Flight({ id: 210, callsign: "VJC210", dep_icao: "VVNB", dest_icao: "ZBAA",
  std: new Date("2026-11-18T06:00:00Z"), sta: new Date("2026-11-18T10:00:00Z") });
const track = [
  { lat: 40.269, lon: 102.684, name: "BUVEM", airway: "W195", fir: "ZLHW", ete_min: 60, fl_ft: 35000 },
  { lat: 40.4, lon: 102.9, name: "MORIT", airway: "W195", fir: "ZLHW", ete_min: 70, fl_ft: 35000 },
];
const notam = { ident: "A6035/26", qfir: "ZLHW", scope: "E", lower: "256", upper: "361",
  start: "2026-11-18 00:00", end: "2026-11-18 12:00",
  text: "Q)ZLHW/QARLC/IV/NBO/E/256/361\nE)ATS ROUTE CLSD. 1. W195: N401609E1024104 - MORIT.",
  e_field: "ATS ROUTE CLSD. 1. W195: N401609E1024104 - MORIT." };
function filter(raw: unknown, n = notam) {
  return tunePlaces(flight, [{ code: "ZLHW", kind: "FIR", notams: [{ ...n }] }], { trackPoints: tuneTrackPoints(raw) });
}
function assessment(result: ReturnType<typeof filter>) {
  return (result.assess as Record<string, { level: string; reasons: string[] }>)["ZLHW\tA6035/26"];
}

describe("NOTAM tracking airway round-trip", () => {
  it("keeps W195 and FIR in filter input and route keywords", () => {
    const points = tuneTrackPoints(track);
    expect(points[1]).toMatchObject({ name: "MORIT", airway: "W195", fir: "ZLHW" });
    expect([...extraOfpTokens(points)]).toContain("W195");
  });
  it("recognizes W195 in A6035/26 rather than reporting an unconfirmed airway", () => {
    const result = filter(track);
    expect((result.ofp_hits as Record<string, string[]>)["ZLHW\tA6035/26"]).toEqual(["MORIT", "W195"]);
    expect(assessment(result)?.level).toBe("CRITICAL");
    expect(assessment(result)?.reasons.join(" ")).not.toContain("chưa xác nhận đường W195");
  });
  it("does not invent W195 when only MORIT is known", () => {
    const result = filter(track.map(({ airway: _airway, ...p }) => p));
    expect((result.ofp_tokens as string[])).not.toContain("W195");
    expect(assessment(result)?.level).toBe("NEED MANUAL CHECK");
  });
  it("still rejects an inactive closure despite the airway match", () => {
    expect(assessment(filter(track, { ...notam, start: "2026-11-19 00:00", end: "2026-11-19 12:00" }))?.level).toBe("NO IMPACT");
  });
  it("keeps an above-ceiling route crossing informational, not critical", () => {
    expect(assessment(filter(track.map(p => ({ ...p, fl_ft: 50000 }))))?.level).toBe("BRIEFING INFO");
  });
  it("does not match a same-name airway known only in another FIR", () => {
    const result = filter(track.map(p => ({ ...p, fir: "YMMM" })));
    expect((result.ofp_hits as Record<string, string[]>)["ZLHW\tA6035/26"] ?? []).not.toContain("W195");
  });
  it("accepts the legacy awy alias without losing leg identity", () => {
    expect(tuneTrackPoints([{ ...track[1], airway: "", awy: "w195" }])[0]?.airway).toBe("W195");
  });
});