import { assertDispatcher } from '@/lib/flights.server';
import type { Ctx } from './types';
import { normalizeKhbWorkspace } from './port/khb_workspace';

export async function readKhbWorkspace(ctx: Ctx) {
  await assertDispatcher(ctx.supabase, ctx.userId);
  const { data, error } = await ctx.supabase.from('khb_workspaces')
    .select('state,revision,updated_at').eq('user_id', ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  return { ok: true, owner: ctx.userId, state: data ? normalizeKhbWorkspace(data.state) : null, revision: data?.revision ?? 0 };
}

export async function saveKhbWorkspace(ctx: Ctx) {
  await assertDispatcher(ctx.supabase, ctx.userId);
  const body = await ctx.json();
  const state = normalizeKhbWorkspace(body['state']);
  const revision = body['revision'];
  if (!state || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return { error: 'Bản lưu Kế hoạch bay không hợp lệ.' };
  }
  // The database derives the owner from auth.uid(), never a posted user ID.
  const { data, error } = await ctx.supabase.rpc('save_khb_workspace', { _state: state as never, _expected_revision: revision });
  if (error) throw new Error(error.message);
  return { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), owner: ctx.userId };
}