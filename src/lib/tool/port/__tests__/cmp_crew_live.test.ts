import { describe, expect, it } from 'vitest';
import { cmpCellCrewChanges, cmpPilotChanges } from '../cmp_sync';
import { ofpCrew } from '../fpl_tool';

describe('Compare crew swap from live mismatch', () => {
  it('VJ154: CP+ 11332 replaces FliteBrief-only 9515', () => {
    const excel = '-BUI ANH KHOA(CP+) 11332; -YIN KOK JING(FO) 9727';
    const detail = 'Excel có mà FliteBrief không: 11332 · FliteBrief có mà Excel không: 9515';
    expect(cmpCellCrewChanges(excel, detail)).toEqual([{ key: 'cptText', from: '9515', to: '11332' }]);
  });
  it('CP and CP+ count as captain in Crewlist diffs', () => {
    expect(cmpPilotChanges('(CP) 1234; (FO) 5678', '(CP+) 4321; (FO) 5678')).toEqual([{ key: 'cptText', from: '1234', to: '4321' }]);
  });
  it('reads OFP crew line', () => {
    expect(ofpCrew('CAPT 13330 KONOVALO   FO 13054 LE ANH DISPATCHER PHAN THANH HY')).toEqual([
      { role: 'CAPT', id: '13330', name: 'KONOVALO' }, { role: 'FO', id: '13054', name: 'LE ANH' }]);
    expect(ofpCrew('CAPT 6065 GASSER AH FO 8763 IVAN LLODISPATCHER NGUYEN VAN A').map(p => p.name)).toEqual(['GASSER AH', 'IVAN LLO']);
  });
});

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { patchCmpSyncPage } from '../cmp_sync';

describe('live FliteBrief vs Crewlist aircraft mismatch', () => {
  const html = patchCmpSyncPage(readFileSync('src/tool/page.html', 'utf8'));
  const start = html.indexOf('function cmpLiveChange(');
  const src = html.slice(start, html.indexOf('function cmpSyncEvidence(', start));
  const run = (r: unknown) => {
    const ctx = vm.createContext({ cmpCellCrewChanges, xls: { file: 'AIMS.xlsx' }, cmpBind: {},
      cmpActionFlight: () => ({ id: 154, std: '2026-11-11T11:45:00Z' }), r });
    vm.runInContext(src, ctx);
    return vm.runInContext('cmpLiveChange(r)', ctx);
  };
  it('Crewlist VN-A668 vs FliteBrief VN-A528 needs an aircraft change without a second Crewlist', () => {
    const live = run({ sector_id: 154, reg_cmp: { verdict: 'lệch', same: false, excel: 'VN-A668', flite: 'VN-A528' } });
    expect(live.reg).toEqual({ changed: true, old: 'VN-A528', new: 'VN-A668' });
  });
  it('matching aircraft and crew raise nothing', () => {
    expect(run({ sector_id: 154, reg_cmp: { verdict: 'khớp', same: true, excel: 'VN-A668', flite: 'VN-A668' } })).toBeNull();
  });
});

describe('crew swap button without a usable Crewlist version diff', () => {
  const html = patchCmpSyncPage(readFileSync('src/tool/page.html', 'utf8'));
  const start = html.indexOf('function cmpLiveChange(');
  const src = html.slice(start, html.indexOf('function cmpSyncKey(', start));
  const vj154 = { sector_id: 154, crew: { verdict: 'FALSE 1', same: false,
    excel: '-BUI ANH KHOA(CP+) 11332; -YIN KOK JING(FO) 9727', flite: 'TRINH TRUNG CHUNG; YIN KOK JING',
    detail: 'Excel có mà FliteBrief không: 11332 · FliteBrief có mà Excel không: 9515' } };
  const run = (sources: unknown, versionRow: unknown = null) => {
    const ctx = vm.createContext({ cmpCellCrewChanges, cmpPilotChanges, xls: { file: 'AIMS 1111-1211 16h01.xlsx' }, cmpBind: {},
      cmpSyncSources: sources, cmpSourceChange: () => versionRow, cmpAircraftChange: () => false,
      cmpActionFlight: () => ({ id: 154, std: '2026-11-11T11:45:00Z' }), r: vj154 });
    vm.runInContext(src, ctx);
    return vm.runInContext('cmpSyncEvidence(r, "crew")', ctx);
  };
  it('VJ154 offers 9515 → 11332 before the version diff has loaded', () => {
    expect(run({ stamp: '', crew: [], fpl: [] })?.changes).toEqual([{ key: 'cptText', from: '9515', to: '11332' }]);
  });
  it('VJ154 offers the live swap even when the version diff only saw an FO change', () => {
    const row = { crew: { changed: true, raw_old: '(CP+) 11332; (FO) 1111', raw_new: '(CP+) 11332; (FO) 9727' } };
    const e = run({ stamp: 'x', current: 'AIMS 1111-1211 16h01.xlsx', crew: [], fpl: [] }, row);
    expect(e?.changes).toEqual([{ key: 'cptText', from: '9515', to: '11332' }]);
  });
});
