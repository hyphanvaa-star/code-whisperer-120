import { describe, expect, it } from "vitest";
import { icaoFromIata } from "../airport_icao";
import { taf_at } from "../fpl_tool";
import { toIcao } from "../briefingRelease";
import { parseTafBlock } from "../taf";

describe("icaoFromIata", () => {
  it("resolves international airports outside the curated table", () => {
    expect(icaoFromIata("CZX")).toBe("ZSCG");
    expect(icaoFromIata("czx")).toBe("ZSCG");
  });
  it("keeps the curated Vietnamese mapping", () => {
    expect(icaoFromIata("HAN")).toBe("VVNB");
    expect(icaoFromIata("PQC")).toBe("VVPQ");
  });
  it("rejects anything that is not a 3-letter code", () => {
    expect(icaoFromIata("ZSCG")).toBe("");
    expect(icaoFromIata("C1X")).toBe("");
    expect(icaoFromIata("")).toBe("");
  });
});

describe("KHB airport TAF lookup", () => {
  it("finds the ZSCG TAF when the KHB cell shows CZX", () => {
    const pack = taf_at("CZX", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 20, 3, 0)), {
      ZSCG: parseTafBlock("TAF ZSCG 191501Z 1918/2018 30004MPS 6000 NSC=")!,
    }, "ETA");
    expect(pack?.icao).toBe("ZSCG");
  });
  it("briefing alternates given as IATA resolve to ICAO", () => {
    expect(toIcao("CZX")).toBe("ZSCG");
  });
});
