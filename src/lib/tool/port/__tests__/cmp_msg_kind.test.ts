import { describe, expect, it } from 'vitest';
import { cmpMsgKind, cmpRegMemory, patchCmpSyncPage } from '../cmp_sync';

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
