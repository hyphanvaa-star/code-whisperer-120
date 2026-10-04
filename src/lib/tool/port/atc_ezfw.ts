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

const RE_PLAN = /^PLAN\s+(\d+)\s+\S+/m;
const RE_PAGE = /^Page\s*-/i;

export function extractEzfw(text: string): string {
  const t = text || "";
  const m = RE_PLAN.exec(t);
  if (!m) throw new AeError("OFP không có khối PLAN (trang fuel/EZFW).");
  let chunk = t.slice(m.index);
  const end = /^WEIGHT CHANGE[^\n]*/im.exec(chunk);
  if (end) chunk = chunk.slice(0, end.index + end[0].length);
  const lines = chunk
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !RE_PAGE.test(l) && l.trim());
  const out = spaceOut(lines.join("\n").trim());
  if (!out.toUpperCase().includes("FUEL PLAN")) {
    throw new AeError("Khối PLAN thiếu FUEL PLAN — kiểm tra OFP.");
  }
  return out + "\n";
}
