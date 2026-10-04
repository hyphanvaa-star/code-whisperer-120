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
    // "found" = file PDF của notice đã có trong kho "notices/" (Rule Studio upload).
    const { listFiles } = await import("../store.server");
    const stored = new Set(
      (await listFiles(ctx, "notices").catch(() => [] as Array<{ name: string }>))
        .map((f) => f.name.replace(/\.pdf$/i, "").trim().toLowerCase()),
    );
    const plan = noticesPreview(flights, rules, (title) => stored.has(title.trim().toLowerCase()));
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

// Port of web.py _api_notice_rule_file(): upload một PDF notice từ Rule Studio
// into store (web.py saves to the Notice folder on disk; here we keep it in
// the private bucket under notices/<safe-name>.pdf so Rule Studio can refer to
// it by title the same way).
Object.assign(routes, {
  "POST /api/notices/rule-file": async (ctx: Parameters<Routes[string]>[0]) => {
    const { putFile } = await import("../store.server");
    const buf = await ctx.request.arrayBuffer();
    if (!buf.byteLength) return { error: "Không nhận được nội dung file" };
    if (buf.byteLength > 50 * 1024 * 1024) return { error: "File PDF quá lớn (> 50 MB)" };
    const header = ctx.request.headers.get("X-Filename") || "";
    const raw = header ? decodeURIComponent(header) : "notice.pdf";
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").trim() || "notice.pdf";
    const name = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
    const title = name.replace(/\.pdf$/i, "");
    await putFile(ctx, `notices/${name}`, buf, "application/pdf");
    return { ok: true, title, name, size: buf.byteLength };
  },
});
