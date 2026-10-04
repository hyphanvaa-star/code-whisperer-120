import type { Jobs, Routes } from "../types";
import { OwaAuthError, OwaError, getToken } from "../port/owa";

// Port of the web.py "autoload" mail-based endpoints not handled by
// handlers/owa.server.ts (which now owns /api/owa/login, /api/owa/fpl-watch
// and /api/pib/download via the PC-agent owa_login/owa_fpl_watch/owa_pib
// jobs). /api/defect/summary still needs direct Graph/EWS creds (OWA_USERNAME/
// OWA_PASSWORD) and is not a PC job in the original tool.

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
  // Port of web.py "/api/defect/summary" mail leg (defect_summary.pull_today).
  "GET /api/defect/summary": async () => {
    const res = await tryMailLogin();
    if (!res.ok) return { error: res.error };
    return { error: "Đăng nhập Outlook OK nhưng tải defect summary qua Outlook REST chưa được nối — cần nối tiếp phần tải thư mục/attachment." };
  },
};

export const jobs: Jobs = {};
