import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { fbJson } from "../../flitebrief.server";
import * as pin from "../port/notam_pin";
import { normIcao, apply24h, placeFromPayload, parseLookupCodes } from "../port/notam_check";
import * as vn from "../port/aip_vn_chart";
import atsRoutes from "../data/ats_routes.json";

// ATS route các nước (snapshot aip_ats/routes.json của tool cũ) gộp vào nền bản đồ.
function withForeignAts(c: vn.Chart): vn.Chart {
  const extra: vn.ChartRoute[] = [];
  for (const [cc, list] of Object.entries(atsRoutes as Record<string, { name: string; pts: vn.ChartPt[] }[]>))
    for (const r of list) extra.push({ name: r.name, pts: r.pts, cc });
  return { ...c, routes: [...(c.routes || []).filter((r) => !r.cc || r.cc === "VN"), ...extra] };
}

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


// --- /api/notam/vnchart (aip_vn_chart.py): bản đồ Việt Nam từ AIP VATM đang
// hiệu lực. Cache dưới key "notam.vnchart" (thay cho data/aip_vn/chart.json).
const VNCHART_KEY = "notam.vnchart";
const VNCHART_ROOT = "https://aim.vatm.vn/images/stories/vnaic.vn/SanPhamDichVu/AIPVietNam/AIP/";
const VNCHART_HISTORY_URL = VNCHART_ROOT + "history-en-GB.html";
const VNCHART_UA = { "User-Agent": "Mozilla/5.0 DispatchBoard-AIP/1.0" };

function vnChartPage(cycle: string, name: string): string {
  return `${VNCHART_ROOT}${cycle}/html/eAIP/${name}`;
}

async function vnChartHttp(url: string, timeoutMs = 60000): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { headers: VNCHART_UA, signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return "";
    return await resp.text();
  } catch {
    return "";
  }
}

async function vnChartBuild(cycle: string, effective: string): Promise<vn.Chart> {
  const chart = vn.empty(cycle, effective);
  const [enr31, enr33, enr41, enr44, ad13] = await Promise.all([
    vnChartHttp(vnChartPage(cycle, "VV-ENR-3.1-en-GB.html")),
    vnChartHttp(vnChartPage(cycle, "VV-ENR-3.3-en-GB.html")),
    vnChartHttp(vnChartPage(cycle, "VV-ENR-4.1-en-GB.html")),
    vnChartHttp(vnChartPage(cycle, "VV-ENR-4.4-en-GB.html")),
    vnChartHttp(vnChartPage(cycle, "VV-AD-1.3-en-GB.html")),
  ]);
  chart.routes = [...vn.parseRoutes(enr31), ...vn.parseRoutes(enr33)];
  chart.waypoints = vn.parseWaypoints(enr44);
  chart.navaids = vn.parseNavaids(enr41);
  const index = vn.parseAirports(ad13);
  const airports: vn.ChartAirport[] = [];
  await Promise.all(
    index.map(async (row) => {
      const html = await vnChartHttp(vnChartPage(cycle, `VV-AD-2.${row.icao}-en-GB.html`));
      const pt = html ? vn.parseArp(html) : null;
      if (pt) airports.push({ icao: row.icao, name: row.name, lat: pt[0], lon: pt[1] });
    }),
  );
  chart.airports = airports;
  return chart;
}

async function vnChartEnsure(ctx: Parameters<Routes[string]>[0]): Promise<vn.Chart> {
  const have = await getJson<vn.Chart | null>(ctx, VNCHART_KEY, null);
  const hist = await vnChartHttp(VNCHART_HISTORY_URL);
  const [cycle, effective] = hist ? vn.currentIssue(hist) : ["", ""];
  if (have && (!cycle || have.cycle === cycle)) return have;
  if (!cycle) return have ?? vn.empty();
  const built = await vnChartBuild(cycle, effective);
  if (built.routes.length || built.airports.length) {
    await setJson(ctx, VNCHART_KEY, built);
    return built;
  }
  return have ?? vn.empty();
}

// --- /api/notam/track/progress (web.py _get_notam_progress): tiến độ của một
// lượt "tid" (Check NOTAM / Check NOTAM tracking), lưu trong store thay vì
// biến trong tiến trình (khi job chạy thì handler atc/notam ghi vào đây).
const NOTAM_PROGRESS_KEY = "notam.progress";
const NOTAM_PROGRESS_TTL_S = 900;

type NotamProgressStore = Record<string, [number, string]>;

export async function getNotamProgress(ctx: Parameters<Routes[string]>[0], tid: string): Promise<string> {
  const stamp = String(tid || "").trim();
  if (!stamp) return "";
  const store = await getJson<NotamProgressStore>(ctx, NOTAM_PROGRESS_KEY, {});
  const hit = store[stamp];
  return hit ? hit[1] : "";
}

export async function setNotamProgress(ctx: Parameters<Routes[string]>[0], tid: string, text: string): Promise<void> {
  const stamp = String(tid || "").trim();
  if (!stamp || !/^[A-Za-z0-9_-]{1,40}$/.test(stamp)) return;
  const store = await getJson<NotamProgressStore>(ctx, NOTAM_PROGRESS_KEY, {});
  const now = Date.now() / 1000;
  store[stamp] = [now, String(text || "")];
  for (const key of Object.keys(store)) {
    const entry = store[key];
    if (entry && now - entry[0] > NOTAM_PROGRESS_TTL_S) delete store[key];
  }
  await setJson(ctx, NOTAM_PROGRESS_KEY, store);
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
  "GET /api/notam/vnchart": async (ctx) => {
    const data = await getJson<vn.Chart | null>(ctx, VNCHART_KEY, null);
    if (data && (data.airports.length || data.routes.length)) return withForeignAts(data);
    // web.py: tải nền trong luồng riêng rồi trả "pending" ngay — worker này
    // không có luồng nền nên tải luôn (không chờ lâu lần sau vì đã cache).
    try {
      const built = await vnChartEnsure(ctx);
      if (built.airports.length || built.routes.length) return withForeignAts(built);
    } catch {
      // bỏ qua, trả pending như dưới
    }
    return { ...vn.empty(), pending: true };
  },

  "GET /api/notam/track/progress": async (ctx) => {
    const tid = ctx.params.get("tid") ?? "";
    return { text: await getNotamProgress(ctx, tid) };
  },
};

export const jobs: Jobs = {};
