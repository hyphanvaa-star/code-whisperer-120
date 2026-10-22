import { describe, expect, it } from 'vitest';
import { jmaCode, jmaStorm, jtwcStorms, mergeStorms } from '../storms';

describe('storm source parsing', () => {
  it('retains Champi 29W from RSS without a KMZ', () => {
    const storms = jtwcStorms('<description><![CDATA[<b>Typhoon 29W (Champi) Warning #31</b>]]></description>');
    expect(storms).toEqual([{ name: 'Champi', id: '29W', label: 'Champi (29W)', source: 'JTWC' }]);
  });
  it('deduplicates repeated warnings and includes other basins', () => {
    expect(jtwcStorms('Typhoon 29W (Champi) Warning #31 Typhoon 29W (Champi) Warning #31 Tropical Storm 22E (Vance) Warning #2').map(s => s.id)).toEqual(['29W', '22E']);
  });
  it('does not treat basin descriptions without warnings as storms', () => {
    expect(jtwcStorms('No tropical cyclone warnings')).toEqual([]);
  });
  it('uses the actual JMA tropicalCyclone identifier', () => {
    expect(jmaCode({ tropicalCyclone: 'TC2636', typhoonNumber: '2630' })).toBe('TC2636');
    expect(jmaCode({ tropicalCyclone: '../private' })).toBe('');
  });
  it('reads modern analysis/forecast centers, UTC, and metre radii', () => {
    const result = jmaStorm([
      { part: 'title', name: { en: 'Champi' }, typhoonNumber: '2630' },
      { part: { en: 'Analysis' }, center: [20.8, 125.4], validtime: { UTC: '2026-10-22T06:00:00Z' } },
      { part: { en: 'Forecast for 12 hours ahead' }, center: [21.9, 124.4], validtime: { UTC: '2026-10-22T18:00:00Z' }, probabilityCircle: { radius: 46300 } },
    ]);
    expect(result.storm.label).toBe('Champi (2630)');
    expect(result.features[0]?.geometry.coordinates).toEqual([[125.4, 20.8], [124.4, 21.9]]);
    expect(result.features[1]?.properties.label).toBe('22/06Z');
    expect(result.features.find(f => f.geometry.type === 'Polygon')).toBeTruthy();
    expect(result.features.some(f => f.properties.radiusM)).toBe(false);
  });
  it('preserves legacy coordinate records', () => {
    expect(jmaStorm([{ part: 'track', coord: { center: [10, 120] }, time: '2026-10-22T00:00:00Z' }]).features[0]?.geometry.coordinates).toEqual([120, 10]);
  });
  it('rejects invalid coordinates instead of drawing a false center', () => {
    expect(jmaStorm([{ center: [null, 120] }, { center: [100, 120] }]).features).toEqual([]);
  });
  it('keeps the JTWC identifier when JMA supplies geometry for the same name', () => {
    expect(mergeStorms(jtwcStorms('Typhoon 29W (Champi) Warning #31'), [jmaStorm([{ part: 'title', name: { en: 'Champi' }, typhoonNumber: '2630' }]).storm])).toHaveLength(1);
    expect(mergeStorms(jtwcStorms('Typhoon 29W (Champi) Warning #31'), [jmaStorm([{ part: 'title', name: { en: 'Champi' } }]).storm])[0]?.id).toBe('29W');
  });
});