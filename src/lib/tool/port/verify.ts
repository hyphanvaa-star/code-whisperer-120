// Port of api/verify.py ofp_ack_needed (only the piece core.server.ts needs).
import type { Flight } from "../core/models";

export function ofpAckNeeded(flight: Flight): boolean {
  if (flight.needs_re_release) return true;
  const raw = flight.raw || {};
  return !!(raw["ofpActionRequired"] || raw["new_ofp_received"] || raw["unReleasedOfp"] || raw["needs_re_release"]);
}
