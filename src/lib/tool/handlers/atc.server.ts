import type { Jobs, Routes } from "../types";
import { AVIWEB_NOT_PORTABLE_MESSAGE, readFplBlocks, fplName, checkFlightsOnline } from "../port/aviweb";
import { jobId } from "../jobs";

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
  "GET /api/atc/files": async () => {
    // web.py lists previously-uploaded ATC files from local disk (data dir on the
    // dispatcher's PC). That directory does not exist in this runtime; nothing was
    // ever uploaded here either, so the honest list is empty.
    return { files: [], error: AVIWEB_NOT_PORTABLE_MESSAGE };
  },

  "POST /api/atc/upload": async (ctx) => {
    const buf = await ctx.request.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf);
    const blocks = readFplBlocks(text);
    if (!blocks.length) {
      return { error: "Không đọc được block FPL nào trong file." };
    }
    const header = ctx.request.headers.get("X-Filename") || "";
    const name = header ? decodeURIComponent(header) : "ATC.txt";
    // Parsing works fully offline; submitting to AviWeb still needs the PC
    // agent's real browser.
    return {
      path: "",
      name,
      size: buf.byteLength,
      blocks: blocks.length,
      flights: blocks.map((b) => fplName(b)),
      error: AVIWEB_NOT_PORTABLE_MESSAGE,
    };
  },

  "GET /api/atc/reg-context": async () => {
    return { available: false, error: AVIWEB_NOT_PORTABLE_MESSAGE, file: "", sheet: "", by_sector: {} };
  },

  "POST /api/atc/submit": async () => {
    return { error: AVIWEB_NOT_PORTABLE_MESSAGE };
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
        if (r.ok) emit({ type: "line", text: `✓ ${r.callsign}: ${r.status ?? "?"}${r.flight_time ? " · " + r.flight_time : ""}`, cls: "ok" });
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
