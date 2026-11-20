/**
 * Which PC helper may run a queued job. Pure so it can be tested without the database.
 *
 * - `_aid` (machine id from the browser's own 127.0.0.1 helper): only that exact machine.
 * - `_uid` without `_aid`: the helper paired to that account; an unpaired helper on the same
 *   network may run it only while no helper paired to that account is online (legacy setups).
 * - untagged / IP-only jobs: legacy same-network matching.
 */
export type ClaimJob = { payload?: Record<string, unknown> | null };
export type ClaimAgent = { ip: string; uid: string; aid: string };

export function canClaim(job: ClaimJob, agent: ClaimAgent, uidOnline: (uid: string) => boolean): boolean {
  const p = job.payload ?? {};
  const jAid = String(p["_aid"] ?? "");
  const jUid = String(p["_uid"] ?? "");
  const jIp = String(p["_ip"] ?? "");
  if (jAid) return !!agent.aid && jAid === agent.aid;
  if (jUid) {
    if (agent.uid) return jUid === agent.uid;
    return !!agent.ip && jIp === agent.ip && !uidOnline(jUid);
  }
  return !jIp || jIp === agent.ip;
}

/** Machine id cookie the tool page stores after its local helper answers /pair. */
export function agentIdFromCookie(cookie: string | null | undefined): string {
  const m = /(?:^|;\s*)pc_aid=([0-9a-f]{12,64})(?:;|$)/.exec(cookie ?? "");
  return m ? m[1]! : "";
}
