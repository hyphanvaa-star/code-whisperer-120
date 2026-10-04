import type { Ctx, Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import * as ft from "../port/fpl_tool";
import rawSeed from "../data/fpl_tool.json";
import altSeed from "../data/fpl/alt_route.json";
import eraSeed from "../data/fpl/era.json";
import ciSeed from "../data/fpl/cost_index.json";
import taxiSeed from "../data/fpl/taxi_fuel.json";
import routeSeed from "../data/fpl/route_suffix.json";
import pcrSeed from "../data/pcr_limits.json";

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
  const raw = await loadRaw(ctx);
  if (!raw || !Array.isArray(raw.flights) || !raw.flights.length) return null;
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
    return {
      ok: true,
      source: db.source,
      tlk: db.tlk,
      dsp: db.dsp,
      flights: ft.public_flights(db, routeDoc.rows || [], pcrDoc),
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
    return {
      ok: true,
      month: doc.month || "OCT",
      source: doc.source || "",
      standard: doc.standard || {},
      rows: doc.rows || [],
    };
  },
  "POST /api/fpltext/taxi": async (ctx) => {
    const body = await ctx.json();
    const old = await loadTaxiDoc(ctx);
    const doc = ft.save_taxi(old, readRows(body));
    await setJson(ctx, "fpl.taxi_fuel", doc);
    return { ok: true, rows: doc.rows || [] };
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

  "POST /api/fpltext/export": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const items = Array.isArray(body.items) ? (body.items as Raw[]) : [];
    const dsp = String(body.dsp || "").trim();
    if (!dsp) return { error: "Chưa điền tên DSP." };
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
