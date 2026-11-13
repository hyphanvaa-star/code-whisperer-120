import { describe, it, expect } from "vitest";
import { tunePlaces } from "../notam_check_tune";

// VJC978 VVPQ–RKSI passing VVTS (en-route alternate) around 11:00Z.
const flight: any = { id: 1, callsign: "VJC978", dep_icao: "VVPQ", dest_icao: "RKSI",
  etd: new Date("2026-11-13T10:00:00Z"), std: new Date("2026-11-13T10:00:00Z"),
  eta: new Date("2026-11-13T18:30:00Z"), sta: new Date("2026-11-13T18:30:00Z") };
const track = [{ lat: 10.2, lon: 104.0, ete_min: 0 }, { lat: 10.8, lon: 106.65, ete_min: 60 }, { lat: 16.0, lon: 108.2, ete_min: 180 }, { lat: 37.4, lon: 126.4, ete_min: 510 }];
const n = (ident: string, q: string, d: string, e: string) => ({ ident, icao: "VVTS", scope: "A", qsubj: q.slice(1, 3), qcond: q.slice(3, 5),
  start: "202611101800", end: "202612092300", d_field: d, e_field: e,
  text: `Q)VVHM/${q}/IV/NBO/A/0/999/1049N10639E\nA)VVTS B)202611101800 C)202612092300\nD)${d}\nE)${e}` });

describe("item D is checked inside the airport's own window", () => {
  const run = (d: string) => (tunePlaces(flight, [{ code: "VVTS", kind: "A", fir: "VVHM", notams: [
    n("A4307/26", "QMRLC", d, "RWY 25R/07L TEMPO CLOSED"),
    n("A4309/26", "QICAS", d, "ILS-LOC, GP, DME FOR RWY 25R UNSERVICEABLE."),
  ] }], { trackPoints: track }) as any).assess;
  it("DAILY 1800-2300 never runs while the flight can use VVTS → NO IMPACT", () => {
    const a = run("DAILY 1800-2300");
    for (const id of ["A4307/26", "A4309/26"]) {
      expect(a[`VVTS\t${id}`].level).toBe("NO IMPACT");
      expect(a[`VVTS\t${id}`].reasons.join(" ")).toContain("không bật trong cửa sổ ENRT_ALT VVTS");
      expect(a[`VVTS\t${id}`].reasons.join(" ")).not.toContain("đúng giờ");
    }
  });
  it("a schedule that runs while passing VVTS is still graded", () => {
    const a = run("DAILY 1000-1300");
    expect(a["VVTS\tA4307/26"].level).not.toBe("NO IMPACT");
  });
});
