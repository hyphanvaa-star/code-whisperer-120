// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KHB_KEEP_SCRIPT } from '../khb_persistence';

type Saved = {state:Record<string,unknown>|null;revision:number};
function screen(saved:Saved = {state:null,revision:0}, cache:unknown = null) {
  document.body.innerHTML='<div id="wrapFplText"><input id="ftDspBox"><input id="ftExtra"><input id="ftSeq"><button id="ftPldRound"></button><span id="ftStat"></span></div><input id="fEfb">';
  const storage = new Map<string,string>(); if(cache) storage.set('khb.keep.jack',JSON.stringify(cache));
  let uid='jack', online=true;
  const posts:Record<string,unknown>[]=[];
  let resolveGet:((value:unknown)=>void)|null=null;
  const held = new Promise(resolve=>{resolveGet=resolve;});
  let hold=false;
  const parent={__fbUserId:()=>uid,__fbToken:()=>uid?'signed-in':null};
  const fetch=vi.fn(async (_url:string,init?:RequestInit)=>{
    if(!online) throw new Error('offline');
    if(init?.method==='POST'){
      const body=JSON.parse(String(init.body));posts.push(body);
      if(body.revision!==saved.revision) return {ok:true,json:async()=>({owner:'jack',conflict:true,ok:false,revision:saved.revision,state:saved.state})};
      saved.state=body.state;saved.revision++;
      return {ok:true,json:async()=>({owner:'jack',ok:true,revision:saved.revision})};
    }
    if(hold) await held;
    return {ok:true,json:async()=>({owner:'jack',ok:true,...saved})};
  });
  const env={window:{parent,addEventListener:vi.fn()},document,localStorage:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},
    fetch,setTimeout,clearTimeout,setInterval,location:{reload:vi.fn()},confirm:()=>true,$:(s:string)=>document.querySelector(s),
    ftRender:()=>{},ftCountLine:()=>{},
  };
  const factory=new Function(...Object.keys(env), `let ftRows=[],ftEdit={},ftBlank={},ftPldOn=false,ftApplying=false;${KHB_KEEP_SCRIPT}
    return {restore:ftKeepRestore,save:ftKeepSave,clear:()=>{ftRows=[];ftEdit={};ftBlank={};ftKeepClear();},
      edit:(state)=>{ftRows=state.rows||[];ftEdit=state.edit||{};ftBlank=state.blank||{};ftKeepLater();},
      snapshot:ftKeepSnapshot,dirty:()=>ftKeepDirty,ready:()=>ftKeepReady,conflict:()=>ftKeepConflict};`);
  const api=factory(...Object.values(env)) as {restore:()=>Promise<void>;save:()=>Promise<void>;clear:()=>void;edit:(s:Record<string,unknown>)=>void;snapshot:()=>Record<string,unknown>;dirty:()=>boolean;ready:()=>boolean;conflict:()=>boolean};
  return {api,posts,storage,saved,setUid:(s:string)=>{uid=s;},setOnline:(v:boolean)=>{online=v;},hold:()=>{hold=true;},release:()=>resolveGet?.(null)};
}
const draft={rows:[{id:849,flt:'849',date:'25/11/26',dep:'SGN',arr:'DAD'}],edit:{849:{pay:'21500',pldManual:true,rmk:'JACK note',chg:{reg:{from:'VN-A648',to:'VN-A580',src:'both',fbOk:false}}}},blank:{}};
describe('KHB reopen and safe cloud persistence',()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
  it('restores from the account on a different machine with no local cache',async()=>{
    const s=screen({state:draft,revision:3});await s.api.restore();
    expect(s.api.snapshot()).toMatchObject(draft);expect(s.posts).toHaveLength(0);
  });
  it('migrates an old local draft without deleting it because twelve hours passed',async()=>{
    const s=screen({state:null,revision:0},{...draft,at:1});await s.api.restore();await s.api.save();
    expect(s.saved.state).toMatchObject(draft);expect(s.storage.has('khb.keep.jack')).toBe(true);
  });
  it('waits for the account rather than marking an empty startup table ready',async()=>{
    const s=screen({state:draft,revision:2});s.setUid('');const restoring=s.api.restore();
    await vi.advanceTimersByTimeAsync(11000);expect(s.api.ready()).toBe(false);expect(s.posts).toHaveLength(0);
    s.setUid('jack');await vi.advanceTimersByTimeAsync(250);await restoring;
    expect(s.api.snapshot()).toMatchObject(draft);
  });
  it('does not erase a saved draft when the account read temporarily fails',async()=>{
    const s=screen({state:draft,revision:2},{version:2,owner:'jack',revision:2,dirty:false,state:draft});
    s.setOnline(false);await s.api.restore();await s.api.save();
    expect(s.api.snapshot()).toMatchObject(draft);expect(s.posts).toHaveLength(0);
    s.setOnline(true);await s.api.restore();expect(s.saved.state).toMatchObject(draft);
  });
  it('keeps edits made while the initial read is in flight instead of overwriting them',async()=>{
    const s=screen();s.hold();const read=s.api.restore();s.api.edit(draft);s.release();await read;await s.api.save();
    expect(s.saved.state).toMatchObject(draft);
  });
  it('keeps a local failed save for the next reopen and then syncs it',async()=>{
    const s=screen({state:null,revision:0});await s.api.restore();s.setOnline(false);s.api.edit(draft);await s.api.save();
    const cache=JSON.parse(s.storage.get('khb.keep.jack')||'null');expect(cache.dirty).toBe(true);
    const reopened=screen({state:null,revision:0},cache);await reopened.api.restore();await reopened.api.save();
    expect(reopened.saved.state).toMatchObject(draft);
  });
  it('explicit Clear stores an empty draft which stays empty after reopening',async()=>{
    const s=screen({state:draft,revision:1});await s.api.restore();s.api.clear();await s.api.save();
    expect(s.saved.state?.['rows']).toEqual([]);
    const reopened=screen(s.saved);await reopened.api.restore();expect(reopened.api.snapshot()['rows']).toEqual([]);
  });
  it('a stale tab never overwrites a newer cloud draft',async()=>{
    const s=screen({state:draft,revision:2});await s.api.restore();s.saved.revision=3;s.saved.state={rows:[{id:850}],edit:{850:{pay:'22950'}},blank:{}};
    s.api.edit(draft);s.api.clear();await s.api.save();
    expect(s.api.conflict()).toBe(true);expect(s.saved.state['rows']).toEqual([{id:850}]);
  });
  it('never sends the previous account draft after the identity changes',async()=>{
    const s=screen({state:draft,revision:1});await s.api.restore();s.setUid('another-user');s.api.edit(draft);await s.api.save();
    expect(s.posts).toHaveLength(0);expect(s.storage.has('khb.keep.another-user')).toBe(false);
  });
});