// Port of notices.py (data-driven rule matching only; PDF lookup is injected
// via an `exists` callback since there is no local disk in the Worker).
import type { Flight } from "../core/models";

export const TAU_LIST = new Set([
  "VNA522", "VNA631", "VNA637", "VNA651", "VNA643", "VNA642", "VNA639",
  "VNA635", "VNA632", "VNA641", "VNA649", "VNA657", "VNA634", "VNA687", "VNA698",
]);
export const ICAO_SPECIAL = new Set(["VVDB"]);
export const ICAO_DPS = new Set(["WADD"]);
export const CHINA_PREFIX = ["ZB", "ZG", "ZH", "ZL", "ZP", "ZS", "ZU", "ZY"];

export type RuleCond =
  | "always" | "has_reg" | "dep" | "dest" | "touches" | "route"
  | "ac_type" | "reg_in" | "prefix_or_touches" | "touches_or_alt";

export type RuleRow = {
  name: string;
  condition: RuleCond;
  values: string[];
  files: string[];
  enabled: boolean;
  effective_from?: string;
  effective_to?: string;
};

export function icaoAcType(raw: string): string {
  const t = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return "";
  if (["A21N", "321N", "A321N", "A321NEO"].includes(t) || (t.includes("NEO") && t.includes("321"))) return "A21N";
  if (["A20N", "320N", "A320N", "A320NEO"].includes(t) || (t.includes("NEO") && t.includes("320"))) return "A20N";
  if (["A321", "321", "A321CEO"].includes(t)) return "A321";
  if (["A320", "320"].includes(t)) return "A320";
  return t;
}
export function acTypeMatches(got: string, want: string): boolean {
  const a = icaoAcType(got), b = icaoAcType(want);
  return !!a && !!b && a === b;
}

const normReg = (v: string) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dep = (f: Flight) => (f.dep_icao || "").toUpperCase();
const dest = (f: Flight) => (f.dest_icao || "").toUpperCase();
const reg = (f: Flight) => normReg(f.reg);
const actype = (f: Flight) => icaoAcType(f.ac_type || f.acft_type || "");

/** Bản JSON tương đương web.py notices._default_rule_data(). */
export function defaultRuleData(): RuleRow[] {
  const tau = [...TAU_LIST].sort();
  return [
    { name: "Notice chung cho mọi chuyến", condition: "always", values: [], files: ["NOTICES TO PILOTS | NOTICES AND SAFETY DIRECTIVE | NOTICE TO PILOT | NTP & TECHNICAL NOTE | NTP"], enabled: true },
    { name: "Notice riêng của tàu bay", condition: "has_reg", values: [], files: ["{REG}"], enabled: true },
    { name: "Đến VVDB", condition: "dest", values: ["VVDB"], files: ["Technical Notice VVDB"], enabled: true },
    { name: "Từ WADD về VVNB", condition: "route", values: ["WADD", "VVNB"], files: ["TN-20022025 - AIRWAYS W27, W28 and Q9_1"], enabled: true },
    { name: "Tàu trong danh sách EGTM thấp", condition: "reg_in", values: tau, files: ["TN-LOW EGTM A{REG3}"], enabled: true },
    { name: "Tàu A21N", condition: "ac_type", values: ["A21N"], files: ["TN-2025-0049"], enabled: true },
    { name: "Đi/đến WMKK", condition: "touches", values: ["WMKK"], files: ["FAOC_1.20 AA 2025 (R)", "FAOC.20 VIETJET AVIATION JOINT STOCK COMPANY 2025 (R)"], enabled: true },
    { name: "Đi/đến VVPQ", condition: "touches", values: ["VVPQ"], files: ["vv-esup-31-26-approvedbycaav"], enabled: true },
    { name: "Đi/đến Trung Quốc / VMMC / VHHH", condition: "prefix_or_touches", values: [...CHINA_PREFIX, "VMMC", "VHHH"], files: ["2026005函 关于汛期运行安全风险的警示"], enabled: true },
    { name: "Đi/đến VMMC", condition: "touches", values: ["VMMC"], files: ["NTP 2026-013 VMMCMFM LOC RWY16 (No LOC signal)"], enabled: true },
    { name: "Đi/đến VVCA", condition: "touches", values: ["VVCA"], files: ["NTP 2026-014 Runway Overrun Mitigation", "NTP 2026-015 VVCA (Chu Lai Airport) Runway Shortening"], enabled: true },
    { name: "Đi/đến VOBL", condition: "touches", values: ["VOBL"], files: ["ZSPD_NavData_Alert_2606"], enabled: true },
    { name: "Đi/đến VVNB", condition: "touches", values: ["VVNB"], files: ["VVNB vv-esup-19-26-approvedbycaav"], enabled: false },
    { name: "Đi/đến WSSS", condition: "touches", values: ["WSSS"], files: ["SG-AD-2-WSSS-AD-2-WSSS-ADC-3", "WSSS_Chart_Alert_26_MAR_2026"], enabled: false },
    { name: "Đi/đến/alternate ZSPD", condition: "touches_or_alt", values: ["ZSPD"], files: ["ZSPD_Chart_Alert_26_MAR_2026"], enabled: false },
  ];
}

const ALLOWED_CONDS = new Set<RuleCond>([
  "always", "has_reg", "dep", "dest", "touches", "route",
  "ac_type", "reg_in", "prefix_or_touches", "touches_or_alt",
]);

/** Port of notices.save_rule_data — validates + normalises rows, throws on bad input. */
export function cleanRuleData(rows: unknown[]): RuleRow[] {
  const out: RuleRow[] = [];
  rows.forEach((raw, i) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const cond = String(row["condition"] ?? "always") as RuleCond;
    if (!ALLOWED_CONDS.has(cond)) throw new Error(`Rule ${i + 1}: điều kiện không hợp lệ`);
    const start = String(row["effective_from"] ?? "");
    const end = String(row["effective_to"] ?? "");
    for (const v of [start, end]) if (v && Number.isNaN(Date.parse(v))) throw new Error(`Rule ${i + 1}: ngày hiệu lực không hợp lệ`);
    if (start && end && start > end) throw new Error(`Rule ${i + 1}: ngày hiệu lực sau ngày hết hiệu lực`);
    out.push({
      name: String(row["name"] ?? `Rule ${i + 1}`).trim() || `Rule ${i + 1}`,
      condition: cond,
      values: ((row["values"] as unknown[]) ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean),
      files: ((row["files"] as unknown[]) ?? []).map((x) => String(x).trim()).filter(Boolean),
      effective_from: start, effective_to: end,
      enabled: row["enabled"] === undefined ? true : !!row["enabled"],
    });
  });
  return out;
}

export function matchesData(row: RuleRow, f: Flight): boolean {
  const ordered = (row.values || []).map((x) => String(x).toUpperCase());
  const vals = new Set(ordered);
  const d = dep(f), de = dest(f), r = reg(f), at = actype(f);
  switch (row.condition) {
    case "always": return true;
    case "has_reg": return !!r;
    case "dep": return vals.has(d);
    case "dest": return vals.has(de);
    case "touches": return vals.has(d) || vals.has(de);
    case "route": return ordered.length >= 2 && d === ordered[0] && de === ordered[1];
    case "ac_type": return [...vals].some((v) => acTypeMatches(at, v));
    case "reg_in": return vals.has(r);
    case "prefix_or_touches":
      return vals.has(d) || vals.has(de) || [...vals].some((v) => v.length === 2 && (d.startsWith(v) || de.startsWith(v)));
    case "touches_or_alt":
      return vals.has(d) || vals.has(de) || vals.has((f.dest_alt1 || "").toUpperCase()) || vals.has((f.dest_alt2 || "").toUpperCase());
    default: return false;
  }
}

export function activeToday(row: RuleRow, todayIso: string): boolean {
  return (!row.effective_from || todayIso >= row.effective_from) && (!row.effective_to || todayIso <= row.effective_to);
}

export function splitAlt(raw: string): [string, string[]] {
  const parts = String(raw).split("|").map((p) => p.trim()).filter(Boolean);
  return parts.length ? [parts[0]!, parts.slice(1)] : ["", []];
}

export type Need = { title: string; rule: string; found: boolean; alt: string[]; cond: string };
export type FlightNeeds = { flight: Flight; needs: Need[] };

/** Port of notices.needs_for (rule_data path only — no python Rule objects). */
export function needsFor(
  flight: Flight,
  ruleData: RuleRow[],
  exists: (title: string, reg: string) => boolean,
  todayIso = new Date().toISOString().slice(0, 10),
): FlightNeeds {
  const r = reg(flight);
  const seen = new Set<string>();
  const needs: Need[] = [];
  for (const row of ruleData) {
    if (!row.enabled || !activeToday(row, todayIso)) continue;
    if (!matchesData(row, flight)) continue;
    for (const raw of row.files) {
      const title = raw.replace(/\{REG\}/g, r).replace(/\{REG3\}/g, r.slice(-3));
      const [t, alt] = splitAlt(title);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      needs.push({ title: t, rule: row.name, found: exists(t, r), alt, cond: row.condition });
    }
  }
  return { flight, needs };
}

export function preview(
  flights: Flight[],
  ruleData: RuleRow[],
  exists: (title: string, reg: string) => boolean,
): FlightNeeds[] {
  return flights.map((f) => needsFor(f, ruleData, exists));
}

// ---- web.py helpers shared by notices.server.ts / swap.server.ts ----

function vnDate(d: Date): string {
  // UTC+7, date only (matches web.py _VN_TZ.astimezone().date()).
  const t = new Date(d.getTime() + 7 * 3600e3);
  return t.toISOString().slice(0, 10);
}

const OPS_BACK_H = 6, OPS_AHEAD_H = 24;

/** Port of web.py in_ops_window: STD in [now-6h, now+24h] with VN-day spill rules. */
export function inOpsWindow(f: Flight, now = new Date()): boolean {
  if (!f.std) return false;
  const std = f.std.getTime();
  const lo = now.getTime() - OPS_BACK_H * 3600e3;
  const hi = now.getTime() + OPS_AHEAD_H * 3600e3;
  if (std < lo || std > hi) return false;
  const stdDay = vnDate(f.std);
  const nowDay = vnDate(now);
  if (stdDay === nowDay) return true;
  const yesterday = vnDate(new Date(now.getTime() - 24 * 3600e3));
  const tomorrow = vnDate(new Date(now.getTime() + 24 * 3600e3));
  if (stdDay === yesterday && std >= lo) return true;
  if (stdDay === tomorrow && std <= hi) return true;
  return false;
}

/** Port of web.py pick_flights (keeps bare numeric callsigns matching VJC + number). */
export function pickFlights(flights: Flight[], callsigns: string[], todayOnly = true): Flight[] {
  const keep = new Set<string>();
  for (const c of callsigns) {
    const s = String(c || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!s) continue;
    keep.add(/[A-Z]/.test(s) ? s : `VJC${s}`);
  }
  if (!keep.size) return [];
  const now = new Date();
  return flights.filter((f) => {
    if (!keep.has(f.callsign.toUpperCase())) return false;
    if (todayOnly && !inOpsWindow(f, now)) return false;
    return true;
  });
}

/** Port of web.py pick_notice_flights. */
export function pickNoticeFlights(flights: Flight[], callsigns: string[]): Flight[] {
  const active = pickFlights(flights, callsigns, true);
  const activeIds = new Set(active.map((f) => f.id));
  const activeDays = new Map<string, Set<string>>();
  for (const f of active) {
    if (!f.std) continue;
    const key = f.callsign.toUpperCase();
    const set = activeDays.get(key) ?? new Set<string>();
    set.add(vnDate(f.std));
    activeDays.set(key, set);
  }
  const allMatches = pickFlights(flights, callsigns, false);
  const sameOpsDay = allMatches.filter((f) => {
    if (!f.std) return false;
    const days = activeDays.get(f.callsign.toUpperCase());
    return !!days && days.has(vnDate(f.std));
  });
  const counts = new Map<string, number>();
  for (const f of sameOpsDay) counts.set(f.callsign.toUpperCase(), (counts.get(f.callsign.toUpperCase()) ?? 0) + 1);
  const dupNames = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  return sameOpsDay.filter((f) => activeIds.has(f.id) || dupNames.has(f.callsign.toUpperCase()));
}

/** Port of web.py _notice_duplicate_groups. */
export function noticeDuplicateGroups(flights: Flight[]) {
  const grouped = new Map<string, Flight[]>();
  for (const f of flights) {
    const k = f.callsign.toUpperCase();
    const arr = grouped.get(k) ?? [];
    arr.push(f);
    grouped.set(k, arr);
  }
  return [...grouped.entries()]
    .filter(([, g]) => g.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([callsign, group]) => ({
      callsign,
      sectors: [...group]
        .sort((a, b) => (a.std?.getTime() ?? Infinity) - (b.std?.getTime() ?? Infinity) || a.id - b.id)
        .map((f) => ({
          sector_id: f.id,
          route: f.route,
          std: f.std ? f.std.toISOString() : "",
          reg: f.reg,
          ac_type: f.ac_type || f.acft_type,
        })),
    }));
}

/** Port of web.py _select_notice_sectors. */
export function selectNoticeSectors(flights: Flight[], sectorIds: unknown[] | null | undefined): Flight[] {
  const duplicates = noticeDuplicateGroups(flights);
  if (!sectorIds || !sectorIds.length) {
    if (duplicates.length) {
      const names = duplicates.map((d) => d.callsign).join(", ");
      throw new Error(`Có callsign trùng route (${names}); phải chọn đúng route trước khi Add file.`);
    }
    return flights;
  }
  const keep = new Set<number>();
  for (const v of sectorIds) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("sector_ids không hợp lệ");
    keep.add(n);
  }
  const selected = flights.filter((f) => keep.has(f.id));
  const byCallsign = new Map<string, number>();
  for (const f of selected) byCallsign.set(f.callsign.toUpperCase(), (byCallsign.get(f.callsign.toUpperCase()) ?? 0) + 1);
  const expected = new Set(flights.map((f) => f.callsign.toUpperCase()));
  const invalid = [...expected].filter((cs) => (byCallsign.get(cs) ?? 0) !== 1).sort();
  if (invalid.length) throw new Error("Mỗi callsign phải chọn đúng một route: " + invalid.join(", "));
  return selected;
}
