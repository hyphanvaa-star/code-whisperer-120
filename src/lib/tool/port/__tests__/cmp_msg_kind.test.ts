import { describe, expect, it } from 'vitest';
import { cmpCrewDelayMin, cmpDelayKind, cmpMsgKind, cmpRegMemFind, cmpRegMemory, patchCmpSyncPage } from '../cmp_sync';

describe('Compare ATC message keeps CHG DLA after the corrected CFP is pushed', () => {
  it('DLA plus an aircraft change is CHG DLA', () => {
    expect(cmpMsgKind('DLA', true)).toBe('CHG DLA');
    expect(cmpMsgKind('DLA', false)).toBe('DLA');
    expect(cmpMsgKind('', true)).toBe('CHG A/C');
  });
  it('live change is remembered while Crewlist differs from FliteBrief', () => {
    expect(cmpRegMemory(null, { changed: true, old: 'VN-A512', new: 'VN-A523' }, { verdict: 'x', excel: 'VN-A523' }))
      .toEqual({ old: 'VN-A512', new: 'VN-A523' });
  });
  it('VJC820: FliteBrief now on VN-A523 like the Crewlist → change still remembered', () => {
    const prev = { old: 'VN-A512', new: 'VN-A523' };
    const mem = cmpRegMemory(prev, { changed: false }, { verdict: 'x', excel: 'VN-A523' });
    expect(mem).toEqual(prev);
    expect(cmpMsgKind('DLA', !!mem)).toBe('CHG DLA');
  });
  it('Crewlist moves to another aircraft → old memory dropped', () => {
    expect(cmpRegMemory({ old: 'VN-A512', new: 'VN-A523' }, { changed: false }, { verdict: 'x', excel: 'VN-A512' })).toBeNull();
  });
  it('compare data not loaded yet → memory kept', () => {
    const prev = { old: 'VN-A512', new: 'VN-A523' };
    expect(cmpRegMemory(prev, null, null)).toEqual(prev);
  });
  it('page shim inlines the helpers', () => {
    const html = patchCmpSyncPage('<head></head><script>function renderCompareTable(d, opts){}</script>');
    expect(html).toContain('const cmpMsgKind = ');
    expect(html).toContain('const cmpRegMemory = ');
  });
});

describe('VJ849: aircraft change + delay keeps CHG DLA', () => {
  it('Crewlist STD 07:50 → ETD 09:10 counts as DLA without an FPL diff', () => {
    expect(cmpCrewDelayMin('07:50', '09:10')).toBe(80);
    expect(cmpDelayKind('', null, '07:50', '09:10')).toBe('DLA');
    expect(cmpMsgKind(cmpDelayKind('', null, '07:50', '09:10'), true)).toBe('CHG DLA');
  });
  it('delay under 15 min, missing ETD or earlier ETD is not DLA', () => {
    expect(cmpDelayKind('', null, '07:50', '08:00')).toBe('');
    expect(cmpDelayKind('', null, '07:50', '')).toBe('');
    expect(cmpDelayKind('', null, '07:50', '07:20')).toBe('');
  });
  it('delay past midnight counts', () => {
    expect(cmpCrewDelayMin('23:30', '00:30')).toBe(60);
  });
  it('Crewlist diff delay row counts; FPL diff kind wins', () => {
    expect(cmpDelayKind('', { changed: true }, '', '')).toBe('DLA');
    expect(cmpDelayKind('CHG', null, '07:50', '09:10')).toBe('CHG');
  });
  it('remembered aircraft change survives the STD moving 00:50Z → 02:10Z', () => {
    const mem = { old: 'VN-A512', new: 'VN-A200' };
    const store = { [JSON.stringify([64200, 'VJC849', '2026-11-23T00:50:00Z'])]: mem };
    expect(cmpRegMemFind(store, 64200, 'VJC849', '2026-11-23T02:10:00Z')?.value).toEqual(mem);
    const fresh = { [JSON.stringify([64200, 'VJC849'])]: mem };
    expect(cmpRegMemFind(fresh, 64200, 'VJC849', '2026-11-23T02:10:00Z')?.value).toEqual(mem);
  });
  it('another sector or another day never reuses the memory', () => {
    const store = { [JSON.stringify([64200, 'VJC849', '2026-11-22T00:50:00Z'])]: { old: 'A', new: 'B' } };
    expect(cmpRegMemFind(store, 64201, 'VJC849', '2026-11-22T00:50:00Z')).toBeNull();
    expect(cmpRegMemFind(store, 64200, 'VJC849', '2026-11-24T02:10:00Z')).toBeNull();
  });
});
