// Port of atc_chg.py — Điện văn CHG / DLA từ dữ liệu thay đổi ver, không đếm dòng FPL.
// pack_msg / pack_chg (OFP PDF fetch via FliteBrief + Selenium-free pdf parse) are NOT
// ported here: they need atc_ezfw.pick_flight / pdf_text / FliteBrief OFP fetch, which
// have no Worker-safe equivalent in this project yet. Only the pure render/parse
// functions (used directly by fields_from_fpl/render/render_msg) are ported.
import * as atcFix from "./atc_fix";
import { icaoAcType } from "./notices";

export const KIND_CHG = "CHG";
export const KIND_DLA = "DLA";
export const KIND_BOTH = "CHG DLA";

export const ARO: Record<string, string> = {
  VVCR: "CAM RANH", VVBM: "CAM RANH", VVDL: "CAM RANH", VVTH: "CAM RANH",
  VVTS: "ARO SAI GON", VVCT: "ARO SAI GON",
  VVDN: "ARO DA NANG", VVPC: "ARO DA NANG", VVPB: "ARO DA NANG",
  VVCA: "ARO DA NANG", VVPK: "ARO DA NANG",
  VVTX: "ARO HA NOI", VVNB: "ARO HA NOI", VVDH: "ARO HA NOI",
  VVCI: "ARO HA NOI", VVVH: "ARO HA NOI", VVDB: "ARO HA NOI",
  VVVD: "ARO HA NOI",
  VVPQ: "PHU QUOC",
};

const WAKE_H = new Set(["A330", "A333", "A339", "A359", "A35K", "B77W", "B789"]);
const RE_AC = /^-([A-Z0-9]{3,4})\/([MHJ])-(.+)$/i;
const RE_DOF = /DOF\/(\d{6})/;
export const SPLIT = " *************************************** ";

export function kind(opts: { reg_changed: boolean; delay_changed: boolean }): string {
  if (opts.reg_changed && opts.delay_changed) return KIND_BOTH;
  if (opts.reg_changed) return KIND_CHG;
  if (opts.delay_changed) return KIND_DLA;
  return "";
}

export function label(code: unknown): string {
  return String(code ?? "").trim();
}

export function aro_of(dep: unknown): string {
  return ARO[String(dep ?? "").toUpperCase()] ?? "INTERNATIONAL FLIGHT";
}

export type FplFields = {
  callsign: string; dep: string; arr: string; item13: string;
  type: string; wake: string; equip: string; dof: string; pbn: string;
  item15: string; item16: string; item18: string;
};

export function fields_from_fpl(block: string): FplFields | null {
  const parsed = atcFix.parse_block(block) as Record<string, any> | null;
  if (!parsed) return null;
  let ac = "", wake = "M", equip = "";
  let item13 = String(parsed.dep ?? "") + "0000";
  for (const ln of (parsed.before ?? []) as string[]) {
    const text = String(ln).trim();
    const hit = RE_AC.exec(text);
    if (hit) {
      ac = (hit[1] ?? "").toUpperCase();
      wake = (hit[2] ?? "").toUpperCase();
      equip = (hit[3] ?? "").trim();
    }
    const aero = atcFix._RE_AERO.exec(text);
    if (aero) item13 = aero[1] + aero[2];
  }
  let dest = String(parsed.arr ?? "");
  const after = [...((parsed.after ?? []) as string[])];
  let item16 = "";
  if (after.length) {
    const aero = atcFix._RE_AERO.exec(after[0].trim());
    if (aero) dest = aero[1];
    item16 = after[0].trim().replace(/^-+/, "");
  }
  const tokens = [...((parsed.tokens ?? []) as unknown[])];
  const item15 = tokens
    .map((tok, i) => (i === 0 ? String(tok).replace(/^-+/, "") : String(tok)))
    .join(" ");
  const blob = after.join("\n");
  const dofHit = RE_DOF.exec(blob);
  const dof = dofHit ? "DOF/" + dofHit[1] : "";
  const pbn: string[] = [];
  let inPbn = false;
  for (const ln of after) {
    const text = ln.trim().replace(/\)+$/, "");
    if (text.startsWith("-PBN") || text.startsWith("PBN/")) {
      inPbn = true;
      pbn.push("-18/" + text.replace(/^-+/, ""));
      continue;
    }
    if (inPbn) {
      if (text.startsWith("-E/") || text.startsWith("-P/")) break;
      pbn.push(text);
      if (/RMK\//i.test(text.toUpperCase())) break;
    }
  }
  if (pbn.length && !pbn[pbn.length - 1].endsWith(")")) {
    pbn[pbn.length - 1] = pbn[pbn.length - 1] + ")";
  }
  const item18 = pbn.join("\n");
  return {
    callsign: String(parsed.callsign ?? ""),
    dep: String(parsed.dep ?? ""),
    arr: dest,
    item13,
    type: ac,
    wake,
    equip,
    dof,
    pbn: item18,
    item15,
    item16,
    item18,
  };
}

export function shift_item13(item13: unknown, delayMin: number): string {
  const text = String(item13 ?? "");
  if (text.length < 8 || !/^\d{4}$/.test(text.slice(4, 8))) return text;
  const minutes = Number.isFinite(delayMin) ? Math.trunc(delayMin) : 0;
  let tot = (parseInt(text.slice(4, 6), 10) * 60 + parseInt(text.slice(6, 8), 10) + minutes) % (24 * 60);
  if (tot < 0) tot += 24 * 60;
  const hh = String(Math.trunc(tot / 60)).padStart(2, "0");
  const mm = String(tot % 60).padStart(2, "0");
  return text.slice(0, 4) + hh + mm;
}

function wake_(ac: string, fallback = "M"): string {
  const code = icaoAcType(ac) || String(ac ?? "").toUpperCase();
  if (WAKE_H.has(code)) return "H";
  return fallback || "M";
}

export function render(
  code: string,
  fields: FplFields,
  opts: { delay_min?: number; new_type?: string; orig_eobt?: string; new_eobt?: string } = {},
): string {
  const delayMin = opts.delay_min ?? 0;
  const newType = opts.new_type ?? "";
  const cs = fields.callsign || "";
  // Header luôn mang EOBT gốc (STD UTC từ FliteBrief nếu có) — OFP có thể đã
  // được làm lại theo ETD, cộng delay lên đó sẽ bị cộng hai lần.
  const item13 = opts.orig_eobt ? set_eobt(fields.item13 || "", opts.orig_eobt) : (fields.item13 || "");
  const dest = fields.arr || "";
  const dof = fields.dof || "";
  const oldType = fields.type || "A320";
  let wake = fields.wake || "M";
  const equip = fields.equip || "";
  const ac = icaoAcType(newType) || newType || oldType;
  if (ac !== oldType) wake = wake_(ac, wake);
  const fresh = opts.new_eobt ? set_eobt(item13, opts.new_eobt) : shift_item13(item13, delayMin);
  const tail = dof ? "-" + dof : "";
  if (code === KIND_DLA) {
    return `(DLA-${cs}-${fresh}-${dest}${tail})`;
  }
  const lines = [`(CHG-${cs}-${item13}-${dest}${tail}`];
  if (ac) lines.push("-9/" + ac + "/" + wake);
  if (equip) lines.push("-10/" + equip);
  if (code === KIND_BOTH) lines.push("-13/" + fresh);
  const pbn = String(fields.pbn || "").trim();
  if (pbn) lines.push(pbn);
  let text = lines.join("\n").replace(/\s+$/, "");
  if (!text.endsWith(")")) text += ")";
  return text;
}

export const KIND_CNL = "CNL";
export const KIND_CHG_AC = "CHG A/C";
export const KIND_CHG_AC_DLA = "CHG A/C AND DLA";
export const KIND_CHG_ALT = "CHG ALT";
export const KIND_CHG_TIME = "CHG TIME";
export const KIND_CHG_ROUTE = "CHG ROUTE";
export const KIND_CHG_RMK = "CHG RMK";

const MSG_ALIAS: Record<string, string> = {
  CNL: KIND_CNL,
  DLA: KIND_DLA,
  "CHG A/C": KIND_CHG_AC,
  "CHG AC": KIND_CHG_AC,
  "CHG A/C AND DLA": KIND_CHG_AC_DLA,
  "CHG AC AND DLA": KIND_CHG_AC_DLA,
  "CHG A/C & DLA": KIND_CHG_AC_DLA,
  "CHG DLA": KIND_CHG_AC_DLA,
  "CHG ALT": KIND_CHG_ALT,
  "CHG TIME": KIND_CHG_TIME,
  "CHG ROUTE": KIND_CHG_ROUTE,
  "CHG RMK": KIND_CHG_RMK,
};

export function normalize_msg_kind(raw: unknown): string {
  let text = String(raw ?? "").toUpperCase().replace(/&/g, "AND").split(/\s+/).filter(Boolean).join(" ");
  text = text.replace("A/C", "A/C");
  if (text in MSG_ALIAS) return MSG_ALIAS[text];
  const compact = text.replace(/\//g, " ");
  return MSG_ALIAS[compact] ?? "";
}

export function set_eobt(item13: unknown, utc: unknown): string {
  let digits = String(utc ?? "").replace(/\D/g, "");
  if (digits.length === 3) digits = "0" + digits;
  const base = String(item13 ?? "");
  if (digits.length < 4 || base.length < 4) return base;
  return base.slice(0, 4) + digits.slice(0, 4);
}

function ident_(fields: FplFields, item13?: string): string {
  const cs = fields.callsign || "";
  const dest = fields.arr || "";
  const dof = fields.dof || "";
  const id = item13 !== undefined ? item13 : fields.item13 || "";
  const tail = dof ? "-" + dof : "";
  return `${cs}-${id}-${dest}${tail}`;
}

function icaoApt_(text: unknown): string {
  const code = atcFix._apt_cell(String(text ?? ""));
  if (code.length === 4 && /[A-Za-z]/.test(code[0])) return code;
  return "";
}

function acLines_(fields: FplFields, spec: Record<string, any>): string[] {
  const ac = icaoAcType(String(spec.ac ?? spec.ac_type ?? "")) || fields.type || "";
  const wake = ac ? wake_(ac, fields.wake || "M") : (fields.wake || "M");
  const equip = fields.equip || "";
  const lines: string[] = [];
  if (ac) lines.push("-9/" + ac + "/" + wake);
  if (equip) lines.push("-10/" + equip);
  const pbn = String(fields.pbn || "").trim();
  if (pbn) lines.push(pbn);
  return lines;
}

function withItem18_(fields: FplFields, spec: Record<string, any>): string {
  let text = String(fields.item18 || fields.pbn || "").trim();
  const closed = text.endsWith(")");
  if (closed) text = text.slice(0, -1).replace(/\s+$/, "");
  const rmk = String(spec.rmk ?? "").trim().toUpperCase();
  const extra = String(spec.extra ?? "").trim().toUpperCase();
  if (rmk) {
    const bit = rmk.startsWith("RMK/") ? rmk : "RMK/" + rmk;
    if (/RMK\//i.test(text)) {
      text = text.replace(/RMK\/.*$/im, bit);
    } else {
      text = (text + "\n" + bit).trim();
    }
  }
  if (extra && extra !== "0" && extra !== "0M" && !text.includes("EXTRA " + extra)) {
    text = (text + " EXTRA " + extra).trim();
  }
  if (!text) text = "-18/RMK/";
  else if (!text.startsWith("-18/")) text = "-18/" + text.replace(/^-+/, "");
  if (closed) text += ")";
  return text;
}

export function render_msg(kindRaw: string, fields: FplFields, spec: Record<string, any> = {}): string {
  const k = normalize_msg_kind(kindRaw);
  const item13 = fields.item13 || "";
  const utc = String(spec.utc ?? spec.etd ?? "");
  const fresh = utc ? set_eobt(item13, utc) : item13;
  if (k === KIND_CNL) return `(CNL-${ident_(fields)})`;
  if (k === KIND_DLA) return `(DLA-${ident_(fields, fresh)})`;
  if (!k.startsWith("CHG")) return "";
  const lines = [`(CHG-${ident_(fields)}`];
  if (k === KIND_CHG_TIME) {
    lines.push("-13/" + fresh);
  } else if (k === KIND_CHG_AC) {
    lines.push(...acLines_(fields, spec));
  } else if (k === KIND_CHG_AC_DLA) {
    const acLines = acLines_(fields, spec);
    const pbnLn = acLines.filter((ln) => ln.startsWith("-18/"));
    const headLn = acLines.filter((ln) => !pbnLn.includes(ln));
    lines.push(...headLn);
    lines.push("-13/" + fresh);
    lines.push(...pbnLn);
  } else if (k === KIND_CHG_ALT) {
    const base = String(fields.item16 || "");
    const dest8 = base ? base.split(/\s+/)[0] : fields.arr || "";
    const alts: string[] = [];
    for (const key of ["alt1", "alt2"]) {
      const code = icaoApt_(spec[key] ?? "");
      if (code && !alts.includes(code) && code !== dest8.slice(0, 4)) alts.push(code);
    }
    lines.push("-16/" + [dest8, ...alts].join(" ").trim());
  } else if (k === KIND_CHG_ROUTE) {
    const body = String(fields.item15 || "").trim();
    if (body) lines.push("-15/" + body);
  } else if (k === KIND_CHG_RMK) {
    lines.push(withItem18_(fields, spec));
  }
  let text = lines.join("\n").replace(/\s+$/, "");
  if (!text.endsWith(")")) text += ")";
  return text;
}

export const NEED_13 = [KIND_CHG_TIME, KIND_CHG_AC_DLA];

function escapeHtml_(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function msg_html(text: unknown, opts: { need?: string[] } = {}): string {
  const need = opts.need ?? [];
  const bits: string[] = [];
  for (const ln of String(text ?? "").split("\n")) {
    const s = escapeHtml_(ln);
    if (need.length && need.some((p) => ln.startsWith(p))) {
      bits.push('<span class="need">' + s + "</span>");
    } else {
      bits.push(s);
    }
  }
  return bits.join("\n");
}

export function msg_filename(kindRaw: string): string {
  const k = normalize_msg_kind(kindRaw);
  const names: Record<string, string> = {
    [KIND_CNL]: "CNL.txt",
    [KIND_DLA]: "DLA.txt",
    [KIND_CHG_AC]: "CHG-AC.txt",
    [KIND_CHG_AC_DLA]: "CHG-AC-DLA.txt",
    [KIND_CHG_ALT]: "CHG-ALT.txt",
    [KIND_CHG_TIME]: "CHG-TIME.txt",
    [KIND_CHG_ROUTE]: "CHG-ROUTE.txt",
    [KIND_CHG_RMK]: "CHG-RMK.txt",
  };
  return names[k] ?? "DIEN-VAN.txt";
}

export function _dump(parts: [string, string][]): string {
  const chunks: string[] = [];
  let last = "";
  for (const [region, msg] of parts) {
    if (region !== last) {
      if (chunks.length) chunks.push("");
      chunks.push("-------------------" + region + "-------------------");
      chunks.push("");
      last = region;
    }
    chunks.push(msg);
    chunks.push("");
  }
  return chunks.join("\n").replace(/\s+$/, "");
}

export function join_export(chg: [string, string][], dla: [string, string][]): string {
  const left = _dump(chg);
  const right = _dump(dla);
  if (left && right) return left + "\n\n" + SPLIT + "\n\n" + right + "\n";
  return (left || right) + (left || right ? "\n" : "");
}
