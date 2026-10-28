// Port of web.py attch_check / _norm_doc_name / _tn_acft_code and the minimal
// notice-rule matching it needs from notices.py (needs_for). The notices group
// owns a full notices.ts; until it exists we keep a small self-contained
// matcher here, limited to the default rule set.
import type { Flight } from "../core/models";

const DOC_LOOSE_MIN = 8;

export function normDocName(name: string): string {
  const text = String(name || "").trim().replace(/\.pdf$/i, "");
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function tnAcftCode(name: string): string {
  const key = normDocName(name);
  if (!key.includes("tn")) return "";
  const m = /a(\d{3})/.exec(key);
  return m ? m[1]! : "";
}

export function tnAcftMatchName(title: string, names: Iterable<string>): string {
  const want = tnAcftCode(title);
  if (!want) return "";
  for (const name of names) if (tnAcftCode(name) === want) return name;
  return "";
}

function attachedDocNames(f: Flight): Set<string> {
  const out = new Set<string>();
  for (const a of f.attachments) {
    if (a.is_deleted) continue;
    for (const raw of [a.original_filename, a.title]) {
      const key = normDocName(raw);
      if (key) out.add(key);
    }
  }
  return out;
}

export function docAttached(title: string, have: Set<string>): boolean {
  const key = normDocName(title);
  if (!key) return false;
  if (have.has(key)) return true;
  return key.length >= DOC_LOOSE_MIN && [...have].some((n) => n.includes(key));
}

function sim(a: string, b: string): number {
  // Python difflib.SequenceMatcher.ratio() approximation via LCS-based ratio.
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  const lcs = dp[m]![n]!;
  return (2 * lcs) / (m + n);
}

export function nearDocName(title: string, names: string[]): string {
  const key = normDocName(title);
  if (!key) return "";
  let best = "", score = 0;
  for (const name of names) {
    const ratio = sim(key, normDocName(name));
    if (ratio > score) {
      best = name;
      score = ratio;
    }
  }
  return score >= 0.62 ? best : "";
}

// ---------------- notices.py (minimal, default rules only) ----------------
export const TAU_LIST = new Set([
  "VNA522", "VNA631", "VNA637", "VNA651", "VNA643", "VNA642", "VNA639",
  "VNA635", "VNA632", "VNA641", "VNA649", "VNA657", "VNA634", "VNA687",
  "VNA698",
]);
const CHINA_PREFIX = new Set(["ZY", "ZP", "ZU", "ZL", "ZG", "ZB", "ZS", "ZH"]);

const dep = (f: Flight) => (f.dep_icao || "").toUpperCase();
const dest = (f: Flight) => (f.dest_icao || "").toUpperCase();
const regOf = (f: Flight) => (f.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function icaoAcType(raw: string): string {
  const t = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return "";
  if (["A21N", "321N", "A321N", "A321NEO"].includes(t) || (t.includes("NEO") && t.includes("321"))) return "A21N";
  if (["A20N", "320N", "A320N", "A320NEO"].includes(t) || (t.includes("NEO") && t.includes("320"))) return "A20N";
  if (["A321", "321", "A321CEO"].includes(t)) return "A321";
  if (["A320", "320"].includes(t)) return "A320";
  return t;
}
const actypeOf = (f: Flight) => icaoAcType(f.ac_type || f.acft_type || "");

export interface RuleRow {
  name: string;
  condition: string;
  values?: string[];
  files: string[];
  effective_from?: string;
  effective_to?: string;
  enabled?: boolean;
}

export function defaultRuleData(): RuleRow[] {
  return [
    { name: "Notice chung cho mọi chuyến", condition: "always", values: [], files: ["NOTICES TO PILOTS | NOTICES AND SAFETY DIRECTIVE | NOTICE TO PILOT | NTP & TECHNICAL NOTE | NTP"], enabled: true },
    { name: "Notice riêng của tàu bay", condition: "has_reg", values: [], files: ["{REG}"], enabled: true },
    { name: "Đến VVDB", condition: "dest", values: ["VVDB"], files: ["Technical Notice VVDB"], enabled: true },
    { name: "Từ WADD về VVNB", condition: "route", values: ["WADD", "VVNB"], files: ["TN-20022025 - AIRWAYS W27, W28 and Q9_1"], enabled: true },
    { name: "Tàu trong danh sách EGTM thấp", condition: "reg_in", values: [...TAU_LIST].sort(), files: ["TN-LOW EGTM A{REG3}"], enabled: true },
    { name: "Đi/đến WMKK", condition: "touches", values: ["WMKK"], files: ["FAOC_1.20 AA 2025 (R)", "FAOC.20 VIETJET AVIATION JOINT STOCK COMPANY 2025 (R)"], enabled: true },
    { name: "Đi/đến VVPQ", condition: "touches", values: ["VVPQ"], files: ["vv-esup-31-26-approvedbycaav"], enabled: true },
    { name: "Đi/đến Trung Quốc / VMMC / VHHH", condition: "prefix_or_touches", values: [...CHINA_PREFIX].sort().concat(["VMMC", "VHHH"]), files: ["2026005函 关于汛期运行安全风险的警示"], enabled: true },
    { name: "Đi/đến VMMC", condition: "touches", values: ["VMMC"], files: ["NTP 2026-013 VMMCMFM LOC RWY16 (No LOC signal)"], enabled: true },
    { name: "Đi/đến VVCA", condition: "touches", values: ["VVCA"], files: ["NTP 2026-014 Runway Overrun Mitigation", "NTP 2026-015 VVCA (Chu Lai Airport) Runway Shortening"], enabled: true },
    { name: "Đi/đến VOBL", condition: "touches", values: ["VOBL"], files: ["ZSPD_NavData_Alert_2606"], enabled: true },
    { name: "Đi/đến VVNB", condition: "touches", values: ["VVNB"], files: ["VVNB vv-esup-19-26-approvedbycaav"], enabled: false },
    { name: "Đi/đến WSSS", condition: "touches", values: ["WSSS"], files: ["SG-AD-2-WSSS-AD-2-WSSS-ADC-3", "WSSS_Chart_Alert_26_MAR_2026"], enabled: false },
    { name: "Đi/đến/alternate ZSPD", condition: "touches_or_alt", values: ["ZSPD"], files: ["ZSPD_Chart_Alert_26_MAR_2026"], enabled: false },
  ];
}

function matchesData(row: RuleRow, f: Flight): boolean {
  const vals = new Set((row.values ?? []).map((x) => x.toUpperCase()));
  const ordered = (row.values ?? []).map((x) => x.toUpperCase());
  const d = dep(f), de = dest(f), reg = regOf(f), actype = actypeOf(f);
  switch (row.condition) {
    case "always":
      return true;
    case "has_reg":
      return !!reg;
    case "dep":
      return vals.has(d);
    case "dest":
      return vals.has(de);
    case "touches":
      return vals.has(d) || vals.has(de);
    case "route":
      return ordered.length >= 2 && d === ordered[0] && de === ordered[1];
    case "ac_type":
      return [...vals].some((v) => actype && icaoAcType(v) === actype);
    case "reg_in":
      return vals.has(reg);
    case "prefix_or_touches":
      return vals.has(d) || vals.has(de) || [...vals].some((v) => v.length === 2 && (d.startsWith(v) || de.startsWith(v)));
    case "touches_or_alt":
      return vals.has(d) || vals.has(de) || vals.has((f.dest_alt1 || "").toUpperCase()) || vals.has((f.dest_alt2 || "").toUpperCase());
    default:
      return false;
  }
}

function activeToday(row: RuleRow): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (!row.effective_from || today >= row.effective_from) && (!row.effective_to || today <= row.effective_to);
}

function splitAlt(raw: string): [string, string[]] {
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.length ? [parts[0]!, parts.slice(1)] : ["", []];
}

export interface Need {
  title: string;
  rule: string;
  path: boolean;
  alt: string[];
  cond: string;
}

export function needsFor(flight: Flight, ruleData: RuleRow[]): Need[] {
  const out: Need[] = [];
  const reg = regOf(flight);
  const seen = new Set<string>();
  for (const row of ruleData) {
    if (!(row.enabled ?? true) || !activeToday(row)) continue;
    let matched: boolean;
    try {
      matched = matchesData(row, flight);
    } catch {
      continue;
    }
    if (!matched) continue;
    for (const raw of row.files) {
      const title = raw.replace("{REG}", reg).replace("{REG3}", reg.slice(-3));
      const [t, alt] = splitAlt(title);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      // No disk/bucket index wired up yet — treat every notice as "not found on disk".
      out.push({ title: t, rule: row.name, path: false, alt, cond: row.condition });
    }
  }
  return out;
}

// ---------------- web.py attch_context / attch_check ----------------
const ATTCH_CONDS = new Set(["always", "has_reg", "reg_in", "ac_type"]);

export interface AttchCtx {
  brief_disk: Set<string>;
  rule_data: RuleRow[];
}

export function attchContext(): AttchCtx {
  // briefing.list_files() (brief_disk) needs the PC's local folder — not
  // available in a Worker, so briefing-on-disk is always empty here.
  return { brief_disk: new Set(), rule_data: defaultRuleData() };
}

export interface AttchItem {
  what: string;
  rule: string;
  kind: string;
  state: "ok" | "miss" | "wrong";
  on_disk: boolean | null;
  note?: string;
  near?: string;
}

export interface AttchResult {
  need: number;
  items: AttchItem[];
  miss_n: number;
  wrong_n: number;
  reg_file: { file: string; same: boolean | null };
}

function briefCallsign(filename: string): string {
  // models: brief filename starts with callsign e.g. "VJC147_Briefing.pdf".
  // Must contain "brief" — OFP releases ("VJC1373-VVCA-VVTS-...") also start
  // with the callsign and must not count as a briefing.
  const s = String(filename || "").trim();
  if (!/brief/i.test(s)) return "";
  const m = /^([A-Z0-9]+)[ _-]/i.exec(s);
  return m ? m[1]!.toUpperCase() : "";
}

export function attchCheck(f: Flight, ctx: AttchCtx = attchContext()): AttchResult {
  const have = attachedDocNames(f);
  const onSector = f.attachments.filter((a) => !a.is_deleted).map((a) => a.title || a.original_filename);
  const atchNames = f.attachments
    .filter((a) => !a.is_deleted)
    .flatMap((a) => [a.original_filename, a.title].filter(Boolean));
  const items: AttchItem[] = [];

  const take = (what: string, rule: string, kind: string, state: "ok" | "miss" | "wrong", onDisk: boolean | null, note = "") => {
    const item: AttchItem = { what, rule, kind, state, on_disk: onDisk };
    if (note) item.note = note;
    if (state === "miss" && kind !== "briefing") {
      const near = nearDocName(what, onSector);
      if (near) item.near = near;
    }
    items.push(item);
  };

  const regFile = { file: f.reg_attachment ? f.reg_attachment.original_filename : "", same: f.reg_atch_match };

  if (!f.reg) take("Số hiệu tàu", "FliteBrief chưa gán tàu cho chuyến", "reg", "miss", null);

  const regKey = normDocName(f.reg);
  for (const n of needsFor(f, ctx.rule_data)) {
    if (n.cond && !ATTCH_CONDS.has(n.cond)) continue;
    const isRegFile = !!regKey && normDocName(n.title) === regKey;
    const kind = isRegFile ? "reg" : n.cond === "always" ? "notice" : "acft";
    let done = docAttached(n.title, have) || n.alt.some((a) => docAttached(a, have));
    if (isRegFile && f.reg_atch_match === true) done = true;
    if (isRegFile && f.reg_atch_match === false) {
      take(n.title, n.rule, kind, "wrong", n.path, `đang đính kèm ${regFile.file} — không phải tàu ${f.reg || "—"}`);
      continue;
    }
    let alike = "";
    if (!done) {
      for (const cand of [n.title, ...n.alt]) {
        alike = tnAcftMatchName(cand, atchNames);
        if (alike) {
          done = true;
          break;
        }
      }
    }
    take(n.title, n.rule, kind, done ? "ok" : "miss", n.path, alike ? `giống ${alike}` : "");
  }

  const cs = f.callsign.toUpperCase();
  const onFb = f.attachments.some(
    (a) => !a.is_deleted && (briefCallsign(a.original_filename) === cs || briefCallsign(a.title) === cs),
  );
  take(`${f.callsign} Briefing`, "Briefing của chuyến", "briefing", onFb ? "ok" : "miss", ctx.brief_disk.has(cs));

  return {
    need: items.length,
    items,
    miss_n: items.filter((x) => x.state === "miss").length,
    wrong_n: items.filter((x) => x.state === "wrong").length,
    reg_file: regFile,
  };
}
