// Port of atc_check.py — pure logic only (no Selenium/browser; see atc.server.ts
// for the job wiring, which cannot reach AviWeb from a Worker and reports that).

export type AtcCheckResult = {
  callsign: string;
  status?: string;
  flightTime?: string;
  reg?: string;
  dof?: string;
  error?: string;
  ok?: boolean;
};

/** Vì sao chuyến này CHƯA check được (xem docstring Python gốc). Rỗng = đủ để kết luận. */
export function missingDetailReason(result: AtcCheckResult, modalText = ""): string {
  if (result.reg || result.dof || result.flightTime) return "";
  if (modalText) return "mở được FPL nhưng trong đó không có REG/DOF/EOBT";
  return "bấm View nhưng không đọc được nội dung FPL";
}

const RE_FPL_CS = /\((?:FPL|CHG|CNL|DLA)-([A-Z0-9]+)-/i;

/** Số hiệu trong điện văn FPL, ví dụ "(FPL-VJC150-IS" -> "VJC150". */
export function fplCallsign(text: string): string {
  const m = RE_FPL_CS.exec(text || "");
  return m ? m[1].toUpperCase() : "";
}

/** True khi nội dung View đúng là FPL của chuyến đang check — không phải chuyến trước. */
export function fplIsFor(text: string, callsign: string): boolean {
  const want = (callsign || "").trim().toUpperCase();
  if (!want || !(text || "").trim()) return false;
  const got = fplCallsign(text);
  if (got) return got === want;
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`);
  return rx.test((text || "").slice(0, 600).toUpperCase());
}
