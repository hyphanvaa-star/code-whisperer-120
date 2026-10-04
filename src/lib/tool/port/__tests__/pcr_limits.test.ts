import { describe, it, expect } from "vitest";
import * as pcr from "../pcr_limits";

function flight(dep: string, dest: string, ac = "A321") {
  return { dep_icao: dep, dest_icao: dest, ac_type: ac, acft_type: ac };
}

describe("family_of", () => {
  it("ceo/neo/a320/a330", () => {
    expect(pcr.family_of("A320")).toBe("a320");
    expect(pcr.family_of("A20N")).toBe("a320");
    expect(pcr.family_of("A321")).toBe("a321ceo");
    expect(pcr.family_of("A21N")).toBe("a321neo");
    expect(pcr.family_of("A33T")).toBe("a330");
    expect(pcr.family_of("A333")).toBe("a330");
  });

  it("picks volume by mtow", () => {
    expect(pcr.pick_variant("A320", 77000)!.id).toBe("WV012");
    expect(pcr.pick_variant("A320", 78000)!.id).toBe("WV017");
    expect(pcr.pick_variant("A321", 93000)!.id).toBe("WV001");
    expect(pcr.pick_variant("A21N", 89000)!.id).toBe("WV050");
    expect(pcr.pick_variant("A21N", 93500)!.id).toBe("WV053");
  });
});

describe("check_flight", () => {
  it("silent when room over 500", () => {
    const f = flight("VVTS", "VVCA", "A321");
    const ofp = { sector_id: 1, tow: 74000, mtow: 93000, lwt: 64000 };
    expect(pcr.check_flight(f, ofp)).toEqual([]);
  });

  it("yellow within 500", () => {
    const f = flight("VVTS", "VVCA", "A321");
    const ofp = { sector_id: 1, tow: 74000, mtow: 93000, lwt: 64900 };
    const warns = pcr.check_flight(f, ofp);
    expect(warns.length).toBe(1);
    expect(warns[0].severity).toBe("warning");
    expect(warns[0].text).toContain("VVCA DEST");
    expect(warns[0].limit).toContain("LWT");
  });

  it("red at or over pcr", () => {
    const f = flight("VVCA", "VVTS", "A321");
    const ofp = { sector_id: 1, tow: 65344, mtow: 93000, lwt: 60000 };
    const warns = pcr.check_flight(f, ofp);
    expect(warns.length).toBe(1);
    expect(warns[0].severity).toBe("critical");
    expect(warns[0].text).toContain("VVCA DEP");
  });

  it("a320 77 vs 78 chu lai", () => {
    const w77 = pcr.check_flight(flight("VVTS", "VVCA", "A320"), { sector_id: 1, tow: 70000, mtow: 77000, lwt: 67000 });
    const w78 = pcr.check_flight(flight("VVTS", "VVCA", "A320"), { sector_id: 1, tow: 70000, mtow: 78000, lwt: 67000 });
    expect(w77[0].severity).toBe("warning");
    expect(w78[0].severity).toBe("warning");
    expect(w77[0].limit).toContain("67 204");
    expect(w78[0].limit).toContain("67 493");
  });

  it("dual rwy uses worse, hover shows ok", () => {
    const f = flight("VVTS", "VVDN", "A33T");
    const ofp = { sector_id: 1, tow: 210000, mtow: 233000, lwt: 183690 };
    const warns = pcr.check_flight(f, ofp);
    expect(warns.length).toBe(1);
    expect(warns[0].severity).toBe("ok");
    expect(warns[0].text).toContain("17R/35L");
    expect(warns[0].limit).toContain("184 090");
    const rwys = warns[0].table.runways;
    expect(rwys.map((r: any) => r.id)).toEqual(["17L/35R", "17R/35L"]);
    expect(rwys[0].pcr).toBe(230402);
    expect(rwys[1].pcr).toBe(184090);
    expect(rwys[0].hit).toBe(false);
    expect(rwys[1].hit).toBe(false);
  });

  it("dual rwy over worse is green", () => {
    const f = flight("VVTS", "VVDN", "A33T");
    const warns = pcr.check_flight(f, { sector_id: 1, tow: 210000, mtow: 233000, lwt: 188000 });
    expect(warns[0].severity).toBe("ok");
    const rwys = warns[0].table.runways;
    expect(rwys[0].hit).toBe(false);
    expect(rwys[1].hit).toBe(true);
  });

  it("dual rwy over backup stays red", () => {
    const f = flight("VVTS", "VVDN", "A33T");
    const warns = pcr.check_flight(f, { sector_id: 1, tow: 210000, mtow: 233000, lwt: 231000 });
    expect(warns[0].severity).toBe("critical");
  });

  it("cam ranh table two rwys and tow", () => {
    const f = flight("VVCR", "VVTS", "A21N");
    const ofp = { sector_id: 1, tow: 80515, mtow: 89000, lwt: 62000 };
    const warns = pcr.check_flight(f, ofp);
    expect(warns[0].severity).toBe("ok");
    const t = warns[0].table;
    expect(t.icao).toBe("VVCR");
    expect(t.iata).toBe("CXR");
    expect(t.label).toBe("TOW");
    expect(t.weight).toBe(80515);
    expect(t.ac).toContain("WV050");
    const [r0, r1] = t.runways;
    expect(r0.id).toBe("02L/20R");
    expect(r0.pcr).toBe(77031);
    expect(r0.p10).toBe(83506);
    expect(r0.hit).toBe(true);
    expect(r1.id).toBe("02R/20L");
    expect(r1.pcr).toBeNull();
    expect(r1.hit).toBe(false);
    const packed = pcr.pack_for_weights(warns);
    expect(packed.tow.table.runways[0].pcr).toBe(77031);
  });

  it("pack for compare", () => {
    const f = flight("VVCA", "VVTS", "A321");
    const packed = pcr.pack_for_weights(pcr.check_flight(f, { sector_id: 1, tow: 65344, mtow: 93000, lwt: 60000 }));
    expect(packed.tow.severity).toBe("critical");
    expect(packed.lwt).toBeNull();
  });

  it("ofp pcr mtow is not a volume", () => {
    const f = flight("VVPC", "VVTS", "A321");
    expect(pcr.check_flight(f, { sector_id: 1, tow: 75614, mtow: 76391, lwt: 64000 })).toEqual([]);
  });

  it("jetplan mtow picks 93500 not 89000", () => {
    const f = flight("VVPC", "VVTS", "A321");
    const warns = pcr.check_flight(f, { sector_id: 1, tow: 75614, mtow: 76391, lwt: 64000 }, { fleet_mtow: 93500 });
    expect(warns.length).toBe(1);
    expect(warns[0].severity).toBe("ok");
    expect(warns[0].table.ac).toContain("WV011");
    expect(warns[0].table.mtow).toBe(93500);
    expect(warns[0].table.ac).not.toContain("WV000");
    expect(warns[0].limit).toContain("70 531");
    expect(warns[0].table.runways[0].p10).toBe(76391);
    expect(warns[0].table.runways[0].hit).toBe(true);
  });

  it("plus10 filed but tow over ofp stays red", () => {
    const f = flight("VVPC", "VVTS", "A321");
    const warns = pcr.check_flight(f, { sector_id: 1, tow: 77000, mtow: 76391, lwt: 64000 }, { fleet_mtow: 93500 });
    expect(warns[0].severity).toBe("critical");
    expect(warns[0].evidence).not.toContain("xin vượt 10%");
  });

  it("structural mtow over pcr stays red", () => {
    const f = flight("VVPC", "VVTS", "A321");
    const warns = pcr.check_flight(f, { sector_id: 1, tow: 75614, mtow: 93000, lwt: 64000 });
    expect(warns[0].severity).toBe("critical");
  });

  it("unlisted airport silent", () => {
    const f = flight("VVTS", "VVNB", "A321");
    expect(pcr.check_flight(f, { sector_id: 1, tow: 89000, mtow: 93000, lwt: 70000 })).toEqual([]);
  });

  it("no restricted a320 buon ma thuot", () => {
    const f = flight("VVBM", "VVTS", "A320");
    expect(pcr.check_flight(f, { sector_id: 1, tow: 77000, mtow: 77000, lwt: 64000 })).toEqual([]);
  });
});
