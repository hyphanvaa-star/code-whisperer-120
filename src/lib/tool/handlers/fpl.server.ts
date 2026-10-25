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
import { omniPayload, exportPayloadItems } from '../port/fpl_payload';
import { jobId } from '../jobs';
import { cutVerifiedEzfw, pickEzfwSector, type EzfwSector } from '../port/khb_ezfw';
import { parseOpsDate, sameOpsDay, selectOperationalFlight, validateOperationalAtc } from '../port/operational_flight';
export { parseOpsDate, sameOpsDay } from '../port/operational_flight';

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

/** Crewlist thiếu payload → dò EST từ cache Omni (khớp số hiệu + chặng + NGÀY chuyến). */
async function omniEstFallback(ctx: Ctx, flight: Raw): Promise<number | null> {
  try {
    const cache = await getJson<{ rows?: Array<Record<string, unknown>> }>(ctx, "omni.cache", { rows: [] });
    return omniPayload(cache.rows || [], flight);
  } catch {
    return null;
  }
}

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
  const raw: Raw = { ...(base || {}), payload: [], flights, source: state.file };
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
  "POST /api/fpltext/ezfw": async (ctx) => {
    const body = await ctx.json();
    const input = String(body.flight || '').trim();
    if (input.length > 500 || !/^(?:(?:VJC|VJ)?\d{1,5})(?:[\s,;]+(?:VJC|VJ)?\d{1,5})*$/i.test(input)) return { error: 'Nhập số hiệu chuyến, ví dụ 7527 3901.' };
    const wants = [...new Set(input.toUpperCase().split(/[\s,;]+/).map(s => s.replace(/\D/g, '').replace(/^0+/, '')))];
    if (!wants.length || wants.length > 30 || wants.some(s => !s)) return { error: 'Nhập từ 1 đến 30 chuyến.' };
    const pc = await import('../pcagent.server');
    if (!pc.agentOnline(await pc.agentInfo(ctx))) return { error: 'Mở trợ lý PC và đăng nhập cùng tài khoản để tự lưu xuống D/C.' };
    return { id: jobId('khb_ezfw', { wants }) };
  },
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
    const missedList: string[] = [];
    const label = (f: ft.Raw) => {
      const flt = String(f.flt ?? "").trim().replace(/^VJC?/i, "");
      return `VJ${flt}${f.dep || f.arr ? ` ${f.dep || "?"}-${f.arr || "?"}` : ""}`;
    };
    for (const spec of specs) {
      const rawId = (spec as ft.Raw).id;
      const flight = resolveCrewFlight(db, spec);
      if (!flight) {
        missed += 1;
        missedList.push(`${label(spec)}: không khớp Crewlist hiện tại`);
        rows.push({ id: rawId, extra: "", why: "không có chuyến", places: [] });
        continue;
      }
      const alts = [spec.talt, spec.alt1, spec.alt2];
      const [minutes, why, places] = ft.extra_from_taf(db, flight, tafs as any, alts as any);
      if (minutes === "") {
        missed += 1;
        missedList.push(`${label(flight)}: ${why || "không có TAF"}`);
      } else if (parseInt(minutes || "0", 10) > 0) filled += 1;
      rows.push({ id: rawId, extra: fill ? minutes : "", why, places });
    }
    return {
      ok: true,
      rows,
      filled,
      missed,
      missed_list: missedList,
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
      const est = await omniEstFallback(ctx, flight);
      if (est === null) {
        // Không có EST: điền tạm 9999, đánh dấu manual để dispatcher tự kiểm tra.
        rows.push({ id: rawId, flt, pay: "9999", manual: true, alert: `VJ${flt} không có EST — điền tạm 9999, tự kiểm tra` });
        continue;
      }
      const [rounded, why] = ft.round_est(est, String(flight.ac || ""));
      if (rounded === null) {
        // Vượt ngưỡng làm tròn: điền tạm EST gốc, đánh dấu manual để tự điều chỉnh.
        rows.push({ id: rawId, flt, est, pay: String(est), manual: true, alert: `VJ${flt} ${why} — điền tạm ${est}, tự điều chỉnh` });
        continue;
      }
      rows.push({ id: rawId, flt, est, pay: String(rounded), manual: false, alert: "" });
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
    const khbDsp = String(body.dsp || "").trim();
    const normName = (s: string) => s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
    const rows = got.map(({ ix, f, block, plan }) => {
      const parsed = atcFix.parse_block(block) || {};
      const [converted, notes, html] = atcFix.fix_block(block, rules);
      const it = (items[ix] || {}) as Raw;
      const khbDate = String(it.date || "");
      const dofM = /DOF\/(\d{2})(\d{2})(\d{2})/.exec(block);
      const dof = dofM ? `${dofM[3]}/${dofM[2]}/20${dofM[1]}` : "";
      const stdD = f.std ? new Date(new Date(f.std).getTime() + 7 * 3600e3) : null;
      const stdDate = stdD && !isNaN(stdD.getTime())
        ? `${String(stdD.getUTCDate()).padStart(2, "0")}/${String(stdD.getUTCMonth() + 1).padStart(2, "0")}/${stdD.getUTCFullYear()}` : "";
      const kp = parseOpsDate(khbDate);
      const khbY = kp ? (kp.y ?? (stdD && !isNaN(stdD.getTime()) ? stdD.getUTCFullYear() : new Date().getUTCFullYear())) : 0;
      const khbNorm = kp ? `${String(kp.d).padStart(2, "0")}/${String(kp.m).padStart(2, "0")}/${khbY}` : "";
      // DOF là ngày UTC; chuyến sau nửa đêm giờ VN có DOF lùi 1 ngày nên so theo STD (giờ VN).
      const date_ok = khbNorm ? stdDate === khbNorm : null;
      const fbDsp = String(f.dispatcher || "").trim();
      const dsp_ok = !khbDsp ? null : !fbDsp ? false : (normName(fbDsp).includes(normName(khbDsp)) || normName(khbDsp).includes(normName(fbDsp)));
      return {
        id: f.id,
        callsign: parsed.callsign || f.callsign || "",
        plan: plan || "", reg: f.reg || "",
        dep: parsed.dep || f.dep_icao || "",
        arr: parsed.arr || f.dest_icao || "",
        original: block.trim(),
        converted, html, notes,
        verify: { khb_date: khbNorm, std_date: stdDate, dof, date_ok, khb_dsp: khbDsp, fb_dsp: fbDsp, dsp_ok },
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
      const std: Date | null = f.std instanceof Date ? f.std : (f.std ? new Date(f.std) : null);
      // Ưu tiên giờ trên bảng (STD gốc / ETD mới, giờ VN) — FliteBrief có thể đã đổi STD theo ETD.
      // EOBT gốc từ AviWeb (UTC HHMM) thắng mọi nguồn khác — đó là điện gốc đã nộp.
      const avi = /^\d{4}$/.test(String(it.avi_eobt || "")) ? String(it.avi_eobt) : "";
      const orig = avi || vnToUtc(it.std) || (std && !isNaN(std.getTime())
        ? String(std.getUTCHours()).padStart(2, "0") + String(std.getUTCMinutes()).padStart(2, "0") : "");
      const fresh = vnToUtc(it.etd);
      const msg = atcChg.render(code, fields, { delay_min: Number(it.delay_min) || 0, new_type: String(it.new_type || ""), orig_eobt: orig, new_eobt: fresh });
      const region = atcChg.aro_of(fields.dep || f.dep_icao);
      (code === atcChg.KIND_DLA ? dla : chg).push([region, msg]);
    }
    const text = atcChg.join_export(chg, dla).replace(/\r?\n/g, "\r\n");
    return { ok: true, ok_n: chg.length + dla.length, missed, filename: "CHG-DLA.txt",
      file: Buffer.from(text, "utf8").toString("base64") };
  },

  // Tàu FliteBrief hiện tại của từng chuyến CHG — để tô xanh khi đã lên tàu mới.
  "POST /api/version/fbreg": async (ctx) => {
    const body = await ctx.json();
    const items = Array.isArray(body.items) ? (body.items as Raw[]) : [];
    const { loadFlights } = await import("../core/gantts.server");
    const flights = (await loadFlights(3, true)) as any[];
    const out = items.map((it) => {
      try {
        const hit = selectOperationalFlight(flights, it);
        return { flt: it.flt, sector_id: hit.id, found: true, reg: String(hit.reg || "") };
      } catch (e) { return { flt: it.flt, found: false, reg: "", error: (e as Error).message }; }
    });
    return { ok: true, items: out };
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
    const cache = await getJson<{ rows?: Raw[] }>(ctx, 'omni.cache', { rows: [] });
    const text = ft.build_req(db, exportPayloadItems(db, items, cache.rows || []), dsp, routeDoc.rows || []);
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
    const cache = await getJson<{ rows?: Raw[] }>(ctx, 'omni.cache', { rows: [] });
    const text = ft.build_req(db, exportPayloadItems(db, items, cache.rows || []), dsp, routeDoc.rows || []);
    if (!String(text || "").trim()) return { error: "Chưa chọn chuyến nào." };
    const bytes = ft.req_bytes(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const fileB64 = btoa(binary);
    return { ok: true, text, path: "", file_error: "", file: fileB64, filename: "FPL.req" };
  },
  /** Đổi tàu: REQ mới theo crewlist mới (tàu/CI/taxi/pilot), PAY + EXTRA giữ từ OFP cũ của đúng sector. */
  "POST /api/fpltext/chgreq": async (ctx) => {
    const body = await ctx.json();
    const db = await loadDb(ctx);
    if (!db) return { error: NO_CREWLIST };
    const sectorId = Number(body.sector_id) || 0;
    if (!sectorId) return { error: "Không tra được chuyến trên FliteBrief." };
    const dsp = String(body.dsp || "").trim();
    const dg = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
    const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
    const [dep, arr] = String(body.route || "").split("-").map(up);
    const want = dg(body.flt);
    const day = parseOpsDate(body.date);
    if (!day || !dep || !arr) return { error: "Thiếu ngày/chặng chuyến — không soạn REQ." };
    const { loadFlights } = await import("../core/gantts.server");
    let sector;
    try { sector = selectOperationalFlight(await loadFlights(3, true), { sector_id: sectorId, flt: body.flt, date: body.date, dep, arr }); }
    catch (e) { return { error: (e as Error).message }; }
    const cands = db.flights.filter((f) => dg(f.flt) === want && up(f.dep) === dep && up(f.arr) === arr
      && (() => { const p = parseOpsDate(f.date); return !!p && p.d === day.d && p.m === day.m && (day.y === undefined || p.y === day.y); })());
    if (cands.length !== 1) return { error: cands.length ? "Crewlist có nhiều chuyến trùng — không chắc đúng chuyến." : "Crewlist mới không có chuyến VJ" + want + " " + dep + "-" + arr + " đúng ngày." };
    const flight = cands[0];
    if (!flight) return { error: "Không xác định được dòng Crewlist." };
    const { fbGet } = await import("@/lib/flitebrief.server");
    let txt = "";
    for (const p of [`/webapi/sectors/${sectorId}/ofp/0`, `/webapi/sectors/${sectorId}/ofp`]) {
      const res = await fbGet(p, "application/pdf");
      if (!res.ok || res.status === 204) continue;
      const b = new Uint8Array(await res.arrayBuffer());
      if (b.byteLength <= 4) continue;
      if (String.fromCharCode(...b.slice(0, 4)) === "%PDF") {
        const { ofpTextFromPdf } = await import("../port/ofp_weights");
        txt = await ofpTextFromPdf(b);
      } else txt = new TextDecoder().decode(b);
      if (txt) break;
    }
    if (!txt) return { error: "Chưa đọc được OFP cũ trên FliteBrief." };
    const { extractAtc } = await import("../port/atc_ezfw");
    try { validateOperationalAtc(extractAtc(txt), sector); } catch (e) { return { error: (e as Error).message }; }
    const { parseOperationalText } = await import("../port/ofp_weights");
    let w;
    try { w = parseOperationalText(txt, sectorId); } catch (e) { return { error: "OFP cũ: " + (e as Error).message }; }
    if (w.pld == null) return { error: "OFP cũ không có PLD — không lấy được payload." };
    const efb = String(body.efb || "").trim().replace(/^TLK\//i, "");
    if (efb) (db as { tlk: string }).tlk = efb;
    const routeDoc = await loadRouteDoc(ctx);
    const extra = ft.extraMinutesText(w.extra_time);
    const oldDsp = ft.ofpDispatcher(txt) || dsp;
    if (!oldDsp) return { error: "OFP cũ không ghi tên DSP và chưa điền tên DSP." };
    const item: Raw = { id: flight.row, seq: String(body.seq || ""), pay: String(Math.trunc(w.pld)), extra };
    const text = ft.build_req(db, [item], oldDsp, routeDoc.rows || []);
    if (!text.trim()) return { error: "Không soạn được REQ." };
    const bytes = ft.req_bytes(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return { ok: true, text, file: btoa(binary), filename: `VJC${want}_${dep}${arr}.req`,
      pld: w.pld, extra, dsp: oldDsp, reg: flight.reg, plan_no: w.plan_no || "" };
  },
};

export const jobs: Jobs = {
  khb_ezfw: async (params, emit, ctx) => {
    const wants = Array.isArray(params.wants) ? params.wants.slice(0, 30).map(String).filter(s => /^\d{1,5}$/.test(s)) : [];
    let ok = 0, failed = 0;
    try {
      if (!wants.length) throw new Error('Chưa nhập chuyến.');
      const db = await loadDb(ctx);
      if (!db) throw new Error(NO_CREWLIST);
      const pc = await import('../pcagent.server');
      if (!pc.agentOnline(await pc.agentInfo(ctx))) throw new Error('Trợ lý PC chưa kết nối.');
      const { loadFlights } = await import('../core/gantts.server');
      const { fbGet } = await import('@/lib/flitebrief.server');
      const sectors = await loadFlights(3, true);
      const now = new Date();
      for (const want of wants) {
        emit({ type: 'line', text: `VJC${want}: đang đối chiếu KHB và OFP…` });
        try {
          const rows = db.flights.filter(f => String(f.flt || '').replace(/\D/g, '').replace(/^0+/, '') === want);
          if (!rows.length) throw new Error('Không có trong Crewlist KHB đang nạp.');
          const matches: EzfwSector[] = [];
          let reason = '';
          for (const row of rows) {
            try {
              matches.push(pickEzfwSector(sectors, { flt: want, reg: String(row.reg || ''), dep: String(row.dep || ''), arr: String(row.arr || ''), day: parseOpsDate(row.date) }, now));
            } catch (e) { reason = (e as Error).message; }
          }
          matches.sort((a, b) => (a.std?.getTime() ?? Infinity) - (b.std?.getTime() ?? Infinity));
          const sector = matches[0];
          if (!sector) throw new Error(reason || 'Không xác định được chuyến.');
          if (matches[1]?.std?.getTime() === sector.std?.getTime()) throw new Error('Crewlist có chuyến trùng — không tự chọn.');
          let text = '';
          for (const path of [`/webapi/sectors/${sector.id}/ofp/0`, `/webapi/sectors/${sector.id}/ofp`]) {
            const res = await fbGet(path, 'application/pdf');
            if (!res.ok || res.status === 204) continue;
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.length <= 4) continue;
            if (String.fromCharCode(...bytes.slice(0, 4)) === '%PDF') {
              const { ofpLayoutFromPdf } = await import('../port/ofp_layout');
              text = await ofpLayoutFromPdf(bytes);
            } else text = new TextDecoder().decode(bytes);
            if (text) break;
          }
          const files = cutVerifiedEzfw(text, sector);
          emit({ type: 'line', text: `VJC${want}: đúng ${sector.reg}, ${sector.dep_icao}–${sector.dest_icao}, STD ${sector.std?.toISOString()} — đang lưu 2 file…` });
          for (const file of files) {
            const id = await pc.enqueue('save_file', { dir: 'D:\\ATC-EZFW', name: file.name, data_b64: Buffer.from(file.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64') });
            const result = await pc.waitResult(id, 120_000);
            if (!result.path) throw new Error('Trợ lý chưa xác nhận đường dẫn file đã ghi.');
            emit({ type: 'line', text: `Đã lưu ${String(result.path)}` });
          }
          ok++;
        } catch (e) { failed++; emit({ type: 'line', text: `VJC${want}: BỎ QUA — ${(e as Error).message}` }); }
        emit({ type: 'progress', done: ok + failed, total: wants.length });
      }
      emit({ type: 'end', code: failed ? 1 : 0, ok, failed, text: `Đã lưu ${ok} chuyến (${ok * 2} file); lỗi ${failed} chuyến.` });
    } catch (e) { emit({ type: 'line', text: (e as Error).message }); emit({ type: 'end', code: 1, ok, failed: wants.length - ok }); }
  },
};

/** Local VN "HH:MM" → UTC "HHMM". */
function vnToUtc(hm: unknown): string {
  const m = String(hm || "").match(/(\d{1,2})\D?(\d{2})/);
  if (!m) return "";
  const t = (((+m[1] * 60 + +m[2] - 420) % 1440) + 1440) % 1440;
  return String(Math.trunc(t / 60)).padStart(2, "0") + String(t % 60).padStart(2, "0");
}

export async function fetchAtcBlocks(items: Raw[]): Promise<{ got: { ix: number; f: any; block: string; plan?: string }[]; missed: string[] }> {
    const ae = await import("../port/atc_ezfw");
    const { loadFlights } = await import("../core/gantts.server");
    const { fbGet } = await import("@/lib/flitebrief.server");
    const flights = await loadFlights(3, true);
    const pdfText = async (bytes: Uint8Array) => {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : String(text ?? "");
    };
    const missed: string[] = [];
    const got: { ix: number; f: any; block: string; plan?: string }[] = [];
    await Promise.all(items.map(async (it: Raw, ix: number) => {
      const label = `VJ${it.flt} ${it.dep || ""}-${it.arr || ""}`.trim();
      try {
        const f = selectOperationalFlight(flights, it);
        // Same endpoint as the working OFP download (/api/fb/file): /ofp/0, then legacy /ofp.
        // FliteBrief serves the OFP either as PDF or as plain-text CFP; accept both.
        let txt = "";
        for (const p of [`/webapi/sectors/${f.id}/ofp/0`, `/webapi/sectors/${f.id}/ofp`]) {
          const res = await fbGet(p, "application/pdf");
          if (!res.ok || res.status === 204) continue;
          const b = new Uint8Array(await res.arrayBuffer());
          if (b.byteLength <= 4) continue;
          if (String.fromCharCode(...b.slice(0, 4)) === "%PDF") { txt = await pdfText(b); break; }
          const t = new TextDecoder().decode(b);
          if (/\(FPL-|^[ \t]*CFP[ \t]+\d+/im.test(t)) { txt = t; break; }
        }
        if (!txt) { missed.push(`${label}: chưa có OFP`); return; }
        const cfp = /^[ \t]*CFP[ \t]+(\d+)\b/im.exec(txt)?.[1] || "";
        const block = ae.extractAtc(txt);
        validateOperationalAtc(block, f);
        got.push({ ix, f, block, plan: String(f.plan_no || cfp || "") });
      } catch (e) {
        missed.push(`${label}: ${(e as Error).message}`);
      }
    }));
    got.sort((a, b) => a.ix - b.ix);
  return { got, missed };
}
