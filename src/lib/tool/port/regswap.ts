// Port of api/regswap.py (plan_swap/apply_swap only — pure diff logic here;
// network calls are injected so this stays unit-testable without a server import).
import type { Flight } from "../core/models";
import { needsFor, type RuleRow, type Need } from "./notices";

export function normReg(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function regTail(v: unknown): string {
  const m = /(\d{3})\s*$/.exec(normReg(v));
  return m ? m[1]! : "";
}

export interface DelItem {
  id: number;
  filename: string;
  title: string;
  reason: string;
}
export interface AddItem {
  title: string;
  rule: string;
  found: boolean;
}
export interface SwapPlan {
  sector_id: number;
  callsign: string;
  route: string;
  old_reg: string;
  new_reg: string;
  fb_reg: string;
  new_actype: string;
  delete: DelItem[];
  add: AddItem[];
  keep: string[];
  missing: string[];
  note: string;
}

const DOC_LOOSE_MIN = 8;
const RE_EGTM_TAIL =
  /(?:low[\s_-]*egtm|egtm)[\s_-]*a[\s_-]*(\d{3})|a[\s_-]*(\d{3})[\s_-]*(?:low[\s_-]*egtm|egtm)/i;
const RE_A21N_NOTE = /tn[\s_-]*2025[\s_-]*0049/i;

function normDoc(name: string): string {
  const text = String(name ?? "").trim().replace(/\.pdf$/i, "");
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function stem(name: string): string {
  const n = String(name ?? "");
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(0, i) : n;
}

export interface LiveAttachmentRow {
  id?: number | string;
  title?: string;
  original_filename?: string;
  deleted_on?: unknown;
}

function attKeys(att: LiveAttachmentRow): Set<string> {
  const out = [normDoc(att.original_filename || ""), normDoc(att.title || ""), normDoc(stem(att.original_filename || ""))];
  return new Set(out.filter(Boolean));
}
function matchesGone(att: LiveAttachmentRow, goneKeys: Set<string>): boolean {
  const have = attKeys(att);
  for (const g of goneKeys) {
    if (!g) continue;
    if (have.has(g)) return true;
    if (g.length >= DOC_LOOSE_MIN && [...have].some((h) => h.includes(g))) return true;
  }
  return false;
}
function egtmTail(att: LiveAttachmentRow): string {
  for (const raw of [att.original_filename, att.title]) {
    const m = RE_EGTM_TAIL.exec(String(raw ?? ""));
    if (m) return m[1] || m[2] || "";
  }
  return "";
}
function isA21nNote(att: LiveAttachmentRow): boolean {
  return RE_A21N_NOTE.test(`${att.original_filename ?? ""} ${att.title ?? ""}`);
}
function isA21nTitle(title: string): boolean {
  return RE_A21N_NOTE.test(String(title ?? ""));
}
function regFileCode(name: string): string {
  // Minimal mirror of models/attachment.reg_file_code, only used to find the
  // "att.reg_code" equivalent for the cross-tail delete rule.
  const raw = String(name ?? "").trim();
  const re = /^(?:VN-?A|A)\s*(\d{3})\s*\.pdf$/i;
  let m = re.exec(raw);
  if (m) return m[1]!;
  let t = raw.replace(/^(?:[Z1-9]|AAA)\s+/i, "");
  let s2: string, ext: string;
  if (t.toLowerCase().endsWith(".pdf")) [s2, ext] = [t.slice(0, -4), t.slice(-4)];
  else [s2, ext] = [t, ".pdf"];
  s2 = s2.replace(/\s+(?:VER|REV)\s*\d+\s*$/i, "").trim();
  const bare = `${s2}${ext}`;
  m = re.exec(bare);
  if (m) return m[1]!;
  const compact = bare.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m2 = /^(?:VNA|A)(\d{3})PDF$/.exec(compact);
  return m2 ? m2[1]! : "";
}
function attRegCode(att: LiveAttachmentRow): string {
  for (const raw of [att.original_filename, att.title]) {
    const c = regFileCode(String(raw ?? ""));
    if (c) return c;
  }
  return "";
}

function titlesMap(needs: Need[]): Map<string, Need> {
  const m = new Map<string, Need>();
  for (const n of needs) m.set(n.title.trim().toLowerCase(), n);
  return m;
}

/** Minimal Flight-shaped overrides used to recompute notice needs for old/new reg+type. */
function withOverrides(f: Flight, over: { reg?: string; ac_type?: string; acft_type?: string }): Flight {
  return Object.assign(Object.create(Object.getPrototypeOf(f)), f, over) as Flight;
}

export interface PlanSwapOpts {
  oldReg?: string;
  /** Loại tàu mới đã tra sẵn (từ đội bay/chuyến khác), icao-normalised hoặc raw. */
  newActype?: string;
  ruleData: RuleRow[];
  /** Attachment thật đang có trên chuyến — đọc fresh từ FliteBrief (api/upload.list_attachments + gantts fallback). */
  liveAttachments: LiveAttachmentRow[];
  /** File cần thêm có sẵn trên đĩa/kho không — Worker không có đĩa cục bộ nên mặc định luôn false. */
  fileExists?: (title: string) => boolean;
  icaoAcType: (raw: string) => string;
}

export function planSwap(flight: Flight, newReg: string, opts: PlanSwapOpts): SwapPlan {
  const old = normReg(opts.oldReg || flight.reg);
  const neu = normReg(newReg);
  const plan: SwapPlan = {
    sector_id: flight.id,
    callsign: flight.callsign,
    route: flight.route,
    old_reg: old,
    new_reg: neu,
    fb_reg: normReg(flight.reg),
    new_actype: "",
    delete: [],
    add: [],
    keep: [],
    missing: [],
    note: "",
  };

  if (!neu) {
    plan.note = "không đọc được số hiệu tàu mới";
    return plan;
  }
  if (old === neu) {
    plan.note = `tàu cũ và tàu mới giống nhau (${neu}) — không có gì để đổi`;
    return plan;
  }

  let newType = opts.icaoAcType(opts.newActype || "");
  if (!newType && normReg(flight.reg) === neu) newType = opts.icaoAcType(flight.ac_type || flight.acft_type || "");
  plan.new_actype = newType;

  const fOld = normReg(flight.reg) === neu
    ? withOverrides(flight, { reg: old, ac_type: "", acft_type: "" })
    : withOverrides(flight, { reg: old });
  const fNew = withOverrides(flight, { reg: neu, ac_type: newType, acft_type: newType });

  const fileExists = opts.fileExists ?? (() => false);
  const tOld = titlesMap(needsFor(fOld, opts.ruleData, fileExists).needs);
  const tNew = titlesMap(needsFor(fNew, opts.ruleData, fileExists).needs);

  const gone = [...tOld.keys()].filter((k) => !tNew.has(k));
  const goneKeys = new Set<string>();
  for (const k of gone) {
    goneKeys.add(normDoc(tOld.get(k)!.title));
    goneKeys.add(normDoc(k));
  }
  plan.keep = [...tNew.keys()].filter((k) => tOld.has(k)).map((k) => tNew.get(k)!.title).sort();
  plan.add = [...tNew.entries()].filter(([k]) => !tOld.has(k)).map(([, n]) => ({ title: n.title, rule: n.rule, found: n.found }));

  const newTail = regTail(neu);
  const queued = new Set<number>();
  let keptA21n = false;
  for (const d of opts.liveAttachments) {
    if (d.deleted_on) continue;
    const id = Number(d.id) || 0;
    if (!id || queued.has(id)) continue;
    const queue = (reason: string) => {
      plan.delete.push({ id, filename: d.original_filename || "", title: d.title || "", reason });
      queued.add(id);
    };

    const code = attRegCode(d);
    if (code && newTail && code !== newTail) {
      queue(`file tàu ${code}, không phải tàu mới ${newTail}`);
      continue;
    }
    const egtm = egtmTail(d);
    if (egtm && newTail && egtm !== newTail) {
      queue(`LOW EGTM tàu ${egtm}, không phải tàu mới ${newTail}`);
      continue;
    }
    if (isA21nNote(d)) {
      if (newType === "A21N" || !newType) {
        keptA21n = true;
        continue;
      }
      queue("TN-2025-0049 đi cùng tàu / loại A21N");
      continue;
    }
    if (matchesGone(d, goneKeys)) queue(`đi kèm tàu cũ ${old}`);
  }

  if (keptA21n) {
    plan.add = plan.add.filter((a) => !isA21nTitle(a.title));
    if (!plan.keep.some((k) => isA21nTitle(k))) plan.keep.push("TN-2025-0049");
  }
  plan.missing = plan.add.filter((a) => !a.found).map((a) => a.title);
  return plan;
}

export interface SwapResult {
  deleted: number;
  added: number;
  skipped: number;
  failed: number;
}

export interface ApplySwapOps {
  deleteAttachment: (sectorId: number, id: number) => Promise<boolean>;
  /** Trả về {ok, alreadyExists}; found=false (không có file trên đĩa) không được gọi. */
  uploadAttachment: (title: string) => Promise<{ ok: boolean; alreadyExists: boolean; error?: string }>;
  onLine?: (text: string, cls?: string) => void;
  cancelled?: () => boolean;
}

export async function applySwap(plan: SwapPlan, ops: ApplySwapOps): Promise<SwapResult> {
  const res: SwapResult = { deleted: 0, added: 0, skipped: 0, failed: 0 };
  const say = (text: string, cls = "") => ops.onLine?.(text, cls);
  const stop = () => !!ops.cancelled?.();

  for (const d of plan.delete) {
    if (stop()) {
      say("— đã dừng —", "sys");
      return res;
    }
    let ok = false;
    try {
      ok = await ops.deleteAttachment(plan.sector_id, d.id);
    } catch (exc) {
      say(`✗ xoá ${d.filename}: ${(exc as Error).message || exc}`, "bad");
    }
    if (ok) {
      res.deleted += 1;
      say(`✓ đã xoá ${d.filename}  (${d.reason})`);
    } else if (!stop()) {
      res.failed += 1;
      say(`✗ không xoá được ${d.filename}`, "bad");
    }
  }

  for (const a of plan.add) {
    if (stop()) {
      say("— đã dừng —", "sys");
      return res;
    }
    if (!a.found) {
      res.failed += 1;
      say(`! thiếu file "${a.title}" trên đĩa — chưa đính kèm được`, "bad");
      continue;
    }
    const r = await ops.uploadAttachment(a.title);
    if (r.ok) {
      res.added += 1;
      say(`✓ đã thêm ${a.title}  (${a.rule})`);
    } else if (r.alreadyExists) {
      res.skipped += 1;
      say(`· ${a.title}: chuyến đã có file này`);
    } else {
      res.failed += 1;
      say(`✗ thêm ${a.title}: ${r.error ?? ""}`, "bad");
    }
  }
  return res;
}
