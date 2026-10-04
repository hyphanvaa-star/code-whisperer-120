// Port of atc_fix.py — fix ATC FPL blocks per SID/STAR + FL rules.
import { IATA_ICAO } from "./limits_check";
export type Raw = Record<string, any>;

export const WRAP = 69;

export const DEFAULT_FL: Record<string, number> = {
  VVDNVVTS: 320, VVDNVVPQ: 320, VVDNVVNB: 310, VVDNVVCI: 310,
  VVDNVVCT: 320, VVPBVVTS: 320, VVPBVVNB: 310, VVPBVVCI: 310,
  VVPBVVPQ: 320, VVPBVVCT: 320, VVCAVVTS: 300, VVCAVVNB: 330,
  VVPKVVNB: 330, VVPCVVNB: 330, VVDLVVNB: 270, VVDLVVCI: 270,
  VVBMVVCI: 270, VVBMVVNB: 270, VVCRVVCI: 330, VVCRVVNB: 330,
  VVCRVVTX: 330, VVCRVVVH: 310, VVTSVVDH: 330, VVTSVVNB: 330,
  VVTSVVCI: 330, VVTSVVTX: 330, VVTSVVVH: 330, VVTSVVDN: 310,
  VVTSVVCA: 310, VVTSVVVD: 330, VVTSVVPB: 330, VVTHVVNB: 330,
  VVPQVVNB: 330, VVPQVVCI: 330, VVNBVVTS: 320, VVNBVVCR: 320,
  VVNBVVPQ: 320, VVNBVVDL: 320, VVNBVVPC: 320, VVNBVVPK: 320,
  VVNBVVBM: 320, VVNBVVPB: 300, VVNBVVDN: 300, VVNBVVTH: 320,
  VVNBVVCT: 320, VVCTVVNB: 330, VVCTVVCI: 330, VVCIVVTS: 320,
  VVCIVVCT: 320, VVCIVVPQ: 320, VVCIVVDN: 300, VVCIVVDL: 320,
  VVCIVVCR: 320, VVCIVVBM: 320, VVTXVVTS: 320, VVTXVVDL: 320,
  VVVHVVTS: 320, VVVHVVDL: 300, VVDHVVTS: 320, VVVDVVTS: 320,
  VVDNVMMC: 310, VVDNRCMQ: 310, VVDLVVVH: 270, VVBMVVVH: 270,
};

export const DEFAULT_SPECIAL_SID: Record<string, string> = {
  BACHU5A: "BACHU DCT ATGAS",
  NIHOA1A: "NIHOA DCT KARAN",
  NIHOA1B: "NIHOA DCT KARAN",
  BIPHU1A: "BIPHU DCT VIDEN DCT",
};

export const DEFAULT_NO_EXPAND = [
  "VVTS-ZSPD", "VVCI-VMMC", "VVTS-VABB", "VVNB-VDSA", "VVCR-ZSWX", "VVTS-VOHS",
];

export const DEFAULT_MUMGA = [
  "VVDLVVNB", "VVDLVVCI", "VVBMVVCI", "VVBMVVNB", "VVDLVVVH", "VVBMVVVH",
];

const RE_AERO = /^-([A-Z]{4})(\d{4})\b/;
const RE_ROUTE = /^-[NK]\d/i;
const RE_CRUISE = /^(-[NK])(\d{3,4})([FS])(\d{3,4})(.*)$/i;
const RE_LEVEL = /\/[NM]\d+[FS]\d+/i;
const RE_CALL = /\(FPL-([A-Z0-9]+)-/i;
export const _RE_AERO = RE_AERO;

export function _apt_cell(text: string): string {
  const raw = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length === 4) return raw;
  if (raw.length === 3) return IATA_ICAO[raw] || raw;
  return raw;
}

export function load_rules(doc?: Raw | null): Raw {
  const rules: Raw = {
    fl: { ...DEFAULT_FL },
    special_sid: { ...DEFAULT_SPECIAL_SID },
    no_expand: [...DEFAULT_NO_EXPAND],
    mumga: [...DEFAULT_MUMGA],
  };
  if (!doc) return rules;
  let r = rules;
  if (doc.replace) r = { fl: {}, special_sid: {}, no_expand: [], mumga: [] };
  const fl = doc.fl || {};
  for (const [key, val] of Object.entries(fl)) {
    const n = Number(val);
    if (Number.isFinite(n)) r.fl[String(key).toUpperCase().replace(/-/g, "")] = Math.trunc(n);
  }
  for (const [sid, exp] of Object.entries(doc.special_sid || {})) {
    const text = String(exp || "").trim().toUpperCase();
    if (text) r.special_sid[String(sid).toUpperCase()] = text;
  }
  const extraNo = (doc.no_expand || []).map((x: any) => String(x).toUpperCase()).filter((x: string) => x.trim());
  if (extraNo.length || doc.replace) r.no_expand = extraNo;
  const extraMu = (doc.mumga || []).map((x: any) => String(x).toUpperCase().replace(/-/g, "")).filter((x: string) => x.trim());
  if (extraMu.length || doc.replace) r.mumga = extraMu;
  return r;
}

function pairCells(key: string, _dash = false): [string, string] {
  const text = String(key || "").toUpperCase().replace(/ /g, "");
  if (text.includes("-")) {
    const [left, right] = text.split("-", 2);
    return [left, right];
  }
  if (text.length >= 8) return [text.slice(0, 4), text.slice(4, 8)];
  return [text, ""];
}

export function editor_doc(doc?: Raw | null): Raw {
  const rules = load_rules(doc);
  const flRows = Object.entries(rules.fl as Record<string, number>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, fl]) => {
      const [dep, arr] = pairCells(key);
      return { dep, arr, fl: String(fl) };
    });
  const sidRows = Object.entries(rules.special_sid as Record<string, string>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sid, exp]) => ({ sid, expand: exp }));
  const noRows = (rules.no_expand as string[]).map((pair) => {
    const [dep, arr] = pairCells(pair, true);
    return { dep, arr };
  });
  const muRows = (rules.mumga as string[]).map((key) => {
    const [dep, arr] = pairCells(key);
    return { dep, arr };
  });
  return { fl: flRows, special_sid: sidRows, no_expand: noRows, mumga: muRows };
}

export function save_editor(payload: Raw): { doc: Raw; editor: Raw } {
  const fl: Record<string, number> = {};
  for (const rec of payload.fl || []) {
    const dep = _apt_cell(rec.dep), arr = _apt_cell(rec.arr);
    if (!dep || !arr) continue;
    const n = Number(String(rec.fl || "").trim());
    if (Number.isFinite(n)) fl[dep + arr] = Math.trunc(n);
  }
  const special: Record<string, string> = {};
  for (const rec of payload.special_sid || []) {
    const sid = String(rec.sid || "").trim().toUpperCase();
    const exp = String(rec.expand || "").trim().toUpperCase();
    if (sid && exp) special[sid] = exp;
  }
  const noExpand: string[] = [];
  for (const rec of payload.no_expand || []) {
    const dep = _apt_cell(rec.dep), arr = _apt_cell(rec.arr);
    if (dep && arr) noExpand.push(dep + "-" + arr);
  }
  const mumga: string[] = [];
  for (const rec of payload.mumga || []) {
    const dep = _apt_cell(rec.dep), arr = _apt_cell(rec.arr);
    if (dep && arr) mumga.push(dep + arr);
  }
  const doc: Raw = { replace: true, fl, special_sid: special, no_expand: noExpand, mumga };
  return { doc, editor: editor_doc(doc) };
}

export function split_blocks(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  const blob = String(text || "");
  for (;;) {
    const start = blob.indexOf("(FPL-", i);
    if (start < 0) break;
    let depth = 0, end = -1;
    for (let j = start; j < blob.length; j++) {
      const ch = blob[j];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    out.push(blob.slice(start, end + 1).trim());
    i = end + 1;
  }
  return out;
}

function bare(token: string): string {
  return String(token || "").split("/", 1)[0].toUpperCase();
}

function isSidStar(token: string): boolean {
  const t = String(token || "").trim();
  if (!t || t.includes("/")) return false;
  if (t.length < 5 || t.length >= 9) return false;
  return /\d/.test(t);
}

function fixName(token: string): string {
  const t = bare(token);
  for (let i = 0; i < t.length; i++) if (/\d/.test(t[i])) return t.slice(0, i);
  return t;
}

function speedOf(cruise: string): string {
  const m = RE_CRUISE.exec(cruise.trim());
  if (m) return m[2];
  const digits = cruise.replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 4) : "0450";
}

function setFl(cruise: string, fl: number): [string, boolean] {
  const m = RE_CRUISE.exec(cruise.trim());
  if (!m) return [cruise, false];
  const letter = m[3].toUpperCase();
  if (letter !== "F") return [cruise, false];
  const old = parseInt(m[4], 10);
  if (old === fl) return [cruise, false];
  return [`${m[1]}${m[2]}F${String(fl).padStart(3, "0")}${m[5]}`, true];
}

function mergeSeq(after: string[], seq: string[]): string[] {
  const out: string[] = [];
  let a = 0;
  for (const item of seq) {
    if (a < after.length && bare(after[a]) === bare(item)) { out.push(after[a]); a++; }
    else out.push(item);
  }
  out.push(...after.slice(a));
  return out;
}

function expandSid(tokens: string[], idx: number, special: Record<string, string>): string {
  const sid = tokens[idx];
  const name = bare(sid);
  const extra = special[name] || "";
  if (extra) {
    const seq = extra.split(/\s+/);
    const merged = mergeSeq(tokens.slice(idx + 1), seq);
    const rest = tokens.slice(idx + 1);
    if (merged.length === rest.length && merged.every((v, i) => v === rest[i])) return "";
    tokens.splice(idx + 1, tokens.length - (idx + 1), ...merged);
    return "SID " + name;
  }
  if (!isSidStar(sid)) return "";
  const fix = fixName(sid);
  const nxt = idx + 1 < tokens.length ? bare(tokens[idx + 1]) : "";
  if (fix && nxt.startsWith(fix)) return "";
  tokens.splice(idx + 1, 0, fix, "DCT");
  return "SID " + name;
}

function expandStar(tokens: string[], sidIdx: number): string {
  let last = tokens.length - 1;
  while (last >= 0 && !String(tokens[last]).trim()) last--;
  if (last < 0 || last === sidIdx) return "";
  const star = tokens[last];
  if (!isSidStar(star)) return "";
  const fix = fixName(star);
  const prev = last - 1 >= 0 ? bare(tokens[last - 1]) : "";
  if (prev === "DCT" || (fix && prev.startsWith(fix))) return "";
  tokens.splice(last, 0, "DCT", fix);
  return "STAR " + bare(star);
}

function stripSlashNear(tokens: string[], idx: number, toward: number): void {
  const j = idx + toward;
  if (j < 0 || j >= tokens.length) return;
  const tok = tokens[j];
  const slash = tok.indexOf("/");
  if (slash <= 0) return;
  const tail = tok.slice(slash);
  if (RE_LEVEL.test(tail)) return;
  tokens[j] = tok.slice(0, slash);
}

function mumga(tokens: string[], speed: string): string {
  let note = "";
  const out: string[] = [];
  for (let tok of tokens) {
    const up = tok.toUpperCase();
    if (up.startsWith("ENGIM/")) { tok = "ENGIM"; note = "ENGIM"; }
    if (up.includes("MUMGA") && !up.includes("/N")) {
      tok = tok + "/N" + speed + "F330";
      note = (note + " MUMGA").trim();
    }
    out.push(tok);
  }
  tokens.length = 0;
  tokens.push(...out);
  return note;
}

function sidIndex(tokens: string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const up = tokens[i].toUpperCase();
    if (up.startsWith("-N") || up.startsWith("-K")) return i + 1 < tokens.length ? i + 1 : -1;
  }
  return -1;
}

export function fix_route(tokens: string[], dep: string, arr: string, rules: Raw): string[] {
  const notes: string[] = [];
  const work = tokens.filter((t) => String(t).trim());
  if (!work.length) return notes;
  const key = (dep + arr).toUpperCase();
  const pair = dep.toUpperCase() + "-" + arr.toUpperCase();
  const sidIdx = sidIndex(work);
  const noStar = (rules.no_expand || []).includes(pair);
  if (sidIdx >= 0) {
    const sidNote = expandSid(work, sidIdx, rules.special_sid || {});
    if (sidNote) notes.push(sidNote);
    stripSlashNear(work, sidIdx, 1);
    if (!noStar) {
      const starNote = expandStar(work, sidIdx);
      if (starNote) notes.push(starNote);
      const last = work.length - 1;
      stripSlashNear(work, last, -1);
    }
  }
  let cruise = work[0];
  const fl = (rules.fl || {})[key];
  if (fl != null) {
    const [nw, changed] = setFl(cruise, Number(fl));
    if (changed) { work[0] = nw; notes.push("FL " + fl); cruise = nw; }
  }
  if ((rules.mumga || []).includes(key)) {
    const mu = mumga(work, speedOf(cruise));
    if (mu) notes.push(mu);
  }
  tokens.length = 0;
  tokens.push(...work);
  return notes;
}

export function parse_block(block: string): Raw | null {
  const text = String(block || "").trim();
  if (!text.startsWith("(FPL-")) return null;
  const closed = text.endsWith(")");
  const raw = closed ? text.slice(0, -1).trimEnd() : text;
  const lines = raw.split(/\r?\n/).map((ln) => ln.replace(/\s+$/, "")).filter((ln) => ln.trim());
  let depI: number | null = null, routeI: number | null = null, destI: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (routeI === null && RE_ROUTE.test(t)) { routeI = i; continue; }
    const aero = RE_AERO.exec(t);
    if (aero && routeI === null) depI = i;
    else if (aero && routeI !== null && destI === null) { destI = i; break; }
  }
  if (routeI === null || depI === null || destI === null) return null;
  const dep = RE_AERO.exec(lines[depI].trim())![1];
  const arr = RE_AERO.exec(lines[destI].trim())![1];
  const routeLines = lines.slice(routeI, destI);
  const tokens: string[] = [];
  for (const ln of routeLines) tokens.push(...ln.split(/\s+/));
  let call = "";
  const m = RE_CALL.exec(lines[0] || "");
  if (m) call = m[1];
  return { callsign: call, dep, arr, before: lines.slice(0, routeI), after: lines.slice(destI), tokens, closed };
}

function wrapPairs(pairs: [string, boolean][]): [string, boolean][][] {
  const lines: [string, boolean][][] = [];
  let cur: [string, boolean][] = [];
  let width = 0;
  for (const [tok, chg] of pairs) {
    if (!tok) continue;
    if (!cur.length) { cur = [[tok, chg]]; width = tok.length; continue; }
    if (width + 1 + tok.length <= WRAP) { cur.push([tok, chg]); width += 1 + tok.length; }
    else { lines.push(cur); cur = [[tok, chg]]; width = tok.length; }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function indentLine(pairs: [string, boolean][], text: string): string {
  if (pairs.length && !String(pairs[0][0]).startsWith("-") && !text.startsWith(" ")) return " " + text;
  return text;
}

export function mark_tokens(oldT: string[], newT: string[]): [string, boolean][] {
  // Simplified LCS-diff (equivalent to SequenceMatcher opcodes) good enough for marking changes.
  const out: [string, boolean][] = [];
  const n = oldT.length, m = newT.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldT[i] === newT[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldT[i] === newT[j]) { out.push([newT[j], false]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { out.push([newT[j], true]); j++; }
  }
  while (j < m) { out.push([newT[j], true]); j++; }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function tokHtml(tok: string, chg: boolean): string {
  const s = escapeHtml(tok);
  return chg ? `<span class="chg">${s}</span>` : s;
}

export function rebuild_marked(parsed: Raw, marked: [string, boolean][]): [string, string] {
  const routeLines = wrapPairs(marked).length ? wrapPairs(marked) : [[]];
  const textRoute: string[] = [], htmlRoute: string[] = [];
  for (let i = 0; i < routeLines.length; i++) {
    const pairs = routeLines[i];
    let raw = pairs.map(([t]) => t).join(" ");
    let html = pairs.map(([t, c]) => tokHtml(t, c)).join(" ");
    if (i) { raw = indentLine(pairs, raw); html = indentLine(pairs, html); }
    textRoute.push(raw);
    htmlRoute.push(html);
  }
  const before: string[] = parsed.before;
  const after: string[] = parsed.after;
  let text = [...before, ...textRoute, ...after].join("\n").replace(/\s+$/, "");
  let html = [...before.map(escapeHtml), ...htmlRoute, ...after.map(escapeHtml)].join("\n").replace(/\s+$/, "");
  if (parsed.closed ?? true) {
    if (!text.endsWith(")")) text += ")";
    if (!html.endsWith(")")) html += ")";
  }
  return [text, html];
}

export function fix_block(block: string, rules?: Raw | null): [string, string[], string] {
  const parsed = parse_block(block);
  const raw = String(block || "").trim();
  if (parsed === null) return [raw, [], escapeHtml(raw)];
  const table = rules || load_rules();
  const oldT = [...parsed.tokens];
  const notes = fix_route(parsed.tokens, parsed.dep, parsed.arr, table);
  const [text, html] = rebuild_marked(parsed, mark_tokens(oldT, parsed.tokens));
  return [text, notes, html];
}

export function join_fixed(blocks: string[]): string {
  const parts = blocks.map((b) => String(b).trim()).filter((b) => b);
  if (!parts.length) return "";
  return parts.join("\n".repeat(4)) + "\n";
}

export function fix_text(text: string, rules?: Raw | null): [string, Raw[]] {
  const table = rules || load_rules();
  const log: Raw[] = [];
  const out: string[] = [];
  for (const block of split_blocks(text)) {
    const [fixed, notes] = fix_block(block, table);
    const parsed = parse_block(block);
    out.push(fixed);
    log.push({
      callsign: (parsed || {}).callsign || "",
      dep: (parsed || {}).dep || "",
      arr: (parsed || {}).arr || "",
      notes,
      changed: notes.length > 0 || fixed.trim() !== block.trim(),
    });
  }
  return [join_fixed(out), log];
}

export function join_html(parts: string[]): string {
  const bits = parts.map((p) => String(p).replace(/\s+$/, "")).filter((p) => p.trim());
  if (!bits.length) return "";
  return bits.join("\n".repeat(4)) + "\n";
}

export function html_page(body: string): string {
  return (
    `<!doctype html>\n<meta charset="utf-8">\n<title>ATC convert</title>\n` +
    `<style>body{margin:0;background:#111;color:#e8e8e8}` +
    `pre{font:13px/1.45 Consolas,"JetBrains Mono",ui-monospace,monospace;` +
    `padding:18px;white-space:pre-wrap}` +
    `.chg{color:#22c55e;font-weight:700}</style>\n` +
    `<pre>${body || ""}</pre>\n`
  );
}
