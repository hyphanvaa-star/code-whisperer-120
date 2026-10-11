import { env as credEnv } from "../creds.server";
/**
 * Port of the web.py endpoints that need the company PC: in GD tới máy RICOH,
 * đường dẫn ổ D:, tải Omni xuống D:\Omni. The PC-side work runs in the PC
 * agent (pcagent.server.ts); these handlers keep web.py's exact JSON shapes.
 */
import type { Ctx, Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import { getJson, setJson, getFile } from "../store.server";
import * as pc from "../pcagent.server";
import * as gd from "../port/gd_print";
import * as omni from "../port/omni";
import "../omni_session.server";
import { readTable, sheetDicts } from "../port/excelcmp_reader";
import { detectMapping } from "../port/excelcmp_compare";

// config.PATH_KEYS — label + default folder on the company PC.
const PATH_KEYS: Record<string, [string, string]> = {
  notice: ["Folder notice (file cần add)", "\\\\172.30.85.253\\OMCFile\\VJC Files - OMC\\OMC PRIVATE\\HY\\EGTM-LIMIT-NOTICE"],
  briefing: ["Folder briefing", "D:\\"],
  reg: ["Folder RegNotice (tách MEL)", "D:\\regnotice"],
  pibwx: ["Folder PIB + WX (tải về)", "D:\\Pib+wx"],
  fpl: ["Folder Flight Plan (Outlook)", "D:\\FPL"],
  omni: ["Folder Omni (EST)", "D:\\Omni"],
  atcezfw: ["Folder ATC + EZFW", "D:\\ATC-EZFW"],
};

const PATHS_KEY = "tool.paths";
const PRINTER_KEY = "gd.printer";
const OMNI_AUTO_KEY = "omni.auto";

type SavedPaths = Record<string, string>;

interface OmniAutoState {
  enabled: boolean;
  last_at: number;
  last_file: string;
  last_path: string;
  last_count: number;
  last_error: string;
  last_try?: number;
}

const OMNI_AUTO_DEFAULT: OmniAutoState = {
  enabled: false,
  last_at: 0,
  last_file: "",
  last_path: "",
  last_count: 0,
  last_error: "",
};

/** Máy công ty không có ổ D (trợ lý PC báo "D:\\" = false) thì D:\\... hiển thị/ghi sang C:\\... */
function driveFix(path: string, agent: pc.AgentInfo | null | undefined): string {
  if (/^d:/i.test(path) && agent?.paths_exist?.["D:\\"] === false) return "C:" + path.slice(2);
  return path;
}

/** Port of config.paths_status() — exists flags come from the agent heartbeat. */
async function pathsStatus(ctx: Ctx) {
  const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
  const agent = await pc.agentInfo(ctx);
  const existsMap = agent?.paths_exist ?? {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [kind, [label, dflt]] of Object.entries(PATH_KEYS)) {
    const custom = (saved[kind] || "").trim();
    const path = driveFix(custom || dflt, agent);
    out[kind] = {
      label,
      path,
      default: dflt,
      source: custom ? "file" : "default",
      exists: existsMap[custom || dflt] ?? existsMap[path] ?? false,
    };
  }
  return { paths: out, file: "paths.json" };
}

/** Folder notice hiện hành trên máy công ty (đường dẫn đã lưu hoặc mặc định). */
export async function noticeDir(ctx: Ctx): Promise<string> {
  const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
  const agent = await pc.agentInfo(ctx);
  return driveFix((saved["notice"] || "").trim() || PATH_KEYS["notice"]![1], agent);
}

/** Port of gd_print.resolve_printer() against the agent's printer list. */
function resolvePrinter(saved: string, printers: pc.AgentPrinter[]): string {
  const names = printers.map((p) => p.name);
  if (saved && names.includes(saved)) return saved;
  const ricoh = printers.find((p) => /ricoh/i.test(p.name));
  if (ricoh) return ricoh.name;
  const dflt = printers.find((p) => p.default);
  if (dflt) return dflt.name;
  return saved || "—";
}

/** Port of gd_print.crew_regs_for_digits() on the uploaded Crewlist Excel.
 *  Trả thêm ngày chuyến (YYYY-MM-DD) để trợ lý chỉ nhận thư GD đúng ngày. */
async function crewRegsFor(ctx: Ctx, flight: string): Promise<{ regs: string[]; date: string | null }> {
  const state = await getJson<{ file: string; sheet: string } | null>(ctx, "excel.current", null);
  if (!state) throw new Error("Chưa nạp Crewlist Excel.");
  const buf = await getFile(ctx, `excel/${state.file}`);
  if (!buf) throw new Error("Không đọc được file Crewlist đã nạp.");
  const sheets = await readTable(state.file, buf);
  if (!sheets.length) return [];
  const sheet = sheets.find((s) => s.name === state.sheet) ?? sheets[0]!;
  const mapping = detectMapping(sheet.header);
  if (!mapping["callsign"] || !mapping["reg"]) {
    throw new Error("Crewlist thiếu cột FLT/callsign hoặc REG.");
  }
  const want = gd.digitsOf(flight);
  const out: string[] = [];
  const seen = new Set<string>();
  let date: string | null = null;
  for (const row of sheetDicts(sheet)) {
    const cs = String(row[mapping["callsign"]] ?? "");
    if (!gd.containsFlight(cs, want)) continue;
    if (!date && mapping["date"]) {
      const d = normDate(row[mapping["date"]!]);
      if (d) date = d.toISOString().slice(0, 10);
    }
    const raw = String(row[mapping["reg"]] ?? "").trim();
    const key = gd.normalizeReg(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(gd.prettyReg(raw));
  }
  return { regs: out, date };
}

function omniCreds(): omni.OmniCredentials {
  const username = credEnv("OMNI_USERNAME");
  const password = credEnv("OMNI_PASSWORD");
  if (!username || !password) throw new Error("chưa có tài khoản Omni");
  return { username, password };
}

/** Port of omni._get_report_bytes() — nút "Xuất dữ liệu" → cargo-report.xlsx. */
async function omniExportBytes(day: string): Promise<Uint8Array> {
  const { session } = await omni.login(omniCreds());
  const r = await fetch(omni.API + omni.FLIGHTS_EXPORT, {
    method: "POST",
    headers: omni.headers(session),
    body: JSON.stringify({ flightDate: day }),
  });
  if (r.status !== 200) throw new Error(`tải báo cáo Omni lỗi: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("phản hồi Omni export không phải file XLSX");
  return buf;
}

/** omni_watch.report_name(): "cargo-report 2026-08-23 10h.xlsx". */
function reportName(day: string, at = new Date()): string {
  return `cargo-report ${day} ${String(at.getHours()).padStart(2, "0")}h.xlsx`;
}

async function omniAutoStatus(ctx: Ctx) {
  const state = await getJson<OmniAutoState>(ctx, OMNI_AUTO_KEY, OMNI_AUTO_DEFAULT);
  const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
  const dest = driveFix((saved["omni"] || "").trim() || PATH_KEYS["omni"]![1], await pc.agentInfo(ctx));
  return {
    ...state,
    dest,
    busy: false,
    next_at: state.enabled
      ? Math.max(state.last_at + 60 * 60, state.last_error ? (state.last_try || 0) + 10 * 60 : 0)
      : 0,
  };
}

/** Port of omni_watch.run_once(): tải XLSX hôm nay + ngày mai, ghi xuống D:\Omni qua trợ lý PC. */
async function omniAutoRun(ctx: Ctx) {
  const agent = await pc.agentInfo(ctx);
  if (!pc.agentOnline(agent)) {
    throw new Error("trợ lý PC chưa kết nối — mở trợ lý trên máy công ty rồi bấm lại");
  }
  const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
  const dest = (saved["omni"] || "").trim() || PATH_KEYS["omni"]![1];
  const [f, t] = omni.defaultSpan();
  const files: string[] = [];
  let lastPath = "";
  for (const day of [f, t]) {
    const bytes = await omniExportBytes(day);
    const name = reportName(day);
    const id = await pc.enqueue("save_file", {
      dir: dest,
      name,
      data_b64: Buffer.from(bytes).toString("base64"),
    });
    const r = await pc.waitResult(id, 120_000);
    files.push(name);
    lastPath = String(r["path"] || `${dest}\\${name}`);
  }
  const state: OmniAutoState = {
    ...(await getJson<OmniAutoState>(ctx, OMNI_AUTO_KEY, OMNI_AUTO_DEFAULT)),
    last_at: Date.now() / 1000,
    last_file: files.join(" + "),
    last_path: lastPath,
    last_count: files.length,
    last_error: "",
  };
  await setJson(ctx, OMNI_AUTO_KEY, state);
  return omniAutoStatus(ctx);
}

export const routes: Routes = {
  "GET /api/gd/printers": async (ctx) => {
    const agent = await pc.agentInfo(ctx);
    const saved = await getJson<string>(ctx, PRINTER_KEY, "");
    if (!pc.agentOnline(agent)) {
      return {
        printers: [],
        saved,
        using: saved || "—",
        error: "trợ lý PC chưa kết nối — mở trợ lý trên máy công ty để in GD",
      };
    }
    const printers = agent!.printers ?? [];
    return { printers, saved, using: resolvePrinter(saved, printers) };
  },

  "POST /api/gd/printer": async (ctx) => {
    const body = await ctx.json();
    const name = String(body["name"] || "");
    await setJson(ctx, PRINTER_KEY, name);
    const agent = await pc.agentInfo(ctx);
    const using = pc.agentOnline(agent)
      ? resolvePrinter(name, agent!.printers ?? [])
      : name || "—";
    return { saved: name, using };
  },

  "POST /api/gd/print": async (ctx) => {
    const body = await ctx.json();
    const flight = String(body["flight"] || "").trim();
    if (!flight) return { error: "Nhập số hiệu, ví dụ 3948 hoặc 3948 3900." };
    return { id: jobId("gd_print", { flight }) };
  },

  "GET /api/paths": async (ctx) => pathsStatus(ctx),

  "POST /api/paths": async (ctx) => {
    const body = await ctx.json();
    const updates = body["paths"];
    if (!updates || typeof updates !== "object") {
      return { error: "payload paths phải là object" };
    }
    const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
    for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
      if (!(k in PATH_KEYS)) return { error: `loại đường dẫn không hợp lệ: ${k}` };
      const p = String(v || "").trim();
      if (!p) delete saved[k];
      else saved[k] = p;
    }
    await setJson(ctx, PATHS_KEY, saved);
    return { ok: true, ...(await pathsStatus(ctx)) };
  },

  "POST /api/paths/pick": async (ctx) => {
    const body = await ctx.json();
    const kind = String(body["kind"] || "").trim();
    if (!(kind in PATH_KEYS)) return { error: `loại không hợp lệ: ${kind}` };
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      return { error: "trợ lý PC chưa kết nối — mở trợ lý trên máy công ty để chọn thư mục" };
    }
    const [label] = PATH_KEYS[kind]!;
    const id = await pc.enqueue("pick_folder", { title: `Chọn — ${label}` });
    let r: Record<string, unknown>;
    try {
      r = await pc.waitResult(id, 180_000);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const chosen = String(r["path"] || "").trim();
    if (!chosen) return { ok: false, cancelled: true };
    const saved = await getJson<SavedPaths>(ctx, PATHS_KEY, {});
    saved[kind] = chosen;
    await setJson(ctx, PATHS_KEY, saved);
    return { ok: true, ...(await pathsStatus(ctx)) };
  },

  "GET /api/omni/auto": async (ctx) => omniAutoStatus(ctx),

  "POST /api/omni/auto": async (ctx) => {
    const body = await ctx.json();
    if (body["run"]) {
      try {
        return await omniAutoRun(ctx);
      } catch (e) {
        const state = await getJson<OmniAutoState>(ctx, OMNI_AUTO_KEY, OMNI_AUTO_DEFAULT);
        await setJson(ctx, OMNI_AUTO_KEY, { ...state, last_error: (e as Error).message, last_try: Date.now() / 1000 });
        return { error: (e as Error).message };
      }
    }
    if ("enabled" in body) {
      const state = await getJson<OmniAutoState>(ctx, OMNI_AUTO_KEY, OMNI_AUTO_DEFAULT);
      await setJson(ctx, OMNI_AUTO_KEY, { ...state, enabled: !!body["enabled"] });
      return omniAutoStatus(ctx);
    }
    return omniAutoStatus(ctx);
  },
};

export const jobs: Jobs = {
  // Port of web.py start_gd_print(): đối chiếu tàu crewlist rồi giao trợ lý PC
  // tải GD từ Outlook GENDEC và in ra máy RICOH.
  gd_print: async (params, emit, ctx) => {
    const t0 = Date.now();
    const flight = String(params["flight"] || "").trim();
    const wants = gd.flightsOf(flight);
    if (!wants.length) {
      emit({ type: "line", text: "✗ Không thấy số hiệu chuyến.", cls: "bad" });
      emit({ type: "end", code: 1, elapsed: 0, ok: 0, failed: 1, match: false });
      return;
    }
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: "✗ Trợ lý PC chưa kết nối — mở trợ lý trên máy công ty rồi in lại.", cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, failed: 1, match: false });
      return;
    }
    try {
      const checks: Array<{ gd_reg: string; file_name: string }> = [];
      for (const [i, want] of wants.entries()) {
        if (wants.length > 1) emit({ type: "line", text: `── ${want} (${i + 1}/${wants.length})` });
        const regs = await crewRegsFor(ctx, want);
        if (!regs.length) throw new Error(`Crewlist không có chuyến ${want}.`);
        emit({ type: "line", text: `· ${want} crewlist: ${regs.join(" / ")}` });
        const printer = await getJson<string>(ctx, PRINTER_KEY, "");
        const id = await pc.enqueue("gd_print", {
          flight: want,
          crew_regs: regs,
          printer,
          dest: "D:\\GD",
        });
        emit({ type: "line", text: "· đã gửi lệnh cho trợ lý PC — đang tải GD và in…" });
        let lastBeat = 0;
        const r = await pc.waitResult(id, 300_000, (elapsed) => {
          if (elapsed - lastBeat >= 20) {
            lastBeat = elapsed;
            emit({ type: "line", text: `· đang chờ trợ lý PC… (${Math.round(elapsed)}s)` });
          }
        });
        const lines = (r["lines"] as Array<{ text?: string; cls?: string } | string> | undefined) ?? [];
        for (const ln of lines) {
          if (typeof ln === "string") emit({ type: "line", text: ln });
          else emit({ type: "line", text: String(ln.text ?? ""), cls: ln.cls || "" });
        }
        checks.push({
          gd_reg: String(r["gd_reg"] || ""),
          file_name: String(r["file"] || ""),
        });
      }
      emit({
        type: "end",
        code: 0,
        elapsed: (Date.now() - t0) / 1000,
        ok: checks.length,
        failed: 0,
        match: true,
        gd_reg: checks.map((c) => c.gd_reg).filter(Boolean).join(" / "),
        file: checks.map((c) => c.file_name).filter(Boolean).join(", "),
      });
    } catch (e) {
      const agentLines = ((e as { lines?: unknown }).lines as Array<{ text?: string; cls?: string } | string> | undefined) ?? [];
      for (const ln of agentLines) {
        if (typeof ln === "string") emit({ type: "line", text: ln });
        else emit({ type: "line", text: String(ln.text ?? ""), cls: ln.cls || "" });
      }
      emit({ type: "line", text: `✗ ${(e as Error).message}`, cls: "bad" });
      const ver = String(agent?.version || "");
      const [maj, min] = ver.split(".").map((n) => Number(n) || 0);
      if (maj < 4 || (maj === 4 && min < 1)) {
        emit({ type: "line", text: `⚠ máy công ty đang chạy trợ lý v${ver || "?"} — cần cài bản v4.1 trở lên để tìm GD.`, cls: "bad" });
      }
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, failed: 1, match: false });
    }
  },
};
