import type { Ctx, Jobs, Routes } from "../types";
import { safeFilename, type Flight } from "../core/models";
import { applyFilters, loadFlights } from "../core/gantts.server";
import { getFile, getJson, listFiles, putFile, removeFiles, setJson } from "../store.server";
import * as excelcmp from "../port/excelcmp_compare";
import { ExcelError, readTable, type Sheet } from "../port/excelcmp_reader";

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

const EXCEL_DIR = "excel";
const STATE_KEY = "excel.current";
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
  const state = await getJson<ExcelState | null>(ctx, STATE_KEY, null);
  if (!state || !state.file) return null;
  const files = await listFiles(ctx, EXCEL_DIR);
  const f = files.find((x) => x.name === state.file);
  if (!f) return null;
  const modified = f.updated_at ? new Date(f.updated_at).getTime() / 1000 : (f.created_at ? new Date(f.created_at).getTime() / 1000 : 0);
  return { file: state.file, sheet: state.sheet || "", modified };
}

async function listExcel(ctx: Ctx) {
  const files = await listFiles(ctx, EXCEL_DIR);
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
  const path = `${EXCEL_DIR}/${name}`;
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
    const stdExcel = cStd && cStd.excel && cStd.excel !== "—" ? String(cStd.excel) : "";
    return {
      sector_id: f.id,
      callsign: f.callsign,
      route: f.route,
      dep: f.dep_icao,
      arr: f.dest_icao,
      std: f.std ? `${pad2(f.std.getUTCDate())}/${pad2(f.std.getUTCMonth() + 1)} ${pad2(f.std.getUTCHours())}:${pad2(f.std.getUTCMinutes())}` : "",
      sta: f.sta ? `${pad2(f.sta.getUTCHours())}:${pad2(f.sta.getUTCMinutes())}` : "",
      std_excel: stdExcel,
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

export const routes: Routes = {
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
      await putFile(ctx, `${EXCEL_DIR}/${name}`, buf, "application/octet-stream");
      await setJson(ctx, STATE_KEY, { file: name, sheet: sheets[0]!.name } satisfies ExcelState);
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
    await setJson(ctx, STATE_KEY, { file: name, sheet: String(body["sheet"] || "") } satisfies ExcelState);
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
    await removeFiles(ctx, [`${EXCEL_DIR}/${name}`]);
    const cur = await currentExcel(ctx);
    if (cur && cur.file === name) await setJson(ctx, STATE_KEY, null);
    return { ok: true, deleted: name, files: await listExcel(ctx) };
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
    const flights = applyFilters(await loadFlights(days), ctx.params);

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
