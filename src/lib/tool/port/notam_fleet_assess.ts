// Domestic "Check NOTAM quốc nội": grade every fetched NOTAM against every domestic
// flight that uses its airport/FIR, with the same five-level engine as tracking
// (assessNotam). The NOTAM keeps the most severe level across the fleet so the
// CRUCIAL / MANUAL CHECK / BRIEFING INFO / MINOR counters show real numbers, and
// the reasons name the flight(s) behind it. Nothing is removed from the payload.
import type { Flight } from "../core/models";
import { assessNotam, normAssessCfg, LEVELS, type AssessFlight, type Assessment, type Role } from "./notam_assess";
import { airportParentFir, normIcao } from "./notam_check";
import {
  buildTuneCtx, extraOfpTokens, firWindows, flightAirfields, ofpSidStarProcs, parseEtpAltTimes,
} from "./notam_check_tune";
import type { Notam, Place, TrackPoint } from "./notam_track";

export interface FleetAssessInput {
  flight: Flight;
  ofpText: string;
  points: TrackPoint[];
}

const isFirKind = (k: string) => k === "FIR" || k === "F";
const csOf = (f: Flight) => `${(f.callsign || `#${f.id}`).trim()} ${normIcao(f.dep_icao)}–${normIcao(f.dest_icao)}`;

export function fleetAssessFlight(input: FleetAssessInput): AssessFlight {
  const { flight, ofpText, points } = input;
  const etd = flight.etd || flight.std || null;
  const eta = flight.eta || flight.sta || null;
  const roles: Record<string, Role> = {};
  for (const [code, role] of flightAirfields(flight, ofpText)) roles[code] = role as Role;
  const raltArr: Record<string, [Date, Date]> = {};
  if (etd) {
    for (const [code, [a, b]] of Object.entries(parseEtpAltTimes(ofpText))) {
      if (roles[code] === "RALT") raltArr[code] = [new Date(etd.getTime() + a * 60_000), new Date(etd.getTime() + b * 60_000)];
    }
  }
  const depFir = airportParentFir(normIcao(flight.dep_icao));
  const firs = { ...firWindows(flight, ofpText, depFir) };
  // Without an OFP EET list a domestic flight still spends its whole sector in the
  // departure and destination FIRs.
  const s0 = flight.std || flight.etd || null, e0 = flight.sta || flight.eta || s0;
  if (s0 && e0) {
    for (const fir of [depFir, airportParentFir(normIcao(flight.dest_icao))]) {
      if (fir && !firs[fir]) firs[fir] = [s0, e0];
    }
  }
  const procs = [...ofpSidStarProcs(ofpText)];
  const tokens = new Set([
    ...((buildTuneCtx(flight, ofpText).tokens as Set<string>) || []),
    ...extraOfpTokens(points as unknown as Record<string, unknown>[]),
  ]);
  return {
    etd, eta, roles, ralt_arr: raltArr, firs, points, tokens,
    sid: procs[0] ?? null,
    star: procs.length > 1 ? procs[procs.length - 1]! : null,
    acType: String(flight.ac_type || flight.acft_type || "").trim(),
  };
}

const rank = (a: Assessment) => LEVELS.indexOf(a.level);
const worse = (a: Assessment, b: Assessment) =>
  rank(a) < rank(b) || (rank(a) === rank(b) && (a.earliest_impact_delay_minutes ?? 1e9) < (b.earliest_impact_delay_minutes ?? 1e9));

/** Grade one NOTAM against the fleet; most severe level wins, reasons name the flights. */
export function assessFleetNotam(n: Notam, code: string, kind: string, fleet: { flight: Flight; af: AssessFlight }[], cfgRaw?: unknown): Assessment & { flights: string[] } {
  const cfg = normAssessCfg(cfgRaw);
  const fir = isFirKind(kind);
  const users = fleet.filter(({ af }) => (fir ? !!af.firs[code] : !!af.roles[code]));
  if (!users.length) {
    return {
      level: "NO IMPACT", earliest_impact_delay_minutes: null, match_type: "OUT-OF-SCOPE", flights: [],
      reasons: [`Không chuyến quốc nội nào dùng ${code} (DEP/ARR/alternate/FIR).`],
    };
  }
  let best: Assessment | null = null, bestFlight: Flight | null = null;
  const hit: string[] = [];
  let vip = false, unid = false;
  for (const { flight, af } of users) {
    const a = assessNotam(n, code, kind, af, cfg);
    if (a.level !== "NO IMPACT") hit.push(csOf(flight));
    if (a.vip_hold) vip = true;
    if (a.unidentified_area) unid = true;
    if (!best || worse(a, best)) { best = a; bestFlight = flight; }
  }
  const b = best!;
  const reasons = [`${csOf(bestFlight!)}: ${b.reasons[0] || b.match_type}`, ...b.reasons.slice(1)];
  if (hit.length > 1) reasons.push(`Ảnh hưởng ${hit.length} chuyến: ${hit.slice(0, 8).join(", ")}${hit.length > 8 ? ` +${hit.length - 8}` : ""}.`);
  if (b.level === "NO IMPACT") reasons.push(`Đã xét ${users.length} chuyến dùng ${code}: không chuyến nào bị ảnh hưởng.`);
  return {
    ...b, reasons, flights: hit,
    ...(vip && b.vip_hold ? { vip_hold: true } : {}),
    ...(unid && b.unidentified_area ? { unidentified_area: true } : {}),
  };
}

/** Stamp level/reasons on every NOTAM of every place (in place). Returns level counts. */
export function assessDomesticPlaces(places: Place[], inputs: FleetAssessInput[], cfgRaw?: unknown): Record<string, number> {
  const fleet = inputs.map((i) => ({ flight: i.flight, af: fleetAssessFlight(i) }));
  const counts: Record<string, number> = {};
  for (const place of places || []) {
    const code = String(place.code ?? "").toUpperCase();
    const kind = String(place.kind ?? "").toUpperCase();
    for (const n of ((place.notams as Notam[] | undefined) || [])) {
      if (!n || typeof n !== "object") continue;
      const a = assessFleetNotam(n, code, kind, fleet, cfgRaw);
      n.level = a.level;
      n.impact_delay = a.earliest_impact_delay_minutes;
      n.match_type = a.match_type;
      n.reasons = a.reasons;
      n.unidentified_area = !!a.unidentified_area;
      n.vip_hold = !!a.vip_hold;
      n.window = a.window || "";
      n.flights_hit = a.flights;
      counts[a.level] = (counts[a.level] || 0) + 1;
    }
  }
  return counts;
}
