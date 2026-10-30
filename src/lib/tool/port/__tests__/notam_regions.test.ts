import { describe, expect, it } from 'vitest';
import { iterLatLon, notamGeoms, parseAreas, supKeys } from '../notam_track';
import { idsInText, parseEnr53Text } from '../aip_jp';
import { parseKrEnrHtml } from '../aip_enr';

describe('uploaded NOTAM region regressions', () => {
  it('resolves KOCA RK R100 named restriction instead of an orange pin', () => {
    const table = parseKrEnrHtml('<table><tr><td><strong>RK R100 NAMHYONGJEDO</strong>344104N 1284327E - 344606N 1285031E - 344000N 1285100E</td></tr></table>');
    expect(table['RKR100']).toHaveLength(3);
    const geoms = notamGeoms({ text: 'RESTRICTED AREA RK R100 ACT', sup_geoms: [{ name: 'RKR-100', shape: 'polygon', ring: table['RKR100'], source: 'aip' }] });
    expect(geoms[0]?.shape).toBe('polygon');
    expect(geoms[0]?.name).toBe('RKR-100');
  });
  it('reads ZPKM hemisphere-first coordinates and 30KM balloon drift', () => {
    const text = 'ASCENT OF FREE BALLOON N290028E1013002 N290100E1013100 FLOATING DISTANCE:30KM';
    const geoms = notamGeoms({ text });
    expect(geoms).toHaveLength(2);
    expect(geoms[0]?.shape).toBe('circle');
    expect(geoms[0]?.radius_nm).toBeCloseTo(30 / 1.852, 6);
    expect(geoms[0]?.lat).toBeCloseTo(29 + 28 / 3600, 6);
  });
  it('reads spaced DMS rather than dropping the boundary', () => {
    expect(iterLatLon('29 00 28N 101 30 02E')[0]).toEqual([29 + 28 / 3600, 101 + 30 / 60 + 2 / 3600]);
  });
  it('keeps A3664 four corners near 3 degrees without spurious 30 degree matches', () => {
    const pts = iterLatLon('023251.51N 1014117.75E-030000.80N 1022909.15E-024417.79N 1023256.63E-021956.93N 1021626.04E');
    expect(pts).toHaveLength(4);
    expect(pts[1]?.[0]).toBeCloseTo(3 + 0.8 / 3600, 6);
  });
  it('reads D0996 missing zero in longitude minutes', () => {
    const pts = iterLatLon('055347.03N 116226.71E');
    expect(pts).toHaveLength(1);
    expect(pts[0]?.[1]).toBeCloseTo(116 + 2 / 60 + 26.71 / 3600, 6);
  });
  it('draws A0567 four 21KM site circles, never one joined polygon', () => {
    const geoms = notamGeoms({ text: 'UAV ACT WI RAD 21KM ON THE FLW COORDS:\n1. 050119N1150328E\n2. 050111N1150401E\n3. 050216N1150617E\n4. 045651N1150713E' });
    expect(geoms).toHaveLength(4);
    expect(geoms.map(g => g.shape)).toEqual(['circle', 'circle', 'circle', 'circle']);
    expect(geoms[3]?.radius_nm).toBeCloseTo(21 / 1.852, 6);
  });
  it('preserves P3999 deployment points and their names, not a polygon', () => {
    const geoms = parseAreas('(1)NAHA-SHI : 261219N1273929E\n(2)MIYAKOJIMA : 244602N1251930E\n(3)ISHIGAKIJIMA : 242404N1241121E\n(4)YONAGUNIJIMA : 242638N1225716E');
    expect(geoms.map(g => g.name)).toEqual(['NAHA-SHI', 'MIYAKOJIMA', 'ISHIGAKIJIMA', 'YONAGUNIJIMA']);
    expect(geoms.every(g => g.shape === 'dot' && g.source === 'e-field')).toBe(true);
  });
  it('keeps two PLACE boundaries separate', () => {
    const geoms = parseAreas('(1)PLACE:BOUNDED BY FLW POINTS 250000N1270000E-250000N1280000E-240000N1280000E\n(2)PLACE:BOUNDED BY FLW POINTS 230000N1270000E-230000N1280000E-220000N1280000E');
    expect(geoms.map(g => g.name)).toEqual(['PLACE 1', 'PLACE 2']);
    expect(geoms.map(g => g.ring.length)).toEqual([3, 3]);
  });
  it('U3550 describes a line, not a generic orange pin', () => {
    const geoms = notamGeoms({ text: 'AREA: 70M EITHER SIDE OF A LINE 360145N1385533E - 360148N1385553E' });
    expect(geoms[0]?.shape).toBe('line');
    expect(geoms[0]?.ring).toHaveLength(2);
  });
  it('R1750 uses its releasing point instead of unknown Q-line pin', () => {
    const geoms = notamGeoms({ text: 'ASCENT OF FREE BALLOON RELEASING POINT: 361555N1391206E', coords: '3600N13900E' });
    expect(geoms[0]?.source).toBe('e-field');
    expect(geoms[0]?.lat).toBeCloseTo(36 + 15 / 60 + 55 / 3600, 6);
  });
  it('generic minor arc uses 50NM and excludes the construction center', () => {
    const geoms = notamGeoms({ text: 'AREA BOUNDED BY FLW POINTS 252745N1280336E - 242247N1271822E - 242755N1270543E - 252234N1274335E - 252745N1280336E, THE LINE CONNECTING 252234N1274335E TO 252745N1280336E IS THE MINOR ARC WITH A RADIUS OF 50NM FM 261230N1273834E.' });
    expect(geoms).toHaveLength(1);
    expect(geoms[0]?.ring.length).toBeGreaterThan(4);
    expect(geoms[0]?.ring.every(p => p[0] < 26)).toBe(true);
  });
  it('normalizes SUP leading zero for bundled lookup', () => {
    expect(supKeys('REF AIP SUP 052/26')).toEqual(['52/26']);
  });
});

describe('Japanese ENR 5.3 original fixture', () => {
  const text = `Kyushu Area (KS)
4-8-20 The airspace bounded by straight lines
(1) 313612N/1314014E (2) 312722N/1314740E (3) 312457N/1313512E (4) 313501N/1313406E
2000--------SFC
4-8-35 3500--------2000
5-1-30 The airspace bounded by straight lines
(1) 323705N/1303700E (2) 323704N/1303200E (3) 323209N/1302756E (4) 323118N/1303142E
3000--------1500
5-1-50 5000--------3000`;
  it('shares the published boundary across vertical layers', () => {
    const rings = parseEnr53Text(text);
    expect(rings['KS5-1-30']).toHaveLength(4);
    expect(rings['KS5-1-50']).toEqual(rings['KS5-1-30']);
    expect(rings['KS5-1-30']?.[0]?.[0]).toBeCloseTo(32 + 37 / 60 + 5 / 3600, 6);
  });
  it('matches named references without accidentally matching a longer area ID', () => {
    const rings = parseEnr53Text(text);
    expect(idsInText(rings, 'CIVIL TRAINING AREA KS5-1-30 AND KS5-1-50 REF AIP ENR5.3')).toEqual(['KS5-1-30', 'KS5-1-50']);
    expect(idsInText(rings, 'KS5-1-300')).toEqual([]);
  });
  it('matches Japanese W-181 and RJW-181 to the same published boundary', () => {
    // Synthetic fixture only: these vertices are not production W-181 coordinates.
    const table = { 'W-181': [[30, 130], [30, 131], [31, 131]] as [number, number][] };
    expect(idsInText(table, 'WARNING AREA RJW-181 (GOLF GOLF)')).toEqual(['W-181']);
    expect(idsInText(table, 'WARNING AREA W-181 ACT REF AIP P51-1')).toEqual(['W-181']);
    expect(idsInText(table, 'W-1810 ACT')).toEqual([]);
  });
  it('resolved ENR references replace Q-line fallback', () => {
    const ring = parseEnr53Text(text)['KS5-1-30'];
    expect(ring).toBeDefined();
    const geoms = notamGeoms({ text: 'KS5-1-30 ACT REF AIP ENR5.3', coords: '3234N13033E', sup_geoms: [{ name: 'KS5-1-30', shape: 'polygon', ring, source: 'aip' }] });
    expect(geoms[0]?.shape).toBe('polygon');
    expect(geoms.some(g => g.source === 'pin')).toBe(false);
  });
});