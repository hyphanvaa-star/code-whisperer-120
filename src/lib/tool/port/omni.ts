// Port of omni.py — pure helpers (the live OMNI web session needs OMNI_USER/PASS
// and company-intranet access; see autoload.server.ts for the job wiring).
export function omniCredsPresent(env: Record<string, string | undefined> = (typeof process !== "undefined" ? (process.env as any) : {})) {
  return Boolean(env.OMNI_USER && env.OMNI_PASS);
}
