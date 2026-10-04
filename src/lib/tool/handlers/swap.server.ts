import type { Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import type { Flight } from "../core/models";
import { icaoAcType, defaultRuleData, type RuleRow } from "../port/notices";
import * as rs from "../port/regswap";
import * as cs from "../port/crewswap";
import * as vf from "../port/verify";

// Port of web.py "/api/regswap/*", "/api/crewswap/*", "/api/verify/*".
// briefswap / crew-plan-from-excel are owned by another agent in a separate file.

async function findSector(sectorId: number, days: number): Promise<Flight> {
  const { loadFlights } = await import("../core/gantts.server");
  const flights = await loadFlights(days);
  const f = flights.find((x) => x.id === sectorId);
  if (!f) throw new Error(`không thấy chuyến sector_id=${sectorId} trên FliteBrief`);
  return f;
}

async function ruleData(ctx: Parameters<Routes[string]>[0]): Promise<RuleRow[]> {
  const { getJson } = await import("../store.server");
  const raw = await getJson<unknown>(ctx, "notice_rules", null);
  if (Array.isArray(raw)) return raw as RuleRow[];
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).rules)) {
    return (raw as Record<string, unknown>).rules as RuleRow[];
  }
  return defaultRuleData();
}

async function upPrivileges(): Promise<{ create: boolean; delete: boolean }> {
  const { fbJson } = await import("@/lib/flitebrief.server");
  try {
    const d = await fbJson<Record<string, unknown>>("/webapi/sector/attachments/privileges");
    return { create: !!d["create"], delete: !!d["delete"] };
  } catch {
    return { create: false, delete: false };
  }
}

async function actypeOf(flights: Flight[], reg: string, skipSectorId: number): Promise<string> {
  const want = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const others: string[] = [];
  let selfType = "";
  for (const f of flights) {
    if ((f.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== want) continue;
    const t = (f.ac_type || f.acft_type || "").trim();
    if (!t) continue;
    if (skipSectorId && f.id === skipSectorId) {
      if (!selfType) selfType = t;
      continue;
    }
    others.push(t);
  }
  // jetplan_ac lookup needs company-intranet data not available here; fall back
  // to other sectors / the sector itself, same priority order as web.py otherwise.
  return others[0] || selfType || "";
}

async function liveAttachments(sectorId: number, fallback: Flight["attachments"]): Promise<rs.LiveAttachmentRow[]> {
  const { fbJson } = await import("@/lib/flitebrief.server");
  let raw: unknown[] = [];
  try {
    const d = await fbJson<unknown>(`/webapi/sectors/${sectorId}/attachments`);
    if (Array.isArray(d)) raw = d;
  } catch {
    raw = [];
  }
  const listed = raw.filter((d) => d && typeof d === "object") as Record<string, unknown>[];
  const seen = new Set(listed.filter((d) => d["id"]).map((d) => Number(d["id"])));
  for (const att of fallback) {
    if (att.id && !seen.has(att.id) && !att.is_deleted) {
      listed.push({ id: att.id, title: att.title, original_filename: att.original_filename });
      seen.add(att.id);
    }
  }
  return listed as rs.LiveAttachmentRow[];
}

async function opsWindowCheck(f: Flight): Promise<string> {
  const { inOpsWindow } = await import("../port/notices");
  if (inOpsWindow(f)) return "";
  const label = "STD trong −6h…+24h (ngày VN ±1 khi còn trong cửa sổ)";
  return `${f.callsign}: ngoài cửa sổ thao tác (${label}) — STD ${f.std ?? ""}.`;
}

export const routes: Routes = {
  "GET /api/regswap/preview": async (ctx) => {
    const sectorId = Number(ctx.params.get("sector_id") || "0");
    const newReg = ctx.params.get("new_reg") || "";
    const oldReg = ctx.params.get("old_reg") || "";
    const days = Number(ctx.params.get("days") || "2") || 2;
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!newReg.trim()) return { error: "thiếu số hiệu tàu mới" };
    const { loadFlights } = await import("../core/gantts.server");
    const flights = await loadFlights(days);
    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      return { error: (exc as Error).message };
    }
    const why = await opsWindowCheck(f);
    if (why) return { error: `${why} Không đổi file chuyến đã bay / ngoài ngày.` };
    const newActype = await actypeOf(flights, newReg, f.id);
    const live = await liveAttachments(f.id, f.attachments);
    const rows = await ruleData(ctx);
    const plan = rs.planSwap(f, newReg, { oldReg, newActype, ruleData: rows, liveAttachments: live, icaoAcType });
    const privileges = await upPrivileges();
    return { ...plan, privileges };
  },

  "POST /api/regswap/run": async (ctx) => {
    const body = await ctx.json();
    const sectorId = Number(body["sector_id"] ?? 0);
    const newReg = String(body["new_reg"] ?? "");
    const oldReg = String(body["old_reg"] ?? "");
    const days = Number(body["days"] ?? 2) || 2;
    const dryRun = !!body["dry_run"];
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!newReg.trim()) return { error: "thiếu số hiệu tàu mới" };
    return { id: jobId("regswap", { sectorId, newReg, oldReg, days, dryRun }) };
  },

  "GET /api/crewswap/preview": async (ctx) => {
    const sectorId = Number(ctx.params.get("sector_id") || "0");
    const outIds = (ctx.params.get("out") || "").split(",").filter(Boolean);
    const inIds = (ctx.params.get("in") || "").split(",").filter(Boolean);
    const days = Number(ctx.params.get("days") || "2") || 2;
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!outIds.length && !inIds.length) return { error: "không có mã nhân viên nào để đổi" };
    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      return { error: (exc as Error).message };
    }
    const why = await opsWindowCheck(f);
    if (why) return { error: `${why} Không đổi crew chuyến đã bay / ngoài ngày.` };
    const { fbJson } = await import("@/lib/flitebrief.server");
    let currentCrew: cs.CrewRow[] = [];
    try {
      const d = await fbJson<unknown>(`/webapi/sectors/${f.id}/crews`);
      if (Array.isArray(d)) currentCrew = (d as cs.CrewRow[]).filter((c) => !c.deleted_on);
    } catch {
      /* report via plan.note below is not available here; keep empty like a read failure */
    }
    const userCache = new Map<string, cs.CrewRow | null>();
    const findUser = (username: string): cs.CrewRow | null => userCache.get(username) ?? null;
    // Resolve any usernames we might need before calling the sync planSwap.
    const wantIn = new Set(inIds.map(cs.staffDigits).filter(Boolean));
    for (const d of wantIn) {
      const un = cs.usernameOf(d);
      if (userCache.has(un)) continue;
      try {
        const params = new URLSearchParams({
          "filter[logic]": "and",
          "filter[filters][0][field]": "username",
          "filter[filters][0][operator]": "eq",
          "filter[filters][0][value]": un,
        });
        const r = await fbJson<Record<string, unknown>>(`/webapi/allcrew?${params.toString()}`);
        const rows = (Array.isArray((r as Record<string, unknown>)["data"]) ? (r as Record<string, unknown>)["data"] : []) as cs.CrewRow[];
        const hit = rows.find((row) => String(row.username ?? "").trim().toUpperCase() === un.toUpperCase());
        userCache.set(un, hit ?? null);
      } catch {
        userCache.set(un, null);
      }
    }
    const plan = cs.planSwap(f, outIds, inIds, { currentCrew, findUser, newRow: (sectorId2, user) => ({
      sector_id: sectorId2, user_id: user["id"], forename: user["forename"] ?? "", surname: user["surname"] ?? "",
      username: user["username"] ?? "", job: user["job"],
    }) });
    return plan;
  },

  "POST /api/crewswap/run": async (ctx) => {
    const body = await ctx.json();
    const sectorId = Number(body["sector_id"] ?? 0);
    const outIds = ((body["out"] as unknown[] | undefined) ?? []).map(String);
    const inIds = ((body["in"] as unknown[] | undefined) ?? []).map(String);
    const days = Number(body["days"] ?? 2) || 2;
    const dryRun = !!body["dry_run"];
    if (!sectorId) return { error: "thiếu sector_id" };
    return { id: jobId("crewswap", { sectorId, outIds, inIds, days, dryRun }) };
  },

  "GET /api/verify/preview": async (ctx) => {
    const { loadFlights } = await import("../core/gantts.server");
    const { pickNoticeFlights, noticeDuplicateGroups } = await import("../port/notices");
    const days = Number(ctx.params.get("days") || "1") || 1;
    const callsigns = (ctx.params.get("callsigns") || "").split(",").filter(Boolean);
    const flights = pickNoticeFlights(await loadFlights(days), callsigns);

    const seen = new Map<string, number>();
    for (const f of flights) seen.set(f.callsign.toUpperCase(), (seen.get(f.callsign.toUpperCase()) ?? 0) + 1);
    const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([cs2]) => cs2).sort();

    const rows = flights.map((f) => {
      const why = vf.canVerify(f);
      const ofp = String(f.ofp_status ?? "");
      const warn = ofp === "REL" ? "" : `OFP còn ${ofp || "?"}, chưa release xong`;
      return {
        warn,
        callsign: f.callsign,
        route: f.route,
        sector: f.id,
        sector_id: f.id,
        plan: f.plan_id || 0,
        ofp: f.ofp_status,
        std: f.std ? f.std.toISOString().slice(5, 16).replace("T", " ") : "",
        verified: f.is_verified,
        green: vf.alreadyGreen(f),
        ofp_ack: vf.ofpAckNeeded(f),
        voyage: (f.raw || {})["voyage_id"] || 0,
        by: f.verified_by_name,
        on: f.verified_on ? f.verified_on.toISOString().slice(5, 16).replace("T", " ") : "",
        why,
      };
    });
    return {
      flights: flights.length,
      already: rows.filter((r) => r.green).length,
      yellow: rows.filter((r) => r.verified && !r.green).length,
      ready: rows.filter((r) => !r.green && !r.why).length,
      blocked: rows.filter((r) => !r.green && r.why).length,
      dup,
      duplicate_groups: noticeDuplicateGroups(flights),
      rows,
    };
  },

  "POST /api/verify/run": async (ctx) => {
    const body = await ctx.json();
    const { loadFlights } = await import("../core/gantts.server");
    const { pickNoticeFlights, selectNoticeSectors } = await import("../port/notices");
    try {
      const days = Number(body["days"] ?? 1) || 1;
      const callsigns = ((body["callsigns"] as unknown[] | undefined) ?? []).map(String);
      let fl = pickNoticeFlights(await loadFlights(days), callsigns);
      fl = selectNoticeSectors(fl, (body["sector_ids"] as unknown[] | null | undefined) ?? null);
      if (!fl.length) {
        return { error: "Không có chuyến nào khớp danh sách trong bảng. Gõ số hiệu vào cột FLT NO (hoặc PIB/WX) trước." };
      }
      const dryRun = !!body["dry_run"];
      const green = body["green"] !== false;
      return { id: jobId("verify", { sectorIds: fl.map((f) => f.id), days, dryRun, green }), flights: fl.length };
    } catch (exc) {
      return { error: (exc as Error).message };
    }
  },
};

function fbClient(): vf.FbClient {
  return {
    async get(path) {
      const { fbGet } = await import("@/lib/flitebrief.server");
      const r = await fbGet(path);
      return { status: r.status, json: () => r.json(), text: () => r.text() };
    },
    async post(path, body) {
      const { fbRequest } = await import("@/lib/flitebrief.server");
      const r = await fbRequest("POST", path, body === undefined ? {} : { body: body as URLSearchParams | string | object });
      return { status: r.status, json: () => r.json(), text: () => r.text() };
    },
    async del(path) {
      const { fbRequest } = await import("@/lib/flitebrief.server");
      const r = await fbRequest("DELETE", path);
      return { status: r.status, json: () => r.json(), text: () => r.text() };
    },
    async sectorDetail(sectorId) {
      const { fbJson } = await import("@/lib/flitebrief.server");
      try {
        const j = await fbJson<unknown>(`/webapi/sectors/${sectorId}`);
        let row: unknown = j;
        if (Array.isArray(j)) row = j[0] ?? {};
        else if (j && typeof j === "object" && Array.isArray((j as Record<string, unknown>)["data"])) {
          row = ((j as Record<string, unknown>)["data"] as unknown[])[0] ?? {};
        }
        return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    },
    flightFromApi(row) {
      const { Flight } = require("../core/models") as typeof import("../core/models");
      return Flight.fromApi(row);
    },
  };
}

export const jobs: Jobs = {
  regswap: async (params, emit) => {
    const t0 = Date.now();
    const sectorId = Number(params["sectorId"]);
    const newReg = String(params["newReg"] ?? "");
    const oldReg = String(params["oldReg"] ?? "");
    const days = Number(params["days"] ?? 2);
    const dryRun = !!params["dryRun"];
    const end = (code: number, extra: Record<string, unknown> = {}) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 0, missing: [], ...extra });

    let f: Flight;
    const { loadFlights } = await import("../core/gantts.server");
    let flights: Flight[];
    try {
      flights = await loadFlights(days);
      f = await findSector(sectorId, days);
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error).name || "Error"}: ${(exc as Error).message || exc}`, cls: "bad" });
      return end(1, { failed: 1 });
    }
    const why = await opsWindowCheck(f);
    if (why) {
      emit({ type: "line", text: `✗ ${why}`, cls: "bad" });
      return end(1, { failed: 1 });
    }
    const newActype = await actypeOf(flights, newReg, f.id);
    const live = await liveAttachments(f.id, f.attachments);
    const rows = await ruleData({} as Parameters<Routes[string]>[0]);
    const plan = rs.planSwap(f, newReg, { oldReg, newActype, ruleData: rows, liveAttachments: live, icaoAcType });

    emit({ type: "line", text: `▶ ${plan.callsign} (${plan.route}) · ${plan.old_reg || "?"} → ${plan.new_reg}` });
    if (plan.fb_reg && plan.fb_reg !== plan.old_reg) {
      emit({ type: "line", text: `! FliteBrief đang ghi tàu ${plan.fb_reg}, khác tàu cũ ${plan.old_reg} trong bản kế hoạch`, cls: "bad" });
    }
    if (plan.note) emit({ type: "line", text: `· ${plan.note}` });
    if (plan.new_actype) emit({ type: "line", text: `· loại tàu mới ${plan.new_actype}` });
    else emit({ type: "line", text: "! chưa rõ loại tàu mới — notice neo (TN-2025-0049) có thể không được thêm", cls: "bad" });
    for (const k of plan.keep) emit({ type: "line", text: `= giữ nguyên ${k}` });
    for (const d of plan.delete) emit({ type: "line", text: `- sẽ xoá  ${d.filename}  (${d.reason})` });
    for (const a of plan.add) {
      const mark = a.found ? "+" : "!";
      emit({ type: "line", text: `${mark} sẽ thêm ${a.title}` + (a.found ? "" : "  — THIẾU FILE TRÊN ĐĨA"), cls: a.found ? "" : "bad" });
    }

    if (dryRun) {
      emit({ type: "line", text: "— dry-run: không ghi gì lên hệ thống —", cls: "sys" });
      return end(0, { ok: 0, skipped: plan.add.length, failed: plan.missing.length });
    }
    if (!plan.delete.length && !plan.add.length) {
      emit({ type: "line", text: "· không có gì phải đổi" });
      return end(0);
    }

    const priv = await upPrivileges();
    if (plan.delete.length && !priv.delete) {
      emit({ type: "line", text: "✗ tài khoản không có quyền XOÁ attachment", cls: "bad" });
      return end(1, { failed: plan.delete.length });
    }
    if (plan.add.length && !priv.create) {
      emit({ type: "line", text: "✗ tài khoản không có quyền đính kèm", cls: "bad" });
      return end(1, { failed: plan.add.length });
    }

    const { fbRequest } = await import("@/lib/flitebrief.server");
    const r = await rs.applySwap(plan, {
      deleteAttachment: async (sectorId2, id) => {
        const res = await fbRequest("DELETE", `/webapi/sectors/${sectorId2}/attachments/${id}`);
        return [200, 201, 204].includes(res.status);
      },
      // No local disk/bucket of notice PDFs is wired into the Worker yet, so
      // "found" is always false for add items and this is never invoked —
      // matches the Vietnamese "THIẾU FILE TRÊN ĐĨA" message above honestly.
      uploadAttachment: async () => ({ ok: false, alreadyExists: false, error: "chưa có kho file trên máy chủ (cần đĩa/kho PC)" }),
      onLine: (text, cls) => emit({ type: "line", text, cls }),
    });
    emit({ type: "line", text: `⬆ xong: xoá ${r.deleted} · thêm ${r.added} · đã có ${r.skipped} · lỗi ${r.failed}`, cls: r.failed ? "bad" : "" });
    end(r.failed ? 2 : 0, { ok: r.added, skipped: r.skipped, failed: r.failed, deleted: r.deleted });
  },

  crewswap: async (params, emit) => {
    const t0 = Date.now();
    const sectorId = Number(params["sectorId"]);
    const outIds = (params["outIds"] as string[] | undefined) ?? [];
    const inIds = (params["inIds"] as string[] | undefined) ?? [];
    const days = Number(params["days"] ?? 2);
    const end = (code: number, extra: Record<string, unknown> = {}) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 0, missing: [], ...extra });

    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error).name || "Error"}: ${(exc as Error).message || exc}`, cls: "bad" });
      return end(1, { failed: 1 });
    }
    const why = await opsWindowCheck(f);
    if (why) {
      emit({ type: "line", text: `✗ ${why}`, cls: "bad" });
      return end(1, { failed: 1 });
    }

    const { fbJson, fbRequest } = await import("@/lib/flitebrief.server");
    let currentCrew: cs.CrewRow[] = [];
    try {
      const d = await fbJson<unknown>(`/webapi/sectors/${f.id}/crews`);
      if (Array.isArray(d)) currentCrew = (d as cs.CrewRow[]).filter((c) => !c.deleted_on);
    } catch {
      /* treated as "no crew found" like web.py's own empty-list fallback */
    }
    const userCache = new Map<string, cs.CrewRow | null>();
    const wantIn = new Set(inIds.map(cs.staffDigits).filter(Boolean));
    for (const d of wantIn) {
      const un = cs.usernameOf(d);
      try {
        const qs = new URLSearchParams({
          "filter[logic]": "and",
          "filter[filters][0][field]": "username",
          "filter[filters][0][operator]": "eq",
          "filter[filters][0][value]": un,
        });
        const r = await fbJson<Record<string, unknown>>(`/webapi/allcrew?${qs.toString()}`);
        const rows = (Array.isArray(r["data"]) ? r["data"] : []) as cs.CrewRow[];
        userCache.set(un, rows.find((row) => String(row.username ?? "").trim().toUpperCase() === un.toUpperCase()) ?? null);
      } catch {
        userCache.set(un, null);
      }
    }
    const plan = cs.planSwap(f, outIds, inIds, {
      currentCrew,
      findUser: (un) => userCache.get(un) ?? null,
      newRow: (sectorId2, user) => ({
        sector_id: sectorId2, user_id: user["id"], forename: user["forename"] ?? "", surname: user["surname"] ?? "",
        username: user["username"] ?? "", job: user["job"],
      }),
    });

    const r = await cs.applySwap(plan, {
      post: async (payload) => {
        const res = await fbRequest("POST", `/webapi/sectors/${f.id}/crews`, {
          body: new URLSearchParams({ data: JSON.stringify(payload) }),
        });
        return { status: res.status, text: await res.text() };
      },
      onLine: (text, cls) => emit({ type: "line", text, cls }),
    });
    if (r.error) return end(1, { failed: r.failed });
    end(0, { ok: r.added, skipped: 0, failed: r.failed, deleted: r.removed });
  },

  verify: async (params, emit) => {
    const t0 = Date.now();
    const sectorIds = (params["sectorIds"] as number[] | undefined) ?? [];
    const days = Number(params["days"] ?? 1);
    const dryRun = !!params["dryRun"];
    const green = params["green"] !== false;

    const { loadFlights } = await import("../core/gantts.server");
    const all = await loadFlights(days);
    const bySector = new Map(all.map((f) => [f.id, f] as const));
    const flights = sectorIds.map((id) => bySector.get(id)).filter((f): f is Flight => !!f);

    if (!flights.length) {
      emit({ type: "line", text: "✗ Không có chuyến nào khớp danh sách trong bảng.", cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, missing: [] });
      return;
    }

    const fb = fbClient();
    const want = green ? "XANH" : "VÀNG";
    const todo = green ? flights.filter((f) => !vf.alreadyGreen(f)) : flights.filter((f) => !f.is_verified || vf.ofpAckNeeded(f));
    const doneAlready = flights.length - todo.length;
    emit({
      type: "line",
      text: `▶ ${flights.length} chuyến · ${todo.length} cần lên ${want} · ${doneAlready} đã ${want.toLowerCase()} sẵn` + (dryRun ? "  [chạy thử, không ghi]" : ""),
    });
    if (green) emit({ type: "line", text: "  mỗi chuyến 4 bước: verify → tạo voyage → sinh briefing → release. Bước briefing chờ server, có thể vài chục giây." });

    let n = 0;
    const progress = (text: string, res: vf.Verified) => {
      if (/^(✓|✗|\[thử\])/.test(text) || text.startsWith("· ")) n += 1;
      emit({ type: "line", text, cls: text.startsWith("✗") ? "bad" : undefined, found: res.flight.callsign, progress: Math.min(1, n / Math.max(1, flights.length)) });
    };

    const res = await vf.verifyMany(fb, flights, { dryRun, green, onProgress: progress });

    const ok = res.filter((x) => x.ok && !x.already);
    const already = res.filter((x) => x.already);
    const bad = res.filter((x) => !x.ok);
    const half = bad.filter((x) => x.level === "vàng");
    emit({ type: "line", text: "─".repeat(46) });
    for (const lv of ["xanh", "vàng"] as const) {
      const got = ok.filter((x) => x.level === lv);
      if (got.length) emit({ type: "line", text: `✓ LÊN ${lv.toUpperCase()} (${got.length}): ` + got.map((x) => vf.verifiedLabel(x)).join(", ") });
    }
    if (half.length) {
      emit({ type: "line", cls: "bad", text: `⚠ MỚI VÀNG, CHƯA XANH (${half.length}) — verify đã xong, phần briefing hỏng:` });
      for (const x of half) emit({ type: "line", cls: "bad", text: `     ${vf.verifiedLabel(x)} — ${x.error}` });
    }
    const rest = bad.filter((x) => x.level !== "vàng");
    if (rest.length) {
      emit({ type: "line", cls: "bad", text: `✗ KHÔNG VERIFY ĐƯỢC (${rest.length}):` });
      for (const x of rest) emit({ type: "line", cls: "bad", text: `     ${vf.verifiedLabel(x)} — ${x.error}` });
    }
    emit({
      type: "end",
      code: bad.length ? 2 : 0,
      elapsed: (Date.now() - t0) / 1000,
      ok: ok.length,
      skipped: already.length,
      failed: bad.length,
      half: half.map((x) => vf.verifiedLabel(x)),
      missing: bad.map((x) => x.flight.callsign),
    });
  },
};
