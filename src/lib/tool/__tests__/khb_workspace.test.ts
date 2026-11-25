import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../types';

const mocks = vi.hoisted(() => ({authorize:vi.fn(),read:vi.fn(),eq:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/flights.server', () => ({assertDispatcher:mocks.authorize}));
import { readKhbWorkspace, saveKhbWorkspace } from '../khb-workspace.server';

function context(body:Record<string,unknown> = {}) {
  return {userId:'jack',json:async()=>body,supabase:{
    from:()=>({select:()=>({eq:(...args:unknown[])=>{mocks.eq(...args);return {maybeSingle:mocks.read};}})}),rpc:mocks.rpc,
  }} as unknown as Ctx;
}
describe('KHB private workspace handlers', () => {
  beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue(undefined);mocks.read.mockResolvedValue({data:null,error:null});mocks.rpc.mockResolvedValue({data:{ok:true,revision:1},error:null});});
  it('reads only the signed-in owner even if the request names someone else',async()=>{
    const ctx=context({userId:'someone-else'});
    expect(await readKhbWorkspace(ctx)).toMatchObject({owner:'jack',state:null,revision:0});
    expect(mocks.eq).toHaveBeenCalledWith('user_id','jack');
    expect(mocks.authorize).toHaveBeenCalledWith(ctx.supabase,'jack');
  });
  it('saves exact typed payload and expected revision without accepting a posted owner',async()=>{
    await saveKhbWorkspace(context({userId:'someone-else',state:{rows:[{id:849}],edit:{849:{pay:'21500',pldManual:true}}},revision:4}));
    expect(mocks.rpc).toHaveBeenCalledWith('save_khb_workspace',expect.objectContaining({_expected_revision:4,_state:expect.objectContaining({edit:{849:{pay:'21500',pldManual:true}}})}));
  });
  it('does not hide a stale-tab conflict as a successful save',async()=>{
    mocks.rpc.mockResolvedValue({data:{ok:false,conflict:true,revision:5},error:null});
    expect(await saveKhbWorkspace(context({state:{rows:[]},revision:4}))).toEqual({owner:'jack',ok:false,conflict:true,revision:5});
  });
  it('rejects access when dispatcher authorization fails',async()=>{
    mocks.authorize.mockRejectedValue(new Error('Forbidden'));
    await expect(readKhbWorkspace(context())).rejects.toThrow('Forbidden');
    await expect(saveKhbWorkspace(context({state:{rows:[]},revision:0}))).rejects.toThrow('Forbidden');
    expect(mocks.read).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid state or revision before making a write',async()=>{
    expect(await saveKhbWorkspace(context({state:{rows:[]},revision:-1}))).toHaveProperty('error');
    expect(await saveKhbWorkspace(context({state:{rows:'bad'},revision:0}))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});