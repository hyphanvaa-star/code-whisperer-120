import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cmpFplPair, patchCmpSyncPage } from '../cmp_sync';

const raw = readFileSync('src/tool/page.html', 'utf8');
const patched = patchCmpSyncPage(raw);
const source = patched.slice(patched.indexOf('async function applyFplVer(ver){'), patched.indexOf('\nfunction setOwaState'));

describe('FPL watcher application', () => {
  it('applies VER 12, immediately reads Compare and paints the loaded version instead of helper metadata', async () => {
    const context = {
      window: {}, Date, mode: 'compare', lastCmp: {table: []}, cmpAtcAutoPending: false,
      fplVerApplied: {old: '', new: ''},
      vFileList: [{name: 'FLIGHT PLAN ON 04 NOV - VER 11.xlsx'}, {name: 'FPL 04 NOV - VER 12.xlsx'}],
      cmpFplPair, vLoadFiles: async () => {}, vPaintMenus() {}, vRun() {}, cmpAtcAutoRun() {},
      selections: {} as Record<string, string>, painted: {} as Record<string, string>, reads: 0,
      vSetValue(which: string, value: string) {context.selections[which] = value;},
      paintVerBang(ver: Record<string, string>) {context.painted = ver;},
      async cmpReadSyncSources() {context.reads++;},
    };
    vm.createContext(context);
    await vm.runInContext(source + '\napplyFplVer({old:"FLIGHT PLAN ON 04 NOV - VER 11.xlsx",new:"FPL 04 NOV - VER 12.xlsx",new_ver:99})', context);
    expect(context.selections).toEqual({old:'FLIGHT PLAN ON 04 NOV - VER 11.xlsx',new:'FPL 04 NOV - VER 12.xlsx'});
    expect(context.painted).toEqual(context.fplVerApplied);
    expect(context.reads).toBe(1);
    await vm.runInContext('applyFplVer({old:"FLIGHT PLAN ON 04 NOV - VER 11.xlsx",new:"FPL 04 NOV - VER 12.xlsx"})', context);
    expect(context.reads).toBe(1);
  });
  it('keeps the new filename pending until Compare acknowledges it', () => {
    const start = patched.indexOf(' function parseVerNo(name)');
    const end = patched.indexOf('\nasync function applyFplVer', start);
    const selected = {value:'FPL 04 NOV - VER 12.xlsx'};
    const classes = new Set<string>();
    const bang = {dataset:{}, textContent:'', innerHTML:'', title:'', classList:{add:(v:string)=>classes.add(v),remove:(...vs:string[])=>vs.forEach(v=>classes.delete(v)),toggle:(v:string,on:boolean)=>on?classes.add(v):classes.delete(v)}};
    const context = {verBangAcked:'FLIGHT PLAN ON 04 NOV - VER 11.xlsx',verBangSave(){}, $:(selector:string)=>selector==='#verBang'?bang:selected};
    vm.createContext(context);
    vm.runInContext(patched.slice(start,end)+'\npaintVerBang({new:"FPL 04 NOV - VER 12.xlsx",new_ver:11})',context);
    expect(bang.innerHTML).toContain('V12');
    expect(classes.has('flash')).toBe(true);
    vm.runInContext('verBangAck()',context);
    expect(context.verBangAcked).toBe('FPL 04 NOV - VER 12.xlsx');
    expect(classes.has('flash')).toBe(false);
  });
});