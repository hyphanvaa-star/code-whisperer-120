// Port of aip_airac.py — ngày hết hiệu lực của bản AIRAC đang vẽ trên bản đồ.
import raw from "../data/aip_airac.json";

export const ICAO_ANCHOR = new Date(Date.UTC(2026, 0, 22));
export const KOREA_ANCHOR = new Date(Date.UTC(2026, 5, 25));
const STEP = 28;

// Nước có dữ liệu ATS hoặc sơ đồ đang vẽ.
export const DRAWN = [
  "AU", "CN", "HK", "ID", "IN", "JP", "KH", "KR",
  "LA", "MY", "PH", "SG", "TH", "TW", "VN",
] as const;

export type Edition = {
  name?: string;
  cycle?: string;
  effective?: string;
  expires?: string;
  calendar?: string;
  note?: string;
};

type AiracFile = { countries: Record<string, Edition> };

function dayUtc(d: Date): number {
  return Math.floor(d.getTime() / 86400000);
}

function parseDay(text: string): Date | null {
  const raw = (text || "").trim();
  if (raw.length !== 10 || raw[4] !== "-" || raw[7] !== "-") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function onCalendar(day: Date, calendar: string): boolean {
  const anchor = calendar === "icao" ? ICAO_ANCHOR : calendar === "kr" ? KOREA_ANCHOR : null;
  if (anchor === null) return false;
  const diff = dayUtc(day) - dayUtc(anchor);
  return ((diff % STEP) + STEP) % STEP === 0;
}

export function expiresOn(effective: Date, calendar: string): Date | null {
  if (!onCalendar(effective, calendar)) return null;
  return new Date(effective.getTime() + STEP * 86400000);
}

export function load(): AiracFile {
  const data = raw as unknown as AiracFile;
  if (!data || typeof data !== "object" || typeof data.countries !== "object" || data.countries === null) {
    return { countries: {} };
  }
  return data;
}

export function edition(code: string): Edition | null {
  const row = load().countries[code];
  return row && typeof row === "object" ? row : null;
}

export function status(code: string, today?: Date): "current" | "upcoming" | "expired" | "unknown" {
  const row = edition(code) || {};
  const start = parseDay(String(row.effective || ""));
  const end = parseDay(String(row.expires || ""));
  if (start === null || end === null) return "unknown";
  const day = today || new Date(Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
  ));
  if (dayUtc(day) < dayUtc(start)) return "upcoming";
  if (dayUtc(day) < dayUtc(end)) return "current";
  return "expired";
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
