// Port of FplFormulaTests from tests/test_fpl_tool.py (pure-logic parts only;
// page/DOM tests and tests needing fs reload are skipped).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ft from "../fpl_tool";
import * as pcr from "../pcr_limits";

const DATA_DIR = join(__dirname, "../../data");
const raw = JSON.parse(readFileSync(join(DATA_DIR, "fpl_tool.json"), "utf-8"));
const altDoc = JSON.parse(readFileSync(join(DATA_DIR, "fpl/alt_route.json"), "utf-8"));
const eraDoc = JSON.parse(readFileSync(join(DATA_DIR, "fpl/era.json"), "utf-8"));
const costDoc = ft.build_cost_index_library(raw);
const taxiDoc = JSON.parse(readFileSync(join(DATA_DIR, "fpl/taxi_fuel.json"), "utf-8"));
const routeDoc = JSON.parse(readFileSync(join(DATA_DIR, "fpl/route_suffix.json"), "utf-8"));
const pcrLimitsDoc = JSON.parse(readFileSync(join(DATA_DIR, "pcr_limits.json"), "utf-8"));

const db = new ft.Db(raw, { altRoutesDoc: altDoc, eraDoc, ciDoc: costDoc, taxiDoc });

function flight(flt: string) {
  const row = db.flights.find((r) => ft._num(r.flt) === flt);
  if (!row) throw new Error("flight not found: " + flt);
  return row;
}

const VJC3900 = `*÷Flight Plan - 121VJC3900- SGN-PVG
OPT÷FP,WXUK,KILOS,RN,AW,DRFT,OPGF,CS/VJC3900,TLK/EFB-A320F/A330-20260930V0,CPT/17435 MUHAMMAD BASNAN,FOF/7404 NAM SOONGWOO,DSP/PHAN THANH HY
POD÷SGN/SGN/DAD/HKG,ALT=CXR,TX180
POA÷PVG/DAD/HKG/PVG
RTE÷RT/SGNPVG1
HLD÷30,HFE/PVGHFE1/100/300,HGH/PVGHGH1/100/300
ETD÷1300
PRO÷I,T,M,100,310
AIR÷$VNA648/
CRZ÷CI15
OWT÷
PAY÷14338
16F÷A0,603,ERA=RCTP`;

// jetplan_ac.specs() equivalent (PC-helper only in prod) — stub for pure-logic tests.
const JETPLAN_BY_REG: Record<string, { type: string; mtow: number }> = {
  "VN-A644": { type: "32SK", mtow: 89000 },
  "VN-A202": { type: "321G", mtow: 89000 },
};
function specOf(reg: string) {
  return JETPLAN_BY_REG[reg] || null;
}
pcr._setDataForTests(pcrLimitsDoc);
function pickVariant(hint: string, mtow: number) {
  return pcr.pick_variant(hint, mtow);
}
function pcrTakeoff(db2: ft.Db, dep: string, reg: string): string {
  return ft.pcr_weights(db2, dep, reg, pcrLimitsDoc, specOf, pickVariant)[0];
}
function pcrPlus(db2: ft.Db, dep: string, reg: string): string {
  return ft.pcr_weights(db2, dep, reg, pcrLimitsDoc, specOf, pickVariant)[1];
}

describe("FplFormulaTests", () => {
  it("vjc3900 uses the route table", () => {
    const got = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, routeTable: routeDoc.rows });
    expect(got).toBe(VJC3900);
    const named = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, dsp: "TEN DSP", routeTable: routeDoc.rows });
    expect(named).toContain("DSP/TEN DSP");
    const cleared = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, dsp: "", routeTable: routeDoc.rows });
    expect(cleared).toContain(",DSP/");
    expect(cleared).not.toContain("DSP/PHAN THANH HY");
  });

  it("extra and rmk follow the tlk", () => {
    const f = flight("3900");
    const tlk = "TLK/EFB-A320F/A330-20260930V0";
    const plain = ft.render_fpl(db, f, { extra: 0, seq: 121, routeTable: routeDoc.rows });
    expect(plain).toContain(tlk + ",CPT/");
    expect(plain).not.toContain("EXTRA FUEL");
    expect(plain).not.toContain("RMK÷");
    const fueled = ft.render_fpl(db, f, { extra: "200", seq: 121, routeTable: routeDoc.rows });
    expect(fueled).toContain(tlk + " /EXTRA FUEL DUE WX ENROUTE AND TRAFFIC,CPT/");
    const tagged = ft.render_fpl(db, f, { extra: "60M", seq: 121, routeTable: routeDoc.rows });
    expect(tagged).toContain(tlk + " /EXTRA FUEL DUE WX ENROUTE AND TRAFFIC,CPT/");
    expect(tagged).toContain("16F÷A60M,");
    const both = ft.render_fpl(db, f, { extra: "200", seq: 121, rmk: "MIL ACT", routeTable: routeDoc.rows });
    expect(both).toContain(tlk + " /EXTRA FUEL DUE WX ENROUTE AND TRAFFIC /MIL ACT,CPT/");
    expect(both).not.toContain("RMK÷");
    const noted = ft.render_fpl(db, f, { extra: 0, seq: 121, rmk: "MIL ACT", routeTable: routeDoc.rows });
    expect(noted).toContain(tlk + " /MIL ACT,CPT/");
    expect(noted).not.toContain("EXTRA FUEL");
  });

  it("eta utc comes from the crewlist eta", () => {
    db.tz.SGN = "07:00";
    db.tz.ICN = "09:00";
    const f = { date: "02/10/26", dep: "SGN", arr: "ICN", etd: "23:40", eta: "06:30", sta: "06:20" };
    expect(ft.eta_utc_hhmm(db, f)).toBe("2130");
  });

  it("payload rounding follows the aircraft", () => {
    expect(ft.round_est(17999, "320")).toEqual([18000, ""]);
    expect(ft.round_est(17955, "320")).toEqual([18000, ""]);
    expect(ft.round_est(17954, "320")).toEqual([17950, ""]);
    expect(ft.round_est(17544, "320")).toEqual([17500, ""]);
    expect(ft.round_est(16999, "320")[0]).toBe(17500);
    expect(ft.round_est(18001, "320")[0]).toBeNull();
    expect(ft.round_est(21054, "321")).toEqual([21050, ""]);
    expect(ft.round_est(22501, "321")[0]).toBeNull();
    expect(ft.round_est(19999, "321")[0]).toBe(20500);
    expect(ft.round_est(47040, "330")).toEqual([47000, ""]);
    expect(ft.round_est(47050, "330")).toEqual([47100, ""]);
    expect(ft.round_est(49001, "330")[0]).toBeNull();
    const got = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, pay: "13800", routeTable: routeDoc.rows });
    expect(got).toContain("PAY÷13800");
    const plain = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, routeTable: routeDoc.rows });
    expect(plain).toContain("PAY÷14338");
    const clock = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, utc_choice: "0440", routeTable: routeDoc.rows });
    expect(clock).toContain("ETD÷0440");
  });

  it("a typed alternate replaces the lookup", () => {
    const got = ft.render_fpl(db, flight("863"), {
      extra: "60m", seq: 119, route_q: "/CJJ/TPE/MNL/DAD", alt2: "vca", routeTable: routeDoc.rows,
    });
    expect(got).toContain("HLD÷30,CXR/SGNCXR1/100/300,vca/SGNvca1/100/300");
  });

  it("a deleted ALT1 leaves only ALT2 in HLD", () => {
    const f = { flt: "852", dep: "SGN", arr: "RMQ", reg: "VN-A525", ac: 321, etd: "10:10" };
    const got = ft.render_fpl(db, f, { extra: 0, seq: 1, alt1: "", alt2: "TPE", routeTable: routeDoc.rows });
    expect(got).toContain("HLD÷30,TPE/RMQTPE1/100/300\n");
    expect(got).not.toContain("TNN");
  });

  it("alt route library uses the sheet columns", () => {
    const rec = db.alt_route.SGNPVG;
    expect(rec.podpoa).toBe("SGNPVG");
    expect(rec.etp_pod).toBe("/SGN/DAD/HKG");
    expect(rec.etp_poa).toBe("/DAD/HKG/PVG");
    expect(rec.talt).toBe("CXR");
    expect(rec.fl).toBe("100,310");
    expect(rec.alt1).toBe("HFE");
    expect(rec.alt2).toBe("HGH");
  });

  it("era library fills the code when the route exists", () => {
    const found: Record<string, string> = {};
    for (const row of eraDoc.routes) found[row.route] = row.era;
    expect(found.SGNPVG).toBe("RCTP");
    expect(db.era.SGNPVG).toBe("RCTP");
    expect(db.era.ZZZZZZ).toBeUndefined();
  });

  it("pcr takeoff uses the departure and the aircraft", () => {
    expect(pcrTakeoff(db, "UIH", "VN-A644")).toBe("70625");
    expect(pcrTakeoff(db, "UIH", "VN-A202")).toBe("70625");
    expect(pcrTakeoff(db, "CXR", "VN-A644")).toBe("");
    expect(pcrTakeoff(db, "DAD", "VN-A644")).toBe("");
    const got = ft.render_fpl(db, { flt: "383", dep: "UIH", arr: "HAN", reg: "VN-A202", ac: 321, etd: "05:05" }, {
      extra: 0, seq: 1, routeTable: routeDoc.rows, pcrTakeoff,
    });
    expect(got).toContain("16F÷A0,I,TO=70625");
    expect(pcrPlus(db, "UIH", "VN-A644")).toBe("76483");
    const chosen = ft.render_fpl(db, { flt: "383", dep: "UIH", arr: "HAN", reg: "VN-A202", ac: 321, etd: "05:05" }, {
      extra: 0, seq: 1, pcr_choice: "76391", routeTable: routeDoc.rows, pcrTakeoff,
    });
    expect(chosen).toContain("16F÷A0,I,TO=76391");
    const cleared = ft.render_fpl(db, { flt: "383", dep: "UIH", arr: "HAN", reg: "VN-A202", ac: 321, etd: "05:05" }, {
      extra: 0, seq: 1, pcr_choice: "", routeTable: routeDoc.rows, pcrTakeoff,
    });
    expect(cleared).not.toContain("TO=");
    const plain = ft.render_fpl(db, flight("3900"), { extra: 0, seq: 121, routeTable: routeDoc.rows });
    expect(plain).not.toContain("TO=");
  });

  it("flight rows come from the loaded crewlist", () => {
    const rows = ft.flights_from_crew_rows([
      {
        FLT: 383, DATE: "02/10/26", REG: "VN-A202", AC: 321,
        DEP: "uih", ARR: "sgn", STD: "10:05", ETD: null, STA: "11:20",
        Crew: "-MANORATH PALAM JAGADEES(CP+) 11626",
      },
      { FLT: null, Crew: "-TRAN QUANG KHAI(FO) 17376" },
    ]);
    expect(rows[0].flt).toBe("383");
    expect(rows[0].date).toBe("02/10/26");
    expect(rows[0].reg).toBe("VN-A202");
    expect(rows[0].dep).toBe("UIH");
    expect(rows[0].arr).toBe("SGN");
    expect(rows[0].etd).toBe("10:05");
    expect(rows[0].cpt_id).toBe("11626");
    expect(rows[0].cpt_name).toBe("MANORATH PALAM JAGADEES");
    expect(rows[0].fo_id).toBe("17376");
    expect(rows[0].fo_name).toBe("TRAN QUANG KHAI");
  });

  it("two captains show the smaller id and skip deadhead", () => {
    const rows = ft.flights_from_crew_rows([
      {
        FLT: 3900, DATE: "02/10/26", REG: "VN-A677", AC: 321,
        DEP: "SGN", ARR: "PVG", STD: "20:00",
        Crew: "-HON MUN WAH(CP) 18993",
      },
      { FLT: null, Crew: "-SHAKIB M SH BESISO(CP+) 11971" },
      { FLT: null, Crew: "-PHAM DUY QUANG(FO) 18044" },
      { FLT: null, Crew: "-NGUOI SAN(CP, DHD) 11111" },
      { FLT: null, Crew: "-NGUOI KHAC(FO) 13055" },
    ]);
    expect(rows[0].captains.map((p: any) => p.id)).toEqual(["11971", "18993"]);
    expect(rows[0].cpt_id).toBe("11971");
    expect(rows[0].fos.map((p: any) => p.id)).toEqual(["13055", "18044"]);
    expect(rows[0].fo_id).toBe("13055");
    expect(rows[0].captains.map((p: any) => p.id)).not.toContain("11111");
  });

  it("marked callsign keeps only the number", () => {
    const rows = ft.flights_from_crew_rows([
      {
        FLT: "771*", DATE: "02/10/26", REG: "VN-A665", AC: 321,
        DEP: "SGN", ARR: "HAN", STD: "08:00", Crew: "-A(CP) 10001",
      },
      {
        FLT: "771A*", DATE: "02/10/26", REG: "VN-A666", AC: 321,
        DEP: "HAN", ARR: "SGN", STD: "12:00", Crew: "-B(CP) 10002",
      },
    ]);
    expect(rows.map((r: any) => r.flt)).toEqual(["771", "771"]);
    expect(rows.map((r: any) => r.flt_raw)).toEqual(["771*", "771A*"]);
    expect(rows[0].dep).toBe("SGN");
    expect(rows[1].arr).toBe("SGN");
  });

  it("october taxi and the cost index picture", () => {
    expect(String(ft._tx(db, "321", "VN-A648", "SGN"))).toBe("180");
    expect(ft._tx(db, "320", "VN-A000", "ZZZ")).toBe(200);
    expect(ft._tx(db, "330", "VN-A000", "ZZZ")).toBe(500);
    expect(ft._ci(db, "SGN", "HAN", "320", "VN-A000")).toBe("13");
    expect(ft._ci(db, "SGN", "PVG", "321", "VN-A648")).toBe("15");
    expect(ft._ci(db, "SYD", "SGN", "320", "VN-A000")).toBe("");
    expect(ft._suffix(routeDoc.rows, "DADICN", "1200")).toBe("2");
    expect(ft._suffix(routeDoc.rows, "DADICN", "1600")).toBe("1");
    expect(ft._suffix(routeDoc.rows, "CXRICN", "0900")).toBe("3");
    expect(ft._suffix(routeDoc.rows, "SGNPVG", "1300")).toBe("1");
    const byId: Record<string, any> = {};
    for (const row of db.ci_rows) byId[row.id] = row;
    expect(byId.kz.a330).toBe("18");
    expect(byId.aus.a320).toBe("");
    expect(db.ci_rows.filter((r) => String(r.id).startsWith("extra")).map((r) => r.id)).toEqual([
      "extra1", "extra2", "extra3",
    ]);
  });

  it("req file keeps the division sign as one byte", () => {
    const bytes = ft.req_bytes("*÷A\n\nB");
    expect(Array.from(bytes)).toEqual(Array.from(Buffer.from("*\xf7A\r\n\r\nB\r\n", "binary")));
  });
});
