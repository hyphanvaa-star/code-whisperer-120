import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  eaip_cycles, merge_sup_rows, parse_eaip_sup_index, parse_generic_sup_text, parse_hk_sup_index,
  sup_html_text, sup_key_of, sup_norm_coords, sup_radius_nm,
} from "../aip_sup";
import { supKeys } from "../notam_track";
import { assessNotam, DEFAULT_ASSESS_CFG } from "../notam_assess";

const FX = "src/lib/tool/port/__tests__/fixtures/";
const read = (f: string) => readFileSync(FX + f, "utf8");
const nm = (a: [number, number], b: [number, number]) => {
  const mid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(mid));
};

describe("coordinate and radius formats", () => {
  it("rewrites symbol DMS and DDM to compact form", () => {
    expect(sup_norm_coords(`35°19'29"N 129°18'07"E`)).toBe("351929N 1291807E");
    expect(sup_norm_coords("01°23.47’N 103°48.62’E")).toBe("0123.47N 10348.62E");
  });
  it("reads radius in NM, KM and metres", () => {
    expect(sup_radius_nm("A circle radius 10 NM centered on")).toBe(10);
    expect(sup_radius_nm("within 250m radius of")).toBeCloseTo(250 / 1852, 6);
    expect(sup_radius_nm("radius of 3.704 KM")).toBeCloseTo(2, 6);
  });
  it("normalises SUP numbers with 2- or 4-digit years", () => {
    expect(sup_key_of("AIRAC 174/2024")).toBe("174/24");
    expect(sup_key_of("083/2024")).toBe("83/24");
    expect(supKeys("REF AIRAC AIP SUP 175/2026")).toEqual(["175/26"]);
    expect(supKeys("REF AIP SUP 052/26")).toEqual(["52/26"]);
  });
});

describe("Korea AIP SUP 89/26 temporary prohibited areas", () => {
  const t = parse_generic_sup_text(read("kr_sup_89_26.txt"), "89/26");
  it("draws all ten circles with their designators", () => {
    expect(Object.values(t).map((a) => a.name)).toEqual(["P61A", "P61B", "P62A", "P62B", "P63A", "P63B", "P64A", "P64B", "P65A", "P65B"]);
  });
  it("P61B is a 10 NM circle around 35°19'29\"N 129°18'07\"E", () => {
    const c: [number, number] = [35 + 19 / 60 + 29 / 3600, 129 + 18 / 60 + 7 / 3600];
    for (const p of Object.values(t)[1]!.ring) expect(nm(c, p)).toBeCloseTo(10, 1);
  });
});

describe("Hong Kong AIP SUP drone areas", () => {
  it("25/26 geofence is the published four-point polygon", () => {
    const ring = parse_generic_sup_text(read("hk_sup_25_26.txt"), "25/26")["NR.1"]!.ring;
    expect(ring).toEqual([[22.300833, 114.189722], [22.299444, 114.190556], [22.298333, 114.188333], [22.3, 114.1875]]);
  });
  it("22/26 is a 250 m circle", () => {
    const ring = parse_generic_sup_text(read("hk_sup_22_26.txt"), "22/26")["NR.1"]!.ring;
    const c: [number, number] = [22 + 18 / 60 + 48 / 3600, 114 + 2 / 60 + 48 / 3600];
    for (const p of ring) expect(nm(c, p)).toBeCloseTo(250 / 1852, 2);
  });
});

describe("Malaysia AIP SUP 12/26 WMR416D", () => {
  const t = parse_generic_sup_text(sup_html_text(read("my_sup_12_26.html")), "12/26");
  it("is one area named WMR416D", () => {
    expect(Object.values(t).map((a) => a.name)).toEqual(["WMR416D"]);
  });
  it("draws the 15 NM arc around the helipad between its two published ends", () => {
    const ring = t["NR.1"]!.ring;
    const ctr: [number, number] = [4 + 13 / 60 + 58.04 / 3600, 100 + 37 / 60 + 4.15 / 3600];
    const onArc = ring.filter((p) => Math.abs(nm(ctr, p) - 15) < 0.2);
    expect(onArc.length).toBeGreaterThan(4);
    expect(ring.some((p) => Math.abs(p[0] - ctr[0]) < 1e-4 && Math.abs(p[1] - ctr[1]) < 1e-4)).toBe(false);
  });
});

describe("Singapore AIP SUP 175/26 transit corridors", () => {
  const t = parse_generic_sup_text(sup_html_text(read("sg_sup_175_26.html")), "175/26");
  it("keeps TC-1 and TC-2 once each and ignores the DDM copy and the waypoint table", () => {
    expect(Object.values(t).map((a) => a.name)).toEqual(["TC-1", "TC-2"]);
  });
});

describe("obstacle-only SUP never becomes an area", () => {
  it("crane list returns no rings", () => {
    const txt = "PAYA LEBAR AIRPORT - CRANES\nCrane 1 012030N 1035400E 150FT AMSL\nCrane 2 012040N 1035410E 160FT AMSL\nCrane 3 012050N 1035420E 170FT AMSL";
    expect(parse_generic_sup_text(txt, "6/26")).toEqual({});
  });
});

describe("SUP index pages", () => {
  it("Malaysia index cleans list-number hrefs", () => {
    const rows = parse_eaip_sup_index(read("my_sup_index.html"), "https://aip.caam.gov.my/aip/eAIP/2026-11-03/html/eSUP/WM-eSUPs-en-MS.html");
    const r = rows.find((x) => x.sup === "12/26")!;
    expect(r.url).toBe("https://aip.caam.gov.my/aip/eAIP/2026-03-19-AIRAC/html/eSUP/WM-eSUP-26-12-en-MS.html");
    expect(r.subject).toContain("WMR416D");
    expect(r.to).toBe("18 MAR 2029");
  });
  it("Korea index links each SUP PDF", () => {
    const rows = parse_eaip_sup_index(read("kr_sup_index.html"), "https://aim.koca.go.kr/eaipPub/Package/2026-11-12/html/eSUP/KR-eSUPs-en-GB.html");
    expect(rows[0]).toMatchObject({ sup: "95/26", url: "https://aim.koca.go.kr/eaipPub/Package/2026-12-24-AIRAC/html/eSUP/KR-eSUP-2026-95-en-GB.pdf" });
  });
  it("Hong Kong ais.json rows", () => {
    const rows = parse_hk_sup_index({ supDetail: [{ docRef: "25/26", sTitle: "DRONE SHOW", fName: "HKAIP/sup/SUP25-26.pdf", lastUpdate: "2026-11-17" }] });
    expect(rows).toEqual([{ sup: "25/26", label: "25/26", subject: "DRONE SHOW", from: "2026-11-17", to: "", url: "https://www.ais.gov.hk/HKAIP/sup/SUP25-26.pdf" }]);
  });
  it("package folders newest first, skipping ones too far ahead", () => {
    const h = '<a href="2026-11-12/html/index-en-GB.html"></a><a href="2027-06-01-AIRAC/html/index-en-GB.html"></a><a href="2026-12-24-AIRAC/html/index-en-GB.html"></a>';
    expect(eaip_cycles(h, "2026-11-23")).toEqual(["2026-12-24-AIRAC", "2026-11-12"]);
  });
  it("merge drops expired SUPs and keeps the newest entry", () => {
    const now = Date.UTC(2026, 10, 23);
    const a = { sup: "1/26", label: "1/26", subject: "new", from: "", to: "UFN", url: "" };
    const old = { ...a, subject: "old" };
    const gone = { sup: "2/26", label: "2/26", subject: "", from: "", to: "01 NOV 2026", url: "" };
    expect(merge_sup_rows([[a, gone], [old]], now)).toEqual([a]);
  });
});

describe("NOTAM citing Korea AIP SUP 89/26", () => {
  const ring = parse_generic_sup_text(read("kr_sup_89_26.txt"), "89/26")["NR.2"]!.ring;
  const T = (s: string) => new Date(s);
  const e = "TEMPORARY PROHIBITED AREA P61B ESTABLISHED. REF AIP SUP 89/26";
  const notam = { qfir: "RKRR", start: "2026-11-20 00:00", end: "2027-09-16 14:59", lower: "0", upper: "180", scope: "W",
    text: `Q)RKRR/QRPCA/IV/BO/W/000/180\nE)${e}`, e_field: e, sup_geoms: [{ name: "P61B", shape: "polygon", ring }] };
  const flight = (lat: number, lon: number, fl: number) => ({
    etd: T("2026-11-23T01:00:00Z"), eta: T("2026-11-23T03:00:00Z"), roles: { RKSI: "DEP", RKPK: "ARR" } as any,
    firs: { RKRR: [T("2026-11-23T01:00:00Z"), T("2026-11-23T03:00:00Z")] } as any,
    points: [{ lat, lon, name: "P1", fl_ft: fl, time_utc: "2026-11-23T02:00:00Z" }, { lat: lat + 0.1, lon: lon + 0.1, name: "P2", fl_ft: fl, time_utc: "2026-11-23T02:05:00Z" }] as any,
    tokens: new Set<string>(), sid: null, star: null, acType: "A321",
  });
  it("is graded by geometry, not left as a manual AIP SUP check", () => {
    const r = assessNotam(notam, "RKRR", "FIR", flight(35.3, 129.25, 8000), DEFAULT_ASSESS_CFG);
    expect(r.match_type).not.toBe("AIP-SUP");
    expect(r.level).toBe("CRITICAL");
  });
  it("a flight far away is NO IMPACT", () => {
    expect(assessNotam(notam, "RKRR", "FIR", flight(37.5, 126.5, 30000), DEFAULT_ASSESS_CFG).level).toBe("NO IMPACT");
  });
});
