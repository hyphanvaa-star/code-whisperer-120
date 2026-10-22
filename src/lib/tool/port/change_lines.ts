// Browser-safe: turns saved settings into readable item lines and diffs them (added/removed only).
const SECRET_RE = /pass|token|secret|cookie|session|pwd/i;
export const GROUP_VI: Record<string, string> = {
  curfew: "Giờ cấm bay (curfew)", special: "Giới hạn đặc biệt", aircraft: "Giới hạn theo tàu",
  airports: "Giới hạn sân bay", acgroups: "Nhóm tàu", defects: "Lỗi kỹ thuật",
};
const FIELD_VI: Record<string, string> = {
  code: "Sân", reg: "Tàu", defect: "Lỗi", limit: "Giới hạn", start: "Từ", end: "Đến", type: "Loại",
  note: "Ghi chú", rule: "Quy tắc", acs: "Tàu", apts: "Sân", text: "Nội dung", id: "Mã",
};
export function cell(x: unknown): string {
  if (x == null || x === "") return "";
  if (typeof x !== "object") return String(x);
  if (Array.isArray(x)) return x.map(cell).filter(Boolean).join(", ");
  const o = x as Record<string, unknown>;
  if (o.start != null && o.end != null && o.code) return `${o.code}: cấm ${o.start} – ${o.end}`;
  return Object.entries(o)
    .filter(([k, val]) => !SECRET_RE.test(k) && val !== "" && val != null && !/^(_|at$|ts$|updated)/.test(k))
    .map(([k, val]) => `${FIELD_VI[k] ?? k}: ${typeof val === "object" ? cell(val) : String(val)}`)
    .join(" | ");
}
/** One line per saved item, prefixed with its section name. */
export function itemLines(v: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) v.forEach((it) => out.push(cell(it)));
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_RE.test(k) || k.startsWith("__")) continue;
      const g = GROUP_VI[k] ?? FIELD_VI[k] ?? k;
      if (Array.isArray(val)) val.forEach((it) => out.push(`${g} › ${cell(it)}`));
      else out.push(`${g}: ${cell(val)}`);
    }
  } else out.push(cell(v));
  return out.filter(Boolean);
}
/** Only what was added or removed between two saved versions (a changed item shows as removed old + added new). */
export function diffLines(prev: unknown, next: unknown): { added: string[]; removed: string[] } {
  const count = (a: string[]) => { const m = new Map<string, number>(); a.forEach((s) => m.set(s, (m.get(s) ?? 0) + 1)); return m; };
  const p = count(itemLines(prev)), n = count(itemLines(next));
  const added: string[] = [], removed: string[] = [];
  n.forEach((c, s) => { for (let i = p.get(s) ?? 0; i < c; i++) added.push(s); });
  p.forEach((c, s) => { for (let i = n.get(s) ?? 0; i < c; i++) removed.push(s); });
  return { added, removed };
}
