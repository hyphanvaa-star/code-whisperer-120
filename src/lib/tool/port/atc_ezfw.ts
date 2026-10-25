// Port of atc_ezfw.py — pure text-cutting + naming logic (no Outlook draft:
// the web app cannot drive desktop Outlook; see autoload.server.ts).
export class AeError extends Error {}

export const BODY = "Dear On Duty,\n\nPlease find the attached document.\n";

const RE_DIGITS = /(\d{2,5})/g;

export function flightsOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text || "").matchAll(RE_DIGITS)) {
    const n = m[1];
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function digitsOf(text: string): string {
  const found = flightsOf(text);
  return found.length ? found[found.length - 1] : "";
}

export function fileCallsign(cs: string): string {
  const blob = String(cs || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (blob.startsWith("VJ") && !blob.startsWith("VJC")) return "VJC" + blob.slice(2);
  if (/^\d/.test(blob)) return "VJC" + blob;
  return blob || "VJC";
}

export function mailCallsign(cs: string): string {
  const blob = fileCallsign(cs);
  return blob.startsWith("VJC") ? "VJ" + blob.slice(3) : blob;
}

export function dateTag(when: Date | null): string {
  const day = when || new Date();
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return String(day.getUTCDate()).padStart(2, "0") + MON[day.getUTCMonth()];
}

export function subjectOf(cs: string, when: Date | null): string {
  return `ATC & EZFW FOR ${mailCallsign(cs)} ON ${dateTag(when)}`;
}

export function isOldStd(std: Date | null, now?: Date): boolean {
  if (!std) return false;
  const clock = now || new Date();
  return std.getTime() <= clock.getTime();
}

/** Khối ICAO "(FPL-… )" — giống ATC_VJC5513.txt. */
export function extractAtc(text: string): string {
  const t = text || "";
  const start = t.indexOf("(FPL-");
  if (start < 0) throw new AeError("OFP không có điện văn (FPL-… ).");
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        const block = t.slice(start, i + 1).trim();
        return block + (block.endsWith("\n") ? "" : "\n");
      }
    }
  }
  throw new AeError("Khối (FPL-… trong OFP không đóng ngoặc.");
}

export function joinAtcBlocks(blocks: Iterable<string>): string {
  const parts = Array.from(blocks).map((b) => String(b || "").trim()).filter(Boolean);
  if (!parts.length) return "";
  return parts.join("\n".repeat(5)) + "\n";
}

const EZFW_BREAKS: RegExp[] = [
  /^V1:/,
  /^FLX:/,
  /^FUEL PLAN\b/,
  /^\s+FUEL\s+TIME\s*$/,
  /^FINAL FUEL ORDER/,
  /^GREATER THAN\b/,
  /^LRC\b/,
  /^PIC SIGNATURE/,
  /^PIC"S SIGNATURE/,
  /^CAPT\b/,
  /^ROUTE\b.*\bCRZ\b/,
  /^PLD\b/,
  /^FUEL CONSUMPTION\b/,
  /^WEIGHT CHANGE\b/,
];

export function spaceOut(text: string): string {
  const out: string[] = [];
  for (const line of String(text || "").split("\n")) {
    if (EZFW_BREAKS.some((rx) => rx.test(line)) && out.length && out[out.length - 1].trim()) {
      out.push("");
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/^\n+|\n+$/g, "");
}

const RE_PLAN = /^[ \t]*PLAN\s+(\d+)\s+\S+/m;
const RE_PAGE = /^[ \t]*Page\s*-/i;

export function extractEzfw(text: string): string {
  const t = text || "";
  const m = RE_PLAN.exec(t);
  if (!m) throw new AeError("OFP không có khối PLAN (trang fuel/EZFW).");
  let chunk = t.slice(m.index);
  const end = /^[ \t]*WEIGHT CHANGE[^\n]*/im.exec(chunk);
  if (end) chunk = chunk.slice(0, end.index + end[0].length);
  const lines = chunk
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !RE_PAGE.test(l));
  // Retain source blank lines and column spacing. Add section gaps only for
  // compact source PDFs; never collapse existing horizontal whitespace.
  const out = spaceOut(lines.join("\n").replace(/^\n+|\n+$/g, ""));
  if (!out.toUpperCase().includes("FUEL PLAN")) {
    throw new AeError("Khối PLAN thiếu FUEL PLAN — kiểm tra OFP.");
  }
  return out + "\n";
}

// Port of atc_ezfw.py OPS_BACK_H/OPS_AHEAD_H + in_ops_window/find_flight.
export const OPS_BACK_H = 6.0;
export const OPS_AHEAD_H = 24.0;

export function inOpsWindow(std: Date | null, now?: Date): boolean {
  if (!std) return false;
  const clock = now || new Date();
  const lo = clock.getTime() - OPS_BACK_H * 3600_000;
  const hi = clock.getTime() + OPS_AHEAD_H * 3600_000;
  return std.getTime() >= lo && std.getTime() <= hi;
}

export interface AeFlight {
  id: number;
  callsign: string;
  fltno?: string;
  commercial_fltno?: string;
  std: Date | null;
}

/** Port of atc_ezfw.find_flight: số hiệu, trong cửa sổ khai thác, STD sớm nhất. */
export function findFlight(flights: Iterable<AeFlight>, want: string, now?: Date): AeFlight {
  const digits = digitsOf(want);
  if (!digits) throw new AeError("Nhập số hiệu chuyến, ví dụ 5513.");
  const rx = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
  const hits: AeFlight[] = [];
  for (const f of flights) {
    const blob = [f.callsign, f.fltno, f.commercial_fltno].filter(Boolean).join(" ");
    if (rx.test(blob)) hits.push(f);
  }
  if (!hits.length) throw new AeError(`Không thấy chuyến ${digits} trên FliteBrief (cửa sổ đang nạp).`);
  const fresh = hits.filter((f) => inOpsWindow(f.std, now));
  if (!fresh.length) {
    const days = Array.from(new Set(hits.map((f) => (f.std ? `${String(f.std.getUTCDate()).padStart(2, "0")}/${String(f.std.getUTCMonth() + 1).padStart(2, "0")}` : "?")))).sort();
    throw new AeError(
      `Chuyến ${digits} chỉ có sector ngoài khung khai thác (−${OPS_BACK_H}h…+${OPS_AHEAD_H}h): ngày ${days.join(", ")}. ` +
        "Chưa có OFP hôm nay thì chờ OMC release rồi soạn lại.",
    );
  }
  if (fresh.length > 1) throw new AeError(`Có nhiều sector chuyến ${digits} trong khung −6/+24 — cần chọn đúng ngày/chặng.`);
  fresh.sort((a, b) => (a.std?.getTime() ?? Infinity) - (b.std?.getTime() ?? Infinity));
  const selected = fresh[0];
  if (!selected) throw new AeError("Không xác định được chuyến.");
  return selected;
}

const AE_MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** Tên file ATC/EZFW: ATC_VJC1876_5348 — chỉ số hiệu + số CFP (khối PLAN), không có ngày. */
export function aeFileNames(callsign: string, ezfw: string, _std?: Date | null): { atc: string; ezfw: string } {
  const cs = fileCallsign(callsign);
  const no = /^[ \t]*PLAN\s+(\d+)\s/m.exec(ezfw)?.[1];
  const tail = no ? '_' + no : '';
  return { atc: `ATC_${cs}${tail}.txt`, ezfw: `EZFW_${cs}${tail}.txt` };
}

/** Ngày bay của OFP dạng YYMMDD: ưu tiên hàng GENERAL INFO (FLT NBR … DATE), rồi "22OCT" trên dòng PLAN, cuối cùng ngày cuối dòng PLAN. */
export function ofpFlightDates(text: string): string[] {
  const out: string[] = [];
  const gi = /^[ \t]*[A-Z]{2,3}\d+[ \t]+VN-?A\d{3}[ \t]+(\d{2})\/(\d{2})\/(\d{2,4})\b/m.exec(text);
  if (gi) out.push(gi[3]!.slice(-2) + gi[2] + gi[1]);
  const plan = /^[ \t]*PLAN\s+\d+\s+\S+\s+(\d{2})([A-Z]{3})\b[^\n]*?(?:(\d{2})\/(\d{2})\/(\d{2,4}))?\s*$/m.exec(text);
  if (plan) {
    const mi = AE_MON.indexOf(plan[2]!);
    const yy = plan[5] ? plan[5].slice(-2) : null;
    if (mi >= 0 && yy) out.push(yy + String(mi + 1).padStart(2, '0') + plan[1]);
    if (plan[3]) out.push(plan[5]!.slice(-2) + plan[4] + plan[3]);
  }
  return out;
}
