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
}

export function applyToSheet(sheet: PinSheet, store: PinStore, context: SheetPinContext = {}): string[] {
  const cells = Array.from({ length: 6 }, (_, i) => {
    const text = sheet.notams[i] ?? "";
    return text.toUpperCase().trim() === "NO SIG" ? "" : text;
  });
  const jobs: Array<[PinItem, boolean]> = [
    ...(store.cloud ?? []).map((item): [PinItem, boolean] => [item, false]),
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
