// Port of metwx.py — đầy đủ: đăng nhập, liệt kê bảng Flight Documentation và
// tải flight folder PDF từ các đài khí tượng (TSN 113.161.121.25, Nội Bài
// 14.177.232.218:7102, Đà Nẵng danmet.vatm.vn, TSN mirror 118.69.213.84).
// Các trang này mở được từ internet nên server web tự tải trực tiếp, không cần
// trợ lý PC. Session dùng fetch + cookie jar thủ công (PHPSESSID).

export type MetSiteFlavor = "wafs" | "folder" | "href";

export type MetSite = {
  key: string;
  name: string;
  base: string;
  cat: number;
  sub: number;
  flavor: MetSiteFlavor;
};

export const SITES: Record<string, MetSite> = {
  tsn: { key: "tsn", name: "TanSonNhat MET Office", base: "http://113.161.121.25", cat: 9, sub: 7, flavor: "wafs" },
  noibai: { key: "noibai", name: "NoiBai MET Office", base: "http://14.177.232.218:7102", cat: 5, sub: 0, flavor: "folder" },
  danang: { key: "danang", name: "DaNang MET (danmet.vatm.vn)", base: "https://danmet.vatm.vn", cat: 9, sub: 8, flavor: "href" },
  tsn2: { key: "tsn2", name: "TSN mirror", base: "http://118.69.213.84", cat: 9, sub: 7, flavor: "wafs" },
};

export const DEFAULT_ORDER = ["tsn", "danang", "noibai", "tsn2"] as const;
export const MAX_AGE_H = 8.0;

const RE_SUFFIX = /-\d{4}-\d{6}$/;
const RE_FOLDER_TIME = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2})h(\d{2})/;
const CREATED_FORMATS = [
  /^(\d{2}):(\d{2}) (\d{1,2}) (\w+) (\d{4})$/, // "HH:MM D Month YYYY"
];
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "VJC154-VVTS-VVNB-1350-260726" -> true (bản phát hành lại). */
export function revised(name: string): boolean {
  return RE_SUFFIX.test(name || "");
}

/** Đổi Create Time (UTC hiển thị trên trang) thành Date. */
export function parseCreated(text: string): Date | null {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const mf = RE_FOLDER_TIME.exec(t);
  if (mf) {
    const [, ymd, hh, mm] = mf;
    const d = new Date(`${ymd}T${String(hh).padStart(2, "0")}:${mm}:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  for (const re of CREATED_FORMATS) {
    const m = re.exec(t);
    if (m) {
      const [, hh, mm, dd, mon, yyyy] = m;
      const month = MONTHS[(mon || "").toLowerCase()];
      if (month === undefined) continue;
      const d = new Date(Date.UTC(Number(yyyy), month, Number(dd), Number(hh), Number(mm)));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

export function ageHours(createdText: string, now: Date = new Date()): number | null {
  const d = parseCreated(createdText);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Phần session/tải — port của MetSession + download() trong metwx.py.
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SITE_CREDENTIALS: Record<string, { username: string; password: string; airline: string }> = {
  tsn: { username: "vietjet", password: "Vietjet@air", airline: "VJC - VJ Vietjet Air" },
  tsn2: { username: "vietjet", password: "Vietjet@air", airline: "VJC - VJ Vietjet Air" },
  noibai: { username: "dbv-01", password: "Amc@1234", airline: "VJC - VJ Vietjet Air" },
  danang: { username: "vietjet", password: "Omc@123456", airline: "VJC - VietJet Air" },
};

export type WxDoc = {
  site: string;
  name: string; // VJC154-VVTS-VVNB-1350-260726
  callsign: string; // VJC154
  created: string; // "13:50 26 July 2026"
  color: string; // chỉ tham khảo, KHÔNG lọc theo màu
  path: string; // kiểu folder/href: đường dẫn lấy từ onclick / thẻ <a>
};

/** Tên file lưu xuống đĩa (port WxDoc.filename). */
export function docFilename(doc: WxDoc): string {
  if (doc.path.includes("?")) {
    const m = /[?&]n=([^&]+)/.exec(doc.path);
    if (m) return decodeURIComponent(m[1]);
  }
  if (doc.path) return doc.path.split("/").pop() || `${doc.name}.pdf`;
  return `${doc.name}.pdf`;
}

/** URL tải file (port WxDoc.url). */
export function docUrl(doc: WxDoc, base: string, d: Date): string {
  if (doc.path.includes("?")) return `${base}/${doc.path}`;
  if (doc.path) return `${base}/${doc.path.split("/").map(encodeURIComponent).join("/")}`;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${base}/data/${y}/${m}/${dd}/flightfolder_wafs/${doc.name}.pdf`;
}

const AIRLINE_PREFIX = "VJC";

/** Port cs_match(): số trần ("868") chỉ khớp VJC868, nhập có chữ phải khớp đúng. */
export function csMatch(wanted: unknown, callsign: unknown, prefix = AIRLINE_PREFIX): boolean {
  const w = String(wanted ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const c = String(callsign ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!w || !c) return false;
  if (/[A-Z]/.test(w)) return w === c;
  return c === `${prefix}${w}`;
}

const RE_ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const RE_NAME = /<font\s+color="([^"]+)"\s*>\s*([A-Z]{2,3}\d+[^<]*?)\s*<\/font>/i;
const RE_TIME = />\s*(\d{1,2}:\d{2}\s+\d{1,2}\s+\w+\s+\d{4})\s*</;
const RE_CS = /^([A-Z]{2,3}\d+)/;
const RE_VIEWDOC = /viewdocument\(\s*'([^']+)'\s*\)[^>]*>\s*([^<]+?)\s*<\/td>/gi;
const RE_HREF_DOC = /<a\s+href="([^"]*flightDocArchives[^"]*)"[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]*?<td[^>]*>\s*([^<]*?)\s*<\/td>/gi;

export class MetError extends Error {}

/** Cookie jar tối giản cho PHPSESSID. */
class CookieJar {
  private jar = new Map<string, string>();
  store(res: Response): void {
    const raw =
      typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
    for (const sc of raw) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/** Đài chỉ có địa chỉ IP (không tên miền): máy chủ web bị chặn kết nối thẳng
 * (HTTP 403), nên phải đi qua trợ lý PC trên máy công ty. */
export function needsPcAgent(site: MetSite): boolean {
  try {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(new URL(site.base).hostname);
  } catch {
    return false;
  }
}

/** Gửi 1 request qua trợ lý PC; trợ lý tự giữ cookie theo `session`. */
export type MetTransport = (req: {
  session: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) => Promise<Response>;

export class MetSession {
  private jar = new CookieJar();
  private loggedIn = false;
  constructor(public site: MetSite, private transport?: MetTransport) {}

  private async req(url: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", UA);
    if (this.transport && needsPcAgent(this.site)) {
      const h: Record<string, string> = {};
      headers.forEach((v, k) => { h[k] = v; });
      return this.transport({
        session: `met:${this.site.key}`,
        method: String(init.method || "GET"),
        url,
        headers: h,
        body: typeof init.body === "string" ? init.body : undefined,
        timeoutMs,
      });
    }
    const cookie = this.jar.header();
    if (cookie) headers.set("Cookie", cookie);
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    this.jar.store(res);
    return res;
  }

  async login(): Promise<void> {
    if (this.loggedIn) return;
    const st = this.site;
    const cred = SITE_CREDENTIALS[st.key] ?? SITE_CREDENTIALS.tsn;
    // Lấy PHPSESSID trước, sau đó mới post form
    await this.req(`${st.base}/index.php?cat=${st.cat}&sub=${st.sub}`, {}, 15_000);
    const body = new URLSearchParams({
      act: "login",
      req: `${st.cat},${st.sub}`,
      txtUsername: cred.username,
      txtPassword: cred.password,
      cmdLogin: "Login",
    });
    const r = await this.req(`${st.base}/index.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!r.ok) throw new MetError(`${st.name}: HTTP ${r.status}`);
    const text = await r.text();
    if (text.includes("txtPassword")) throw new MetError(`${st.name}: đăng nhập thất bại (sai user/pass?)`);
    this.loggedIn = true;
  }

  async listDocs(d: Date): Promise<WxDoc[]> {
    if (this.site.flavor === "folder") return this.listFolder(d);
    if (this.site.flavor === "href") return this.listHref(d);
    return this.listWafs(d);
  }

  private listParams(d: Date): URLSearchParams {
    const st = this.site;
    const cred = SITE_CREDENTIALS[st.key] ?? SITE_CREDENTIALS.tsn;
    return new URLSearchParams({
      cat: String(st.cat),
      sub: String(st.sub),
      type: "0",
      cboAirlines: cred.airline,
      cboUser: "All Users",
      cboday: String(d.getUTCDate()),
      cbomonth: String(d.getUTCMonth() + 1),
      cboyear: String(d.getUTCFullYear()),
    });
  }

  private async listHref(d: Date): Promise<WxDoc[]> {
    await this.login();
    const st = this.site;
    const r = await this.req(`${st.base}/index.php?${this.listParams(d)}`);
    if (!r.ok) throw new MetError(`${st.name}: HTTP ${r.status}`);
    const html = await r.text();
    const docs: WxDoc[] = [];
    RE_HREF_DOC.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_HREF_DOC.exec(html))) {
      const [, href, name, created] = m;
      const cs = RE_CS.exec(name.trim());
      if (!cs) continue;
      docs.push({ site: st.key, name: name.trim(), callsign: cs[1].toUpperCase(), created: created.trim(), color: "", path: href.replace(/^\.\//, "") });
    }
    return docs;
  }

  private async listFolder(d: Date): Promise<WxDoc[]> {
    await this.login();
    const st = this.site;
    const day = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
    const params = new URLSearchParams({ cat: String(st.cat), sub: String(st.sub), type: "0", arl: "VJC", filter: "range", fltFrom: day, fltTo: day });
    const r = await this.req(`${st.base}/index.php?${params}`);
    if (!r.ok) throw new MetError(`${st.name}: HTTP ${r.status}`);
    const html = await r.text();
    const docs: WxDoc[] = [];
    RE_VIEWDOC.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_VIEWDOC.exec(html))) {
      const [, path, label] = m;
      const cs = RE_CS.exec(label.trim());
      if (!cs) continue;
      const stem = path.split("/").pop()?.replace(/\.pdf$/i, "") ?? label.trim();
      docs.push({ site: st.key, name: stem, callsign: cs[1].toUpperCase(), created: label.trim(), color: "", path });
    }
    // Trang kèm cả dòng ngày liền sau — ưu tiên dòng đúng ngày.
    const tag = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const same = docs.filter((x) => x.name.includes(tag));
    return same.length ? same : docs;
  }

  private async listWafs(d: Date): Promise<WxDoc[]> {
    await this.login();
    const st = this.site;
    const r = await this.req(`${st.base}/index.php?${this.listParams(d)}`);
    if (!r.ok) throw new MetError(`${st.name}: HTTP ${r.status}`);
    const html = await r.text();
    const docs: WxDoc[] = [];
    RE_ROW.lastIndex = 0;
    let row: RegExpExecArray | null;
    while ((row = RE_ROW.exec(html))) {
      const tr = row[1];
      const m = RE_NAME.exec(tr);
      if (!m) continue;
      const name = m[2].trim();
      const cs = RE_CS.exec(name);
      if (!cs) continue;
      const tm = RE_TIME.exec(tr);
      docs.push({ site: st.key, name, callsign: cs[1].toUpperCase(), created: tm ? tm[1] : "", color: m[1].trim(), path: "" });
    }
    return docs;
  }

  /** Tải một doc; trả bytes hoặc ném lỗi. */
  async downloadDoc(doc: WxDoc, d: Date): Promise<Uint8Array> {
    const url = docUrl(doc, this.site.base, d);
    const r = await this.req(url, {}, 180_000);
    if (r.status !== 200) throw new MetError(`HTTP ${r.status}`);
    const blob = new Uint8Array(await r.arrayBuffer());
    if (!(blob[0] === 0x25 && blob[1] === 0x50 && blob[2] === 0x44 && blob[3] === 0x46)) {
      throw new MetError("không phải PDF (file chưa phát hành?)");
    }
    return blob;
  }
}

export type WxResult = {
  saved: Array<{ callsign: string; filename: string; bytes: Uint8Array }>;
  skipped: Array<{ callsign: string; filename: string }>;
  missing: string[];
  errors: string[];
};

export type WxProgress = (text: string, cs?: string) => void;

/**
 * Port metwx.download(): dò từng đài theo `sites`, lùi `daysBack` ngày, chỉ nhận
 * file upload trong `maxAgeH` giờ qua. `hasFile(filename)` báo file đã có sẵn
 * (bỏ qua trừ khi overwrite).
 */
export async function download(
  callsigns: Iterable<string>,
  opts: {
    d?: Date;
    daysBack?: number;
    sites?: readonly string[];
    overwrite?: boolean;
    maxAgeH?: number;
    onProgress?: WxProgress;
    hasFile?: (filename: string) => Promise<boolean>;
    transport?: MetTransport;
  } = {},
): Promise<WxResult> {
  const now = new Date();
  const baseDay = opts.d ?? now;
  const nDays = Math.max(1, (opts.daysBack ?? 1) + 1);
  const days: Date[] = [];
  for (let i = 0; i < nDays; i++) days.push(new Date(Date.UTC(baseDay.getUTCFullYear(), baseDay.getUTCMonth(), baseDay.getUTCDate() - i)));
  const sites = opts.sites?.length ? opts.sites : DEFAULT_ORDER;
  const maxAgeH = opts.maxAgeH ?? MAX_AGE_H;
  const want = [...callsigns].map((c) => String(c).trim().toUpperCase()).filter(Boolean);

  const res: WxResult = { saved: [], skipped: [], missing: [], errors: [] };
  const left = new Map(want.map((c) => [c, c]));

  for (const key of sites) {
    if (!left.size) break;
    const site = SITES[key];
    if (!site) {
      res.errors.push(`không biết đài ${key}`);
      continue;
    }
    try {
      const ms = new MetSession(site, opts.transport);
      for (const day of days) {
        if (!left.size) break;
        const docs = await ms.listDocs(day);
        await take(ms, docs, day, left, res, opts, maxAgeH, now);
      }
    } catch (exc) {
      res.errors.push(`${site.name}: ${(exc as Error)?.message ?? exc}`);
    }
  }

  res.missing = [...left.values()];
  return res;
}

async function take(
  ms: MetSession,
  docs: WxDoc[],
  day: Date,
  left: Map<string, string>,
  res: WxResult,
  opts: { overwrite?: boolean; onProgress?: WxProgress; hasFile?: (f: string) => Promise<boolean> },
  maxAgeH: number,
  now: Date,
): Promise<void> {
  for (const orig of [...left.keys()]) {
    let cands = docs.filter((x) => csMatch(orig, x.callsign));
    if (!cands.length) continue;

    // Bỏ file upload quá lâu — cùng số hiệu bay lặp mỗi ngày, lấy nhầm hôm trước.
    if (maxAgeH) {
      cands = cands.filter((x) => {
        const age = ageHours(x.created, now);
        return age === null || age <= maxAgeH;
      });
      if (!cands.length) continue;
    }

    // Bản phát hành lại (hậu tố -HHMM-DDMMYY) thử trước.
    cands.sort((a, b) => Number(revised(b.name)) - Number(revised(a.name)));

    let done = false;
    for (const doc of cands) {
      const filename = docFilename(doc);
      if (!opts.overwrite && opts.hasFile && (await opts.hasFile(filename))) {
        res.skipped.push({ callsign: orig, filename });
        opts.onProgress?.(`${orig}: đã có sẵn ${filename}`, orig);
        done = true;
        break;
      }
      try {
        const bytes = await ms.downloadDoc(doc, day);
        res.saved.push({ callsign: orig, filename, bytes });
        opts.onProgress?.(`${orig}: đã tải ${filename} (${Math.round(bytes.length / 1024)} KB)`, orig);
        done = true;
        break;
      } catch (exc) {
        opts.onProgress?.(`${orig}: ${filename} — ${(exc as Error)?.message ?? exc}`);
      }
    }
    if (done) left.delete(orig);
  }
}
