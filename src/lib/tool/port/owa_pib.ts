import { env as credEnv } from "../creds.server";
// Server-side PIB download over Outlook REST v2.0 — port of
// outlook_web_pib.py's _download_pib_sources()/_download_outlook_rest(),
// with Selenium/Chrome replaced by a direct ROPC token (port/owa.ts getToken).
// Runs fully on the web server: no PC agent, no browser. Files land in the
// tool-files bucket under pibwx/ exactly like the original tool's data/pibwx.

import type { Ctx } from "../types";
import { getJson, setJson, putFile, listFiles } from "../store.server";
import { OwaAuthError, OwaError, getToken, restGet, restRoot, findFolderId } from "./owa";

const OMC_MAILBOX = "omc@vietjetair.com";
const PIB_STATIONS = ["SGN", "HAN", "DAD"];
const TOKEN_CACHE_KEY = "owa_token";
const TOKEN_SAFETY_S = 300;
const MAX_PAGES = 20; // 20*50 = 1000 thư tối đa, như bản gốc
const POOL = 8; // tải PDF song song

const RE_PIB = /^PIB[_-].*\.pdf$/i;
const RE_CS_NAME = /PIB[_-][A-Z]+[_-]([A-Z]{2,3}\d+)/i;
const RE_CS_SUBJ = /\b([A-Z]{2,3}\d{1,5})\s*$/;

export interface PibFile {
  callsign: string;
  filename: string;
  when: string | null;
  subject: string;
  skipped: boolean;
}

export interface PibResult {
  saved: PibFile[];
  scanned: number;
  errors: string[];
}

/** Khoá so khớp callsign: cả dạng đầy đủ lẫn chỉ chữ số (828 ~ VJC828). */
export function csKeys(value: string): Set<string> {
  const s = String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const keys = new Set<string>();
  if (!s) return keys;
  keys.add(s);
  const d = s.replace(/\D/g, "");
  if (d) keys.add(d);
  return keys;
}

function callsignOf(filename: string, subject: string): string {
  const m = RE_CS_NAME.exec(filename);
  if (m) return m[1]!.toUpperCase();
  const m2 = RE_CS_SUBJ.exec((subject || "").trim().toUpperCase());
  return m2 ? m2[1]! : "";
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function subjectHitsWant(subject: string, want: Set<string>): boolean {
  const cs = callsignOf("", subject);
  if (cs && intersects(csKeys(cs), want)) return true;
  const compact = (subject || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const k of want) {
    if (k.length >= 3 && compact.includes(k)) return true;
  }
  return false;
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "pib.pdf";
}

// --------------------------------------------------------------------------- //
// Token: cache trong app_settings để không đăng nhập lại mỗi lần (tránh bị
// Microsoft khoá vì đăng nhập nhiều lần — AADSTS50053).
// --------------------------------------------------------------------------- //

function jwtExp(token: string): number {
  try {
    const part = token.split(".")[1] || "";
    const pad = "=".repeat((4 - (part.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(part + pad, "base64url").toString("utf-8"));
    return typeof claims.exp === "number" ? claims.exp : 0;
  } catch {
    return 0;
  }
}

export async function ensureToken(ctx: Ctx, onStatus?: (msg: string) => void): Promise<string> {
  const say = onStatus ?? (() => {});
  const cached = await getJson<{ token?: string }>(ctx, TOKEN_CACHE_KEY, {});
  if (cached.token && jwtExp(cached.token) > Date.now() / 1000 + TOKEN_SAFETY_S) {
    say("Đang kiểm tra phiên Outlook…");
    try {
      await restGet(cached.token, `${restRoot()}/me/mailfolders?$top=1&$select=Id`, "kiểm tra mailbox");
      say("Outlook sẵn sàng.");
      return cached.token;
    } catch (e) {
      if (!(e instanceof OwaAuthError)) throw e;
      say("Phiên Outlook hết hiệu lực — đang đăng nhập lại…");
    }
  } else {
    say("Đang đăng nhập Outlook…");
  }
  const username = credEnv("OWA_USERNAME") || credEnv("OUTLOOK_USERNAME") || "";
  const password = credEnv("OWA_PASSWORD") || credEnv("OUTLOOK_PASSWORD") || "";
  // Client "Office" first-party (d3590ed6-…) + scope outlook.office.com — đúng
  // tổ hợp tool gốc dùng khi lấy token từ Outlook Web.
  const token = await getToken(username, password, {
    clientId: "d3590ed6-52b3-4102-aeff-aad2292ab01c",
    scope: "https://outlook.office.com/.default",
  });
  await setJson(ctx, TOKEN_CACHE_KEY, { token, at: Date.now() });
  say("Outlook sẵn sàng.");
  return token;
}

export async function invalidateToken(ctx: Ctx): Promise<void> {
  await setJson(ctx, TOKEN_CACHE_KEY, {});
}

// --------------------------------------------------------------------------- //
// Tải PIB
// --------------------------------------------------------------------------- //

function folderNameMatches(display: string, want: string): boolean {
  const d = display.trim().toLowerCase();
  const w = want.trim().toLowerCase();
  return d === w || d.replace(/^\d+[.\s-]*/, "").trim() === w;
}

/** Thư mục SGN/HAN/DAD ngay dưới PIB của hộp chung OMC. */
async function findPibStationFolders(token: string, mailbox: string): Promise<Array<{ id: string; name: string }>> {
  const parent = await findFolderId(token, "PIB", { mailbox });
  const data = await restGet(
    token,
    `${restRoot(mailbox)}/mailfolders/${parent.id}/childfolders?$top=100`,
    "liệt kê thư mục PIB",
  );
  const kids = (data.value as Array<Record<string, unknown>>) ?? [];
  const found: Array<{ id: string; name: string }> = [];
  for (const station of PIB_STATIONS) {
    for (const kid of kids) {
      const name = String(kid.DisplayName ?? kid.displayName ?? "");
      if (folderNameMatches(name, station)) {
        found.push({ id: String(kid.Id ?? kid.id ?? ""), name });
        break;
      }
    }
  }
  return found;
}

interface FetchItem {
  mid: string;
  aid: string;
  cs: string;
  when: string | null;
  subject: string;
  name: string;
}

async function downloadFromFolder(
  ctx: Ctx,
  token: string,
  opts: {
    mailbox: string;
    folderId?: string;
    folderName: string;
    callsigns: Set<string> | null;
    wantList: string[];
    lo: Date;
    hi: Date | null;
    overwrite: boolean;
    existing: Set<string>;
    onProgress?: ((text: string, cs: string) => void) | undefined;
  },
): Promise<PibResult> {
  const { mailbox, folderName, callsigns, wantList, lo, hi, overwrite, existing, onProgress } = opts;
  const root = restRoot(mailbox);
  let fid = opts.folderId || "";
  let foundName = folderName;
  if (!fid) {
    const f = await findFolderId(token, folderName, { mailbox });
    fid = f.id;
    foundName = f.name;
  }
  const where = mailbox ? `${mailbox} / ${foundName}` : foundName;
  onProgress?.(`· thư mục Outlook: ${where}`, "");

  let flt = `ReceivedDateTime ge ${lo.toISOString().replace(/\.\d{3}Z$/, "Z")} and HasAttachments eq true`;
  if (hi) flt += ` and ReceivedDateTime le ${hi.toISOString().replace(/\.\d{3}Z$/, "Z")}`;

  const res: PibResult = { saved: [], scanned: 0, errors: [] };
  const foundKeys = new Set<string>();
  const stillMissing = () =>
    wantList.length === 0 ? true : wantList.some((c) => !intersects(csKeys(c), foundKeys));

  const toFetch: FetchItem[] = [];
  let url: string | null =
    `${root}/mailfolders/${fid}/messages` +
    `?$filter=${encodeURIComponent(flt)}` +
    `&$select=Id,Subject,ReceivedDateTime&$orderby=ReceivedDateTime desc&$top=50`;
  let pages = 0;
  while (url && stillMissing()) {
    const data = await restGet(token, url, "liệt kê thư PIB");
    const batch = (data.value as Array<Record<string, unknown>>) ?? [];
    pages += 1;
    url = stillMissing() ? ((data["@odata.nextLink"] as string | undefined) ?? null) : null;

    for (const msg of batch) {
      if (wantList.length && !stillMissing()) break;
      res.scanned += 1;
      const subject = String(msg.Subject ?? msg.subject ?? "");
      if (callsigns && !subjectHitsWant(subject, callsigns)) continue;
      const when = (msg.ReceivedDateTime ?? msg.receivedDateTime)
        ? String(msg.ReceivedDateTime ?? msg.receivedDateTime)
        : null;
      const mid = String(msg.Id ?? msg.id ?? "");
      if (!mid) continue;

      let atts: Array<Record<string, unknown>> = [];
      try {
        const ar = await restGet(
          token,
          `${root}/messages/${encodeURIComponent(mid)}/attachments?$select=Id,Name,Size,ContentType`,
          "liệt kê tệp đính kèm",
        );
        atts = (ar.value as Array<Record<string, unknown>>) ?? [];
      } catch (e) {
        if (e instanceof OwaAuthError) throw e;
        res.errors.push(`${subject.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      for (const a of atts) {
        const name = String(a.Name ?? a.name ?? "");
        if (!RE_PIB.test(name)) continue;
        const cs = callsignOf(name, subject);
        const keys = csKeys(cs);
        if (callsigns && !intersects(keys, callsigns)) continue;
        if (wantList.length && intersects(keys, foundKeys)) continue; // đã có bản mới hơn
        const target = safeFilename(name);
        if (!overwrite && existing.has(target.toLowerCase())) {
          res.saved.push({ callsign: cs, filename: target, when, subject, skipped: true });
          foundKeys.forEach(() => {});
          keys.forEach((k) => foundKeys.add(k));
          onProgress?.(`· đã có ${target}`, cs);
          continue;
        }
        const aid = String(a.Id ?? a.id ?? "");
        if (aid) {
          toFetch.push({ mid, aid, cs, when, subject, name: target });
          keys.forEach((k) => foundKeys.add(k)); // đặt chỗ — tránh trùng CS
        }
      }
    }
    if (pages >= MAX_PAGES) break;
  }

  if (toFetch.length) {
    onProgress?.(`· tải ${toFetch.length} PDF song song…`, "");
    // Worker không có ThreadPool — chạy Promise theo lô POOL.
    for (let i = 0; i < toFetch.length; i += POOL) {
      const chunk = toFetch.slice(i, i + POOL);
      const results = await Promise.allSettled(
        chunk.map(async (it) => {
          const res2 = await fetch(
            `${root}/messages/${encodeURIComponent(it.mid)}/attachments/${encodeURIComponent(it.aid)}/$value`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res2.status === 401 || res2.status === 403) {
            throw new OwaAuthError(`Phiên Outlook bị từ chối tại tải PDF (HTTP ${res2.status}).`, { status: res2.status, stage: "tải PDF" });
          }
          if (!res2.ok) throw new OwaError(`${it.name}: HTTP ${res2.status}`);
          const bytes = new Uint8Array(await res2.arrayBuffer());
          if (!bytes.length) throw new OwaError(`${it.name}: file rỗng`);
          await putFile(ctx, `pibwx/${it.name}`, bytes, "application/pdf");
          return it;
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        const it = chunk[j]!;
        if (r.status === "fulfilled") {
          res.saved.push({ callsign: it.cs, filename: it.name, when: it.when, subject: it.subject, skipped: false });
          onProgress?.(`✓ tải mới: ${it.name}`, it.cs);
        } else {
          const reason = r.reason;
          if (reason instanceof OwaAuthError) throw reason;
          res.errors.push(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }
  }
  return res;
}

/** Port của _download_pib_sources(): PIB chung OMC (SGN/HAN/DAD) trước, thiếu
 * thì folder PIB mail cá nhân. Trả kết quả gộp + danh sách file trong kho. */
export async function downloadPib(
  ctx: Ctx,
  opts: {
    callsigns: string[];
    hours: number;
    overwrite?: boolean;
    onProgress?: (text: string, cs: string) => void;
  },
): Promise<PibResult & { missing: string[] }> {
  const wantList = opts.callsigns.map((c) => c.trim().toUpperCase()).filter(Boolean);
  const want = new Set<string>();
  for (const c of wantList) csKeys(c).forEach((k) => want.add(k));
  const callsigns = wantList.length ? want : null;

  const hours = opts.hours || 10;
  const now = new Date();
  const lo = new Date(now.getTime() - hours * 3600_000);
  const hi = new Date(now.getTime() + hours * 3600_000);

  const token = await ensureToken(ctx, (m) => opts.onProgress?.(`· ${m}`, ""));

  // File đã có trong kho pibwx/ — dùng để bỏ qua khi không overwrite.
  const existing = new Set<string>();
  try {
    for (const f of await listFiles(ctx, "pibwx")) {
      existing.add(String(f.name || "").toLowerCase());
    }
  } catch {
    // kho chưa có thư mục — coi như trống
  }

  const merged: PibResult = { saved: [], scanned: 0, errors: [] };
  const absorb = (part: PibResult) => {
    merged.saved.push(...part.saved);
    merged.scanned += part.scanned;
    merged.errors.push(...part.errors);
  };
  const wantedLeft = () =>
    callsigns
      ? wantList.filter((c) => {
          const found = new Set<string>();
          for (const f of merged.saved) csKeys(f.callsign).forEach((k) => found.add(k));
          return !intersects(csKeys(c), found);
        })
      : [];

  // 1) Hộp chung OMC — các thư mục ga SGN/HAN/DAD.
  try {
    const stations = await findPibStationFolders(token, OMC_MAILBOX);
    for (const st of stations) {
      const left = wantedLeft();
      if (callsigns && !left.length) break;
      const part = await downloadFromFolder(ctx, token, {
        mailbox: OMC_MAILBOX,
        folderId: st.id,
        folderName: st.name,
        callsigns: callsigns ? new Set(left.flatMap((c) => [...csKeys(c)])) : null,
        wantList: callsigns ? left : [],
        lo, hi,
        overwrite: !!opts.overwrite,
        existing,
        onProgress: opts.onProgress,
      });
      absorb(part);
    }
  } catch (e) {
    if (e instanceof OwaAuthError) throw e;
    opts.onProgress?.(`· hộp ${OMC_MAILBOX}: ${e instanceof Error ? e.message : String(e)}`, "");
  }

  // 2) Thiếu thì tìm folder PIB trong mail cá nhân.
  const left2 = wantedLeft();
  if (!callsigns || left2.length) {
    if (callsigns && left2.length) {
      opts.onProgress?.("· chưa đủ trên hộp OMC — tìm PIB mail cá nhân", "");
    }
    try {
      const part = await downloadFromFolder(ctx, token, {
        mailbox: "",
        folderName: "PIB",
        callsigns: callsigns ? new Set(left2.flatMap((c) => [...csKeys(c)])) : null,
        wantList: callsigns ? left2 : [],
        lo, hi,
        overwrite: !!opts.overwrite,
        existing,
        onProgress: opts.onProgress,
      });
      absorb(part);
    } catch (e) {
      if (e instanceof OwaAuthError) throw e;
      merged.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const foundAll = new Set<string>();
  for (const f of merged.saved) csKeys(f.callsign).forEach((k) => foundAll.add(k));
  const missing = wantList.filter((c) => !intersects(csKeys(c), foundAll));
  return { ...merged, missing };
}
