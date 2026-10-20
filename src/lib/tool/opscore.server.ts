// Port of api/opscore.py — real OpsCore login + schedule, cached in app_settings
// ("opscore.snapshot") because workers share no memory.
import type { Flight } from "./core/models";
import { getJson, setJson } from "./store.server";
import { env } from "./creds.server";

type Ctx = Parameters<typeof getJson>[0];
export type Track = {
  ident: string; reg: string; origin: string; dest: string;
  actual_out: number | null; actual_off: number | null; actual_on: number | null; actual_in: number | null;
  sched_off: number | null; status: string;
};

const BASE = "https://vjc.flighttracking.opscore.collins.com";
const TENANT = "vjc";
const TTL_S = 30;
const PAGE_SIZE = 25, MAX_PAGES = 48, START_MIN = -24 * 60, END_MIN = 18 * 60;
const MAX_STD_SKEW_S = 8 * 3600, EARLY_OFF_S = 2 * 3600;
const LABELS: Record<string, string> = {
  ground: "On Ground", taxi: "Taxi", takeoff: "Take Off", airborne: "Airborne",
  landed: "Landed", in: "In", completed: "Completed", unknown: "—",
};
const TAKEOFF_GRACE_S = 12 * 60, IN_DONE_S = 5 * 60;

export const identOf = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const unixOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n ? n : null;
};
const isoOf = (ts: number | null) => (ts ? new Date(ts * 1000).toISOString() : null);

function trackFromApi(r: Record<string, unknown>): Track | null {
  const ident = identOf(r["flightIdentifier"]);
  if (!ident) return null;
  return {
    ident, reg: identOf(r["registration"]),
    origin: String(r["origin"] ?? "").trim().toUpperCase(),
    dest: String(r["destination"] ?? "").trim().toUpperCase(),
    actual_out: unixOf(r["actualOut"]), actual_off: unixOf(r["actualOff"]),
    actual_on: unixOf(r["actualOn"]), actual_in: unixOf(r["actualIn"]),
    sched_off: unixOf(r["scheduledDepartureTime"] || r["scheduledOut"]),
    status: String(r["status"] ?? "").trim(),
  };
}

const H = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json", Accept: "application/json", "X-Tenant": TENANT,
  "User-Agent": "Mozilla/5.0", ...extra,
});

export async function login(): Promise<string> {
  const user = env("OPSCORE_USER") || env("OPSCORE_USERNAME") || "";
  const pass = env("OPSCORE_PASS") || env("OPSCORE_PASSWORD") || "";
  if (!user || !pass) throw new Error("Thiếu tài khoản OpsCore");
  const r = await fetch(`${BASE}/api/auth/credentials?format=json`, {
    method: "POST", headers: H(), body: JSON.stringify({ userName: user, password: pass }),
  });
  if (r.status >= 400) throw new Error(`OpsCore login HTTP ${r.status}`);
  const token = String(((await r.json()) as Record<string, unknown>)["bearerToken"] ?? "");
  if (!token) throw new Error("OpsCore login không trả bearerToken");
  return token;
}

export async function fetchSchedule(): Promise<Track[]> {
  const token = await login();
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(`${BASE}/api/flightinformation/schedule`, {
      method: "POST", headers: H({ Authorization: `Bearer ${token}` }),
      body: JSON.stringify({ sortField: "departureTime", sortOrder: "asc", page, pageSize: PAGE_SIZE, startMinutes: START_MIN, endMinutes: END_MIN, filters: {} }),
    });
    if (r.status >= 400) throw new Error(`OpsCore schedule HTTP ${r.status}`);
    const d = (await r.json()) as Record<string, unknown> | unknown[];
    const chunk = Array.isArray(d) ? d : (d["data"] as unknown[]);
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...(chunk.filter((x) => x && typeof x === "object") as Record<string, unknown>[]));
    const total = Array.isArray(d) ? null : d["totalRecords"];
    if (total != null && rows.length >= Number(total)) break;
  }
  return rows.map(trackFromApi).filter((t): t is Track => !!t);
}

let MEM: { at: number; tracks: Track[] } | null = null;

/** Snapshot with 30s TTL shared through app_settings. Errors never break the board. */
export async function getSnapshot(ctx: Ctx, force = false): Promise<Track[] | null> {
  const now = Date.now() / 1000;
  if (!force && MEM && now - MEM.at < TTL_S) return MEM.tracks;
  const stored = await getJson<{ at: number; tracks: Track[] } | null>(ctx, "opscore.snapshot", null).catch(() => null);
  if (!force && stored && now - stored.at < TTL_S) return (MEM = stored).tracks;
  try {
    const tracks = await fetchSchedule();
    MEM = { at: now, tracks };
    await setJson(ctx, "opscore.snapshot", MEM).catch(() => {});
    return tracks;
  } catch (e) {
    console.warn("OpsCore schedule lỗi:", e instanceof Error ? e.message : e);
    return stored?.tracks ?? MEM?.tracks ?? null;
  }
}

const trackTs = (t: Track) => t.sched_off || t.actual_out || t.actual_off || t.actual_on || t.actual_in;
const vnDate = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function sameDay(f: Flight, t: Track) {
  const ts = trackTs(t);
  if (!f.std || !ts) return true;
  const s = f.std.getTime(), w = ts * 1000;
  const want = new Set([utcDate(s), vnDate(s)]);
  return [utcDate(w), vnDate(w)].some((d) => want.has(d));
}
function plausible(f: Flight, t: Track, nowS: number) {
  if (!f.std) return true;
  const std = f.std.getTime() / 1000;
  for (const ts of [t.actual_out, t.actual_off, t.actual_on, t.actual_in]) if (ts && std - ts > EARLY_OFF_S) return false;
  if (t.sched_off != null && Math.abs(t.sched_off - std) > MAX_STD_SKEW_S) return false;
  if (!t.actual_off && t.status.toUpperCase() === "A" && std - nowS > EARLY_OFF_S) return false;
  return true;
}

export function matchTrack(f: Flight, tracks: Track[], now = new Date()): Track | null {
  const raw = f as unknown as Record<string, unknown>;
  const ident = identOf(f.callsign || raw["fltno"]);
  const deps = new Set([f.dep_icao, f.dep_iata].filter(Boolean).map(identOf));
  const dests = new Set([f.dest_icao, f.dest_iata].filter(Boolean).map(identOf));
  let cand = tracks.filter((t) => t.ident === ident);
  if (!cand.length && f.reg) { const reg = identOf(f.reg); cand = tracks.filter((t) => t.reg === reg); }
  if (deps.size) cand = cand.filter((t) => !t.origin || deps.has(identOf(t.origin)));
  if (dests.size) cand = cand.filter((t) => !t.dest || dests.has(identOf(t.dest)));
  const nowS = now.getTime() / 1000;
  cand = cand.filter((t) => sameDay(f, t) && plausible(f, t, nowS));
  if (!cand.length) return null;
  if (f.std && cand.length > 1) {
    const std = f.std.getTime() / 1000;
    cand.sort((a, b) => Math.abs((trackTs(a) || 0) - std) - Math.abs((trackTs(b) || 0) - std));
  }
  return cand[0] ?? null;
}

export function hasOooi(t: Track | null) {
  if (!t) return false;
  if (t.actual_out || t.actual_off || t.actual_on || t.actual_in) return true;
  return ["A", "Z"].includes(t.status.toUpperCase());
}

export function phaseOf(t: Track, now = new Date()) {
  const c = now.getTime() / 1000;
  if (t.actual_in) return c - t.actual_in >= IN_DONE_S ? "completed" : "in";
  if (t.actual_on) return "landed";
  if (t.actual_off) { const age = c - t.actual_off; return age >= 0 && age < TAKEOFF_GRACE_S ? "takeoff" : "airborne"; }
  if (t.actual_out) return "taxi";
  const code = t.status.toUpperCase();
  return code === "A" ? "airborne" : code === "Z" ? "landed" : "ground";
}

export function overlayOf(t: Track, now = new Date()) {
  const phase = phaseOf(t, now);
  return {
    ops_phase: phase, ops_label: LABELS[phase] ?? "—", ops_inferred: false,
    off_blocks: isoOf(t.actual_out), off_ground: isoOf(t.actual_off),
    on_ground: isoOf(t.actual_on), in_blocks: isoOf(t.actual_in),
  };
}
