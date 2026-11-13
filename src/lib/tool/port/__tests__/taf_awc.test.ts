import { describe, it, expect } from "vitest";
import { parseTafBlock, advise, type TafRec } from "../taf";
import { mergeAwc, parseAwcTafXml, parseAwcMetarCsv, AWC_SOURCE } from "../taf_awc";

const NOW = new Date(Date.UTC(2026, 10, 13, 3, 0));
const xml = (raw: string, issue = "2026-11-13T00:00:00.000Z") =>
  `<TAF><raw_text><![CDATA[${raw}]]></raw_text><station_id>X</station_id><issue_time>${issue}</issue_time></TAF>`;
const nilRec = (icao: string): TafRec => parseTafBlock(`TAF ${icao} : NIL`)!;
const tsn = (raw: string): TafRec => parseTafBlock(raw)!;

describe("NOAA AWC TAF fill", () => {
  const awc = parseAwcTafXml(
    xml("TAF ZBAD 122108Z 1300/1406 20003MPS 0500 FG BKN001") +
      xml("TAF VVTS 130000Z 1300/1406 18005KT 9999 SCT020") +
      xml("TAF NZAA 130000Z 1300/1406 25010KT 9999 FEW030") +
      xml("TAF KJFK 130000Z 1300/1406 25010KT P6SM FEW030") +
      xml("TAF ZGGG 100000Z 1000/1106 25010KT 9999 FEW030"),
    NOW,
  );

  it("keeps an active TSN TAF instead of the NOAA one", () => {
    const tafs = { VVTS: tsn("TAF VVTS 122300Z 1300/1406 24008KT 9999 SCT017=") };
    mergeAwc(tafs, awc);
    expect(tafs.VVTS.source).toBeUndefined();
    expect(tafs.VVTS.issue).toBe("122300");
  });

  it("replaces a TSN NIL with the NOAA TAF in any region", () => {
    const tafs = { NZAA: nilRec("NZAA") };
    const st = mergeAwc(tafs, awc);
    expect(tafs.NZAA.nil).toBe(false);
    expect(tafs.NZAA.source).toBe(AWC_SOURCE);
    expect(st.filled).toEqual(["NZAA"]);
  });

  it("adds airports TSN does not list only in the airline's regions", () => {
    const tafs: Record<string, TafRec> = {};
    const st = mergeAwc(tafs, awc);
    expect(Object.keys(tafs)).toContain("ZBAD");
    expect(Object.keys(tafs)).not.toContain("KJFK");
    expect(st.added).toContain("ZBAD");
  });

  it("drops expired NOAA TAFs", () => {
    expect(awc.ZGGG).toBeUndefined();
  });
});

describe("METAR for airports without TAF", () => {
  const csv = [
    "raw_text,station_id,observation_time",
    '"METAR VVCM 130200Z 09005KT 9999 FEW020 30/24 Q1010",VVCM,2026-11-13T02:00:00.000Z,9',
    '"METAR RJBE 122000Z VRB02KT 9999 FEW030 20/12 Q1022",RJBE,2026-11-12T20:00:00.000Z,1',
  ].join("\n");
  const metars = parseAwcMetarCsv(csv, NOW);

  it("attaches the latest METAR to an airport still NIL", () => {
    const tafs = { VVCM: nilRec("VVCM") };
    mergeAwc(tafs, {}, metars);
    expect(tafs.VVCM.metar?.raw).toBe("METAR VVCM 130200Z 09005KT 9999 FEW020 30/24 Q1010");
    const adv = advise("VVCM", NOW, tafs);
    expect(adv.status).toBe("nil");
    expect(adv.segments.map((s) => s.text).join("")).toContain("METAR VVCM 130200Z");
  });

  it("ignores METARs older than 6 hours", () => {
    expect(metars.RJBE).toBeUndefined();
  });
});
