import type { Jobs, Routes } from "../types";
import { SYSTEM_PROMPT } from "../port/ai_chat";

// Port of the web.py endpoints for group "misc": /api/chat(+/status), /api/credentials(+/save).
// Keep JSON shapes identical to web.py (ai_chat.py / config.py credentials_*).

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type ChatMsg = { role: string; content: string };

export const routes: Routes = {
  "GET /api/chat/status": () => ({ configured: Boolean(process.env.LOVABLE_API_KEY) }),

  "POST /api/chat": async (ctx) => {
    const body = await ctx.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return { error: "messages trống" };
    }
    const context = String(body.context || "");
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { error: "Chưa có tài khoản AI Gateway — gửi cho quản trị để lưu (LOVABLE_API_KEY)." };
    }
    const chatMessages: ChatMsg[] = [
      { role: "system", content: context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT },
      ...(messages as ChatMsg[]).map((m) => ({ role: String(m.role || "user"), content: String(m.content || "") })),
    ];
    try {
      const r = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, messages: chatMessages }),
      });
      if (r.status === 429) return { error: "Hết hạn mức AI Gateway, thử lại sau." };
      if (r.status === 402) return { error: "Hết credit AI Gateway — cần nạp thêm." };
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return { error: `AI Gateway lỗi ${r.status}: ${t.slice(0, 300)}` };
      }
      const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? "";
      return { content, actions: [] };
    } catch (exc) {
      return { error: String((exc as Error)?.message ?? exc) };
    }
  },

  // Port of config.credentials_status() — presence only, NEVER the password.
  // Tài khoản người dùng tự lưu (theo từng người) được ưu tiên; không có thì
  // dùng tài khoản mặc định của đội (biến môi trường).
  "GET /api/credentials": async (ctx) => {
    const { KINDS, loadStored } = await import("../creds.server");
    const stored = await loadStored(ctx.userId);
    const accounts: Record<string, unknown> = {};
    for (const [kind, k] of Object.entries(KINDS)) {
      const mine = stored[kind];
      const envUser = k.user.map((n) => process.env[n]).find(Boolean) ?? "";
      const envPass = k.pass.map((n) => process.env[n]).find(Boolean) ?? "";
      const prefill = kind === "flitebrief" || kind === "omni" || kind === "aviweb";
      if (mine?.username && mine.password) {
        accounts[kind] = { label: k.label, username: mine.username, mailbox: mine.mailbox ?? "", has_password: true, source: "file", env_names: [k.user[0], k.pass[0]] };
      } else {
        accounts[kind] = {
          label: k.label,
          username: prefill ? envUser : "",
          mailbox: kind === "outlook" ? (process.env["OUTLOOK_MAILBOX"] ?? "") : "",
          has_password: Boolean(envUser && envPass),
          source: envUser && envPass ? "env" : "none",
          env_names: [k.user[0], k.pass[0]],
        };
      }
    }
    return { accounts, file: "" };
  },

  // Lưu tài khoản riêng của người đang đăng nhập (mật khẩu mã hoá, chỉ máy chủ đọc được).
  // Để trống mật khẩu = giữ mật khẩu đã lưu; username trống = quay về tài khoản mặc định.
  "POST /api/credentials/save": async (ctx) => {
    const b = await ctx.json();
    const kind = String(b["kind"] || "");
    const { KINDS, loadStored, saveStored, enc, runWithVars } = await import("../creds.server");
    const k = KINDS[kind];
    if (!k) return { error: "loại tài khoản không hợp lệ" };
    const username = String(b["username"] || "").trim().slice(0, 200);
    const password = String(b["password"] || "").slice(0, 200);
    const stored = await loadStored(ctx.userId);
    if (!username) {
      delete stored[kind];
      await saveStored(ctx.userId, stored, kind === "flitebrief");
      return { ok: true, name: "đã quay về tài khoản mặc định" };
    }
    const prev = stored[kind];
    const encPw = password ? enc(password) : prev?.username === username ? prev.password : "";
    if (!encPw) {
      // Không có mật khẩu: nếu trùng tài khoản mặc định thì dùng mặc định.
      const envUser = k.user.map((n) => process.env[n]).find(Boolean) ?? "";
      if (envUser && envUser.toLowerCase() === username.toLowerCase()) {
        delete stored[kind];
        await saveStored(ctx.userId, stored, kind === "flitebrief");
        return { ok: true, name: "dùng tài khoản mặc định" };
      }
      return { error: "nhập mật khẩu để lưu tài khoản này" };
    }
    stored[kind] = { username, password: encPw, ...(kind === "outlook" ? { mailbox: String(b["mailbox"] || "").trim().slice(0, 200) } : {}) };
    await saveStored(ctx.userId, stored, kind === "flitebrief");
    if (kind === "flitebrief" && password) {
      try {
        const vars: Record<string, string> = { FLITEBRIEF_USER: username, FLITEBRIEF_PASS: password };
        const { fbLoginTest } = await import("@/lib/flitebrief.server");
        const { runWithUserCreds } = await import("../creds.server");
        await runWithUserCreds(ctx.userId, () => runWithVars(vars, () => fbLoginTest()));
        return { ok: true, name: username };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { ok: true, name: username };
  },
};

export const jobs: Jobs = {};
