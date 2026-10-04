// Port of owa_fpl_watch.py — status/response shape only; the live mailbox watch
// needs OWA_USER/OWA_PASS and Exchange/OWA access (see autoload.server.ts).
export type OwaFplStatus = {
  running: boolean;
  last_at: number;
  count: number;
  items: Array<{ id: number; subject: string; at: string }>;
  error: string;
};

export function emptyStatus(error = ""): OwaFplStatus {
  return { running: false, last_at: 0, count: 0, items: [], error };
}

// --- Pure parsing/ranking logic ported from owa_fpl_watch.py (subject/version
// parsing, attachment classification, VER ranking). Network polling (poll_once)
// needs a live OWA session and is not ported — see handlers/autoload.server.ts.

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const RE_XLSX = /\.(xlsx|xlsm)$/i;
const RE_FPL = /FLIGHT\s*PLAN|\bFPL\b/i;
const RE_CREW = /CREW\s*LIST|\bCRL\b/i;
const RE_UPDATE = /\bUPDATE\b/i;
const RE_VER = /\bVER\s*(\d{1,3})\b/i;
const RE_DAY = /\b(\d{1,2})\s*[-./]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\s*[-./]?\s*(\d{2}|\d{4}))?(?![A-Z0-9])/i;

function normFplText(text: string | null | undefined): string {
  let blob = String(text ?? "").replace(/\u2013/g, "-").replace(/\u2014/g, "-");
  blob = blob.replace(/\/+/g, " ").replace(/\s+/g, " ");
  return blob.trim();
}

export function parseFplVer(text: string | null | undefined): number {
  const m = RE_VER.exec(normFplText(text));
  return m ? parseInt(m[1]!, 10) : 0;
}

function yearToken(raw: string, fallback: number): number {
  const year = parseInt(raw, 10);
  if (year < 100) return year < 80 ? 2000 + year : 1900 + year;
  return year;
}

function toDateKey(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

/** Ngày ops in trên subject/tên file (``20 AUG`` / ``21AUG26``). Returns a date key or null. */
export function parseFplDay(
  text: string | null | undefined,
  opts: { when?: Date | null; today?: string } = {},
): string | null {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const match = RE_DAY.exec(normFplText(text));
  if (match) {
    const dayN = parseInt(match[1]!, 10);
    const month = MONTHS[match[2]!.toUpperCase().slice(0, 3)]!;
    const yearRaw = match[3];
    const fallbackYear = opts.when ? opts.when.getUTCFullYear() : parseInt(today.slice(0, 4), 10);
    const year = yearRaw ? yearToken(yearRaw, fallbackYear) : fallbackYear;
    let key = toDateKey(year, month, dayN);
    if (!key) return null;
    if (!yearRaw && !opts.when) {
      const parsed = new Date(`${key}T00:00:00Z`);
      const todayD = new Date(`${today}T00:00:00Z`);
      const delta = Math.round((parsed.getTime() - todayD.getTime()) / 86400000);
      if (delta > 180) key = toDateKey(year - 1, month, dayN);
      else if (delta < -180) key = toDateKey(year + 1, month, dayN);
    }
    return key || null;
  }
  if (opts.when) {
    const w = opts.when;
    return `${w.getUTCFullYear().toString().padStart(4, "0")}-${(w.getUTCMonth() + 1).toString().padStart(2, "0")}-${w.getUTCDate().toString().padStart(2, "0")}`;
  }
  return null;
}

export function isFplMail(text: string | null | undefined): boolean {
  const blob = normFplText(text);
  if (!blob) return false;
  if (RE_CREW.test(blob) && !RE_FPL.test(blob)) return false;
  if (RE_FPL.test(blob)) return true;
  return RE_UPDATE.test(blob) && parseFplVer(blob) > 0;
}

export function isUpdateFpl(text: string | null | undefined): boolean {
  const blob = normFplText(text);
  return RE_UPDATE.test(blob) && isFplMail(blob);
}

export function classifyAttachment(subject: string | null | undefined, name: string | null | undefined): "" | "fpl" | "crew" {
  const filename = name ?? "";
  if (!RE_XLSX.test(filename)) return "";
  const blob = normFplText(`${subject ?? ""} ${filename}`);
  const isFpl = RE_FPL.test(blob);
  const isCrew = RE_CREW.test(blob);
  if (isFpl && isCrew) {
    if (RE_FPL.test(filename) && !RE_CREW.test(filename)) return "fpl";
    if (RE_CREW.test(filename) && !RE_FPL.test(filename)) return "crew";
    return "fpl";
  }
  if (isFpl) return "fpl";
  if (isCrew) return "crew";
  if (RE_UPDATE.test(blob) && parseFplVer(blob) > 0) return "fpl";
  return "";
}

export function wantAttachment(subject: string | null | undefined, name: string | null | undefined): boolean {
  return classifyAttachment(subject, name) === "fpl";
}

export type FplHint = {
  mid: string;
  subject: string;
  when: Date | null;
  day: string | null;
  ver: number;
  update: boolean;
};

function msgWhen(msg: Record<string, unknown>): Date | null {
  const raw = (msg["ReceivedDateTime"] ?? msg["receivedDateTime"]) as string | undefined;
  if (!raw) return null;
  const d = new Date(String(raw).replace("Z", "+00:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fplHintFromMessage(
  msg: Record<string, unknown>,
  opts: { today?: string } = {},
): FplHint | null {
  const subject = String(msg["Subject"] ?? msg["subject"] ?? "");
  if (!isFplMail(subject)) return null;
  const mid = String(msg["Id"] ?? msg["id"] ?? "").trim();
  if (!mid) return null;
  const when = msgWhen(msg);
  const dayOpts: { when: string; today?: string } = { when };
  if (opts.today !== undefined) dayOpts.today = opts.today;
  return {
    mid,
    subject,
    when,
    day: parseFplDay(subject, dayOpts),
    ver: parseFplVer(subject),
    update: isUpdateFpl(subject),
  };
}

/** Chỉ FPL đúng ``wantDay``, VER cao xuống thấp, mỗi VER một thư. */
export function pickRankedFpl(hints: FplHint[], opts: { wantDay: string }): FplHint[] {
  const pool = hints.filter((h) => h.day === opts.wantDay);
  if (!pool.length) return [];
  const sorted = [...pool].sort((a, b) => {
    if (a.ver !== b.ver) return b.ver - a.ver;
    const au = a.update ? 1 : 0, bu = b.update ? 1 : 0;
    if (au !== bu) return bu - au;
    const at = a.when ? a.when.getTime() : 0, bt = b.when ? b.when.getTime() : 0;
    return bt - at;
  });
  const seenVer = new Set<number>();
  const ranked: FplHint[] = [];
  for (const h of sorted) {
    if (seenVer.has(h.ver)) continue;
    seenVer.add(h.ver);
    ranked.push(h);
  }
  return ranked;
}

export function pickLatestFpl(hints: FplHint[], opts: { wantDay: string }): FplHint | null {
  const ranked = pickRankedFpl(hints, opts);
  return ranked.length ? ranked[0]! : null;
}

export function pickPlainSameVer(hints: FplHint[], opts: { wantDay: string; ver: number }): FplHint | null {
  if (opts.ver <= 0) return null;
  const pool = hints.filter((h) => h.day === opts.wantDay && h.ver === opts.ver && !h.update);
  if (!pool.length) return null;
  return pool.reduce((best, h) => {
    const bt = best.when ? best.when.getTime() : 0, ht = h.when ? h.when.getTime() : 0;
    return ht > bt ? h : best;
  });
}

export function pickAdjacentPrev(ranked: FplHint[], latestVer: number): FplHint | null {
  if (latestVer <= 1) return null;
  const want = latestVer - 1;
  for (const h of ranked) if (h.ver === want) return h;
  for (const h of ranked) if (h.ver > 0 && h.ver < latestVer) return h;
  return null;
}
