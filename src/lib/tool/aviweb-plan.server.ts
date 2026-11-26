import { z } from 'zod';
import { assertDispatcher } from '@/lib/flights.server';
import type { Ctx } from './types';
import { enc, dec, env, currentAgentId } from './creds.server';
import * as pc from './pcagent.server';
import * as excel from './handlers/excel.server';
import * as ft from './port/fpl_tool';
import { fetchAtcBlocks, depOffsetMin } from './handlers/fpl.server';
import { parseOpsDate, selectOperationalFlight } from './port/operational_flight';
import { AVI_PLAN_TTL_MS, assertAviPlanOwner, aviwebMessageTools, aviMessageFromFpl, type AviMessage, type AviExpected, type AviOperation } from './port/aviweb_messages';
import { pcVersionBelow } from './port/pc_version';

interface Source extends AviExpected {
  sector_id: number; std: string; crew_etd: string; crew_std: string; crew_date: string;
  eobt: string; ofp: string; cfp: string; message: AviMessage;
}
interface Plan { id: string; owner: string; operation: AviOperation; expires_at: number; machine: string; sources: Source[] }
const idSchema = z.string().uuid();
const itemSchema = z.object({ flt: z.string().trim().min(1).max(12), date: z.string().max(30), dep: z.string().max(4), arr: z.string().max(4), sector_id: z.number().int().positive().optional() });
const makeSchema = z.object({ operation: z.enum(['CHG', 'DLA']), items: z.array(itemSchema).min(1).max(30) });
const sendSchema = z.object({ plan_id: idSchema, confirmed: z.literal(true), content: z.string().min(1).max(200000), manual_submit: z.boolean().optional() });
const tools = aviwebMessageTools();
const planKey = (uid: string, id: string) => `aviweb.plan:${uid}:${id}`;
async function admin() { return (await import('@/integrations/supabase/client.server')).supabaseAdmin; }

async function readPlan(ctx: Ctx, id: string, allowExpired = false): Promise<Plan> {
  idSchema.parse(id);
  await assertDispatcher(ctx.supabase, ctx.userId);
  const { data, error } = await (await admin()).from('app_settings').select('value').eq('key', planKey(ctx.userId, id)).maybeSingle();
  if (error) throw new Error('Không đọc được bản soạn AviWeb.');
  const encrypted = (data?.value as { encrypted?: string } | null)?.encrypted;
  if (!encrypted) throw new Error('Không tìm thấy bản soạn của tài khoản này.');
  let p: Plan;
  try { p = JSON.parse(dec(encrypted)) as Plan; } catch { throw new Error('Bản soạn không hợp lệ; tạo lại.'); }
  assertAviPlanOwner(p, id, ctx.userId, allowExpired ? 0 : Date.now());
  return p;
}

async function sources(ctx: Ctx, operation: AviOperation, items: z.infer<typeof itemSchema>[]): Promise<Source[]> {
  const current = await excel.currentExcel(ctx);
  if (!current) throw new Error('Chưa nạp Crewlist/DayRep để đối chiếu chuyến.');
  const { sheets } = await excel.readSheet(ctx, current.file);
  const sheet = excel.pickSheet(sheets, current.sheet);
  if (!sheet) throw new Error('Không đọc được sheet Crewlist.');
  const crew = ft.flights_from_crew_sheet(sheet);
  const { got, missed } = await fetchAtcBlocks(items);
  if (got.length !== items.length || missed.length) throw new Error('Không lập đủ điện cho các chuyến đã chọn:\n' + missed.join('\n'));
  const result: Source[] = [];
  for (const g of got) {
    const f = g.f;
    const matches = crew.filter(c => { try { return selectOperationalFlight([f], { flt: c.flt, date: c.date, dep: c.dep, arr: c.arr }).id === f.id; } catch { return false; } });
    if (matches.length !== 1) throw new Error(`${f.callsign}: Crewlist không khớp duy nhất ngày/chặng.`);
    const c = matches[0];
    if (!c || !f.std) throw new Error(`${f.callsign}: thiếu giờ/ngày nguồn.`);
    const local = String(c.etd || c.std || '');
    const clock = /^(\d{1,2}):([0-5]\d)$/.exec(local);
    if (!clock || Number(clock[1]) > 23) throw new Error(`${f.callsign}: không có ETD/STD hợp lệ.`);
    const day = parseOpsDate(c.date);
    if (!day) throw new Error(`${f.callsign}: Crewlist thiếu ngày.`);
    const offset = depOffsetMin(f.dep_icao);
    const std = new Date(f.std);
    const localStd = new Date(std.getTime() + offset * 60000);
    const utc = new Date(Date.UTC(day.y ?? localStd.getUTCFullYear(), day.m - 1, day.d, Number(clock[1]), Number(clock[2])) - offset * 60000);
    const identity: AviExpected = { callsign: String(f.callsign).toUpperCase(), dep: f.dep_icao, arr: f.dest_icao, dof: std.toISOString().slice(2, 10).replace(/-/g, ''), reg: String(c.reg || '') };
    const eobt = utc.toISOString().slice(11, 16).replace(':', '');
    const message = aviMessageFromFpl(operation, g.block, eobt, identity);
    result.push({ ...identity, sector_id: Number(f.id), std: std.toISOString(), crew_etd: local, crew_std: String(c.std || ''), crew_date: String(c.date), eobt, ofp: g.block, cfp: String(g.plan || ''), message });
  }
  if (new Set(result.map(s => s.callsign)).size !== result.length) throw new Error('Danh sách có callsign trùng; chỉ lập một sector mỗi callsign.');
  return result;
}

export async function createAviPlan(ctx: Ctx) {
  await assertDispatcher(ctx.supabase, ctx.userId);
  const input = makeSchema.parse(await ctx.json());
  const src = await sources(ctx, input.operation, input.items);
  const id = crypto.randomUUID();
  const plan: Plan = { id, owner: ctx.userId, operation: input.operation, expires_at: Date.now() + AVI_PLAN_TTL_MS, machine: currentAgentId(), sources: src };
  const { error } = await (await admin()).from('app_settings').insert({ key: planKey(ctx.userId, id), value: { encrypted: enc(JSON.stringify(plan)) }, updated_by: ctx.userId, updated_at: new Date().toISOString() });
  if (error) throw new Error('Không lưu được bản soạn AviWeb.');
  return { ok: true, plan_id: id, operation: plan.operation, expires_at: plan.expires_at,
    flights: src.map(s => ({ ...s, original: s.ofp })), content: src.map(s => tools.serialize(s.message)).join('\r\n\r\n') + '\r\n' };
}

async function existingJob(ctx: Ctx, id: string) {
  const { data, error } = await (await admin()).from('pc_jobs').select('id,status,result,payload').eq('id', id).maybeSingle();
  if (error) throw new Error('Không đọc được trạng thái gửi.');
  if (data && (data.payload as Record<string, unknown> | null)?.['_uid'] !== ctx.userId) throw new Error('Lệnh không thuộc tài khoản này.');
  return data;
}

export async function executeAviPlan(ctx: Ctx) {
  await assertDispatcher(ctx.supabase, ctx.userId);
  const input = sendSchema.parse(await ctx.json());
  const old = await existingJob(ctx, input.plan_id);
  if (old) return { ok: true, job_id: old.id, status: old.status, reused: true };
  const plan = await readPlan(ctx, input.plan_id);
  const validated = tools.validateBatch(plan.operation, input.content, plan.sources);
  const agent = await pc.agentInfo(ctx);
  const machine = currentAgentId();
  if (!machine || !plan.machine || plan.machine !== machine) throw new Error('Ghép Trợ lý PC trên máy này rồi tạo lại bản soạn.');
  if (!pc.agentOnline(agent)) throw new Error('Trợ lý PC chưa kết nối — chưa gửi điện.');
  // 6.22 types the Delay time as HH:MM and waits for the operator at every Submit in manual_submit; older helpers would auto-Submit.
  if (!agent || pcVersionBelow(agent.version, '6.22')) throw new Error('Cập nhật Trợ lý PC lên 6.22 trước khi gửi CHG/DLA AviWeb.');
  const manual = input.manual_submit === true;
  const user = env('AVIWEB_USERNAME'), pass = env('AVIWEB_PASSWORD');
  if (!user || !pass) throw new Error('Chưa lưu tài khoản AviWeb trên web.');
  const fresh = await sources(ctx, plan.operation, plan.sources.map(s => ({ flt: s.callsign, sector_id: s.sector_id, date: s.std.slice(0, 10), dep: s.dep, arr: s.arr })));
  for (const original of plan.sources) {
    const s = fresh.find(s => s.sector_id === original.sector_id);
    if (!s || JSON.stringify(s) !== JSON.stringify(original)) throw new Error(`${original.callsign}: nguồn OFP/Crewlist đã đổi; tạo và xác nhận bản mới.`);
  }
  // The plan UUID is also the job PK: concurrent confirmations race on ONE insert.
  const { error } = await (await admin()).from('pc_jobs').insert({ id: plan.id, kind: 'aviweb_messages', payload: { _uid: ctx.userId, _aid: machine, operation: plan.operation, content: validated.content, expected: plan.sources.map(s => ({ callsign: s.callsign, dep: s.dep, arr: s.arr, dof: s.dof, reg: s.reg, std: s.std })), aviweb_user: user, aviweb_pass: pass, headless: !manual, manual_submit: manual } });
  if (error && error.code !== '23505') throw new Error('Không giao được lệnh gửi; kiểm tra trạng thái trước khi thử lại.');
  const job = await existingJob(ctx, plan.id);
  if (!job) throw new Error('Chưa xác nhận được lệnh; không tự gửi lại.');
  return { ok: true, job_id: job.id, status: job.status, reused: !!error };
}

export async function aviPlanStatus(ctx: Ctx) {
  const id = idSchema.parse(ctx.params.get('plan_id'));
  await readPlan(ctx, id, true);
  const job = await existingJob(ctx, id);
  return { ok: true, job_id: id, status: job?.status ?? 'draft', result: job?.result ?? null };
}