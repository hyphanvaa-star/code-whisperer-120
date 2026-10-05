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
  // phòng qua trợ lý PC (lệnh owa_efb đọc Outlook desktop).
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
      // Gộp các lượt thăm dò trùng nhau (nhiều tab mở cùng lúc) thành một job
      // trên máy công ty thay vì đẩy một đống job giống hệt nhau.
      const id = await pc.enqueueDeduped("owa_fpl_watch", { after }, 8_000);
      const r = (await pc.waitResult(id, 20_000)) as Record<string, any>;
      const ups = Array.isArray(r?.uploads) ? r.uploads : [];
      if (ups.length) {
        const { putFile } = await import("../store.server");
        const { safeFilename } = await import("../core/models");
        for (const u of ups) {
          const name = safeFilename(String(u?.name || ""));
          if (!name || !/\.(xlsx|xlsm)$/i.test(name) || typeof u?.b64 !== "string") continue;
          try {
            await putFile(ctx, `excel/${name}`, Buffer.from(u.b64, "base64"), "application/octet-stream");
          } catch (e) { console.warn("FPL VER save:", e); }
        }
        delete r.uploads;
      }
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
          const { ofpTextFromPdf } = await import("../port/ofp_weights");
          const text = await ofpTextFromPdf(bytes);
          const atc = ae.extractAtc(text).trim();
          const ezfw = ae.extractEzfw(text);
          const subject = ae.subjectOf(flight.callsign, flight.std);
          const attachments = [
            { name: `ATC_${ae.fileCallsign(flight.callsign)}.txt`, data_b64: Buffer.from(atc, "utf-8").toString("base64") },
            { name: `EZFW_${ae.fileCallsign(flight.callsign)}.txt`, data_b64: Buffer.from(ezfw, "utf-8").toString("base64") },
          ];
          // Nháp phải nằm trong hộp thư chung omc@vietjetair.com trên Outlook
          // Web (owa_draft) — không mở Outlook desktop (outlook_draft).
          const id = await pc.enqueue("owa_draft", { subject, body: ae.BODY, attachments });
          const r = await pc.waitResult(id, 120_000);
          emit({ type: "line", text: `✓ ${subject}` });
          ok += 1;
          subjects.push(subject);
          files.push(attachments[0]!.name, attachments[1]!.name);
          void r;
        } catch (exc) {
          const msg = exc instanceof Error ? exc.message : String(exc);
          emit({ type: "line", text: `✗ ${want}: ${msg}`, cls: "bad" });
        }
      }
    } catch (exc) {
      emit({ type: "line", text: `✗ ${exc instanceof Error ? exc.message : String(exc)}`, cls: "bad" });
    }
    emit({ type: "end", code: ok ? 0 : 1, elapsed: (Date.now() - t0) / 1000, ok, failed: wants.length - ok, subject: subjects.join(" · "), files });
  },

  // Port of web.py start_owa_login(): thử đăng nhập thẳng từ máy chủ (ROPC,
  // port/owa_pib.ensureToken) — không cần trợ lý PC. Chỉ khi Microsoft từ chối
  // (khoá tài khoản/ADFS/MFA) mới nhờ trợ lý PC mở Chrome Outlook Web thật.
  owa_login: async (_params, emit, ctx) => {
    const t0 = Date.now();
    try {
      const { ensureToken } = await import("../port/owa_pib");
      emit({ type: "line", text: "▶ Đăng nhập Outlook trực tiếp từ máy chủ web…" });
      await ensureToken(ctx, (m) => emit({ type: "line", text: `· ${m}` }));
      emit({ type: "line", text: "✓ Outlook Web đọc được mailbox — không cần trợ lý PC." });
      emit({ type: "end", code: 0, elapsed: (Date.now() - t0) / 1000, ok: 1, skipped: 0, failed: 0, logged_in: true, owa_state: "healthy", source: "server" });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emit({ type: "line", text: `· đăng nhập trực tiếp không được: ${msg}`, cls: "bad" });
    }
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) {
      emit({ type: "line", text: `✗ ${offline().error}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, logged_in: false, owa_state: "stale" });
      return;
    }
    try {
      // Phiên Outlook trên máy công ty còn sống thì không mở lại Chrome —
      // tránh cửa sổ đăng nhập nhảy ra mỗi lần tải lại trang.
      const pid = await pc.enqueueDeduped("owa_fpl_watch", { after: 0 }, 5_000);
      const st = await pc.waitResult(pid, 15_000);
      if (st["running"]) {
        emit({ type: "line", text: "✓ Phiên Outlook Web trên máy công ty còn sống — không cần mở Chrome." });
        emit({ type: "end", code: 0, elapsed: (Date.now() - t0) / 1000, ok: 1, skipped: 0, failed: 0, logged_in: true, owa_state: "healthy", source: "pc_session" });
        return;
      }
    } catch {
      /* chưa kiểm tra được — cứ thử đăng nhập như thường */
    }
    try {
      emit({ type: "line", text: "▶ Mở Chrome Outlook Web — auto-login nếu đã lưu owa_username/owa_password (MFA thì xác nhận tay)." });
      // Gửi kèm tài khoản OWA (secret phía web) để trợ lý tự điền đăng nhập —
      // kênh job chỉ đọc bằng PC_AGENT_TOKEN nên không lộ ra ngoài.
      const owaUser = process.env["OWA_USERNAME"] || process.env["OUTLOOK_USERNAME"] || "";
      const owaPass = process.env["OWA_PASSWORD"] || process.env["OUTLOOK_PASSWORD"] || "";
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
