// Port of notam_pin.py (pure logic; persistence wired in handlers/notam.server.ts).
export type PinItem = {
  ident: string;
  kind: string;
  code: string;
  text: string;
  e_field: string;
  head_vi: string;
  added_at: string;
  brief: string;
};
export type PinStore = { cloud: PinItem[]; flights: Record<string, PinItem[]> };

export const NOTAM_NIL = "NIL NOTAM";
export const NOTAM_NO_OPS = "NO OPERATIONALLY SIGNIFICANT NOTAMs";

export function isNotamPlaceholder(text: unknown): boolean {
  const blob = String(text ?? "").trim().replace(/\s+/g, " ").toUpperCase().replace(/NOTAMS/g, "NOTAM");
  return ["", "NO SIG", "NIL", "NIL NOTAM", "NO OPERATIONALLY SIGNIFICANT NOTAM"].includes(blob);
}

export const emptyStore = (): PinStore => ({ cloud: [], flights: {} });

export function callsignKey(raw: unknown): string {
  const blob = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!blob) return "";
  if (/^\d+$/.test(blob)) return "VJC" + blob;
  if (blob.startsWith("VJC")) return blob;
  if (blob.startsWith("VJ") && /^\d+$/.test(blob.slice(2))) return "VJC" + blob.slice(2);
  return blob;
}

export function parseCallsigns(text: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of String(text ?? "").match(/[A-Za-z]*\d{2,5}/g) ?? []) {
    const key = callsignKey(tok);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const IDENT_RE = /\b([A-Z]\d{3,5}\/\d{2})\b/;

export function briefLine(item: Partial<PinItem>): string {
  const ident = String(item.ident ?? "").trim();
  const vi = String(item.head_vi ?? "").trim().split(/\s+/).filter(Boolean).join(" ");
  if (vi) return `${ident} ${vi}`.trim();
  const text = String(item.text ?? (item as Record<string, unknown>).e_field ?? "").trim();
  let line = "";
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t || /^[QABCDFGH]\)/.test(t)) continue;
    line = t.replace(/\s+/g, " ");
    break;
  }
  if (!line) line = (text.split("\n")[0] ?? "").replace(/\s+/g, " ");
  if (ident && !line.includes(ident)) line = `${ident} ${line}`.trim();
  return line.slice(0, 180);
}

export function briefText(item: Partial<PinItem>): string {
  const text = String(item.text ?? "").trim();
  if (text) return text;
  const eField = String(item.e_field ?? "").trim();
  const ident = String(item.ident ?? "").trim();
  if (eField && ident && !eField.toUpperCase().includes(ident.toUpperCase())) return `${ident}\n${eField}`;
  return eField || briefLine(item);
}

export function itemFrom(payload: Record<string, unknown>, now: () => Date = () => new Date()): PinItem {
  let kind = String(payload.kind ?? "").trim().toUpperCase();
  kind = kind === "FIR" ? "FIR" : "APT";
  const code = String(payload.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ident = String(payload.ident ?? "").trim().toUpperCase();
  if (!ident) throw new Error("Thiếu số hiệu NOTAM.");
  if (!code) throw new Error("Thiếu mã sân / FIR của NOTAM.");
  const item: PinItem = {
    ident,
    kind,
    code,
    text: String(payload.text ?? "").trim(),
    e_field: String(payload.e_field ?? "").trim(),
    head_vi: String(payload.head_vi ?? "").trim(),
    added_at: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
    brief: "",
  };
  item.brief = briefLine(item);
  return item;
}

function same(a: PinItem, b: PinItem): boolean {
  return (
    String(a.ident).toUpperCase() === String(b.ident).toUpperCase() &&
    String(a.code).toUpperCase() === String(b.code).toUpperCase() &&
    String(a.kind).toUpperCase() === String(b.kind).toUpperCase()
  );
}

function upsert(rows: PinItem[], item: PinItem): PinItem[] {
  return [...rows.filter((x) => !same(x, item)), item];
}

export function addCloud(store: PinStore, payload: Record<string, unknown>): { ok: true; scope: "cloud"; item: PinItem; store: PinStore } {
  const item = itemFrom(payload);
  const next: PinStore = { cloud: upsert(store.cloud, item), flights: store.flights };
  return { ok: true, scope: "cloud", item, store: next };
}

export function addFlights(
  store: PinStore,
  payload: Record<string, unknown>,
  flights: string | string[],
): { ok: true; scope: "flight"; flights: string[]; item: PinItem; store: PinStore } {
  const item = itemFrom(payload);
  const keys = parseCallsigns(Array.isArray(flights) ? flights.join(" ") : flights);
  if (!keys.length) throw new Error("Gõ ít nhất một số hiệu chuyến, ví dụ 918 869.");
  const bag = { ...store.flights };
  for (const key of keys) bag[key] = upsert(bag[key] ?? [], item);
  return { ok: true, scope: "flight", flights: keys, item, store: { cloud: store.cloud, flights: bag } };
}

export function pinnedIdents(store: PinStore): Set<string> {
  const out = new Set<string>();
  for (const item of store.cloud) if (item.ident) out.add(item.ident.toUpperCase());
  for (const rows of Object.values(store.flights)) for (const item of rows) if (item.ident) out.add(item.ident.toUpperCase());
  return out;
}

function match(item: PinItem, ident: string, code: string, kind: string): boolean {
  if (String(item.ident).toUpperCase() !== ident) return false;
  if (code && String(item.code).toUpperCase() !== code.toUpperCase()) return false;
  if (kind && String(item.kind).toUpperCase() !== kind.toUpperCase()) return false;
  return true;
}

export function removeOne(
  store: PinStore,
  opts: { scope: string; ident: string; code?: string; kind?: string; flight?: string },
): { store: PinStore } {
  const want = String(opts.ident ?? "").trim().toUpperCase();
  if (!want) throw new Error("Thiếu số hiệu NOTAM.");
  const where = String(opts.scope ?? "").trim().toLowerCase();
  if (where === "cloud") {
    const before = store.cloud;
    const cloud = before.filter((x) => !match(x, want, opts.code ?? "", opts.kind ?? ""));
    if (cloud.length === before.length) throw new Error("Không thấy NOTAM cloud này.");
    return { store: { cloud, flights: store.flights } };
  }
  if (where === "flight") {
    const cs = callsignKey(opts.flight ?? "");
    if (!cs) throw new Error("Thiếu số hiệu chuyến.");
    const rows = store.flights[cs] ?? [];
    const kept = rows.filter((x) => !match(x, want, opts.code ?? "", opts.kind ?? ""));
    if (kept.length === rows.length) throw new Error("Không thấy NOTAM trên chuyến này.");
    const flights = { ...store.flights };
    if (kept.length) flights[cs] = kept;
    else delete flights[cs];
    return { store: { cloud: store.cloud, flights } };
  }
  throw new Error("Phạm vi không hợp lệ.");
}

export function clear(): { store: PinStore; idents: string[] } {
  return { store: emptyStore(), idents: [] };
}

export function snapshot(store: PinStore) {
  const slim = (rows: PinItem[]) => rows.map((x) => ({ ident: x.ident, kind: x.kind, code: x.code, brief: x.brief || briefLine(x), added_at: x.added_at || "" }));
  const flights: Record<string, ReturnType<typeof slim>> = {};
  for (const [k, v] of Object.entries(store.flights)) flights[k] = slim(v);
  return { cloud: slim(store.cloud), flights };
}

export function cellIndex(
  item: { kind?: string; code?: string },
  opts: { dep?: string; dest?: string; dest_alts?: string[]; enroute_alts?: string[]; firs?: string[]; force?: boolean } = {},
): number | null {
  const kind = String(item.kind ?? "").toUpperCase();
  const code = String(item.code ?? "").toUpperCase();
  const alts = (opts.dest_alts ?? []).filter(Boolean).map((x) => x.toUpperCase());
  const ralts = (opts.enroute_alts ?? []).filter(Boolean).map((x) => x.toUpperCase());
  const firSet = new Set((opts.firs ?? []).filter(Boolean).map((x) => x.toUpperCase()));
  if (kind === "FIR") {
    if (opts.force || firSet.has(code)) return 4;
    return null;
  }
  if (code && code === (opts.dep ?? "").toUpperCase()) return 0;
  if (code && code === (opts.dest ?? "").toUpperCase()) return 1;
  if (alts.includes(code)) return alts.length >= 2 && alts.indexOf(code) >= 1 ? 5 : 2;
  if (ralts.includes(code)) return 3;
  return opts.force ? 4 : null;
}

/** Preserve complete NOTAM blocks, replacing only an older copy of the same ident. */
export function joinNotam(cell: string, item: Partial<PinItem>): string {
  const add = briefText(item);
  if (!add) return isNotamPlaceholder(cell) ? "" : cell.trim();
  const ident = String(item.ident ?? "").trim().toUpperCase();
  const blocks = isNotamPlaceholder(cell) ? [] : cell.trim().split(/\n\s*\n/).flatMap((part) => {
    const lines = part.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.length > 1 && lines.every((line) => IDENT_RE.test(line) && line.length < 200)
      ? lines : [part.trim()];
  });
  const kept = ident ? blocks.filter((block) => !block.toUpperCase().includes(ident)) : blocks;
  if (!ident && kept.includes(add)) return kept.join("\n\n");
  return [...kept, add].join("\n\n");
}

export interface PinSheet {
  callsign: string;
  dep: string;
  dest: string;
  dest_alts: string[];
  enroute_alts: string[];
  notams: string[];
}

export interface SheetPinContext {
  firs?: string[];
  /** Missing/null means the portal has not been read successfully; never invent NIL. */
  counts?: Record<string, number | null>;
  /** Flight off-block/on-block in ms (UTC). Cloud NOTAMs are filtered against it ±2h. */
  flightWindow?: { from: number; to: number } | null;
}

export const CLOUD_BUFFER_MS = 2 * 3600 * 1000;

function nStamp(raw: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Parse D) into a predicate over UTC day (ms at 00Z) -> [startMin,endMin][] ; null = cannot read (keep NOTAM). */
function parseD(d: string): ((day: number) => [number, number][]) | null {
  const t = d.toUpperCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  const times = [...t.matchAll(/(\d{4})\s*-\s*(\d{4})/g)].map((m) => {
    const a = +m[1].slice(0, 2) * 60 + +m[1].slice(2), b = +m[2].slice(0, 2) * 60 + +m[2].slice(2);
    return [a, b] as [number, number];
  });
  if (!times.length) return t.includes("SR") || t.includes("SS") ? null : null;
  const head = t.slice(0, t.search(/\d{4}\s*-\s*\d{4}/)).trim();
  if (!head || /^DAILY|^H24/.test(head)) return () => times;
  const dows = [...head.matchAll(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/g)].map((m) => DAYS.indexOf(m[1]));
  if (dows.length && !/\d/.test(head)) {
    let set = new Set(dows);
    const r = /(SUN|MON|TUE|WED|THU|FRI|SAT)\s*-\s*(SUN|MON|TUE|WED|THU|FRI|SAT)/.exec(head);
    if (r) { set = new Set(); for (let i = DAYS.indexOf(r[1]); ; i = (i + 1) % 7) { set.add(i); if (i === DAYS.indexOf(r[2])) break; } }
    return (day) => (set.has(new Date(day).getUTCDay()) ? times : []);
  }
  // Date lists like "OCT 21 22 25-27" — only when month names are present.
  if (/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/.test(head)) {
    const allowed = new Set<string>();
    let mon = -1;
    for (const tok of head.match(/[A-Z]{3}|\d{1,2}\s*-\s*\d{1,2}|\d{1,2}/g) ?? []) {
      if (tok in MON) { mon = MON[tok]; continue; }
      if (mon < 0) continue;
      const [a, b] = tok.split("-").map((x) => +x.trim());
      for (let i = a; i <= (b ?? a); i++) allowed.add(`${mon}-${i}`);
    }
    return (day) => { const x = new Date(day); return allowed.has(`${x.getUTCMonth()}-${x.getUTCDate()}`) ? times : []; };
  }
  return null;
}

/** Cloud NOTAM applies when B)–C) and (if present) D) overlap the flight window ±2h. Unreadable = keep. */
export function cloudHitsFlight(text: string, win: { from: number; to: number } | null | undefined): boolean {
  if (!win || !Number.isFinite(win.from) || !Number.isFinite(win.to)) return true;
  const from = win.from - CLOUD_BUFFER_MS, to = win.to + CLOUD_BUFFER_MS;
  const up = String(text || "").toUpperCase();
  const b = /\bB\)\s*(\d{12})/.exec(up), c = /\bC\)\s*(\d{12})/.exec(up);
  const bs = b ? nStamp(b[1]) : null, cs = c ? nStamp(c[1]) : null;
  if (bs != null && bs > to) return false;
  if (cs != null && cs < from) return false;
  const dm = /(?:^|\n)\s*D\)\s*([^\n]*(?:\n(?!\s*[EFG]\))[^\n]*)*)/.exec(up);
  if (!dm) return true;
  const rule = parseD(dm[1]);
  if (!rule) return true;
  const lo = Math.max(from, bs ?? from), hi = Math.min(to, cs ?? to);
  for (let day = Math.floor(lo / 864e5) * 864e5 - 864e5; day <= hi; day += 864e5) {
    for (const [a, z] of rule(day)) {
      const s = day + a * 60000;
      const e = day + (z <= a ? z + 1440 : z) * 60000;
      if (s <= hi && e >= lo) return true;
    }
  }
  return false;
}

export function applyToSheet(sheet: PinSheet, store: PinStore, context: SheetPinContext = {}): string[] {
  const cells = Array.from({ length: 6 }, (_, i) => {
    const text = sheet.notams[i] ?? "";
    return text.toUpperCase().trim() === "NO SIG" ? "" : text;
  });
  const jobs: Array<[PinItem, boolean]> = [
    ...(store.cloud ?? [])
      .filter((item) => cloudHitsFlight(item.text || item.e_field, context.flightWindow))
      .map((item): [PinItem, boolean] => [item, false]),
    ...(store.flights?.[callsignKey(sheet.callsign)] ?? []).map((item): [PinItem, boolean] => [item, true]),
  ];
  for (const [item, force] of jobs) {
    const idx = cellIndex(item, { ...sheet, firs: context.firs ?? [], force });
    if (idx !== null) cells[idx] = joinNotam(cells[idx] ?? "", item);
  }
  const da = sheet.dest_alts.filter(Boolean);
  // Two destination alternates get separate cells (2 = first, 5 = the rest), same rules each.
  const locations = [[sheet.dep], [sheet.dest], da.length >= 2 ? [da[0]] : da, sheet.enroute_alts, context.firs ?? [], da.length >= 2 ? da.slice(1) : []];
  locations.forEach((codes, i) => {
    if (!isNotamPlaceholder(cells[i])) return;
    const present = codes.filter(Boolean);
    if (!present.length) return;
    const counts = present.map((code) => context.counts?.[`${i === 4 ? "FIR" : "A"}:${code}`] ?? null);
    if (counts.some((n) => n !== null && n > 0)) cells[i] = NOTAM_NO_OPS;
    else if (counts.every((n) => n !== null)) cells[i] = NOTAM_NIL;
  });
  sheet.notams = cells;
  return cells;
}
