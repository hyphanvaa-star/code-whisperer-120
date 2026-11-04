import { sameOpsDay } from "../port/operational_flight";
import type { Ctx, Jobs, Routes } from "../types";
import { safeFilename, Flight } from "../core/models";
import { applyFilters, loadFlights } from "../core/gantts.server";
import { getFile, getJson, listFiles, putFile, removeFiles, setJson } from "../store.server";
import * as excelcmp from "../port/excelcmp_compare";
import { ExcelError, readTable, type Sheet } from "../port/excelcmp_reader";
import * as xlsdiff from "../port/xlsdiff";
import { inOpsWindow } from "../port/notices";
import { ofpAckNeeded } from "../port/verify";
import { fbJson } from "@/lib/flitebrief.server";

/** Port of web.py attach_crews() used by compare_crew / bind_excel_row — fetches
 * crews from FliteBrief for flights that don't have them yet (same pattern as
 * core.server.ts's GET /api/flight/* crew fetch). */
async function attachCrews(flights: Flight[]): Promise<void> {
  const need = flights.filter((f) => !f.crews.length && f.crew_count);
  if (!need.length) return;
  const { fbJson } = await import("@/lib/flitebrief.server");
  const { Crew } = await import("../core/models");
  await Promise.all(
    need.map(async (f) => {
      try {
        const data = await fbJson<unknown>(`/webapi/sectors/${f.id}/crews`);
        const list = Array.isArray(data) ? data : [];
        f.crews = list.filter((c): c is Record<string, unknown> => !!c && typeof c === "object").map((c) => Crew.fromApi(c, f.id));
      } catch {
        // FliteBrief crews fetch failing shouldn't block the batch.
      }
    }),
  );
}

// Port of the web.py endpoints for group "excel". Keep JSON shapes identical to web.py.
// data/excel/<name> -> bucket path "excel/<name>"; web.py's config.EXCEL_STATE (current
// file+sheet) -> app_settings key "excel.current".

// Crewlist riêng từng người dùng: mỗi dispatcher chỉ thấy file mình nạp.
export const excelDir = (ctx: Ctx) => `excel/u/${ctx.userId}`;
export const excelStateKey = (ctx: Ctx) => `excel.current:${ctx.userId}`;
const MAX_BYTES = 30 * 1024 * 1024; // web.py config.EXCEL_MAX_BYTES (30 MB)

interface ExcelState {
  file: string;
  sheet: string;
}
export interface CurrentExcel {
  file: string;
  sheet: string;
  modified: number;
}

/** Port of web.py safe_filename() usage here. */
export function safeName(name: string): string {
  return safeFilename(name || "");
}

export async function currentExcel(ctx: Ctx): Promise<CurrentExcel | null> {
  const state = await getJson<ExcelState | null>(ctx, excelStateKey(ctx), null);
  if (!state || !state.file) return null;
  const files = await listFiles(ctx, excelDir(ctx));
  const f = files.find((x) => x.name === state.file);
  if (!f) return null;
  const modified = f.updated_at ? new Date(f.updated_at).getTime() / 1000 : (f.created_at ? new Date(f.created_at).getTime() / 1000 : 0);
  return { file: state.file, sheet: state.sheet || "", modified };
}

async function listExcel(ctx: Ctx) {
  const files = await listFiles(ctx, excelDir(ctx));
  return files
    .filter((f) => /\.(xlsx|xlsm|csv)$/i.test(f.name))
    .map((f) => ({
      file: f.name,
      size: (f.metadata as Record<string, unknown> | null)?.["size"] ?? 0,
      modified: f.updated_at ? new Date(f.updated_at).getTime() / 1000 : 0,
    }))
    .sort((a, b) => (b.modified as number) - (a.modified as number));
}

export async function readSheet(ctx: Ctx, filename: string): Promise<{ path: string; buf: ArrayBuffer; sheets: Sheet[] }> {
  const name = safeName(filename);
  const path = `${excelDir(ctx)}/${name}`;
  const buf = await getFile(ctx, path);
  if (!buf) throw new Error(`Chưa có file '${filename}' trong data/excel/`);
  const sheets = await readTable(name, buf);
  return { path, buf, sheets };
}

export function pickSheet(sheets: Sheet[], sheetName: string): Sheet {
  return sheets.find((s) => s.name === sheetName) ?? sheets[0]!;
}

async function excelRows(ctx: Ctx, filename: string, sheetName: string) {
  const { sheets } = await readSheet(ctx, filename);
  const sheet = pickSheet(sheets, sheetName);
  return {
    file: safeName(filename),
    sheet: sheet.name,
    sheets: sheets.map((s) => s.name),
    header: sheet.header,
    header_row: sheet.header_row + 1,
    rows: sheet.rows.map((r) =>
      [...r.map((v) => (v == null ? "" : String(v))), ...Array(Math.max(0, sheet.header.length - r.length)).fill("")]
    ),
  };
}

/** Port of web.py build_table(). Omni/OFP payload (PLD/EST) is not available in
 *  the Worker (needs Omni login + per-sector OFP PDF reads), so `payload` is
 *  always null here and pld_est comes back as {}. */
function buildTable(flights: Flight[], resRows: Array<Record<string, unknown>>) {
  const bySector = new Map<number, Record<string, unknown>>();
  for (const r of resRows) {
    if (r["matched"] && r["sector_id"]) {
      const sid = r["sector_id"] as number;
      if (!bySector.has(sid)) bySector.set(sid, r);
    }
  }
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return flights.map((f) => {
    const src = bySector.get(f.id);
    const cells = (src?.["cells"] as Record<string, excelcmp.Cell> | undefined) ?? {};
    const pick = (key: string) => {
      const c = cells[key];
      if (c && c.mapped) return c;
      return { verdict: "", detail: "", excel: "—", flite: "", same: null, mapped: false };
    };
    const cStd = cells["std"];
    const cEtd = cells["etd"];
    const etdExcel = cEtd && cEtd.excel && cEtd.excel !== "—" ? String(cEtd.excel) : "";
    const stdOnly = cStd && cStd.excel && cStd.excel !== "—" ? String(cStd.excel) : "";
    // Có ETD thì lấy ETD (lịch đã đổi), không thì lấy STD.
    const stdExcel = etdExcel || stdOnly;
    const stdExcelSrc = etdExcel ? "ETD" : stdOnly ? "STD" : "";
    return {
      sector_id: f.id,
      callsign: f.callsign,
      route: f.route,
      dep: f.dep_icao,
      arr: f.dest_icao,
      std: f.std ? `${pad2(f.std.getUTCDate())}/${pad2(f.std.getUTCMonth() + 1)} ${pad2(f.std.getUTCHours())}:${pad2(f.std.getUTCMinutes())}` : "",
      sta: f.sta ? `${pad2(f.sta.getUTCHours())}:${pad2(f.sta.getUTCMinutes())}` : "",
      std_excel: stdExcel,
      std_excel_src: stdExcelSrc,
      crew_std: stdOnly,
      crew_etd: etdExcel,
      dsp: f.dispatcher.split(/\s+/).filter(Boolean).join(" "),
      alt: [f.dest_alt1, f.dest_alt2, String((f.raw as Record<string, unknown>)?.["dest_alt3"] ?? "")].filter(Boolean).join(" / ") || "—",
      alt1: f.dest_alt1 || "",
      alt2: f.dest_alt2 || "",
      alt3: String((f.raw as Record<string, unknown>)?.["dest_alt3"] ?? ""),
      cfp_no: f.plan_no || "—",
      fuel: f.planned_fuel_total || f.planned_fuel,
      fuel_units: f.fuel_units,
      crew_count: f.crew_count,
      in_excel: src != null,
      excel_row: src?.["row_no"] ?? null,
      note: src?.["note"] || "",
      crew: pick("crew"),
      reg_cmp: pick("reg"),
      reg: f.reg || "—",
      pld_est: {},
    };
  });
}

async function runCompare(
  ctx: Ctx,
  filename: string,
  sheetName: string,
  flights: Flight[],
  opts: { tolerance: number; allFields: boolean },
) {
  const { sheets } = await readSheet(ctx, filename);
  const sheet = pickSheet(sheets, sheetName);
  const detected = excelcmp.detectMapping(sheet.header);
  const crewWanted = "crew" in detected || opts.allFields;
  // with_crew / Omni crew fetch is not ported here — always leave CREW pending
  // like the "fast" path of web.py's run_compare so the UI asks /api/excel/crew.
  const crewPending = crewWanted;

  let fields: string[] | null = opts.allFields ? null : [...excelcmp.TABLE_FIELDS];
  if (crewPending) {
    const keys = fields ?? excelcmp.FIELDS.map((f) => f.key);
    fields = keys.filter((k) => k !== "crew");
  }

  const res = excelcmp.compare(sheet, flights, { mapping: detected, tolerance: opts.tolerance, fields });

  const rowsOut = [...res.rows]
    .sort((a, b) => (Number(a.ok) - Number(b.ok)) || (Number(a.matched) - Number(b.matched)) || (a.row_no - b.row_no))
    .map((r) => ({
      row_no: r.row_no,
      callsign: r.callsign,
      matched: r.matched,
      sector_id: r.sector_id,
      route: r.route,
      std: r.std,
      note: r.note,
      cells: r.cells,
      diffs: r.diffs.map((d) => ({ field: d.field, label: d.label, excel: d.excel, flite: d.flite })),
    }));

  return {
    file: safeName(filename),
    sheet: res.sheet,
    sheets: sheets.map((s) => s.name),
    mapping: res.mapping,
    table: buildTable(flights, rowsOut),
    crew_pending: crewPending,
    unmapped_columns: res.unmapped_columns,
    table_columns: excelcmp.TABLE_COLUMNS.map(([k, h]) => ({ key: k, header: h })),
    tolerance: res.tolerance,
    flights_total: res.flights_total,
    summary: { rows: res.rows.length, clean: res.clean, mismatched: res.mismatched, not_found: res.not_found },
    rows: rowsOut,
  };
}


// Port of web.py _attach_dsp — fills row.dsp from FliteBrief by route + time window.
const DSP_REF_H = -7.0;
const DSP_WINDOW_H = 12.0;
const DSP_REG_TOL = 2.0;

function normRegLocal(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function attachDsp(rows: Array<Record<string, unknown>>, days = 2): Promise<void> {
  if (!rows.length) return;
  let flights: Flight[];
  try {
    flights = await loadFlights(days);
  } catch {
    return;
  }

  const byRoute = new Map<string, Flight[]>();
  for (const f of flights) {
    for (const [dep, dest] of [
      [(f.dep_iata || "").toUpperCase(), (f.dest_iata || "").toUpperCase()],
      [(f.dep_icao || "").toUpperCase(), (f.dest_icao || "").toUpperCase()],
    ] as const) {
      if (dep && dest) {
        const k = `${dep}|${dest}`;
        (byRoute.get(k) ?? byRoute.set(k, []).get(k)!).push(f);
      }
    }
  }

  for (const r of rows) {
    const [dep, dest] = String(r["route"] || "").split("-");
    const cand = byRoute.get(`${(dep || "").trim().toUpperCase()}|${(dest || "").trim().toUpperCase()}`);
    if (!cand) continue;

    const rawFlt = String(r["flt"] || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const wantCs = rawFlt ? (/[A-Z]/.test(rawFlt) ? rawFlt : `VJC${rawFlt}`) : "";

    const whens: number[] = [];
    for (const key of ["when_new", "when_old"]) {
      const s = String((r as Record<string, unknown>)[key] || "");
      if (!s) continue;
      const t = Date.parse(s);
      if (!Number.isNaN(t)) whens.push(t);
    }
    if (!whens.length) continue;

    const regObj = (r["reg"] || {}) as { old?: string; new?: string };
    const want = new Set([normRegLocal(regObj.new), normRegLocal(regObj.old)].filter(Boolean));

    const scored: Array<[number, Flight]> = [];
    for (const f of cand) {
      // Chỉ chuyến trong khung −6/+24 — không bao giờ bắt chuyến hôm qua cùng số hiệu.
      if (!f.std || !inOpsWindow(f)) continue;
      const tableDate = String(r.when_new || r.when_old || "").slice(0, 10);
      if (!sameOpsDay(f.std, tableDate)) continue;
      let bestH: number | null = null;
      for (const local of whens) {
        const diffH = (f.std.getTime() - local) / 3600000;
        if (Math.abs(diffH) <= DSP_WINDOW_H) {
          const s = Math.abs(diffH - DSP_REF_H);
          bestH = bestH == null ? s : Math.min(bestH, s);
        }
      }
      if (bestH != null) scored.push([bestH, f]);
    }
    if (!scored.length) continue;
    scored.sort((a, b) => a[0] - b[0]);

    let best: Flight;
    if (wantCs) {
      const csHit = scored.filter(([, f]) => f.callsign.toUpperCase() === wantCs);
      if (!csHit.length) continue;
      if (csHit.length !== 1) continue;
      const selected = csHit[0];
      if (!selected) continue;
      best = selected[1];
    } else {
      best = scored[0]![1];
      const hit = scored.filter(([s, f]) => s <= DSP_REG_TOL && want.has(normRegLocal(f.reg)));
      if (hit.length) best = hit[0]![1];
    }

    r["dsp"] = (best.dispatcher || "").split(/\s+/).filter(Boolean).join(" ");
    r["sector_id"] = best.id;
    r["fb_reg"] = best.reg || "";
    r["fb_callsign"] = best.callsign || "";
    r["fb_std"] = best.std ? best.std.toISOString() : null;
    r["ops_ok"] = inOpsWindow(best);
    r["ofp_ack"] = ofpAckNeeded(best);
  }
}

export const routes: Routes = {

  "GET /api/version/files": async (ctx) => {
    const cur = await currentExcel(ctx);
    const files = await listExcel(ctx);
    const listed = xlsdiff.listFiles(
      files.map((f) => ({ name: f.file as string, size: Number(f.size) || 0, modified: Number(f.modified) || 0 })),
    );
    return { files: listed, current: cur?.file || "" };
  },

  "GET /api/version/diff": async (ctx) => {
    const rawOld = (ctx.params.get("old") || "").trim();
    const rawNew = (ctx.params.get("new") || "").trim();
    if (!rawOld || !rawNew) return { error: "Cần chọn cả bản đang dùng và bản mới." };
    const oldName = safeName(rawOld);
    const newName = safeName(rawNew);
    if (oldName === newName) return { error: "Hai bản đang là cùng một file." };

    const oldBuf = await getFile(ctx, `${excelDir(ctx)}/${oldName}`);
    if (!oldBuf) return { error: `Không thấy file '${oldName}' trong data/excel/` };
    const newBuf = await getFile(ctx, `${excelDir(ctx)}/${newName}`);
    if (!newBuf) return { error: `Không thấy file '${newName}' trong data/excel/` };

    let res: xlsdiff.DiffResult;
    try {
      res = await xlsdiff.diff(oldName, oldBuf, newName, newBuf);
    } catch (e) {
      return { error: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
    }

    const rows = xlsdiff.rowsForUi(res);
    // Ngầm so 2 crewlist gần nhất (file FPL VER không có cột tổ bay).
    let crewNote = "";
    let nCrewList = 0;
    try {
      const files = (await listExcel(ctx)).filter((f) => !/\bVER\s*\d+/i.test(String(f.file)) && !String(f.file).startsWith("~$") && !String(f.file).startsWith("_crewprev_"));
      const cur = await currentExcel(ctx);
      const curIx = cur ? files.findIndex((f) => f.file === cur.file) : -1;
      const newer = curIx >= 0 ? files[curIx]! : files[0];
      const older = files.slice((curIx >= 0 ? curIx : 0) + 1).find(Boolean);
      if (newer && older) {
        const a = await getFile(ctx, `${excelDir(ctx)}/${older.file}`);
        const b = await getFile(ctx, `${excelDir(ctx)}/${newer.file}`);
        if (a && b) {
          const cres = await xlsdiff.diff(String(older.file), a, String(newer.file), b);
          const { mergeCrewlistDiff } = await import("../port/crewlist_diff");
          nCrewList = mergeCrewlistDiff(rows, cres, res.newDays);
          crewNote = `Đổi crew so crewlist ${older.file} → ${newer.file}`;
        }
      }
    } catch (e) {
      crewNote = "Không so được 2 crewlist: " + (e as Error).message;
    }
    await attachDsp(rows);

    const fmtHm = (l: xlsdiff.Leg | null) => (l?.std ? `${String(l.std.h).padStart(2, "0")}:${String(l.std.m).padStart(2, "0")}` : "");
    return {
      old_file: res.oldFile,
      new_file: res.newFile,
      old_legs: res.oldLegs,
      new_legs: res.newLegs,
      old_days: res.oldDays,
      new_days: res.newDays,
      warn: res.warn,
      crew_note: crewNote,
      n_reg: xlsdiff.nReg(res),
      n_crew: Math.max(xlsdiff.nCrew(res), nCrewList),
      n_delay: xlsdiff.nDelay(res),
      rows,
      added: xlsdiff.addedList(res).map((c) => ({ flt: c.flt, route: `${c.dep}-${c.arr}`, std: fmtHm(c.new), reg: c.new?.reg || "" })),
      removed: xlsdiff.removedList(res).map((c) => ({ flt: c.flt, route: `${c.dep}-${c.arr}`, std: fmtHm(c.old), reg: c.old?.reg || "" })),
    };
  },

  "POST /api/version/verify-ack": async (ctx) => {
    const body = await ctx.json();
    const idsRaw = body["sector_ids"];
    if (!Array.isArray(idsRaw)) return { error: "sector_ids phải là danh sách" };
    const live = body["live"] !== false;
    const days = Number.parseInt(String(body["days"] ?? "2"), 10) || 2;

    const want: number[] = [];
    const seen = new Set<number>();
    for (const raw of idsRaw) {
      const sid = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(sid) || seen.has(sid)) continue;
      seen.add(sid);
      want.push(sid);
      if (want.length >= 80) break;
    }

    const flights = await loadFlights(days);
    const byId = new Map<number, Flight>();
    for (const f of flights) if (seen.has(f.id)) byId.set(f.id, f);

    const acks: Record<string, boolean> = {};
    for (const sid of want) {
      let f = byId.get(sid);
      if (!f) continue;
      if (live) {
        try {
          const j = await fbJson<unknown>(`/webapi/sectors/${sid}`);
          let row: unknown = j;
          if (Array.isArray(j)) row = j[0] ?? {};
          else if (j && typeof j === "object" && Array.isArray((j as Record<string, unknown>)["data"])) {
            const arr = (j as Record<string, unknown>)["data"] as unknown[];
            row = arr[0] ?? {};
          }
          if (row && typeof row === "object" && (row as Record<string, unknown>)["id"]) {
            f = Flight.fromApi(row as Record<string, unknown>);
          }
        } catch {
          // giữ dữ liệu cũ nếu đọc lại lỗi
        }
      }
      if (inOpsWindow(f)) acks[String(sid)] = ofpAckNeeded(f);
    }
    return { acks, n: Object.keys(acks).length };
  },

  "GET /api/excel": async (ctx) => {
    const current = await currentExcel(ctx);
    const files = await listExcel(ctx);
    return { current, files, fields: excelcmp.FIELDS.map((f) => ({ key: f.key, label: f.label })) };
  },

  "GET /api/excel/rows": async (ctx) => {
    const state = await currentExcel(ctx);
    const fn = ctx.params.get("file") || state?.file || "";
    if (!fn) return { error: "Chưa nạp file Excel nào." };
    const sh = ctx.params.get("sheet") || state?.sheet || "";
    try {
      return await excelRows(ctx, fn, sh);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },

  "GET /api/excel/compare": async (ctx) => {
    const state = await currentExcel(ctx);
    const filename = ctx.params.get("file") || state?.file || "";
    if (!filename) return { error: "Chưa nạp file Excel nào." };
    const sheet = ctx.params.get("sheet") || state?.sheet || "";
    let tol = 0;
    const tolRaw = ctx.params.get("tolerance");
    if (tolRaw) {
      const n = Number(tolRaw);
      if (Number.isFinite(n)) tol = n;
    }
    const days = Number.parseInt(ctx.params.get("days") || "1", 10) || 1;
    const flights = applyFilters(await loadFlights(days), ctx.params);
    try {
      return await runCompare(ctx, filename, sheet, flights, {
        tolerance: tol,
        allFields: ctx.params.get("all") === "1",
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },

  "POST /api/excel/upload": async (ctx) => {
    const lengthHeader = ctx.request.headers.get("content-length");
    const length = lengthHeader ? Number.parseInt(lengthHeader, 10) : 0;
    const buf = await ctx.request.arrayBuffer();
    const effLen = length || buf.byteLength;
    if (!effLen) return new Response(JSON.stringify({ error: "Không nhận được nội dung file" }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (effLen > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: `File quá lớn (${(effLen / 1024 / 1024).toFixed(1)} MB), giới hạn ${Math.floor(MAX_BYTES / 1024 / 1024)} MB` }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    const rawName = ctx.request.headers.get("x-filename") || "upload.xlsx";
    let filename: string;
    try {
      filename = decodeURIComponent(rawName);
    } catch {
      filename = rawName;
    }
    const name = safeName(filename);
    if (!/\.(xlsx|xlsm|csv)$/i.test(name)) {
      return { error: "Đuôi file không hỗ trợ. Chỉ nhận: .xlsx, .xlsm, .csv" };
    }
    try {
      const sheets = await readTable(name, buf);
      await putFile(ctx, `${excelDir(ctx)}/${name}`, buf, "application/octet-stream");
      await setJson(ctx, excelStateKey(ctx), { file: name, sheet: sheets[0]!.name } satisfies ExcelState);
      return {
        file: name,
        path: name,
        size: buf.byteLength,
        modified: Date.now() / 1000,
        sheets: sheets.map((s) => ({
          name: s.name,
          rows: s.rows.length,
          columns: s.header,
          header_row: s.header_row + 1,
          mapping: excelcmp.detectMapping(s.header),
        })),
      };
    } catch (e) {
      if (e instanceof ExcelError || e instanceof Error) return { error: e.message };
      return { error: String(e) };
    }
  },

  "POST /api/excel/select": async (ctx) => {
    const body = await ctx.json();
    const name = safeName(String(body["file"] || ""));
    const files = await listExcel(ctx);
    if (!files.some((f) => f.file === name)) return { error: `Không có file '${name}'` };
    await setJson(ctx, excelStateKey(ctx), { file: name, sheet: String(body["sheet"] || "") } satisfies ExcelState);
    return { current: await currentExcel(ctx) };
  },

  "POST /api/excel/delete": async (ctx) => {
    const body = await ctx.json();
    const raw = String(body["file"] || "");
    const name = safeName(raw);
    if (!name || name.startsWith("~$") || name.startsWith("_")) {
      return new Response(JSON.stringify({ error: "Tên file không hợp lệ." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!/\.(xlsx|xlsm|csv)$/i.test(name)) {
      return new Response(JSON.stringify({ error: "Đuôi file không hỗ trợ. Chỉ xoá: .xlsx, .xlsm, .csv" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const files = await listExcel(ctx);
    if (!files.some((f) => f.file === name)) {
      return new Response(JSON.stringify({ error: `Không thấy file '${name}' trong data/excel/` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    await removeFiles(ctx, [`${excelDir(ctx)}/${name}`]);
    const cur = await currentExcel(ctx);
    if (cur && cur.file === name) await setJson(ctx, excelStateKey(ctx), null);
    return { ok: true, deleted: name, files: await listExcel(ctx) };
  },

  // Tên tổ bay lấy thẳng FliteBrief cho chuyến chưa khớp crewlist — chỉ để hiện, không so sánh.
  "GET /api/excel/crewnames": async (ctx) => {
    const ids = (ctx.params.get("ids") || "").split(",").map((x) => Number.parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 100);
    if (!ids.length) return { names: {} };
    const days = Number.parseInt(ctx.params.get("days") || "1", 10) || 1;
    const want = new Set(ids);
    const flights = (await loadFlights(days)).filter((f) => want.has(f.id));
    await attachCrews(flights.filter((f) => !f.crews.length));
    const names: Record<string, string> = {};
    for (const f of flights) {
      const fc = f.flight_crew.length ? f.flight_crew : f.crews;
      const txt = fc.map((c) => c.full_name).filter(Boolean).join(", ");
      if (txt) names[String(f.id)] = txt;
    }
    return { names };
  },

  "GET /api/excel/crew": async (ctx) => {
    const idsRaw = ctx.params.get("ids") || "";
    const ids = idsRaw.split(",").map((x) => Number.parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && String(n).length);
    if (!ids.length) return { crew: {} };
    if (ids.length > 200) return { error: "tối đa 200 sector mỗi lô" };

    const state = await currentExcel(ctx);
    const filename = ctx.params.get("file") || state?.file || "";
    if (!filename) return { error: "Chưa nạp file Excel nào." };
    const sheetName = ctx.params.get("sheet") || state?.sheet || "";
    const days = Number.parseInt(ctx.params.get("days") || "1", 10) || 1;
    const catalogue = await loadFlights(days);
    let flights = applyFilters(catalogue, ctx.params);
    // Explicit IDs may include Compare handover sectors from another DSP; when any
    // requested sector is outside the DSP filter, match on the same broadened set
    // as the handover Compare read instead of silently returning no crew.
    if (ids.some((id) => !flights.some((f) => f.id === id))) flights = applyFilters(catalogue, ctx.params, true);

    try {
      const { sheets } = await readSheet(ctx, filename);
      const sheet = pickSheet(sheets, sheetName);
      const detected = excelcmp.detectMapping(sheet.header);
      if (!("crew" in detected)) return { crew: {} };

      const want = new Set(ids);
      const need = flights.filter((f) => want.has(f.id) && !f.crews.length);
      if (need.length) await attachCrews(need);

      const res = excelcmp.compare(sheet, flights, { mapping: detected, tolerance: 0, fields: ["crew"] });
      const out: Record<string, unknown> = {};
      for (const r of res.rows) {
        if (!r.matched || r.sector_id == null || !want.has(r.sector_id)) continue;
        const cell = r.cells?.["crew"];
        if (cell && !(String(r.sector_id) in out)) out[String(r.sector_id)] = cell;
      }
      return { crew: out };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },

  "GET /api/excel/bind": async (ctx) => {
    const sectorId = Number.parseInt(ctx.params.get("sector_id") || "0", 10);
    const rowNo = Number.parseInt(ctx.params.get("row_no") || "0", 10);
    if (!Number.isFinite(sectorId) || !Number.isFinite(rowNo)) {
      return new Response(JSON.stringify({ error: "sector_id hoặc row_no không hợp lệ." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!sectorId || !rowNo) {
      return new Response(JSON.stringify({ error: "Thiếu chuyến hoặc số dòng crewlist." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const state = await currentExcel(ctx);
    const filename = ctx.params.get("file") || state?.file || "";
    if (!filename) return { error: "Chưa nạp file Excel nào." };
    const sheetName = ctx.params.get("sheet") || state?.sheet || "";
    const days = Number.parseInt(ctx.params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const flight = flights.find((f) => f.id === sectorId);
    if (!flight) {
      return new Response(JSON.stringify({ error: "Không thấy chuyến này trên FliteBrief." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    try {
      const { sheets } = await readSheet(ctx, filename);
      const sheet = pickSheet(sheets, sheetName);
      const mapping = excelcmp.detectMapping(sheet.header);
      const found = excelcmp.mergedRow(sheet, mapping, rowNo);
      if (!found) return { error: `Không thấy dòng ${rowNo} trong crewlist.` };
      const [no, row] = found;
      if (!flight.crews.length) await attachCrews([flight]);
      const cells = excelcmp.cellsForRow(flight, row, mapping);

      const col = (key: string): string => {
        if (!(key in mapping)) return "";
        return String(row[mapping[key]!] ?? "").trim();
      };
      const cs = col("callsign");
      const route = [col("dep"), col("dest")].filter(Boolean).join("-");
      const when = [col("date"), col("std")].filter(Boolean).join(" ");
      const empty = { verdict: "", detail: "", excel: "—", flite: "", same: null, mapped: false };
      return {
        sector_id: flight.id,
        row_no: no,
        excel_cs: cs,
        route,
        when,
        crew: cells["crew"] ?? empty,
        reg: cells["reg"] ?? empty,
        note: ["gắn tay dòng " + String(no) + ":", cs, route, when].filter(Boolean).join(" "),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};
export const jobs: Jobs = {};
