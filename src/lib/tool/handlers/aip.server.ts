import type { Jobs, Routes } from "../types";
import * as aipRffs from "../port/aip_rffs";

// Port of the web.py "/api/aip/*" endpoints (aip_rffs.py). Keep JSON shapes
// identical to web.py. Open-in-Chrome needs a real Chrome on the dispatcher's
// PC and is not available in this Worker runtime.
export const routes: Routes = {
  "GET /api/aip/lookup": async (ctx) => {
    const icao = ctx.params.get("icao") ?? "";
    const query = ctx.params.get("q") ?? ctx.params.get("query") ?? ctx.params.get("topic") ?? "";
    return aipRffs.lookup(icao, { query });
  },

  "GET /api/aip/view": async (ctx) => {
    const icao = aipRffs.icaoOf(ctx.params.get("icao") ?? "");
    const query = ctx.params.get("q") ?? ctx.params.get("query") ?? "";
    try {
      const { blob, contentType } = await aipRffs.viewPage(icao, query);
      return new Response(blob, {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=1800" },
      });
    } catch (exc) {
      return new Response(String((exc as Error)?.message ?? exc), {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },

  "GET /api/aip/open": async (ctx) => {
    // web.py mở Chrome thật trên máy dispatcher (self-service “tick mở Chrome”).
    // Worker này không chạy được trình duyệt — báo lỗi tiếng Việt như web.py
    // trả khi aip_rffs.open_chrome thất bại, không giả vờ thành công.
    const url = ctx.params.get("u") ?? "";
    return {
      ok: false,
      url,
      error: "Không mở được Chrome: máy chủ không có trình duyệt. Hãy mở link này trên máy dispatcher.",
    };
  },
};

export const jobs: Jobs = {};
