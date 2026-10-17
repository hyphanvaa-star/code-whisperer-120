import { env as credEnv } from "../creds.server";
import type { Jobs, Routes } from "../types";
import { OwaAuthError, OwaError, getToken } from "../port/owa";

// Port of the web.py "autoload" mail-based endpoints not handled by
// handlers/owa.server.ts (which now owns /api/owa/login, /api/owa/fpl-watch
// and /api/pib/download via the PC-agent owa_login/owa_fpl_watch/owa_pib
// jobs). /api/defect/summary still needs direct Graph/EWS creds (OWA_USERNAME/
// OWA_PASSWORD) and is not a PC job in the original tool.

function mailEnv(): { username: string; password: string; mailbox: string } {
  const username = credEnv("OWA_USERNAME") || credEnv("OUTLOOK_USERNAME") || "";
  const password = credEnv("OWA_PASSWORD") || credEnv("OUTLOOK_PASSWORD") || "";
  const mailbox = credEnv("OUTLOOK_MAILBOX") || "omc@vietjetair.com";
  return { username, password, mailbox };
}

async function tryMailLogin(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { username, password } = mailEnv();
  if (!username || !password) {
    return { ok: false, error: "Chưa có tài khoản Outlook — gửi cho quản trị để lưu (OWA_USERNAME/OWA_PASSWORD)." };
  }
  try {
    const token = await getToken(username, password);
    return { ok: true, token };
  } catch (exc) {
    if (exc instanceof OwaAuthError || exc instanceof OwaError) return { ok: false, error: exc.message };
    return { ok: false, error: String(exc) };
  }
}

async function pullDefect(ctx: Parameters<Routes[string]>[0]) {
  const pc = await import("../pcagent.server");
  const agent = await pc.agentInfo(ctx);
  if (!pc.agentOnline(agent)) return { error: "Trợ lý PC chưa kết nối — mở trợ lý trên máy công ty rồi thử lại (cần phiên Outlook Web để tải mail defect summary)." };
  try {
    const id = await pc.enqueueDeduped("defect_pdf", {}, 60_000);
    const r = await pc.waitResult(id, 170_000);
    const b64 = String(r["b64"] || "");
    if (!b64) return { error: String(r["error"] || "Trợ lý PC không gửi về file PDF defect summary.") };
    const buf = Buffer.from(b64, "base64");
    const { processUpload } = await import("../port/defect_pdf");
    const { saveDefectSummary } = await import("../defect-limits.server");
    const name = String(r["name"] || "defect_summary.pdf");
    const res = await processUpload(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, { sourceName: name });
    const summary = {
      exists: true, file: res["source"] as string, source: res["source"] as string,
      rows: res.rows, aircraft_count: res.aircraft_count, raw_rows: res.raw_rows,
      saved_at: res.saved_at, aircraft: res.aircraft,
      subject: String(r["subject"] || name), mail_sent_text: String(r["sent"] || ""), slot: String(r["slot"] || ""),
    };
    const limitsAircraft = await saveDefectSummary(ctx, summary);
    return { ...summary, limits_aircraft: limitsAircraft, ok: true };
  } catch (exc) {
    return { error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export const routes: Routes = {
  // Port of web.py "/api/defect/summary" (defect_summary.pull_today) — mail
  // tải qua phiên Outlook Web trên máy công ty (trợ lý PC), PDF đọc ở web.
  "POST /api/defect/summary": (ctx) => pullDefect(ctx),
  "GET /api/defect/summary": (ctx) => pullDefect(ctx),
};

export const jobs: Jobs = {};
