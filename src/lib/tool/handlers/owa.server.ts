import type { Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import * as pc from "../pcagent.server";

// Port of web.py OWA/PIB endpoints (start_owa_login, owa_fpl_watch.status,
// start_pib_download): the real Outlook-Web/Selenium session must run on the
// company PC, so these go through the PC agent (pc_agent.py: owa_login,
// owa_fpl_watch, owa_pib) exactly like atc.server.ts's aviweb_check.

function offline() {
  return { error: "Trợ lý PC chưa kết nối — mở trợ lý trên máy công ty rồi thử lại." };
}

export const routes: Routes = {
  // web.py "/api/owa/login" -> start_owa_login(): job id, streamed over /api/stream.
  "POST /api/owa/login": async (ctx) => {
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) return offline();
    return { id: jobId("owa_login", {}) };
  },

  // web.py "/api/owa/fpl-watch" -> owa_fpl_watch.status(after=...), a plain
  // (non-job) GET. Relay it through the PC agent synchronously.
  "GET /api/owa/fpl-watch": async (ctx) => {
    const after = Number(ctx.params.get("after") || "0") || 0;
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      return { running: false, last_at: 0, count: 0, items: [], lines: [], until: after, error: offline().error };
    }
    try {
      const id = await pc.enqueue("owa_fpl_watch", { after });
      const r = await pc.waitResult(id, 20_000);
      return r;
    } catch (e) {
      return { running: false, last_at: 0, count: 0, items: [], lines: [], until: after, error: e instanceof Error ? e.message : String(e) };
    }
  },

  // web.py "/api/pib/download" -> start_pib_download(): job id, streamed.
  "POST /api/pib/download": async (ctx) => {
    const payload = await ctx.json();
    const callsigns = (payload["callsigns"] as string[] | undefined) ?? [];
    if (!callsigns.filter((c) => String(c || "").trim()).length) {
      return { error: "Chưa có số hiệu chuyến bay nào trong cột PIB/WX." };
    }
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) return offline();
    const hours = Number(payload["hours"] ?? 10) || 10;
    const overwrite = !!payload["overwrite"];
    return { id: jobId("owa_pib", { callsigns, hours, overwrite }) };
  },
};

export const jobs: Jobs = {
  // Port of web.py start_owa_login(): giao trợ lý PC mở Outlook Web thật rồi
  // relay log + kết quả cuối cùng y hệt shape gốc.
  owa_login: async (_params, emit, ctx) => {
    const t0 = Date.now();
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: `✗ ${offline().error}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: 0, ok: 0, skipped: 0, failed: 1, logged_in: false, owa_state: "stale" });
      return;
    }
    try {
      emit({ type: "line", text: "▶ Mở Chrome Outlook Web — auto-login nếu đã lưu owa_username/owa_password (MFA thì xác nhận tay)." });
      const id = await pc.enqueue("owa_login", {});
      let lastBeat = 0;
      const r = await pc.waitResult(id, 450_000, (elapsed) => {
        if (elapsed - lastBeat >= 30) {
          lastBeat = elapsed;
          emit({ type: "line", text: `· đang chờ trợ lý PC đăng nhập Outlook Web… (${Math.round(elapsed)}s)`, cls: "sys" });
        }
      });
      const lines = (r["lines"] as Array<{ text?: string; cls?: string }> | undefined) ?? [];
      for (const l of lines) if (l?.text) emit({ type: "line", text: l.text, cls: l.cls || "" });
      const loggedIn = !!r["logged_in"];
      const cancelled = !!r["cancelled"];
      emit({
        type: "end",
        code: loggedIn ? 0 : 1,
        elapsed: (Date.now() - t0) / 1000,
        ok: loggedIn ? 1 : 0,
        skipped: 0,
        failed: loggedIn ? 0 : 1,
        logged_in: loggedIn,
        cancelled,
        owa_state: r["owa_state"] ?? (loggedIn ? "healthy" : "stale"),
      });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, logged_in: false, owa_state: "stale" });
    }
  },

  // Port of web.py start_pib_download(): relay trợ lý PC (owa_pib) — cùng
  // shape line/owa_state/end mà tlRun() trên page.html đang đọc.
  owa_pib: async (params, emit, ctx) => {
    const t0 = Date.now();
    const callsigns = (params["callsigns"] as string[] | undefined) ?? [];
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: `✗ ${offline().error}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: 0, ok: 0, skipped: 0, failed: callsigns.length, missing: callsigns });
      return;
    }
    try {
      const id = await pc.enqueue("owa_pib", params);
      let lastBeat = 0;
      const r = await pc.waitResult(id, 450_000, (elapsed) => {
        if (elapsed - lastBeat >= 30) {
          lastBeat = elapsed;
          emit({ type: "line", text: `· đang chờ trợ lý PC tải PIB… (${Math.round(elapsed)}s)`, cls: "sys" });
        }
      });
      const events = (r["events"] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const ev of events) emit(ev);
      if (r["cancelled"]) {
        emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 0, missing: [], cancelled: true, source: r["source"] ?? "none" });
        return;
      }
      const ok = Number(r["ok"] ?? 0);
      const skipped = Number(r["skipped"] ?? 0);
      const missing = (r["missing"] as string[] | undefined) ?? [];
      emit({
        type: "end",
        code: missing.length ? 2 : 0,
        elapsed: (Date.now() - t0) / 1000,
        ok,
        skipped,
        failed: missing.length,
        missing,
        files: r["files"] ?? [],
        source: r["source"] ?? "owa",
        auth_failed: !!r["auth_failed"],
        folder: r["folder"] ?? "",
      });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: callsigns.length, missing: callsigns });
    }
  },
};
