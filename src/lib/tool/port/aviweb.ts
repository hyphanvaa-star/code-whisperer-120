import { env as credEnv } from "../creds.server";
// Port of atcfpl.py / atc_check.py — AviWeb (VNAIC) FPL check/submit helpers.
//
// AviWeb is a Vaadin 7.7.9 application driven by the UIDL RPC protocol. The
// original tool drives a real Chrome window with Selenium; this port speaks
// UIDL directly over HTTP instead (verified against the live site):
//   1. GET /AviWeb/login → session cookie
//   2. POST /AviWeb/app/guest-ui (v-browserDetails) → UIDL with security key,
//      component ids (pid 12 = username, 28 = password, 25 = Login button)
//   3. POST /AviWeb/app/UIDL/?v-uiId=0 with variable changes in Vaadin's
//      nested format ["pid","v","v",["text",["s",value]]] + ButtonServerRpc
//      "click" → server replies with an "open /AviWeb" change on success
//   4. POST /AviWeb/app/aviweb-ui (v-browserDetails) → main UI (v-uiId=1)
//   5. Send ["30","v","v",["location",["s","…#!manager-processed"]]] → the
//      FilterTreeTable rows arrive as ["tr",{…}, cell0, cell1, …] entries.

export const AVIWEB_URL = "https://aviweb.vnaic.vn/AviWeb/login#!aaa-login";
export const AVIWEB_FPL_URL = "https://aviweb.vnaic.vn/AviWeb/#lfplf";
export const AVIWEB_BASE = "https://aviweb.vnaic.vn/AviWeb";

export function getAviwebCredentials(): { user: string; pass: string } | null {
  const user = credEnv("AVIWEB_USERNAME");
  const pass = credEnv("AVIWEB_PASSWORD");
  if (!user || !pass) return null;
  return { user, pass };
}

type Uidl = {
  syncId?: number;
  clientId?: number;
  changes?: unknown[];
  state?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
};

export class AviWebSession {
  private jar = new Map<string, string>();
  private key = "";
  private syncId = 0;
  private clientId = 0;
  private uiId = 0;
  private uiPid = "0";

  private async req(path: string, opts: RequestInit = {}): Promise<Response> {
    const headers = new Headers(opts.headers);
    headers.set("User-Agent", "Mozilla/5.0");
    if (this.jar.size) {
      headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const r = await fetch(AVIWEB_BASE + path, { ...opts, headers, redirect: "manual" });
    const setC = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const c of setC) {
      const pair = c.split(";", 1)[0]!;
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return r;
  }

  private async browserDetails(uiPath: string, loc: string): Promise<Uidl> {
    const params = new URLSearchParams({
      "v-browserDetails": "1", "v-sh": "800", "v-sw": "1280", "v-cw": "1280", "v-ch": "700",
      "v-curdate": String(Date.now()), "v-tzo": "-420", "v-dstd": "0", "v-rtzo": "-420",
      "v-dston": "false", "v-tzid": "Asia/Bangkok", "v-vw": "1280", "v-vh": "700", "v-loc": loc,
    });
    const r = await this.req(uiPath, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const init = JSON.parse((await r.text()).replace(/^for\(;;\);\s*/, ""));
    const uidl = JSON.parse(init.uidl) as Uidl & { "Vaadin-Security-Key": string };
    this.key = uidl["Vaadin-Security-Key"];
    this.syncId = uidl.syncId ?? 0;
    this.clientId = 0;
    return uidl;
  }

  private async rpc(rpcArr: unknown[]): Promise<Uidl> {
    const body = JSON.stringify({ csrfToken: this.key, rpc: rpcArr, syncId: this.syncId, clientId: this.clientId });
    const r = await this.req(`/app/UIDL/?v-uiId=${this.uiId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body,
    });
    const d = JSON.parse((await r.text()).replace(/^for\(;;\);\s*/, ""));
    const u = (Array.isArray(d) ? d[0] : d) as Uidl;
    this.syncId = u.syncId ?? this.syncId + 1;
    this.clientId++;
    return u;
  }

  private static v(pid: string, name: string, val: unknown): unknown[] {
    return [pid, "v", "v", [name, val]];
  }

  /** Đăng nhập AviWeb. Ném Error với thông báo tiếng Việt khi thất bại. */
  async login(user: string, pass: string): Promise<void> {
    await this.req("/login");
    this.uiId = 0;
    await this.browserDetails("/app/guest-ui", `${AVIWEB_BASE}/login`);
    await this.rpc([
      AviWebSession.v("12", "text", ["s", user]), AviWebSession.v("12", "c", ["i", user.length]),
      AviWebSession.v("28", "text", ["s", pass]), AviWebSession.v("28", "c", ["i", pass.length]),
    ]);
    await this.rpc([
      ["25", "com.vaadin.shared.ui.button.ButtonServerRpc", "disableOnClick", []],
      ["25", "com.vaadin.shared.ui.button.ButtonServerRpc", "click", [
        { altKey: false, button: "LEFT", clientX: 600, clientY: 370, ctrlKey: false, metaKey: false, relativeX: 60, relativeY: 15, shiftKey: false, type: 1 },
      ]],
    ]);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const d = await this.rpc([["0", "com.vaadin.shared.ui.ui.UIServerRpc", "poll", []]]);
      const s = JSON.stringify(d.changes ?? []);
      if (s.includes('"open"') && s.includes("/AviWeb")) return; // đăng nhập xong
      if (s.includes("Authentication failed")) {
        throw new Error("AviWeb báo sai tên đăng nhập hoặc mật khẩu — kiểm tra lại trong tab Account.");
      }
    }
    throw new Error("AviWeb không phản hồi sau khi đăng nhập — thử lại sau.");
  }

  /** Mở giao diện chính sau khi đăng nhập (UI thứ hai, v-uiId=1). */
  private async initMainUi(): Promise<void> {
    this.uiId = 1;
    const uidl = await this.browserDetails("/app/aviweb-ui?v-" + Date.now(), `${AVIWEB_BASE}/`);
    // UI chính: pid của Ui là "30" (quan sát thực tế); dự phòng tìm pid có location.
    this.uiPid = "30";
    for (const [pid, st] of Object.entries(uidl.state ?? {})) {
      if (typeof st["location"] === "string" && (st["location"] as string).includes("AviWeb")) {
        this.uiPid = pid;
        break;
      }
    }
  }

  /** Đi tới một view (ví dụ "manager-processed") và trả về UIDL của view đó. */
  private async gotoView(view: string): Promise<Uidl> {
    return this.rpc([
      AviWebSession.v(this.uiPid, "location", ["s", `${AVIWEB_BASE}/#!${view}`]),
    ]);
  }

  /**
   * Lấy toàn bộ hàng của một view FPL Manager. Cột: [callsign, ats_msg, dep,
   * dest, date_of_flight, update_time]; `status` đọc từ Label HTML (cột Status
   * là component riêng), `key` dùng để bấm action View.
   */
  async fetchRows(view: string): Promise<AviRow[]> {
    const d = await this.gotoView(view);
    const state = d.state ?? {};
    const rows: AviRow[] = [];
    for (const ch of d.changes ?? []) {
      const pid = Array.isArray(ch) ? String((ch[1] as { pid?: string })?.pid ?? "") : "";
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) {
          if (x[0] === "tr" && typeof x[1] === "object" && x.length > 4) {
            const meta = x[1] as { key?: number };
            const cells = x.slice(2);
            const statusRef = cells.find((c) => Array.isArray(c)) as [string, { id?: string }] | undefined;
            const sid = statusRef?.[1]?.id;
            const html = sid ? String((state[sid] as { text?: string } | undefined)?.text ?? "") : "";
            rows.push({
              cells: cells.map((c) => (typeof c === "string" ? c : "")),
              status: html.replace(/<[^>]*>/g, "").trim(),
              key: String(meta.key ?? ""),
              tablePid: pid,
            });
            return;
          }
          for (const y of x) walk(y);
        }
      };
      walk(ch);
    }
    return rows;
  }

  /** Bấm action "View" (key "1") trên một hàng → trả nội dung điện văn FPL. */
  async viewFpl(row: AviRow): Promise<string> {
    const d = await this.rpc([[row.tablePid, "v", "v", ["action", ["s", `${row.key},1`]]]]);
    const state = d.state ?? {};
    let text = "";
    let win = "";
    for (const [pid, st] of Object.entries(state)) {
      const t = (st as { text?: string }).text;
      if (typeof t === "string" && t.includes("<pre")) text = t;
      if ((st as { modal?: boolean }).modal) win = pid;
    }
    if (win) {
      try { await this.rpc([[win, "v", "v", ["close", ["b", true]]]]); } catch { /* bỏ qua */ }
    }
    return text
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .trim();
  }

  /** Phiên đầy đủ: đăng nhập → mở UI chính. */
  async connect(user: string, pass: string): Promise<void> {
    await this.login(user, pass);
    await this.initMainUi();
  }
}

export interface AviRow {
  cells: string[];
  status: string;
  key: string;
  tablePid: string;
}

/** Đọc REG / DOF / EOBT (HHMM) từ điện văn FPL. */
export function parseFplDetail(text: string): { reg?: string; dof?: string; eobt?: string } {
  const out: { reg?: string; dof?: string; eobt?: string } = {};
  const reg = /\bREG\/([A-Z0-9-]+)/.exec(text);
  if (reg) out.reg = reg[1]!.replace(/-/g, "");
  const dof = /\bDOF\/(\d{6})/.exec(text);
  if (dof) out.dof = dof[1]!;
  for (const l of text.split(/\r?\n/).map((x) => x.trim())) {
    const m = /^-([A-Z]{4})(\d{4})$/.exec(l); // field 13: "-VVTS0445"
    if (m) { out.eobt = m[2]!; break; }
  }
  return out;
}

/**
 * Check trạng thái FPL của các số hiệu trên AviWeb — chạy trên máy chủ web
 * (UIDL), như atc_check.py: đọc danh sách, rồi bấm View từng chuyến để lấy
 * REG / DOF / EOBT; Status lấy từ cột Status ngoài danh sách.
 */
export async function checkFlightsOnline(
  callsigns: string[],
  onProgress?: (text: string) => void,
): Promise<AtcCheckResult[]> {
  const cred = getAviwebCredentials();
  if (!cred) throw new Error("Chưa có tài khoản AviWeb — mở tab Account để lưu.");
  const want = new Map(callsigns.map((c) => [c.trim().toUpperCase(), c]));
  const s = new AviWebSession();
  onProgress?.(`· đăng nhập AviWeb (${cred.user})…`);
  await s.connect(cred.user, cred.pass);
  onProgress?.("· đăng nhập xong — đang đọc danh sách FPL…");
  const isCancel = (st: string) => /cancel/i.test(st);
  const out = new Map<string, AtcCheckResult>();
  for (const view of ["manager-processed", "manager-unprocessed", "manager-rejected"]) {
    let rows: AviRow[] = [];
    try {
      rows = await s.fetchRows(view);
    } catch {
      continue;
    }
    const picked = new Map<string, AviRow>();
    for (const row of rows) {
      const cs = (row.cells[0] ?? "").trim().toUpperCase();
      if (!want.has(cs) || out.has(cs)) continue;
      const cur = picked.get(cs);
      // Danh sách mới nhất ở trên: lấy hàng đầu, nhưng ưu tiên hàng không Cancelled.
      if (!cur || (isCancel(cur.status) && !isCancel(row.status))) picked.set(cs, row);
    }
    onProgress?.(`· ${view.replace("manager-", "")}: ${rows.length} dòng, thấy ${picked.size} chuyến — đang bấm View từng chuyến…`);
    let i = 0;
    for (const [cs, row] of picked) {
      i++;
      const r: AtcCheckResult = {
        callsign: want.get(cs)!,
        status: row.status || view.replace("manager-", ""),
        ok: true,
      };
      try {
        const text = await s.viewFpl(row);
        if (text && fplIsFor(text, cs)) {
          const det = parseFplDetail(text);
          if (det.reg) r.reg = det.reg;
          if (det.dof) r.dof = det.dof;
          if (det.eobt) r.flight_time = det.eobt;
        }
        const why = missingDetailReason(r, text);
        if (why) { r.ok = false; r.error = why; }
      } catch (e) {
        r.ok = false;
        r.error = "bấm View lỗi: " + (e instanceof Error ? e.message : String(e));
      }
      onProgress?.(`· View ${i}/${picked.size} ${cs}: ${r.status} · REG ${r.reg ?? "?"} · EOBT ${r.flight_time ?? "?"}`);
      out.set(cs, r);
    }
    if (out.size >= want.size) break;
  }
  return callsigns.map((c) => {
    const r = out.get(c.trim().toUpperCase());
    return r ?? { callsign: c, error: "không thấy trên AviWeb", ok: false };
  });
}

// ---- atc_check.py ---------------------------------------------------------

export interface AtcCheckResult {
  callsign: string;
  status?: string;
  flight_time?: string;
  reg?: string;
  dof?: string;
  error?: string;
  ok?: boolean;
}

const RE_FPL_CS = /\((?:FPL|CHG|CNL|DLA)-([A-Z0-9]+)-/i;

/** Số hiệu trong điện văn FPL, ví dụ `(FPL-VJC150-IS` → `VJC150`. */
export function fplCallsign(text: string): string {
  const m = RE_FPL_CS.exec(text || "");
  return m ? m[1]!.toUpperCase() : "";
}

/** True khi nội dung View đúng là FPL của chuyến đang check — không phải chuyến trước. */
export function fplIsFor(text: string, callsign: string): boolean {
  const want = (callsign || "").trim().toUpperCase();
  if (!want || !(text || "").trim()) return false;
  const got = fplCallsign(text);
  if (got) return got === want;
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`);
  return re.test((text || "").slice(0, 600).toUpperCase());
}

/**
 * Vì sao chuyến này CHƯA check được. Rỗng = đã đọc đủ để kết luận.
 *
 * Thước đo là có đọc được chi tiết FPL hay không, chứ không phải có thấy chuyến
 * trong danh sách hay có mở được cửa sổ View. Chỉ biết `status` thì cả REG CHECK
 * (cần REG) lẫn STD CHECK (cần EOBT) đều không kết luận được gì, nên tính nó là
 * "check được" là tự nói dối.
 */
export function missingDetailReason(result: AtcCheckResult, modalText = ""): string {
  if (result.reg || result.dof || result.flight_time) return "";
  if (modalText) return "mở được FPL nhưng trong đó không có REG/DOF/EOBT";
  return "bấm View nhưng không đọc được nội dung FPL";
}

// ---- atcfpl.py --------------------------------------------------------

const RE_FPL_NAME = /\(FPL-([A-Z0-9]+)-/;
// Mọi điện văn ATC đều mở đầu "(FPL-", "(CHG-", "(CNL-"… — dùng để loại text rác.
const RE_BLOCK = /^\(\s*[A-Z]{3}-/;
// Dòng sân bay trong FPL: "-WSSS0315" (đi) và "-VVDN0225 VVCR VVPB" (đến + dự bị)
const RE_AERO = /^-([A-Z]{4})(\d{4})(?=\s|$)/gm;

/**
 * Tách file ATC thành các block, phân cách bằng dòng trống.
 *
 * Chỉ trả về block đúng dạng điện văn ATC — mở đầu bằng `(XXX-` với XXX là
 * loại điện văn (FPL, CHG, CNL, DLA…). Text thường bị bỏ.
 */
export function readFplBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  // Python reads with utf-8-sig: strip a leading BOM.
  const body = text.replace(/^\uFEFF/, "");
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) {
      if (cur.length) {
        blocks.push(cur.join("\n").trim());
        cur = [];
      }
    } else {
      cur.push(line.replace(/\s+$/, ""));
    }
  }
  if (cur.length) blocks.push(cur.join("\n").trim());
  return blocks.filter((b) => RE_BLOCK.test(b));
}

export function fplName(block: string): string {
  const m = RE_FPL_NAME.exec(block);
  return m ? m[1]! : "?";
}

/**
 * Chặng + giờ khởi hành đọc từ block, ví dụ `WSSS→VVDN 0315`.
 *
 * Cùng một số hiệu có thể có 2 chặng trong một file, nên cần chặng để phân biệt
 * chuyến nào thành công chuyến nào lỗi.
 */
export function fplRoute(block: string): string {
  const pts = [...block.matchAll(RE_AERO)].map((m) => [m[1]!, m[2]!] as const);
  if (!pts.length) return "";
  const [dep, std] = pts[0]!;
  const arr = pts.length > 1 ? pts[pts.length - 1]![0] : "?";
  return `${dep}→${arr} ${std}`;
}

/** Tên view Vaadin sau `#` / `#!` (`lfplf`, `fplf`, …). */
export function vaadinView(url: string): string {
  const u = (url || "").toLowerCase();
  if (!u.includes("#")) return "";
  let h = u.split("#", 2)[1] || "";
  if (h.startsWith("!")) h = h.slice(1);
  return h.split("&", 1)[0]!.split("?", 1)[0]!.split("/", 1)[0]!;
}

/**
 * Trang FPL Filing HTTPS: list `lfplf` hoặc dialog Add FPL `fplf`.
 *
 * AviWeb đổi hash thành `#!fplf` khi mở Text Mode — vẫn là đúng trang.
 */
export function pageLooksLikeFpl(url: string): boolean {
  const u = (url || "").toLowerCase();
  if (u.includes("aaa-login")) return false;
  if (u.startsWith("http://")) return false;
  return vaadinView(u) === "lfplf" || vaadinView(u) === "fplf";
}

/**
 * Link nhảy trang AviWeb (logo, Dashboard, http://…) — không phải nút Submit.
 *
 * Hash nội bộ `#lfplf` là menu FPL Filing, được bấm cố ý. Mọi `http(s)://`
 * không chứa `lfplf` thì là bẫy: native click trượt vào đó là đứng phiên.
 */
export function hrefIsPageLink(href: string): boolean {
  const h = (href || "").trim();
  if (!h || h.startsWith("javascript:")) return false;
  const low = h.toLowerCase();
  if (low.startsWith("http://")) return true;
  if (pageLooksLikeFpl(low) || low.startsWith("#")) return false;
  return low.startsWith("https://");
}

export const AVIWEB_NOT_PORTABLE_MESSAGE =
  "AviWeb (VNAIC) là ứng dụng Vaadin 7 dùng giao thức UIDL nội bộ — không có API " +
  "HTTP đơn giản để đăng nhập/đọc FPL. Bản gốc phải lái Chrome thật (Selenium); " +
  "runtime web (Cloudflare Worker) không chạy được Chrome/Selenium. Cần PC helper " +
  "có Chrome để thực hiện bước này.";
