import type { Jobs, Routes } from "../types";
import { AVIWEB_NOT_PORTABLE_MESSAGE, readFplBlocks, fplName, checkFlightsOnline } from "../port/aviweb";
import { jobId } from "../jobs";
import { getFile, listFiles, putFile } from "../store.server";
import * as pc from "../pcagent.server";

const ATC_DIR = "atc";

// Port of the web.py "/api/atc/*" group (atcfpl.py + atc_check.py).
//
// AviWeb only exposes its FPL Manager / login through the Vaadin 7 UIDL RPC
// protocol — there is no plain HTTP endpoint for it (see ../port/aviweb.ts for
// the reconnaissance notes). The original tool drives a real Chrome window
// with Selenium. A Worker cannot do that, so the Selenium part runs in the PC
// agent (pc-agent/pc_agent.py) on the company PC, which imports the original
// atc_check.py: the web enqueues an "aviweb_check" row in pc_jobs and streams
// the agent's progress back over /api/stream, exactly like gd_print.
//
// "/api/atc/upload" still parses the uploaded ATC text into FPL blocks fully
// offline (readFplBlocks/fplName) — that half never needed a browser.

export const routes: Routes = {
  "GET /api/atc/files": async (ctx) => {
    const files = await listFiles(ctx, ATC_DIR).catch(() => []);
    const out = [];
    for (const f of files.slice(0, 30)) {
      const path = `${ATC_DIR}/${f.name}`;
      const buf = await getFile(ctx, path);
      const blocks = buf ? readFplBlocks(new TextDecoder("utf-8").decode(buf)).length : 0;
      out.push({ path, name: f.name, blocks });
    }
    return { files: out };
  },

  "POST /api/atc/upload": async (ctx) => {
    const buf = await ctx.request.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf);
    const blocks = readFplBlocks(text);
    if (!blocks.length) {
      return { error: "Không đọc được block FPL nào trong file." };
    }
    const header = ctx.request.headers.get("X-Filename") || "";
    const name = (header ? decodeURIComponent(header) : "ATC.txt").replace(/[\\/:*?"<>|]+/g, "_");
    const path = `${ATC_DIR}/${name}`;
    await putFile(ctx, path, buf, "text/plain; charset=utf-8");
    return {
      path,
      name,
      size: buf.byteLength,
      blocks: blocks.length,
      flights: blocks.map((b) => fplName(b)),
    };
  },

  "GET /api/atc/reg-context": async () => {
    return { available: false, error: AVIWEB_NOT_PORTABLE_MESSAGE, file: "", sheet: "", by_sector: {} };
  },

  // Ghi FPL lên AviWeb cần Chrome thật → giao trợ lý PC chạy atcfpl.py gốc.
  "POST /api/atc/submit": async (ctx) => {
    const p = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const path = String(p["path"] || "");
    if (!path.startsWith(ATC_DIR + "/")) return { error: "Chưa chọn file ATC." };
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      return { error: "Trợ lý PC chưa kết nối — mở cai-tro-ly.bat trên máy công ty rồi bấm Gửi FPL lại." };
    }
    return {
      id: jobId("atc_submit", {
        path,
        headless: p["headless"] !== false,
        limit: p["limit"] ?? null,
        only_labels: (p["only_labels"] as string[] | undefined) ?? [],
      }),
    };
  },

  // Port of web.py "/api/atc/check": start_atc_check() → background job whose
  // progress streams over SSE. AviWeb speaks Vaadin UIDL over plain HTTP, so
  // the check now runs right on the web server (checkFlightsOnline) — no
  // Selenium, no PC agent needed.
  "POST /api/atc/check": async (ctx) => {
    const payload = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const cs = (payload["callsigns"] as string[] | undefined) ?? [];
    if (!cs.length) return { error: "chưa có chuyến nào" };
    return { id: jobId("atc_check", { callsigns: cs }) };
  },
};

export const jobs: Jobs = {
  atc_submit: async (params, emit, ctx) => {
    const t0 = Date.now();
    const path = String(params["path"] || "");
    const end = (o: Record<string, unknown>) =>
      emit({ type: "end", code: 0, elapsed: (Date.now() - t0) / 1000, ok: 0, failed: 0, bad: [], pending: [], ...o });
    try {
      const buf = await getFile(ctx, path);
      if (!buf) throw new Error("không tìm thấy file ATC trong kho — tải file lên lại");
      const text = new TextDecoder("utf-8").decode(buf);
      const id = await pc.enqueue("aviweb_submit", {
        name: path.split("/").pop(),
        text,
        headless: params["headless"] !== false,
        limit: params["limit"] ?? null,
        only_labels: params["only_labels"] ?? [],
      });
      emit({ type: "line", text: "· đã giao trợ lý PC — Chrome trên máy công ty đang gửi FPL lên AviWeb…" });
      let last = 0;
      const r = await pc.waitResult(id, 30 * 60_000, (el) => {
        if (el - last >= 20) { last = el; emit({ type: "line", text: `· đang chờ trợ lý PC… (${Math.round(el)}s)` }); }
      });
      for (const ln of (r["lines"] as Array<{ text?: string; cls?: string }> | undefined) ?? []) {
        emit({ type: "line", text: String(ln.text ?? ""), cls: ln.cls || "" });
      }
      end({ code: Number(r["failed"] || 0) ? 2 : 0, ok: Number(r["ok"] || 0), failed: Number(r["failed"] || 0),
            bad: r["bad"] ?? [], pending: r["pending"] ?? [] });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      end({ code: 1, failed: 1 });
    }
  },

  // Port of web.py start_atc_check(): đăng nhập AviWeb bằng tài khoản đã lưu,
  // đọc 3 danh sách Processed/Unprocessed/Rejected rồi ghép theo số hiệu.
  atc_check: async (params, emit) => {
    const t0 = Date.now();
    const callsigns = (params["callsigns"] as string[] | undefined) ?? [];
    if (!callsigns.length) {
      emit({ type: "line", text: "✗ Không có chuyến nào để check.", cls: "bad" });
      emit({ type: "end", code: 1, elapsed: 0, ok: 0, failed: 1, results: [] });
      return;
    }
    try {
      const results = await checkFlightsOnline(callsigns, (text) =>
        emit({ type: "line", text, cls: "sys" }),
      );
      for (const r of results) {
        if (r.ok) emit({ type: "line", text: `✓ ${r.callsign}: ${r.status ?? "?"} · REG ${r.reg ?? "?"} · EOBT ${r.flight_time ?? "?"} · DOF ${r.dof ?? "?"}`, cls: "ok" });
        else emit({ type: "line", text: `✗ ${r.callsign}: ${r.error ?? "lỗi"}`, cls: "bad" });
      }
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      emit({ type: "end", code: failed ? 2 : 0, elapsed: (Date.now() - t0) / 1000, ok, failed, results });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, failed: 1, results: [] });
    }
  },
};
