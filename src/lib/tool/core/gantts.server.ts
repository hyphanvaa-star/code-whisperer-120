// Port of api/gantts.py + web.py load_flights (cache). Workers don't share RAM,
// so the in-memory cache is per isolate (5 min TTL like web.py _CACHE_TTL).
import { Flight, type Raw } from "./models";

export const CACHE_TTL = 300;
const STALE_MAX = 1800;
const cache = new Map<number, { at: number; flights: Flight[] }>();
const inflight = new Map<number, Promise<Flight[]>>();
export const FETCHED_AT = new Map<number, number>();

export async function fetchGanttsRaw(days: number): Promise<Raw[]> {
  const { fbJson } = await import("@/lib/flitebrief.server");
  let data = await fbJson<unknown>(`/webapi/gantts?days=${days}`);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Raw;
    const k = ["sectors", "flights", "data", "results"].find((k) => Array.isArray(d[k]));
    if (!k) throw new Error(`Không tìm thấy list flight trong response: keys=${Object.keys(d).slice(0, 10)}`);
    data = d[k];
  }
  if (!Array.isArray(data)) throw new Error("gantts trả về kiểu không mong đợi");
  return data as Raw[];
}

export function sortFlights(flights: Flight[]) {
  return flights.sort((a, b) => {
    if (!a.std !== !b.std) return a.std ? -1 : 1;
    const t = (a.std?.getTime() ?? 0) - (b.std?.getTime() ?? 0);
    return t || a.callsign.localeCompare(b.callsign);
  });
}

async function doFetch(days: number) {
  const raw = await fetchGanttsRaw(days);
  const flights = sortFlights(raw.filter((x) => x && typeof x === "object").map((x) => Flight.fromApi(x)));
  cache.set(days, { at: Date.now(), flights });
  FETCHED_AT.set(days, Date.now() / 1000);
  return flights;
}

async function loadFlightCatalogue(days: number, refresh = false): Promise<Flight[]> {
  const hit = cache.get(days);
  const age = hit ? (Date.now() - hit.at) / 1000 : Infinity;
  if (!refresh && hit && age < CACHE_TTL) return hit.flights;
  if (!refresh && hit && age < STALE_MAX) {
    if (!inflight.has(days)) {
      const p = doFetch(days).finally(() => inflight.delete(days));
      inflight.set(days, p);
      p.catch(() => {});
    }
    return hit.flights;
  }
  const running = inflight.get(days);
  if (running && !refresh) return running;
  const p = doFetch(days).finally(() => inflight.delete(days));
  inflight.set(days, p);
  return p;
}

/** Recheck the clock on every read, including cached catalogues. */
export async function loadFlights(days: number, refresh = false): Promise<Flight[]> {
  return filterByWindow(await loadFlightCatalogue(days, refresh), 6, 24);
}

/** Catalogue span for one-sector lookups; the −6/+24 clip still decides what is visible. */
export const OPS_LOOKUP_DAYS = 3;

/** One in-window sector by FliteBrief ID. Every caller shares one catalogue size (one cache),
 *  and a miss forces one fresh read so a stale cache cannot report a live flight as absent. */
export async function findOperationalFlightById(id: number): Promise<Flight | null> {
  if (!id) return null;
  const hit = (await loadFlights(OPS_LOOKUP_DAYS)).find((f) => f.id === id);
  if (hit) return hit;
  return (await loadFlights(OPS_LOOKUP_DAYS, true)).find((f) => f.id === id) ?? null;
}

export function filterByWindow(flights: Flight[], hoursBack: number | null, hoursAhead: number | null, ref = new Date()) {
  if (hoursBack == null && hoursAhead == null) return flights;
  const lo = hoursBack != null ? ref.getTime() - hoursBack * 3600e3 : null;
  const hi = hoursAhead != null ? ref.getTime() + hoursAhead * 3600e3 : null;
  return flights.filter((f) => {
    if (!f.std) return false;
    const t = f.std.getTime();
    if (lo != null && t < lo) return false;
    if (hi != null && t > hi) return false;
    return true;
  });
}

const norm = (n: string) => n.split(/\s+/).filter(Boolean).join(" ").toUpperCase();

export function filterByDispatcher(flights: Flight[], dispatcher: string) {
  const needle = norm(dispatcher);
  if (!needle) return flights;
  const exact = flights.filter((f) => norm(f.dispatcher) === needle);
  return exact.length ? exact : flights.filter((f) => norm(f.dispatcher).includes(needle));
}

export function listDispatchers(flights: Flight[]) {
  const stats = new Map<string, { name: string; flights: number; attachments: number }>();
  for (const f of flights) {
    const name = f.dispatcher.split(/\s+/).filter(Boolean).join(" ") || "(chưa gán)";
    const e = stats.get(name) ?? { name, flights: 0, attachments: 0 };
    e.flights += 1;
    e.attachments += f.attachment_count;
    stats.set(name, e);
  }
  return [...stats.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** web.py apply_filters. */
export function applyFilters(flights: Flight[], params: URLSearchParams, skipDispatcher = false) {
  const one = (k: string) => (params.get(k) ?? "").trim();
  const hours = (k: string) => {
    const r = one(k);
    if (!r) return null;
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  };
  const dispatcher = one("dispatcher");
  const callsign = one("callsign").toUpperCase();
  const dep = one("dep").toUpperCase(), dest = one("dest").toUpperCase(), reg = one("reg").toUpperCase();
  const back = hours("back"), ahead = hours("ahead");
  if (back != null || ahead != null) flights = filterByWindow(flights, back, ahead);
  if (dispatcher && !skipDispatcher) flights = filterByDispatcher(flights, dispatcher);
  if (callsign) flights = flights.filter((f) => f.callsign.toUpperCase().includes(callsign));
  if (dep) flights = flights.filter((f) => f.dep_icao.toUpperCase().startsWith(dep));
  if (dest) flights = flights.filter((f) => f.dest_icao.toUpperCase().startsWith(dest));
  if (reg) flights = flights.filter((f) => f.reg.toUpperCase().includes(reg));
  return flights;
}
