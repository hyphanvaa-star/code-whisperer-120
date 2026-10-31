/**
 * PC agent job queue — replaces the PC-only parts of web.py (RICOH printing,
 * Outlook COM, D:\ drive, folder pickers). The web app enqueues rows in
 * `pc_jobs` (service-role only); a small Python helper on the company PC
 * polls /api/public/pc-agent/poll with a shared token, does the work, and
 * posts the result to /api/public/pc-agent/report.
 */
import type { Ctx } from "./types";
import { getJson } from "./store.server";

export type PcJobKind = "gd_print" | "pick_folder" | "save_file" | "aviweb_check" | "aviweb_submit" | "owa_login" | "owa_fpl_watch" | "owa_pib" | "owa_draft" | "outlook_draft" | "defect_pdf" | "owa_efb" | "notice_sync" | "http_fetch";

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

async function myIp(): Promise<string> {
  const { currentIp } = await import("./creds.server");
  return currentIp();
}

async function myUid(): Promise<string> {
  const { currentUserId } = await import("./creds.server");
  return currentUserId();
}

/** Tag jobs with the browser's account (primary) and network (legacy helpers). */
async function tag(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ip = await myIp();
  const uid = await myUid();
  return { ...payload, ...(ip ? { _ip: ip } : {}), ...(uid ? { _uid: uid } : {}) };
}

const uidCache = new Map<string, { id: string; at: number }>();
/** Resolve the Dispatch Board login the helper was paired with (email or name before @). */
export async function resolveAgentUser(login: string): Promise<string> {
  const k = login.trim().toLowerCase();
  if (!k) return "";
  const hit = uidCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id;
  const a = await admin();
  let id = "";
  for (let page = 1; page <= 10 && !id; page++) {
    const { data, error } = await a.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const u = data.users.find((x) => {
      const e = (x.email ?? "").toLowerCase();
      return e === k || e.split("@")[0] === k;
    });
    if (u) id = u.id;
    if (data.users.length < 200) break;
  }
  if (!id) {
    // Fallback: helper configured with the display name (e.g. "MiuHP" for login hienpham).
    const { data: rows } = await a.from("profiles").select("id, display_name, original_username");
    const hits = (rows ?? []).filter((p) =>
      [p.display_name, p.original_username].some((v) => String(v ?? "").trim().toLowerCase() === k));
    if (hits.length === 1) id = hits[0]!.id;
    const { data: list } = await a.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (!id) {
      const metaHits = (list?.users ?? []).filter((x) =>
        String((x.user_metadata as Record<string, unknown> | null)?.["full_name"] ?? "").trim().toLowerCase() === k);
      if (metaHits.length === 1) id = metaHits[0]!.id;
    }
  }
  uidCache.set(k, { id, at: Date.now() });
  return id;
}

/** Each helper only receives jobs from browsers on the same public IP (same office / same home). */
export async function enqueue(kind: PcJobKind, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await (await admin())
    .from("pc_jobs")
    .insert({ kind, payload: (await tag(payload)) as never })
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
  const want = JSON.stringify(await tag(payload));
  const rows = (data ?? []) as Array<{ id: string; payload: Record<string, unknown> | null }>;
  const hit = rows.find((r) => JSON.stringify(r.payload ?? {}) === want);
  if (hit) return hit.id;
  return enqueue(kind, payload);
}

/** Poll a job row until the agent reports. Throws on failure / timeout. */
export async function waitResult(
  id: string,
  timeoutMs: number,
  onTick?: (elapsedS: number, partial: Record<string, unknown> | null) => void,
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
        const err = new Error(String(r["error"] || "trợ lý PC báo lỗi không rõ")) as Error & { lines?: unknown };
        err.lines = r["lines"];
        throw err;
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
    onTick?.(elapsed, row?.result ?? null);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Agent heartbeat, written by the public poll route (no user session). */
export async function recordHeartbeat(info: Omit<AgentInfo, "at">, ip = "", uid = "", offline = false): Promise<void> {
  const value = { ...info, at: offline ? 0 : Date.now() } as never;
  const updated_at = new Date().toISOString();
  const rows = [{ key: ip ? `pc.agent:${ip}` : "pc.agent", value, updated_at }];
  if (uid) rows.push({ key: `pc.agent:u:${uid}`, value, updated_at });
  const { error } = await (await admin()).from("app_settings").upsert(rows);
  if (error) throw new Error(error.message);
}

export async function agentInfo(ctx: Ctx): Promise<AgentInfo | null> {
  const ip = await myIp();
  const uid = ctx.userId || (await myUid());
  // Signed-in users only see their own paired machine — never a colleague's on the same office IP.
  if (uid) return await getJson<AgentInfo | null>(ctx, `pc.agent:u:${uid}`, null);
  return await getJson<AgentInfo | null>(ctx, ip ? `pc.agent:${ip}` : "pc.agent", null);
}

/** Agent is considered online if it polled within the last 90 seconds. */
export function agentOnline(info: AgentInfo | null): boolean {
  return !!info && Date.now() - info.at < 90_000;
}

/** Claim pending jobs for the agent (public poll route, service role). */
export async function claimPending(limit = 5, ip = "", printers: unknown[] = [], uid = ""): Promise<Array<{ id: string; kind: string; payload: Record<string, unknown> }>> {
  const a = await admin();
  let q = a
    .from("pc_jobs")
    .select("id, kind, payload")
    .eq("status", "pending");
  // Only jobs created from the helper's own network; untagged legacy jobs stay claimable.
  // Paired helper: jobs of its own account (any network). Otherwise legacy same-IP matching.
  const conds = ["payload->>_ip.is.null"];
  if (uid) conds.push(`payload->>_uid.eq.${uid}`);
  if (ip) conds.push(`and(payload->>_ip.eq.${ip},payload->>_uid.is.null)`, ...(uid ? [] : [`payload->>_ip.eq.${ip}`]));
  q = q.or(conds.join(","));
  const { data, error } = await q
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  // In GD chỉ giao cho máy thật sự có máy in đích (RICOH) — máy ở nhà cùng
  // token/cùng mạng nhưng không có RICOH sẽ không nhận lệnh in.
  const names = printers
    .map((p) => String((p as { name?: unknown })?.name ?? p ?? "").toUpperCase())
    .filter(Boolean);
  const rows = ((data ?? []) as Array<{ id: string; kind: string; payload: Record<string, unknown> }>).filter((r) => {
    if (r.kind !== "gd_print") return true;
    const want = String(r.payload?.["printer"] || "RICOH").toUpperCase();
    return names.some((n) => n.includes(want) || (want.includes("RICOH") && n.includes("RICOH")));
  });
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
    .eq("id", id)
    .in("status", ["pending", "running"]);
  if (error) throw new Error(error.message);
}

/** Huỷ mọi lệnh PC đang chờ/đang chạy (nút Stop). Trả số lệnh bị huỷ. */
export async function cancelAll(): Promise<number> {
  const ip = await myIp();
  const uid = await myUid();
  let q = (await admin())
    .from("pc_jobs")
    .update({ status: "failed", result: { error: "đã huỷ bởi người dùng", cancelled: true } as never, done_at: new Date().toISOString() })
    .in("status", ["pending", "running"]);
  if (uid) q = q.eq("payload->>_uid", uid);
  else if (ip) q = q.eq("payload->>_ip", ip);
  const { data, error } = await q
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** Trạng thái 1 lệnh — trợ lý PC hỏi để biết có bị huỷ không. */
/** Helper streams progress lines while a job runs; stored in result.lines so waitResult can relay them live. */
export async function appendProgress(id: string, lines: Array<{ text?: string; cls?: string }>): Promise<void> {
  if (!lines.length) return;
  const a = await admin();
  const { data } = await a.from("pc_jobs").select("status, result").eq("id", id).maybeSingle();
  const row = data as { status: string; result: Record<string, unknown> | null } | null;
  if (!row || row.status !== "running") return;
  const prev = ((row.result ?? {})["lines"] as unknown[] | undefined) ?? [];
  await a.from("pc_jobs").update({ result: { lines: [...prev, ...lines], partial: true } as never })
    .eq("id", id).eq("status", "running");
}

export async function jobStatus(id: string): Promise<string> {
  const { data } = await (await admin()).from("pc_jobs").select("status").eq("id", id).maybeSingle();
  return String((data as { status?: string } | null)?.status ?? "missing");
}

/** Signed short-lived pairing token: the browser hands it to the helper on the same PC. */
async function pairSecret(): Promise<string> {
  const env = process.env["PC_AGENT_TOKEN"];
  if (env) return env;
  const { data } = await (await admin()).from("app_settings").select("value").eq("key", "pc_agent.token").maybeSingle();
  return (data?.value as { token?: string } | null)?.token ?? "";
}

export async function makePairToken(uid: string, ttlMs = 12 * 3600_000): Promise<string> {
  const secret = await pairSecret();
  if (!uid || !secret) return "";
  const exp = Date.now() + ttlMs;
  const { createHmac } = await import("crypto");
  const sig = createHmac("sha256", secret).update(`p1.${uid}.${exp}`).digest("hex");
  return `p1.${uid}.${exp}.${sig}`;
}

export async function verifyPairToken(token: string): Promise<string> {
  const m = /^p1\.([0-9a-f-]{36})\.(\d+)\.([0-9a-f]{64})$/.exec(token || "");
  if (!m || Number(m[2]) < Date.now()) return "";
  const secret = await pairSecret();
  if (!secret) return "";
  const { createHmac, timingSafeEqual } = await import("crypto");
  const want = Buffer.from(createHmac("sha256", secret).update(`p1.${m[1]}.${m[2]}`).digest("hex"));
  const got = Buffer.from(m[3]!);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1]! : "";
}
