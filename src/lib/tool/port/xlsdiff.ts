// Port of xlsdiff.py — compare two flight-plan Excel versions (reg/crew/delay).
import type { Sheet } from "./excelcmp_reader";
import { readTable } from "./excelcmp_reader";
import {
  callsignKeys,
  detectMapping,
  dhdIds,
  mergeRows,
  normDate,
  normTime,
  staffIds,
} from "./excelcmp_compare";

export type HM = { h: number; m: number };

function hmEq(a: HM | null, b: HM | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.h === b.h && a.m === b.m;
}
function fmtHm(t: HM | null): string {
  return t ? `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}` : "";
}

export interface Leg {
  rowNo: number;
  flt: string;
  digits: string;
  dep: string;
  arr: string;
  day: Date | null;
  std: HM | null;
  etd: HM | null;
  reg: string;
  crewRaw: string;
  crew: Set<string>;
  dhd: Set<string>;
}

export function legKey(l: Leg): string {
  return `${l.digits}|${l.dep}|${l.arr}`;
}

/** Local datetime (ms since epoch, synthetic) combining day + std (or 00:00). */
export function legWhen(l: Leg): number | null {
  if (!l.day) return null;
  const t = l.std || { h: 0, m: 0 };
  return Date.UTC(l.day.getUTCFullYear(), l.day.getUTCMonth(), l.day.getUTCDate(), t.h, t.m);
}

function stamp(l: Leg, t: HM | null): number | null {
  if (t == null) return null;
  const d = l.day || new Date(Date.UTC(2000, 0, 1));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), t.h, t.m);
}

function wrapMin(a: number, b: number): number {
  const m = Math.round((b - a) / 60000);
  return m - Math.round(m / 1440) * 1440;
}

const RE_NOT_ALNUM = /[^A-Z0-9]/g;
function normReg(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(RE_NOT_ALNUM, "");
}

export interface Change {
  flt: string;
  dep: string;
  arr: string;
  old: Leg | null;
  new: Leg | null;
}

export function regChanged(c: Change): boolean {
  if (!c.old || !c.new) return false;
  return normReg(c.old.reg) !== normReg(c.new.reg);
}

export function crewChanged(c: Change): boolean {
  if (!c.old || !c.new) return false;
  if (c.old.crew.size !== c.new.crew.size) return true;
  for (const x of c.old.crew) if (!c.new.crew.has(x)) return true;
  return false;
}

export function crewIn(c: Change): string[] {
  if (!c.old || !c.new) return [];
  return [...c.new.crew].filter((x) => !c.old!.crew.has(x)).sort();
}
export function crewOut(c: Change): string[] {
  if (!c.old || !c.new) return [];
  return [...c.old.crew].filter((x) => !c.new!.crew.has(x)).sort();
}

export function delayKind(c: Change): "" | "first" | "retime" {
  if (!c.old || !c.new) return "";
  if (c.new.etd == null) return "";
  if (c.old.etd == null) return "first";
  if (hmEq(c.old.etd, c.new.etd)) return "";
  return "retime";
}

export function delayMin(c: Change): number | null {
  const kind = delayKind(c);
  if (!kind || !c.old || !c.new) return null;
  let a: number | null, b: number | null;
  if (kind === "first") {
    a = stamp(c.new, c.new.std) ?? stamp(c.old, c.old.std);
    b = stamp(c.new, c.new.etd);
  } else {
    a = stamp(c.old, c.old.etd);
    b = stamp(c.new, c.new.etd);
  }
  if (a == null || b == null) return null;
  return wrapMin(a, b);
}

export function changeChanged(c: Change): boolean {
  return !!(regChanged(c) || crewChanged(c) || (delayMin(c) || 0));
}

export function changeStatus(c: Change): string {
  if (c.old == null) return "mới thêm";
  if (c.new == null) return "đã bỏ";
  return changeChanged(c) ? "thay đổi" : "y nguyên";
}

export interface DiffResult {
  oldFile: string;
  newFile: string;
  changes: Change[];
  oldLegs: number;
  newLegs: number;
  oldDays: string[];
  newDays: string[];
  warn: string;
}

export function changedList(res: DiffResult): Change[] {
  return res.changes.filter((c) => c.old && c.new && changeChanged(c));
}
export function addedList(res: DiffResult): Change[] {
  return res.changes.filter((c) => c.old == null);
}
export function removedList(res: DiffResult): Change[] {
  return res.changes.filter((c) => c.new == null);
}
export function nReg(res: DiffResult): number {
  return changedList(res).filter(regChanged).length;
}
export function nCrew(res: DiffResult): number {
  return changedList(res).filter(crewChanged).length;
}
export function nDelay(res: DiffResult): number {
  return changedList(res).filter((c) => delayMin(c)).length;
}

export async function readLegs(filename: string, buf: ArrayBuffer, sheetName = ""): Promise<Leg[]> {
  const sheets = await readTable(filename, buf);
  const sheet: Sheet =
    sheets.find((s) => s.name === sheetName) ??
    sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
  const mp = detectMapping(sheet.header);
  if (!mp["callsign"]) throw new Error(`${filename}: không tìm ra cột số hiệu chuyến bay`);

  const out: Leg[] = [];
  for (const [rowNo, r] of mergeRows(sheet, mp)) {
    const rawCs = r[mp["callsign"]!];
    const keys = callsignKeys(rawCs);
    if (!keys.size) continue;
    const digits = String(rawCs ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) continue;
    const crewRaw = mp["crew"] ? String(r[mp["crew"]!] ?? "") : "";
    out.push({
      rowNo,
      flt: String(rawCs ?? "").trim(),
      digits,
      dep: mp["dep"] ? String(r[mp["dep"]!] ?? "").trim().toUpperCase() : "",
      arr: mp["dest"] ? String(r[mp["dest"]!] ?? "").trim().toUpperCase() : "",
      day: mp["date"] ? normDate(r[mp["date"]!]) : null,
      std: mp["std"] ? normTime(r[mp["std"]!]) : null,
      etd: mp["etd"] ? normTime(r[mp["etd"]!]) : null,
      reg: mp["reg"] ? String(r[mp["reg"]!] ?? "").trim() : "",
      crewRaw,
      crew: staffIds(crewRaw),
      dhd: dhdIds(crewRaw),
    });
  }
  return out;
}

export function pair(olds: Leg[], news: Leg[]): Array<[Leg | null, Leg | null]> {
  if (olds.length === 1 && news.length === 1) return [[olds[0]!, news[0]!]];

  const free = [...news];
  const pairs: Array<[Leg | null, Leg | null]> = [];
  const sortedOlds = [...olds].sort((a, b) => {
    const wa = legWhen(a), wb = legWhen(b);
    return (wa ?? Infinity) - (wb ?? Infinity);
  });
  for (const o of sortedOlds) {
    if (!free.length) {
      pairs.push([o, null]);
      continue;
    }
    const ow = legWhen(o);
    if (ow == null) {
      pairs.push([o, free.shift()!]);
      continue;
    }
    let bestIdx = 0;
    let bestGap = Infinity;
    free.forEach((n, i) => {
      const nw = legWhen(n);
      const gap = nw != null ? Math.abs(nw - ow) : 1e9;
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    });
    pairs.push([o, free.splice(bestIdx, 1)[0]!]);
  }
  for (const n of free) pairs.push([null, n]);
  return pairs;
}

export async function diff(
  oldName: string,
  oldBuf: ArrayBuffer,
  newName: string,
  newBuf: ArrayBuffer,
): Promise<DiffResult> {
  const olds = await readLegs(oldName, oldBuf);
  const news = await readLegs(newName, newBuf);

  const byOld = new Map<string, Leg[]>();
  const byNew = new Map<string, Leg[]>();
  for (const x of olds) {
    const k = legKey(x);
    (byOld.get(k) ?? byOld.set(k, []).get(k)!).push(x);
  }
  for (const x of news) {
    const k = legKey(x);
    (byNew.get(k) ?? byNew.set(k, []).get(k)!).push(x);
  }

  const res: DiffResult = {
    oldFile: oldName,
    newFile: newName,
    changes: [],
    oldLegs: olds.length,
    newLegs: news.length,
    oldDays: [],
    newDays: [],
    warn: "",
  };

  const daysOf = (legs: Leg[]): string[] => {
    const c = new Map<string, number>();
    for (const x of legs) {
      if (x.day) {
        const key = x.day.toISOString().slice(0, 10);
        c.set(key, (c.get(key) || 0) + 1);
      }
    }
    return [...c.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => {
        const d = new Date(k);
        return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      });
  };
  res.oldDays = daysOf(olds);
  res.newDays = daysOf(news);
  if (res.oldDays.length && res.newDays.length && res.oldDays[0] !== res.newDays[0]) {
    res.warn =
      `Hai bản KHÔNG cùng ngày: bản cũ chủ yếu ${res.oldDays[0]}, bản mới ${res.newDays[0]}. ` +
      "Công cụ này để so hai phiên bản của CÙNG một ngày — so khác ngày thì gần như chuyến nào cũng bị coi là đổi tàu / đổi crew.";
  }

  const keys = new Set<string>([...byOld.keys(), ...byNew.keys()]);
  for (const key of [...keys].sort()) {
    for (const [o, n] of pair(byOld.get(key) ?? [], byNew.get(key) ?? [])) {
      const ref = n || o;
      if (!ref) continue;
      res.changes.push({ flt: ref.flt, dep: ref.dep, arr: ref.arr, old: o, new: n });
    }
  }
  return res;
}

// ---------------- atc_chg.kind/label (minimal port, only what xlsdiff needs) ----------------
export function atcChgKind(opts: { regChanged: boolean; delayChanged: boolean }): string {
  if (opts.regChanged && opts.delayChanged) return "CHG DLA";
  if (opts.regChanged) return "CHG";
  if (opts.delayChanged) return "DLA";
  return "";
}
export function atcChgLabel(code: string): string {
  return String(code || "").trim();
}

export function rowsForUi(res: DiffResult, all = false): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const list = all ? res.changes.filter((c) => c.old && c.new) : changedList(res);
  for (const c of list) {
    const o = c.old!, n = c.new!;
    const d = delayMin(c) || 0;
    const atcKind = atcChgKind({ regChanged: regChanged(c), delayChanged: !!d });
    out.push({
      flt: c.flt,
      route: `${c.dep}-${c.arr}`,
      std_old: fmtHm(o.std),
      std_new: fmtHm(n.std),
      day_new: n.day ? `${String(n.day.getUTCDate()).padStart(2, "0")}/${String(n.day.getUTCMonth() + 1).padStart(2, "0")}` : "",
      when_new: legWhen(n) != null ? new Date(legWhen(n)!).toISOString() : "",
      when_old: legWhen(o) != null ? new Date(legWhen(o)!).toISOString() : "",
      reg: { changed: regChanged(c), old: o.reg || "—", new: n.reg || "—" },
      crew: {
        changed: crewChanged(c),
        out: crewOut(c),
        in: crewIn(c),
        n: Math.max(crewOut(c).length, crewIn(c).length),
        dhd: [...new Set([...o.dhd, ...n.dhd])].sort(),
        raw_old: o.crewRaw.trim(),
        raw_new: n.crewRaw.trim(),
      },
      delay: { min: d, changed: !!d, from: fmtHm(o.etd), to: fmtHm(n.etd), kind: delayKind(c) },
      atc: { kind: atcKind, label: atcChgLabel(atcKind) },
    });
  }
  out.sort((a, b) => {
    const da = Math.abs((a["delay"] as { min: number }).min);
    const db = Math.abs((b["delay"] as { min: number }).min);
    if (da !== db) return db - da;
    const ra = (a["reg"] as { changed: boolean }).changed ? 0 : 1;
    const rb = (b["reg"] as { changed: boolean }).changed ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const ca = (a["crew"] as { changed: boolean }).changed ? 0 : 1;
    const cb = (b["crew"] as { changed: boolean }).changed ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return String(a["flt"]).localeCompare(String(b["flt"]));
  });
  return out;
}

export interface ExcelFileInfo {
  name: string;
  size: number;
  modified: number;
}
/** Port of xlsdiff.list_files — caller supplies the already-loaded file listing. */
export function listFiles(files: ExcelFileInfo[]): ExcelFileInfo[] {
  return files
    .filter((f) => !f.name.startsWith("~$") && !f.name.startsWith("_crewprev_"))
    .sort((a, b) => b.modified - a.modified);
}
