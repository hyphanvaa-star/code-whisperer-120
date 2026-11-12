import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function screen() {
  const impact = { ident: 'A1', icao: 'RPHI', shape: 'polygon', ring: [[1, 2], [2, 3], [3, 1]] };
  const dropped = { ident: 'B2', icao: 'RPHI', shape: 'circle', lat: 14, lon: 121, radius_nm: 2 };
  const unresolved = { ident: 'C3', icao: 'RPHI', shape: 'dot', lat: 14, lon: 121 };
  let plotted: unknown[] = [], overlay: unknown, change: (event: {layer: unknown}) => void = () => {};
  let on = false, redraws = 0;
  const pack = { hits: [impact, dropped, unresolved], places: [{kind:'FIR',code:'RPHI', dropped: [{ ident: 'B2', level: 'NO IMPACT' }] }] };
  const original = JSON.stringify(pack);
  const map = { hasLayer: () => on, on: (_events: string, fn: typeof change) => { change = fn; } };
  const context = {
    nmRefreshHitGeom: (h: unknown) => h,
    nmFindHit: (_ident: string): {shape: string} | null => null,
    nmPlotHits: (hits: unknown[]) => { plotted = hits; },
    nmParseRadiusNm: () => 0,
    nmEnsureMap: () => map,
    nmMap: map,
    nmLayerCtl: { addOverlay: (layer: unknown) => { overlay = layer; } },
    L: { layerGroup: () => ({}) },
    nmMapIsTrack: () => true,
    nmTrackData: pack,
    nmGeomKey: (h: {ident: string}) => h.ident,
    nmDrawTrack: () => { redraws++; },
    nmHitsOf: () => [impact],
    nmFleetHits: () => [],
    nmShowNotam: (_icao: string, _ident: string, _flightId: string) => {},
    nmGroup: 'track', NM_GROUP_TRACK: 'track', NM_GROUP_ALL: 'all',
    nmData: null,
    window: {nmGrpPlace:'',nmGrpSel:'impact'},
  };
  runInNewContext(readFileSync('src/tool/notam-geometry.js', 'utf8'), context);
  context.nmEnsureMap();
  return { context, impact, pack, original, plotted: () => plotted as {ident: string}[],
    toggle: (value: boolean) => { on = value; change({layer: overlay}); }, redraws: () => redraws };
}

describe('all NOTAM areas map layer', () => {
  it('opens the NO IMPACT group and resolves its hidden published circle on click', () => {
    const s = screen();
    s.context.nmShowNotam('RPHI', 'B2', '');
    expect(s.context.window.nmGrpSel).toBe('noimpact');
    expect(s.context.window.nmGrpPlace).toBe('FIR:RPHI');
    expect(s.context.nmFindHit('B2')?.shape).toBe('circle');
  });
  it('keeps MINOR areas within 50 NM of the route and hides farther ones when ticked', () => {
    const s = screen();
    // Route along the equator from lon 100 to lon 101 (≈60 NM).
    (s.pack as Record<string, unknown>).track = [{ lat: 0, lon: 100 }, { lat: 0, lon: 101 }];
    const nearMinor = { ident: 'M1', icao: 'RPHI', kind: 'FIR', shape: 'circle', lat: 0.5, lon: 100.5, radius_nm: 5 }; // ~25 NM
    const farMinor = { ident: 'M2', icao: 'RPHI', kind: 'FIR', shape: 'circle', lat: 3, lon: 100.5, radius_nm: 5 };   // ~175 NM
    (s.pack as {hits: unknown[]}).hits = [nearMinor, farMinor];
    s.toggle(true);
    s.context.nmPlotHits([]);
    expect(s.plotted().map(h => h.ident)).toEqual(['M1']);
  });
  it('shows excluded boundaries by default, without duplicate shapes or changing assessment', () => {
    const s = screen();
    s.toggle(false);
    s.context.nmPlotHits([s.impact]);
    expect(s.plotted().map(h => h.ident)).toEqual(['A1', 'B2']);
    expect(JSON.stringify(s.pack)).toBe(s.original);
    expect(s.redraws()).toBe(1);
  });
  it('shows MINOR areas again when the hide box is unticked', () => {
    const s = screen();
    s.toggle(true);
    s.toggle(false);
    s.context.nmPlotHits([s.impact]);
    expect(s.plotted().map(h => h.ident)).toEqual(['A1', 'B2']);
    expect(s.redraws()).toBe(2);
  });
  it('hides dots and areas more than 50 NM from the route when the hide box is ticked', () => {
    const s = screen();
    // Route along the equator from lon 100 to lon 101 (≈60 NM).
    (s.pack as Record<string, unknown>).track = [{ lat: 0, lon: 100 }, { lat: 0, lon: 101 }];
    s.toggle(true);
    const near = { ident: 'N1', kind: 'FIR', shape: 'dot', lat: 0.5, lon: 100.5 };      // 30 NM
    const far = { ident: 'F1', kind: 'FIR', shape: 'dot', lat: 5, lon: 100.5 };         // 300 NM
    const farPoly = { ident: 'F2', kind: 'FIR', shape: 'polygon', ring: [[3, 100], [3, 101], [4, 101]] };
    const crossPoly = { ident: 'X1', kind: 'FIR', shape: 'polygon', ring: [[-2, 100.4], [2, 100.4], [2, 100.6], [-2, 100.6]] };
    const farCircle = { ident: 'F3', kind: 'FIR', shape: 'circle', lat: 2, lon: 100.5, radius_nm: 20 }; // 100 NM
    const bigCircle = { ident: 'C1', kind: 'FIR', shape: 'circle', lat: 2, lon: 100.5, radius_nm: 90 }; // edge 30 NM
    const airport = { ident: 'A9', kind: 'A', shape: 'dot', lat: 10, lon: 120 };
    s.context.nmPlotHits([near, far, farPoly, crossPoly, farCircle, bigCircle, airport]);
    expect(s.plotted().map(h => h.ident)).toEqual(['N1', 'X1', 'C1', 'A9']);
  });
  it('still draws a single focused NOTAM even when it is far from the route', () => {
    const s = screen();
    (s.pack as Record<string, unknown>).track = [{ lat: 0, lon: 100 }, { lat: 0, lon: 101 }];
    s.toggle(true);
    s.context.nmPlotHits([{ ident: 'F1', kind: 'FIR', shape: 'dot', lat: 5, lon: 100.5 }]);
    expect(s.plotted().map(h => h.ident)).toEqual(['F1']);
  });
  it('keeps every area when ticked but the route has no coordinates', () => {
    const s = screen();
    s.toggle(true);
    s.context.nmPlotHits([{ ident: 'F1', kind: 'FIR', shape: 'dot', lat: 5, lon: 100.5 }, s.impact]);
    expect(s.plotted().map(h => h.ident)).toEqual(['F1', 'A1', 'B2']);
  });
});
