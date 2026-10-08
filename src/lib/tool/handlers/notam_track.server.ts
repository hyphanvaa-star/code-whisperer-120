import type { Jobs, Routes } from "../types";
import { q } from "../types";
import type { Flight } from "../core/models";
import { loadFlights, applyFilters } from "../core/gantts.server";
import { fbJson } from "../../flitebrief.server";
import { normIcao, placeFromPayload } from "../port/notam_check";
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
import { supKeys, type Geom } from "../port/notam_track";
import { bindCtx, rings_of, hours_of, dah_ring, dah_named, japanTrainingRings, japanIdsInText } from "../aip_sup.server";
import { expand_au_area_ids } from '../port/aip_sup';
import AIP_CATALOG from '../port/aip_catalog.json';
import type { Ctx } from "../types";

const AU_DAH_ID = /\bY[A-Z]{3}\/([MRDP]\d{3,4}[A-Z]?)(?![0-9])/gi;
const AU_CTA_ID = /\bY[A-Z]{3}(?:-Y[A-Z]{3})?\/([A-Z][A-Z0-9'./\-]*(?:\s+[A-Z][A-Z0-9'./\-]*){0,6}\s+CTA\s+[A-Z]\d{1,2})\b/gi;

/** notam_check.py sup_hours_schedule + AIP SUP/DAH rings — bounded so Check NOTAM never hangs. */
async function enrichWithSup(ctx: Ctx, places: Place[]): Promise<void> {
  bindCtx(ctx);
  const deadline = Date.now() + 20000;
  const tasks: (() => Promise<void>)[] = [];
  let japanCatalog: ReturnType<typeof japanTrainingRings> | undefined;
  let japanWarnings: ReturnType<typeof japanTrainingRings> | undefined;
  for (const place of places) {
    const notams = ((place as Record<string, unknown>).notams as Record<string, unknown>[]) || [];
    for (const n of notams) {
      const blob = `${String(n.e_field ?? "")} ${String(n.text ?? "")}`;
      const fir = String(n.qfir ?? (place as Record<string, unknown>).fir ?? place.code ?? "");
      const keys = supKeys(blob);
      const au = fir.toUpperCase().startsWith("Y");
      const jp = /^(RJ|RO)/i.test(fir) && /\bAIP\b|CIVIL TRAINING|TRAINING AND TESTING AREA/i.test(blob);
      if (!keys.length && !au && !jp) continue;
      const task = async () => {
        const geoms: Geom[] = [];
        if (jp && /ENR\s*5\.3|CIVIL TRAINING|TRAINING AND TESTING AREA/i.test(blob)) {
          japanCatalog ??= japanTrainingRings(ctx);
          const table = await japanCatalog;
          for (const name of japanIdsInText(table, blob)) {
            const ring = table[name];
            if (ring && ring.length >= 3) geoms.push({ name, shape: 'polygon', ring, source: 'aip' });
          }
        }
        if (jp && /ENR\s*5\.1|WARNING AREA/i.test(blob)) {
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
          const table = saved ? Object.fromEntries(Object.entries(saved).map(([nr, [name, ring]]) => [nr, { name, ring }])) : await rings_of(key, fir, ctx);
          const wanted = new Set([...blob.matchAll(/\bNR\.?\s*(\d+)\b|\bAREA\s*:?\s*\(\s*(\d+)\s*\)/gi)].map(m => `NR.${Number(m[1] || m[2])}`));
          for (const [nr, item] of Object.entries(table)) {
            if (wanted.size && !wanted.has(nr)) continue;
            if (item.ring.length >= 3) geoms.push({ name: item.name || nr, shape: "polygon", ring: item.ring, source: 'aip' });
          }
          if (!String(n.d_field ?? "").trim()) {
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
        }
        if (geoms.length) n.sup_geoms = geoms;
      };
      // ENR catalog work must not be starved by dozens of unrelated SUP downloads.
      if (jp && /ENR\s*5\.[13]/i.test(blob)) tasks.unshift(task);
      else tasks.push(task);
    }
  }
  let i = 0;
  const worker = async () => { while (i < tasks.length && Date.now() < deadline) { const t = tasks[i++]!; try { await t(); } catch { /* degrade */ } } };
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
    return placeFromPayload(icao, payload, want) as Place;
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
    return blob ? await ofpPdfText(blob) : "";
  } catch { return ""; }
}

async function fetchPlacesFor(flights: Flight[], ofpText = ""): Promise<Place[]> {
  const wantByCode = new Map<string, string>();
  const firCodes = new Set<string>();
  for (const flight of flights) {
    const fields = ofpText ? tuneAirfields(flight, ofpText) : flightAirfields(flight);
    for (const [code] of fields) wantByCode.set(code, "A");
    if (ofpText) {
      for (const f of locationsOf(flight, ofpText).firs || []) { const c = normIcao(f); if (c) firCodes.add(c); }
    }
  }
  const places = await Promise.all([...wantByCode.entries()].map(([code, want]) => fetchPlace(code, want)));
  for (const place of places) {
    const fir = String((place as Record<string, unknown>).fir ?? "");
    if (fir) firCodes.add(fir);
  }
  const firPlaces = await Promise.all([...firCodes].map((code) => fetchPlace(code, "FIR")));
  return [...places, ...firPlaces];
}

async function fetchTrack(flight: Flight): Promise<{ track: Track; error: string }> {
  try {
    const t = await trackFor(flight);
    return { track: t as unknown as Track, error: "" };
  } catch (exc) {
    return {
      track: { plan: "", via: "", points: [], line: [] },
      error: String((exc as Error)?.message ?? exc),
    };
  }
}

async function findFlight(id: number): Promise<Flight | null> {
  if (!id) return null;
  const flights = await loadFlights(14);
  return flights.find((f) => f.id === id) ?? null;
}

export const routes: Routes = {
  // web.py _api_notam_track(fid): đối chiếu NOTAM 24H với track của một chuyến.
  "GET /api/notam/track": async (ctx) => {
    const fid = parseInt(q(ctx.params, "fid") || q(ctx.params, "id"), 10);
    const tid = q(ctx.params, "tid");
    if (!fid || Number.isNaN(fid)) return { error: "thiếu fid (mã chuyến)." };
    const flight = await findFlight(fid);
    if (!flight) return { error: `Không tìm thấy chuyến fid=${fid}.` };
    try {
      const result = await run(flight, {
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
    const days = Math.max(1, Math.min(14, parseInt(daysRaw, 10) || 1));
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
        fetchPlaces: async (f) => { const p = await fetchPlacesFor([f]); await enrichWithSup(ctx, p); return p; },
        fetchTrack,
        fetchAllPlaces: async (fs) => { const p = await fetchPlacesFor(fs); await enrichWithSup(ctx, p); return p; },
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
