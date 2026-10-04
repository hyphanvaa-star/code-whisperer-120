import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Ctx, Handler, JobFn, Routes } from "./types";
import { parseJobId } from "./jobs";
import * as core from "./handlers/core.server";
import * as fpl from "./handlers/fpl.server";
import * as notam from "./handlers/notam.server";
import * as aip from "./handlers/aip.server";
import * as wx from "./handlers/wx.server";
import * as excel from "./handlers/excel.server";
import * as limits from "./handlers/limits.server";
import * as notices from "./handlers/notices.server";
import * as atc from "./handlers/atc.server";
import * as briefing from "./handlers/briefing.server";
import * as swap from "./handlers/swap.server";
import * as autoload from "./handlers/autoload.server";
import * as misc from "./handlers/misc.server";
import * as handover from "./handlers/handover.server";
import * as pc from "./handlers/pc.server";
import * as owa from "./handlers/owa.server";
import * as crew from "./handlers/crew.server";
import * as briefingRelease from "./handlers/briefing_release.server";

const GROUPS = [core, fpl, notam, aip, wx, excel, limits, notices, atc, briefing, briefingRelease, swap, autoload, misc, handover, pc, owa, crew];

const ROUTES: Routes = Object.assign({}, ...GROUPS.map((g) => g.routes));
const JOBS: Record<string, JobFn> = Object.assign({}, ...GROUPS.map((g) => g.jobs));

/** Endpoints web.py serves before its gate check — no login needed for these. */
const PUBLIC = new Set(["GET /api/gate/status", "POST /api/gate/lock", "GET /api/heartbeat", "GET /api/tab-close", "POST /api/tab-close"]);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data ?? null), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

async function authorize(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  let token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // Cookie only for GET (EventSource / file links); POST must carry the header.
  if (!token && request.method === "GET") token = readCookie(request, "fbt");
  if (!token || token.split(".").length !== 3) return null;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const supabase = createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return null;
  const { assertDispatcher } = await import("@/lib/flights.server");
  try {
    await assertDispatcher(supabase, data.user.id);
  } catch {
    return { forbidden: true as const };
  }
  return { userId: data.user.id, supabase };
}

function find(method: string, route: string): Handler | undefined {
  const exact = ROUTES[`${method} ${route}`];
  if (exact) return exact;
  let best: [number, Handler] | undefined;
  for (const [k, h] of Object.entries(ROUTES)) {
    if (!k.endsWith("*")) continue;
    const [m, p] = k.slice(0, -1).split(" ");
    if (m === method && p && route.startsWith(p) && (!best || p.length > best[0])) best = [p.length, h];
  }
  return best?.[1];
}

function stream(run: JobFn, params: Record<string, unknown>, ctx: Ctx) {
  const enc = new TextEncoder();
  const t0 = Date.now();
  const body = new ReadableStream({
    async start(controller) {
      let ended = false;
      const emit = (msg: Record<string, unknown>) => {
        if (ended) return;
        controller.enqueue(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
        if (msg["type"] === "end") ended = true;
      };
      const ping = setInterval(() => !ended && controller.enqueue(enc.encode(": ping\n\n")), 10000);
      try {
        await run(params, emit, ctx);
      } catch (e) {
        emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "err" });
        emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000 });
      }
      if (!ended) emit({ type: "end", code: 0, elapsed: (Date.now() - t0) / 1000 });
      clearInterval(ping);
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export async function handleToolApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  const key = `${method} ${route}`;

  let bodyCache: Record<string, unknown> | undefined;
  const mkCtx = (userId: string, supabase: Ctx["supabase"]): Ctx => ({
    request,
    url,
    params: url.searchParams,
    route,
    userId,
    supabase,
    json: async () => {
      if (bodyCache) return bodyCache;
      try {
        bodyCache = ((await request.clone().json()) as Record<string, unknown>) ?? {};
      } catch {
        bodyCache = {};
      }
      return bodyCache;
    },
  });

  let ctx: Ctx | null = null;
  if (!PUBLIC.has(key)) {
    const a = await authorize(request);
    if (!a) return json({ error: "Phiên đăng nhập hết hạn, đăng nhập lại." }, 401);
    if ("forbidden" in a) return json({ error: "Tài khoản chưa được quản trị viên cấp quyền dispatcher." }, 403);
    ctx = mkCtx(a.userId, a.supabase);
  } else {
    ctx = mkCtx("", null as unknown as Ctx["supabase"]);
  }

  try {
    if (key === "GET /api/stream") {
      const job = parseJobId(url.searchParams.get("id") ?? "");
      const run = job && JOBS[job.k];
      if (!job || !run) return json({ error: "job không tồn tại" }, 404);
      return stream(run, job.p, ctx);
    }
    const h = find(method, route);
    if (!h) {
      console.warn("[tool-api] chưa chuyển:", key);
      return json({
        error: `Chức năng này (${route}) chưa chuyển sang bản web — đang làm.`,
        not_ported: true,
      });
    }
    const out = await h(ctx);
    if (out instanceof Response) return out;
    return json(out);
  } catch (e) {
    console.error("[tool-api]", key, e);
    // Like web.py: never break the connection, show the error in the UI.
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
}
