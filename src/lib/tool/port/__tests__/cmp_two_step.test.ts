import { beforeEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cmpAircraftChange, cmpReqChange, cmpReqKey, cmpSourceChange, patchCmpSyncPage } from '../cmp_sync';

const f = {id:724,callsign:'VJC724',std:'2026-11-03T05:00:00Z',dep:'VVTS',arr:'VVDN'};
const row = {sector_id:724,fb_std:f.std,reg:{changed:true,old:'VN-A543',new:'VN-A580'},crew:{changed:false}};
const patched = patchCmpSyncPage(readFileSync('src/tool/page.html','utf8'));

function setup() {
  document.body.innerHTML = '<table><tbody id="cmpBody"><tr><td data-w="cfp" data-sid="724"><span class="v">51</span></td></tr></tbody></table>';
  const context = vm.createContext({document,window:{parent:{__fbUserId:()=> 'hy'}},localStorage,
    cmpReqChange,cmpSourceChange,cmpAircraftChange,cmpReqKey,
    cmpActionFlight:()=>({...f,dep_icao:f.dep,dest_icao:f.arr}),
    xls:{file:'new.xlsx'},cmpSyncSources:{current:'new.xlsx',crew:[row],fpl:[]},cmpBind:{},
    alert(){},setTimeout:()=>0});
  const start = patched.indexOf('const cmpReqDone');
  vm.runInContext(patched.slice(start,patched.indexOf('function cmpMsgPaint',start)),context);
  const two = patched.indexOf('const CMP_TWO_SEL');
  vm.runInContext(patched.slice(two,patched.indexOf('function cmpSyncRepaint',two)),context);
  context.r = {sector_id:724,callsign:'VJC724',dep:'SGN',arr:'DAD',cfp_no:'51'};
  vm.runInContext('cmpReqPaint(r)',context);
  return context;
}

describe('Compare pop-up buttons split into Ack + main action', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('opens two small buttons: Ack and the main action', () => {
    const context = setup();
    vm.runInContext('cmpTwoOpen(document.querySelector(".cmp-cfp-req"))',context);
    const btns = [...document.querySelectorAll('.cmp-two button')].map(b => b.textContent);
    expect(btns).toEqual(['Ack','REQ']);
  });

  it('Ack returns the cell to normal and the warning does not come back on repaint', () => {
    const context = setup();
    vm.runInContext('cmpTwoOpen(document.querySelector(".cmp-cfp-req"))',context);
    document.querySelector<HTMLButtonElement>('.cmp-two-ack')!.click();
    expect(document.querySelector('.cmp-cfp-req')).toBeNull();
    expect(document.querySelector('.cmp-two')).toBeNull();
    expect(document.querySelector<HTMLElement>('td .v')!.hidden).toBe(false);
    vm.runInContext('cmpReqPaint(r)',context);
    expect(document.querySelector('.cmp-cfp-req')).toBeNull();
  });
});
