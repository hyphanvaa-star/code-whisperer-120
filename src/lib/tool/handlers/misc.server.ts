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

  // Port of config.credentials_status() — presence only, NEVER the values.
  "GET /api/credentials": () => {
    const ENV: Record<string, [string, string, string]> = {
      flitebrief: ["FLITEBRIEF_USER", "FLITEBRIEF_PASS", "FliteBrief"],
      omni: ["OMNI_USER", "OMNI_PASS", "InFlight Omni"],
      owa: ["OWA_USER", "OWA_PASS", "Outlook Web"],
      outlook: ["OUTLOOK_MAIL_USER", "OUTLOOK_MAIL_PASS", "Outlook (mail nháp)"],
      aviweb: ["AVIWEB_USER", "AVIWEB_PASS", "AviWeb"],
    };
    const accounts: Record<string, unknown> = {};
    for (const [kind, [uKey, pKey, label]] of Object.entries(ENV)) {
      const hasUser = Boolean(process.env[uKey]);
      const hasPass = Boolean(process.env[pKey]);
      accounts[kind] = {
        label,
        username: "",
        has_password: hasUser && hasPass,
        source: hasUser && hasPass ? "env" : "none",
        env_names: [uKey, pKey],
      };
    }
    return { accounts, file: "" };
  },

  // web.py ghi trực tiếp vào credentials.json từ UI; ở đây tài khoản bên thứ ba
  // sống trong biến môi trường (secrets) do quản trị quản lý — UI không được
  // ghi trực tiếp, nên trả thông báo rõ ràng thay vì giả vờ đã lưu.
  "POST /api/credentials/save": () => ({
    error:
      "Tài khoản (FliteBrief/Omni/OWA/Outlook/AviWeb) do quản trị quản lý qua biến môi trường — " +
      "gửi tên đăng nhập/mật khẩu cho quản trị để lưu, không lưu được từ đây.",
  }),
};

export const jobs: Jobs = {};
