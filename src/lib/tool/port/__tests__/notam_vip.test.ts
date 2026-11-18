import { describe, expect, it } from "vitest";
import { Flight } from "../../core/models";
import { isVipMovement, vipOverlaps } from "../notam_vip";
import { verdictOf, fleetVerdict } from "../notam_verdict";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";
import { assessedVerdict } from "../notam_summary";

// A4430/26 VVNB B)202611171630 C)202611171640 "DEP/ARR ACFT MAY BE DLA DUE TO VIP MOV."
const vip = {
  ident: "A4430/26",
  qsubj: "FA",
  qcond: "XX",
  e_field: "DEP/ARR ACFT MAY BE DLA DUE TO VIP MOV.",
  start: "2026-11-17T16:30:00Z",
  end: "2026-11-17T16:40:00Z",
};
const arrival = (sta: string, dest = "VVNB", dep = "VVTS") =>
  new Flight({ id: 1, callsign: "VJC130", dep_icao: dep, dest_icao: dest,
    std: new Date(new Date(sta).getTime() - 2 * 3600_000), sta: new Date(sta) });
const places = [{ code: "VVNB", kind: "A", notams: [vip] }];
const vipRows = (v: ReturnType<typeof verdictOf>) => v.sections.find((s) => s.key === "vip")?.rows || [];

describe("VIP movement NOTAM → extra holding fuel", () => {
  it("recognises VIP MOV wording without the word FUEL", () => {
    expect(isVipMovement(vip.e_field)).toBe(true);
    expect(isVipMovement("ILS RWY 11L U/S")).toBe(false);
  });
  it("maintenance RWY closure whose RMK only stops works for VIP flights is not VIP", () => {
    const a4390 = "RWY 11R/29L NOT AVBL FOR TKOF AND LDG DUE TO MAINT\nRMK: THE WORKING AREA WILL BE STOPPED WHEN THERE ARE VIP FLT\nOPS OR VIS LESS THAN 2000M OR IN HAZARDOUS WX CONDITIONS.";
    expect(isVipMovement(a4390)).toBe(false);
    expect(isVipMovement("TWY E CLSD DUE TO WIP EXC VIP FLT.")).toBe(false);
  });
  it("VIP without delay, holding or traffic stop is not VIP", () => {
    expect(isVipMovement("VIP FLT OPS AT VVNB.")).toBe(false);
  });
  it("VIP with holding/delay or AD closure caused by VIP is VIP", () => {
    expect(isVipMovement("DUE TO VIP MOV. ARR ACFT EXP HOLDING.")).toBe(true);
    expect(isVipMovement("AD CLSD DUE TO VIP MOV.")).toBe(true);
    expect(isVipMovement("ALL DEP/ARR SUSPENDED DUE TO VIP FLT")).toBe(true);
  });
  it("arrival landing inside the window (16:35Z) gets the VIP warning", () => {
    const v = verdictOf(places, arrival("2026-11-17T16:35:00Z"), []);
    expect(vipRows(v).map((r) => r.ident)).toEqual(["A4430/26"]);
    expect(v.status).toBe("risk");
  });
  it("arrival 30 minutes before the window start still warns; 31 minutes after the end does not", () => {
    expect(vipRows(verdictOf(places, arrival("2026-11-17T16:00:00Z"), []))).toHaveLength(1);
    expect(vipRows(verdictOf(places, arrival("2026-11-17T17:11:00Z"), []))).toHaveLength(0);
  });
  it("arrival far outside the window is not listed", () => {
    expect(vipRows(verdictOf(places, arrival("2026-11-17T18:30:00Z"), []))).toHaveLength(0);
  });
  it("departures from the VIP airport are not listed", () => {
    const dep = new Flight({ id: 2, callsign: "VJC133", dep_icao: "VVNB", dest_icao: "VVTS",
      std: new Date("2026-11-17T16:35:00Z"), sta: new Date("2026-11-17T18:35:00Z") });
    expect(vipRows(verdictOf(places, dep, []))).toHaveLength(0);
  });
  it("fleet summary lists the affected arrival under its own flight", () => {
    const v = verdictOf(places, arrival("2026-11-17T16:35:00Z"), []);
    const fleet = fleetVerdict([{ cs: "VJC130", dep: "VVTS", dest: "VVNB", verdict: v }]);
    const sec = fleet.sections.find((s) => s.key === "vip");
    expect(sec?.hit).toBe(true);
    expect(sec?.groups?.[0].title).toBe("VJC130 VVTS–VVNB:");
  });
  it("track grading raises an overlapping arrival to CRITICAL with vip_hold", () => {
    const eta = new Date("2026-11-17T16:35:00Z"), etd = new Date("2026-11-17T14:35:00Z");
    const f: AssessFlight = { etd, eta, roles: { VVTS: "DEP", VVNB: "ARR" }, firs: {}, points: [],
      tokens: new Set(), sid: null, star: null, acType: "A321" };
    const r = assessNotam(vip, "VVNB", "AD", f, DEFAULT_ASSESS_CFG);
    expect(r.level).toBe("CRITICAL");
    expect(r.vip_hold).toBe(true);
    const late = assessNotam(vip, "VVNB", "AD", { ...f, eta: new Date("2026-11-17T19:00:00Z") }, DEFAULT_ASSESS_CFG);
    expect(late.vip_hold).toBeFalsy();
    const v = assessedVerdict({ status: "clear", sections: [] },
      [{ code: "VVNB", kind: "A", notams: [{ ...vip, level: r.level, vip_hold: true, reasons: r.reasons }] }], () => []);
    expect(v.sections.find((s) => s.key === "vip")?.rows?.[0].label).toBe("VVNB VIP 1630–1640Z");
    expect(v.status).toBe("risk");
  });
  it("unknown arrival time never warns", () => {
    expect(vipOverlaps(new Date(vip.start), new Date(vip.end), null)).toBe(false);
  });
});
