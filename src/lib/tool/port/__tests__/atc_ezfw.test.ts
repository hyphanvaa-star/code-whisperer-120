import { describe, it, expect } from "vitest";
import { fileCallsign, mailCallsign, subjectOf, extractAtc, joinAtcBlocks, extractEzfw, BODY } from "../atc_ezfw";

const ATC_SAMPLE = `(FPL-VJC5513-IS
-A321/M-SDGHIRWYZ/LB1
-RCTP1000
-N0463F320 CHALI1A CHALI T5 PARPA A577 KABAM/M076F320 N892
 MESOX/N0456F320 Q15 NITOM HUNTA2B
-VVCR0236 VVDN VVTS
-PBN/A1B2C1D1L1O2S1S2 NAV/RNP2 DOF/260823 REG/VNA633
 EET/RPHI0043 ZJSA0145 VVHM0152 SEL/AMCD CODE/88813C OPR/VIETJET
 AIR
 PER/C RALT/RCTP VHHH VVDN VVCR TALT/RCNN RMK/TCAS EQUIPPED
-E/0423 P/TBN R/UVE J/L D/4 220 C YLW
 A/RED AND WHITE
 C/15095 ALEXANDER RUBIS)
`;

const EZFW_HEAD = `PLAN 6341 VJC5513 23AUG  RCTP TO VVCR 32SK    10/F IFR  23/08/26
NONSTOP COMPUTED 0155Z  FOR ETD/ETA 1000Z/1256Z   PROGS 2218UK   VNA633    KGS
FUEL PLAN
TRIP                   8207   2:36    . . . .
PLD  19000 KG          . . . . . .            DOW    48445
WEIGHT CHANGE P1000 KG  FP   79 KG  TRIP FUEL
Page - 2 of  9
NEXT PAGE JUNK
`;

describe("naming", () => {
  it("names and subject match the sample mail", () => {
    expect(fileCallsign("5513")).toBe("VJC5513");
    expect(mailCallsign("VJC5513")).toBe("VJ5513");
    expect(subjectOf("VJC5513", new Date(Date.UTC(2026, 7, 23, 10, 0)))).toBe("ATC & EZFW FOR VJ5513 ON 23AUG");
    expect(BODY).toContain("Please find the attached document.");
  });
});

describe("extractAtc", () => {
  it("keeps the ICAO block", () => {
    const got = extractAtc("HEADER\n" + ATC_SAMPLE + "\nTRAIL");
    expect(got.startsWith("(FPL-VJC5513-IS")).toBe(true);
    expect(got.trim().endsWith("RUBIS)")).toBe(true);
    expect(got).not.toContain("TRAIL");
  });
});

describe("joinAtcBlocks", () => {
  it("leaves blank lines like the org file", () => {
    const a = "(FPL-VJC1803-IS\n-VVTS1245\n C/1810 NAME)";
    const b = "(FPL-VJC858-IS\n-VVTS1525\n C/18710 NAME)";
    const got = joinAtcBlocks([a, b]);
    expect(got).toContain(a + "\n\n\n\n\n" + b + "\n");
  });
});

describe("extractEzfw", () => {
  it("cuts the PLAN block up to WEIGHT CHANGE", () => {
    const out = extractEzfw(ATC_SAMPLE + "\n" + EZFW_HEAD);
    expect(out).toContain("FUEL PLAN");
    expect(out).toContain("WEIGHT CHANGE");
    expect(out).not.toContain("NEXT PAGE JUNK");
    expect(out).not.toContain("Page - 2");
  });
});
