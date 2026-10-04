import type { Jobs, Routes } from "../types";
import type { Flight } from "../core/models";
import { applyFilters, listDispatchers, loadFlights } from "../core/gantts.server";
import { attchCheck, attchContext, type AttchCtx, type AttchResult } from "../port/attch";
import { checkFlightLimits, needsOfpLimitCheck, type LimitsData } from "../port/limits_check";
import { ofpAckNeeded } from "../port/verify";
import { adviceForFlight } from "../port/taf";
import { getJson } from "../store.server";

const EMPTY_LIMITS: LimitsData = { aircraft: [], airports: [], curfew: [], special: [] };

// ---------------- api/opscore.py (login-free part: FliteBrief OOOI fallback) ----------------
const PHASE_LABELS: Record<string, string> = {
  ground: "On Ground", taxi: "Taxi", takeoff: "Take Off", airborne: "Airborne",
  landed: "Landed", in: "In", completed: "Completed", unknown: "—",
};
const TAKEOFF_GRACE_S = 12 * 60;
const IN_DONE_S = 5 * 60;

function unixOf(d: Date | null): number | null {
  return d ? Math.trunc(d.getTime() / 1000) || null : null;
}
function isoOfUnix(ts: number | null): string | null {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function opscoreLookup(f: Flight, now = new Date()) {
  const actualOut = unixOf(f.off_blocks), actualOff = unixOf(f.off_ground);
  const actualOn = unixOf(f.on_ground), actualIn = unixOf(f.in_blocks);
  if (!actualOut && !actualOff && !actualOn && !actualIn) {
    return { ops_phase: "ground", ops_label: PHASE_LABELS["ground"], ops_inferred: false, off_blocks: null, off_ground: null, on_ground: null, in_blocks: null };
  }
  const clockS = now.getTime() / 1000;
  let phase: string;
  if (actualIn) phase = clockS - actualIn >= IN_DONE_S ? "completed" : "in";
  else if (actualOn) phase = "landed";
  else if (actualOff) {
    const age = clockS - actualOff;
    phase = age >= 0 && age < TAKEOFF_GRACE_S ? "takeoff" : "airborne";
  } else phase = "taxi";
  return {
    ops_phase: phase,
    ops_label: PHASE_LABELS[phase] ?? "—",
    ops_inferred: true,
    off_blocks: isoOfUnix(actualOut),
    off_ground: isoOfUnix(actualOff),
    on_ground: isoOfUnix(actualOn),
    in_blocks: isoOfUnix(actualIn),
  };
}

// ---------------- api/atfm.py: no VATM poller here -> always "no CTOT" ----------------
function atfmLookup(_f: Flight): { ctot: string | null } {
  return { ctot: null };
}

// ---------------- web.py dest_alts_for_row ----------------
function destAltsForRow(f: Flight): string[] {
  const bits = [f.dest_alt1, f.dest_alt2, String((f.raw || {})["dest_alt3"] ?? "")];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of bits) {
    const code = String(item || "").trim().toUpperCase();
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

// ofp_warns_of (web.py): we never cache a read-OFP acknowledgement across
// requests in a Worker, so this is always a fresh compute like a cache miss.
function ofpWarnsOf(_f: Flight, _revision: string): null {
  return null;
}

/** Port of web.py `row()`. */
export function row(f: Flight, limits: LimitsData | null = EMPTY_LIMITS, attch: AttchResult | null = null, revision = "0") {
  const lim = limits ?? EMPTY_LIMITS;
  const warns = ofpWarnsOf(f, revision) ?? checkFlightLimits(f, lim);
  const ops = opscoreLookup(f);
  const ctot = atfmLookup(f);
  return {
    id: f.id,
    callsign: f.callsign,
    route: f.route,
    dep: f.dep_icao,
    dest: f.dest_icao,
    dep_iata: f.dep_iata || "",
    dest_iata: f.dest_iata || "",
    std: f.std ? f.std.toISOString() : null,
    sta: f.sta ? f.sta.toISOString() : null,
    ops_phase: ops.ops_phase,
    ops_label: ops.ops_label,
    ops_inferred: !!ops.ops_inferred,
    off_blocks: ops.off_blocks,
    off_ground: ops.off_ground,
    on_ground: ops.on_ground,
    in_blocks: ops.in_blocks,
    ctot: ctot.ctot,
    reg: f.reg,
    ac_type: f.ac_type || f.acft_type,
    plan_no: f.plan_no || "",
    plan_released_on: f.plan_released_on ? f.plan_released_on.toISOString() : "",
    gantt_tow: f.planned_takeoff_weight ? Math.trunc(f.planned_takeoff_weight) : null,
    gantt_lwt: f.landing_weight ? Math.trunc(f.landing_weight) : null,
    etops: !!f.etops,
    dispatcher: f.dispatcher.split(/\s+/).filter(Boolean).join(" "),
    crew_count: f.crew_count,
    attachment_count: f.attachment_count,
    pdf_count: f.pdf_attachments.length,
    status: f.status,
    ofp_status: f.ofp_status,
    ofp_ack: ofpAckNeeded(f),
    alternates: destAltsForRow(f),
    extra_fuel: f.planned_extra_fuel || 0,
    // web.py ofp.extra_of(f.id)[1]: minutes only known after reading the OFP
    // PDF — never cached across a request in a Worker, so this is always null.
    extra_time: null as string | null,
    fuel_units: f.fuel_units || "KG",
    pib_wx: f.pib_wx_status,
    has_pib: f.has_pib,
    has_wx: f.has_wx,
    attch: attch ?? attchCheck(f),
    taf_wx: adviceForFlight(f.dest_icao, f.sta ? f.sta.toISOString() : null, null),
    limit_warns: warns,
    needs_ofp_limit_check: needsOfpLimitCheck(f, lim),
  };
}

/** Port of web.py `detail()` — crews/fuel/jetplan extras for one flight. */
function fuelOrderOf(f: Flight): { amount: number; units: string } | null {
  const hits: [string, number, string][] = [];
  for (const ev of f.audit) {
    if (!ev || typeof ev !== "object") continue;
    if (String((ev as Record<string, unknown>)["action"] || "").trim().toLowerCase() !== "sector fuel_order_received") continue;
    const info = (ev as Record<string, unknown>)["additionalInfo"];
    const infoObj = info && typeof info === "object" ? (info as Record<string, unknown>) : {};
    const amt = Number(infoObj["amount"]);
    if (!Number.isFinite(amt)) continue;
    const unit = String(infoObj["fuelUnit"] || f.fuel_units || "KG");
    hits.push([String((ev as Record<string, unknown>)["datetime"] || ""), amt, unit]);
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const last = hits[hits.length - 1]!;
  return { amount: last[1], units: last[2] };
}

function detail(f: Flight, crews: Flight["crews"]) {
  return {
    ...row(f),
    fltno: f.fltno,
    voyage_id: f.voyage_id,
    plan_id: f.plan_id,
    dep_name: f.dep_name,
    dest_name: f.dest_name,
    dep_iata: f.dep_iata,
    dest_iata: f.dest_iata,
    etd: f.etd ? f.etd.toISOString() : null,
    eta: f.eta ? f.eta.toISOString() : null,
    eet: f.eet,
    fuel: {
      block: f.planned_fuel_total || f.planned_fuel,
      taxi: f.planned_taxi_fuel,
      reserve: f.planned_reserve_fuel,
      alternate: f.planned_alt_fuel,
      contingency: f.planned_con_fuel,
      extra: f.planned_extra_fuel,
      units: f.fuel_units,
    },
    tow: f.planned_takeoff_weight,
    lw: f.landing_weight,
    zfw: Number((f.raw as Record<string, unknown>)["planned_ezfm"]) || null,
    pax_total: f.pax_total,
    cargo: f.cargo,
    fuel_order: fuelOrderOf(f),
    released_by: f.released_by_name,
    verified_by: f.verified_by_name,
    route_description: f.route_description,
    // jetplan_ac.specs(reg) needs the PC helper's local cache — not available
    // in a Worker, so we omit it like web.py would with an empty cache.
    jetplan: null,
    crews: crews.map((c) => ({ job: c.job_name, name: c.full_name, username: c.username, accepted: c.is_sector_accepted })),
    attachments: f.attachments.map((a) => ({
      id: a.id,
      sector_id: a.sector_id,
      title: a.title,
      filename: a.original_filename,
      is_pdf: a.is_pdf,
      deleted: a.is_deleted,
      created_by: a.created_by,
      created_on: a.created_on ? a.created_on.toISOString() : null,
    })),
    audit: f.audit.slice(-15).map((e) => {
      const ev = e as Record<string, unknown>;
      return {
        time: ev["datetime"],
        action: ev["action"],
        who: `${ev["forename"] || ""} ${ev["surname"] || ""}`.trim(),
      };
    }),
  };
}

// Port of the web.py endpoints for group "core". Keep JSON shapes identical to web.py.
export const routes: Routes = {
  // Web app has real login, so the local passcode gate is always open.
  "GET /api/gate/status": () => ({ unlocked: true, default_password: false, locked: false, fails: 0, max_tries: 5 }),
  "POST /api/gate/lock": () => ({ ok: true, locked: false }),
  "POST /api/gate/unlock": () => ({ ok: true, unlocked: true }),
  "POST /api/gate/enter": () => ({ ok: true, unlocked: true }),
  "GET /api/heartbeat": () => ({ ok: true }),
  "GET /api/tab-close": () => ({ ok: true }),
  "POST /api/tab-close": () => ({ ok: true }),
  "POST /api/quit": () => ({ ok: true }),
  "POST /api/stop": () => ({ ok: true }),
  "GET /api/dispatchers": async ({ params }) => {
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const scoped = applyFilters(flights, params, true);
    return { dispatchers: listDispatchers(scoped), total: scoped.length };
  },
  "GET /api/flights": async (ctx) => {
    const { params } = ctx;
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const refresh = params.get("refresh") === "1";
    const flights = await loadFlights(days, refresh);
    const shown = applyFilters(flights, params);
    const limits = await getJson<LimitsData>(ctx, "limits", EMPTY_LIMITS);
    const rev = "0";
    const attchCtx: AttchCtx = attchContext();
    return {
      days,
      total: flights.length,
      count: shown.length,
      flights: shown.map((f) => row(f, limits, attchCheck(f, attchCtx), rev)),
      attachment_total: shown.reduce((n, f) => n + f.pdf_attachments.length, 0),
      fetched_at: null,
      age: null,
      cache_ttl: 300,
    };
  },
  "GET /api/flight/*": async (ctx) => {
    const m = /\/api\/flight\/(\d+)(\/ofp)?$/.exec(ctx.route);
    if (!m) return { error: "sector_id không hợp lệ" };
    const sectorId = Number(m[1]);
    const days = parseInt(ctx.params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const flight = flights.find((f) => f.id === sectorId);
    if (m[2]) {
      if (!flight) return new Response("khong thay chuyen", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      try {
        const { fbGet } = await import("@/lib/flitebrief.server");
        const res = await fbGet(`/webapi/sectors/${sectorId}/ofp`, "application/pdf");
        if (!res.ok || res.status === 204) {
          return new Response("chua co OFP PDF tren FliteBrief", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const blob = await res.arrayBuffer();
        if (!blob.byteLength) {
          return new Response("chua co OFP PDF tren FliteBrief", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response(blob, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Cache-Control": "private, no-store",
            "Content-Disposition": `inline; filename="${flight.callsign || sectorId}-OFP.pdf"`,
          },
        });
      } catch (exc) {
        return new Response(`loi tai OFP: ${exc instanceof Error ? exc.message : String(exc)}`, {
          status: 502,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }
    if (!flight) return { error: `Không tìm thấy sector ${sectorId}` };
    let crews = flight.crews;
    if (!crews.length && flight.crew_count) {
      try {
        const { fbJson } = await import("@/lib/flitebrief.server");
        const { Crew } = await import("../core/models");
        const data = await fbJson<unknown>(`/webapi/sectors/${sectorId}/crews`);
        const list = Array.isArray(data) ? data : [];
        crews = list.filter((c): c is Record<string, unknown> => !!c && typeof c === "object").map((c) => Crew.fromApi(c, sectorId));
        flight.crews = crews;
      } catch {
        // FliteBrief crews fetch failing shouldn't break the rest of the detail.
      }
    }
    return detail(flight, crews);
  },
};
export const jobs: Jobs = {};
