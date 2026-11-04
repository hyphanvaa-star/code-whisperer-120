import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { patchCmpSyncPage } from '../cmp_sync';

function setup() {
  const html = patchCmpSyncPage('function renderCompareTable(d, opts){');
  const context = { document, _tipHost: null as HTMLElement | null,
    xls: {file:'hy4.xlsx'},
    cmpSyncSources:{fplFile:'FPL 05 NOV - VER 04.xlsx',fplOld:'FPL 05 NOV - VER 03.xlsx'},
    parseVerNo:(file:string)=>Number(/VER\s*(\d+)/i.exec(file)?.[1] || 0),
    $:()=>({value:'FPL 05 NOV - VER 99.xlsx'}) };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function cmpSourceTip('),html.indexOf('function cmpVerDetail()')), context);
  return context;
}

describe('Compare source identity on hover',()=>{
  it('uses the loaded FPL pair rather than the editable VER menu',()=>{
    const context=setup();
    const tip=vm.runInContext('cmpSourceTip("fpl")',context);
    expect(tip).toContain('FPL 05 NOV - VER 04.xlsx');
    expect(tip).toContain('FPL 05 NOV - VER 03.xlsx');
    expect(tip).not.toContain('VER 99');
  });
  it('replaces the source after Crewlist selection without losing comparison details',()=>{
    const context=setup();
    const cell=document.createElement('td'); cell.title='Excel: pilot 1234 / FliteBrief: pilot 5678';
    Object.assign(context,{cell});
    vm.runInContext('cmpSourceTipSet(cell,"crew")',context);
    context.xls.file='hy5.xlsx';
    vm.runInContext('cmpSourceTipSet(cell,"crew")',context);
    expect(cell.title).toContain('hy5.xlsx');
    expect(cell.title).not.toContain('hy4.xlsx');
    expect(cell.title).toContain('pilot 1234 / FliteBrief: pilot 5678');
  });
  it('updates the borrowed tooltip while hovered so release cannot restore an old source',()=>{
    const context=setup();
    const cell=document.createElement('td'); cell.setAttribute('data-tip','Excel: VN-A580');
    context._tipHost=cell; Object.assign(context,{cell});
    vm.runInContext('cmpSourceTipSet(cell,"fpl")',context);
    context.cmpSyncSources.fplFile='FPL 05 NOV - VER 05.xlsx';
    vm.runInContext('cmpSourceTipSet(cell,"fpl")',context);
    expect(cell.hasAttribute('title')).toBe(false);
    expect(cell.getAttribute('data-tip')).toContain('VER 05.xlsx');
    expect(cell.getAttribute('data-tip')).not.toContain('VER 04.xlsx');
    expect(cell.getAttribute('data-tip')).toContain('VN-A580');
  });
});