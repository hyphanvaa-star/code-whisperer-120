import { env as credEnv } from "../creds.server";
import type { Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import * as pc from "../pcagent.server";
import * as ae from "../port/atc_ezfw";

// Port of web.py OWA/PIB endpoints (start_owa_login, owa_fpl_watch.status,
// start_pib_download): the real Outlook-Web/Selenium session must run on the
// company PC, so these go through the PC agent (pc_agent.py: owa_login,
// owa_fpl_watch, owa_pib) exactly like atc.server.ts's aviweb_check.

function offline() {
  return { error: "Trợ lý PC chưa kết nối — mở trợ lý trên máy công ty rồi thử lại." };
}

export const routes: Routes = {
  // Mã EFB mới nhất từ mail "EFB Flysmart Version ..." trong hộp thư chung
  // OMC. Thử Outlook REST trực tiếp trước; tenant chặn (ADFS/MFA) thì dự
  // phòng qua trợ lý PC (lệnh owa_efb đọc Outlook desktop) — nhưng CHỈ khi
  // người dùng chủ động bấm nút (?pc=1), vì lệnh này mở Outlook trên máy
  // công ty. Lượt tự điền khi mở trang không được bật Outlook.
  "GET /api/efb/latest": async (ctx) => {
    try {
      const { fetchLatestEfb } = await import("../port/owa_efb");
      const r = await fetchLatestEfb();
      return { ok: true, ...r, source: "server" };
    } catch (e) {
      const { OwaAuthError } = await import("../port/owa");
      if (!(e instanceof OwaAuthError)) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    if (ctx.params.get("pc") !== "1") {
      return { error: "Máy chủ bị Microsoft chặn đăng nhập hộp thư chung — bấm nút ↻ cạnh ô EFB để lấy qua trợ lý PC.", need_pc: true };
    }
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) return { error: offline().error };
    try {
      const id = await pc.enqueueDeduped("owa_efb", {}, 30_000);
      const r = (await pc.waitResult(id, 60_000)) as Record<string, any>;
      if (r?.value) {
        return { ok: true, value: String(r.value), subject: String(r.subject || ""), when: r.when || null, source: "pc" };
      }
      return { error: String(r?.error || "Không đọc được mail EFB từ hộp thư chung.") };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },

  // web.py "/api/owa/login" -> start_owa_login(): job id, streamed over /api/stream.
  // Job tự thử đăng nhập thẳng từ máy chủ trước, chỉ cần trợ lý PC khi
  // Microsoft từ chối đăng nhập từ xa (khoá tài khoản, ADFS, MFA).
  "POST /api/owa/login": async (_ctx) => {
    return { id: jobId("owa_login", {}) };
  },

  // web.py "/api/owa/fpl-watch" -> owa_fpl_watch.status(after=...), a plain
  // (non-job) GET. Relay it through the PC agent synchronously.
  "GET /api/owa/fpl-watch": async (ctx) => {
    const after = Number(ctx.params.get("after") || "0") || 0;
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      return { running: false, last_at: 0, count: 0, items: [], lines: [], until: after, error: offline().error };
    }
    try {
      const { putFile, listFiles } = await import("../store.server");
      const { safeFilename } = await import("../core/models");
      const { excelDir } = await import("./excel.server");
      const dir = excelDir(ctx);
      // Tell the helper which Excel files the web already has, so it re-sends
      // anything missing (a lost/timeout upload is no longer dropped forever).
      let have: string[] = [];
      try { have = (await listFiles(ctx, dir)).map((f) => f.name); } catch { /* ignore */ }
      const id = await pc.enqueueDeduped("owa_fpl_watch", { after, have }, 8_000);
      const r = (await pc.waitResult(id, 45_000)) as Record<string, any>;
      const ups = Array.isArray(r?.uploads) ? r.uploads : [];
      const saved: Record<string, string> = {};
      for (const u of ups) {
        const raw = String(u?.name || "");
        const name = safeFilename(raw);
        if (!name || !/\.(xlsx|xlsm)$/i.test(name) || typeof u?.b64 !== "string") continue;
        try {
          await putFile(ctx, `${dir}/${name}`, Buffer.from(u.b64, "base64"), "application/octet-stream");
          saved[raw] = name;
        } catch (e) { console.warn("FPL VER save:", e); }
      }
      delete r.uploads;
      const stored = new Set([...have, ...Object.values(saved)]);
      const ver = (r.ver && typeof r.ver === "object") ? r.ver : {};
      for (const k of ["old", "new"]) {
        if (!ver[k]) continue;
        const s = saved[ver[k]] || safeFilename(String(ver[k]));
        ver[k] = stored.has(s) ? s : "";
      }
      // Always prefer the newest FLIGHT PLAN VER pair actually stored.
      const pair = fplVerPair([...stored]);
      if (pair.new) { ver.new = pair.new; ver.old = pair.old || ver.old || ""; }
      r.ver = ver;
      return r;
    } catch (e) {
      return { running: false, last_at: 0, count: 0, items: [], lines: [], until: after, error: e instanceof Error ? e.message : String(e) };
    }
  },

  // web.py "/api/atcezfw/draft" -> start_ae_draft(): cắt ATC/EZFW từ OFP rồi
  // enqueue một nháp Outlook (desktop, qua trợ lý PC) cho mỗi chuyến gõ vào ô.
  "POST /api/atcezfw/draft": async (ctx) => {
    const payload = await ctx.json();
    const flight = String(payload["flight"] || "").trim();
    if (!flight) return { error: "Nhập số hiệu chuyến, ví dụ 5513." };
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) return offline();
    const wants = ae.flightsOf(flight);
    if (!wants.length) return { error: "Nhập số hiệu chuyến, ví dụ 5513 hoặc 5513 1832." };
    return { id: jobId("atcezfw_draft", { wants }) };
  },

  // web.py "/api/pib/download" -> start_pib_download(): job id, streamed.
  "POST /api/pib/download": async (ctx) => {
    const payload = await ctx.json();
    const callsigns = (payload["callsigns"] as string[] | undefined) ?? [];
    if (!callsigns.filter((c) => String(c || "").trim()).length) {
      return { error: "Chưa có số hiệu chuyến bay nào trong cột PIB/WX." };
    }
    const hours = Number(payload["hours"] ?? 10) || 10;
    const overwrite = !!payload["overwrite"];
    return { id: jobId("owa_pib", { callsigns, hours, overwrite }) };
  },
};

export const jobs: Jobs = {
  // Port of web.py start_ae_draft(): cắt ATC/EZFW từ OFP FliteBrief rồi giao
  // trợ lý PC soạn nháp Outlook (desktop COM, không gửi) cho mỗi chuyến.
  atcezfw_draft: async (params, emit, ctx) => {
    const t0 = Date.now();
    const wants = (params["wants"] as string[] | undefined) ?? [];
    let ok = 0;
    const subjects: string[] = [];
    const files: string[] = [];
    const links: string[] = [];
    try {
      const { fbGet } = await import("@/lib/flitebrief.server");
      const { loadFlights } = await import("../core/gantts.server");
      const flights = await loadFlights(2);
      const known: ae.AeFlight[] = flights.map((f) => ({
        id: f.id,
        callsign: f.callsign || "",
        fltno: f.fltno,
        commercial_fltno: f.commercial_fltno,
        std: f.std,
      }));
      for (let i = 0; i < wants.length; i++) {
        const want = wants[i]!;
        emit({ type: "line", text: `── ${want} (${i + 1}/${wants.length})` });
        try {
          const flight = ae.findFlight(known, want);
          const pdf = await fbGet(`/webapi/sectors/${flight.id}/ofp`, "application/pdf");
          if (!pdf.ok) throw new ae.AeError(`${flight.callsign}: chưa lấy được OFP`);
          const bytes = new Uint8Array(await pdf.arrayBuffer());
          const { ofpLayoutFromPdf } = await import("../port/ofp_layout");
          const text = await ofpLayoutFromPdf(bytes);
          const atc = ae.extractAtc(text).trim();
          const ezfw = ae.extractEzfw(text);
          const subject = ae.subjectOf(flight.callsign, flight.std);
          const names = ae.aeFileNames(flight.callsign, ezfw, flight.std);
          const attachments = [
            { name: names.atc, data_b64: Buffer.from(atc, "utf-8").toString("base64") },
            { name: names.ezfw, data_b64: Buffer.from(ezfw, "utf-8").toString("base64") },
          ];
          // Nháp phải nằm trong hộp thư chung omc@vietjetair.com trên Outlook
          // Web (owa_draft) — không mở Outlook desktop (outlook_draft).
          const mail = {
            user: credEnv("OUTLOOK_MAIL_USER") || "",
            pass: credEnv("OUTLOOK_MAIL_PASS") || "",
            mailbox: credEnv("OUTLOOK_MAILBOX") || "omc@vietjetair.com",
          };
          const id = await pc.enqueue("owa_draft", { subject, body: ae.BODY, attachments, ...mail });
          const r = (await pc.waitResult(id, 120_000)) as { draft_id?: string; mailbox?: string } | null;
          emit({ type: "line", text: `✓ ${subject}` });
          ok += 1;
          subjects.push(subject);
          files.push(attachments[0]!.name, attachments[1]!.name);
          const did = r && typeof r === "object" ? String(r.draft_id || "") : "";
          if (did) {
            // Y hệt atc_ezfw.create_outlook_draft() của tool gốc:
            //   base = https://outlook.cloud.microsoft/mail/{quote(box, safe="@")}
            //   url  = f"{base}/compose/{quote(draft_id, safe='')}"
            // /compose/{id} giữ shell Outlook (folder bên trái, thư đang soạn bên phải).
            // Id giữ nguyên như REST trả về — không đổi ký tự.
            const mb = encodeURIComponent(String(r?.mailbox || mail.mailbox)).replace(/%40/g, "@");
            links.push(`https://outlook.cloud.microsoft/mail/${mb}/compose/${encodeURIComponent(did)}`);
          }
        } catch (exc) {
          const msg = exc instanceof Error ? exc.message : String(exc);
          emit({ type: "line", text: `✗ ${want}: ${msg}`, cls: "bad" });
        }
      }
    } catch (exc) {
      emit({ type: "line", text: `✗ ${exc instanceof Error ? exc.message : String(exc)}`, cls: "bad" });
    }
    emit({ type: "end", code: ok ? 0 : 1, elapsed: (Date.now() - t0) / 1000, ok, failed: wants.length - ok, subject: subjects.join(" · "), files, links });
  },

  // Port of web.py start_owa_login(): đăng nhập Outlook luôn đi qua trợ lý PC
  // (mở Chrome Outlook Web trên máy công ty) — không thử đăng nhập trực tiếp
  // từ máy chủ web vì Microsoft hay khoá tài khoản (AADSTS50053).
  owa_login: async (_params, emit, ctx) => {
    const t0 = Date.now();
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: `✗ ${offline().error}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, logged_in: false, owa_state: "stale" });
      return;
    }
    // Không tin "watcher đang chạy" = phiên còn sống (token có thể đã hết hạn).
    // Luôn để trợ lý gọi ensure_session(): token còn hạn thì xác nhận mailbox
    // ngay không mở Chrome, hết hạn thì mới đăng nhập lại.
    try {
      emit({ type: "line", text: "▶ Mở Chrome Outlook Web — auto-login nếu đã lưu owa_username/owa_password (MFA thì xác nhận tay)." });
      // Gửi kèm tài khoản OWA (secret phía web) để trợ lý tự điền đăng nhập —
      // kênh job chỉ đọc bằng PC_AGENT_TOKEN nên không lộ ra ngoài.
      const owaUser = credEnv("OWA_USERNAME") || credEnv("OUTLOOK_USERNAME") || "";
      const owaPass = credEnv("OWA_PASSWORD") || credEnv("OUTLOOK_PASSWORD") || "";
      const id = await pc.enqueueDeduped("owa_login", { user: owaUser, pass: owaPass }, 120_000);
      let lastBeat = 0;
      const r = await pc.waitResult(id, 450_000, (elapsed) => {
        if (elapsed - lastBeat >= 30) {
          lastBeat = elapsed;
          emit({ type: "line", text: `· đang chờ trợ lý PC đăng nhập Outlook Web… (${Math.round(elapsed)}s)`, cls: "sys" });
        }
      });
      const lines = (r["lines"] as Array<{ text?: string; cls?: string }> | undefined) ?? [];
      for (const l of lines) if (l?.text) emit({ type: "line", text: l.text, cls: l.cls || "" });
      const loggedIn = !!r["logged_in"];
      const cancelled = !!r["cancelled"];
      emit({
        type: "end",
        code: loggedIn ? 0 : 1,
        elapsed: (Date.now() - t0) / 1000,
        ok: loggedIn ? 1 : 0,
        skipped: 0,
        failed: loggedIn ? 0 : 1,
        logged_in: loggedIn,
        cancelled,
        owa_state: r["owa_state"] ?? (loggedIn ? "healthy" : "stale"),
      });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, logged_in: false, owa_state: "stale" });
    }
  },

  // Port of web.py start_pib_download(): thử tải PIB thẳng trên máy chủ web
  // (port/owa_pib.downloadPib — Outlook REST, không cần trợ lý PC). Chỉ khi
  // Microsoft từ chối phiên mới nhờ trợ lý PC (Selenium) như tool gốc.
  owa_pib: async (params, emit, ctx) => {
    const t0 = Date.now();
    const callsigns = (params["callsigns"] as string[] | undefined) ?? [];
    const hours = Number(params["hours"] ?? 10) || 10;
    const overwrite = !!params["overwrite"];
    try {
      const { downloadPib } = await import("../port/owa_pib");
      emit({ type: "line", text: `▶ ${callsigns.length} chuyến · tải PIB trực tiếp từ Outlook (máy chủ web), cửa sổ ±${hours}h` });
      const res = await downloadPib(ctx, {
        callsigns,
        hours,
        overwrite,
        onProgress: (text, cs) => emit({ type: "line", text: `  ${text}`, found: cs || undefined }),
      });
      const saved = res.saved.filter((f) => !f.skipped).length;
      try {
        const { getFile } = await import("../store.server");
        const { queueFilesToPc } = await import("./pc.server");
        const copies: { name: string; bytes: Uint8Array }[] = [];
        for (const f of res.saved) {
          const b = await getFile(ctx, `pibwx/${f.filename}`);
          if (b?.byteLength) copies.push({ name: f.filename, bytes: new Uint8Array(b) });
        }
        if (copies.length) {
          const dest = await queueFilesToPc(ctx, "pibwx", copies);
          emit({ type: "line", text: dest ? `💾 lưu ${copies.length} file PIB về máy: ${dest}` : "· trợ lý PC chưa bật — chưa lưu được file về ổ D/C", cls: dest ? undefined : "bad" });
        }
      } catch { /* lưu máy lỗi — vẫn đính kèm */ }
      const skipped = res.saved.length - saved;
      for (const c of res.missing) emit({ type: "line", text: `✗ ${c}: không thấy PIB trong cửa sổ ±${hours}h`, cls: "bad" });
      for (const e of res.errors.slice(0, 10)) emit({ type: "line", text: `✗ ${e}`, cls: "bad" });
      emit({
        type: "end",
        code: res.missing.length ? 2 : 0,
        elapsed: (Date.now() - t0) / 1000,
        ok: saved,
        skipped,
        failed: res.missing.length,
        missing: res.missing,
        files: res.saved.map((f) => ({ callsign: f.callsign, filename: f.filename, new: !f.skipped, source: "owa_server" })),
        source: "owa_server",
        auth_failed: false,
      });
      return;
    } catch (e) {
      const { OwaAuthError } = await import("../port/owa");
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof OwaAuthError) {
        const { invalidateToken } = await import("../port/owa_pib");
        await invalidateToken(ctx).catch(() => {});
        emit({ type: "owa_state", text: "Phiên Outlook bị từ chối", state: "stale" });
        emit({ type: "line", text: `· máy chủ không đăng nhập được: ${msg}`, cls: "bad" });
        emit({ type: "line", text: "· chuyển sang trợ lý PC (Chrome thật)…" });
      } else {
        emit({ type: "line", text: `· tải trực tiếp lỗi: ${msg} — thử trợ lý PC…`, cls: "bad" });
      }
    }
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: `✗ ${offline().error}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: callsigns.length, missing: callsigns });
      return;
    }
    try {
      const id = await pc.enqueue("owa_pib", params);
      let lastBeat = 0;
      const r = await pc.waitResult(id, 450_000, (elapsed) => {
        if (elapsed - lastBeat >= 30) {
          lastBeat = elapsed;
          emit({ type: "line", text: `· đang chờ trợ lý PC tải PIB… (${Math.round(elapsed)}s)`, cls: "sys" });
        }
      });
      // Trợ lý PC gửi kèm nội dung PDF — cất vào kho pibwx/ để attach/auto dùng.
      const ups = Array.isArray(r["uploads"]) ? (r["uploads"] as Array<Record<string, unknown>>) : [];
      if (ups.length) {
        try {
          const { putFile } = await import("../store.server");
          const { safeFilename } = await import("../core/models");
          for (const u of ups) {
            const name = safeFilename(String(u?.name || ""));
            if (!name || typeof u?.b64 !== "string") continue;
            try {
              await putFile(ctx, `pibwx/${name}`, Buffer.from(String(u.b64), "base64"), "application/pdf");
            } catch (e) { console.warn("PIB save:", e); }
          }
        } catch { /* kho lỗi — vẫn trả kết quả tải */ }
        delete r["uploads"];
      }
      const events = (r["events"] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const ev of events) emit(ev);
      if (r["cancelled"]) {
        emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 0, missing: [], cancelled: true, source: r["source"] ?? "none" });
        return;
      }
      const ok = Number(r["ok"] ?? 0);
      const skipped = Number(r["skipped"] ?? 0);
      const missing = (r["missing"] as string[] | undefined) ?? [];
      emit({
        type: "end",
        code: missing.length ? 2 : 0,
        elapsed: (Date.now() - t0) / 1000,
        ok,
        skipped,
        failed: missing.length,
        missing,
        files: r["files"] ?? [],
        source: r["source"] ?? "owa",
        auth_failed: !!r["auth_failed"],
        folder: r["folder"] ?? "",
      });
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: callsigns.length, missing: callsigns });
    }
  },
};

/** Newest two FLIGHT PLAN files by (date, VER number): {new, old}. */
export function fplVerPair(names: string[]): { new: string; old: string } {
  const key = (n: string) => {
    const v = /VER\D{0,3}(\d+)/i.exec(n); const d = /ON\s*(\d{1,2})\s*([A-Z]{3})/i.exec(n);
    const mon = d ? "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC".indexOf(d[2].toUpperCase()) / 3 : -1;
    return (mon * 100 + (d ? Number(d[1]) : 0)) * 1000 + (v ? Number(v[1]) : -1);
  };
  const s = names.filter(n => /FLIGHT\s*PLAN|\bFPL\b/i.test(n)).sort((a, b) => key(b) - key(a));
  return { new: s[0] || "", old: s[1] || "" };
}
