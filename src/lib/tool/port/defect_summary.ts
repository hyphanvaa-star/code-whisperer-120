// Port of defect_summary.py — pure date/subject/attachment-ranking logic only.
// Outlook REST fetching (fetch_today_pdf / pull_today) needs the PC helper and
// is not ported here; the caller is responsible for wiring that separately.

export class DefectSummaryError extends Error {}

export const VN_TZ_OFFSET_MIN = 7 * 60;
export const SUBJECT_NEEDLE = "AIRCRAFT TECHNICAL SUMMARY";
export const LOOKBACK_D = 3;

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const RE_DAY = /\b(\d{1,2})\s*[-./]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\s*[-./]?\s*(\d{2}|\d{4}))?(?![A-Z0-9])/i;
const RE_PDF = /\.pdf$/i;
const RE_SUMMARY_PDF = /TECHNICAL\s*SUMMARY|\bSUMMARY\b/i;
const RE_LIMIT_PDF = /LIMITATION\s*LIST|OPS\s*LIMITATION|MP\s*&\s*OPS|FOR OMC|VJC\.?\s*REP/i;
const RE_STATUS_PDF = /STATUS\s*REPORT/i;

export type Msg = Record<string, unknown>;
export type Attachment = Record<string, unknown>;

/** VN datetime = UTC + 7h, kept as a plain Date shifted by the offset for date-field reads. */
function toVn(d: Date): Date {
  return new Date(d.getTime() + VN_TZ_OFFSET_MIN * 60_000);
}

export function vnNow(now?: Date | null): Date {
  return toVn(now ?? new Date());
}

function vnDateParts(d: Date): { y: number; m: number; day: number } {
  const vn = toVn(d);
  return { y: vn.getUTCFullYear(), m: vn.getUTCMonth() + 1, day: vn.getUTCDate() };
}

/** Date-only compare key, like Python's date objects ("YYYY-MM-DD"). */
export function vnToday(now?: Date | null): string {
  const { y, m, day } = vnDateParts(now ?? new Date());
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function isSummarySubject(subject: string | null | undefined): boolean {
  const blob = String(subject ?? "").split(/\s+/).filter(Boolean).join(" ").toUpperCase();
  return blob.includes(SUBJECT_NEEDLE);
}

function dateKey(y: number, m: number, day: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function isValidDate(y: number, m: number, day: number): boolean {
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1 && d.getUTCDate() === day;
}

/** Ngày in trên subject `02 SEP 2026` / `02-SEP-26`. */
export function parseReportDay(subject: string | null | undefined, opts: { today?: string } = {}): string | null {
  const today = opts.today ?? vnToday();
  const match = RE_DAY.exec(String(subject ?? ""));
  if (!match) return null;
  const dayN = parseInt(match[1]!, 10);
  const month = MONTHS[match[2]!.toUpperCase().slice(0, 3)]!;
  const yearRaw = match[3];
  let year: number;
  if (yearRaw) {
    year = parseInt(yearRaw, 10);
    if (year < 100) year = year < 80 ? 2000 + year : 1900 + year;
  } else {
    year = parseInt(today.slice(0, 4), 10);
  }
  if (!isValidDate(year, month, dayN)) return null;
  return dateKey(year, month, dayN);
}

export function parseWhen(msg: Msg): Date | null {
  const raw = (msg["SentDateTime"] ?? msg["sentDateTime"] ?? msg["ReceivedDateTime"] ?? msg["receivedDateTime"]) as string | undefined;
  if (!raw) return null;
  const iso = String(raw).replace("Z", "+00:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Giờ gửi theo VN, để đối chiếu trên bảng: `05:53 02/09/2026`. */
export function formatSent(when: Date | null): string {
  if (when == null) return "";
  const vn = toVn(when);
  return `${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())} ${pad2(vn.getUTCDate())}/${pad2(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
}

function subjectOf(msg: Msg): string {
  return String(msg["Subject"] ?? msg["subject"] ?? "");
}

export function mailDay(msg: Msg, opts: { today: string }): string | null {
  const subject = subjectOf(msg);
  const day = parseReportDay(subject, { today: opts.today });
  if (day != null) return day;
  const when = parseWhen(msg);
  if (when == null) return null;
  const vn = toVn(when);
  return dateKey(vn.getUTCFullYear(), vn.getUTCMonth() + 1, vn.getUTCDate());
}

export function nearestOtherMail(messages: Msg[], opts: { now?: Date | null } = {}): Msg | null {
  const today = vnToday(opts.now);
  let best: { ts: number; msg: Msg } | null = null;
  for (const msg of messages) {
    if (!isSummarySubject(subjectOf(msg))) continue;
    const day = mailDay(msg, { today });
    if (day === today) continue;
    const when = parseWhen(msg);
    const ts = when != null ? when.getTime() / 1000 : 0;
    if (best == null || ts > best.ts) best = { ts, msg };
  }
  return best?.msg ?? null;
}

function fmtDmy(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export function missingTodayMessage(messages: Msg[], opts: { now?: Date | null } = {}): string {
  const today = vnToday(opts.now);
  const want = fmtDmy(today);
  const other = nearestOtherMail(messages, opts);
  if (other == null) {
    return (
      `Không tìm thấy mail ${SUBJECT_NEEDLE} của ngày ${want}.\n` +
      `Không có mail summary nào trong ${LOOKBACK_D} ngày gần đây.`
    );
  }
  const subject = subjectOf(other);
  const when = parseWhen(other);
  const day = mailDay(other, { today });
  const dayS = day ? fmtDmy(day) : "không rõ";
  const sent = formatSent(when) || "không rõ giờ gửi";
  return (
    `Mail sai ngày.\n` +
    `Cần ngày ${want} (ngày nhấn tải).\n` +
    `Mail gần nhất: ${subject}\n` +
    `Ngày mail gửi: ${sent} (ngày trên mail: ${dayS}).`
  );
}

export function slotOf(when: Date | null): string {
  if (when == null) return "";
  const vn = toVn(when);
  return vn.getUTCHours() < 12 ? "am" : "pm";
}

/** Lấy mail summary đúng ngày nhấn: chiều nếu đã có, không thì sáng. */
export function pickTodayMail(messages: Msg[], opts: { now?: Date | null } = {}): Msg | null {
  const today = vnToday(opts.now);
  let best: { ts: number; msg: Msg } | null = null;
  for (const msg of messages) {
    const subject = subjectOf(msg);
    if (!isSummarySubject(subject)) continue;
    const when = parseWhen(msg);
    const subjDay = parseReportDay(subject, { today });
    const recvDay = when != null ? (() => {
      const vn = toVn(when);
      return dateKey(vn.getUTCFullYear(), vn.getUTCMonth() + 1, vn.getUTCDate());
    })() : null;
    if (subjDay != null && subjDay !== today) continue;
    if (subjDay == null && recvDay !== today) continue;
    const ts = when != null ? when.getTime() / 1000 : 0;
    if (best == null || ts > best.ts) best = { ts, msg };
  }
  return best?.msg ?? null;
}

/** 0 = bảng defect OMC, 1 = summary khác, 8 = PDF linh tinh, 9 = STATUS REPORT. */
export function pdfRank(name: string | null | undefined): number {
  const blob = String(name ?? "");
  if (RE_LIMIT_PDF.test(blob)) return 0;
  if (RE_STATUS_PDF.test(blob)) return 9;
  if (RE_SUMMARY_PDF.test(blob)) return 1;
  return 8;
}

function attName(att: Attachment): string {
  return String(att["Name"] ?? att["name"] ?? "");
}

/** PDF đính kèm: LIMITATION LIST trước, STATUS REPORT để cuối. */
export function rankedPdfAttachments(attachments: Attachment[]): Attachment[] {
  const pdfs = attachments.filter((att) => RE_PDF.test(attName(att)));
  return [...pdfs].sort((a, b) => {
    const ra = pdfRank(attName(a)), rb = pdfRank(attName(b));
    if (ra !== rb) return ra - rb;
    return attName(a).toLowerCase() < attName(b).toLowerCase() ? -1 : attName(a).toLowerCase() > attName(b).toLowerCase() ? 1 : 0;
  });
}

/** PDF bảng defect; bỏ Excel `SUMMARY MP & OPS LIMITATION`. */
export function pickPdfAttachment(attachments: Attachment[]): Attachment | null {
  const rows = rankedPdfAttachments(attachments);
  return rows.length ? rows[0]! : null;
}
