import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { fbJson } from "../../flitebrief.server";
import * as pin from "../port/notam_pin";
import { normIcao, apply24h, placeFromPayload, parseLookupCodes } from "../port/notam_check";

// Port of the web.py "/api/notam/pins*" and "/api/notam/lookup" endpoints
// (notam_pin.py / notam_check.lookup_places). Pin store persisted under "notam.pins"
// via getJson/setJson, replacing the original per-process JSON file.
const PIN_KEY = "notam.pins";

async function loadPins(ctx: Parameters<Routes[string]>[0]) {
  return getJson<pin.PinStore>(ctx, PIN_KEY, pin.emptyStore());
}

async function fetchPlace(code: string, want: string): Promise<Record<string, unknown>> {
  const icao = normIcao(code);
  if (!icao) {
    return {
      code: String(code || "").toUpperCase(), kind: "", name: "", iata: "", fir: "",
      notam_count: 0, notams: [], error: "Mã không phải ICAO 4 ký tự.", uses: [],
    };
  }
  try {
    const payload = await fbJson<Record<string, unknown>>(`/webapi/icaos/${icao}`);
    return placeFromPayload(icao, payload, want);
  } catch (exc) {
    return {
      code: icao, kind: "", name: "", iata: "", fir: "", notam_count: 0, notams: [],
      error: String((exc as Error)?.message ?? exc), uses: [],
    };
  }
}

async function lookupPlaces(raw: string, kind: string) {
  const want = String(kind || "").trim().toUpperCase() === "FIR" || String(kind || "").trim().toUpperCase() === "F" ? "FIR" : "A";
  const codes = parseLookupCodes(raw);
  if (!codes.length) {
    return {
      ok: false, kind: want, window: "24h", codes: [], places: [],
      error: "Nhập mã ICAO 4 ký tự (VD: VVTS VVNB).",
    };
  }
  const fetched = new Map<string, Record<string, unknown>>();
  await Promise.all(
    codes.map(async (code) => {
      const place = await fetchPlace(code, want);
      fetched.set(String(place.code), place);
    }),
  );
  const places = codes.map((code) => {
    const place = fetched.get(code) ?? {
      code, kind: want, name: "", iata: "", fir: "", notam_count: 0, notams: [],
      error: "Không lấy được.", uses: [],
    };
    return apply24h(place);
  });
  return { ok: true, kind: want, window: "24h", codes, places, error: "" };
}

export const routes: Routes = {
  "GET /api/notam/pins": async (ctx) => pin.snapshot(await loadPins(ctx)),

  "POST /api/notam/pins/cloud": async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await ctx.json();
    } catch {
      return { error: "payload không hợp lệ" };
    }
    const store = await loadPins(ctx);
    try {
      const { store: next, ...rest } = pin.addCloud(store, body ?? {});
      await setJson(ctx, PIN_KEY, next);
      return rest;
    } catch (exc) {
      return { error: String((exc as Error).message ?? exc) };
    }
  },

  "POST /api/notam/pins/flight": async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await ctx.json();
    } catch {
      return { error: "payload không hợp lệ" };
    }
    if (!body || typeof body !== "object") return { error: "payload không hợp lệ" };
    const flights = (body.flights as string | string[] | undefined) ?? (body.callsigns as string | string[] | undefined) ?? "";
    const store = await loadPins(ctx);
    try {
      const { store: next, ...rest } = pin.addFlights(store, body, flights);
      await setJson(ctx, PIN_KEY, next);
      return rest;
    } catch (exc) {
      return { error: String((exc as Error).message ?? exc) };
    }
  },

  "POST /api/notam/pins/clear": async (ctx) => {
    const { store } = pin.clear();
    await setJson(ctx, PIN_KEY, store);
    return { ok: true };
  },

  "POST /api/notam/pins/remove": async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await ctx.json();
    } catch {
      return { error: "payload không hợp lệ" };
    }
    if (!body || typeof body !== "object") return { error: "payload không hợp lệ" };
    const store = await loadPins(ctx);
    try {
      const { store: next } = pin.removeOne(store, {
        scope: String(body.scope ?? ""),
        ident: String(body.ident ?? ""),
        code: String(body.code ?? ""),
        kind: String(body.kind ?? ""),
        flight: String(body.flight ?? ""),
      });
      await setJson(ctx, PIN_KEY, next);
      return pin.snapshot(next);
    } catch (exc) {
      return { error: String((exc as Error).message ?? exc) };
    }
  },

  "GET /api/notam/lookup": async (ctx) => {
    const codes = ctx.params.get("codes") ?? "";
    const kind = ctx.params.get("kind") ?? "A";
    try {
      const result = await lookupPlaces(codes, kind);
      if (result.error && !(result.places || []).length) {
        return new Response(JSON.stringify(result), { status: 400, headers: { "content-type": "application/json" } });
      }
      return result;
    } catch (exc) {
      return new Response(JSON.stringify({ error: String((exc as Error).message ?? exc) }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};

export const jobs: Jobs = {};
