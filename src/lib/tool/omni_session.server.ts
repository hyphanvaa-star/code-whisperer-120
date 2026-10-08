// Shared Omni token cache (service-role-only table `omni_session`).
// Omni stores the caller's X-Forwarded-For in a ~15-char column, so token creation
// from the cloud runtime (IPv6 egress) fails with "error saving the entity changes".
// Tokens live 30 days, so we reuse one; when none exists the dispatcher's browser
// logs in directly (Omni allows CORS) and hands the token to `saveBrowserToken`.
import * as omni from "./port/omni";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const MIN_LEFT_S = 600;

omni.setTokenStore({
  async get(username) {
    const db = await admin();
    const { data } = await db.from("omni_session").select("token, exp").eq("username", username).maybeSingle();
    if (!data?.token) return null;
    const exp = data.exp ? Date.parse(data.exp) / 1000 : omni.tokenExp(data.token);
    if (exp && exp < Date.now() / 1000 + MIN_LEFT_S) return null;
    return { token: data.token };
  },
  async set(username, s) {
    const db = await admin();
    const exp = omni.tokenExp(s.token);
    await db.from("omni_session").upsert({
      username,
      token: s.token,
      exp: exp ? new Date(exp * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
  },
  async clear(username) {
    const db = await admin();
    await db.from("omni_session").update({ token: "", exp: null, updated_at: new Date().toISOString() }).eq("username", username);
  },
});

/** Kiểm tra token trình duyệt gửi lên bằng một lệnh đọc Omni thật rồi lưu cho cả team. */
export async function saveBrowserToken(username: string, token: string): Promise<{ ok: true; exp: number }> {
  token = String(token || "").trim();
  if (!token || token.length > 8000) throw new Error("token Omni không hợp lệ");
  const exp = omni.tokenExp(token);
  if (exp && exp < Date.now() / 1000 + MIN_LEFT_S) throw new Error("token Omni đã hết hạn");
  const day = new Date().toISOString().slice(0, 10);
  const r = await fetch(omni.API + omni.FLIGHTS, {
    method: "POST",
    headers: omni.headers({ token }),
    body: JSON.stringify({ flightDate: day }),
  });
  if (r.status !== 200) throw new Error(`Omni không chấp nhận phiên này (HTTP ${r.status})`);
  const db = await admin();
  await db.from("omni_session").upsert({
    username,
    token,
    exp: exp ? new Date(exp * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  return { ok: true, exp };
}

export function ensureOmniStore(): void {
  /* importing this module registers the store */
}
