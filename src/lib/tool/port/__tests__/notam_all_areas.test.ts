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
  it('hides MINOR areas when the hide box is ticked', () => {
    const s = screen();
    s.toggle(true);
    s.context.nmPlotHits([s.impact]);
    expect(s.plotted().map(h => h.ident)).toEqual(['A1']);
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
});