// Đọc ngày/giờ ghi trong nội dung PDF PIB/WX và so với STD chuyến.
// File chỉ được đính kèm khi có ít nhất một mốc giờ cách STD không quá maxH giờ.

const MON: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const yr = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const utc = (y: number, m: number, d: number, h: number, mi: number) => {
  if (m < 0 || m > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const t = new Date(Date.UTC(y, m, d, h, mi));
  return t.getUTCDate() === d ? t : null;
};

/** Mọi mốc ngày-giờ (UTC) đọc được trong chữ của PDF. `ref` dùng để đoán tháng/năm cho dạng DDHHMMZ. */
export function pdfTimes(text: string, ref: Date): Date[] {
  const s = String(text || "").toUpperCase();
  const out: Date[] = [];
  const push = (d: Date | null) => { if (d) out.push(d); };
  let m: RegExpExecArray | null;
  // 2026-10-19 05:30 / 2026/10/19 0530
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})[ T,]+(\d{1,2}):?(\d{2})\b/g;
  while ((m = iso.exec(s))) push(utc(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
  // 19/10/2026 05:30 · 19-10-26 0530
  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})[ ,]+(\d{1,2}):?(\d{2})\b/g;
  while ((m = dmy.exec(s))) push(utc(yr(m[3]!), +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!));
  // 19OCT26 0530 · 19 OCT 2026 05:30 · 19-OCT-2026 0530Z
  const dmon = /\b(\d{1,2})[ -]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]?(20\d{2}|\d{2})[ ,/]+(\d{2}):?(\d{2})/g;
  while ((m = dmon.exec(s))) push(utc(yr(m[3]!), MON[m[2]!]!, +m[1]!, +m[4]!, +m[5]!));
  // 2610190530 (NOTAM YYMMDDHHMM)
  const notam = /\b(2\d)(\d{2})(\d{2})(\d{2})(\d{2})\b/g;
  while ((m = notam.exec(s))) push(utc(2000 + +m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
  // 190530Z (METAR/TAF) — tháng/năm lấy theo STD, lùi 1 tháng nếu ngày lớn hơn
  const dz = /\b(\d{2})(\d{2})(\d{2})Z\b/g;
  while ((m = dz.exec(s))) {
    const d = +m[1]!;
    let y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
    if (d - ref.getUTCDate() > 15) { mo--; if (mo < 0) { mo = 11; y--; } }
    else if (ref.getUTCDate() - d > 15) { mo++; if (mo > 11) { mo = 0; y++; } }
    push(utc(y, mo, d, +m[2]!, +m[3]!));
  }
  return out;
}

export interface TimeCheck { ok: boolean; nearestH: number | null; nearest: Date | null }

/** ok khi có mốc giờ trong file cách STD ≤ maxH giờ. Không đọc được mốc nào → ok=false. */
export function checkAgainstStd(text: string, std: Date, maxH = 4): TimeCheck {
  const times = pdfTimes(text, std);
  let best: Date | null = null, bestD = Infinity;
  for (const t of times) {
    const d = Math.abs(t.getTime() - std.getTime());
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best) return { ok: false, nearestH: null, nearest: null };
  const h = bestD / 3600e3;
  return { ok: h <= maxH, nearestH: Math.round(h * 10) / 10, nearest: best };
}
