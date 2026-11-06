import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { patchKhbCrewSyncPage } from '../khb_crew_sync';

const html = patchKhbCrewSyncPage(readFileSync('src/tool/page.html', 'utf8'));
const loadStart = html.indexOf('async function ftLoad(){');
const load = html.slice(loadStart, html.indexOf('/* Crewlist mới', loadStart));
const diffStart = html.indexOf('let ftCrewChanges = null');
const diff = html.slice(diffStart, html.indexOf('/* Nguồn thay đổi:', diffStart));

describe('KHB tab refresh without readable comparison history', () => {
  it('updates VJ362 to VN-A683 even when the history request fails', async () => {
    const old = {id: 575, flt: '362', date: '06/11/26', dep: 'SGN', arr: 'DLI', etd: '18:15', reg: 'VN-A580'};
    const state = {...old, extra: '20', pay: '20000'};
    const status = {textContent: ''};
    const paints: string[] = [];
    const context = {ftRows: [old], ftCatalog: [old], ftEdit: {'575': state}, ftAcDefects: [],
      FT_CHG_KEYS: [['reg','reg']], ftSt: () => state, ftFillIdent: (st: object, f: object) => Object.assign(st,f),
      $: () => status, ftRender: () => paints.push(state.reg), ftKeepLater: () => {},
      ftLoadRoutes: async () => {}, ftRefreshAutoRoute: () => {}, URLSearchParams,
      fetch: async (url: string) => ({ok: url !== '/api/version/files', json: async () =>
        url === '/api/fpltext' ? {source: 'hy3.xlsx', flights: [{...old, reg: 'VN-A683'}]} :
        url === '/api/version/files' ? {error: 'History unavailable'} : {aircraft: []}})};
    await runInNewContext(diff + load + ';ftLoad()', context);
    expect(state.reg).toBe('VN-A683');
    expect(paints).toContain('VN-A683');
    expect(state.extra).toBe('20');
    expect(state.pay).toBe('20000');
  });
});