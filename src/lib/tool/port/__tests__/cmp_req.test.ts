import { beforeEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cmpAircraftChange, cmpReqChange, cmpReqKey, cmpSourceChange, patchCmpSyncPage } from '../cmp_sync';

const f = {id:724,callsign:'VJC724',std:'2026-11-03T05:00:00Z',dep:'VVTS',arr:'VVDN'};
const row = {sector_id:724,fb_std:f.std,reg:{changed:true,old:'VN-A543',new:'VN-A580'},crew:{changed:false}};
const patched = patchCmpSyncPage(readFileSync('src/tool/page.html','utf8'));

describe('CFP REQ change evidence', () => {
  it('activates for Crewlist aircraft change', () => expect(cmpReqChange([row],724,f.std)).toEqual(row));
  it('activates for Crewlist crew-only change', () => {
    const crew = {...row,reg:{...row.reg,changed:false},crew:{changed:true}};
    expect(cmpReqChange([crew],724,f.std)).toEqual(crew);
  });
  it('does not activate for unchanged, wrong-day, duplicate or nonoperational sectors', () => {
    expect(cmpReqChange([{...row,reg:{...row.reg,changed:false}}],724,f.std)).toBeNull();
    expect(cmpReqChange([row],724,'2026-11-02T05:00:00Z')).toBeNull();
    expect(cmpReqChange([row,row],724,f.std)).toBeNull();
    expect(cmpReqChange([{...row,ops_ok:false}],724,f.std)).toBeNull();
  });
  it('separates acknowledgement by user, date, route and new changes', () => {
    const key = cmpReqKey('hy',f,row);
    expect(cmpReqKey('other',f,row)).not.toBe(key);
    expect(cmpReqKey('hy',{...f,std:'2026-11-04T05:00:00Z'},row)).not.toBe(key);
    expect(cmpReqKey('hy',{...f,arr:'VVNB'},row)).not.toBe(key);
    expect(cmpReqKey('hy',f,{...row,reg:{...row.reg,new:'VN-A581'}})).not.toBe(key);
  });
});

describe('CFP reuses REQ download and acknowledges only success', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });
  function setup(success = true) {
    document.body.innerHTML = '<table><tbody id="cmpBody"><tr><td data-w="cfp" data-sid="724"><span class="v">51</span></td></tr></tbody></table>';
    const downloads: unknown[] = [], alerts: string[] = [];
    const context = vm.createContext({document,window:{parent:{__fbUserId:()=> 'hy'}},localStorage,
      cmpReqChange,cmpSourceChange,cmpAircraftChange,cmpReqKey,
      cmpActionFlight:()=>({...f,dep_icao:f.dep,dest_icao:f.arr}),
      xls:{file:'new.xlsx'},cmpSyncSources:{current:'new.xlsx',crew:[row],fpl:[]},cmpBind:{},
      alert:(msg:string)=>alerts.push(msg),write(){},atob,Uint8Array,Blob,setTimeout:()=>0,
      URL:{createObjectURL:()=> 'blob:req',revokeObjectURL(){}},
      fetch:async (_url:string, options:{body:string})=> {
        downloads.push(JSON.parse(options.body));
        return {json:async()=>success ? {ok:true,file:btoa('REQ CONTENT'),filename:'VJC724_SGNDAD.req',dsp:'PHAN THANH HY'} : {error:'OFP thiếu DSP'}};
      }});
    const start = patched.indexOf('const cmpReqDone');
    vm.runInContext(patched.slice(start,patched.indexOf('function cmpMsgPaint',start)),context);
    const reqStart = patched.indexOf('function vReqCell(');
    vm.runInContext(patched.slice(reqStart,patched.indexOf('function vBriefCell',reqStart)),context);
    const compareRow = {sector_id:724,callsign:'VJC724',dep:'SGN',arr:'DAD',cfp_no:'51'};
    context.r = compareRow;
    vm.runInContext('cmpReqPaint(r)',context);
    return {context, downloads, alerts};
  }
  it('exports exact sector without web DSP, then stays acknowledged on repaint', async () => {
    const {context,downloads} = setup();
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){};
    try{
      await vm.runInContext('document.querySelector(".cmp-cfp-req").onclick({stopPropagation(){}})',context);
      expect(downloads).toEqual([{sector_id:724,flt:'VJC724',route:'SGN-DAD',date:'2026-11-03',efb:''}]);
      expect(vm.runInContext('cmpReqDone.size',context)).toBe(1);
      vm.runInContext('cmpReqPaint(r)',context);
      expect(document.querySelector('.cmp-cfp-req')).toBeNull();
      expect(localStorage.length).toBe(1);
    }finally{HTMLAnchorElement.prototype.click = original;}
  });
  it('keeps retry available and does not acknowledge a failed export', async () => {
    const {context,alerts} = setup(false);
    await vm.runInContext('document.querySelector(".cmp-cfp-req").onclick({stopPropagation(){}})',context);
    expect(alerts).toEqual(['REQ VJC724: OFP thiếu DSP']);
    expect(vm.runInContext('cmpReqDone.size',context)).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(document.querySelector<HTMLButtonElement>('.cmp-cfp-req')?.disabled).toBe(false);
  });
  it('rejects stale Crewlist scope and ignores FPL-only changes', () => {
    const {context} = setup();
    vm.runInContext('cmpSyncSources.current = "old.xlsx"; cmpReqPaint(r)',context);
    expect(document.querySelector('.cmp-cfp-req')).toBeNull();
    vm.runInContext('cmpSyncSources.current = "new.xlsx"; cmpSyncSources.fpl = cmpSyncSources.crew; cmpSyncSources.crew = []; cmpReqPaint(r)',context);
    expect(document.querySelector('.cmp-cfp-req')).toBeNull();
  });
});