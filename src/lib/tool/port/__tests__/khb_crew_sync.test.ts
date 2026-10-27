import { describe, expect, it } from 'vitest';
import { crewChangeMatches, patchKhbCrewSyncPage } from '../khb_crew_sync';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('VJ642 current FliteBrief crew', () => {
  const crew = [{username: 'VJC15399', job: {name: 'Captain'}}, {username: 'VJC7390', job: {name: 'First Officer'}}];
  it('already updated CPT 15399 is green without another write', () => {
    expect(crewChangeMatches(crew, 'Captain', '0859 SARNO SEMEN SOLINAP', '15399 ACHMAD PRAHERDI')).toBe(true);
  });
  it('already updated FO 7390 is green separately', () => {
    expect(crewChangeMatches(crew, 'First Officer', '1234 OLD PILOT', '7390 PHAN TIEN DAT')).toBe(true);
  });
  it('old pilot still present is not complete', () => {
    expect(crewChangeMatches([...crew, {username: 'VJC0859', job: {name: 'Captain'}}], 'Captain', '0859 OLD', '15399 NEW')).toBe(false);
  });
  it('wrong role or deadheading does not acknowledge CPT', () => {
    expect(crewChangeMatches(crew, 'First Officer', '0859 OLD', '15399 NEW')).toBe(false);
    expect(crewChangeMatches([{...crew[0], deadheading: true}], 'Captain', '0859 OLD', '15399 NEW')).toBe(false);
  });
});

describe('KHB lightning actions', () => {
  const html = patchKhbCrewSyncPage(readFileSync('src/tool/page.html', 'utf8'));
  const start = html.indexOf('async function ftBoltClick(');
  const script = html.slice(start, html.indexOf('function ftMarkChg(', start));
  async function click(already: boolean){
    const urls: string[] = [];
    const c = {from: '0859 OLD', to: '15399 ACHMAD PRAHERDI', bolt: {textContent: ''}, done: false};
    const context = {ftChgOk: () => false, ftBoltPaint: () => {}, ftFbSync: () => {}, alert: () => {}, confirm: () => false,
      URLSearchParams, fetch: async (url: string) => {
        urls.push(url);
        return {json: async () => url === '/api/version/fbreg'
          ? {items: [{found: true, sector_id: 6422707, crew_checked: true, crew_changes: [{ok: already}]}]}
          : {remove: [{username: 'VJC0859'}], add: [{username: 'VJC15399'}]}};
      }};
    await runInNewContext(script + ';ftBoltClick({id:300,flt:"642",dep:"SGN",arr:"DAD"},{date:"27/10/26"},"cptText",change)', {...context, change: c});
    return {urls, c};
  }
  it('resolves spreadsheet row 300 to the true FliteBrief sector before preview', async () => {
    const {urls} = await click(false);
    expect(new URL(urls[1] ?? '', 'https://test.local').searchParams.get('sector_id')).toBe('6422707');
  });
  it('crew already updated turns green without preview or writing', async () => {
    const {urls, c} = await click(true);
    expect(urls).toEqual(['/api/version/fbreg']);
    expect(c.done).toBe(true);
  });
});