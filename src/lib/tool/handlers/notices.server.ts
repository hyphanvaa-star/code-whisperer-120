import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import {
  defaultRuleData, cleanRuleData, preview as noticesPreview,
  pickNoticeFlights, selectNoticeSectors, noticeDuplicateGroups, type RuleRow,
} from "../port/notices";

// Port of web.py "/api/notices/*" endpoints. Rules are stored at app_settings
// key "notice_rules"; readable both as a bare array (saved by src/lib/notices.ts /
// settings.functions.ts) and as {rules:[...]} (web.py shape) for backward compat.
async function loadRules(ctx: Parameters<Routes[string]>[0]): Promise<RuleRow[]> {
  const raw = await getJson<unknown>(ctx, "notice_rules", null);
  if (Array.isArray(raw)) return raw as RuleRow[];
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).rules)) {
    return (raw as Record<string, unknown>).rules as RuleRow[];
  }
  return defaultRuleData();
}

export const routes: Routes = {
  "GET /api/notices/rules": async (ctx) => ({ rules: await loadRules(ctx), path: "notice_rules" }),

  "POST /api/notices/rules": async (ctx) => {
    try {
      const body = await ctx.json();
      const rows = (body as Record<string, unknown>)["rules"];
      if (!Array.isArray(rows)) throw new Error("rules phải là danh sách");
      const cleaned = cleanRuleData(rows);
      await setJson(ctx, "notice_rules", cleaned);
      return { rules: cleaned, path: "notice_rules", ok: true };
    } catch (exc) {
      return { error: String((exc as Error).message || exc) };
    }
  },

  "GET /api/notices/preview": async (ctx) => {
    const { loadFlights } = await import("../core/gantts.server");
    const days = Number(ctx.params.get("days") || "1") || 1;
    const cs = (ctx.params.get("callsigns") || "").split(",").filter(Boolean);
    const flights = pickNoticeFlights(await loadFlights(days), cs);
    const rules = await loadRules(ctx);
    // No local disk in the Worker: we cannot check whether a notice PDF already
    // exists on the FliteBrief sector until `defect`/attachment lookups are ported,
    // so `found` conservatively reports "not found" (missing) for every need.
    const plan = noticesPreview(flights, rules, () => false);
    let tot = 0, miss = 0;
    const byRule = new Map<string, number>();
    const missingFiles = new Map<string, number>();
    const rows = plan.map((fn) => {
      tot += fn.needs.length;
      miss += fn.needs.filter((n) => !n.found).length;
      for (const n of fn.needs) byRule.set(n.rule, (byRule.get(n.rule) ?? 0) + 1);
      for (const n of fn.needs.filter((n) => !n.found)) missingFiles.set(n.title, (missingFiles.get(n.title) ?? 0) + 1);
      return {
        sector_id: fn.flight.id,
        callsign: fn.flight.callsign,
        route: fn.flight.route,
        reg: fn.flight.reg,
        ac_type: fn.flight.ac_type || fn.flight.acft_type,
        attachment_count: fn.flight.attachment_count,
        files: fn.needs.map((n) => ({ title: n.title, rule: n.rule, found: n.found })),
      };
    });
    return {
      flights: flights.length,
      total_files: tot,
      found: tot - miss,
      missing: miss,
      by_rule: [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => ({ rule, count })),
      missing_files: [...missingFiles.entries()].sort((a, b) => b[1] - a[1]).map(([title, count]) => ({ title, count })),
      rows,
      duplicate_groups: noticeDuplicateGroups(flights),
    };
  },
};

export const jobs: Jobs = {};

// POST /api/notices/attach and POST /api/attach/auto write attachments to FliteBrief
// (web.py api/upload.py: get_session + up.upload_attachment). Porting that faithfully
// needs api/upload.py ported first (multi-step FliteBrief write flow, privilege checks,
// retry/backoff) which is out of scope for this narrow notices+limits task — stubbed
// with the same JSON error shape web.py uses for a disabled/erroring action so the UI
// shows a clear Vietnamese message instead of a silent fake success.
Object.assign(routes, {
  "POST /api/notices/attach": () => ({
    error: "Chức năng đính kèm notice (ghi vào FliteBrief) đang được chuyển sang bản mới — chưa dùng được ở đây.",
  }),
  "POST /api/attach/auto": () => ({
    error: "Chức năng tự động đính kèm (ghi vào FliteBrief) đang được chuyển sang bản mới — chưa dùng được ở đây.",
  }),
});
