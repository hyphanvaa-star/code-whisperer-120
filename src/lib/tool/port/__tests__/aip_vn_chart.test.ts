import { describe, it, expect } from "vitest";
import * as vn from "../aip_vn_chart";

const HIST = `
<h2>Currently Effective Issue</h2>
<a href="2026-06-30/html/index-en-GB.html">30 JUN 2026</a>
<h2>Next Issues</h2>
<a href="2026-10-01-AIRAC/html/index-en-GB.html">01 OCT 2026</a>
<h2>Expired Issues (Archives)</h2>
<a href="2026-05-14-AIRAC/html/index-en-GB.html">14 MAY 2026</a>
`;

const ROUTE = `
<tr><td>
  <span class="SD">L625</span><span class="sdParams">TEN_ROUTE_RTE;TXT_DESIG;1332</span>
</td></tr>
<tr><td>
  <span class="SD">AKMON</span><span class="sdParams">TDESIGNATED_POINT;CODE_ID;1523</span>
  <span class="SD">081254N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;1523</span>
  <span class="SD">1101306E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;1523</span>
</td></tr>
<tr><td>
  <span class="SD">UDOSI</span><span class="sdParams">TDESIGNATED_POINT;CODE_ID;1558</span>
  <span class="SD">093249N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;1558</span>
  <span class="SD">1111053E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;1558</span>
</td></tr>
<tr><td>
  <span class="SD">NOWAY</span><span class="sdParams">TDESIGNATED_POINT;CODE_ID;1</span>
</td></tr>
`;

const WPT = `
<tr><td>
  <span class="SD">ADBOP</span><span class="sdParams">TDESIGNATED_POINT;CODE_ID;1520</span>
  <span class="SD">083000N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;1520</span>
  <span class="SD">1040500E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;1520</span>
</td></tr>
`;

const NAV = `
<tr><td>
  <span class="SD">BUON MA THUOT</span><span class="sdParams">TNAVAID;TXT_NAME;1555</span>
  <span class="SD">DVOR/DME</span><span class="sdParams">TNAVAID;CODE_TYPE;1555</span>
  <span class="SD">BMT</span><span class="sdParams">TNAVAID;CODE_ID;1555</span>
  <span class="SD">123959N</span><span class="sdParams">TNAVAID;GEO_LAT;1555</span>
  <span class="SD">1080722E</span><span class="sdParams">TNAVAID;GEO_LONG;1555</span>
</td></tr>
`;

const AD = `
<span class="SD">DAK LAK/BUON MA THUOT</span><span class="sdParams">TAD_HP;TXT_NAME;1535</span>
<span class="SD">VVBM</span><span class="sdParams">TAD_HP;CODE_ICAO;1535</span>
<span class="SD">VVBM</span><span class="sdParams">TAD_HP;CODE_ICAO;1535</span>
`;

const ARP = `
<span class="SD">124006N</span><span class="sdParams">TAD_HP;GEO_LAT;1535</span>
<span class="SD">1080700E</span><span class="sdParams">TAD_HP;GEO_LONG;1535</span>
`;

describe("aip_vn_chart", () => {
  it("current issue skips Next and Archive", () => {
    const [cycle, effective] = vn.currentIssue(HIST);
    expect(cycle).toBe("2026-06-30");
    expect(effective).toBe("30 JUN 2026");
  });

  it("route keeps points with coordinates only", () => {
    const routes = vn.parseRoutes(ROUTE);
    expect(routes.length).toBe(1);
    expect(routes[0]?.name).toBe("L625");
    expect(routes[0]?.pts.length).toBe(2);
    expect(routes[0]?.pts[0]?.[0]).toBeCloseTo(8.215, 3);
    expect(routes[0]?.pts[0]?.[1]).toBeCloseTo(110.21833, 3);
  });

  it("route keeps minimum altitude on the segment", () => {
    const html = `
    <tr><td>
      <span class="SD">W2</span><span class="sdParams">TEN_ROUTE_RTE;TXT_DESIG;1</span>
    </td></tr>
    <tr><td>
      <span class="SD">081254N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;1</span>
      <span class="SD">1101306E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;1</span>
    </td></tr>
    <tr><td>
      <span class="SD">FL</span><span class="sdParams">TRTE_SEG;UOM_DIST_VER_LOWER;9</span>
      <span class="SD">260</span><span class="sdParams">TRTE_SEG;VAL_DIST_VER_LOWER;9</span>
      <span class="SD">2600</span><span class="sdParams">TRTE_SEG;VAL_DIST_VER_LOWER_OVRDE;9</span>
      <span class="SD">M</span><span class="sdParams">TRTE_SEG;UOM_DIST_VER_LOWER_OVRDE;9</span>
    </td></tr>
    <tr><td>
      <span class="SD">093249N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;2</span>
      <span class="SD">1111053E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;2</span>
    </td></tr>
    <tr><td>
      <span class="SD">FL</span><span class="sdParams">TRTE_SEG;UOM_DIST_VER_LOWER;8</span>
      <span class="SD">125</span><span class="sdParams">TRTE_SEG;VAL_DIST_VER_LOWER;8</span>
    </td></tr>
    <tr><td>
      <span class="SD">100000N</span><span class="sdParams">TDESIGNATED_POINT;GEO_LAT;3</span>
      <span class="SD">1120000E</span><span class="sdParams">TDESIGNATED_POINT;GEO_LONG;3</span>
    </td></tr>
    `;
    const route = vn.parseRoutes(html)[0];
    expect(route?.alts).toEqual(["2600m", "FL125"]);
  });

  it("parses waypoint and navaid", () => {
    const wpt = vn.parseWaypoints(WPT);
    expect(wpt).toEqual([{ id: "ADBOP", lat: 8.5, lon: 104.08333 }]);
    const nav = vn.parseNavaids(NAV);
    expect(nav[0]?.id).toBe("BMT");
    expect(nav[0]?.kind).toBe("DVOR/DME");
    expect(nav[0]?.lat).toBeCloseTo(12.66639, 3);
  });

  it("parses airport name and ARP", () => {
    const rows = vn.parseAirports(AD);
    expect(rows).toEqual([{ icao: "VVBM", name: "DAK LAK/BUON MA THUOT" }]);
    expect(vn.parseArp(ARP)).toEqual([12.66833, 108.11667]);
  });

  it("ARP row accepts mismatched table tags", () => {
    const html = `
    <tr><td>ARP coordinates and site at AD
      <span class="SD">212408N</span><span class="sdParams">TNAVAID;GEO_LAT;2502</span>
      <span class="SD">1030002E</span><span class="sdParams">TAD_HP;GEO_LONG;1598</span>
    </td></tr>
    `;
    expect(vn.parseArp(html)).toEqual([21.40222, 103.00056]);
  });

  it("missing coordinates are skipped", () => {
    expect(vn.parseArp("<p>no coords</p>")).toBe(null);
    expect(
      vn.parseWaypoints(
        '<tr><td><span class="SD">ORPHAN</span><span class="sdParams">TDESIGNATED_POINT;CODE_ID;9</span></td></tr>',
      ),
    ).toEqual([]);
  });

  it("foreign route keeps waypoint name on the same point", () => {
    const routes: vn.ChartRoute[] = [{ name: "A1", pts: [[13.68583, 100.74889], [10.0, 100.0]] }];
    const waypoints: vn.ChartWaypoint[] = [{ id: "DONMU", lat: 13.68583, lon: 100.74889 }];
    const got = vn.withFixes(routes, waypoints);
    expect(got[0]?.fixes).toEqual(["DONMU", ""]);
    expect(routes[0]?.fixes).toBeUndefined();
  });

  it("foreign airport label uses IATA when known", () => {
    const rows = vn.tagIata(
      [{ icao: "RKSI", name: "INCHEON" }, { icao: "RPLA", name: "BAGABAG" }],
      { RKSI: "ICN" },
    );
    expect(rows[0]?.iata).toBe("ICN");
    expect(rows[1]?.iata).toBeUndefined();
  });
});
