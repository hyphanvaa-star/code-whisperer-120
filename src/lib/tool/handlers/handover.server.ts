import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { empty, normalize, xlsxBytes, xlsxFilename, type HandoverData } from "../port/handover";

// Port of web.py "/api/handover" + "/api/handover.xlsx" (handover.py: load/save JSON
// at handover.json, xlsx_bytes/xlsx_filename for export). Storage: app_settings key
// "excel.handover" (shared JSON, replaces the single-process handover.json file).
const KEY = "excel.handover";

async function loadHandover(ctx: Parameters<Routes[string]>[0]): Promise<HandoverData> {
  const raw = await getJson<unknown>(ctx, KEY, null);
  if (raw == null) return empty();
  return normalize(raw);
}

export const routes: Routes = {
  "GET /api/handover": async (ctx) => loadHandover(ctx),

  "POST /api/handover": async (ctx) => {
    try {
      const body = await ctx.json();
      const data = normalize(body && typeof body === "object" ? body : {});
      await setJson(ctx, KEY, data);
      return data;
    } catch (exc) {
      return { error: String((exc as Error).message || exc) };
    }
  },

  "POST /api/handover.xlsx": async (ctx) => {
    let blob: Uint8Array;
    let fname: string;
    try {
      const body = await ctx.json();
      const payload = body && typeof body === "object" ? body : {};
      blob = await xlsxBytes(payload);
      fname = xlsxFilename(payload);
    } catch (exc) {
      return { error: String((exc as Error).message || exc) };
    }
    return new Response(blob as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(blob.length),
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  },
};

export const jobs: Jobs = {};
