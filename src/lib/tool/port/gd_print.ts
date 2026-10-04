// Port of gd_print.py constants + pure helpers. Printing itself runs on the
// company PC through the PC agent (see pcagent.server.ts), since a Worker
// cannot reach a LAN printer or Outlook COM.
export const FOLDER_NAME = "GENDEC";
export const PRINTER_HINT = "RICOH MP 5055";
export const LOOKBACK_H = 7 * 24;
export const MAX_PAGES = 6;

/** Excel 1-based sheet index, copies, orientation — same PRINT_PLAN as Python. */
export const PRINT_PLAN: ReadonlyArray<{ sheet: number; copies: number; orientation: "portrait" | "landscape" }> = [
  { sheet: 3, copies: 5, orientation: "portrait" },
  { sheet: 5, copies: 1, orientation: "landscape" },
  { sheet: 6, copies: 1, orientation: "landscape" },
  { sheet: 7, copies: 2, orientation: "landscape" },
];

/** Số hiệu từ ô nhập, ví dụ "3948" -> "3948" (ký tự không phải số bị bỏ). */
export function digitsOf(flight: string): string {
  const m = /(\d{2,5})/.exec(String(flight || ""));
  return m ? m[1] : "";
}

/** Mọi số hiệu trong ô nhập: "3948 3900" -> ["3948", "3900"]. */
export function flightsOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text || "").matchAll(/\d+/g)) {
    const n = m[0];
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** True nếu "3948" xuất hiện như một số, không dính 39480. */
export function containsFlight(text: string, flight: string): boolean {
  const want = digitsOf(flight);
  if (!want) return false;
  return new RegExp(`(?<!\\d)${want}(?!\\d)`).test(String(text || ""));
}

/** "VN-A651" / "VNA 651" / "vna651" -> "VNA651" để so. */
export function normalizeReg(text: string): string {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sameReg(left: string, right: string): boolean {
  const a = normalizeReg(left);
  const b = normalizeReg(right);
  return !!a && !!b && a === b;
}

/** "VNA651" -> "VN-A651". */
export function prettyReg(text: string): string {
  const n = normalizeReg(text);
  const m = /^(VN)A(\d{3})$/.exec(n);
  if (m) return `${m[1]}-A${m[2]}`;
  return String(text || "").trim() || n;
}

export function regsMatch(gdReg: string, crewRegs: string[]): boolean {
  return crewRegs.some((r) => sameReg(gdReg, r));
}
