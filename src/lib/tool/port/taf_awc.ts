// NOAA Aviation Weather Center (aviationweather.gov) — nguồn TAF/METAR quốc tế
// bù cho đài MET TSN. Dùng file cache toàn cầu công khai (1 request cho cả thế
// giới, không cần tài khoản). Pure module: chỉ dùng fetch toàn cục + fflate.
import { gunzipSync, strFromU8 } from "fflate";
import { parseTafBlock, type TafRec } from "./taf";

export const AWC_SOURCE = "NOAA AWC";
export const AWC_TAF_URL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz";
export const AWC_METAR_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz";

/** Vùng được thêm sân mới (khi đài TSN không có sân đó): châu Á – Thái Bình
 * Dương, Trung Đông, Nga/Trung Á, Úc, Czech. Sân TSN báo NIL thì bù ở mọi vùng. */
export const AWC_ADD_PREFIXES = ["V", "W", "R", "Z", "U", "O", "Y", "N", "LK"] as const;
/** METAR cũ hơn mức này không gắn vào sân NIL. */
export const METAR_MAX_AGE_H = 6;

export type MetarRec = { raw: string; time: string };

function decode(buf: Uint8Array): string {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return strFromU8(gunzipSync(buf));
  return strFromU8(buf);
}

/** Đọc tafs.cache.xml → bản TAF mới nhất mỗi sân (đã parse như TAF đài TSN). */
export function parseAwcTafXml(xml: string, now: Date = new Date()): Record<string, TafRec> {
  const out: Record<string, TafRec> = {};
  const issued: Record<string, string> = {};
  const reTaf = /<TAF>([\s\S]*?)<\/TAF>/g;
  let m: RegExpExecArray | null;
  while ((m = reTaf.exec(xml))) {
    const blk = m[1];
    const rawM = /<raw_text>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/raw_text>/.exec(blk);
    if (!rawM) continue;
    const raw = rawM[1].trim();
    let rec: TafRec | null = null;
    try { rec = parseTafBlock(raw); } catch { rec = null; }
    if (!rec || rec.nil || !rec.valid_to) continue;
    // Bỏ TAF đã hết hiệu lực.
    if (new Date(rec.valid_to).getTime() < now.getTime()) continue;
    const issue = /<issue_time>([^<]+)<\/issue_time>/.exec(blk)?.[1] ?? "";
    if (out[rec.icao] && issue <= (issued[rec.icao] ?? "")) continue;
    out[rec.icao] = { ...rec, source: AWC_SOURCE };
    issued[rec.icao] = issue;
  }
  return out;
}

/** Đọc metars.cache.csv → METAR mới nhất mỗi sân (bỏ bản quá METAR_MAX_AGE_H). */
export function parseAwcMetarCsv(csv: string, now: Date = new Date()): Record<string, MetarRec> {
  const out: Record<string, MetarRec> = {};
  const lines = csv.split(/\r?\n/);
  for (const line of lines) {
    const m = /^"([^"]*)",([A-Z0-9]{4}),([^,]+),/.exec(line);
    if (!m) continue;
    const [, raw, icao, time] = m;
    const t = new Date(time).getTime();
    if (Number.isNaN(t) || now.getTime() - t > METAR_MAX_AGE_H * 3_600_000) continue;
    const prev = out[icao];
    if (prev && new Date(prev.time).getTime() >= t) continue;
    out[icao] = { raw: raw.trim(), time: new Date(t).toISOString() };
  }
  return out;
}

export type AwcMergeStats = { filled: string[]; added: string[]; metar: string[] };

function inAddRegion(icao: string): boolean {
  return AWC_ADD_PREFIXES.some((p) => icao.startsWith(p));
}

/**
 * Gộp NOAA vào bộ TAF đài TSN (đài TSN luôn ưu tiên):
 *  - TSN có TAF hợp lệ → giữ nguyên.
 *  - TSN báo NIL → thay bằng TAF NOAA (mọi vùng).
 *  - TSN không có sân → thêm nếu sân thuộc AWC_ADD_PREFIXES.
 *  - Sân vẫn NIL sau đó → gắn METAR mới nhất (nếu có) để xem khi rê chuột.
 */
export function mergeAwc(
  tafs: Record<string, TafRec>,
  awcTafs: Record<string, TafRec>,
  metars: Record<string, MetarRec> = {},
): AwcMergeStats {
  const stats: AwcMergeStats = { filled: [], added: [], metar: [] };
  for (const [icao, rec] of Object.entries(awcTafs)) {
    const cur = tafs[icao];
    if (cur && !cur.nil) continue;
    if (cur?.nil) { tafs[icao] = rec; stats.filled.push(icao); continue; }
    if (inAddRegion(icao)) { tafs[icao] = rec; stats.added.push(icao); }
  }
  for (const [icao, rec] of Object.entries(tafs)) {
    if (!rec.nil) continue;
    const mt = metars[icao];
    if (mt) { tafs[icao] = { ...rec, metar: mt }; stats.metar.push(icao); }
    else if (rec.metar) { const { metar: _drop, ...rest } = rec; tafs[icao] = rest; }
  }
  return stats;
}

async function getBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "SoheeDispatchBoard/1.0" } });
  if (!r.ok) throw new Error(`${AWC_SOURCE} HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function fetchAwcTafs(now: Date = new Date()): Promise<Record<string, TafRec>> {
  return parseAwcTafXml(decode(await getBytes(AWC_TAF_URL, 25_000)), now);
}

export async function fetchAwcMetars(now: Date = new Date()): Promise<Record<string, MetarRec>> {
  return parseAwcMetarCsv(decode(await getBytes(AWC_METAR_URL, 25_000)), now);
}
