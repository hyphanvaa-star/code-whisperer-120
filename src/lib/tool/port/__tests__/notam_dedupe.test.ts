import { describe, expect, it } from "vitest";
import { dedupeAirportFirNotams } from "../notam_check";

const restricted = { ident: "L3729/26", qsubj: "RT", scope: "W", e_field: "AIRSPACE CLOSED WI AREA 5501N08255E", text: "x" };
const runway = { ident: "L4000/26", qsubj: "MR", scope: "A", e_field: "RWY 07/25 CLSD", text: "y" };

describe("dedupeAirportFirNotams", () => {
  const places = [
    { code: "UNNT", kind: "A", notams: [restricted, runway], notam_count: 2 },
    { code: "UNNT", kind: "FIR", notams: [restricted, runway], notam_count: 2 },
  ];
  const out = dedupeAirportFirNotams(places);

  it("keeps a restricted-area NOTAM only under the FIR", () => {
    expect(out[0]!.notams.map((n) => n.ident)).not.toContain("L3729/26");
    expect(out[1]!.notams.map((n) => n.ident)).toContain("L3729/26");
  });

  it("keeps a runway NOTAM only under the airport", () => {
    expect(out[0]!.notams.map((n) => n.ident)).toContain("L4000/26");
    expect(out[1]!.notams.map((n) => n.ident)).not.toContain("L4000/26");
  });

  it("updates the counts so each NOTAM is counted once", () => {
    expect(out[0]!.notam_count + out[1]!.notam_count).toBe(2);
  });

  it("leaves same ident with different text untouched", () => {
    const other = { ...restricted, e_field: "DIFFERENT AREA" };
    const r = dedupeAirportFirNotams([
      { code: "UNNT", kind: "A", notams: [restricted], notam_count: 1 },
      { code: "UHHH", kind: "FIR", notams: [other], notam_count: 1 },
    ]);
    expect(r[0]!.notam_count + r[1]!.notam_count).toBe(2);
  });
});
