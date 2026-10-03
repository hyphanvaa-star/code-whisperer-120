import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Notam = {
  id: string; ident: string; kind: string; icao: string; subject: string; condition: string;
  eField: string; dField: string; fField: string; gField: string; text: string;
  start: string; end: string; qcode: string; coords: string; lower: number | null; upper: number | null;
};
export type Place = { code: string; kind: string; name: string; iata: string; fir: string; notams: Notam[]; error: string };
export type Wx = { icao: string; metar: string; taf: string };

const icaoList = z.array(z.string().regex(/^[A-Za-z]{4}$/)).min(1).max(40);

// ---- NOTAM (FliteBrief /webapi/icaos/{code}) — port từ notam_check.py ----
const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const PERM = new Set(["", "PERM", "UFN", "EST", "WIE", "NONE"]);
function stamp(raw: unknown) {
  const t = s(raw);
  if (PERM.has(t.toUpperCase())) return t ? "PERM" : "";
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  }
  return t.replace(/\D/g, "").slice(0, 12) || t;
}
function altLabel(raw: unknown) {
  if (raw == null || s(raw) === "") return "";
  const n = Math.trunc(Number(raw));
  if (Number.isNaN(n)) return s(raw).toUpperCase();
  if (n <= 0) return "SFC";
  if (n >= 999) return "UNL";
  return n >= 100 ? `FL${n}` : `${n * 100}FT AMSL`;
}
function compact(r: Record<string, unknown>, kind: string): Notam {
  const series = s(r.notamSeries ?? r.notam_series);
  const number = s(r.notamNumber ?? r.notam_number);
  let ident = series && number.toUpperCase().startsWith(series.toUpperCase()) ? number : series + number;
  const year = s(r.notamYear ?? r.notam_year);
  if (year) ident = ident ? `${ident}/${year}` : year;
  const es = ["e_field", "eField", "notam_text", "notamText", "itemE", "item_e"].map((k) => s(r[k])).filter(Boolean);
  let e = es.sort((a, b) => b.length - a.length)[0] ?? "";
  if (e.slice(0, 2).toUpperCase() === "E)") e = e.slice(2).trimStart();
  const d = s(r.d_field ?? r.dField ?? r.itemD ?? r.schedule);
  const f = s(r.f_field ?? r.fField) || altLabel(r.lower);
  const g = s(r.g_field ?? r.gField) || altLabel(r.upper);
  const ntype = s(r.notamType ?? r.notam_type ?? kind).toUpperCase();
  const subject = s(r.subject_description ?? r.subjectDescription);
  const condition = s(r.condition_description ?? r.conditionDescription);
  const origin = s(r.origin_time) || stamp(r.originTime);
  const head = [ntype === "F" || ntype === "FIR" ? "FIR" : "APT", origin, ident, subject, condition].filter(Boolean).join(" ");
  const icao = s(r.icao).toUpperCase();
  const qfir = s(r.qfir ?? r.icao).toUpperCase();
  let qcode = s(r.subject) + s(r.condition);
  if (qcode && !qcode.toUpperCase().startsWith("Q")) qcode = "Q" + qcode;
  const coords = s(r.coords).replace(/ /g, "");
  let q = [qfir, qcode, s(r.traffic), s(r.purpose), s(r.scope), r.lower == null ? "" : s(r.lower), r.upper == null ? "" : s(r.upper)].join("/");
  if (coords) q += "/" + coords;
  const start = stamp(r.startDate ?? r.start_date);
  let end = stamp(r.endDate ?? r.end_date);
  if (s(r.perm).toUpperCase() === "Y" && !end) end = "PERM";
  const abc = [icao && `A)${icao}`, start && `B)${start}`, end && `C)${end}`].filter(Boolean).join(" ");
  const lines = [head, `Q)${q}`, abc];
  if (d) lines.push(`D)${d}`);
  if (e) lines.push(`E)${e}`);
  const fg = [f && `F)${f}`, g && `G)${g}`].filter(Boolean).join(" ");
  if (fg && !/^[ \t]*[FG]\)/im.test(lines.join("\n"))) lines.push(fg);
  return {
    id: s(r.notamId ?? r.id), ident, kind, icao, subject, condition, eField: e, dField: d, fField: f, gField: g,
    text: lines.join("\n").trim(), start: s(r.start_date ?? r.startDate), end: s(r.end_date ?? r.endDate),
    qcode, coords, lower: r.lower == null ? null : Number(r.lower), upper: r.upper == null ? null : Number(r.upper),
  };
}
function toPlace(code: string, payload: Record<string, unknown>): Place {
  const af = ((payload.airfields as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  const fr = ((payload.firs as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  if (!af && !fr) return { code, kind: "", name: "", iata: "", fir: "", notams: [], error: "Không có dữ liệu trên portal." };
  const kind = fr && !af ? "FIR" : "A";
  const meta = kind === "FIR" ? fr! : af!;
  const raw = (kind === "FIR" ? payload.fir_notam : payload.airfield_notam) as Record<string, unknown>[] | undefined;
  return {
    code, kind, name: s(meta.name), iata: kind === "A" ? s(meta.iata) : "",
    fir: kind === "A" ? s(af?.fir) : code,
    notams: (raw ?? []).filter((x) => x && typeof x === "object").map((x) => compact(x, kind)),
    error: "",
  };
}

export const getNotams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ codes: icaoList }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { fbJson } = await import("./flitebrief.server");
    const codes = [...new Set(data.codes.map((c) => c.toUpperCase()))];
    const places: Place[] = [];
    for (let i = 0; i < codes.length; i += 6) {
      const chunk = await Promise.all(codes.slice(i, i + 6).map(async (code) => {
        try {
          let p = await fbJson<unknown>(`/webapi/icaos/${code}`);
          if (Array.isArray(p)) p = p[0] ?? {};
          return toPlace(code, (p ?? {}) as Record<string, unknown>);
        } catch (e) {
          return { code, kind: "", name: "", iata: "", fir: "", notams: [], error: (e as Error).message } as Place;
        }
      }));
      places.push(...chunk);
    }
    return { places };
  });

// ---- WX: METAR/TAF công khai (aviationweather.gov) ----
export const getWx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ codes: icaoList }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const ids = [...new Set(data.codes.map((c) => c.toUpperCase()))].join(",");
    const get = async (kind: "metar" | "taf") => {
      try {
        const r = await fetch(`https://aviationweather.gov/api/data/${kind}?ids=${ids}&format=json`, { headers: { "User-Agent": "dispatch-board" } });
        if (!r.ok) return [];
        return (await r.json()) as Record<string, unknown>[];
      } catch { return []; }
    };
    const [m, t] = await Promise.all([get("metar"), get("taf")]);
    const out: Record<string, Wx> = {};
    for (const c of ids.split(",")) out[c] = { icao: c, metar: "", taf: "" };
    for (const x of m) { const id = s(x.icaoId); if (out[id] && !out[id].metar) out[id].metar = s(x.rawOb); }
    for (const x of t) { const id = s(x.icaoId); if (out[id] && !out[id].taf) out[id].taf = s(x.rawTAF); }
    return { wx: Object.values(out), error: m.length + t.length === 0 ? "Nguồn thời tiết không trả dữ liệu." : null };
  });
