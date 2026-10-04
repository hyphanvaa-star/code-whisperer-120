// Port of atcfpl.py / atc_check.py — AviWeb (VNAIC) FPL check/submit helpers.
//
// AviWeb is a Vaadin 7.7.9 application: logins and the FPL Manager screen are
// driven by the client-side Vaadin "UIDL" RPC protocol (dynamically generated
// component ids + CSRF security keys issued per browser session), not a plain
// HTML form or REST API. There is no documented public endpoint to log in or
// read FPL status with a simple fetch() — the original tool drives a real
// Chrome window with Selenium for exactly this reason. Reconnaissance against
// the live site (see /tmp/aviweb_login.html, /tmp/guest-ui.json probes) confirms
// this: the bootstrap HTML only carries a `vaadin.initApplication(...)` call,
// and the UIDL endpoint demands a live client-side component tree before it
// will accept any POST, which a bare HTTP client cannot assemble reliably.
//
// What *can* be ported with 100% fidelity are the pure string/parsing helpers
// that do not need a browser at all. Those are below.

export const AVIWEB_URL = "https://aviweb.vnaic.vn/AviWeb/login#!aaa-login";
export const AVIWEB_FPL_URL = "https://aviweb.vnaic.vn/AviWeb/#lfplf";

export function getAviwebCredentials(): { user: string; pass: string } | null {
  const user = process.env["AVIWEB_USERNAME"];
  const pass = process.env["AVIWEB_PASSWORD"];
  if (!user || !pass) return null;
  return { user, pass };
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
