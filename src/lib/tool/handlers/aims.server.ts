// "Tải Crewlist AIMS": downloads the Daily Flight Schedule XLSX with the user's
// own AIMS account; the page then loads it through the normal Crewlist upload.
import type { Jobs, Routes } from "../types";
import { aimsFileName, vnDate } from "../port/aims_report";
import { sameAimsRange, summarizeAimsChanges } from "../port/aims_watch";

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export const routes: Routes = {
  "POST /api/aims/crewlist": async (ctx) => {
    const b = await ctx.json();
    const now = new Date();
    const start = String(b["start"] || vnDate(now));
    const end = String(b["end"] || vnDate(now, 1));
    const fromTime = b["fromTime"] ? String(b["fromTime"]) : undefined;
    const toTime = b["toTime"] ? String(b["toTime"]) : undefined;
    try {
      const { aimsCrewlistXlsx } = await import("../aims.server");
      const buf = await aimsCrewlistXlsx(start, end, fromTime, toTime);
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "X-Filename": encodeURIComponent(aimsFileName(start, end, now)),
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
  // Tự quét AIMS: so bản AIMS mới với Crewlist đang dùng; chỉ trả file khi cần nạp lại.
  "POST /api/aims/watch": async (ctx) => {
    const b = await ctx.json();
    const now = new Date();
    const start = String(b["start"] || vnDate(now));
    const end = String(b["end"] || vnDate(now, 1));
    const fromTime = b["fromTime"] ? String(b["fromTime"]) : undefined;
    const toTime = b["toTime"] ? String(b["toTime"]) : undefined;
    try {
      const { aimsCrewlistXlsx } = await import("../aims.server");
      const { currentExcel, readSheet } = await import("./excel.server");
      const xlsdiff = await import("../port/xlsdiff");
      const buf = await aimsCrewlistXlsx(start, end, fromTime, toTime);
      const filename = aimsFileName(start, end, now);
      const checked_at = now.toISOString();
      const cur = await currentExcel(ctx);
      let oldBuf: ArrayBuffer | null = null;
      if (cur) oldBuf = await readSheet(ctx, cur.file).then((x) => x.buf).catch(() => null);
      if (!cur || !oldBuf) return { first: true, changes: [], filename, file_b64: b64(buf), checked_at };
      const same = sameAimsRange(cur.file, filename);
      const res = await xlsdiff.diff(cur.file, oldBuf, filename, buf);
      if (!same && res.warn) return { first: true, baseline: cur.file, changes: [], filename, file_b64: b64(buf), checked_at };
      const changes = summarizeAimsChanges(res, same);
      return { first: false, baseline: cur.file, changes, filename, file_b64: changes.length ? b64(buf) : undefined, checked_at };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const jobs: Jobs = {};
