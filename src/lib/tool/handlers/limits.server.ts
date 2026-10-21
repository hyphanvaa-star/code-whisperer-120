import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { DefectPdfError, processUpload } from "../port/defect_pdf";

// Port of web.py limits.json endpoints ("/api/limits", "/api/limits/status").
// Storage: app_settings key "limits" — value is the {aircraft,airports,curfew,special}
// object directly (same shape saveLimits/getSetting in settings.functions.ts already use).

type LimitsData = {
  aircraft: Record<string, unknown>[];
  airports: Record<string, unknown>[];
  curfew: Record<string, unknown>[];
  special: Record<string, unknown>[];
};

function emptyLimits(): LimitsData {
  return { aircraft: [], airports: [], curfew: [], special: [] };
}

/** Port of web.py save_limits. */
function cleanLimits(payload: Record<string, unknown>): LimitsData {
  const data = emptyLimits();
  for (const key of Object.keys(data) as (keyof LimitsData)[]) {
    const val = payload[key];
    if (!Array.isArray(val)) continue;
    const cleaned: Record<string, unknown>[] = [];
    for (const raw of val) {
      if (!raw || typeof raw !== "object") continue;
      let row = raw as Record<string, unknown>;
      if (!Object.values(row).some((v) => String(v ?? "").trim())) continue;
      if (key === "curfew") {
        row = {
          code: String(row["code"] ?? "").trim(),
          start: String(row["start"] ?? row["open"] ?? "").trim(),
          end: String(row["end"] ?? row["close"] ?? row["time"] ?? "").trim(),
        };
        if (!Object.values(row).some(Boolean)) continue;
      }
      cleaned.push(row);
    }
    data[key] = cleaned;
  }
  // Không tự bù danh sách LOW EGT mẫu nữa — tôn trọng thao tác xoá/sửa của người dùng.
  return data;
}

async function loadLimits(ctx: Parameters<Routes[string]>[0]): Promise<LimitsData> {
  const raw = await getJson<Partial<LimitsData> | null>(ctx, "limits", null);
  const data = emptyLimits();
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(data) as (keyof LimitsData)[]) {
      const v = (raw as Record<string, unknown>)[key];
      data[key] = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    }
  }
  // Chỉ lấy dữ liệu gốc limits.json khi CHƯA từng lưu lần nào; đã lưu rồi thì giữ nguyên kể cả khi rỗng.
  if (raw == null) {
    const seed = (await import("../data/limits.json")).default as unknown as Partial<LimitsData>;
    for (const key of ["airports", "curfew", "special", "aircraft"] as const) {
      if (Array.isArray(seed[key])) data[key] = seed[key] as Record<string, unknown>[];
    }
  }
  return data;
}

async function saveLimits(ctx: Parameters<Routes[string]>[0], payload: Record<string, unknown>): Promise<LimitsData> {
  const data = cleanLimits(payload);
  await setJson(ctx, "limits", data);
  return data;
}

function filledCount(rows: Record<string, unknown>[], keys: string[]): number {
  let n = 0;
  for (const r of rows) if (keys.some((k) => String(r[k] ?? "").trim())) n++;
  return n;
}

export const routes: Routes = {
  "GET /api/limits": async (ctx) => {
    // Trả dữ liệu đúng như người dùng đã lưu; không tự chèn lại LOW EGT mẫu.
    return loadLimits(ctx);
  },
  "GET /api/limits/status": async (ctx) => {
    const data = await loadLimits(ctx);
    return {
      path: "limits.json",
      exists: true,
      aircraft: filledCount(data.aircraft, ["reg", "defect", "limit"]),
      airports: filledCount(data.airports, ["code", "limit"]),
      curfew: filledCount(data.curfew, ["code", "start", "end"]),
      special: filledCount(data.special, ["reg", "code", "limit"]),
      revision: String(Date.now()),
    };
  },
  "POST /api/limits": async (ctx) => {
    try {
      const body = await ctx.json();
      return await saveLimits(ctx, body && typeof body === "object" ? body : {});
    } catch (exc) {
      return { error: String((exc as Error).message || exc) };
    }
  },
  // Nhóm tàu cho giới hạn đặc biệt — ai cũng xem, chỉ admin sửa.
  "GET /api/limits/acgroups": async (ctx) => {
    const { isAdmin } = await import("../store.server");
    return { groups: await getJson(ctx, GROUPS_KEY, []), can_edit: await isAdmin(ctx) };
  },
  "POST /api/limits/acgroups": async (ctx) => {
    const { isAdmin } = await import("../store.server");
    if (!(await isAdmin(ctx))) return new Response(JSON.stringify({ error: "Chỉ admin được sửa nhóm tàu" }), { status: 403, headers: { "Content-Type": "application/json" } });
    const body = (await ctx.json().catch(() => ({}))) as { groups?: unknown };
    const groups = (Array.isArray(body.groups) ? body.groups : [])
      .map((g) => g as { name?: unknown; items?: unknown })
      .map((g) => ({ name: String(g.name ?? "").trim().slice(0, 60), items: (Array.isArray(g.items) ? g.items : []).map(String).filter(Boolean).slice(0, 500) }))
      .filter((g) => g.name);
    await setJson(ctx, GROUPS_KEY, groups);
    return { ok: true, groups };
  },
  // Danh sách tàu từ JetPlan (cache dùng chung).
  "GET /api/limits/fleet": async (ctx) => {
    const jp = await import("../jetplan.server");
    try { await jp.ensureRegs(ctx, []); } catch { /* dùng cache cũ */ }
    const cache = await getJson<{ rows?: Record<string, { name?: string; type?: string }> }>(ctx, "jetplan.ac", { rows: {} });
    const fleet = Object.entries(cache.rows || {}).map(([reg, r]) => ({ reg, name: r.name || reg, type: (r.type || "").toUpperCase() }))
      .sort((a, b) => a.reg.localeCompare(b.reg));
    return { fleet };
  },
};
const GROUPS_KEY = "limits.acgroups";

const DEFECT_SUMMARY_KEY = "defect.summary";

interface DefectSummary {
  exists: boolean;
  file: string;
  source: string;
  rows: number;
  aircraft_count: number;
  raw_rows: number;
  saved_at: string;
  aircraft: Record<string, unknown>[];
}

function emptyDefectSummary(): DefectSummary {
  return { exists: false, file: "", source: "", rows: 0, aircraft_count: 0, raw_rows: 0, saved_at: "", aircraft: [] };
}

Object.assign(routes, {
  // Port of web.py `/api/defect/status` (defect_pdf.status()).
  "GET /api/defect/status": async (ctx) => {
    const saved = await getJson<DefectSummary | null>(ctx, DEFECT_SUMMARY_KEY, null);
    return saved ?? emptyDefectSummary();
  },

  // Port of web.py `/api/defect/upload` (_api_defect_upload -> defect_pdf.process_upload).
  // Raw PDF bytes in body + X-Filename header, same convention as /api/excel/upload.
  "POST /api/defect/upload": async (ctx) => {
    const lengthHeader = ctx.request.headers.get("content-length");
    const length = lengthHeader ? Number.parseInt(lengthHeader, 10) : 0;
    const buf = await ctx.request.arrayBuffer();
    const effLen = length || buf.byteLength;
    if (!effLen) {
      return new Response(JSON.stringify({ error: "Không nhận được nội dung file" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (effLen > 50 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File PDF quá lớn (> 50 MB)" }), { status: 413, headers: { "Content-Type": "application/json" } });
    }
    const rawName = ctx.request.headers.get("x-filename") || "defect.pdf";
    let name: string;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      name = rawName;
    }
    try {
      const result = await processUpload(buf, { sourceName: name });
      const summary: DefectSummary = {
        exists: true,
        file: result["source"] as string,
        source: result["source"] as string,
        rows: result.rows,
        aircraft_count: result.aircraft_count,
        raw_rows: result.raw_rows,
        saved_at: result.saved_at,
        aircraft: result.aircraft as unknown as Record<string, unknown>[],
      };
      const { saveDefectSummary } = await import("../defect-limits.server");
      const limitsAircraft = await saveDefectSummary(ctx, { ...summary });
      return { ...summary, limits_aircraft: limitsAircraft, ok: true };
    } catch (exc) {
      if (exc instanceof DefectPdfError) {
        return new Response(JSON.stringify({ error: exc.message }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return { error: exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc) };
    }
  },
} satisfies Routes);

export const jobs: Jobs = {};

// GET /api/defect/excel — web.py _api_defect_download (defect_pdf.read_excel_bytes)
Object.assign(routes, {
  "GET /api/defect/excel": async (ctx) => {
    const s = await getJson<DefectSummary | null>(ctx, DEFECT_SUMMARY_KEY, null);
    if (!s || !s.exists || !Array.isArray(s.aircraft)) {
      return new Response("Chưa có file defect Excel đã lưu.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const { legacyExcelRows } = await import("../port/defect_pdf");
    const { loadExcelJS } = await import("@/lib/exceljs-load");
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["TÀU GIỚI HẠN", "DEFECT ẢNH HƯỞNG"]);
    for (const r of legacyExcelRows(s.aircraft as never)) ws.addRow(r);
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 80;
    const buf = await wb.xlsx.writeBuffer();
    const stem = String(s.source || s.file || "defect").replace(/\.[^.]+$/, "");
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(stem + "_output.xlsx")}"`,
      },
    });
  },
} satisfies Routes);
