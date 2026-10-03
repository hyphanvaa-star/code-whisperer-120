// Server-only FliteBrief client. Logs in with the Symfony form (CSRF), keeps
// session cookies in the fb_session table so every worker shares one login.
const BASE = "https://vjc.flitebrief.aero";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Jar = Map<string, string>;

function parseJar(s: string): Jar {
  const jar: Jar = new Map();
  if (!s) return jar;
  try {
    for (const [k, v] of Object.entries(JSON.parse(s) as Record<string, string>)) jar.set(k, v);
  } catch {
    /* ignore */
  }
  return jar;
}
const jarHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(jar: Jar, res: Response) {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = h.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) {
      const name = pair.slice(0, i).trim();
      const val = pair.slice(i + 1).trim();
      if (!val || val === "deleted") jar.delete(name);
      else jar.set(name, val);
    }
  }
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function loadJar(): Promise<Jar> {
  const db = await admin();
  const { data } = await db.from("fb_session").select("cookies").eq("id", 1).maybeSingle();
  return parseJar(data?.cookies ?? "");
}
async function saveJar(jar: Jar) {
  const db = await admin();
  await db
    .from("fb_session")
    .upsert({ id: 1, cookies: JSON.stringify(Object.fromEntries(jar)), updated_at: new Date().toISOString() });
}

async function rawGet(jar: Jar, path: string, accept = "application/json") {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA, Accept: accept, Cookie: jarHeader(jar) },
    redirect: "manual",
  });
  absorb(jar, res);
  return res;
}

export class FliteBriefError extends Error {}

async function login(): Promise<Jar> {
  const user = process.env["FLITEBRIEF_USER"];
  const pass = process.env["FLITEBRIEF_PASS"];
  if (!user || !pass) throw new FliteBriefError("Chưa cấu hình tài khoản FliteBrief");
  const jar: Jar = new Map();
  const page = await rawGet(jar, "/login", "text/html");
  const html = await page.text();
  const m = html.match(/name="_csrf_token"\s+value="([^"]+)"/);
  if (!m) throw new FliteBriefError("Không đọc được trang đăng nhập FliteBrief");
  const body = new URLSearchParams({ username: user, password: pass, _csrf_token: m[1], login: "" });
  let res = await fetch(BASE + "/login_check", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarHeader(jar),
    },
    body,
    redirect: "manual",
  });
  absorb(jar, res);
  let loc = res.headers.get("location") ?? "";
  for (let i = 0; i < 5 && res.status >= 300 && res.status < 400 && loc; i++) {
    if (loc.includes("/login") && !loc.includes("login_check")) {
      throw new FliteBriefError("Đăng nhập FliteBrief thất bại — kiểm tra lại tài khoản");
    }
    res = await rawGet(jar, loc.startsWith("http") ? new URL(loc).pathname + new URL(loc).search : loc, "text/html");
    loc = res.headers.get("location") ?? "";
  }
  const probe = await rawGet(jar, "/webapi/fleets");
  if (probe.status !== 200) throw new FliteBriefError("Đăng nhập FliteBrief thất bại — kiểm tra lại tài khoản");
  await saveJar(jar);
  return jar;
}

/** GET a FliteBrief path with the shared session; re-login once on 401/redirect. */
export async function fbGet(path: string, accept = "application/json"): Promise<Response> {
  let jar = await loadJar();
  if (jar.size) {
    const res = await rawGet(jar, path, accept);
    if (res.status === 200) return res;
    if (res.status !== 401 && res.status !== 403 && !(res.status >= 300 && res.status < 400)) return res;
  }
  jar = await login();
  return rawGet(jar, path, accept);
}

export async function fbJson<T = unknown>(path: string): Promise<T> {
  const res = await fbGet(path);
  if (!res.ok) throw new FliteBriefError(`FliteBrief trả lỗi ${res.status}`);
  return (await res.json()) as T;
}
