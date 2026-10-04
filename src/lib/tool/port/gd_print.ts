// Port of gd_print.py constants + pure helpers. Printing itself happens in the
// browser (see autoload.server.ts /api/gd/print) since a Worker cannot reach a
// LAN printer.
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
