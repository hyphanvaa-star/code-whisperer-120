// Port of limits_check.py — aircraft defect / airport / curfew / special limits (client-safe).
import type { Flight } from "./flight-model";
import DEFAULT from "./limits-default.json";

export type Limits = {
  aircraft: { reg: string; defect: string; limit: string }[];
  airports: { code: string; limit: string }[];
  curfew: { code: string; start: string; end: string }[];
  special: { reg: string; code: string; limit: string }[];
};
export const DEFAULT_LIMITS = DEFAULT as Limits;

export type LimitWarn = { kind: string; text: string; severity: "warning" | "critical"; evidence: string };

const norm = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ICAO_IATA: Record<string, string> = {
  VVNB: "HAN", VVTS: "SGN", VVDN: "DAD", VVCI: "HPH", VVCR: "CXR", VVCT: "VCA", VVCA: "VCL", VVPK: "PXU",
  VVTX: "THD", VVPQ: "PQC", VVPB: "HUI", VVBM: "BMV", VVVH: "VII", VVDH: "VDH", VVDL: "DLI", VVTH: "TBB",
  VVDB: "DIN", VVPC: "UIH", VVVD: "VDO", VVRG: "VKG", VVCM: "CAH", VVCS: "VCS",
  RKSS: "GMP", RKPC: "CJU", RKPK: "PUS", RKSI: "ICN", RJAA: "NRT", RJSS: "SDJ", RJTT: "HND", RJBB: "KIX",
  VHHH: "HKG", VMMC: "MFM", ZGGG: "CAN", ZSPD: "PVG", WMKK: "KUL", WSSS: "SIN", VTBD: "DMK", VTBS: "BKK",
  RCKH: "KHH", RCTP: "TPE", RCMQ: "RMQ", RCNN: "TNN", RCFN: "TTT", RCBS: "KNH", RCYU: "HUN", VAAH: "AMD", VLVT: "VTE",
};
const toIata = (c: string) => { const n = norm(c); if (!n) return ""; if (n.length === 3) return n; return ICAO_IATA[n] ?? n.slice(-3); };
const forms = (c: string) => { const n = norm(c); return n ? new Set([n, toIata(n)]) : new Set<string>(); };
const isVn = (c: string) => { const n = norm(c); if (n.length >= 4) return n.startsWith("VV"); return Object.entries(ICAO_IATA).some(([i, a]) => i.startsWith("VV") && a === n); };

const isApuInop = (t: string) => { const u = t.toUpperCase(); return u.includes("APU") && ["INOP", "U/S", "INOPERATIVE", "UNSERVICEABLE"].some((k) => u.includes(k)); };
const noApuApt = (l: string) => { const u = l.toUpperCase(); return u.includes("NO APU") || (u.includes("NO") && u.includes("APU SERVICE")); };
const closed = (l: string) => /CLOSED|RECONSTRUCTION/i.test(l);
const onlyOps = (l: string) => /ONLY OPS/i.test(l);
const RE_TALT = /TAKE[\s-]?OFF\s+ALT(?:N|ERNATE)?|T\/O\s+ALT(?:N|ERNATE)?/i;
const FUEL_PEN = /FUEL\s+PENALT(?:Y|IES)|(?:PERFORMANCE|FLIGHT\s+MANUAL)\s+PENALT(?:Y|IES)|PENALT(?:Y|IES)\s+(?:ARE|IS)\s+APPLIED|INCREASE[DS]?\s+(?:IN\s+)?FUEL\s+(?:CONSUMPTION|BURN|FLOW)|FUEL\s+(?:CONSUMPTION|BURN|FLOW)\s+(?:IS\s+|ARE\s+)?INCREASE[DS]?|HIGHER\s+FUEL\s+(?:CONSUMPTION|BURN|FLOW)|FUEL\s+PLANNING/i;
const ALT_RE = /(?:FLIGHT\s+)?(?:ALTITUDE|FLIGHT\s+LEVEL).*?(?:LIMITED\s+TO|MAX(?:IMUM)?(?:\s+IS)?|NOT\s+EXCEED(?:ING)?)\s*(?:(\d[\d\s,]{2,9})\s*FT\b|(?:FL\s*)?(\d{2,3})\b)/i;
const WT_RE = /(?:(MAX(?:IMUM)?(?:\s+IS)?)\s+)?(TOW|MTOW|TAKE[ -]?OFF\s+WEIGHT|LWT|LW|MLWT|LANDING\s+WEIGHT|ZFW|MZFW|ZERO\s+FUEL\s+WEIGHT)\b(?:\s+(?:LIMIT(?:ED)?\s+TO|MAX(?:IMUM)?(?:\s+IS)?|NOT\s+EXCEED(?:ING)?|<=|IS))?\s*(\d+(?:[\s,]\d{3})*(?:\.\d+)?)\s*(KG|KGS|T|TON|TONNE|TONNES)\b/gi;

function matchType(token: string, ac: string) {
  let w = token.toUpperCase().replace(/\s+/g, " ").trim(); const a = ac.toUpperCase().replace(/\s+/g, " ").trim();
  if (!w || !a) return false;
  w = w.replace(" TYPE", "").trim();
  if (w.includes("NEO") || w.includes("A21")) return (a.includes("321") && a.includes("N")) || a.includes("A21N");
  const c = a.replace(/[\s-]/g, ""), ww = w.replace(/[\s-]/g, "");
  if (["333", "A333", "A330", "A332"].some((t) => ww.includes(t)) || ["330", "332", "333"].includes(ww))
    return ["A330", "A332", "A333"].some((t) => c.includes(t)) || ["330", "332", "333"].includes(c);
  if (w.includes("320") && !w.includes("321")) return (a.includes("320") || a.includes("A20N")) && !a.includes("321");
  if (w.includes("321")) return a.includes("321") || a.includes("A21");
  return a.includes(w);
}

const hm = (iso: string | null) => (iso ? new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes() : null);
const parseHm = (s: string) => { const m = (s || "").trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function curfewHit(t: number, s: number | null, e: number | null) {
  if (s != null && e != null) { if (s === e) return true; return s < e ? t >= s && t <= e : t >= s || t <= e; }
  if (s != null) return t >= s; if (e != null) return t <= e; return false;
}
const pad = (n: number) => String(n).padStart(2, "0");

export function checkLimits(f: Flight, L: Limits): LimitWarn[] {
  const out: LimitWarn[] = [];
  const reg = norm(f.reg);
  const apts: [string, string, Set<string>][] = ([["DEP", f.depIata || f.dep], ["DEST", f.destIata || f.dest], ["ALT1", f.alt1], ["ALT2", f.alt2]] as [string, string][])
    .filter(([, c]) => norm(c)).map(([r, c]) => [r, toIata(c), forms(c)]);
  const all = new Set<string>(); apts.forEach(([, , s]) => s.forEach((x) => all.add(x)));
  const apBy = new Map<string, { code: string; limit: string }>();
  for (const r of L.airports) for (const x of forms(r.code)) if (!apBy.has(x)) apBy.set(x, r);
  const aptRow = (s: Set<string>) => { for (const x of s) { const r = apBy.get(x); if (r) return r; } return null; };

  for (const hit of L.aircraft.filter((r) => norm(r.reg) === reg)) {
    const defect = (hit.defect || "").trim(), limit = (hit.limit || "").trim();
    const base = `${f.reg}: ${defect || "defect"}`;
    if (isApuInop(`${defect}\n${limit}`)) {
      const hits = apts.map(([r, c, s]) => [r, c, aptRow(s)] as const).filter(([, , row]) => row && noApuApt(row.limit));
      if (hits.length) for (const [r, c, row] of hits) out.push({ kind: "defect", severity: "critical", text: `${base} → ${r} ${c}: ${row!.limit}`, evidence: `${r} ${c}: ${row!.limit}` });
      else out.push({ kind: "defect", severity: "warning", text: `${base} — ${limit || "APU INOP"}`, evidence: "Không trúng sân NO APU SERVICE trong route/alternate" });
      continue;
    }
    if (!limit) continue;
    let sev: LimitWarn["severity"] = "warning"; const ev: string[] = [];
    const U = limit.toUpperCase();
    if (ALT_RE.test(limit) || new RegExp(WT_RE.source, "i").test(limit)) {
      for (const m of limit.matchAll(WT_RE)) {
        const lab = m[2]!.toUpperCase().replace(/[^A-Z]/g, "");
        const key = /^(M?TOW|TAKEOFFWEIGHT)$/.test(lab) ? "tow" : /^(LWT|LW|MLWT|LANDINGWEIGHT)$/.test(lab) ? "lwt" : "zfw";
        let max = Number(m[3]!.replace(/[\s,]/g, "")); if (/^T/i.test(m[4]!)) max *= 1000;
        const act = f[key as "tow" | "lwt" | "zfw"];
        if (act == null) { ev.push(`Chưa có ${key.toUpperCase()} để so giới hạn ${Math.round(max)} KG`); continue; }
        ev.push(`${key.toUpperCase()} ${Math.round(act)} KG ${act > max ? ">" : "≤"} giới hạn ${Math.round(max)} KG`);
        if (m[1] && act > max) sev = "critical";
      }
      if (ALT_RE.test(limit)) ev.push("Giới hạn độ cao — đối chiếu FL trong OFP");
    }
    if (U.includes("OPS DOMESTIC")) {
      const dom = isVn(f.dep || f.depIata) && isVn(f.dest || f.destIata);
      ev.push(`Chặng ${f.dep}-${f.dest} ${dom ? "là nội địa" : "không phải nội địa Việt Nam"}`);
      if (!dom) sev = "critical";
    }
    if (/EDTO (IS )?NOT CONDUCTED/.test(U) && !U.includes("BEYOND") && !U.includes("180")) {
      ev.push(`FliteBrief ETOPS/EDTO: ${f.etops ? "CÓ" : "KHÔNG"}`); if (f.etops) sev = "critical";
    }
    if (FUEL_PEN.test(`${defect}\n${limit}`)) {
      ev.push(`Defect có fuel penalty — OFP phải cộng EXTRA; ${f.fuel.extra ? `kế hoạch đang có EXTRA ${Math.round(f.fuel.extra)} ${f.fuel.units}` : "kế hoạch CHƯA có EXTRA"}`);
      sev = "critical";
    }
    out.push({ kind: "defect", severity: sev, text: `${base} — ${limit}`, evidence: ev.join("\n") });
  }

  for (const [r, c, s] of apts) {
    const row = aptRow(s);
    if (row && closed(row.limit)) out.push({ kind: "airport", severity: "critical", text: `${r} ${c}: ${row.limit}`, evidence: `${r} ${c} nằm trong kế hoạch` });
  }

  for (const row of L.curfew) {
    const cf = forms(row.code); if (![...cf].some((x) => all.has(x))) continue;
    const s = parseHm(row.start), e = parseHm(row.end); if (s == null && e == null) continue;
    const checks: [string, string | null][] = [];
    if ([...forms(f.depIata || f.dep)].some((x) => cf.has(x))) checks.push(["DEP/STD", f.std]);
    if ([...forms(f.destIata || f.dest)].some((x) => cf.has(x))) checks.push(["DEST/STA", f.sta]);
    for (const [r, a] of [["ALT1", f.alt1], ["ALT2", f.alt2]] as const) if ([...forms(a)].some((x) => cf.has(x))) checks.push([`${r}/STA`, f.sta]);
    for (const [r, when] of checks) {
      const t = hm(when); if (t == null) continue;
      const w = (x: number) => ((x % 1440) + 1440) % 1440;
      const near = (s != null && curfewHit(t, w(s - 90), s)) || (e != null && curfewHit(t, e, w(e + 90)));
      const inside = curfewHit(t, s, e);
      if (!inside && !near) continue;
      const evd = `${r} ${pad(Math.floor(t / 60))}:${pad(t % 60)}Z ${inside ? "trong" : "sát (đệm 1h30)"} ${row.start || "—"}→${row.end || "—"} UTC`;
      out.push({ kind: "curfew", severity: inside ? "critical" : "warning", text: `${inside ? "CURFEW" : "SÁT CURFEW"} ${toIata(row.code)}: ${evd}`, evidence: evd });
    }
  }

  for (const row of L.special) {
    const tok = (row.reg || "").trim(), rf = forms(row.code), code = toIata(row.code), limit = (row.limit || "").trim();
    if (!tok || ![...rf].some((x) => all.has(x))) continue;
    const roles = apts.filter(([, , s]) => [...s].some((x) => rf.has(x))).map(([r]) => r);
    const U = limit.toUpperCase(); let v = false, why = "";
    if (onlyOps(limit)) { v = !matchType(tok, f.acType); why = `tàu ${f.acType || f.reg} không phải ${tok}`; }
    else if (matchType(tok, f.acType)) {
      if (U.includes("DESTINATION ALTERNATE") || RE_TALT.test(U)) {
        const hit = roles.filter((r) => U.includes("DESTINATION ALTERNATE") && (r === "ALT1" || r === "ALT2"));
        v = !!hit.length; why = `${code} được chọn làm ${hit.join(",")}`;
      } else { v = true; why = `${code} xuất hiện ở ${roles.join(",")}`; }
    }
    if (v) out.push({ kind: "special", severity: "critical", text: `${tok} @ ${code}: ${limit}`, evidence: why });
  }
  const seen = new Set<string>();
  return out.filter((w) => { const k = w.text + w.severity + w.evidence; if (seen.has(k)) return false; seen.add(k); return true; });
}
