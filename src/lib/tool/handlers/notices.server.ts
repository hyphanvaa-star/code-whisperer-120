import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { jobId } from "../jobs";
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
    const lib = await noticeLibrary(ctx);
    const plan = noticesPreview(flights, rules, (title) => lib.has(normTitle(title)));
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
      library: lib.size,
      by_rule: [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => ({ rule, count })),
      missing_files: [...missingFiles.entries()].sort((a, b) => b[1] - a[1]).map(([title, count]) => ({ title, count })),
      rows,
      duplicate_groups: noticeDuplicateGroups(flights),
    };
  },

  "POST /api/notices/attach": async (ctx) => {
    const body = await ctx.json();
    const callsigns = ((body["callsigns"] as unknown[]) ?? []).map(String).filter(Boolean);
    if (!callsigns.length) return { error: "Bảng đang trống." };
    return {
      id: jobId("notice_attach", {
        days: Number(body["days"] ?? 1) || 1,
        callsigns,
        sector_ids: (body["sector_ids"] as unknown[]) ?? [],
        force_existing: !!body["force_existing"],
      }),
    };
  },
};

type Ctx = Parameters<Routes[string]>[0];
const normTitle = (t: string) => String(t || "").replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Thư mục file tạm của phiên đăng nhập hiện tại. */
function tmpDir(ctx: Ctx): string {
  return `notices-tmp/${ctx.userId}/${(ctx.sessionId || "nosession").replace(/[^a-zA-Z0-9-]/g, "")}`;
}

/** Tên chuẩn hoá → đường dẫn file trong kho (kho chung + file tạm của phiên này). */
async function noticeLibrary(ctx: Ctx): Promise<Map<string, string>> {
  const { listFiles } = await import("../store.server");
  const out = new Map<string, string>();
  // MEL/RegNotice vừa tách (riêng tài khoản) trước, kho chung/tạm ghi đè sau.
  for (const dir of [`regnotice/${ctx.userId}`, tmpDir(ctx), "notices"]) {
    const files = await listFiles(ctx, dir).catch(() => [] as Array<{ name: string }>);
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name)) continue;
      const k = normTitle(f.name);
      out.set(k, `${dir}/${f.name}`);
      // VNA649 ↔ VN-A649 để luật {REG} luôn khớp.
      const m = /^vn-?a(\d{3})$/.exec(k);
      if (m) { out.set(`vna${m[1]}`, `${dir}/${f.name}`); out.set(`vn-a${m[1]}`, `${dir}/${f.name}`); }
    }
  }
  return out;
}

export const jobs: Jobs = {
  // Port of web.py notice attach: mỗi chuyến, mỗi file notice theo luật có sẵn
  // trong kho → upload lên FliteBrief rồi gắn vào sector (bỏ qua file đã gắn).
  notice_attach: async (params, emit, ctx) => {
    const t0 = Date.now();
    const end = (code: number, extra: Record<string, unknown>) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ...extra });
    const { fbRequest } = await import("@/lib/flitebrief.server");
    try {
      const r = await fbRequest("GET", "/webapi/sector/attachments/privileges");
      const d = r.ok ? ((await r.json()) as Record<string, unknown>) : {};
      if (!d["create"]) {
        emit({ type: "line", text: "✗ tài khoản FliteBrief không có quyền đính kèm", cls: "bad" });
        return end(1, { ok: 0, skipped: 0, failed: 0 });
      }
    } catch {
      emit({ type: "line", text: "✗ không đọc được quyền đính kèm FliteBrief", cls: "bad" });
      return end(1, { ok: 0, skipped: 0, failed: 0 });
    }
    const { loadFlights } = await import("../core/gantts.server");
    const { getFile } = await import("../store.server");
    const { uploadAndAttach } = await import("./briefing.server");
    let flights;
    try {
      flights = selectNoticeSectors(
        pickNoticeFlights(await loadFlights(Number(params["days"] ?? 1) || 1), (params["callsigns"] as string[]) ?? []),
        params["sector_ids"] as unknown[],
      );
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      return end(1, { ok: 0, skipped: 0, failed: 0 });
    }
    const rules = await loadRules(ctx);
    const lib = await noticeLibrary(ctx);
    const plan = noticesPreview(flights, rules, (title) => lib.has(normTitle(title)));
    const work: Array<{ f: (typeof flights)[number]; title: string; path: string }> = [];
    let skipped = 0;
    for (const fn of plan) {
      const have = new Set(fn.flight.attachments.flatMap((a) => [normTitle(a.title), normTitle(a.original_filename)]));
      for (const n of fn.needs) {
        const cand = [n.title, ...n.alt].find((t) => lib.has(normTitle(t)));
        if (!cand) continue;
        if (have.has(normTitle(cand))) { skipped++; continue; }
        work.push({ f: fn.flight, title: cand, path: lib.get(normTitle(cand))! });
      }
    }
    emit({ type: "line", text: `▶ ${flights.length} chuyến · ${work.length} file cần add · ${skipped} đã có sẵn` });
    let ok = 0, failed = 0;
    const cache = new Map<string, Uint8Array>();
    for (let i = 0; i < work.length; i++) {
      const w = work[i]!;
      const progress = (i + 1) / work.length;
      const label = `${w.f.callsign} ${w.f.route}`;
      try {
        let bytes = cache.get(w.path);
        if (!bytes) {
          const buf = await getFile(ctx, w.path);
          if (!buf?.byteLength) throw new Error("file rỗng trong kho");
          bytes = new Uint8Array(buf);
          cache.set(w.path, bytes);
        }
        const fname = w.path.split("/").pop()!;
        const res = await uploadAndAttach(w.f.id, bytes, fname, fname.replace(/\.pdf$/i, ""));
        if (!res.ok) throw new Error(res.error || "lỗi");
        ok++;
        emit({ type: "line", text: `✓ ${label} ← ${fname}`, progress });
      } catch (e) {
        failed++;
        emit({ type: "line", text: `✗ ${label} · ${w.title}: ${e instanceof Error ? e.message : String(e)}`, cls: "bad", progress });
      }
    }
    end(failed ? 2 : 0, { ok, skipped, failed });
  },

  // Port of web.py attach_auto: ghép file PIB/WX trong kho pibwx/ vào đúng
  // chuyến (theo callsign trong tên file) rồi upload + gắn lên FliteBrief.
  attach_auto: async (params, emit, ctx) => {
    const t0 = Date.now();
    const end = (code: number, extra: Record<string, unknown>) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ...extra });
    const digits = (s: string) => String(s || "").replace(/\D/g, "");
    const csOf = (name: string) => {
      const m = /VJC\s?(\d{2,4})/i.exec(name);
      if (m) return m[1]!;
      const d = /(\d{3,4})/.exec(name);
      return d ? d[1]! : "";
    };
    const { fbRequest } = await import("@/lib/flitebrief.server");
    try {
      const r = await fbRequest("GET", "/webapi/sector/attachments/privileges");
      const d = r.ok ? ((await r.json()) as Record<string, unknown>) : {};
      if (!d["create"]) {
        emit({ type: "line", text: "✗ tài khoản FliteBrief không có quyền đính kèm", cls: "bad" });
        return end(1, { ok: 0, skipped: 0, failed: 0 });
      }
    } catch {
      emit({ type: "line", text: "✗ không đọc được quyền đính kèm FliteBrief", cls: "bad" });
      return end(1, { ok: 0, skipped: 0, failed: 0 });
    }
    const { loadFlights, filterByWindow } = await import("../core/gantts.server");
    const { getFile, listFiles } = await import("../store.server");
    const { uploadAndAttach } = await import("./briefing.server");
    const callsigns = (params["callsigns"] as string[]) ?? [];
    const wantDigits = new Set(callsigns.map(digits).filter(Boolean));
    const sectorIds = new Set(((params["sector_ids"] as unknown[]) ?? []).map(Number));
    let flights;
    try {
      // Khung chuẩn -6h/+24h quanh hiện tại: cùng callsign ở ngày khác bị loại.
      const all = filterByWindow(await loadFlights(Number(params["days"] ?? 1) || 1), 6, 24);
      flights = all.filter((f) => (sectorIds.size ? sectorIds.has(f.id) : wantDigits.has(digits(f.callsign))));
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      return end(1, { ok: 0, skipped: 0, failed: 0 });
    }
    const byCs = new Map<string, typeof flights>();
    for (const f of flights) {
      const k = digits(f.callsign);
      if (k) byCs.set(k, [...(byCs.get(k) ?? []), f]);
    }
    let names = ((params["filenames"] as string[]) ?? []).filter(Boolean);
    if (!names.length) {
      // Quét lại toàn bộ kho pibwx/ cho các chuyến đang có trong bảng.
      names = (await listFiles(ctx, "pibwx").catch(() => [] as Array<{ name: string }>))
        .map((f) => f.name)
        .filter((n) => /\.pdf$/i.test(n));
    }
    const needRoute: Array<{ callsign: string; filename: string; kind: string }> = [];
    type Work = { f: (typeof flights)[number]; name: string; kind: string };
    const work: Work[] = [];
    let skipped = 0;
    for (const name of names) {
      if (!/\.pdf$/i.test(name)) continue;
      const kind = /^pib/i.test(name) ? "pib" : "wx";
      let cands = byCs.get(csOf(name)) ?? [];
      if (!cands.length) continue;
      if (cands.length > 1 && !sectorIds.size) {
        // Còn trùng trong khung -6/+24: chọn chuyến có STD gần hiện tại nhất.
        const now = Date.now();
        const sorted = [...cands].sort(
          (a, b) => Math.abs((a.std?.getTime() ?? now) - now) - Math.abs((b.std?.getTime() ?? now) - now),
        );
        const best = sorted[0]!;
        const second = sorted[1]!;
        // Nếu 2 chuyến cách nhau dưới 3h thì vẫn coi là mơ hồ, chờ chọn route.
        const gap = Math.abs((best.std?.getTime() ?? 0) - (second.std?.getTime() ?? 0));
        if (gap >= 3 * 3600e3) {
          emit({ type: "line", text: `· ${name}: trùng callsign — chọn ${best.callsign} ${best.route} (STD gần nhất)` });
          cands = [best];
        }
      }
      if (cands.length > 1 && !sectorIds.size) {
        needRoute.push({ callsign: cands[0]!.callsign, filename: name, kind });
        emit({
          type: "line", text: `⊘ ${name}: trùng callsign nhiều sector — chờ chọn route`,
          cls: "bad", need_route: true, filename: name, found: cands[0]!.callsign, doc_kind: kind,
        });
        continue;
      }
      const f = cands[0]!;
      const have = new Set(f.attachments.flatMap((a) => [normTitle(a.title), normTitle(a.original_filename)]));
      if (have.has(normTitle(name))) {
        skipped++;
        emit({ type: "line", text: `· đã có trên FliteBrief: ${name}`, found: f.callsign, doc_kind: kind, attached: true, new: false });
        continue;
      }
      work.push({ f, name, kind });
    }
    emit({ type: "line", text: `▶ ${work.length} file cần add · ${skipped} đã có sẵn · ${needRoute.length} chờ chọn route` });
    let ok = 0, failed = 0;
    for (let i = 0; i < work.length; i++) {
      const w = work[i]!;
      const progress = (i + 1) / work.length;
      const label = `${w.f.callsign} ${w.f.route}`;
      try {
        const buf = await getFile(ctx, `pibwx/${w.name}`);
        if (!buf?.byteLength) throw new Error("file chưa có trên server (mới chỉ tải về máy PC)");
        const res = await uploadAndAttach(w.f.id, new Uint8Array(buf), w.name, w.name.replace(/\.pdf$/i, ""));
        if (!res.ok) throw new Error(res.error || "lỗi");
        ok++;
        emit({ type: "line", text: `✓ ${label} ← ${w.name}`, progress, found: w.f.callsign, doc_kind: w.kind, attached: true, new: true });
      } catch (e) {
        failed++;
        emit({
          type: "line", text: `✗ ${label} · ${w.name}: ${e instanceof Error ? e.message : String(e)}`,
          cls: "bad", progress, found: w.f.callsign, doc_kind: w.kind, attached: false,
        });
      }
    }
    end(failed ? 2 : 0, { ok, skipped, failed, need_route: needRoute, refresh: ok > 0 });
  },
};

// POST /api/attach/auto (web.py _api_attach_auto): tự đính kèm PIB/WX vừa tải
// lên FliteBrief. File PDF nằm trong kho pibwx/ (server tải trực tiếp hoặc
// trợ lý PC gửi kèm sau khi tải về máy).
Object.assign(routes, {
  "POST /api/attach/auto": async (ctx: Parameters<Routes[string]>[0]) => {
    const body = await ctx.json();
    const callsigns = ((body["callsigns"] as unknown[]) ?? []).map(String).filter(Boolean);
    const filenames = ((body["filenames"] as unknown[]) ?? []).map(String).filter(Boolean);
    if (!callsigns.length && !filenames.length) return { error: "Bảng đang trống." };
    return {
      id: jobId("attach_auto", {
        days: Number(body["days"] ?? 1) || 1,
        callsigns,
        filenames,
        sector_ids: (body["sector_ids"] as unknown[]) ?? [],
      }),
    };
  },
});

// Port of web.py _api_notice_rule_file(): upload một PDF notice từ Rule Studio
// into store (web.py saves to the Notice folder on disk; here we keep it in
// the private bucket under notices/<safe-name>.pdf so Rule Studio can refer to
// it by title the same way).
Object.assign(routes, {
  "POST /api/notices/rule-file": async (ctx: Parameters<Routes[string]>[0]) => {
    const { putFile, listFiles, removeFiles } = await import("../store.server");
    const buf = await ctx.request.arrayBuffer();
    if (!buf.byteLength) return { error: "Không nhận được nội dung file" };
    if (buf.byteLength > 50 * 1024 * 1024) return { error: "File PDF quá lớn (> 50 MB)" };
    const header = ctx.request.headers.get("X-Filename") || "";
    const raw = header ? decodeURIComponent(header) : "notice.pdf";
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").trim() || "notice.pdf";
    const name = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
    const title = name.replace(/\.pdf$/i, "");
    // Chỉ quản trị mới lưu vào kho chung của máy chủ (dùng cho cả đội).
    // Người khác: file tạm, chỉ dùng trong phiên đăng nhập hiện tại; đăng nhập lại là mất.
    const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    if (isAdmin) {
      await putFile(ctx, `notices/${name}`, buf, "application/pdf");
      return { ok: true, title, name, size: buf.byteLength, shared: true };
    }
    const dir = tmpDir(ctx);
    // Xoá file của các phiên đăng nhập cũ.
    try {
      const all = await listFiles(ctx, `notices-tmp/${ctx.userId}`);
      const stale: string[] = [];
      for (const e of all) {
        if (`notices-tmp/${ctx.userId}/${e.name}` === dir) continue;
        if (/\.pdf$/i.test(e.name)) { stale.push(`notices-tmp/${ctx.userId}/${e.name}`); continue; }
        const sub = await listFiles(ctx, `notices-tmp/${ctx.userId}/${e.name}`).catch(() => []);
        for (const f of sub) stale.push(`notices-tmp/${ctx.userId}/${e.name}/${f.name}`);
      }
      if (stale.length) await removeFiles(ctx, stale);
    } catch { /* ignore */ }
    await putFile(ctx, `${dir}/${name}`, buf, "application/pdf");
    return { ok: true, title, name, size: buf.byteLength, shared: false, temp: true,
      note: "File tạm — chỉ dùng trong phiên đăng nhập này, đăng xuất/đăng nhập lại sẽ mất (chỉ quản trị lưu lâu dài được)." };
  },
});
