import type { Jobs, Routes } from "../types";
import { OwaAuthError, OwaError, getToken } from "../port/owa";
import { emptyStatus } from "../port/owa_fpl_watch";

// Port of the web.py "autoload" endpoints (OWA login + FPL watch status) and the
// mail-based PIB/defect-summary downloads. The live mailbox paths need
// OWA_USERNAME/OWA_PASSWORD (or OUTLOOK_USERNAME/OUTLOOK_PASSWORD) to reach a
// real Outlook session — verified against the vietjetair.com tenant these
// accounts are federated to on-prem ADFS, so Azure AD rejects the
// password-grant (ROPC) with AADSTS50126 and EWS Basic-Auth is disabled
// tenant-wide. See src/lib/tool/port/owa.ts for the verification notes. Every
// handler below reports that in Vietnamese instead of faking success.

function mailEnv(): { username: string; password: string; mailbox: string } {
  const username = process.env["OWA_USERNAME"] || process.env["OUTLOOK_USERNAME"] || "";
  const password = process.env["OWA_PASSWORD"] || process.env["OUTLOOK_PASSWORD"] || "";
  const mailbox = process.env["OUTLOOK_MAILBOX"] || "omc@vietjetair.com";
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

export const routes: Routes = {
  // Port of web.py "/api/owa/login": attempt a mail login and report outcome.
  "POST /api/owa/login": async () => {
    const res = await tryMailLogin();
    if (res.ok) return { ok: true, logged_in: true };
    return { ok: false, error: res.error };
  },

  // Port of web.py "/api/owa/fpl-watch": status of the background FPL mail
  // watcher. Not running here — no worker-safe way yet to keep a live OWA
  // session between polls — but surfaces why instead of pretending it's idle.
  "GET /api/owa/fpl-watch": async () => {
    const res = await tryMailLogin();
    return res.ok ? emptyStatus("") : emptyStatus(res.error);
  },

  // Port of web.py "/api/pib/download" (graph_pib / outlook_web_pib download).
  "GET /api/pib/download": async () => {
    const res = await tryMailLogin();
    if (!res.ok) return { error: res.error };
    return { error: "Đăng nhập Outlook OK nhưng tải PIB qua Outlook REST chưa được nối — cần nối tiếp phần tải thư mục/attachment." };
  },

  // Port of web.py "/api/defect/summary" mail leg (defect_summary.pull_today).
  "GET /api/defect/summary": async () => {
    const res = await tryMailLogin();
    if (!res.ok) return { error: res.error };
    return { error: "Đăng nhập Outlook OK nhưng tải defect summary qua Outlook REST chưa được nối — cần nối tiếp phần tải thư mục/attachment." };
  },
};

export const jobs: Jobs = {};
