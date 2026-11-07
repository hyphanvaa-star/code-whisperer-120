import { describe, expect, it } from "vitest";
import AU_DAH from "../../data/au_dah.json";
import { au_dah_names_in_text } from "../aip_sup";

const FIR = (AU_DAH as unknown as { fir: Record<string, string> }).fir;
const RINGS = AU_DAH.rings as Record<string, number[][]>;

describe("Australian DAH sectors", () => {
  it("bundles the full DAH set including Brisbane sectors", () => {
    expect(Object.keys(RINGS).length).toBeGreaterThan(1900);
    for (const k of ["DOWNS A", "BUNYA", "NAMBOUR", "STRADDY A", "NOOSA A"]) expect(RINGS[k]!.length).toBeGreaterThanOrEqual(3);
  });
  it("finds C2490/26 sector names in YBBB only", () => {
    const e = "TIBA PROCEDURES IN DOWNS A/D, BUNYA, STRADDY, NOOSA, BURNETT AND NAMBOUR SECTORS";
    const got = au_dah_names_in_text(e, "YBBB", FIR);
    expect(got).toEqual(expect.arrayContaining(["DOWNS A", "DOWNS D", "BUNYA", "STRADDY A", "STRADDY B", "NOOSA A", "BURNETT A", "NAMBOUR"]));
    expect(au_dah_names_in_text(e, "YPPF", FIR)).toEqual([]);
  });
  it("ignores common words", () => {
    expect(au_dah_names_in_text("PORT OF ENTRY CABLE CROSS OCEAN", "YBBB", FIR)).toEqual([]);
  });
});
