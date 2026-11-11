// Server-only AIMS client (vj-aims.aims.aero). Logs in with the dispatcher's own
// saved AIMS account and keeps the session cookies in their user_credentials row
// (service-role only), so it logs in again only when AIMS drops the session.
import { currentUserId, env as credEnv } from "./creds.server";
import {
  buildRunParams,
  exportArg,
  findTask,
  parseDayrepPage,
  parseViewerReportId,
  startBuildArg,
  type DayrepPage,
} from "./port/aims_report";

const BASE = "https://vj-aims.aims.aero";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const STATION = "__station";

export class AimsError extends Error {}

type Jar = Map<string, string>;

function parseJar(s: string): Jar {
  const jar: Jar = new Map();
  try {
    for (const [k, v] of Object.entries(JSON.parse(s || "{}") as Record<string, string>)) jar.set(k, String(v));
  } catch {
    /* empty */
  }
  return jar;
}
const cookieHeader = (jar: Jar) => [...jar].filter(([k]) => !k.startsWith("__")).map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(jar: Jar, res: Response) {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = h.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const c of list) {
    const pair = c.split(";")[0] ?? "";
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const val = pair.slice(i + 1).trim();
    if (!val || val === "deleted" || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name);
    else jar.set(name, val);
  }
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function loadJar(userId: string): Promise<Jar> {
  const { data } = await (await admin()).from("user_credentials").select("aims_cookies").eq("user_id", userId).maybeSingle();
  return parseJar(data?.aims_cookies ?? "");
}
async function saveJar(userId: string, jar: Jar) {
  await (await admin()).from("user_credentials").update({ aims_cookies: JSON.stringify(Object.fromEntries(jar)) }).eq("user_id", userId);
}

async function req(jar: Jar, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, follow = 5): Promise<Response> {
  let url = path.startsWith("http") ? path : BASE + path;
  let method = init.method ?? "GET";
  let body: string | null = init.body ?? null;
  for (let i = 0; ; i++) {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookieHeader(jar), ...(init.headers ?? {}) },
      body,
      redirect: "manual",
    });
    absorb(jar, res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc && i < follow) {
      url = new URL(loc, url).toString();
      method = "GET";
      body = null;
      continue;
    }
    return res;
  }
}

const isLoginUrl = (u: string) => /\/LoginW/i.test(u);

async function openDayrep(jar: Jar): Promise<DayrepPage | null> {
  const res = await req(jar, "/AIMS/DAYREP?AIMSSID=&AIMSSCEN=", { headers: { Accept: "text/html" } });
  if (res.status !== 200 || isLoginUrl(res.url)) return null;
  return parseDayrepPage(await res.text());
}

async function login(jar: Jar): Promise<void> {
  const user = credEnv("AIMS_USER");
  const pass = credEnv("AIMS_PASS");
  if (!user || !pass) throw new AimsError("Chưa lưu tài khoản AIMS — mở 🔑 Tài khoản, mục AIMS để lưu User ID và mật khẩu.");
  const station = jar.get(STATION) || crypto.randomUUID();
  for (const k of [...jar.keys()]) jar.delete(k);
  jar.set(STATION, station);
  const page = await req(jar, "/AIMS/LoginW", { headers: { Accept: "text/html" } });
  const html = await page.text();
  const tok = html.match(/name=["']?__RequestVerificationToken["']?\s+type=["']?hidden["']?\s+value=["']?([^"'\s>]+)/)?.[1];
  if (page.status !== 200 || !tok) throw new AimsError(`Không mở được trang đăng nhập AIMS (HTTP ${page.status}).`);
  const body = new URLSearchParams({ u: user, p: pass, e: credEnv("AIMS_EMAIL") || "", stationID: station, __RequestVerificationToken: tok }).toString();
  const res = await req(jar, "/AIMS/LoginW/LetMeIn", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE,
      Referer: BASE + "/AIMS/LoginW",
      RequestVerificationToken: tok,
    },
  });
  if (res.status >= 400) throw new AimsError("Đăng nhập AIMS thất bại — kiểm tra lại User ID và mật khẩu AIMS.");
}

/** Fresh login with the active AIMS account (used when saving it). */
export async function aimsLoginTest(): Promise<void> {
  const uid = currentUserId();
  const jar = await loadJar(uid);
  await login(jar);
  const page = await openDayrep(jar);
  if (!page) throw new AimsError("Đăng nhập AIMS thất bại — kiểm tra lại User ID và mật khẩu AIMS.");
  await saveJar(uid, jar);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the user's Daily Flight Schedule report for [start, end] and returns the XLSX bytes. */
export async function aimsCrewlistXlsx(start: string, end: string, fromTime?: string, toTime?: string): Promise<ArrayBuffer> {
  const uid = currentUserId();
  if (!uid) throw new AimsError("Chưa đăng nhập.");
  const jar = await loadJar(uid);
  let page = jar.size > 1 ? await openDayrep(jar) : null;
  if (!page) {
    await login(jar);
    page = await openDayrep(jar);
    if (!page) throw new AimsError("Đã đăng nhập AIMS nhưng không mở được Daily Flight Schedule (1.2.1) — kiểm tra quyền của tài khoản.");
  }
  await saveJar(uid, jar);

  const ajax = {
    AIMSSID: page.uid,
    AIMSSCEN: page.scen,
    RequestVerificationToken: page.token,
    "X-Requested-With": "XMLHttpRequest",
    Origin: BASE,
    Referer: BASE + "/AIMS/DAYREP?AIMSSID=&AIMSSCEN=",
  };
  const run = await req(jar, "/AIMS/DAYREP/RunReport", {
    method: "POST",
    body: JSON.stringify(buildRunParams(page.params, start, end, fromTime, toTime)),
    headers: { ...ajax, "Content-Type": "application/json", Accept: "*/*" },
  });
  const taskId = (await run.text()).trim().replace(/^"|"$/g, "");
  if (run.status !== 200 || !/^DayRep_/.test(taskId)) throw new AimsError(`AIMS không chạy được báo cáo (HTTP ${run.status}).`);

  let link = "";
  for (let i = 0; i < 60 && !link; i++) {
    await sleep(1500);
    const p = await req(jar, `/AIMS/DAYREP/progressfilter?mode=1&name=${encodeURIComponent(taskId)}`, { headers: { ...ajax, Accept: "application/json" } });
    let reply: unknown = null;
    try {
      reply = await p.json();
    } catch {
      /* retry */
    }
    const t = findTask(reply, taskId);
    if (!t) continue;
    if (t.status === 2) throw new AimsError("AIMS đã huỷ báo cáo" + (t.error ? `: ${t.error}` : "."));
    if (t.status === 3) {
      if (t.error && !t.link) throw new AimsError(`AIMS: ${t.error}`);
      link = t.link;
    }
  }
  if (!link) throw new AimsError("AIMS tổng hợp báo cáo quá lâu (90 giây) — thử lại sau.");

  const viewer = await req(jar, "/AIMS/DAYREP" + link, { headers: { Accept: "text/html" } });
  const reportId = parseViewerReportId(await viewer.text());
  if (!reportId) throw new AimsError("Không mở được bảng báo cáo AIMS.");
  const inv = "/AIMS/DAYREP/WebDocumentViewerInvoke";
  const dx = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Accept: "application/json", Referer: BASE + "/AIMS/DAYREP" + link };
  const sb = await req(jar, inv, { method: "POST", body: "actionKey=startBuild&arg=" + encodeURIComponent(startBuildArg(reportId)), headers: dx });
  const docId = ((await sb.json().catch(() => null)) as { result?: { documentId?: string } } | null)?.result?.documentId;
  if (!docId) throw new AimsError("AIMS không dựng được file báo cáo.");
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    const st = await req(jar, inv, { method: "POST", body: "actionKey=getBuildStatus&arg=" + encodeURIComponent(JSON.stringify({ documentId: docId, timeOut: 5000 })), headers: dx });
    const j = (await st.json().catch(() => null)) as { result?: { completed?: boolean; faultMessage?: string | null } } | null;
    if (j?.result?.faultMessage) throw new AimsError(`AIMS: ${j.result.faultMessage}`);
    done = Boolean(j?.result?.completed);
    if (!done) await sleep(1000);
  }
  if (!done) throw new AimsError("AIMS dựng file quá lâu — thử lại sau.");
  const ex = await req(jar, `${inv}?actionKey=exportTo&arg=${encodeURIComponent(exportArg(docId))}`, { headers: { Accept: "*/*", Referer: dx.Referer } });
  const buf = await ex.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 2));
  if (ex.status !== 200 || sig[0] !== 0x50 || sig[1] !== 0x4b) throw new AimsError(`AIMS không trả về file Excel (HTTP ${ex.status}).`);
  await saveJar(uid, jar);
  return buf;
}
