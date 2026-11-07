// Port of notices.py — notice rules + Attch check (client-safe, pure logic).
import type { Flight } from "./flight-model";
import { NOTICE_RULES_DEFAULT, prefixTouchesAlt } from "./tool/port/notice_rules_default";

export type RuleCond =
  | "always" | "has_reg" | "dep" | "dest" | "touches" | "route"
  | "ac_type" | "reg_in" | "prefix_or_touches" | "touches_or_alt" | "prefix_touches_alt";

export type NoticeRule = {
  name: string;
  condition: RuleCond;
  values: string[];
  files: string[];
  enabled: boolean;
  effective_from?: string;
  effective_to?: string;
};

export const COND_LABEL: Record<RuleCond, string> = {
  always: "Mọi chuyến",
  has_reg: "Có số đăng ký tàu",
  dep: "Đi từ sân bay",
  dest: "Đến sân bay",
  touches: "Đi hoặc đến",
  route: "Đúng chặng (DEP, DEST)",
  ac_type: "Loại tàu",
  reg_in: "Tàu trong danh sách",
  prefix_or_touches: "Đi/đến (hoặc tiền tố 2 chữ)",
  touches_or_alt: "Đi/đến hoặc sân bay dự bị",
  prefix_touches_alt: "Vùng/quốc gia (đi/đến/dự bị)",
};

const TAU = ["VNA522","VNA631","VNA637","VNA651","VNA643","VNA642","VNA639","VNA635","VNA632","VNA641","VNA649","VNA657","VNA634","VNA687","VNA698"].sort();
const CHINA = ["ZB","ZG","ZH","ZL","ZP","ZS","ZU","ZY"];

export const DEFAULT_RULES: NoticeRule[] = NOTICE_RULES_DEFAULT.map((r) => ({ ...r, values: [...r.values], files: [...r.files] }));

export function icaoAcType(raw: string): string {
  const t = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return "";
  if (["A21N", "321N", "A321N", "A321NEO"].includes(t) || (t.includes("NEO") && t.includes("321"))) return "A21N";
  if (["A20N", "320N", "A320N", "A320NEO"].includes(t) || (t.includes("NEO") && t.includes("320"))) return "A20N";
  if (["A321", "321", "A321CEO"].includes(t)) return "A321";
  if (["A320", "320"].includes(t)) return "A320";
  return t;
}

const cleanReg = (r: string) => (r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function ruleMatches(r: NoticeRule, f: Flight): boolean {
  const ordered = r.values.map((v) => String(v).toUpperCase().trim()).filter(Boolean);
  const vals = new Set(ordered);
  const dep = (f.dep || "").toUpperCase(), dest = (f.dest || "").toUpperCase();
  const reg = cleanReg(f.reg), act = icaoAcType(f.acType);
  switch (r.condition) {
    case "always": return true;
    case "has_reg": return !!reg;
    case "dep": return vals.has(dep);
    case "dest": return vals.has(dest);
    case "touches": return vals.has(dep) || vals.has(dest);
    case "route": return ordered.length >= 2 && dep === ordered[0] && dest === ordered[1];
    case "ac_type": return ordered.some((v) => icaoAcType(v) === act && !!act);
    case "reg_in": return vals.has(reg);
    case "prefix_or_touches":
      return vals.has(dep) || vals.has(dest) || ordered.some((v) => v.length === 2 && (dep.startsWith(v) || dest.startsWith(v)));
    case "prefix_touches_alt":
      return prefixTouchesAlt(r.values, [dep, dest, f.alt1 || "", f.alt2 || ""]);
    case "touches_or_alt":
      return vals.has(dep) || vals.has(dest) || vals.has((f.alt1 || "").toUpperCase()) || vals.has((f.alt2 || "").toUpperCase());
  }
  return false;
}

function activeOn(r: NoticeRule, day: string) {
  return (!r.effective_from || day >= r.effective_from) && (!r.effective_to || day <= r.effective_to);
}

export type Need = { title: string; alt: string[]; rule: string; attached: boolean };

const norm = (s: string) => s.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

export function needsFor(f: Flight, rules: NoticeRule[], day = new Date().toISOString().slice(0, 10)): Need[] {
  const reg = cleanReg(f.reg);
  const have = new Set<string>();
  for (const a of f.attachments) { have.add(norm(a.title)); have.add(norm(a.filename)); }
  const seen = new Set<string>();
  const out: Need[] = [];
  for (const r of rules) {
    if (!r.enabled || !activeOn(r, day) || !ruleMatches(r, f)) continue;
    for (const raw of r.files) {
      const parts = raw.replace(/\{REG\}/g, reg).replace(/\{REG3\}/g, reg.slice(-3)).split("|").map((p) => p.trim()).filter(Boolean);
      if (!parts.length) continue;
      const [title, ...alt] = parts as [string, ...string[]];
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const attached = [title, ...alt].some((n) => {
        const k = norm(n);
        if (have.has(k)) return true;
        for (const h of have) if (h.startsWith(k) || (k.length >= 6 && h.includes(k))) return true;
        return false;
      });
      out.push({ title, alt, rule: r.name, attached });
    }
  }
  return out;
}
