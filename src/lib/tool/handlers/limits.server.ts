import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";

// Port of web.py limits.json endpoints ("/api/limits", "/api/limits/status").
// Storage: app_settings key "limits" — value is the {aircraft,airports,curfew,special}
// object directly (same shape saveLimits/getSetting in settings.functions.ts already use).

const TAU_LIST = [
  "VNA522", "VNA631", "VNA637", "VNA651", "VNA643", "VNA642", "VNA639",
  "VNA635", "VNA632", "VNA641", "VNA649", "VNA657", "VNA634", "VNA687",
].sort();
const LOW_EGT_LABEL = "LOW EGT";

type LimitsData = {
  aircraft: Record<string, unknown>[];
  airports: Record<string, unknown>[];
  curfew: Record<string, unknown>[];
  special: Record<string, unknown>[];
};

function emptyLimits(): LimitsData {
  return { aircraft: [], airports: [], curfew: [], special: [] };
}

const normReg = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const displayVnReg = (norm: string) => {
  if (norm.length >= 6 && norm.startsWith("VNA")) return "VN-A" + norm.slice(3);
  if (norm.length > 2 && norm.startsWith("VN")) return "VN-" + norm.slice(2);
  return norm;
};
const isLowEgtDefect = (v: unknown) => /^\s*LOW\s+EGT/.test(String(v ?? "").toUpperCase());

/** Port of web.py seed_low_egt_aircraft. */
function seedLowEgtAircraft(rows: unknown[] | null | undefined): Record<string, unknown>[] {
  const existing: Record<string, unknown>[] = [];
  const haveEgt = new Set<string>();
  const seenOther = new Set<string>();
  for (const raw of rows ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const reg = normReg(row["reg"]);
    if (!reg) continue;
    if (isLowEgtDefect(row["defect"])) {
      if (haveEgt.has(reg)) continue;
      haveEgt.add(reg);
      existing.push({ reg: String(row["reg"] ?? "").trim() || displayVnReg(reg), defect: LOW_EGT_LABEL, limit: String(row["limit"] ?? "") });
      continue;
    }
    const key = `${reg}\u0000${String(row["defect"] ?? "").toUpperCase().replace(/\s+/g, " ").trim()}`;
    if (seenOther.has(key)) continue;
    seenOther.add(key);
    existing.push(row);
  }
  const missing = TAU_LIST.filter((norm) => !haveEgt.has(norm)).map((norm) => ({ reg: displayVnReg(norm), defect: LOW_EGT_LABEL, limit: "" }));
  return [...missing, ...existing];
}

function lowEgtMissing(rows: unknown[] | null | undefined): boolean {
  const have = new Set<string>();
  for (const raw of rows ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (isLowEgtDefect(row["defect"])) have.add(normReg(row["reg"]));
  }
  return !TAU_LIST.every((t) => have.has(t));
}

/** Port of web.py save_limits. */
function cleanLimits(payload: Record<string, unknown>): LimitsData {
  const data = emptyLimits();
  for (const key of Object.keys(data) as (keyof LimitsData)[]) {
    const val = payload[key];
    if (!Array.isArray(val)) continue;
    const cleaned: Record<string, unknown>[] = [];
    for (const raw of val) {
      if (!raw || typeof raw !== "object") continue;
      let row = raw as Record<string, unknown>;
      if (!Object.values(row).some((v) => String(v ?? "").trim())) continue;
      if (key === "curfew") {
        row = {
          code: String(row["code"] ?? "").trim(),
          start: String(row["start"] ?? row["open"] ?? "").trim(),
          end: String(row["end"] ?? row["close"] ?? row["time"] ?? "").trim(),
        };
        if (!Object.values(row).some(Boolean)) continue;
      }
      cleaned.push(row);
    }
    data[key] = cleaned;
  }
  data.aircraft = seedLowEgtAircraft(data.aircraft);
  return data;
}

async function loadLimits(ctx: Parameters<Routes[string]>[0]): Promise<LimitsData> {
  const raw = await getJson<Partial<LimitsData> | null>(ctx, "limits", null);
  const data = emptyLimits();
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(data) as (keyof LimitsData)[]) {
      const v = (raw as Record<string, unknown>)[key];
      data[key] = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    }
  }
  return data;
}

async function saveLimits(ctx: Parameters<Routes[string]>[0], payload: Record<string, unknown>): Promise<LimitsData> {
  const data = cleanLimits(payload);
  await setJson(ctx, "limits", data);
  return data;
}

function filledCount(rows: Record<string, unknown>[], keys: string[]): number {
  let n = 0;
  for (const r of rows) if (keys.some((k) => String(r[k] ?? "").trim())) n++;
  return n;
}

export const routes: Routes = {
  "GET /api/limits": async (ctx) => {
    // Port of web.py ensure_low_egt_limits(): GET always has the default LOW EGT rows.
    const data = await loadLimits(ctx);
    if (!lowEgtMissing(data.aircraft)) return data;
    return saveLimits(ctx, { ...data, aircraft: seedLowEgtAircraft(data.aircraft) });
  },
  "GET /api/limits/status": async (ctx) => {
    const data = await loadLimits(ctx);
    return {
      path: "limits.json",
      exists: true,
      aircraft: filledCount(data.aircraft, ["reg", "defect", "limit"]),
      airports: filledCount(data.airports, ["code", "limit"]),
      curfew: filledCount(data.curfew, ["code", "start", "end"]),
      special: filledCount(data.special, ["reg", "code", "limit"]),
      revision: String(Date.now()),
    };
  },
  "POST /api/limits": async (ctx) => {
    try {
      const body = await ctx.json();
      return await saveLimits(ctx, body && typeof body === "object" ? body : {});
    } catch (exc) {
      return { error: String((exc as Error).message || exc) };
    }
  },
};

export const jobs: Jobs = {};
