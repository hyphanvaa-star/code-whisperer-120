import { describe, it, expect } from "vitest";
import { tunePlaces } from "../notam_check_tune";

const flight: any = { id: 1, callsign: "VJC978", dep_icao: "VVPQ", dest_icao: "RKSI",
  etd: new Date("2026-11-13T10:00:00Z"), std: new Date("2026-11-13T10:00:00Z"),
  eta: new Date("2026-11-13T15:00:00Z"), sta: new Date("2026-11-13T15:00:00Z") };
const track = [{ lat: 10.2, lon: 104.0, ete_min: 0 }, { lat: 16.0, lon: 108.2, ete_min: 130 }, { lat: 37.4, lon: 126.4, ete_min: 300 }];
const n = (ident: string, q: string, e: string) => ({ ident, icao: "VVDN", scope: "A", qsubj: q.slice(1, 3), qcond: q.slice(3, 5),
  start: "202610121026", end: "202611231000", e_field: e,
  text: `Q)VVHM/${q}/IV/NBO/A/0/999/1602N10812E\nA)VVDN B)202610121026 C)202611231000\nE)${e}` });

describe("en-route airports in the briefing package", () => {
  const r: any = tunePlaces(flight, [{ code: "VVDN", kind: "A", fir: "VVHM", notams: [
    n("A3842/26", "QMRLC", "RWY 17R/35L TEMPO CLSD."),
    n("A3523/26", "QMXHW", "WORK IN PROGRESS ON AREAS ALONG TWY E1."),
  ] }], { trackPoints: track });
  it("never drops a closed runway at an en-route airport as out of scope", () => {
    const a = r.assess["VVDN\tA3842/26"];
    expect(a.match_type).not.toBe("OUT-OF-SCOPE");
    expect(a.level).not.toBe("NO IMPACT");
  });
  it("drops taxiway works at an en-route airport", () => {
    expect(r.assess["VVDN\tA3523/26"].level).toBe("NO IMPACT");
  });
  it("labels the window around the time the track passes the airport", () => {
    expect(r.assess["VVDN\tA3842/26"].window).toBe("ENRT_ALT VVDN 13/11 1110Z–1310Z");
  });
});
