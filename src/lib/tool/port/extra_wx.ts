// Port of extra_wx.py — extra phút lõi theo TAF dest: MAX(wx, trần, gió), trần công ty 60.
export const CAP = 60;

type Row4 = [number, number, number, number];
/** Editable rules (Filter setting); missing parts fall back to DEFAULT_EXTRA_WX. */
export type ExtraWxCfg = {
  cap: number;
  vis: [number, number, number]; // A >= vis[0], B >= vis[1], C >= vis[2], else D
  wx: Record<string, Row4>;
  minus: number; plus: number;
  ceil: [number, number][]; // [below ft, minutes], checked from highest ft
  wind: [number, number, number][]; // [mean kt, gust kt, minutes], strongest first
};

const WX: Record<string, Row4> = {
  NSW: [0, 0, 15, 20], BR: [0, 20, 30, 45], HZ: [0, 20, 30, 45],
  DU: [20, 30, 45, 60], SA: [20, 30, 45, 60], DZ: [20, 30, 45, 60],
  RA: [20, 30, 45, 60], SHRA: [20, 30, 45, 60], SH: [20, 30, 45, 60],
  TS: [20, 30, 45, 60], TSRA: [30, 45, 60, 60], SN: [30, 45, 60, 60],
  GS: [30, 45, 60, 60], GR: [30, 45, 60, 60], PL: [30, 45, 60, 60],
  FG: [0, 0, 45, 60], FZFG: [0, 0, 45, 60], FZDZ: [30, 45, 60, 60],
  FZRA: [30, 45, 60, 60], SS: [30, 45, 60, 60], DS: [30, 45, 60, 60],
  VA: [0, 0, 0, 0],
};
export const DEFAULT_EXTRA_WX: ExtraWxCfg = {
  cap: CAP, vis: [5000, 3500, 1500], wx: WX, minus: 10, plus: 15,
  ceil: [[1000, 15], [700, 30], [500, 45], [300, 60]],
  wind: [[35, 45, 30], [25, 35, 15]],
};

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
/** Clamp user input; unknown keys dropped, thresholds sorted descending. */
export function normalizeExtraWxCfg(raw: unknown): ExtraWxCfg {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_EXTRA_WX;
  const cap = num(r.cap, 0, 240) ?? d.cap;
  const visIn = Array.isArray(r.vis) ? r.vis : [];
  const vis = d.vis.map((v, i) => num(visIn[i], 0, 9999) ?? v).sort((a, b) => b - a) as [number, number, number];
  const wx: Record<string, Row4> = {};
  const wxIn = (r.wx && typeof r.wx === "object" ? r.wx : {}) as Record<string, unknown>;
  for (const k of Object.keys(d.wx)) {
    const row = Array.isArray(wxIn[k]) ? (wxIn[k] as unknown[]) : [];
    wx[k] = d.wx[k].map((v, i) => num(row[i], 0, cap) ?? v) as Row4;
  }
  const pairs = (v: unknown, w: number): number[][] | null =>
    Array.isArray(v) ? v.filter(Array.isArray).map((x) => (x as unknown[]).slice(0, w).map((y) => Number(y)))
      .filter((x) => x.length === w && x.every((y) => Number.isFinite(y) && y >= 0)) : null;
  const ceil = (pairs(r.ceil, 2) ?? d.ceil).map(([a, b]) => [Math.round(a), Math.min(cap, Math.round(b))] as [number, number])
    .sort((a, b) => b[0] - a[0]);
  const wind = (pairs(r.wind, 3) ?? d.wind).map(([a, b, c]) => [Math.round(a), Math.round(b), Math.min(cap, Math.round(c))] as [number, number, number])
    .sort((a, b) => b[2] - a[2]);
  return { cap, vis, wx, minus: num(r.minus, 0, 60) ?? d.minus, plus: num(r.plus, 0, 60) ?? d.plus, ceil, wind };
}

const ALIAS: Record<string, string> = {
  TSSN: "TSRA", TSGR: "TSRA", TSGS: "TSRA", TSPL: "TSRA",
  SHSN: "SN", SHGR: "GR", SHGS: "GS",
};

const WX_FIND = new RegExp(
  "(?<![A-Z])([+-])?(" +
    "TSRA|TSSN|TSGR|TSGS|TSPL|FZRA|FZDZ|FZFG|" +
    "SHRA|SHSN|SHGR|SHGS|" +
    "TS|RA|DZ|SN|GS|GR|PL|FG|BR|HZ|DU|SA|SS|DS|VA|SH" +
    ")\\b",
  "g",
);
const RE_VIS_M = /\b(\d{4})\b/g;
const RE_RVR = /\bR\d{2}[A-Z]?\/([PM])?(\d{4})\b/gi;
const RE_CLOUD = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/gi;
const RE_WIND = /\b(?:VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/gi;

export function visBand(meters: number | null, cfg: ExtraWxCfg = DEFAULT_EXTRA_WX): "A" | "B" | "C" | "D" {
  if (meters === null) return "A";
  if (meters >= cfg.vis[0]) return "A";
  if (meters >= cfg.vis[1]) return "B";
  if (meters >= cfg.vis[2]) return "C";
  return "D";
}

function bandIdx(band: string): number {
  return { A: 0, B: 1, C: 2, D: 3 }[band] ?? 0;
}

function visM(text: string): number | null {
  const u = String(text || "").toUpperCase();
  if (u.includes("CAVOK") || u.includes("P6SM")) return 9999;
  let rvrBest: number | null = null;
  RE_RVR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_RVR.exec(u))) {
    let n = parseInt(m[2], 10);
    if ((m[1] || "").toUpperCase() === "P") n = Math.max(n, 2000);
    rvrBest = rvrBest === null ? n : Math.min(rvrBest, n);
  }
  if (rvrBest !== null) return rvrBest;
  let best: number | null = null;
  RE_VIS_M.lastIndex = 0;
  while ((m = RE_VIS_M.exec(u))) {
    const v = m[1];
    const i = m.index;
    if (/\d{5}/.test(u.slice(Math.max(0, i - 1), i + 6))) continue;
    const n = parseInt(v, 10);
    if (n > 9999) continue;
    best = best === null ? n : Math.min(best, n);
  }
  return best;
}

function ceilFt(text: string): number | null {
  let best: number | null = null;
  RE_CLOUD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CLOUD.exec(String(text || "").toUpperCase()))) {
    if (!["BKN", "OVC", "VV"].includes(m[1].toUpperCase())) continue;
    const h = parseInt(m[2], 10) * 100;
    best = best === null ? h : Math.min(best, h);
  }
  return best;
}

function windKt(text: string): [number, number] {
  let mean = 0, gust = 0;
  RE_WIND.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_WIND.exec(String(text || "").toUpperCase()))) {
    mean = Math.max(mean, parseInt(m[1], 10));
    if (m[2]) gust = Math.max(gust, parseInt(m[2], 10));
  }
  return [mean, gust];
}

function wxMin(text: string, band: string, cfg: ExtraWxCfg): [number, string[]] {
  const WX = cfg.wx, CAP = cfg.cap;
  const u = String(text || "").toUpperCase();
  const idx = bandIdx(band);
  let best = 0;
  let why: string[] = [];
  let seen = false, ts = false;
  WX_FIND.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WX_FIND.exec(u))) {
    const sign = m[1] || "";
    const raw = m[2];
    const code = ALIAS[raw] || raw;
    const row = WX[code];
    if (!row) continue;
    seen = true;
    if (code === "TS" || code === "TSRA") ts = true;
    let n = row[idx];
    if (code === "VA") n = 0;
    else if (sign === "-") n = Math.max(0, n - cfg.minus);
    else if (sign === "+") n = Math.min(CAP, n + cfg.plus);
    if (n >= best) {
      best = n;
      const tag = sign + raw;
      why = [`wx ${tag} dải ${band} = ${n}p`];
    }
  }
  if (u.includes("CB") && !ts) {
    const n = WX.TS[idx];
    seen = true;
    if (n > best) { best = n; why = [`wx CB→TS dải ${band} = ${n}p`]; }
  }
  if (!seen) {
    const n = WX.NSW[idx];
    if (n > best) { best = n; why = [`wx NSW dải ${band} = ${n}p`]; }
  }
  return [best, why];
}

function ceilMin(ft: number | null, cfg: ExtraWxCfg): [number, string] {
  if (ft === null) return [0, ""];
  let n = 0;
  for (const [below, m] of cfg.ceil) if (ft < below) n = Math.max(n, m);
  if (!n) return [0, ""];
  return [n, `trần ${ft} ft = ${n}p`];
}

function windMin(mean: number, gust: number, cfg: ExtraWxCfg): [number, string] {
  let n = 0;
  for (const [m, g, v] of cfg.wind) if ((m > 0 && mean >= m) || (g > 0 && gust >= g)) n = Math.max(n, v);
  if (!n) return [0, ""];
  const bit = `${mean}KT` + (gust ? ` G${gust}` : "");
  return [n, `gió ${bit} = ${n}p`];
}

export type Need = {
  minutes: number; wx: number; ceil: number; wind: number;
  vis: number | null; band: string; why: string;
};

export function needOfText(text: string, cfg: ExtraWxCfg = DEFAULT_EXTRA_WX): Need {
  const blob = String(text || "");
  const vis = visM(blob);
  const band = visBand(vis, cfg);
  const [wxN, wxWhy] = wxMin(blob, band, cfg);
  const [ceilN, ceilWhy] = ceilMin(ceilFt(blob), cfg);
  const [mean, gust] = windKt(blob);
  const [windN, windWhy] = windMin(mean, gust, cfg);
  const minutes = Math.min(cfg.cap, Math.max(wxN, ceilN, windN));
  const parts = [...wxWhy, ...(ceilWhy ? [ceilWhy] : []), ...(windWhy ? [windWhy] : [])].filter(Boolean);
  return {
    minutes, wx: wxN, ceil: ceilN, wind: windN, vis, band,
    why: parts.length ? parts.join(" · ") : "0p",
  };
}

export function needOfTexts(chunks: string[], cfg: ExtraWxCfg = DEFAULT_EXTRA_WX): Need {
  let best: Need = { minutes: 0, wx: 0, ceil: 0, wind: 0, vis: null, band: "A", why: "0p" };
  for (const ch of chunks) {
    if (!String(ch || "").trim()) continue;
    const got = needOfText(ch, cfg);
    if (got.minutes >= best.minutes) best = got;
  }
  return best;
}
