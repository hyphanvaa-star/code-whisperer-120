import type { Jobs, Routes } from "../types";
import { loadFlights, filterByWindow, filterByDispatcher } from "../core/gantts.server";
import { tunePlaces, tunePlacesDomestic, domesticAirports } from "../port/notam_check_tune";

// Port of web.py's "/api/notam/tune" (_api_notam_tune): client-side re-filter of
// an already-fetched NOTAM place list, either "domestic" mode (DSP fleet window,
// notam_check.tune_places_domestic) or "track" mode (one flight by sector id,
// notam_check.tune_places). The OFP text load (notam_check.load_ofp_text, a
// FliteBrief/Outlook scrape) and the JetPlan KML track fetch are not ported
// elsewhere in this codebase either, so both run here with ofp_text = "" /
// client-supplied track points only — same honest degrade as notam_track.server.ts.
const BOARD_BACK_H = 2;
const BOARD_AHEAD_H = 6;

export const routes: Routes = {
  "POST /api/notam/tune": async (ctx) => {
    const body = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = String(body.mode ?? "track").trim().toLowerCase();
    const places = (Array.isArray(body.places) ? body.places : []) as Record<string, unknown>[];
    if (!places.length) {
      return { error: "Chưa có NOTAM để lọc. Bấm Check NOTAM hoặc tracking trước." };
    }
    const days = Number.isFinite(Number(body.days)) && Number(body.days) ? Math.trunc(Number(body.days)) : 2;
    const back = Number.isFinite(Number(body.back)) && body.back ? Number(body.back) : BOARD_BACK_H;
    const ahead = Number.isFinite(Number(body.ahead)) && body.ahead ? Number(body.ahead) : BOARD_AHEAD_H;

    if (mode === "domestic") {
      const dsp = String(body.dsp ?? "").trim();
      if (!dsp) return { error: "Chọn DSP rồi bấm Lọc notam quốc nội." };
      const flights = filterByWindow(filterByDispatcher(await loadFlights(days), dsp), back, ahead);
      if (!flights.length) {
        return { error: `Không có chuyến của ${dsp} trong −${back.toFixed(0)}h…+${ahead.toFixed(0)}h.` };
      }
      // load_ofp_text (FliteBrief/Outlook OFP scrape) is not ported; texts degrade to "".
      const texts: Record<number, string> = {};
      for (const flight of flights) texts[flight.id] = "";
      if (!domesticAirports(flights, texts).size) {
        return { error: `${dsp} không có chuyến quốc nội (DEP và DEST cùng tiền tố ICAO) trong cửa sổ.` };
      }
      try {
        return tunePlacesDomestic(flights, places, { ofpTexts: texts, dsp });
      } catch (exc) {
        return { error: String((exc as Error)?.message ?? exc) };
      }
    }

    const sectorId = Number.isFinite(Number(body.id)) ? Math.trunc(Number(body.id)) : 0;
    if (!sectorId) return { error: "Chọn chuyến rồi bấm Lọc notam tracking chuyến." };
    const flight = (await loadFlights(days)).find((f) => f.id === sectorId);
    if (!flight) return { error: `Không tìm thấy chuyến ${sectorId}.` };
    const ofpText = ""; // load_ofp_text not ported; see note above.

    const points: Array<{ lat: number; lon: number; fl_ft: number; ete_min: number; name: string }> = [];
    for (const raw of Array.isArray(body.track) ? body.track : []) {
      if (!raw || typeof raw !== "object") continue;
      const pt = raw as Record<string, unknown>;
      const lat = Number(pt.lat), lon = Number(pt.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push({
        lat, lon,
        fl_ft: Number.isFinite(Number(pt.fl_ft)) ? Math.trunc(Number(pt.fl_ft)) : 0,
        ete_min: Number.isFinite(Number(pt.ete_min)) ? Math.trunc(Number(pt.ete_min)) : 0,
        name: String(pt.name ?? ""),
      });
    }
    // jetplan_kml fallback (points empty -> fetch track) is not ported here either;
    // the client supplies track points directly (same as web.py's body["track"]).

    try {
      return tunePlaces(flight, places, { ofpText, trackPoints: points });
    } catch (exc) {
      return { error: String((exc as Error)?.message ?? exc) };
    }
  },
};

export const jobs: Jobs = {};
