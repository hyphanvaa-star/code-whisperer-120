import type { Ctx, Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import * as ft from "../port/fpl_tool";
import * as atcChg from "../port/atc_chg";
import rawSeed from "../data/fpl_tool.json";
import altSeed from "../data/fpl/alt_route.json";
import eraSeed from "../data/fpl/era.json";
import ciSeed from "../data/fpl/cost_index.json";
import taxiSeed from "../data/fpl/taxi_fuel.json";
import routeSeed from "../data/fpl/route_suffix.json";
import pcrSeed from "../data/pcr_limits.json";
import * as excelMod from "./excel.server";
import { resolveCrewFlight } from '../port/fpl_flight_identity';

// Port of web.py "/api/fpltext*" endpoints (fpl_tool.py). Persistence replaces the
// data/fpl_tool.json + data/fpl/*.json files web.py reads/writes with app_settings
// rows (prefix "fpl.") via getJson/setJson, seeded from the same JSON snapshots.
//
// Note: web.py's with_crewlist() re-reads the sector list from an Excel workbook
// open on the dispatcher's PC (Windows COM) before building the flight list; that
// is not reachable from this server, so GET /api/fpltext serves the flights stored
// in "fpl.raw" (seeded from fpl_tool.json) directly, without that reload step.
// "/api/fpltext/reload" (re-import from the open Excel) is a PC-helper feature and
// is intentionally not wired here.

type Raw = ft.Raw;

const NO_CREWLIST = "Chưa nạp Crewlist. Bấm Crew trên thanh lọc.";

async function loadRaw(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.raw", rawSeed as unknown as Raw);
}
async function loadAltDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.alt_route", altSeed as unknown as Raw);
}
async function loadEraDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.era", eraSeed as unknown as Raw);
}
async function loadCiDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.cost_index", ciSeed as unknown as Raw);
}
async function loadTaxiDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.taxi_fuel", taxiSeed as unknown as Raw);
}
async function loadRouteDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.route_suffix", routeSeed as unknown as Raw);
}
async function loadPcrDoc(ctx: Ctx): Promise<Raw> {
  return getJson<Raw>(ctx, "fpl.pcr_limits", pcrSeed as unknown as Raw);
}

async function loadDb(ctx: Ctx): Promise<ft.Db | null> {
  // Port of fpl_tool.with_crewlist(): flights always come from the Crewlist
  // currently loaded in the tool (never from the old Sohee snapshot).
  const state = await excelMod.currentExcel(ctx);
  if (!state) return null;
  let flights: Raw[] = [];
  try {
    const { sheets } = await excelMod.readSheet(ctx, state.file);
    if (sheets.length) flights = ft.flights_from_crew_sheet(excelMod.pickSheet(sheets, state.sheet) as any);
  } catch {
    return null;
  }
  const base = await loadRaw(ctx);
  const raw: Raw = { ...(base || {}), flights, source: state.file };
  const [altRoutesDoc, eraDoc, ciDoc, taxiDoc] = await Promise.all([
    loadAltDoc(ctx), loadEraDoc(ctx), loadCiDoc(ctx), loadTaxiDoc(ctx),
  ]);
  return new ft.Db(raw, { altRoutesDoc, eraDoc, ciDoc, taxiDoc });
}

function readRows(body: Record<string, unknown>): Raw[] {
  const rows = body.rows;
  return Array.isArray(rows) ? (rows as Raw[]) : [];
}

export const routes: Routes = {
  "GET /api/fpltext": async (ctx) => {
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const [routeDoc, pcrDoc] = await Promise.all([loadRouteDoc(ctx), loadPcrDoc(ctx)]);
    // PCR T/O needs each reg's JetPlan type + MTOW (like the original jetplan_ac lookup).
    const jp = await import("../jetplan.server");
    const pcrMod = await import("../port/pcr_limits");
    const pcrIata = new Set(Object.values((pcrDoc as Raw).airports || {}).map((a: any) => String(a?.iata || "").toUpperCase()));
    const regs = [...new Set(db.flights.filter((f: Raw) => pcrIata.has(String(f.dep || "").toUpperCase())).map((f: Raw) => String(f.reg || "")).filter(Boolean))];
    try { await jp.ensureRegs(ctx, regs); } catch (e) { console.warn("PCR ensureRegs:", e); }
    const specMap = new Map<string, { mtow?: number; type?: string }>();
    for (const r of regs) {
      const s = await jp.specs(ctx, r);
      specMap.set(r, s.mtow != null ? { mtow: s.mtow, type: s.type } : { type: s.type });
    }
    return {
      ok: true,
      source: db.source,
      tlk: db.tlk,
      dsp: db.dsp,
      flights: ft.public_flights(db, routeDoc.rows || [], pcrDoc,
        (reg) => specMap.get(reg) || null,
        (hint, mtow) => pcrMod.pick_variant(hint, mtow)),
    };
  },

  "GET /api/fpltext/cost": async (ctx) => {
    const doc = await loadCiDoc(ctx);
    return { ok: true, columns: doc.columns || [], rows: doc.rows || [] };
  },
  "POST /api/fpltext/cost": async (ctx) => {
    const body = await ctx.json();
    const old = await loadCiDoc(ctx);
    const doc = ft.save_cost_index(old, readRows(body));
    await setJson(ctx, "fpl.cost_index", doc);
    return { ok: true, rows: doc.rows || [] };
  },

  "GET /api/fpltext/taxi": async (ctx) => {
    const doc = await loadTaxiDoc(ctx);
    const labels = ft.taxiMonthLabels(doc);
    const active = labels[ft.taxiActiveIndex(doc)];
    return {
      ok: true,
      month: active,
      months: labels,
      source: doc.source || "",
      standard: doc.standard || {},
      rows: doc.rows || [],
    };
  },
  "POST /api/fpltext/taxi": async (ctx) => {
    const body = await ctx.json();
    const old = await loadTaxiDoc(ctx);
    const months = Array.isArray(body?.months) ? body.months.map((m: any) => String(m)) : undefined;
    const doc = ft.save_taxi(old, readRows(body), months);
    await setJson(ctx, "fpl.taxi_fuel", doc);
    const labels = ft.taxiMonthLabels(doc);
    return { ok: true, rows: doc.rows || [], months: labels, month: labels[ft.taxiActiveIndex(doc)] };
  },

  "GET /api/fpltext/route": async (ctx) => {
    const doc = await loadRouteDoc(ctx);
    return { ok: true, columns: doc.columns || [], rows: doc.rows || [] };
  },
  "POST /api/fpltext/route": async (ctx) => {
    const body = await ctx.json();
    const doc = ft.save_route_table(readRows(body));
    await setJson(ctx, "fpl.route_suffix", doc);
    return { ok: true, rows: doc.rows || [] };
  },

  "GET /api/fpltext/alt": async (ctx) => {
    const doc = await loadAltDoc(ctx);
    return { ok: true, rows: doc.routes || [] };
  },
  "POST /api/fpltext/alt": async (ctx) => {
    const body = await ctx.json();
    const old = await loadAltDoc(ctx);
    const doc = ft.save_alt_rows(old, readRows(body));
    await setJson(ctx, "fpl.alt_route", doc);
    return { ok: true, rows: doc.routes || [] };
  },

  "GET /api/fpltext/era": async (ctx) => {
    const doc = await loadEraDoc(ctx);
    return { ok: true, rows: doc.routes || [] };
  },
  "POST /api/fpltext/era": async (ctx) => {
    const body = await ctx.json();
    const old = await loadEraDoc(ctx);
    const doc = ft.save_era_rows(old, readRows(body));
    await setJson(ctx, "fpl.era", doc);
    return { ok: true, rows: doc.routes || [] };
  },

  "GET /api/fpltext/pcr": async (ctx) => {
    const doc = await loadPcrDoc(ctx);
    return { ok: true, rows: ft.pcr_table_rows(doc) };
  },
  "POST /api/fpltext/pcr": async (ctx) => {
    const body = await ctx.json();
    const old = await loadPcrDoc(ctx);
    const doc = ft.save_pcr_table(old, readRows(body));
    await setJson(ctx, "fpl.pcr_limits", doc);
    return { ok: true, rows: ft.pcr_table_rows(doc) };
  },

  "POST /api/fpltext/extra": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const taf = await import("../port/taf");
    const tafCache = await getJson<{ tafs?: Record<string, unknown>; count?: number }>(
      ctx, "wx.taf", { tafs: {}, count: 0 },
    );
    const tafs = tafCache.tafs || {};
    if (!Object.keys(tafs).length) {
      return { error: "Chưa có TAF. Bấm nút TAF trên thanh lọc." };
    }
    const fill = body.fill !== false;
    const specs: ft.Raw[] = Array.isArray(body.rows) && body.rows.length
      ? (body.rows as ft.Raw[])
      : (Array.isArray(body.ids) ? (body.ids as unknown[]).map((raw) => ({ id: raw })) : []);
    const rows: ft.Raw[] = [];
    let filled = 0;
    let missed = 0;
    for (const spec of specs) {
      const rawId = (spec as ft.Raw).id;
      const flight = resolveCrewFlight(db, spec);
      if (!flight) {
        missed += 1;
        rows.push({ id: rawId, extra: "", why: "không có chuyến", places: [] });
        continue;
      }
      const alts = [spec.talt, spec.alt1, spec.alt2];
      const [minutes, why, places] = ft.extra_from_taf(db, flight, tafs as any, alts as any);
      if (minutes === "") missed += 1;
      else if (parseInt(minutes || "0", 10) > 0) filled += 1;
      rows.push({ id: rawId, extra: fill ? minutes : "", why, places });
    }
    return {
      ok: true,
      rows,
      filled,
      missed,
      taf_count: tafCache.count || Object.keys(tafs).length,
    };
  },

  "POST /api/fpltext/pld": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const rows: ft.Raw[] = [];
    const specs: Raw[] = Array.isArray(body.rows) && body.rows.length
      ? body.rows as Raw[]
      : (Array.isArray(body.ids) ? body.ids.map(id => ({ id })) : []);
    for (const spec of specs) {
      const rawId = spec.id;
      const flight = resolveCrewFlight(db, spec);
      if (!flight) {
        rows.push({ id: rawId, pay: "", alert: `VJ${spec.flt || ""}: không khớp Crewlist hiện tại; nạp lại Crew và chọn đúng ngày/chặng.` });
        continue;
      }
      const flt = String(flight.flt || "");
      const est = ft.est_payload(db, flt);
      if (est === null) {
        rows.push({ id: rawId, flt, pay: "", alert: `VJ${flt} không có EST` });
        continue;
      }
      const [rounded, why] = ft.round_est(est, String(flight.ac || ""));
      if (rounded === null) {
        rows.push({ id: rawId, flt, est, pay: "", alert: `VJ${flt} ${why}` });
        continue;
      }
      rows.push({ id: rawId, flt, est, pay: String(rounded), alert: "" });
    }
    return { ok: true, rows };
  },

  // atc_ezfw.pack_atc() (already ported, see ../port/atc_ezfw) builds the ATC/EZFW
  // text locally from an OFP PDF already fetched from FliteBrief — it has nothing
  // to do with AviWeb. What is missing here is OFP PDF text extraction (needs the
  // FliteBrief OFP-PDF fetch + a PDF text layer reader), which is a separate
  // module's job, not AviWeb's Selenium/Vaadin problem. Never gate this on AviWeb
  // credentials.
  "POST /api/fpltext/atc": async (ctx) => {
    const body = await ctx.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return { error: "Chọn ít nhất một chuyến." };
    const convert = !!body.convert;
    const ae = await import("../port/atc_ezfw");
    const { got, missed } = await fetchAtcBlocks(items);
    if (!got.length) return { error: missed.join("\n") || "Không lấy được ATC chuyến nào." };
    if (!convert) {
      const text = ae.joinAtcBlocks(got.map((g) => g.block)).replace(/\r?\n/g, "\r\n");
      return {
        ok: true, ok_n: got.length, missed,
        filename: "ATC-ORG.txt",
        file: Buffer.from(text, "utf8").toString("base64"),
      };
    }
    const atcFix = await import("../port/atc_fix");
    const rules = atcFix.load_rules(await getJson<Raw | null>(ctx, "fpl.atc_fix", null));
    const rows = got.map(({ f, block }) => {
      const parsed = atcFix.parse_block(block) || {};
      const [converted, notes, html] = atcFix.fix_block(block, rules);
      return {
        id: f.id,
        callsign: parsed.callsign || f.callsign || "",
        dep: parsed.dep || f.dep_icao || "",
        arr: parsed.arr || f.dest_icao || "",
        original: block.trim(),
        converted, html, notes,
      };
    });
    return { ok: true, ok_n: rows.length, missed, flights: rows, filename: "ATC-ORG ÐÃ FIX.txt" };
  },

  "GET /api/fpltext/convert": async (ctx) => {
    const atcFix = await import("../port/atc_fix");
    const doc = await getJson<ReturnType<typeof atcFix.load_rules> | null>(ctx, "fpl.atc_fix", null);
    return { ok: true, ...atcFix.editor_doc(doc) };
  },

  "POST /api/fpltext/convert": async (ctx) => {
    const body = await ctx.json();
    const atcFix = await import("../port/atc_fix");
    const { doc, editor } = atcFix.save_editor(body);
    await setJson(ctx, "fpl.atc_fix", doc);
    return { ok: true, ...editor };
  },

  "POST /api/fpltext/msg": async (ctx) => {
    const body = await ctx.json();
    const kindRaw = String(body.kind || "");
    if (!atcChg.normalize_msg_kind(kindRaw)) {
      return { error: "Chọn loại điện văn: CNL, DLA hoặc CHG." };
    }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return { error: "Chọn ít nhất một chuyến." };
    const kind = atcChg.normalize_msg_kind(kindRaw);
    const { got, missed } = await fetchAtcBlocks(items);
    if (!got.length) return { error: missed.join("\n") || "Không lấy được OFP chuyến nào." };
    const need = atcChg.NEED_13.includes(kind) ? ["-13/"] : [];
    const rows: Raw[] = [];
    for (const { ix, f, block } of got) {
      const fields = atcChg.fields_from_fpl(block);
      if (!fields) { missed.push(`${f.callsign}: không đọc được FPL trong OFP`); continue; }
      const converted = atcChg.render_msg(kind, fields, items[ix] || {});
      rows.push({
        id: f.id, callsign: fields.callsign || f.callsign, dep: fields.dep || f.dep_icao,
        arr: fields.arr || f.dest_icao, original: block.trim(), converted,
        html: atcChg.msg_html(converted, { need }), notes: [],
      });
    }
    return { ok: true, ok_n: rows.length, missed, flights: rows, kind, filename: atcChg.msg_filename(kind) };
  },

  "POST /api/version/chg": async (ctx) => {
    const body = await ctx.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return { error: "Không có chuyến CHG/DLA trên bảng." };
    const { got, missed } = await fetchAtcBlocks(items);
    if (!got.length) return { error: missed.join("\n") || "Không lấy được OFP chuyến nào." };
    const chg: [string, string][] = [], dla: [string, string][] = [];
    for (const { ix, f, block } of got) {
      const it = items[ix] || {};
      const fields = atcChg.fields_from_fpl(block);
      if (!fields) { missed.push(`${f.callsign}: không đọc được FPL trong OFP`); continue; }
      const code = String(it.kind || atcChg.KIND_CHG);
      const msg = atcChg.render(code, fields, { delay_min: Number(it.delay_min) || 0, new_type: String(it.new_type || "") });
      const region = atcChg.aro_of(fields.dep || f.dep_icao);
      (code === atcChg.KIND_DLA ? dla : chg).push([region, msg]);
    }
    const text = atcChg.join_export(chg, dla).replace(/\r?\n/g, "\r\n");
    return { ok: true, ok_n: chg.length + dla.length, missed, filename: "CHG-DLA.txt",
      file: Buffer.from(text, "utf8").toString("base64") };
  },

  "POST /api/fpltext/build": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const items = Array.isArray(body.items) ? (body.items as Raw[]) : [];
    const dsp = String(body.dsp || "").trim();
    if (!dsp) return { error: "Chưa điền tên DSP." };
    const efb = String(body.efb || "").trim().replace(/^TLK\//i, "");
    if (efb) (db as { tlk: string }).tlk = efb;
    const routeDoc = await loadRouteDoc(ctx);
    const text = ft.build_req(db, items, dsp, routeDoc.rows || []);
    if (!String(text || "").trim()) return { error: "Chưa chọn chuyến nào." };
    return { ok: true, text };
  },
  "POST /api/fpltext/export": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const items = Array.isArray(body.items) ? (body.items as Raw[]) : [];
    const dsp = String(body.dsp || "").trim();
    if (!dsp) return { error: "Chưa điền tên DSP." };
    const efb = String(body.efb || "").trim().replace(/^TLK\//i, "");
    if (efb) (db as { tlk: string }).tlk = efb;
    const routeDoc = await loadRouteDoc(ctx);
    const text = ft.build_req(db, items, dsp, routeDoc.rows || []);
    if (!String(text || "").trim()) return { error: "Chưa chọn chuyến nào." };
    const bytes = ft.req_bytes(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const fileB64 = btoa(binary);
    return { ok: true, text, path: "", file_error: "", file: fileB64, filename: "FPL.req" };
  },
};

export const jobs: Jobs = {};

async function fetchAtcBlocks(items: Raw[]): Promise<{ got: { ix: number; f: any; block: string }[]; missed: string[] }> {
    const ae = await import("../port/atc_ezfw");
    const { loadFlights } = await import("../core/gantts.server");
    const { fbGet } = await import("@/lib/flitebrief.server");
    const flights = await loadFlights(3);
    const now = Date.now();
    const pickFlight = (it: Raw) => {
      const digits = ae.digitsOf(String(it.flt || ""));
      if (!digits) return null;
      const rx = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
      const dep = String(it.dep || "").toUpperCase().trim();
      const arr = String(it.arr || "").toUpperCase().trim();
      let hits = flights.filter((f: any) => rx.test([f.callsign, f.fltno, f.commercial_fltno].filter(Boolean).join(" ")));
      const byApt = hits.filter((f: any) =>
        (!dep || f.dep_iata?.toUpperCase() === dep || f.dep_icao?.toUpperCase() === dep) &&
        (!arr || f.dest_iata?.toUpperCase() === arr || f.dest_icao?.toUpperCase() === arr));
      if (byApt.length) hits = byApt;
      const win = hits.filter((f: any) => ae.inOpsWindow(f.std ?? null));
      if (win.length) hits = win;
      hits.sort((a: any, b: any) => Math.abs((a.std?.getTime() ?? 0) - now) - Math.abs((b.std?.getTime() ?? 0) - now));
      return hits[0] || null;
    };
    const pdfText = async (bytes: Uint8Array) => {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : String(text ?? "");
    };
    const missed: string[] = [];
    const got: { ix: number; f: any; block: string }[] = [];
    await Promise.all(items.map(async (it: Raw, ix: number) => {
      const label = `VJ${it.flt} ${it.dep || ""}-${it.arr || ""}`.trim();
      const f = pickFlight(it);
      if (!f) { missed.push(`${label}: không thấy trên FliteBrief`); return; }
      try {
        const res = await fbGet(`/webapi/sectors/${f.id}/ofp`, "application/pdf");
        if (!res.ok || res.status === 204) { missed.push(`${label}: chưa có OFP`); return; }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!buf.byteLength) { missed.push(`${label}: chưa có OFP`); return; }
        got.push({ ix, f, block: ae.extractAtc(await pdfText(buf)) });
      } catch (e) {
        missed.push(`${label}: ${(e as Error).message}`);
      }
    }));
    got.sort((a, b) => a.ix - b.ix);
  return { got, missed };
}
