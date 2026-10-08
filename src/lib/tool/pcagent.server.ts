/**
 * PC agent job queue — replaces the PC-only parts of web.py (RICOH printing,
 * Outlook COM, D:\ drive, folder pickers). The web app enqueues rows in
 * `pc_jobs` (service-role only); a small Python helper on the company PC
 * polls /api/public/pc-agent/poll with a shared token, does the work, and
 * posts the result to /api/public/pc-agent/report.
 */
import type { Ctx } from "./types";
import { getJson } from "./store.server";

export type PcJobKind = "gd_print" | "pick_folder" | "save_file" | "aviweb_check" | "aviweb_submit" | "owa_login" | "owa_fpl_watch" | "owa_pib" | "owa_draft" | "outlook_draft" | "defect_pdf" | "owa_efb" | "notice_sync";

export interface AgentPrinter {
  name: string;
  note: string;
  default: boolean;
}

export interface AgentInfo {
  at: number;
  version: string;
  printers: AgentPrinter[];
  /** path -> exists on the company PC. */
  paths_exist: Record<string, boolean>;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Shared-token check for the PC helper. Accepts the PC_AGENT_TOKEN env secret
 * or the `pc_agent.token` app_settings value (DB fallback so token rotation
 * works without waiting for a redeploy).
 */
export async function checkAgentToken(token: string): Promise<boolean> {
  if (!token) return false;
  const candidates: string[] = [];
  const env = process.env["PC_AGENT_TOKEN"];
  if (env) candidates.push(env);
  const { data } = await (await admin())
    .from("app_settings")
    .select("value")
    .eq("key", "pc_agent.token")
    .maybeSingle();
  const dbToken = (data?.value as { token?: string } | null)?.token;
  if (dbToken) candidates.push(dbToken);
  const { timingSafeEqual } = await import("crypto");
  const a = Buffer.from(token);
  return candidates.some((c) => {
    const b = Buffer.from(c);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function enqueue(kind: PcJobKind, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await (await admin())
    .from("pc_jobs")
    .insert({ kind, payload: payload as never })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Enqueue a job, reusing an identical pending/running job created within
 * `windowMs` — collapses duplicate button clicks and open tabs into one PC
 * task (e.g. several tabs polling /api/owa/fpl-watch, or two login attempts
 * racing both opening a Chrome window on the company PC).
 */
export async function enqueueDeduped(
  kind: PcJobKind,
  payload: Record<string, unknown>,
  windowMs = 15_000,
): Promise<string> {
  const a = await admin();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await a
    .from("pc_jobs")
    .select("id, payload")
    .eq("kind", kind)
    .in("status", ["pending", "running"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const want = JSON.stringify(payload);
  const rows = (data ?? []) as Array<{ id: string; payload: Record<string, unknown> | null }>;
  const hit = rows.find((r) => JSON.stringify(r.payload ?? {}) === want);
  if (hit) return hit.id;
  return enqueue(kind, payload);
}

/** Poll a job row until the agent reports. Throws on failure / timeout. */
export async function waitResult(
  id: string,
  timeoutMs: number,
  onTick?: (elapsedS: number) => void,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await (await admin())
      .from("pc_jobs")
      .select("status, result")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { status: string; result: Record<string, unknown> | null } | null;
    if (row && (row.status === "done" || row.status === "failed")) {
      const r = row.result ?? {};
      if (row.status === "failed") {
        throw new Error(String(r["error"] || "trợ lý PC báo lỗi không rõ"));
      }
      return r;
    }
    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed * 1000 >= timeoutMs) {
      (await admin())
        .from("pc_jobs")
        .update({ status: "failed", result: { error: "hết thời gian chờ" }, done_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "running");
      throw new Error("hết thời gian chờ trợ lý PC — kiểm tra trợ lý đang chạy trên máy công ty");
    }
    onTick?.(elapsed);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Agent heartbeat, written by the public poll route (no user session). */
export async function recordHeartbeat(info: Omit<AgentInfo, "at">): Promise<void> {
  const { error } = await (await admin()).from("app_settings").upsert({
    key: "pc.agent",
    value: { ...info, at: Date.now() } as never,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function agentInfo(ctx: Ctx): Promise<AgentInfo | null> {
  return getJson<AgentInfo | null>(ctx, "pc.agent", null);
}

/** Agent is considered online if it polled within the last 90 seconds. */
export function agentOnline(info: AgentInfo | null): boolean {
  return !!info && Date.now() - info.at < 90_000;
}

/** Claim pending jobs for the agent (public poll route, service role). */
export async function claimPending(limit = 5): Promise<Array<{ id: string; kind: string; payload: Record<string, unknown> }>> {
  const a = await admin();
  const { data, error } = await a
    .from("pc_jobs")
    .select("id, kind, payload")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; kind: string; payload: Record<string, unknown> }>;
  if (rows.length) {
    await a
      .from("pc_jobs")
      .update({ status: "running" })
      .in("id", rows.map((r) => r.id))
      .eq("status", "pending");
  }
  return rows;
}

export async function finishJob(id: string, ok: boolean, result: Record<string, unknown>): Promise<void> {
  const { error } = await (await admin())
    .from("pc_jobs")
    .update({
      status: ok ? "done" : "failed",
      result: result as never,
      done_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
