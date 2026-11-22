// SkyVector chart tiles are addressed by tile server + AIRAC edition
// (https://t.skyvector.com/<token>/<chart>/<edition>/<scale>/<x>/<y>.jpg).
// The edition advances every 28 days; a stale edition returns 404 for every
// tile, leaving the NOTAM map blank. Browser-safe: no imports.

export type SvConfig = { base: string; edition: number };

export const SV_DEFAULT_BASE = "https://t.skyvector.com/ABPNMzP6pI9L";

// AIRAC cycle number (YYNN) in effect at `ms` (UTC epoch ms).
// Reference: AIRAC 2001 became effective 2020-01-02; cycles are 28 days.
export function svAiracCycle(ms: number): number {
  const ref = Date.UTC(2020, 0, 2);
  const step = 28 * 86400000;
  const n = Math.floor((ms - ref) / step);
  const start = ref + n * step;
  const year = new Date(start).getUTCFullYear();
  const first = Math.ceil((Date.UTC(year, 0, 1) - ref) / step);
  return (year % 100) * 100 + (n - first + 1);
}

// Previous AIRAC cycle number (handles year rollover, e.g. 2701 -> 2613).
export function svPrevCycle(edition: number, nowMs: number): number {
  const ref = Date.UTC(2020, 0, 2);
  const step = 28 * 86400000;
  for (let n = Math.floor((nowMs - ref) / step) + 2; n > 0; n--) {
    if (svAiracCycle(ref + n * step) === edition) return svAiracCycle(ref + (n - 1) * step);
  }
  return edition - 1;
}

// Parses SkyVector's /api/init chart response; rejects anything that is not
// a SkyVector tile host or a plausible 4-digit edition.
export function svParseInit(json: unknown): SvConfig | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const edition = Number(o["edition"]);
  if (!Number.isInteger(edition) || edition < 2000 || edition > 9913) return null;
  const servers = String(o["tileservers"] ?? "").split(",").map((s) => s.trim());
  const base = servers.find((s) => /^https:\/\/t\.skyvector\.com\/[A-Za-z0-9_-]{4,40}$/.test(s));
  return { base: base ?? SV_DEFAULT_BASE, edition };
}
