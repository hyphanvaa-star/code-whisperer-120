import type { Jobs, Routes } from "../types";
import { AVIWEB_NOT_PORTABLE_MESSAGE, readFplBlocks, fplName, checkFlightsOnline } from "../port/aviweb";
import { jobId } from "../jobs";
import { getFile, listFiles, putFile } from "../store.server";
import * as pc from "../pcagent.server";
import * as excelMod from "./excel.server";
import * as ft from "../port/fpl_tool";
import { loadFlights } from "../core/gantts.server";
import { selectOperationalFlight, validateOperationalAtc } from "../port/operational_flight";

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

  // Tab AFTN filling: lấy đúng khối FPL của một chuyến từ các file ATC đã tải
  // lên (ưu tiên file mới nhất), thay cho việc người dùng tự chọn file như
  // macro Excel gốc.
  "GET /api/atc/fpl": async (ctx) => {
    const flt = (ctx.params.get("flt") || "").replace(/\D/g, "");
    if (!flt) return { found: false, error: "Thiếu số chuyến." };
    const digits = String(parseInt(flt, 10));
    let sector;
    const catalogue = await loadFlights(3, true);
    const unique = catalogue.filter(f => [f.callsign, f.fltno, f.commercial_fltno].some(cs => String(cs || "").replace(/\D/g, "").replace(/^0+/, "") === digits));
    const selectedId = ctx.params.get("sector_id") || (unique.length === 1 ? unique[0]?.id : null);
    try { sector = selectOperationalFlight(catalogue, {
      flt: digits, sector_id: selectedId, date: ctx.params.get("date"),
      dep: ctx.params.get("dep"), arr: ctx.params.get("arr"),
    }); } catch (e) { return { found: false, error: (e as Error).message }; }
    const files = await listFiles(ctx, ATC_DIR).catch(() => []);
    for (let i = files.length - 1; i >= 0; i--) {
      const file = files[i];
      if (!file) continue;
      const buf = await getFile(ctx, `${ATC_DIR}/${file.name}`);
      if (!buf) continue;
      for (const block of readFplBlocks(new TextDecoder("utf-8").decode(buf))) {
        try { validateOperationalAtc(block, sector); }
        catch { continue; }
        return { found: true, text: block, file: file.name, name: fplName(block) };
      }
    }
    // Không có trong file ATC → đọc thẳng OFP trên FliteBrief (đã release hay
    // chưa đều lấy qua View OFP /ofp/0 rồi /ofp), giống nút Get ATC.
    try {
      const { fetchAtcBlocks } = await import("./fpl.server");
      const { got, missed } = await fetchAtcBlocks([{ flt: digits, sector_id: sector.id }]);
      const g = got.find((x) => String(x.block || "").trim());
      if (g) return { found: true, text: g.block.trim(), file: `OFP ${g.f?.callsign || "VJC" + digits}${g.plan ? " CFP " + g.plan : ""}`, name: g.f?.callsign || `VJC${digits}` };
      return { found: false, error: `Không lấy được FPL VJC${digits} từ OFP: ${missed.join("; ") || "OFP không có khối ATC FPL"}` };
    } catch (e) {
      return { found: false, error: `Không đọc được OFP VJC${digits}: ${(e as Error).message}` };
    }
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

  // Port of web.py "/api/atc/reg-context": map each FliteBrief sector to the
  // matching row of the Crewlist currently loaded (flight no + date + DEP/ARR).
  "GET /api/atc/reg-context": async (ctx) => {
    const state = await excelMod.currentExcel(ctx);
    if (!state) return { available: false, error: "Chưa nạp Crewlist Excel.", file: "", sheet: "", by_sector: {} };
    let crew: Record<string, any>[] = [];
    let sheetName = state.sheet || "";
    try {
      const { sheets } = await excelMod.readSheet(ctx, state.file);
      if (sheets.length) {
        const sh = excelMod.pickSheet(sheets, state.sheet) as any;
        sheetName = sh.name || sheetName;
        crew = ft.flights_from_crew_sheet(sh);
      }
    } catch (e) {
      return { available: false, error: "Không đọc được Crewlist: " + (e as Error).message, file: state.file, sheet: sheetName, by_sector: {} };
    }
    const days = parseInt(ctx.params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days, false);
    const num = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d ? String(parseInt(d, 10)) : ""; };
    const ddmm = (d: Date | null) => d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "";
    const crewDate = (s: string) => { const m = String(s).match(/^(\d{1,2})[/.-](\d{1,2})/); return m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}` : ""; };
    const by_sector: Record<string, unknown> = {};
    for (const f of flights) {
      const fr = f as unknown as Record<string, any>;
      const n = num(fr.fltno || fr.commercial_fltno || fr.callsign);
      if (!n) continue;
      const dep = [fr.dep_iata, fr.dep_icao].map((x: string) => String(x || "").toUpperCase());
      const arr = [fr.dest_iata, fr.dest_icao].map((x: string) => String(x || "").toUpperCase());
      const sameFlt = crew.filter((c) => c.flt === n);
      let cands = sameFlt.filter((c) => (!c.dep || dep.includes(c.dep)) && (!c.arr || arr.includes(c.arr)));
      const day = ddmm(fr.std as Date | null);
      if (day) {
        const byDay = cands.filter((c) => crewDate(c.date) === day);
        cands = byDay;
      }
      if (cands.length !== 1) continue;
      const c = cands[0];
      if (!c) continue;
      by_sector[String(f.id)] = {
        crewlist_reg: c.reg, row_no: c.row, file: state.file, sheet: sheetName,
        safe: cands.length === 1,
        note: cands.length === 1 ? "" : `Crewlist có ${cands.length} dòng trùng chuyến ${n} — bấm để chọn đúng dòng`,
      };
    }
    return { available: true, error: "", file: state.file, sheet: sheetName, by_sector };
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
    const flights = await loadFlights(3, true);
    const items = Array.isArray(payload.items) ? payload.items as Record<string, unknown>[] : [];
    const identities: Record<string, { dof: string; dep: string; arr: string }> = {};
    try {
      for (const callsign of cs) {
        const spec = items.find(it => String(it.flt).replace(/\D/g, '') === callsign.replace(/\D/g, ''));
        const candidates = flights.filter(f => f.callsign.toUpperCase() === callsign.toUpperCase());
        const f = spec ? selectOperationalFlight(flights, spec) : candidates.length === 1 ? candidates[0] : null;
        if (!f?.std) throw new Error(`${callsign}: cần chọn đúng ngày/chặng trong khung −6/+24 giờ.`);
        identities[callsign.toUpperCase()] = { dof: f.std.toISOString().slice(2, 10).replace(/-/g, ''), dep: f.dep_icao, arr: f.dest_icao };
      }
    } catch (e) { return { error: (e as Error).message }; }
    return { id: jobId("atc_check", { callsigns: cs, identities }) };
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
      const catalogue = await loadFlights(3, true);
      const labels = Array.isArray(params.only_labels) ? params.only_labels.map(String) : [];
      const blocks = readFplBlocks(text).filter(block => !labels.length || labels.includes(fplName(block)));
      if (!blocks.length) throw new Error("Không có FPL đã chọn để gửi.");
      for (const block of blocks) {
        const candidates = catalogue.filter(f => f.callsign === fplName(block));
        const matching = candidates.filter(f => { try { validateOperationalAtc(block, f); return true; } catch { return false; } });
        if (matching.length !== 1) throw new Error(`${fplName(block)}: điện văn không khớp duy nhất ngày/chặng trong −6/+24 — không gửi.`);
      }
      const id = await pc.enqueue("aviweb_submit", {
        name: path.split("/").pop(),
        text: blocks.join("\n\n"),
        headless: params["headless"] !== false,
        limit: params["limit"] ?? null,
        only_labels: params["only_labels"] ?? [],
      });
      emit({ type: "line", text: "· đã giao trợ lý PC — Chrome trên máy công ty đang gửi FPL lên AviWeb…" });
      let last = 0;
      let shown = 0; // số dòng log của trợ lý PC đã hiện lên tab Công cụ hỗ trợ
      const relay = (lines: Array<{ text?: string; cls?: string }> | undefined) => {
        const arr = lines ?? [];
        for (; shown < arr.length; shown++) {
          const ln = arr[shown];
          emit({ type: "line", text: String(ln?.text ?? ""), cls: ln?.cls || "" });
        }
      };
      const r = await pc.waitResult(id, 30 * 60_000, (el, partial) => {
        relay(partial?.["lines"] as Array<{ text?: string; cls?: string }> | undefined);
        if (!shown && el - last >= 20) { last = el; emit({ type: "line", text: `· đang chờ trợ lý PC… (${Math.round(el)}s)` }); }
      });
      relay(r["lines"] as Array<{ text?: string; cls?: string }> | undefined);
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
      const identities = params.identities as Record<string, { dof: string; dep: string; arr: string }> | undefined;
      if (!identities) throw new Error("Lệnh cũ thiếu ngày/chặng — bấm Check lại.");
      const current = await loadFlights(3, true);
      for (const cs of callsigns) {
        const ident = identities[cs.toUpperCase()];
        if (!ident || !current.some(f => f.callsign.toUpperCase() === cs.toUpperCase() && f.std?.toISOString().slice(2, 10).replace(/-/g, '') === ident.dof && f.dep_icao === ident.dep && f.dest_icao === ident.arr)) throw new Error(`${cs}: chuyến đã ngoài khung hoặc thay đổi — Check lại.`);
      }
      const results = await checkFlightsOnline(callsigns, text => emit({ type: "line", text, cls: "sys" }), identities);
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
