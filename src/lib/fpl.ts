// Port of fpl_tool.py render_fpl / build_req (client-safe; lookup tables come from the server).
export type FplDb = {
  tlk: string; dsp: string; legendCpt2: string; legendFo: string;
  etp: Record<string, [string, string]>;
  alt: Record<string, { etp_pod: string; talt: string; fl: string; etp_poa: string; alt1: string; alt2: string }>;
  era: Record<string, string>; tz: Record<string, string>; domestic: string[]; neo: string[];
  ci: { id: string; a320: string; a321ceo: string; a321neo: string; a330: string; airports: string[] }[];
  suffix: { route: string; kapli: string; envar: string }[];
  taxi: Record<string, string>; payload: Record<string, number>; payloadDate: string;
  pcrDep: string[]; pcrHead: string[]; pcrGrid: string[][]; pcrReg: Record<string, string>; source: string;
};

export type FplFlight = {
  key: string; flt: string; date: string; reg: string; ac: string; dep: string; arr: string;
  etdUtc: string; staLocal: string;
  cptId: string; cptName: string; cpt2Id: string; cpt2Name: string; foId: string; foName: string;
};

export type FplOpts = {
  extra: string; seq: string; routeQ: string; etpPoa: string; fl: string; talt: string; alt1: string; alt2: string;
  rte: string; rmk: string; pcrTo: string; pay: string; utc: string; dsp: string;
};

const person = (id: string, name: string) => {
  const l = (id || "").trim(), r = (name || "").trim();
  if ((l === "" || l === "0") && !r) return "";
  if (l === "" || l === "0") return r;
  return r ? `${l} ${r}` : l;
};
const mins = (s: string) => { const m = (s || "").trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function acFamily(ac: string) {
  const t = (ac || "").toUpperCase().replace(/\s/g, "");
  if (t.includes("330") || t.startsWith("A33")) return "330";
  if (t.includes("321") || t.includes("32N") || t.includes("A21N")) return "321";
  if (t.includes("320") || t.includes("A20N")) return "320";
  return "";
}
export const normReg = (r: string) => { const d = (r || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); const m = d.match(/^VN?A?(\d{3})$/) ?? d.match(/^A(\d{3})$/); return m ? `VN-A${m[1]}` : (r || "").toUpperCase(); };

export function defaults(db: FplDb, dep: string, arr: string) {
  const r = db.alt[(dep + arr).toUpperCase()];
  return { routeQ: r?.etp_pod ?? "", etpPoa: r?.etp_poa ?? "", talt: r?.talt ?? "", fl: r?.fl ?? "", alt1: r?.alt1 ?? "", alt2: r?.alt2 ?? "" };
}

function suffix(db: FplDb, route: string, utc: string) {
  const hit = db.suffix.find((r) => (r.route || "").toUpperCase() === route);
  if (!hit) return "1";
  const n = Number(utc); if (!Number.isFinite(n) || !utc) return "1";
  return String((n > 1500 ? hit.envar : hit.kapli) || "").trim() || "1";
}
function taxiType(ac: string, reg: string, db: FplDb) {
  if (ac === "330") return "A333"; if (ac === "321") return db.neo.includes(reg) ? "A21N" : "A321"; if (ac === "320") return "A320"; return "";
}
function tx(db: FplDb, ac: string, reg: string, dep: string) {
  const k = taxiType(ac, reg, db); const v = k ? db.taxi[`${dep}|${k}`] : undefined;
  return v ? String(v) : k === "A333" ? "500" : "200";
}
function ci(db: FplDb, dep: string, arr: string, ac: string, reg: string) {
  const col = ac === "330" ? "a330" : ac === "321" ? (db.neo.includes(reg) ? "a321neo" : "a321ceo") : ac === "320" ? "a320" : "";
  if (!col) return "";
  const by = Object.fromEntries(db.ci.map((r) => [r.id, r]));
  const dom = new Set((by["domestic"]?.airports ?? db.domestic).map((x) => x.toUpperCase()));
  let ch = dom.has(dep) && dom.has(arr) ? by["domestic"] : dom.has(dep) ? by["vietnam"] : db.ci.find((r) => r.id !== "domestic" && r.id !== "vietnam" && r.airports.map((x) => x.toUpperCase()).includes(dep));
  return ch ? String(ch[col as "a320"] ?? "").trim() : "";
}
function hold(db: FplDb, route: string, arr: string, sta: string, ac: string, a1: string, a2: string) {
  if (a1) { let t = `${a1}/${arr}${a1}1/100/300`; if (a2) t += `,${a2}/${arr}${a2}1/100/300`; return "HLD÷30," + t; }
  const row = db.etp[route]; if (!row) return "HLD÷30,";
  const m = mins(sta); const night = ac === "330" || (m != null && (m < 360 || m >= 1140));
  const pair = String((night ? row[1] : row[0]) || ""); const l = pair.slice(0, 3), r = pair.length >= 3 ? pair.slice(-3) : pair;
  return `HLD÷30,${l}/${arr}${l}1,${r}/${arr}${r}1`;
}
function pcrField(db: FplDb, dep: string, reg: string) {
  const code = db.pcrReg[reg]; if (!code) return "";
  const i = db.pcrDep.indexOf(dep), j = db.pcrHead.indexOf(code);
  if (i < 0 || j < 0) return "";
  return String(db.pcrGrid[i]?.[j] ?? "");
}
const extraOn = (e: string) => { const t = (e || "").trim().toUpperCase().replace(/,/g, ""); const m = t.match(/^(\d+)/); return m ? Number(m[1]) > 0 : !!t && t !== "0" && t !== "0M"; };
function optTail(extra: string, rmk: string) {
  let n = (rmk || "").trim(); if (n.startsWith("/")) n = n.slice(1).trim();
  const p: string[] = []; if (extraOn(extra)) p.push("/EXTRA FUEL DUE WX ENROUTE AND TRAFFIC"); if (n) p.push("/" + n);
  return p.length ? " " + p.join(" ") : "";
}
const profile = (ac: string, fl: string, found: boolean) => ac === "330" ? "PRO÷I,T,M,100,410" : !found ? "PRO÷I,T,M,100,350" : fl === "" ? "PRO÷I,T,M" : "PRO÷I,T,M," + fl;

export function payDefault(db: FplDb, flt: string) { const v = db.payload["VJ" + flt]; return v == null ? "9999" : String(Math.trunc(v + 1000)); }

export function renderFpl(db: FplDb, f: FplFlight, o: FplOpts): string {
  const dep = f.dep.toUpperCase(), arr = f.arr.toUpperCase(), ac = f.ac, reg = f.reg.toUpperCase(), flt = f.flt, route = dep + arr;
  const utc = (o.utc || f.etdUtc).replace(/\D/g, "");
  const sfx = o.rte.trim() || suffix(db, route, utc);
  const cpt = person(f.cptId, f.cptName), cpt2 = person(f.cpt2Id, f.cpt2Name), fo = person(f.foId, f.foName);
  const dsp = o.dsp.trim() || db.dsp;
  const extra = o.extra.trim() || "0";
  const base = `OPT÷FP,WXUK,KILOS,RN,AW,DRFT,OPGF,CS/VJC${flt},TLK/${db.tlk}${optTail(extra, o.rmk)}`;
  let opt: string;
  if (!cpt2) opt = `${base},CPT/${cpt},FOF/${fo},DSP/${dsp}`;
  else if (!fo) opt = `${base},CPT/${cpt},FOF/${cpt2},DSP/${dsp}`;
  else if (cpt2 === db.legendCpt2 && fo === db.legendFo) opt = `${base},CPT/${cpt2},FOF/${fo},DSP/${dsp}`;
  else opt = `${base},CPT/${cpt},FOF/${fo},DSP/${dsp}`;
  const era = db.era[route]; const pcr = pcrField(db, dep, reg);
  let field = era ? `16F÷A${extra},603,ERA=${era}${pcr}` : `16F÷A${extra}${pcr},I`;
  if (o.pcrTo.trim()) field += ",TO=" + o.pcrTo.trim();
  return [
    `*÷Flight Plan - ${o.seq}VJC${flt}- ${dep}-${arr}`,
    opt,
    `POD÷${dep}${o.routeQ}${o.talt ? ",ALT=" + o.talt : ""},TX${tx(db, ac, reg, dep)}`,
    `POA÷${arr}${o.etpPoa}`,
    `RTE÷RT/${dep}${arr}${sfx}`,
    hold(db, route, arr, f.staLocal, ac, o.alt1, o.alt2),
    "ETD÷" + utc,
    profile(ac, o.fl, route in db.alt),
    `AIR÷$${reg.slice(0, 2)}${reg.slice(-4)}/`,
    "CRZ÷CI" + ci(db, dep, arr, ac, reg),
    "OWT÷",
    "PAY÷" + (o.pay.trim() || payDefault(db, flt)),
    field,
  ].join("\n");
}

/** FPL.req bytes: CRLF line endings, Windows-1258 (÷ = 0xF7). */
export function reqBytes(text: string): Uint8Array<ArrayBuffer> {
  let body = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  if (body && !body.endsWith("\r\n")) body += "\r\n";
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) { const c = body.charCodeAt(i); out[i] = c < 128 ? c : c === 0xf7 ? 0xf7 : 63; }
  return out;
}

export function localHm(iso: string | null, tz: string) {
  if (!iso) return "";
  const off = mins(tz) ?? 0; const d = new Date(new Date(iso).getTime() + off * 60000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export const utcHhmm = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`; };
