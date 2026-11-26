import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Ctx } from '../types';
const m = vi.hoisted(() => ({
  plans: new Map<string, unknown>(), jobs: new Map<string, Record<string, unknown>>(), role: true,
  agent: {at:0,version:'6.22'}, machine:'machine-1', reads:0, inserts:0, changed:false,
  fetch:vi.fn(), from:vi.fn(), roleCheck:vi.fn(),
}));
vi.mock('@/lib/flights.server', () => ({ assertDispatcher: async () => { m.roleCheck(); if (!m.role) throw Error('Forbidden'); } }));
vi.mock('@/lib/tool/creds.server', () => ({enc:(s:string)=>s,dec:(s:string)=>s,env:()=> 'test-only',currentAgentId:()=>m.machine}));
vi.mock('@/lib/tool/pcagent.server', () => ({agentInfo:async()=>m.agent,agentOnline:()=>m.agent.at > 0}));
vi.mock('@/lib/tool/handlers/excel.server', () => ({currentExcel:async()=>({file:'crew.xlsx',sheet:'crew'}),readSheet:async()=>({sheets:[{}]}),pickSheet:()=>({})}));
vi.mock('@/lib/tool/port/fpl_tool', () => ({flights_from_crew_sheet:()=>[{flt:'874',date:'25/11/2026',dep:'VVDN',arr:'RKSI',etd:m.changed?'16:35':'16:28',std:'16:00',reg:'VN-A523'}]}));
vi.mock('@/lib/tool/handlers/fpl.server', () => ({fetchAtcBlocks:m.fetch,depOffsetMin:()=>420}));
vi.mock('@/integrations/supabase/client.server', () => ({supabaseAdmin:{from:m.from}}));
import {createAviPlan,executeAviPlan,aviPlanStatus} from '../aviweb-plan.server';
function ctx(body:Record<string, unknown>, user='alice', id=''):Ctx {
  return {userId:user,supabase:{} as Ctx['supabase'],request:new Request('https://app.local/api'),url:new URL('https://app.local/api'),params:new URLSearchParams(id?{plan_id:id}:{}),route:'/api',json:async()=>body};
}
beforeEach(()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T09:15:00Z')); vi.clearAllMocks();
  m.plans.clear();m.jobs.clear();m.role=true;m.machine='machine-1';m.agent={at:Date.now(),version:'6.22'};m.changed=false;m.inserts=0;m.reads=0;
  m.fetch.mockResolvedValue({got:[{ix:0,f:{id:874,callsign:'VJC874',std:new Date('2026-11-25T09:00:00Z'),dep_icao:'VVDN',dep_iata:'DAD',dest_icao:'RKSI',dest_iata:'ICN',fltno:'874'},block:'(FPL-VJC874-IS\n-A21N/M-SDGHIRWYZ/LB1\n-VVDN0900\n-N0450F350 DCT\n-RKSI0430 RKSS\n-PBN/A1B1 DOF/261125 REG/VNA523 OPR/VIETJET AIR)',plan:'101'}],missed:[]});
  m.from.mockImplementation((table:string)=>({
    insert:async(row:Record<string, unknown>)=>{
      if(table==='app_settings'){m.plans.set(String(row['key']),row['value']);return {error:null};}
      const id=String(row['id']);if(m.jobs.has(id))return{error:{code:'23505'}};
      m.inserts++;m.jobs.set(id,{...row,status:'pending',result:null});return{error:null};
    },
    select:()=>({eq:(_col:string,key:string)=>({maybeSingle:async()=>{m.reads++;return{data:table==='app_settings'?(m.plans.has(key)?{value:m.plans.get(key)}:null):m.jobs.get(key)||null,error:null};}})}),
  }));
});
async function plan(){return createAviPlan(ctx({operation:'CHG',items:[{flt:'874',date:'25/11/2026',dep:'VVDN',arr:'RKSI'}]}));}
describe('owner-bound AviWeb plans and execution',()=>{
  it('builds one CHG for the ticked flight with Crewlist ETD 0928Z',async()=>{const p=await plan();expect(p.flights).toHaveLength(1);expect(p.content).toContain('VVDN0928-RKSI');expect(p.content).toContain('-13/VVDN0928');expect(p.content).toContain('-9/A21N/M');expect(p.content).toContain('-10/SDGHIRWYZ/LB1');});
  it('never queues anything at preview time',async()=>{await plan();expect(m.jobs.size).toBe(0);});
  it('executes exact edited content rather than regenerating defaults',async()=>{const p=await plan();await executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content.replaceAll('0928','1015')}));expect(m.jobs.get(p.plan_id)?.['payload']).toMatchObject({content:p.content.replaceAll('0928','1015'),_uid:'alice',_aid:'machine-1'});});
  it('two concurrent confirmations insert only one job',async()=>{const p=await plan();const body={plan_id:p.plan_id,confirmed:true,content:p.content};const result=await Promise.all([executeAviPlan(ctx(body)),executeAviPlan(ctx(body))]);expect(m.inserts).toBe(1);expect(new Set(result.map(r=>r.job_id)).size).toBe(1);});
  it('a completed job is never sent again on repeated confirmation',async()=>{const p=await plan();const b={plan_id:p.plan_id,confirmed:true,content:p.content};await executeAviPlan(ctx(b));const j=m.jobs.get(p.plan_id);if(!j)throw Error('missing');j['status']='done';expect((await executeAviPlan(ctx(b))).reused).toBe(true);expect(m.inserts).toBe(1);});
  it('requires explicit confirmed=true',async()=>{const p=await plan();await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:false,content:p.content}))).rejects.toThrow();expect(m.inserts).toBe(0);});
  it('blocks another account from executing a plan',async()=>{const p=await plan();await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content},'bob'))).rejects.toThrow();expect(m.inserts).toBe(0);});
  it('blocks another account from reading results',async()=>{const p=await plan();await expect(aviPlanStatus(ctx({},'bob',p.plan_id))).rejects.toThrow();});
  it('blocks an expired draft after 15 minutes',async()=>{const p=await plan();vi.setSystemTime(new Date('2026-11-25T09:30:00Z'));await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}))).rejects.toThrow('hết hạn');expect(m.inserts).toBe(0);});
  it('revalidates Crewlist time before queuing',async()=>{const p=await plan();m.changed=true;await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}))).rejects.toThrow('đã đổi');expect(m.inserts).toBe(0);});
  it('blocks old PC helper',async()=>{const p=await plan();m.agent.version='6.21';await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}))).rejects.toThrow('6.22');expect(m.inserts).toBe(0);});
  it('runs hidden and auto-submits when the operator did not tick Hiện Chrome',async()=>{const p=await plan();await executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}));expect(m.jobs.get(p.plan_id)?.['payload']).toMatchObject({headless:true,manual_submit:false});});
  it('ticked Hiện Chrome opens a visible Chrome that waits for the operator Submit',async()=>{const p=await plan();await executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content,manual_submit:true}));expect(m.jobs.get(p.plan_id)?.['payload']).toMatchObject({headless:false,manual_submit:true});});
  it('blocks wrong paired machine',async()=>{const p=await plan();m.machine='machine-2';await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}))).rejects.toThrow('Ghép');expect(m.inserts).toBe(0);});
  it('blocks an offline helper',async()=>{const p=await plan();m.agent.at=0;await expect(executeAviPlan(ctx({plan_id:p.plan_id,confirmed:true,content:p.content}))).rejects.toThrow('chưa kết nối');expect(m.inserts).toBe(0);});
  it('does not silently omit failed OFP reads',async()=>{m.fetch.mockResolvedValue({got:[],missed:['VJC874: no OFP']});await expect(plan()).rejects.toThrow('lập đủ');expect(m.plans.size).toBe(0);});
  it('enforces Dispatcher on creation/execution/status',async()=>{m.role=false;await expect(plan()).rejects.toThrow('Forbidden');await expect(executeAviPlan(ctx({}))).rejects.toThrow('Forbidden');await expect(aviPlanStatus(ctx({},'alice','00000000-0000-4000-8000-000000000001'))).rejects.toThrow('Forbidden');expect(m.from).not.toHaveBeenCalled();});
});
