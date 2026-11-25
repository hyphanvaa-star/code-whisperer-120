import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../types';

const state = vi.hoisted(() => ({files:new Map<string,ArrayBuffer>(),settings:new Map<string,unknown>(),reads:[] as string[]}));
vi.mock('../store.server', () => ({
  getFile:async(_ctx:unknown,path:string)=>{state.reads.push(path);return state.files.get(path.split('/').pop() || '') || null;},
  getJson:async(_ctx:unknown,key:string,fallback:unknown)=>state.settings.get(key) ?? fallback,
  setJson:async(_ctx:unknown,key:string,value:unknown)=>{state.settings.set(key,value);},
  listFiles:async()=>[...state.files.keys()].reverse().map((name,i)=>({name,updated_at:new Date(200000-i*1000).toISOString(),metadata:{size:state.files.get(name)?.byteLength}})),
  putFile:vi.fn(),removeFiles:vi.fn(),
}));
vi.mock('../core/gantts.server', () => ({loadFlights:async()=>[],applyFilters:vi.fn()}));
vi.mock('@/lib/flitebrief.server', () => ({fbJson:vi.fn()}));
import { routes } from '../handlers/excel.server';

function add(name:string, date:string, reg='VN-A668', crew='1234', etd='') {
  state.files.set(name,new TextEncoder().encode(`DATE,FLT,DEP,ARR,STD,ETD,REG,CREW\n${date},VJ849,SGN,DAD,10:00,${etd},${reg},(CP) ${crew}\n`).buffer);
  state.settings.set('excel.current:test',{file:name,sheet:''});
}
async function run(path:string) {
  const url=new URL('http://localhost'+path);
  const handler=routes['GET '+url.pathname];
  if (!handler) throw new Error('Missing handler');
  return await handler({params:url.searchParams,userId:'test'} as Ctx) as Record<string,unknown>;
}
describe('authenticated version handler baseline', () => {
  beforeEach(()=>{state.files.clear();state.settings.clear();state.reads.length=0;});
  it('reads one current FPL without looking for an unnamed old file or raising historical changes',async()=>{
    add('FPL 25 NOV - VER 01.csv','25/11/2026','VN-A580','4321','11:00');
    const out=await run('/api/version/diff?new=FPL%2025%20NOV%20-%20VER%2001.csv&all=1');
    expect(out['error']).toBeUndefined();
    expect([out['n_reg'],out['n_crew'],out['n_delay']]).toEqual([0,0,0]);
    expect(out['rows']).toHaveLength(1);
    expect(state.reads.some(p=>p.endsWith('/unnamed'))).toBe(false);
  });
  it('different-day files cannot produce aircraft, crew, delay, added or removed alerts',async()=>{
    add('old.csv','24/11/2026');add('new.csv','25/11/2026','VN-A580','4321','11:00');
    const out=await run('/api/version/diff?old=old.csv&new=new.csv');
    expect([out['n_reg'],out['n_crew'],out['n_delay']]).toEqual([0,0,0]);
    expect(out['rows']).toEqual([]);expect(out['added']).toEqual([]);expect(out['removed']).toEqual([]);
  });
  it('two same-day files retain all three real change types',async()=>{
    add('old.csv','25/11/2026');add('new.csv','25/11/2026','VN-A580','4321','11:00');
    const out=await run('/api/version/diff?old=old.csv&new=new.csv');
    expect([out['n_reg'],out['n_crew'],out['n_delay']]).toEqual([1,1,1]);
  });
  it('catalogue reads real operating days once and reuses the user-scoped file identity cache',async()=>{
    add('first.csv','25/11/2026');
    const out=await run('/api/version/files');
    expect(out['files']).toMatchObject([{name:'first.csv',operating_days:['2026-11-25']}]);
    const reads=state.reads.length;
    await run('/api/version/files');
    expect(state.reads.length).toBe(reads);
    expect(state.settings.has('excel.current.dates:test')).toBe(true);
  });
});