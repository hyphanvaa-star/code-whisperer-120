// Port of pcr_limits.py — PCR (pavement classification) limits for domestic airports.
import pcrData from "../data/pcr_limits.json";

export type Raw = Record<string, any>;

export const MARGIN_KG = 500;
export const WARNING = "warning";
export const CRITICAL = "critical";
export const OK = "ok";

let data: Raw = pcrData as Raw;

/** Test helper: override the loaded data (mirrors Python module-level cache). */
export function _setDataForTests(doc: Raw | null) {
  data = doc ?? (pcrData as Raw);
}

function load(): Raw {
  return data || { variants: [], airports: {} };
}

function fmtInt(value: number): string {
  // Python f"{value:,}".replace(",", " ")
  const s = Math.trunc(value).toLocaleString("en-US");
  return s.replace(/,/g, " ");
}

function ofpValue(ofp: any, key: string): any {
  if (ofp == null) return null;
  return ofp[key];
}

function warningRow(text: string, opts: { severity: string; evidence: string; limit: string; table?: Raw | null }): Raw {
  const row: Raw = {
    kind: "pcr",
    text,
    severity: opts.severity,
    check: "pcr",
    evidence: opts.evidence,
    defect: "",
    limit: opts.limit,
  };
  if (opts.table) row.table = opts.table;
  return row;
}

function icao(raw: string): string {
  return String(raw || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

export function family_of(acType: string): string | null {
  const t = String(acType || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  if (t.startsWith("A21N") || t === "321N" || t === "A321N" || t === "A321NEO") return "a321neo";
  if (t.includes("NEO") && t.includes("321")) return "a321neo";
  if (t.startsWith("A321") || t === "321" || t === "A321CEO") return "a321ceo";
  if (t.startsWith("A320") || t.startsWith("A20N") || t === "320" || t === "320N") return "a320";
  if (t.startsWith("A330") || t.startsWith("A332") || t.startsWith("A333") || t.startsWith("A33")) return "a330";
  return null;
}

export function structural_mtow(raw: number | null, acType: string): number | null {
  if (raw == null) return null;
  const family = family_of(acType);
  const rows = (load().variants || []).filter((v: Raw) => v.family === family);
  if (!rows.length) return null;
  const n = Math.trunc(raw);
  let best = rows[0];
  let bestDiff = Math.abs(Math.trunc(best.mtow) - n);
  for (const v of rows) {
    const diff = Math.abs(Math.trunc(v.mtow) - n);
    if (diff < bestDiff) { best = v; bestDiff = diff; }
  }
  if (Math.abs(Math.trunc(best.mtow) - n) > 300) return null;
  return Math.trunc(best.mtow);
}

export function pick_variant(acType: string, mtow: number | null): Raw | null {
  const family = family_of(acType);
  if (!family || mtow == null) return null;
  const rows = (load().variants || []).filter((v: Raw) => v.family === family);
  if (!rows.length) return null;
  let best = rows[0];
  let bestDiff = Math.abs(Math.trunc(best.mtow) - Math.trunc(mtow));
  for (const v of rows) {
    const diff = Math.abs(Math.trunc(v.mtow) - Math.trunc(mtow));
    if (diff < bestDiff) { best = v; bestDiff = diff; }
  }
  return best;
}

export function airport_of(code: string): Raw | null {
  const c = icao(code);
  const row = (load().airports || {})[c];
  return row && typeof row === "object" ? row : null;
}

export function touches(f: { dep_icao: string; dest_icao: string }): boolean {
  return airport_of(f.dep_icao) != null || airport_of(f.dest_icao) != null;
}

function pcrOf(rwy: Raw, wv: string): number | null {
  const raw = (rwy.pcr || {})[wv];
  if (raw == null) return null;
  return Math.trunc(raw);
}

function p10Of(rwy: Raw, wv: string): number | null {
  const raw = (rwy.p10 || {})[wv];
  if (raw != null) return Math.trunc(raw);
  const pcr = pcrOf(rwy, wv);
  if (pcr == null) return null;
  return Math.round(pcr * 1.1);
}

function fmtT(kg: number | null): string {
  if (kg == null) return "No restricted";
  const t = kg / 1000;
  if (Math.abs(t - Math.round(t)) < 0.0005) return String(Math.round(t));
  let s = t.toFixed(3);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function rwyPair(apt: Raw, wv: string): [Raw, Raw | null] {
  const rwys: Raw[] = (apt.runways || []).filter((r: any) => r && typeof r === "object");
  if (!rwys.length) throw new Error("no runways");
  const numbered: [Raw, number | null][] = rwys.map((r) => [r, pcrOf(r, wv)]);
  const tight = numbered.filter((x) => x[1] != null) as [Raw, number][];
  const free = numbered.filter((x) => x[1] == null);
  if (!tight.length) return [rwys[0], null];
  let worse = tight[0];
  for (const x of tight) if (x[1] < worse[1]) worse = x;
  if (free.length) return [worse[0], free[0][0]];
  if (tight.length === 1) return [worse[0], null];
  let better = tight[0];
  for (const x of tight) if (x[1] > better[1]) better = x;
  if (better[0] === worse[0]) return [worse[0], null];
  return [worse[0], better[0]];
}

function intOfp(ofp: any, key: string): number | null {
  const val = ofpValue(ofp, key);
  if (val == null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function backupHolds(ok: Raw | null, wv: string, weight: number): boolean {
  if (ok == null) return false;
  const pcr = pcrOf(ok, wv);
  if (pcr == null) return true;
  return weight <= pcr;
}

function plus10Filed(ofpCap: number | null, pcr: number, ac: string): boolean {
  if (ofpCap == null) return false;
  const cap = Math.trunc(ofpCap);
  if (cap <= pcr) return false;
  return structural_mtow(cap, ac) == null;
}

function hoverTable(apt: Raw, icaoCode: string, role: string, variant: Raw, label: string, weight: number): Raw {
  const wv = String(variant.id);
  const cols: Raw[] = [];
  for (const rwy of apt.runways || []) {
    if (!rwy || typeof rwy !== "object") continue;
    const pcr = pcrOf(rwy, wv);
    cols.push({
      id: String(rwy.id || "").trim() || "—",
      pcr,
      p10: p10Of(rwy, wv),
      hit: pcr != null && weight > pcr,
    });
  }
  return {
    icao: icaoCode,
    iata: String(apt.iata || ""),
    name: String(apt.name || ""),
    role,
    label,
    ac: String(variant.label),
    mtow: Math.trunc(variant.mtow),
    weight: Math.trunc(weight),
    runways: cols,
  };
}

function hoverText(table: Raw): string {
  const iata = table.iata || "";
  const head = table.icao + (iata ? `/${iata}` : "");
  const lines = [`${head} ${table.role}  ${table.ac}  MTOW ${fmtT(Math.trunc(table.mtow))} t`];
  for (const rwy of table.runways || []) {
    const rid = rwy.id || "—";
    if (rwy.pcr == null) {
      lines.push(`RWY ${rid}  No restricted`);
      continue;
    }
    const mark = rwy.hit ? "CHẠM" : "OK";
    lines.push(`RWY ${rid}  PCR ${fmtT(rwy.pcr)} t  +10% ${fmtT(rwy.p10)} t  ${mark}`);
  }
  lines.push(`${table.label} thực tế  ${fmtT(Math.trunc(table.weight))} t`);
  return lines.join("\n");
}

function oneEnd(
  role: string,
  icaoCode: string,
  weight: number | null,
  variant: Raw,
  label: string,
  _src = "",
  opts: { ofp_cap?: number | null; ac?: string } = {}
): Raw | null {
  const apt = airport_of(icaoCode);
  if (!apt || weight == null) return null;
  const wv = String(variant.id);
  const [worse, ok] = rwyPair(apt, wv);
  const pcr = pcrOf(worse, wv);
  if (pcr == null) return null;
  const room = pcr - Math.trunc(weight);
  const margin = Math.trunc(load().margin_kg ?? MARGIN_KG);
  if (room > margin) return null;
  let sev = room <= 0 ? CRITICAL : WARNING;
  if (backupHolds(ok, wv, Math.trunc(weight))) sev = OK;
  else if (plus10Filed(opts.ofp_cap ?? null, pcr, opts.ac || "") && Math.trunc(weight) <= Math.trunc(opts.ofp_cap || 0)) sev = OK;
  const wId = String(worse.id || "").trim();
  let head = `PCR ${icaoCode} ${role}`;
  if (wId) head += ` — RWY kém ${wId}`;
  let rule: string;
  if (room < 0) rule = `${label} ${fmtInt(weight)} / PCR ${fmtInt(pcr)} kg  vượt ${fmtInt(-room)}`;
  else if (room === 0) rule = `${label} ${fmtInt(weight)} / PCR ${fmtInt(pcr)} kg  chạm PCR`;
  else rule = `${label} ${fmtInt(weight)} / PCR ${fmtInt(pcr)} kg  còn ${fmtInt(room)}`;
  const table = hoverTable(apt, icaoCode, role, variant, label, Math.trunc(weight));
  return warningRow(head, { severity: sev, evidence: hoverText(table), limit: rule, table });
}

export function check_flight(
  f: { dep_icao: string; dest_icao: string; ac_type?: string; acft_type?: string },
  ofp: any = null,
  opts: { fleet_mtow?: number | null } = {}
): Raw[] {
  if (ofp == null) return [];
  const ac = f.ac_type || f.acft_type || "";
  const fleetMtow = opts.fleet_mtow;
  const mtow = fleetMtow ? fleetMtow : structural_mtow(intOfp(ofp, "mtow"), ac);
  const variant = pick_variant(ac, mtow ?? null);
  if (!variant) return [];
  const src = fleetMtow ? "JetPlan MAX T/OFF WT" : "MTOW OFP";
  const out: Raw[] = [];
  const dep = oneEnd("DEP", f.dep_icao, intOfp(ofp, "tow"), variant, "TOW", src, { ofp_cap: intOfp(ofp, "mtow"), ac });
  const dest = oneEnd("DEST", f.dest_icao, intOfp(ofp, "lwt"), variant, "LWT", src, { ac });
  if (dep) out.push(dep);
  if (dest) out.push(dest);
  return out;
}

export function pack_for_weights(warns: Raw[] | null | undefined): Raw {
  const out: Raw = { tow: null, lwt: null };
  for (const w of warns || []) {
    if ((w.kind || "") !== "pcr") continue;
    const text = w.text || "";
    const key = text.includes(" DEP") ? "tow" : text.includes(" DEST") ? "lwt" : "";
    if (!key) continue;
    out[key] = {
      severity: w.severity || WARNING,
      text,
      limit: w.limit || "",
      evidence: w.evidence || "",
      table: w.table || null,
    };
  }
  return out;
}

// ---------------- Used by fpl_tool.ts ----------------
export function pcrByIata(): Record<string, Raw> {
  const doc = load();
  const found: Record<string, Raw> = {};
  for (const apt of Object.values(doc.airports || {})) {
    if (apt && typeof apt === "object" && (apt as Raw).iata) {
      found[String((apt as Raw).iata).toUpperCase()] = apt as Raw;
    }
  }
  return found;
}

export function loadTableRows(): Raw[] {
  const doc = load();
  const labels: Record<string, string> = {};
  const order: string[] = [];
  for (const item of doc.variants || []) {
    if (item.id) { labels[String(item.id)] = String(item.label || item.id); order.push(String(item.id)); }
  }
  const rows: Raw[] = [];
  for (const [icaoCode, apt] of Object.entries<Raw>(doc.airports || {})) {
    if (!apt || typeof apt !== "object") continue;
    for (const rwy of apt.runways || []) {
      const ids = [...order];
      for (const extra of [...Object.keys(rwy.pcr || {}), ...Object.keys(rwy.p10 || {})]) {
        if (!ids.includes(extra)) ids.push(String(extra));
      }
      for (const vid of ids) {
        const limit = (rwy.pcr || {})[vid];
        const plus = (rwy.p10 || {})[vid];
        rows.push({
          icao: icaoCode,
          iata: apt.iata || "",
          name: apt.name || "",
          rwy: rwy.id || "",
          variant: vid,
          label: labels[vid] || vid,
          pcr: limit == null ? "" : limit,
          p10: plus == null ? "" : plus,
        });
      }
    }
  }
  return rows;
}

export function saveTableRows(rows: Raw[]): Raw {
  const doc: Raw = load().variants ? { ...load() } : { source: "edited", margin_kg: 500, variants: [], airports: {} };
  const grouped: Record<string, Raw> = {};
  for (const rec of rows) {
    let icaoCode = String(rec.icao || "").trim().toUpperCase();
    const iata = String(rec.iata || "").trim().toUpperCase();
    const variant = String(rec.variant || "").trim();
    if (!icaoCode && !iata && !variant) continue;
    if (!icaoCode) icaoCode = iata || "NEW";
    const apt = grouped[icaoCode] ?? (grouped[icaoCode] = { name: "", iata, runways: {} as Record<string, Raw> });
    if (String(rec.name || "").trim()) apt.name = String(rec.name || "").trim();
    if (iata) apt.iata = iata;
    const rwyId = String(rec.rwy || "");
    const rwy = (apt.runways[rwyId] ??= { id: rwyId, pcr: {}, p10: {} });
    if (variant) {
      rwy.pcr[variant] = rec.pcr === "" || rec.pcr == null ? null : Math.trunc(Number(rec.pcr));
      rwy.p10[variant] = rec.p10 === "" || rec.p10 == null ? null : Math.trunc(Number(rec.p10));
    }
  }
  doc.airports = {};
  for (const [icaoCode, apt] of Object.entries(grouped)) {
    doc.airports[icaoCode] = { name: apt.name, iata: apt.iata, runways: Object.values(apt.runways) };
  }
  data = doc;
  return doc;
}
