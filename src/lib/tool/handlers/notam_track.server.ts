import type { Jobs, Routes } from "../types";
import { q } from "../types";
import type { Flight } from "../core/models";
import { loadFlights, applyFilters, findOperationalFlightById, OPS_LOOKUP_DAYS } from "../core/gantts.server";
import { fbJson } from "../../flitebrief.server";
import { normIcao, apply24h, placeFromPayload } from "../port/notam_check";
import { run, runDomesticFleet, flightAirfields, type Place, type Track } from "../port/notam_track";
import { flightAirfields as tuneAirfields, locationsOf } from "../port/notam_check_tune";
import { setNotamProgress } from "./notam.server";

// Port of web.py's "/api/notam/track" and "/api/notam/check" (_api_notam_track /
// _api_notam_check). Both reuse the notam_track.ts engine (compare/run/runDomesticFleet)
// with NOTAM data fetched live from FliteBrief (same webapi/icaos/<icao> endpoint as
// notam.server.ts's /api/notam/lookup) and progress published through
// setNotamProgress so "/api/notam/track/progress?tid=…" can be polled by the page.
//
// The original also overlays the flight's real JetPlan route KML onto the map (great-
// circle track points, FIR crossing times) via jetplan_kml.py logging into jetplan.com
// and pulling the plotted route. That login/scrape was not ported (only jetplan_ac.py,
// the aircraft-DB query, exists under ../jetplan.server.ts — no KML/session helper).
// So `fetchTrack` below returns an honest Vietnamese error and an empty track instead
// of a fabricated line; distance-to-track math in notam_track.ts already degrades to
// `dist_nm: null` ("không tính được") in that case, same as upstream without its KML.
import { trackFor } from "../port/jetplan_kml";
import { supKeys, namedAreaIds, notamGeoms, type Geom } from "../port/notam_track";
import { bindCtx, rings_of, hours_of, dah_ring, dah_named, japanTrainingRings, japanIdsInText, koreaRestrictedRings } from "../aip_sup.server";
import { expand_au_area_ids } from '../port/aip_sup';
import AIP_CATALOG from '../port/aip_catalog.json';
import { enrIdsInText, enrGeoms } from '../port/aip_enr_catalog';
import type { Ctx } from "../types";
import { getJson } from '../store.server';
import type { Chart } from '../port/aip_vn_chart';

const AU_DAH_ID = /\bY[A-Z]{3}\/([MRDP]\d{3,4}[A-Z]?)(?![0-9])/gi;
const AU_CTA_ID = /\bY[A-Z]{3}(?:-Y[A-Z]{3})?\/([A-Z][A-Z0-9'./\-]*(?:\s+[A-Z][A-Z0-9'./\-]*){0,6}\s+CTA\s+[A-Z]\d{1,2})\b/gi;

// NOTAM E) often names the CTA without the ``YBBB/`` prefix: ``WILLIAMTOWN CTA C9 ACT``.
const AU_CTA_BARE = /\b([A-Z][A-Z'\-]*(?:\s+[A-Z][A-Z'\-]*){0,3}\s+CTA\s+[A-Z]\d{1,2})\b/g;

/** notam_check.py sup_hours_schedule + AIP SUP/DAH rings — bounded so Check NOTAM never hangs. */
async function enrichWithSup(ctx: Ctx, places: Place[]): Promise<void> {
  bindCtx(ctx);
  const deadline = Date.now() + 20000;
  const tasks: { priority: number; run: () => Promise<void> }[] = [];
  let japanCatalog: ReturnType<typeof japanTrainingRings> | undefined;
  let japanWarnings: ReturnType<typeof japanTrainingRings> | undefined;
  let koreaCatalog: ReturnType<typeof koreaRestrictedRings> | undefined;
  const supRequests = new Map<string, ReturnType<typeof rings_of>>();
  for (const place of places) {
    const notams = ((place as Record<string, unknown>).notams as Record<string, unknown>[]) || [];
    for (const n of notams) {
      const blob = `${String(n.e_field ?? "")} ${String(n.text ?? "")}`;
      const fir = String(n.qfir ?? (place as Record<string, unknown>).fir ?? place.code ?? "");
      const keys = supKeys(blob);
      const au = fir.toUpperCase().startsWith("Y");
      const jp = /^(RJ|RO)/i.test(fir) && /\bAIP\b|CIVIL TRAINING|TRAINING AND TESTING AREA|WARNING AREA|\b[WRDP]\s*-\s*\d/i.test(blob);
      const krIds = /^RK/i.test(fir) ? namedAreaIds(blob).filter(id => /^RK[DRP]/.test(id)) : [];
      const enrIds = enrIdsInText(blob, fir);
      // Resolve the offline catalogue immediately for every NOTAM, independently
      // of live SUP timeouts or task ordering. All known named areas can draw.
      if (enrIds.length) {
        const geoms = [...((n.sup_geoms as Geom[] | undefined) ?? [])];
        for (const name of enrIds) {
          if (!geoms.some(g => g.name === name)) geoms.push(...enrGeoms(name));
        }
        n.sup_geoms = geoms;
      }
      if (!keys.length && !au && !jp && !krIds.length && !enrIds.length) continue;
      // Bundled AU DAH names (e.g. "WILLIAMTOWN CTA C9") resolve offline — do it now so slow SUP downloads cannot starve them past the deadline.
      if (au) {
        const pre: Geom[] = [];
        const U = blob.toUpperCase();
        for (const m of U.matchAll(AU_CTA_ID)) {
          const ring = await dah_named(m[1]!, fir);
          if (ring.length >= 3 && !pre.some(g => g.name === m[1])) pre.push({ name: m[1]!, shape: "polygon", ring, source: "DAH" });
        }
        for (const m of U.matchAll(AU_CTA_BARE)) {
          const words = m[1]!.replace(/\s+/g, " ").trim().split(" ");
          for (let k = 0; k < words.length - 2; k++) {
            const name = words.slice(k).join(" ");
            if (pre.some(g => g.name === name)) break;
            const ring = await dah_named(name, fir);
            if (ring.length >= 3) { pre.push({ name, shape: "polygon", ring, source: "DAH" }); break; }
          }
        }
        if (pre.length) n.sup_geoms = [...((n.sup_geoms as Geom[] | undefined) ?? []), ...pre];
      }
      const task = async () => {
        const geoms: Geom[] = [...(((n.sup_geoms as Geom[] | undefined) ?? []))];
        if (krIds.length) {
          koreaCatalog ??= koreaRestrictedRings(ctx);
          const table = await koreaCatalog;
          for (const name of krIds) {
            const ring = table[name.replace(/-/g, '')];
            if (ring && ring.length >= 3) geoms.push({ name, shape: 'polygon', ring, source: 'aip' });
          }
        }
        if (jp && /ENR\s*5\.3|CIVIL TRAINING|TRAINING AND TESTING AREA/i.test(blob)) {
          japanCatalog ??= japanTrainingRings(ctx);
          const table = await japanCatalog;
          for (const name of japanIdsInText(table, blob)) {
            const ring = table[name];
            if (ring && ring.length >= 3) geoms.push({ name, shape: 'polygon', ring, source: 'aip' });
          }
        }
        if (jp && /ENR\s*5\.1|P\s*51\s*-\s*1|WARNING AREA|\b[WRDP]\s*-\s*\d/i.test(blob)) {
          japanWarnings ??= japanTrainingRings(ctx, '5.1');
          const table = await japanWarnings;
          for (const name of japanIdsInText(table, blob)) {
            const ring = table[name];
            if (ring && ring.length >= 3) geoms.push({ name, shape: 'polygon', ring, source: 'aip' });
          }
        }
        for (const key of keys) {
          if (Date.now() > deadline) return;
          const saved = /^(RJ|RO)/i.test(fir) ? (AIP_CATALOG.sup as unknown as Record<string, Record<string, [string, [number, number][]]>>)[key] : undefined;
          const cacheKey = `${fir}:${key}`;
          if (!saved && !supRequests.has(cacheKey)) supRequests.set(cacheKey, rings_of(key, fir, ctx));
          const pending = supRequests.get(cacheKey);
          const table = saved ? Object.fromEntries(Object.entries(saved).map(([nr, [name, ring]]) => [nr, { name, ring }])) : pending ? await pending : {};
          const wanted = new Set([...blob.matchAll(/\bNR\.?\s*(\d+)\b|\bAREA\s*:?\s*\(\s*(\d+)\s*\)/gi)].map(m => `NR.${Number(m[1] || m[2])}`));
          for (const [nr, item] of Object.entries(table)) {
            if (wanted.size && !wanted.has(nr)) continue;
            if (item.ring.length >= 3) geoms.push({ name: item.name || nr, shape: "polygon", ring: item.ring, source: 'aip' });
          }
          if (geoms.length) n.sup_geoms = geoms;
          if (!saved && !String(n.d_field ?? "").trim() && Date.now() < deadline) {
            const hours = await hours_of(key, fir, ctx);
            if (hours) { n.d_field = hours; n.d_src = "AIP SUP"; }
          }
        }
        if (au && !geoms.length && Date.now() < deadline) {
          for (const ident of expand_au_area_ids(blob)) {
            const ring = await dah_ring(ident, fir);
            if (ring.length >= 3) geoms.push({ name: ident, shape: 'polygon', ring, source: 'aip' });
          }
          for (const m of blob.matchAll(AU_DAH_ID)) {
            const ring = await dah_ring(m[1]!, fir);
            if (ring.length >= 3 && !geoms.some(g => g.name === m[1]?.toUpperCase())) geoms.push({ name: m[1].toUpperCase(), shape: "polygon", ring, source: 'aip' });
          }
          for (const m of blob.matchAll(AU_CTA_ID)) {
            const ring = await dah_named(m[1]!, fir);
            if (ring.length >= 3) geoms.push({ name: m[1]!.toUpperCase(), shape: "polygon", ring, source: "DAH" });
          }
          for (const m of blob.toUpperCase().matchAll(AU_CTA_BARE)) {
            const words = m[1]!.replace(/\s+/g, " ").trim().split(" ");
            // try longest name first, dropping leading noise words (e.g. "E)", "ACTIVATION OF")
            for (let k = 0; k < words.length - 2; k++) {
              const name = words.slice(k).join(" ");
              if (geoms.some(g => g.name === name)) break;
              const ring = await dah_named(name, fir);
              if (ring.length >= 3) { geoms.push({ name, shape: "polygon", ring, source: "DAH" }); break; }
            }
          }
        }
        if (geoms.length) n.sup_geoms = geoms;
      };
      // ENR catalog work must not be starved by dozens of unrelated SUP downloads.
      const hasBoundary = notamGeoms(n).some(g => g.shape === 'polygon' || g.shape === 'line' || (g.shape === 'circle' && g.source !== 'pin'));
      tasks.push({ priority: jp && /ENR\s*5\.[13]/i.test(blob) ? 0 : hasBoundary ? 2 : 1, run: task });
    }
  }
  tasks.sort((a, b) => a.priority - b.priority);
  let i = 0;
  const worker = async () => { while (i < tasks.length && Date.now() < deadline) { const t = tasks[i++]; if (!t) return; try { await t.run(); } catch { /* degrade */ } } };
  await Promise.race([
    Promise.all(Array.from({ length: 4 }, worker)),
    new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
  ]);
}

async function fetchPlace(code: string, want: string): Promise<Place> {
  const icao = normIcao(code);
  if (!icao) {
    return {
      code: String(code || "").toUpperCase(), kind: "", name: "", iata: "", fir: "",
      notam_count: 0, notams: [], error: "Mã không phải ICAO 4 ký tự.", uses: [],
    };
  }
  try {
    const payload = await fbJson<Record<string, unknown>>(`/webapi/icaos/${icao}`);
    // Filter the portal's ALL payload before enrichment, summaries and map hits.
    return apply24h(placeFromPayload(icao, payload, want)) as Place;
  } catch (exc) {
    return {
      code: icao, kind: "", name: "", iata: "", fir: "", notam_count: 0, notams: [],
      error: String((exc as Error)?.message ?? exc), uses: [],
    };
  }
}

/** Dedup fetch of every airport + its parent FIR a flight (or fleet of flights) touches. */
async function fetchOfpText(flight: Flight): Promise<string> {
  try {
    const { fetchOfpPdf, ofpPdfText } = await import("./briefing_release.server");
    const blob = await fetchOfpPdf(flight.id);
    if (!blob) return "";
    const head = String.fromCharCode(...blob.slice(0, 4));
    // FliteBrief serves some OFPs as plain-text CFP instead of PDF.
    return head === "%PDF" ? await ofpPdfText(blob) : new TextDecoder().decode(blob);
  } catch { return ""; }
}

async function fetchPlacesFor(flights: Flight[], ofpText = "", ofpTexts: Record<number, string> = {}): Promise<Place[]> {
  const wantByCode = new Map<string, string>();
  const firCodes = new Set<string>();
  const usesByCode = new Map<string, { cs: string; role: string; id: number }[]>();
  const use = (code: string, flight: Flight, role: string) => {
    const held = usesByCode.get(code) || [];
    if (!held.some(u => u.id === flight.id && u.role === role)) held.push({ cs: flight.callsign, role, id: flight.id });
    usesByCode.set(code, held);
  };
  for (const flight of flights) {
    const text = ofpTexts[flight.id] || ofpText;
    const fields = text ? tuneAirfields(flight, text) : flightAirfields(flight);
    for (const [code, role] of fields) { wantByCode.set(code, "A"); use(code, flight, role); }
    if (text) {
      for (const f of locationsOf(flight, text).firs || []) { const c = normIcao(f); if (c) { firCodes.add(c); use(c, flight, 'FIR'); } }
    }
  }
  const places = await Promise.all([...wantByCode.entries()].map(([code, want]) => fetchPlace(code, want)));
  for (const place of places) {
    const fir = String((place as Record<string, unknown>).fir ?? "");
    if (fir) {
      firCodes.add(fir);
      for (const u of usesByCode.get(String(place.code)) || []) {
        const flight = flights.find(f => f.id === u.id);
        if (flight) use(fir, flight, 'FIR');
      }
    }
  }
  const firPlaces = await Promise.all([...firCodes].map((code) => fetchPlace(code, "FIR")));
  return [...places, ...firPlaces].map(p => ({ ...p, uses: usesByCode.get(String(p.code)) || [] }));
}

async function fetchTrack(flight: Flight): Promise<{ track: Track; error: string }> {
  let jpErr = "";
  try {
    const t = await trackFor(flight);
    if (t.points.length || t.line.length) return { track: t as unknown as Track, error: "" };
  } catch (exc) {
    jpErr = String((exc as Error)?.message ?? exc);
  }
  // Fallback: NAV LOG coordinates from the FliteBrief OFP.
  try {
    const { parseNavlog } = await import("../port/ofp_navlog");
    const text = await fetchOfpText(flight);
    const nav = parseNavlog(text);
    if (nav.line.length >= 2) {
      return { track: { plan: "", via: "ofp", points: nav.points, line: nav.line } as unknown as Track, error: "" };
    }
  } catch { /* fall through */ }
  return { track: { plan: "", via: "", points: [], line: [] }, error: jpErr || "Không lấy được route (JetPlan/OFP)." };
}

async function findFlight(id: number): Promise<Flight | null> {
  return findOperationalFlightById(id);
}

export const routes: Routes = {
  // Briefing pack PDF của chuyến (FliteBrief "Briefing Pack" = GET /webapi/sectors/{id}/pack).
  "GET /api/notam/bpack": async (ctx) => {
    const fid = parseInt(q(ctx.params, "fid"), 10);
    if (!fid) return { error: "thiếu fid" };
    const { fbGet } = await import("../../flitebrief.server");
    const r = await fbGet(`/webapi/sectors/${fid}/pack`, "application/pdf");
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("pdf")) return { error: `FliteBrief chưa có Briefing pack (HTTP ${r.status})` };
    return new Response(r.body, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  },
  // Route dự bị (ALT1/ALT2/TALT) từ NAV LOG alternate trong OFP — KML JetPlan không có.
  "GET /api/notam/alts": async (ctx) => {
    const fid = parseInt(q(ctx.params, "fid"), 10);
    if (!fid) return { error: "thiếu fid." };
    const flight = await findFlight(fid);
    if (!flight) return { error: `Không tìm thấy chuyến fid=${fid}.` };
    const text = await fetchOfpText(flight);
    if (!text) return { error: "Không tải được OFP." };
    const { parseAltRoutes } = await import("../port/ofp_alt_routes");
    const r = parseAltRoutes(text, String((flight as unknown as Record<string, unknown>).dest_icao || ""));
    return { ok: true, fid, ...r };
  },
  // web.py _api_notam_track(fid): đối chiếu NOTAM 24H với track của một chuyến.
  "GET /api/notam/track": async (ctx) => {
    const fid = parseInt(q(ctx.params, "fid") || q(ctx.params, "id"), 10);
    const tid = q(ctx.params, "tid");
    if (!fid || Number.isNaN(fid)) return { error: "thiếu fid (mã chuyến)." };
    const flight = await findFlight(fid);
    if (!flight) return { error: `Không tìm thấy chuyến fid=${fid}.` };
    try {
      const result = await run(flight, {
        chart: await getJson<Chart | null>(ctx, 'notam.vnchart', null),
        fetchPlaces: async (f, ofp) => { const p = await fetchPlacesFor([f], ofp || ""); await enrichWithSup(ctx, p); return p; },
        fetchOfpText,
        fetchTrack,
        onProgress: (text) => void (tid && setNotamProgress(ctx, tid, text)),
      });
      if (tid) await setNotamProgress(ctx, tid, "Xong");
      return result;
    } catch (exc) {
      if (tid) await setNotamProgress(ctx, tid, "Lỗi");
      return { ok: false, error: String((exc as Error)?.message ?? exc) };
    }
  },

  // web.py _api_notam_check(days): đối chiếu NOTAM cho cả đội bay nội địa.
  "GET /api/notam/check": async (ctx) => {
    const daysRaw = q(ctx.params, "days", "1");
    const tid = q(ctx.params, "tid");
    const days = Math.max(1, Math.min(OPS_LOOKUP_DAYS, parseInt(daysRaw, 10) || 1));
    // Chỉ check các chuyến của DSP đang chọn (và khung giờ back/ahead) —
    // giống web.py: bộ lọc dispatcher trên tab Check NOTAM quyết định phạm vi.
    const flights = applyFilters(await loadFlights(days), ctx.params);
    if (!flights.length) {
      const dsp = q(ctx.params, "dispatcher");
      return {
        ok: false,
        error: dsp
          ? `Không có chuyến nào của DSP "${dsp}" trong khoảng ngày đã chọn.`
          : "Không có chuyến nào trong khoảng ngày đã chọn.",
        places: [],
      };
    }
    try {
      const result = await runDomesticFleet(flights, {
        chart: await getJson<Chart | null>(ctx, 'notam.vnchart', null),
        fetchOfpText,
        fetchPlaces: async (f) => { const p = await fetchPlacesFor([f]); await enrichWithSup(ctx, p); return p; },
        fetchTrack,
        fetchAllPlaces: async (fs, texts) => { const p = await fetchPlacesFor(fs, '', texts); await enrichWithSup(ctx, p); return p; },
        onProgress: (text) => void (tid && setNotamProgress(ctx, tid, text)),
      });
      if (tid) await setNotamProgress(ctx, tid, "Xong");
      return result;
    } catch (exc) {
      if (tid) await setNotamProgress(ctx, tid, "Lỗi");
      return { ok: false, error: String((exc as Error)?.message ?? exc), places: [] };
    }
  },
};

export const jobs: Jobs = {};
