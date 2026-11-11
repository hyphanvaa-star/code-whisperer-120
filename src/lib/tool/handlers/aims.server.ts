// "Tải Crewlist AIMS": downloads the Daily Flight Schedule XLSX with the user's
// own AIMS account; the page then loads it through the normal Crewlist upload.
import type { Jobs, Routes } from "../types";
import { aimsFileName, vnDate } from "../port/aims_report";

export const routes: Routes = {
  "POST /api/aims/crewlist": async (ctx) => {
    const b = await ctx.json();
    const now = new Date();
    const start = String(b["start"] || vnDate(now));
    const end = String(b["end"] || vnDate(now, 1));
    try {
      const { aimsCrewlistXlsx } = await import("../aims.server");
      const buf = await aimsCrewlistXlsx(start, end);
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
};

export const jobs: Jobs = {};
