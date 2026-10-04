import type { Jobs, Routes } from "../types";
import { q } from "../types";
import type { Flight } from "../core/models";
import { loadFlights } from "../core/gantts.server";
import { fbJson } from "../../flitebrief.server";
import { normIcao, placeFromPayload } from "../port/notam_check";
import { run, runDomesticFleet, flightAirfields, type Place, type Track } from "../port/notam_track";
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
const KML_NOT_PORTED =
  "Chưa chuyển được phần lấy track KML từ JetPlan (jetplan_kml.py) sang bản web — chỉ đối chiếu NOTAM sân/FIR, chưa vẽ được track trên bản đồ.";

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
async function fetchPlacesFor(flights: Flight[]): Promise<Place[]> {
  const wantByCode = new Map<string, string>();
  for (const flight of flights) {
    for (const [code] of flightAirfields(flight)) wantByCode.set(code, "A");
  }
  const places = await Promise.all([...wantByCode.entries()].map(([code, want]) => fetchPlace(code, want)));
  const firCodes = new Set<string>();
  for (const place of places) {
    const fir = String((place as Record<string, unknown>).fir ?? "");
    if (fir) firCodes.add(fir);
  }
  const firPlaces = await Promise.all([...firCodes].map((code) => fetchPlace(code, "FIR")));
  return [...places, ...firPlaces];
}

async function fetchTrack(): Promise<{ track: Track; error: string }> {
  return { track: { plan: "", via: "", points: [], line: [] }, error: KML_NOT_PORTED };
}

async function findFlight(id: number): Promise<Flight | null> {
  if (!id) return null;
  const flights = await loadFlights(14);
  return flights.find((f) => f.id === id) ?? null;
}

export const routes: Routes = {
  // web.py _api_notam_track(fid): đối chiếu NOTAM 24H với track của một chuyến.
  "GET /api/notam/track": async (ctx) => {
    const fid = parseInt(q(ctx.params, "fid"), 10);
    const tid = q(ctx.params, "tid");
    if (!fid || Number.isNaN(fid)) return { error: "thiếu fid (mã chuyến)." };
    const flight = await findFlight(fid);
    if (!flight) return { error: `Không tìm thấy chuyến fid=${fid}.` };
    try {
      const result = await run(flight, {
        fetchPlaces: (f) => fetchPlacesFor([f]),
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
    const flights = await loadFlights(days);
    if (!flights.length) return { ok: false, error: "Không có chuyến nào trong khoảng ngày đã chọn.", places: [] };
    try {
      const result = await runDomesticFleet(flights, {
        fetchPlaces: (f) => fetchPlacesFor([f]),
        fetchTrack,
        fetchAllPlaces: fetchPlacesFor,
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
