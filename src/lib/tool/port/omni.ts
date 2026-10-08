// Port of omni.py — Lấy tải trọng ước tính (EST) từ InFlight Omni (Vietjet
// back-office) để đối chiếu với PLD của OFP. Pure fetch-based so it can run in
// a Cloudflare Worker and be unit tested; no filesystem/token cache (that part
// of web.py — a local JSON file — is replaced by the caller via store.server.ts).
//
// Naive local datetimes (std_local, cot_utc, est_time_utc) are represented as
// `Date` objects built with `Date.UTC(...)` so the wall-clock numbers are kept
// in the UTC getters, same convention as the other ports (taf.ts, notam_check.ts).
import type { Flight } from "../core/models";

export const API = "https://ifs-api.vietjetair.com/bo-api";
export const WEB = "https://ifs-backoffice.vietjetair.com";
export const TOKENS = "/api/v1/auth/tokens";
export const FLIGHTS = "/api/v1/cargo/flights";
export const FLIGHTS_EXPORT = "/api/v1/cargo/flights/export";
export const PREPAYLOAD = "/api/v1/cargo/reports/pre-payload";

export const WINDOW_H = 12.0;
// Qua 17:00Z là sóng đêm / qua ngày.
const OVERWRITE_AFTER_Z: readonly [number, number] = [17, 0];

// Omni STD là giờ địa phương sân bay ĐI. Không phải lúc nào cũng +7 (MNL = +8).
const IATA_UTC_H: Record<string, number> = {
  MNL: 8, CEB: 8, CRK: 8, DVO: 8, KLO: 8,
  HKG: 8, MFM: 8, TPE: 8,
  CAN: 8, PVG: 8, PEK: 8, PKX: 8, SZX: 8, CKG: 8,
  SIN: 8, KUL: 8, BKI: 8, PEN: 8,
  ICN: 9, PUS: 9, CJU: 9,
  NRT: 9, HND: 9, KIX: 9, FUK: 9, NGO: 9,
  SYD: 10, MEL: 10, BNE: 10, PER: 8,
  DEL: 5.5, BOM: 5.5,
  DXB: 4, AUH: 4,
  RGN: 6.5,
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export class OmniError extends Error {}

export interface OmniFlight {
  flt: string; // "VJ868"
  digits: string; // "868"
  dep: string;
  arr: string;
  std_local: Date | null; // giờ ĐỊA PHƯƠNG sân bay đi
  reg: string;
  ac_type: string;
  flight_type: string;
  est_payload: number | null;
  pax_weight: number | null;
  bag_weight: number | null;
  cargo_confirm: number | null;
  cargo_capacity: number | null;
  tare: number | null;
  cot_utc: Date | null;
  est_time_utc: Date | null;
}

export function omniLabel(x: OmniFlight): string {
  const t = x.std_local
    ? ` ${String(x.std_local.getUTCDate()).padStart(2, "0")}/${String(x.std_local.getUTCMonth() + 1).padStart(2, "0")} ` +
      `${String(x.std_local.getUTCHours()).padStart(2, "0")}:${String(x.std_local.getUTCMinutes()).padStart(2, "0")}`
    : "";
  return `${x.flt} ${x.dep}-${x.arr}${t}`;
}

function newOmniFlight(init: Partial<OmniFlight> & Pick<OmniFlight, "flt" | "digits">): OmniFlight {
  return {
    dep: "", arr: "", std_local: null, reg: "", ac_type: "", flight_type: "",
    est_payload: null, pax_weight: null, bag_weight: null, cargo_confirm: null,
    cargo_capacity: null, tare: null, cot_utc: null, est_time_utc: null,
    ...init,
  };
}

// --------------------------------------------------------------------------- //
// Đăng nhập
// --------------------------------------------------------------------------- //

export interface OmniSession {
  token: string;
}

export interface OmniCredentials {
  username: string;
  password: string;
}

function headers(session?: OmniSession): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
    "Content-Type": "application/json",
    language: "vi",
    Origin: WEB,
    Referer: `${WEB}/support/cargo/dashboard`,
  };
  if (session?.token) h["Authorization"] = `Bearer ${session.token}`;
  return h;
}

/** Đăng nhập Omni. Trả session mang Bearer token + tên người dùng. */
export async function login(creds: OmniCredentials): Promise<{ session: OmniSession; name: string }> {
  let r: Response;
  try {
    r = await fetch(API + TOKENS, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
  } catch (exc) {
    throw new OmniError(`không kết nối được Omni: ${(exc as Error).message}`);
  }
  if (r.status !== 200) {
    // Đừng in body thô: chỉ lấy trường message ngắn để chẩn đoán
    let msg = "";
    try {
      const t = await r.text();
      const j = JSON.parse(t) as Record<string, unknown>;
      msg = String(j["message"] ?? j["error"] ?? j["title"] ?? "").slice(0, 120);
      if (!msg) msg = t.replace(/\s+/g, " ").slice(0, 80);
    } catch { /* ignore */ }
    console.error("[omni] login failed", r.status, msg);
    throw new OmniError(`đăng nhập Omni thất bại (HTTP ${r.status}${msg ? ": " + msg : ""})`);
  }
  let j: Record<string, unknown>;
  try {
    j = (await r.json()) as Record<string, unknown>;
  } catch {
    throw new OmniError("đăng nhập Omni: phản hồi không phải JSON");
  }
  const tok = j["accessToken"];
  if (!tok || typeof tok !== "string") throw new OmniError("đăng nhập Omni: không thấy accessToken");
  const name = String(j["fullName"] || "");
  return { session: { token: tok }, name };
}

// --------------------------------------------------------------------------- //
// Đọc báo cáo JSON (Dashboard OMC)
// --------------------------------------------------------------------------- //

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d.-]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Ghép ô ngày + ô giờ thành datetime "naive" (Date.UTC giữ số giờ địa phương). */
function combineDt(d: unknown, t: unknown): Date | null {
  if (d === null || d === undefined || d === "") return null;
  let day: { y: number; m: number; d: number } | null = null;
  if (d instanceof Date) {
    day = { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  } else {
    const s = String(d).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) day = { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! };
    if (!day) {
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) day = { y: +m[3]!, m: +m[2]! - 1, d: +m[1]! };
    }
    if (!day) {
      m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
      if (m && MONTHS[m[2]!.toLowerCase()] !== undefined) day = { y: +m[3]!, m: MONTHS[m[2]!.toLowerCase()]!, d: +m[1]! };
    }
    if (!day) {
      m = s.match(/^(\d{4})\/([A-Za-z]{3})\/(\d{1,2})$/);
      if (m && MONTHS[m[2]!.toLowerCase()] !== undefined) day = { y: +m[1]!, m: MONTHS[m[2]!.toLowerCase()]!, d: +m[3]! };
    }
  }
  if (!day) return null;

  if (t instanceof Date) {
    return new Date(Date.UTC(day.y, day.m, day.d, t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()));
  }
  const ts = String(t ?? "").trim();
  const m = ts.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return new Date(Date.UTC(day.y, day.m, day.d, 0, 0, 0));
  return new Date(Date.UTC(day.y, day.m, day.d, +m[1]!, +m[2]!));
}

/** Ghép carrier + flightNo → "VJ387". */
function flightNoOf(row: Record<string, unknown>): string {
  const desc = String(row["flightDesc"] ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (desc && /[A-Z]/.test(desc) && /\d/.test(desc)) return desc;
  const carrier = (String(row["carrier"] ?? "VJ").trim().toUpperCase() || "VJ");
  const n = row["flightNo"];
  if (n === null || n === undefined || n === "") return "";
  return `${carrier}${n}`;
}

/** Đọc list JSON từ POST /api/v1/cargo/flights (Dashboard OMC). */
export function parseFlightsJson(rows: unknown[]): OmniFlight[] {
  const out: OmniFlight[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const flt = flightNoOf(r);
    const digits = flt.replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) continue;
    const day = r["flightDateLocal"] ?? r["flightDate"];
    const std = r["stdLocal"] ?? r["std"];
    const confirmedWeight = r["confirmedWeight"];
    const cargoConfirm =
      confirmedWeight !== null && confirmedWeight !== undefined && confirmedWeight !== 0 && confirmedWeight !== 0.0
        ? num(confirmedWeight)
        : num(r["payloadCargoWeight"]);
    out.push(
      newOmniFlight({
        flt,
        digits,
        dep: String(r["dep"] ?? "").trim().toUpperCase(),
        arr: String(r["arr"] ?? "").trim().toUpperCase(),
        std_local: combineDt(day, std),
        reg: String(r["flightReg"] ?? "").trim(),
        ac_type: String(r["acType"] ?? "").trim(),
        flight_type: String(r["flightType"] ?? "").trim(),
        est_payload: num(r["estimatePayload"]),
        pax_weight: num(r["estimatePaxWeight"]),
        bag_weight: num(r["estimateBaggageWeight"]),
        cargo_confirm: cargoConfirm,
        cargo_capacity: num(r["capacityWeight"]) ?? num(r["availableWeight"]),
        tare: num(r["tareWeight"]),
      }),
    );
  }
  return out;
}

function omniDedupeKey(x: OmniFlight): string {
  const std = x.std_local ? isoMinute(x.std_local) : "";
  return `${x.digits}|${x.dep}|${x.arr}|${std}`;
}
function isoMinute(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ` +
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function sameUtcDate(a: Date, y: number, m: number, d: number): boolean {
  return a.getUTCFullYear() === y && a.getUTCMonth() === m && a.getUTCDate() === d;
}

function stdOnDay(x: OmniFlight, day: { y: number; m: number; d: number }): boolean {
  return x.std_local !== null && sameUtcDate(x.std_local, day.y, day.m, day.d);
}

/** STD tab so sánh (UTC) đã qua 17:00Z. */
function after1700z(stdUtc: Date): boolean {
  const h = stdUtc.getUTCHours(), m = stdUtc.getUTCMinutes();
  return h > OVERWRITE_AFTER_Z[0] || (h === OVERWRITE_AFTER_Z[0] && m > OVERWRITE_AFTER_Z[1]);
}

/** Lệch UTC của sân bay đi. Không biết thì +7 (VN), đơn vị giờ. */
export function iataUtcOffsetH(iata: string): number {
  return IATA_UTC_H[(iata || "").trim().toUpperCase()] ?? 7;
}

function addDaysUtc(day: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(day.y, day.m, day.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

export function omniStdUtc(x: OmniFlight): Date | null {
  if (x.std_local === null) return null;
  return new Date(x.std_local.getTime() - iataUtcOffsetH(x.dep) * 3600_000);
}

/** Cùng khóa ở hai trang ngày: chỉ ghi đè bản ngày sau nếu STD > 17:00Z. */
function preferDepartureDay(oldX: OmniFlight, newX: OmniFlight, queryDay: { y: number; m: number; d: number }): OmniFlight {
  if (!stdOnDay(newX, queryDay)) return oldX;
  const utc = omniStdUtc(newX);
  if (utc !== null && after1700z(utc)) return newX;
  return oldX;
}

function dayStr(day: { y: number; m: number; d: number }): string {
  return `${day.y}-${String(day.m + 1).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}
function parseDay(s: string): { y: number; m: number; d: number } {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new OmniError(`ngày không hợp lệ: ${s}`);
  return { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! };
}

async function postJson(session: OmniSession, path: string, body: unknown): Promise<Response> {
  return fetch(API + path, { method: "POST", headers: headers(session), body: JSON.stringify(body) });
}

/** POST Dashboard OMC cho một ngày "YYYY-MM-DD"; đăng nhập lại nếu token hết hạn. */
async function fetchFlightsDay(
  session: OmniSession,
  day: string,
  creds: OmniCredentials,
  onRelogin?: (s: OmniSession) => void,
): Promise<OmniFlight[]> {
  let r = await postJson(session, FLIGHTS, { flightDate: day });
  if (r.status === 401) {
    const relog = await login(creds);
    session = relog.session;
    onRelogin?.(session);
    r = await postJson(session, FLIGHTS, { flightDate: day });
  }
  if (r.status !== 200) {
    const text = await r.text().catch(() => "");
    throw new OmniError(`Omni flights ${day}: HTTP ${r.status} ${text.slice(0, 160)}`);
  }
  let j: unknown;
  try {
    j = await r.json();
  } catch {
    throw new OmniError(`Omni flights ${day}: phản hồi không phải JSON`);
  }
  const data = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>)["data"] : j;
  if (!Array.isArray(data)) throw new OmniError(`Omni flights ${day}: thiếu mảng data`);
  return parseFlightsJson(data);
}

/** Cửa sổ EST mặc định: hôm nay → ngày mai (theo UTC "hôm nay"). */
export function defaultSpan(today?: Date): [string, string] {
  const t = today ?? new Date();
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
  const tomorrow = addDaysUtc({ y, m, d }, 1);
  return [dayStr({ y, m, d }), dayStr(tomorrow)];
}

export interface FetchOpts {
  fromDate?: string;
  toDate?: string;
  session?: OmniSession;
  /** injectable for tests, same role as omni.py's module-level functions being patched */
  fetchDay?: (session: OmniSession, day: string) => Promise<OmniFlight[]>;
  loginFn?: (creds: OmniCredentials) => Promise<{ session: OmniSession; name: string }>;
}

/**
 * Tải EST từ Dashboard OMC (đủ Total Flight). Mặc định lấy hôm nay → mai.
 * Cùng khóa ở hai trang ngày: chỉ ghi đè bản ngày sau khi STD (UTC) đã qua 17:00Z.
 */
export async function fetchOmni(creds: OmniCredentials, opts: FetchOpts = {}): Promise<OmniFlight[]> {
  const [defF, defT] = defaultSpan();
  let f = parseDay(opts.fromDate ?? defF);
  let t = parseDay(opts.toDate ?? defT);
  if (dayStr(t) < dayStr(f)) [f, t] = [t, f];

  let session = opts.session;
  const doLogin = opts.loginFn ?? login;
  if (!session) {
    const r = await doLogin(creds);
    session = r.session;
  }
  const fetchDayFn = opts.fetchDay ?? ((s: OmniSession, day: string) => fetchFlightsDay(s, day, creds, (ns) => (session = ns)));

  const merged = new Map<string, OmniFlight>();
  const errors: string[] = [];
  let day = f;
  while (dayStr(day) <= dayStr(t)) {
    const ds = dayStr(day);
    try {
      const rows = await fetchDayFn(session, ds);
      for (const x of rows) {
        const key = omniDedupeKey(x);
        const prev = merged.get(key);
        merged.set(key, prev === undefined ? x : preferDepartureDay(prev, x, day));
      }
    } catch (exc) {
      errors.push(String((exc as Error).message ?? exc));
    }
    day = addDaysUtc(day, 1);
  }

  if (merged.size) return Array.from(merged.values());
  if (errors.length) throw new OmniError(errors[0]!);
  return [];
}

// --------------------------------------------------------------------------- //
// Ghép với chuyến bay FliteBrief
// --------------------------------------------------------------------------- //

export interface Matched {
  flight: Flight;
  omni: OmniFlight;
  gap_h: number; // std FliteBrief (UTC) − std Omni (local→UTC)
  note: string;
}

function fbLocalDate(stdUtc: Date, depIata = ""): { y: number; m: number; d: number } {
  const d = new Date(stdUtc.getTime() + iataUtcOffsetH(depIata) * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/**
 * Ghép theo số hiệu + ngày STD + chặng + giờ gần nhất trong ±window_h.
 * Omni ghi giờ địa phương, FliteBrief ghi UTC. Nếu còn nhiều ứng viên thì ưu
 * tiên cùng ngày STD (ICT) rồi mới xét chặng — tránh chuyến hôm nay ăn payload
 * ngày mai.
 */
export function match(flights: Iterable<Flight>, rows: Iterable<OmniFlight>, windowH = WINDOW_H): Map<number, Matched> {
  const byDigits = new Map<string, OmniFlight[]>();
  for (const x of rows) {
    const arr = byDigits.get(x.digits) ?? [];
    arr.push(x);
    byDigits.set(x.digits, arr);
  }

  const out = new Map<number, Matched>();
  for (const f of flights) {
    const d = (f.callsign ?? "").replace(/\D/g, "").replace(/^0+/, "");
    const cands = byDigits.get(d) ?? [];
    if (!cands.length || f.std === null) continue;

    const std = f.std;
    let near: Array<[OmniFlight, number]> = [];
    for (const x of cands) {
      const utc = omniStdUtc(x);
      if (utc === null) continue;
      const gap = (std.getTime() - utc.getTime()) / 3_600_000;
      if (Math.abs(gap) <= windowH) near.push([x, gap]);
    }
    if (!near.length) continue;

    let note = "";
    if (after1700z(std)) {
      const qua = addDaysUtc({ y: std.getUTCFullYear(), m: std.getUTCMonth(), d: std.getUTCDate() }, 1);
      const night = near.filter(([x]) => x.std_local !== null && sameUtcDate(x.std_local, qua.y, qua.m, qua.d));
      if (night.length) {
        if (night.length < near.length) note = "STD > 17:00Z, lấy chuyến qua ngày";
        near = night;
      }
    } else {
      const local = fbLocalDate(std, f.dep_iata);
      const sameDay = near.filter(([x]) => x.std_local !== null && sameUtcDate(x.std_local, local.y, local.m, local.d));
      if (sameDay.length) {
        if (sameDay.length < near.length) note = "chọn chuyến cùng ngày STD, bỏ bản ngày khác";
        near = sameDay;
      } else {
        continue;
      }
    }
    if (near.length > 1) {
      const hits = near.filter(([x]) => x.dep === (f.dep_iata || "").toUpperCase() && x.arr === (f.dest_iata || "").toUpperCase());
      if (hits.length === 1) {
        near = hits;
        note = `${cands.length} chuyến cùng số hiệu, chọn theo chặng`;
      } else if (hits.length) {
        near = hits;
      }
      if (near.length > 1) {
        near = [...near].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
        note = `CẢNH BÁO: ${near.length} chuyến Omni cùng số hiệu trong ±${windowH.toFixed(0)}h, chọn chuyến gần giờ nhất`;
      }
    }

    const [x, gap] = near[0]!;
    out.set(f.id, { flight: f, omni: x, gap_h: gap, note });
  }
  return out;
}
