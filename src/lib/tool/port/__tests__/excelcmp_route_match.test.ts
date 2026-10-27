// Port of tests/test_compare_route_match.py.
import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import type { Sheet } from "../excelcmp_reader";
import { compare, matchedFlights, excelUtc } from "../excelcmp_compare";

const HEADER = ["DATE", "FLT", "DEP", "ARR", "STD", "Crew", "REG"];

describe("Vietnam airport local time", () => {
  const mapping = { date: "DATE", std: "STD", dep: "DEP", etd: "ETD" };
  for (const dep of ["THD", "VVTX", "VDO", "VVVD"]) {
    it(`${dep}: 13:10 local is 06:10 UTC`, () => {
      expect(excelUtc({ DATE: "27/10/2026", STD: "13:10", DEP: dep }, mapping)?.toISOString()).toBe("2026-10-27T06:10:00.000Z");
    });
  }
  it("THD prioritizes ETD and rolls back the UTC date", () => {
    expect(excelUtc({ DATE: "27/10/2026", STD: "00:30", ETD: "01:10", DEP: "THD" }, mapping, true)?.toISOString()).toBe("2026-10-26T18:10:00.000Z");
  });
  it("unknown airport does not invent a Vietnam offset", () => {
    expect(excelUtc({ DATE: "27/10/2026", STD: "13:10", DEP: "ZZZZ" }, mapping)).toBeNull();
  });
});

function sheet(...rows: unknown[][]): Sheet {
  return { name: "Roster", header: [...HEADER], rows: rows.map((r) => [...r]), header_row: 0 };
}

function row(dep: unknown, dest: unknown, date = "12/08/2026", std = "00:15"): unknown[] {
  return [date, 5069, dep, dest, std, "-ONE PILOT(CP) 1111", "VN-A123"];
}

function flight(sectorId: number, dep: [string, string], dest: [string, string], std: Date): Flight {
  return new Flight({ id: sectorId, callsign: "VJC5069", dep_icao: dep[0], dep_iata: dep[1], dest_icao: dest[0], dest_iata: dest[1], std });
}

function utc(day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(2026, 7, day, hh, mm));
}

const NOZ_HAN = flight(21270670, ["UNWW", "NOZ"], ["VVNB", "HAN"], utc(11, 17, 15));
const HAN_CXR = flight(21280017, ["VVNB", "HAN"], ["VVCR", "CXR"], utc(11, 23, 45));

function matched(sh: Sheet, flights: Flight[]): number[] {
  return matchedFlights(sh, flights).map((f) => f.id);
}

function noteOf(sh: Sheet, flights: Flight[]): string {
  const rows = compare(sh, flights).rows;
  expect(rows.length).toBe(1);
  expect(rows[0]!.matched).toBe(false);
  return rows[0]!.note;
}

describe("excelcmp compare — route match (test_compare_route_match.py)", () => {
  it("lone candidate with wrong route is not matched", () => {
    const sh = sheet(row("NOZ", "HAN"));
    expect(matched(sh, [HAN_CXR])).toEqual([]);
    const note = noteOf(sh, [HAN_CXR]);
    expect(note).toContain("NOZ-HAN");
    expect(note).toContain("VVNB-VVCR");
  });

  it("lone candidate with right route still matches", () => {
    const sh = sheet(row("NOZ", "HAN"));
    expect(matched(sh, [NOZ_HAN])).toEqual([NOZ_HAN.id]);
  });

  it("two sectors same callsign pick by route", () => {
    const sh = sheet(row("NOZ", "HAN"));
    expect(matched(sh, [HAN_CXR, NOZ_HAN])).toEqual([NOZ_HAN.id]);
    expect(matched(sheet(row("HAN", "CXR")), [HAN_CXR, NOZ_HAN])).toEqual([HAN_CXR.id]);
  });

  it("icao in excel matches too", () => {
    const sh = sheet(row("UNWW", "VVNB"));
    expect(matched(sh, [HAN_CXR, NOZ_HAN])).toEqual([NOZ_HAN.id]);
  });

  it("blank route cells do not reject", () => {
    const sh = sheet(row(null, null));
    expect(matched(sh, [HAN_CXR])).toEqual([HAN_CXR.id]);
  });

  it("unreadable route cell does not reject", () => {
    const sh = sheet(row("VVNB-VVCR", null));
    expect(matched(sh, [HAN_CXR])).toEqual([HAN_CXR.id]);
  });

  it("half filled route still filters", () => {
    const sh = sheet(row("NOZ", null));
    expect(matched(sh, [HAN_CXR])).toEqual([]);
    expect(matched(sh, [HAN_CXR, NOZ_HAN])).toEqual([NOZ_HAN.id]);
  });

  it("no date column also checks route", () => {
    const head = ["FLT", "DEP", "ARR", "Crew"];
    const sh: Sheet = { name: "Roster", header: head, rows: [[5069, "NOZ", "HAN", "-ONE PILOT(CP) 1111"]], header_row: 0 };
    expect(matched(sh, [HAN_CXR])).toEqual([]);
    expect(matched(sh, [HAN_CXR, NOZ_HAN])).toEqual([NOZ_HAN.id]);
  });
});
