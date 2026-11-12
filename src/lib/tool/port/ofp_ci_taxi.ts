// CI / Taxi fuel check: OFP values against the KHB Cost Index and Taxi-out tables.
import { selectCostIndexRow } from "./cost_index_region";

const _CI = /\bCI[ \t]+(\d{1,4})\b/;
const _TAXI = /^[ \t]*TAXI[ \t]+(\d{2,5})\b/im;

export function parseCiTaxi(text: string): { ci: number | null; taxi: number | null } {
  const c = _CI.exec(text || ""), t = _TAXI.exec(text || "");
  return { ci: c ? Number(c[1]) : null, taxi: t ? Number(t[1]) : null };
}

export type CiTaxiDb = {
  ci_rows: Array<Record<string, any> & { id: string }>;
  domestic: Set<string>;
  neo: Set<string>;
  taxi_oct: Record<string, any>;
};

/** Fleet type used by both tables: A333 / A21N / A321 / A320. */
export function fleetKind(acType: string, reg: string, neo: Set<string>): string {
  const t = String(acType || "").toUpperCase().replace(/\s/g, "");
  const r = String(reg || "").toUpperCase();
  if (t.includes("330") || t.startsWith("A33")) return "A333";
  if (t.includes("21N") || t.includes("NEO") || (t.includes("321") && neo.has(r))) return "A21N";
  if (t.includes("321") || t.includes("32N")) return neo.has(r) ? "A21N" : "A321";
  if (t.includes("320") || t.includes("20N")) return "A320";
  return "";
}

const CI_COL: Record<string, string> = { A333: "a330", A21N: "a321neo", A321: "a321ceo", A320: "a320" };

export function expectedCiTaxi(db: CiTaxiDb, f: { dep: string; arr: string; acType: string; reg: string }) {
  const kind = fleetKind(f.acType, f.reg, db.neo);
  const dep = String(f.dep || "").toUpperCase(), arr = String(f.arr || "").toUpperCase();
  let ci: number | null = null, ciRow = "";
  if (kind) {
    const row = selectCostIndexRow(db.ci_rows, dep, arr, [...db.domestic]);
    const v = row ? String(row[CI_COL[kind]!] ?? "").trim() : "";
    if (v !== "" && Number.isFinite(Number(v))) { ci = Number(v); ciRow = String(row!["region"] || row!.id); }
  }
  let taxi: number | null = null, taxiStd = false;
  if (kind) {
    const v = db.taxi_oct[dep + "|" + kind];
    if (v !== "" && v != null && Number.isFinite(Number(v))) taxi = Number(v);
    else { taxi = kind === "A333" ? 500 : 200; taxiStd = true; }
  }
  return { kind, ci, ciRow, taxi, taxiStd };
}

export function ciTaxiCell(exp: ReturnType<typeof expectedCiTaxi>, ofp: { ci: number | null; taxi: number | null }, dep: string) {
  const lines: string[] = [];
  const bad: string[] = [];
  let unknown = false;
  if (!exp.kind) return { ok: null, detail: "", tip: "Không xác định được loại tàu để tra CI/Taxi." };
  if (ofp.ci === null) { unknown = true; lines.push("CI: OFP không đọc được"); }
  else if (exp.ci === null) { unknown = true; lines.push(`CI OFP ${ofp.ci} — bảng CI chưa có vùng cho ${exp.kind}`); }
  else if (ofp.ci !== exp.ci) { bad.push(`CI ${ofp.ci}≠${exp.ci}`); lines.push(`CI sai: OFP ${ofp.ci}, chuẩn ${exp.ci} (${exp.kind} · ${exp.ciRow})`); }
  else lines.push(`CI ${ofp.ci} đúng (${exp.kind} · ${exp.ciRow})`);
  const std = exp.taxiStd ? " — chuẩn mặc định" : "";
  if (ofp.taxi === null) { unknown = true; lines.push("Taxi: OFP không đọc được"); }
  else if (ofp.taxi !== exp.taxi) { bad.push(`TAXI ${ofp.taxi}≠${exp.taxi}`); lines.push(`Taxi sai: OFP ${ofp.taxi} kg, chuẩn ${exp.taxi} kg (${dep} · ${exp.kind}${std})`); }
  else lines.push(`Taxi ${ofp.taxi} kg đúng (${dep} · ${exp.kind}${std})`);
  if (bad.length) return { ok: false, detail: bad.join(" · "), tip: lines.join("\n") };
  if (unknown) return { ok: null, detail: "", tip: lines.join("\n") };
  return { ok: true, detail: `CI ${ofp.ci} · TAXI ${ofp.taxi}`, tip: lines.join("\n") };
}
