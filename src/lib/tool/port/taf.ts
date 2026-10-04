// Port of taf.py — TAF scoring / advice, TSN MET dropdown slot parsing.
// Pure module: no server-only imports (fetch is a global web API).
import * as extraWx from "./extra_wx";

export const VIS_BAD_M = 5000;
export const CEIL_BAD_FT = 1500;
export const GUST_BAD_KT = 25;

const RE_TAF = /(TAF(?:\s+AMD|\s+COR)?\s+([A-Z]{4})\b[\s\S]*?=)/gi;
const RE_HDR = /^TAF(?:\s+(?:AMD|COR))?\s+([A-Z]{4})\s+(\d{6})Z\s+(\d{4}\/\d{4})\s*([\s\S]*)$/i;
const RE_HDR_NOISSUE = /^TAF(?:\s+(?:AMD|COR))?\s+([A-Z]{4})\s+(\d{4}\/\d{4})\s*([\s\S]*)$/i;
const RE_NIL = /^TAF\s+([A-Z]{4})\s*:\s*NIL/i;
const RE_FM = /\bFM(\d{6})\b/g;
const RE_BECMG = /\bBECMG\s+(\d{4}\/\d{4})\b/g;
const RE_TEMPO = /\bTEMPO\s+(\d{4}\/\d{4})\b/g;
const RE_PROB = /\bPROB(\d{2})\s+(\d{4}\/\d{4})\b/g;
const RE_VIS_M = /\b(\d{4})\b/g;
const RE_VIS_SM = /\b(P?\d+(?:\s+\d+\/\d+)?)\s*SM\b/i;
const RE_CLOUD = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/gi;
const RE_GUST = /\b\d{5}G(\d{2,3})KT\b|\bVRB\d{2}G(\d{2,3})KT\b/gi;

export type TafGroup = {
  kind: string;
  token: string;
  start: string;
  end: string;
  text: string;
};

export type TafRec = {
  icao: string;
  nil: boolean;
  issue?: string;
  valid?: string;
  valid_from?: string;
  valid_to?: string;
  raw: string;
  groups: TafGroup[];
};

export type TafAdvice = {
  icao: string;
  status: "ok" | "bad" | "nil" | "missing";
  label: string;
  tip: string;
  when: string;
  snippet: string;
  raw: string;
  segments: { text: string; hit: boolean }[];
  extra_need: number;
  extra_why: string;
};

function mkAdvice(icao: string, status: TafAdvice["status"], label: string, extra: Partial<TafAdvice> = {}): TafAdvice {
  return {
    icao, status, label,
    tip: "", when: "", snippet: "", raw: "", segments: [], extra_need: 0, extra_why: "",
    ...extra,
  };
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

/** DDHHMM -> datetime UTC. HH=24 = 00:00 ngày hôm sau. */
export function parseDdhhmm(token: string, ref: Date): Date {
  const dd = parseInt(token.slice(0, 2), 10);
  let hh = parseInt(token.slice(2, 4), 10);
  const mm = parseInt(token.slice(4, 6), 10);
  let y = ref.getUTCFullYear();
  let m = ref.getUTCMonth() + 1;
  let addDay = 0;
  if (hh === 24) { hh = 0; addDay = 1; }
  const mkDate = (yy: number, mo: number, d: number, h: number, mi: number) => {
    const dt = new Date(Date.UTC(yy, mo - 1, d, h, mi));
    // detect invalid day-of-month rollover (JS Date doesn't throw like Python)
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  };
  let dt = mkDate(y, m, dd, hh, mm);
  if (!dt) {
    if (dd < ref.getUTCDate() - 15) {
      m += 1; if (m > 12) { m = 1; y += 1; }
    } else if (dd > ref.getUTCDate() + 15) {
      m -= 1; if (m < 1) { m = 12; y -= 1; }
    }
    dt = mkDate(y, m, dd, hh, mm) ?? new Date(Date.UTC(y, m - 1, dd, hh, mm));
  }
  if (addDay) dt = new Date(dt.getTime() + 86400000);
  if (dt.getTime() < ref.getTime() - 20 * 86400000) {
    let m2 = m + 1, y2 = y;
    if (m2 > 12) { m2 = 1; y2 = y + 1; }
    let dt2 = mkDate(y2, m2, dd, hh, mm);
    if (dt2) {
      if (addDay) dt2 = new Date(dt2.getTime() + 86400000);
      if (Math.abs(dt2.getTime() - ref.getTime()) < Math.abs(dt.getTime() - ref.getTime())) dt = dt2;
    }
  }
  return dt;
}

/** AABB/CCDD = start DDHH / end DDHH (phút = 00). */
export function parsePair(token: string, ref: Date): [Date, Date] {
  const [a, b] = token.split("/");
  let start = parseDdhhmm(a + "00", ref);
  let end = parseDdhhmm(b + "00", ref);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return [start, end];
}

function visMeters(text: string): number | null {
  const m = RE_VIS_SM.exec(text);
  if (m) {
    const raw = m[1].toUpperCase().replace(/\s+/g, "");
    if (raw.startsWith("P")) return 9999;
    let sm: number;
    if (raw.includes("/")) {
      const parts = m[1].split(" ");
      if (parts.length === 2 && parts[1].includes("/")) {
        const w = parseFloat(parts[0]);
        const [n, d] = parts[1].split("/");
        sm = w + parseFloat(n) / parseFloat(d);
      } else {
        const [n, d] = raw.split("/");
        sm = parseFloat(n) / parseFloat(d);
      }
    } else {
      sm = parseFloat(raw);
    }
    return Math.trunc(sm * 1609.34);
  }
  RE_VIS_M.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = RE_VIS_M.exec(text))) {
    const v = mm[1];
    if (v.length !== 4) continue;
    const i = mm.index;
    const around = text.slice(Math.max(0, i - 1), i + 6);
    if (/\d{5}/.test(around)) continue;
    return parseInt(v, 10);
  }
  return null;
}

function minCeilingFt(text: string): number | null {
  let best: number | null = null;
  RE_CLOUD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CLOUD.exec(text))) {
    const kind = m[1].toUpperCase();
    if (!["BKN", "OVC", "VV"].includes(kind)) continue;
    const h = parseInt(m[2], 10) * 100;
    best = best === null ? h : Math.min(best, h);
  }
  return best;
}

function maxGustKt(text: string): number | null {
  let best: number | null = null;
  RE_GUST.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_GUST.exec(text))) {
    const g = parseInt(m[1] || m[2], 10);
    best = best === null ? g : Math.max(best, g);
  }
  return best;
}

function isBadWx(text: string): [boolean, string[]] {
  const reasons: string[] = [];
  const u = text.toUpperCase();
  if (/\bTS(RA|GR)?\b|\+?TS\b/.test(u)) reasons.push("dông/TSRA");
  if (/CB\b/.test(u)) reasons.push("có CB");
  if (/\bFG\b|\+FZ/.test(u)) reasons.push("sương mù/băng");
  if (/\b(SH)?RA\b.*\bBR\b|\bBR\b.*\b(SH)?RA\b/.test(u)) reasons.push("mưa + BR");
  const vis = visMeters(u);
  if (vis !== null && vis < VIS_BAD_M) reasons.push(`tầm nhìn ${vis} m`);
  const ceil = minCeilingFt(u);
  if (ceil !== null && ceil < CEIL_BAD_FT) reasons.push(`ceiling ${ceil} ft`);
  const gust = maxGustKt(u);
  if (gust !== null && gust >= GUST_BAD_KT && (u.includes("TS") || u.includes("CB") || u.includes("SHRA"))) {
    reasons.push(`giật ${gust} kt kèm mưa/dông`);
  }
  return [reasons.length > 0, reasons];
}

function normalizeBody(raw: string): string {
  let s = raw.replace(/<[^>]+>/g, " ");
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function parseTafBlock(raw: string): TafRec | null {
  const text = normalizeBody(raw);
  const mnil = RE_NIL.exec(text);
  if (mnil) return { icao: mnil[1].toUpperCase(), nil: true, raw: text, groups: [] };

  let icao: string, issue: string, valid: string, body: string;
  const m = RE_HDR.exec(text);
  if (!m) {
    const m2 = RE_HDR_NOISSUE.exec(text);
    if (!m2) return null;
    icao = m2[1].toUpperCase();
    valid = m2[2];
    body = m2[3];
    issue = valid.slice(0, 4) + "00";
  } else {
    icao = m[1].toUpperCase();
    issue = m[2];
    valid = m[3];
    body = m[4];
  }

  const now = new Date();
  const ref = parseDdhhmm(issue, now);
  const [v0, v1] = parsePair(valid, ref);

  type Marker = [number, string, string];
  const markers: Marker[] = [];
  let mm: RegExpExecArray | null;
  RE_FM.lastIndex = 0;
  while ((mm = RE_FM.exec(body))) markers.push([mm.index, "FM", mm[1]]);
  RE_BECMG.lastIndex = 0;
  while ((mm = RE_BECMG.exec(body))) markers.push([mm.index, "BECMG", mm[1]]);
  RE_TEMPO.lastIndex = 0;
  while ((mm = RE_TEMPO.exec(body))) markers.push([mm.index, "TEMPO", mm[1]]);
  RE_PROB.lastIndex = 0;
  while ((mm = RE_PROB.exec(body))) markers.push([mm.index, `PROB${mm[1]}`, mm[2]]);
  markers.sort((a, b) => a[0] - b[0]);

  const parts: [string, string, string][] = [];
  if (markers.length === 0) {
    parts.push(["BASE", valid, body.trim()]);
  } else {
    const first = markers[0][0];
    const base = body.slice(0, first).trim();
    if (base) parts.push(["BASE", valid, base]);
    for (let i = 0; i < markers.length; i++) {
      const [pos, kind, win] = markers[i];
      const end = i + 1 < markers.length ? markers[i + 1][0] : body.length;
      let chunk = body.slice(pos, end);
      chunk = chunk.trim().replace(/^(FM\d{6}|BECMG\s+\d{4}\/\d{4}|TEMPO\s+\d{4}\/\d{4}|PROB\d{2}\s+\d{4}\/\d{4})\s*/i, "");
      parts.push([kind, win, chunk]);
    }
  }

  const groups: TafGroup[] = [];
  for (const [kind, win, chunk] of parts) {
    if (kind === "FM") {
      const start = parseDdhhmm(win, v0);
      groups.push({ kind, token: win, start: start.toISOString(), end: v1.toISOString(), text: chunk });
    } else if (kind === "BASE") {
      groups.push({ kind, token: valid, start: v0.toISOString(), end: v1.toISOString(), text: chunk });
    } else {
      const [s, e] = parsePair(win, v0);
      groups.push({ kind, token: win, start: s.toISOString(), end: e.toISOString(), text: chunk });
    }
  }

  return {
    icao, nil: false, issue, valid,
    valid_from: v0.toISOString(), valid_to: v1.toISOString(),
    raw: text, groups,
  };
}

function groupLabel(g: TafGroup): string {
  const kind = g.kind || "BASE";
  const text = (g.text || "").trim().replace(/=+$/, "").trim();
  let tok = (g.token || "").trim();
  if (!tok && kind !== "BASE") {
    const s = new Date(g.start), e = new Date(g.end);
    if (!Number.isNaN(s.getTime())) {
      if (kind === "FM") {
        tok = pad2(s.getUTCDate()) + pad2(s.getUTCHours()) + pad2(s.getUTCMinutes());
      } else {
        tok = `${pad2(s.getUTCDate())}${pad2(s.getUTCHours())}/${pad2(e.getUTCDate())}${pad2(e.getUTCHours())}`;
      }
    }
  }
  if (kind === "BASE") return text;
  if (kind === "FM") return `FM${tok} ${text}`.trim();
  return `${kind} ${tok} ${text}`.trim();
}

function segmentsForSta(rec: TafRec, when: Date): { text: string; hit: boolean }[] {
  const raw = (rec.raw || "").trim();
  if (rec.nil || !rec.groups || rec.groups.length === 0) {
    return [{ text: raw || "NIL", hit: false }];
  }
  const groups = rec.groups;
  let mainI: number | null = null;
  groups.forEach((g, i) => {
    if (["BASE", "FM", "BECMG"].includes(g.kind)) {
      const s = new Date(g.start);
      if (s.getTime() <= when.getTime()) mainI = i;
    }
  });
  const hits = new Set<number>();
  if (mainI !== null) hits.add(mainI);
  groups.forEach((g, i) => {
    const kind = g.kind || "";
    if (!kind.startsWith("TEMPO") && !kind.startsWith("PROB")) return;
    const s = new Date(g.start), e = new Date(g.end);
    if (s.getTime() - 20 * 60000 <= when.getTime() && when.getTime() <= e.getTime() + 10 * 60000) hits.add(i);
  });

  const icao = rec.icao || "";
  const issue = rec.issue || "";
  const valid = rec.valid || "";
  let prefix = "TAF";
  if (/^TAF\s+AMD\b/i.test(raw)) prefix = "TAF AMD";
  else if (/^TAF\s+COR\b/i.test(raw)) prefix = "TAF COR";
  let header = `${prefix} ${icao}`;
  if (issue) header += ` ${issue}Z`;
  if (valid) header += ` ${valid}`;

  const segs: { text: string; hit: boolean }[] = [{ text: header, hit: false }];
  groups.forEach((g, i) => {
    const label = groupLabel(g);
    if (!label) return;
    segs.push({ text: " " + label, hit: hits.has(i) });
  });
  segs.push({ text: "=", hit: false });
  return segs;
}

export function advise(icao0: string, when0: Date, tafs: Record<string, TafRec>): TafAdvice {
  const icao = (icao0 || "").toUpperCase().trim();
  const when = when0;
  const rec = tafs[icao];
  if (!rec) return mkAdvice(icao, "missing", "—", { tip: "Chưa có TAF trong cache", when: when.toISOString() });
  const raw = rec.raw || "";
  const segs = segmentsForSta(rec, when);
  if (rec.nil) {
    return mkAdvice(icao, "nil", "WX NIL", { tip: "TAF NIL", when: when.toISOString(), snippet: raw, raw, segments: segs });
  }

  const v0 = new Date(rec.valid_from!);
  const v1 = new Date(rec.valid_to!);
  if (when.getTime() < v0.getTime() - 30 * 60000 || when.getTime() > v1.getTime() + 30 * 60000) {
    return mkAdvice(icao, "nil", "ngoài TAF", {
      tip: `Ngoài hiệu lực ${rec.valid}`, when: when.toISOString(),
      snippet: raw.slice(0, 200), raw, segments: segs,
    });
  }

  let mainText = "";
  for (const g of rec.groups) {
    if (["BASE", "FM", "BECMG"].includes(g.kind)) {
      const s = new Date(g.start);
      if (s.getTime() <= when.getTime()) mainText = g.text;
    }
  }

  const overlays: TafGroup[] = [];
  for (const g of rec.groups) {
    if (!g.kind.startsWith("TEMPO") && !g.kind.startsWith("PROB")) continue;
    const s = new Date(g.start), e = new Date(g.end);
    if (s.getTime() <= when.getTime() && when.getTime() < e.getTime()) overlays.push(g);
  }

  const reasons: string[] = [];
  const snippets: string[] = [];
  for (const g of overlays) {
    const [bad, why] = isBadWx(g.text);
    if (bad) {
      reasons.push(...why.map((r) => `${g.kind}: ${r}`));
      snippets.push(`${g.kind} ${g.start.slice(11, 16)}-${g.end.slice(11, 16)}Z ${g.text}`);
    }
  }
  if (reasons.length === 0 && mainText) {
    const [bad, why] = isBadWx(mainText);
    if (bad) {
      reasons.push(...why.map((r) => `nền: ${r}`));
      snippets.push(mainText);
    }
  }

  const need = extraWx.needOfTexts([mainText, ...overlays.map((g) => g.text)]);
  const extraKw = { extra_need: Math.trunc(need.minutes || 0), extra_why: String(need.why || "") };

  if (reasons.length) {
    const tip = reasons.join(" · ");
    return mkAdvice(icao, "bad", "WX xấu - cần extra", {
      tip, when: when.toISOString(),
      snippet: snippets.join(" | ") || raw.slice(0, 240),
      raw, segments: segs, ...extraKw,
    });
  }

  const tip = mainText || "không có hiện tượng xấu tại giờ đáp";
  return mkAdvice(icao, "ok", "WX tốt", {
    tip, when: when.toISOString(),
    snippet: mainText || raw.slice(0, 240),
    raw, segments: segs, ...extraKw,
  });
}

// ---------------- TSN MET dropdown slot parsing ----------------

export function parseCboSlot(val: string): Date | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{4})$/.exec((val || "").trim());
  if (!m) return null;
  const [, ddS, hhS, miS, moS, yyS] = m;
  const dd = parseInt(ddS, 10), hh = parseInt(hhS, 10), mi = parseInt(miS, 10);
  const mo = parseInt(moS, 10), yy = parseInt(yyS, 10);
  if (mo < 1 || mo > 12 || hh > 23 || mi > 59) return null;
  const dt = new Date(Date.UTC(yy, mo - 1, dd, hh, mi));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== dd) return null;
  return dt;
}

export function datetimeOptions(html: string): string[] {
  const m = /<select[^>]*name="cboDatetime"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!m) return [];
  const rows: [Date, string][] = [];
  let selectedDt: Date | null = null;
  const reOpt = /<option\b([^>]*)>/gi;
  let om: RegExpExecArray | null;
  while ((om = reOpt.exec(m[1]))) {
    const attrs = om[1];
    const vm = /\bvalue=(["'])([^"']*)\1/i.exec(attrs);
    if (!vm) continue;
    const val = vm[2].trim();
    const dt = parseCboSlot(val);
    if (!val || !dt) continue;
    rows.push([dt, val]);
    if (/\bselected\b/i.test(attrs)) selectedDt = dt;
  }
  if (rows.length === 0) return [];
  const firstDt = rows[0][0], lastDt = rows[rows.length - 1][0];
  let cap: Date;
  if (firstDt.getTime() > lastDt.getTime() && (selectedDt === null || selectedDt.getTime() === firstDt.getTime())) {
    cap = firstDt;
  } else {
    cap = lastDt;
  }
  const seen = new Set<string>();
  const issued: [Date, string][] = [];
  for (const [dt, val] of rows) {
    if (dt.getTime() > cap.getTime() || seen.has(val)) continue;
    seen.add(val);
    issued.push([dt, val]);
  }
  issued.sort((a, b) => b[0].getTime() - a[0].getTime());
  return issued.map(([, val]) => val);
}

// ---------------- Network fetch (TSN / mirror) ----------------

export const BASES = ["http://113.161.121.25", "http://118.69.213.84"];
const USER = "vietjet";
const PASS = "Vietjet@air";

async function openSession(): Promise<{ base: string; cookie: string }> {
  const errors: string[] = [];
  for (const base of BASES) {
    try {
      const r0 = await fetch(`${base}/index.php?cat=2&sub=0`, { redirect: "manual" });
      const cookie0 = r0.headers.get("set-cookie") || "";
      const form = new URLSearchParams({
        act: "login", req: "2,0", txtUsername: USER, txtPassword: PASS, cmdLogin: "Login",
      });
      const r1 = await fetch(`${base}/index.php`, {
        method: "POST", body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie0 },
        redirect: "manual",
      });
      const text = await r1.text();
      const cookie1 = r1.headers.get("set-cookie") || cookie0;
      if (text.includes("txtPassword")) throw new Error(`Đăng nhập TAF thất bại tại ${base}`);
      return { base, cookie: cookie1 };
    } catch (exc) {
      errors.push(`${base}: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }
  throw new Error("Không kết nối được đài TAF nào.\n" + errors.join("\n"));
}

export type TafSnapshot = {
  fetched_at: string;
  source: string;
  datetime: string;
  slots: string[];
  count: number;
  active: number;
  tafs: Record<string, TafRec>;
};

/** Port of fetch_latest(). Requires network access to the TSN MET mirrors. */
export async function fetchLatest(opts: { preferVv?: boolean } = {}): Promise<TafSnapshot> {
  const { base, cookie } = await openSession();
  const qs0 = new URLSearchParams({ cat: "2", sub: "0", type: "3", cboDatetime: "", cboElement: "" });
  const r0 = await fetch(`${base}/index.php?${qs0.toString()}`, { headers: { cookie } });
  const html0 = await r0.text();
  let opts_: string[] = datetimeOptions(html0);
  if (opts_.length === 0) {
    const now = new Date();
    const h = Math.floor(now.getUTCHours() / 3) * 3;
    const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0));
    opts_ = [`${pad2(slot.getUTCDate())}${pad2(h)}00${pad2(slot.getUTCMonth() + 1)}${slot.getUTCFullYear()}`];
  }

  const tafs: Record<string, TafRec> = {};
  const used: string[] = [];
  for (const dt of opts_.slice(0, 4)) {
    const qs = new URLSearchParams({ cat: "2", sub: "0", type: "3", cboDatetime: dt, cboElement: "" });
    const r = await fetch(`${base}/index.php?${qs.toString()}`, { headers: { cookie } });
    const html = await r.text();
    const plain = html.replace(/<[^>]+>/g, "\n");
    let got = 0;
    let m: RegExpExecArray | null;
    RE_TAF.lastIndex = 0;
    while ((m = RE_TAF.exec(plain))) {
      const raw = m[1];
      let icao = m[2].toUpperCase();
      if (opts.preferVv && !icao.startsWith("VV")) continue;
      let parsed: TafRec | null;
      try { parsed = parseTafBlock(raw); } catch { continue; }
      if (!parsed) continue;
      icao = parsed.icao;
      const prev = tafs[icao];
      if (!prev) { tafs[icao] = parsed; got++; }
      else if (prev.nil && !parsed.nil) { tafs[icao] = parsed; got++; }
      // else keep existing (prefer newer slot already loaded, or keep non-nil)
    }
    used.push(dt);
    void got;
  }

  return {
    fetched_at: new Date().toISOString(),
    source: base,
    datetime: used[0] || "",
    slots: used,
    count: Object.keys(tafs).length,
    active: Object.values(tafs).filter((t) => !t.nil).length,
    tafs,
  };
}

const HEADS_UP_MS = 60 * 60000;

function badSoonAfter(dest: string, windowEnd: Date, tafs: Record<string, TafRec>): string {
  const rec = tafs[(dest || "").toUpperCase().trim()];
  if (!rec || rec.nil) return "";
  const limit = new Date(windowEnd.getTime() + HEADS_UP_MS);
  let soonest: [Date, TafAdvice] | null = null;
  for (const g of rec.groups || []) {
    const start = new Date(g.start);
    if (Number.isNaN(start.getTime())) continue;
    if (!(windowEnd.getTime() < start.getTime() && start.getTime() <= limit.getTime())) continue;
    const item = advise(dest, new Date(start.getTime() + 60000), tafs);
    if (item.status === "bad" && (soonest === null || start.getTime() < soonest[0].getTime())) soonest = [start, item];
  }
  if (!soonest) return "";
  const [start, item] = soonest;
  const gap = Math.round((start.getTime() - windowEnd.getTime()) / 60000);
  return `⚠ ngoài khung — ${pad2(start.getUTCHours())}:${pad2(start.getUTCMinutes())}Z (sau khung ${gap} phút) mới có: ${item.tip}`;
}

export function adviceForFlight(dest: string, staIso: string | null | undefined, tafs: Record<string, TafRec> | null): Record<string, unknown> {
  if (!dest || !staIso) return { ...mkAdvice(dest || "?", "missing", "—", { tip: "Thiếu sân đáp hoặc STA" }) };
  const when = new Date(staIso.replace("Z", "+00:00"));
  if (Number.isNaN(when.getTime())) return { ...mkAdvice(dest, "missing", "—", { tip: "STA không đọc được" }) };
  if (!tafs || Object.keys(tafs).length === 0) {
    return { ...mkAdvice(dest, "missing", "—", { tip: "Chưa tải TAF — bấm nút 🔄 TAF" }) };
  }
  const windowStart = new Date(when.getTime() - 60 * 60000);
  const windowEnd = new Date(when.getTime() + 60 * 60000);

  const checks: TafAdvice[] = [];
  for (let i = 0; i < 13; i++) checks.push(advise(dest, new Date(windowStart.getTime() + 10 * i * 60000), tafs));
  const center = checks[6];
  const bad = checks.filter((it) => it.status === "bad");
  const result: TafAdvice = { ...(bad[0] || center) };

  const windowText = `Tham chiếu ETA ±1h: ${pad2(windowStart.getUTCHours())}:${pad2(windowStart.getUTCMinutes())}–${pad2(windowEnd.getUTCHours())}:${pad2(windowEnd.getUTCMinutes())}Z`;
  if (bad.length) {
    const details: string[] = [];
    for (const item of bad) {
      const d = new Date(item.when);
      const stamp = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
      const text = `${stamp}: ${item.tip}`;
      if (!details.includes(text)) details.push(text);
    }
    result.tip = windowText + " · " + details.join(" · ");
    result.when = when.toISOString();
    result.label = "WX xấu - cần extra";
  } else {
    result.tip = windowText + " · " + (center.tip || "không có hiện tượng xấu");
    const headsUp = badSoonAfter(dest, windowEnd, tafs);
    if (headsUp) result.tip += " · " + headsUp;
    result.when = when.toISOString();
  }
  const peak = checks.reduce((a, b) => (Math.trunc(b.extra_need || 0) > Math.trunc(a.extra_need || 0) ? b : a));
  result.extra_need = Math.trunc(peak.extra_need || 0);
  result.extra_why = String(peak.extra_why || "");
  return { ...result };
}

/** Same ETA ±1h window as advice_for_flight, but for the tooltip tab (center check). */
export function adviceWindow(icao: string, when: Date, tafs: Record<string, TafRec>): TafAdvice {
  const windowStart = new Date(when.getTime() - 60 * 60000);
  const checks: TafAdvice[] = [];
  for (let i = 0; i < 13; i++) checks.push(advise(icao, new Date(windowStart.getTime() + 10 * i * 60000), tafs));
  const center: TafAdvice = { ...checks[6] };
  const usable = checks.filter((it) => it.status !== "missing" && it.label !== "ngoài TAF");
  const pool = usable.length ? usable : checks;
  const peak = pool.reduce((a, b) => (Math.trunc(b.extra_need || 0) > Math.trunc(a.extra_need || 0) ? b : a));
  center.extra_need = Math.trunc(peak.extra_need || 0);
  center.extra_why = String(peak.extra_why || "");
  if (center.segments.length === 0 && peak.segments.length) center.segments = peak.segments;
  return center;
}
