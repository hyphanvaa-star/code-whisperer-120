import { describe, expect, it } from "vitest";
import { mnlIcao, mnlUtcTime, pickFlightPlan, planBelongsTo } from "../formmnl_plan";

describe("FORM MNL plan identity", () => {
  it("maps Crewlist IATA to JetPlan ICAO", () => {
    expect(mnlIcao("MNL")).toBe("RPLL");
    expect(mnlIcao("SGN")).toBe("VVTS");
    expect(mnlIcao("RPLL")).toBe("RPLL");
  });

  it("VJ859 07/11/26 03:45 local, 1945Z departs 06/11 19:45Z", () => {
    expect(new Date(mnlUtcTime("07/11/26", "03:45", "1945")).toISOString()).toBe("2026-11-06T19:45:00.000Z");
  });

  it("keeps same UTC day when local and UTC share it", () => {
    expect(new Date(mnlUtcTime("07/11/26", "10:00", "0300")).toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });

  const t = Date.UTC(2026, 10, 6, 19, 45);
  const vj859 = { callsign: "VJ859", std: "2026-11-06T19:45:00Z", dep_icao: "RPLL", dest_icao: "VVTS", plan_no: "5531" };

  it("takes that day's CFP from FliteBrief by flight/route/time", () => {
    expect(pickFlightPlan([vj859], { digits: "859", dep: "MNL", arr: "SGN", t })).toBe("5531");
  });

  it("never uses yesterday's CFP or another route", () => {
    const yday = { ...vj859, std: "2026-11-05T19:45:00Z", plan_no: "4410" };
    expect(pickFlightPlan([yday], { digits: "859", dep: "MNL", arr: "SGN", t })).toBe("");
    expect(pickFlightPlan([{ ...vj859, dest_icao: "VVNB" }], { digits: "859", dep: "MNL", arr: "SGN", t })).toBe("");
  });

  it("refuses an ambiguous tie between two CFPs", () => {
    const a = { ...vj859, std: "2026-11-06T18:45:00Z", plan_no: "1" };
    const b = { ...vj859, std: "2026-11-06T20:45:00Z", plan_no: "2" };
    expect(pickFlightPlan([a, b], { digits: "859", dep: "MNL", arr: "SGN", t })).toBe("");
  });

  it("accepts JetPlan's callsign form input and rejects another flight", () => {
    expect(planBelongsTo('<input type="text" name="callsign" value="VJC859" size=7>', "VJC859")).toBe(true);
    expect(planBelongsTo('<input name="callsign" value="VJC858">', "VJC859")).toBe(false);
    expect(planBelongsTo("(FPL-VJC859-IS", "VJC859")).toBe(true);
  });
});
