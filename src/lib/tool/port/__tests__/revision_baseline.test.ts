import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cmpCrewPair, operatingDays, revisionBaseline } from '../revision_baseline';
import { cmpFplPair, patchCmpSyncPage } from '../cmp_sync';
import { patchKhbCrewSyncPage } from '../khb_crew_sync';
import { nCrew, nDelay, nReg, rowsForUi, type DiffResult, type Leg } from '../xlsdiff';

const file = (name: string, days: string[]) => ({name, operating_days: days});
const today = file('crew-new.xlsx', ['2026-11-25']);
const yesterday = file('crew-old.xlsx', ['2026-11-24']);
const leg = (day: string, reg = 'VN-A668', crew = '1234', etd: Leg['etd'] = null): Leg => ({
  rowNo: 1, flt: 'VJ849', digits: '849', dep: 'SGN', arr: 'DAD', day: new Date(day + 'T00:00:00Z'),
  std: {h: 10, m: 0}, etd, reg, crewRaw: '(CP) ' + crew, crew: new Set([crew]), dhd: new Set(),
});
const result = (old: Leg | null, next: Leg): DiffResult => ({oldFile: old ? 'old.xlsx' : '', newFile: 'new.xlsx',
  changes: [{flt: next.flt, dep: next.dep, arr: next.arr, old, new: next}], oldLegs: old ? 1 : 0,
  newLegs: 1, oldDays: [], newDays: [], warn: ''});

describe('same-day Crewlist baseline', () => {
  it('one file has no historical predecessor', () => expect(cmpCrewPair([today], today.name)).toEqual([]));
  it('never treats yesterday as the first file of today’s predecessor', () => expect(cmpCrewPair([today, yesterday], today.name)).toEqual([]));
  it('missing sheet dates never authorize a historical comparison', () => expect(cmpCrewPair([{name:'a.xlsx'}, {name:'b.xlsx'}], 'a.xlsx')).toEqual([]));
  it('picks the nearest older upload containing the same operating day', () => {
    const older = file('same-day.xlsx', ['2026-11-25']);
    expect(cmpCrewPair([today, yesterday, older], today.name)).toEqual([older, today]);
  });
  it('never pairs a different year or internal snapshot', () => {
    expect(cmpCrewPair([today, file('_crewprev_a.xlsx', today.operating_days), file('2025.xlsx', ['2025-11-25'])], today.name)).toEqual([]);
  });
  it('extracts full operating dates from the actual sheet values', () => {
    expect(operatingDays([leg('2026-11-25'), leg('2026-11-24'), leg('2026-11-25'), {...leg('2026-11-25'), day:null}])).toEqual(['2026-11-24', '2026-11-25']);
  });
});

describe('revision evidence versus current-source reads', () => {
  it('a single FPL retains its current aircraft without reg/crew/delay historical alerts', () => {
    const snapshot = revisionBaseline(result(null, leg('2026-11-25', 'VN-A668', '4321', {h:11,m:0})), true);
    expect([nReg(snapshot), nCrew(snapshot), nDelay(snapshot)]).toEqual([0,0,0]);
    expect(rowsForUi(snapshot, true)[0]?.['reg']).toEqual({changed:false, old:'VN-A668', new:'VN-A668'});
    expect(rowsForUi(snapshot)).toEqual([]);
  });
  it('different-day reg/crew/time differences produce no historical actions', () => {
    const filtered = revisionBaseline(result(leg('2026-11-24'), leg('2026-11-25','VN-A580','4321',{h:11,m:0})));
    expect([nReg(filtered),nCrew(filtered),nDelay(filtered)]).toEqual([0,0,0]);
    expect(filtered.changes).toEqual([]);
  });
  it('two files of the same day still detect real aircraft, crew and delay changes', () => {
    const filtered = revisionBaseline(result(leg('2026-11-25'), leg('2026-11-25','VN-A580','4321',{h:11,m:0})));
    expect([nReg(filtered),nCrew(filtered),nDelay(filtered)]).toEqual([1,1,1]);
    expect(rowsForUi(filtered)[0]?.['atc']).toEqual({kind:'CHG DLA', label:'CHG DLA'});
  });
  it('multi-day reports compare only dates covered by both files', () => {
    const common = result(leg('2026-11-25'),leg('2026-11-25','VN-A580'));
    common.changes.push(...result(leg('2026-11-24'),leg('2026-11-26','VN-A580')).changes);
    expect(nReg(revisionBaseline(common))).toBe(1);
    expect(rowsForUi(revisionBaseline(common))).toHaveLength(1);
  });
});

describe('Compare and KHB first-file paths', () => {
  it('the first FPL never activates the historical pending warning; a second revision does', () => {
    const html = patchCmpSyncPage(readFileSync('src/tool/page.html','utf8'));
    const start = html.indexOf('function paintVerBang(');
    const flags = new Set<string>();
    const bang = {dataset:{},classList:{add:(k:string)=>flags.add(k),remove:(...ks:string[])=>ks.forEach(k=>flags.delete(k)),
      toggle:(k:string,on:boolean)=>on ? flags.add(k) : flags.delete(k)}};
    const files = [{name:'FPL 25 NOV - VER 01.xlsx'}];
    const ctx = vm.createContext({$:()=>bang,document:{getElementById:()=>null},verBangNo:()=>1,verBangFileKey:()=>files[files.length-1]?.name,
      verBangAcked:'',cmpFplPair,vFileList:files});
    vm.runInContext(html.slice(start,html.indexOf('function verBangAck(',start))+';paintVerBang()',ctx);
    expect(flags.has('flash')).toBe(false);
    files.push({name:'FPL 25 NOV - VER 02.xlsx'});
    vm.runInContext('paintVerBang()',ctx);
    expect(flags.has('flash')).toBe(true);
  });
  it('Compare reads one current FPL but never requests yesterday’s Crewlist as a diff', async () => {
    const fpl = {name:'FPL 25 NOV - VER 01.xlsx'};
    const calls: string[] = [];
    const html = patchCmpSyncPage('function renderCompareTable(d, opts){');
    const start = html.indexOf('async function cmpReadSyncSources()');
    const ctx = vm.createContext({cmpSyncSeq:0,cmpSyncSources:{stamp:'old',crew:[{reg:{changed:true}}]},cmpSyncDiffJob:null,
      xls:{file:today.name},lastCmp:{table:[]},cmpCrewPair,cmpFplPair,URLSearchParams,
      cmpSourceHeaders(){},cmpSyncRepaint(){},cmpSyncCheckMany:async()=>{},
      fetch:async(url:string)=>{calls.push(url);return {ok:true,json:async()=>url==='/api/version/files'?{files:[today,yesterday,fpl]}:{rows:[]}};}});
    await vm.runInContext(html.slice(start,html.indexOf('setInterval(',start))+';cmpReadSyncSources()',ctx);
    const diffs = calls.filter(c=>c.startsWith('/api/version/diff?'));
    expect(diffs).toHaveLength(1);
    const params = new URLSearchParams(diffs[0]?.split('?')[1]);
    expect([params.get('old'),params.get('new'),params.get('all')]).toEqual(['',fpl.name,'1']);
    expect(vm.runInContext('cmpSyncSources.crew.length',ctx)).toBe(0);
    expect(vm.runInContext('cmpSyncSources.fplOld',ctx)).toBe('');
    expect(vm.runInContext('cmpSyncSources.fplFile',ctx)).toBe(fpl.name);
  });
  it('KHB clears old history when there is no second Crewlist of the current day', async () => {
    const html = patchKhbCrewSyncPage(readFileSync('src/tool/page.html','utf8'));
    const start = html.indexOf('async function ftReadCrewChanges(');
    const calls: string[] = [];
    const ctx = vm.createContext({ftCrewChangesSeq:0,ftCrewChanges:{source:yesterday.name,rows:[{reg:{changed:true}}]},URLSearchParams,
      fetch:async(url:string)=>{calls.push(url);return{ok:true,json:async()=>({files:[today,yesterday]})};}});
    await vm.runInContext(html.slice(start,html.indexOf('function ftApplyCrewDiff(',start))+';ftReadCrewChanges("crew-new.xlsx")',ctx);
    expect(calls).toEqual(['/api/version/files']);
    expect(vm.runInContext('ftCrewChanges.rows.length',ctx)).toBe(0);
    expect(vm.runInContext('ftCrewChanges.source',ctx)).toBe(today.name);
  });
});