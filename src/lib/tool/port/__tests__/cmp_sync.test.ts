import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cmpAircraftChange, cmpFplPair, cmpPilotChanges, cmpSourceChange, patchCmpSyncPage } from '../cmp_sync';

describe('Compare source changes', () => {
  const now = Date.parse('2026-11-02T08:53:00Z');
  it('sends VER 09/10 through the Compare diff flow and preserves Crewlist order', async () => {
    const files = [
      {name:'FLIGHT PLAN ON 02NOV - VER 01.xlsx',modified:300},
      {name:'crew-new.xlsx'},
      {name:'FLIGHT PLAN ON 02NOV - VER 10.xlsx',modified:200},
      {name:'FLIGHT PLAN ON 02NOV - VER 09.xlsx',modified:100},
      {name:'crew-old.xlsx'},
    ];
    const calls: string[] = [];
    const context = {
      cmpSyncSeq:0, cmpSyncSources:{stamp:''}, cmpSyncDiffJob:null, async cmpSyncCheckMany() {}, xls:{file:'crew-new.xlsx'}, lastCmp:{table:[]},
      cmpFplPair:(rows: typeof files) => cmpFplPair(rows,now), URLSearchParams,
      cmpSyncRepaint() {}, cmpSyncEvidence() {}, cmpSourceHeaders() {},
      fetch:async (url: string) => {
        calls.push(url);
        return {ok:true,json:async () => url === '/api/version/files' ? {files} : {rows:[]}};
      },
    };
    const html = patchCmpSyncPage('function renderCompareTable(d, opts){');
    const start = html.indexOf('async function cmpReadSyncSources()');
    const end = html.indexOf('setInterval(',start);
    vm.createContext(context);
    await vm.runInContext(html.slice(start,end) + '\ncmpReadSyncSources()',context);
    const pairs = calls.filter(url => url.startsWith('/api/version/diff?')).map(url => {
      const params = new URLSearchParams(url.split('?')[1]);
      return [params.get('old'),params.get('new')];
    });
    expect(pairs).toEqual([
      ['crew-old.xlsx','crew-new.xlsx'],
      ['FLIGHT PLAN ON 02NOV - VER 09.xlsx','FLIGHT PLAN ON 02NOV - VER 10.xlsx'],
    ]);
    expect(vm.runInContext('cmpSyncSources.fplFile',context)).toBe('FLIGHT PLAN ON 02NOV - VER 10.xlsx');
    expect(vm.runInContext('cmpSyncSources.fplOld',context)).toBe('FLIGHT PLAN ON 02NOV - VER 09.xlsx');
  });
  it('uses VER 10 versus VER 09 even when VER 01 is uploaded last', () => {
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 09.xlsx',modified:100};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 10.xlsx',modified:200};
    const lateUpload = {name:'FLIGHT PLAN ON 02NOV - VER 01.xlsx',modified:300};
    expect(cmpFplPair([lateUpload,latest,old],now)).toEqual([old,latest]);
  });
  it('does not compare revisions from different flight dates', () => {
    const yesterday = {name:'FLIGHT PLAN ON 01NOV - VER 20.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 02.xlsx'};
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 01.xlsx'};
    expect(cmpFplPair([yesterday,old,latest],now)).toEqual([old,latest]);
    expect(cmpFplPair([yesterday,latest],now)).toEqual([]);
  });
  it('skips duplicate copies of the same VER', () => {
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 09.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 10.xlsx',modified:20};
    expect(cmpFplPair([{...latest,modified:10},latest,old],now)).toEqual([old,latest]);
  });
  it('keeps January newer than December at the year boundary', () => {
    const old = {name:'FLIGHT PLAN ON 01JAN - VER 01.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 01JAN - VER 02.xlsx'};
    expect(cmpFplPair([{name:'FLIGHT PLAN ON 31DEC - VER 25.xlsx'},latest,old],Date.parse('2027-01-01T08:00:00Z'))).toEqual([old,latest]);
  });
  const row = {sector_id:64200,fb_std:'2026-10-29T08:00:00Z',reg:{changed:true,old:'VN-A648',new:'VN-A657'}};
  it('enables only actual old-to-new aircraft changes', () => {
    expect(cmpAircraftChange(row.reg)).toBe(true);
    expect(cmpAircraftChange({...row.reg,old:'VNA657'})).toBe(false);
    expect(cmpAircraftChange({...row.reg,changed:false})).toBe(false);
  });
  it('requires the exact sector and date, never a Crewlist row ID', () => {
    expect(cmpSourceChange([row],64200,row.fb_std)).toEqual(row);
    expect(cmpSourceChange([row],300,row.fb_std)).toBeNull();
    expect(cmpSourceChange([row],64200,'2026-10-28T08:00:00Z')).toBeNull();
    expect(cmpSourceChange([row,row],64200,row.fb_std)).toBeNull();
  });
  it('swaps identifiable changed pilots only and retains unchanged FO', () => {
    expect(cmpPilotChanges('(CPT) 1234; (FO) 5678','(CPT) 4321; (FO) 5678')).toEqual([{key:'cptText',from:'1234',to:'4321'}]);
    expect(cmpPilotChanges('(CPT) 1234','(DHD CPT) 4321')).toEqual([]);
    expect(cmpPilotChanges('unknown','unknown')).toEqual([]);
    expect(cmpPilotChanges('(CPT) 1234','(CPT) 4321; (CPT) 5555; (CPT) 6666')).toEqual([]);
  });
  it('hover tooltip shows the compared FPL versions and Crewlist file', () => {
    const html = patchCmpSyncPage(readFileSync('src/tool/page.html', 'utf8'));
    expect(html).toContain(': "FPL VER " + n + " — đã xem") + (typeof cmpVerDetail === "function" ? cmpVerDetail() : "");');
    expect(html).toContain('bar.title = tip || "File Crewlist Aims đang dùng để đối chiếu";\n    if(typeof cmpVerTipPaint === "function") cmpVerTipPaint();');
    const start = html.indexOf('function cmpVerDetail()');
    const end = html.indexOf('async function cmpVerOpen()');
    const pick = (sel: string) => sel === '#vOld' ? {value:'FLIGHT PLAN ON 02NOV - VER 09.xlsx'} : sel === '#vNew' ? {value:'FLIGHT PLAN ON 02NOV - VER 10.xlsx'} : null;
    const context = {xls:{file:'hyd.xlsx'}, $: pick};
    vm.createContext(context);
    vm.runInContext(html.slice(start,end), context);
    const tip = vm.runInContext('cmpVerDetail()', context) as string;
    expect(tip).toContain('FPL FLIGHT PLAN ON 02NOV - VER 09.xlsx → FLIGHT PLAN ON 02NOV - VER 10.xlsx');
    expect(tip).toContain('Crewlist: hyd.xlsx');
    const noFiles = {xls:null, $:() => null};
    vm.createContext(noFiles);
    vm.runInContext(html.slice(start,end), noFiles);
    expect(vm.runInContext('cmpVerDetail()', noFiles)).toBe('');
  });
});
import { cmpSourceChange as pickDelayed } from '../cmp_sync';
describe('Compare change after delay', () => {
  const rows = [{ sector_id: 77, fb_std: '2026-11-09T15:25:00Z', reg: { changed: true, old: 'VN-A675', new: 'VN-A676' } }];
  it('keeps the change when FliteBrief STD moved by a delay', () => {
    expect(pickDelayed(rows, 77, '2026-11-09T16:40:00Z')).toBe(rows[0]);
  });
  it('rejects a sector more than 24 h away', () => {
    expect(pickDelayed(rows, 77, '2026-11-11T16:40:00Z')).toBeNull();
  });
});
