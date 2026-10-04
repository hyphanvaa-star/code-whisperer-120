// Port of extra_wx.py — extra phút lõi theo TAF dest: MAX(wx, trần, gió), trần công ty 60.
export const CAP = 60;

const WX: Record<string, [number, number, number, number]> = {
  NSW: [0, 0, 15, 20], BR: [0, 20, 30, 45], HZ: [0, 20, 30, 45],
  DU: [20, 30, 45, 60], SA: [20, 30, 45, 60], DZ: [20, 30, 45, 60],
  RA: [20, 30, 45, 60], SHRA: [20, 30, 45, 60], SH: [20, 30, 45, 60],
  TS: [20, 30, 45, 60], TSRA: [30, 45, 60, 60], SN: [30, 45, 60, 60],
  GS: [30, 45, 60, 60], GR: [30, 45, 60, 60], PL: [30, 45, 60, 60],
  FG: [0, 0, 45, 60], FZFG: [0, 0, 45, 60], FZDZ: [30, 45, 60, 60],
  FZRA: [30, 45, 60, 60], SS: [30, 45, 60, 60], DS: [30, 45, 60, 60],
  VA: [0, 0, 0, 0],
};
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

export function visBand(meters: number | null): "A" | "B" | "C" | "D" {
  if (meters === null) return "A";
  if (meters >= 5000) return "A";
  if (meters >= 3500) return "B";
  if (meters >= 1500) return "C";
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

function wxMin(text: string, band: string): [number, string[]] {
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
    else if (sign === "-") n = Math.max(0, n - 10);
    else if (sign === "+") n = Math.min(CAP, n + 15);
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

function ceilMin(ft: number | null): [number, string] {
  if (ft === null) return [0, ""];
  if (ft >= 1000) return [0, ""];
  let n: number;
  if (ft >= 700) n = 15;
  else if (ft >= 500) n = 30;
  else if (ft >= 300) n = 45;
  else n = 60;
  return [n, `trần ${ft} ft = ${n}p`];
}

function windMin(mean: number, gust: number): [number, string] {
  let n: number;
  if (mean >= 35 || gust >= 45) n = 30;
  else if (mean >= 25 || gust >= 35) n = 15;
  else return [0, ""];
  const bit = `${mean}KT` + (gust ? ` G${gust}` : "");
  return [n, `gió ${bit} = ${n}p`];
}

export type Need = {
  minutes: number; wx: number; ceil: number; wind: number;
  vis: number | null; band: string; why: string;
};

export function needOfText(text: string): Need {
  const blob = String(text || "");
  const vis = visM(blob);
  const band = visBand(vis);
  const [wxN, wxWhy] = wxMin(blob, band);
  const [ceilN, ceilWhy] = ceilMin(ceilFt(blob));
  const [mean, gust] = windKt(blob);
  const [windN, windWhy] = windMin(mean, gust);
  const minutes = Math.min(CAP, Math.max(wxN, ceilN, windN));
  const parts = [...wxWhy, ...(ceilWhy ? [ceilWhy] : []), ...(windWhy ? [windWhy] : [])].filter(Boolean);
  return {
    minutes, wx: wxN, ceil: ceilN, wind: windN, vis, band,
    why: parts.length ? parts.join(" · ") : "0p",
  };
}

export function needOfTexts(chunks: string[]): Need {
  let best: Need = { minutes: 0, wx: 0, ceil: 0, wind: 0, vis: null, band: "A", why: "0p" };
  for (const ch of chunks) {
    if (!String(ch || "").trim()) continue;
    const got = needOfText(ch);
    if (got.minutes >= best.minutes) best = got;
  }
  return best;
}
