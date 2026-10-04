import type { Jobs, Routes } from "../types";
import { getJson, setJson } from "../store.server";
import { fetchLatest, type TafSnapshot } from "../port/taf";

// Port of the web.py "/api/taf/*" endpoints (taf.py). Keep JSON shapes identical to web.py.
// taf.fetch_latest() logs into the TSN MET station (113.161.121.25, fallback 118.69.213.84)
// and parses the TAF En-Route / ALL Routes dump. Results are cached under "wx.taf" the same
// way web.py caches to data/taf/latest.json + in-memory _CACHE.
const CACHE_KEY = "wx.taf";

type TafCache = {
  fetched_at: string | null;
  datetime: string;
  slots?: string[];
  tafs: Record<string, unknown>;
  count: number;
  active?: number;
};

const emptyCache = (): TafCache => ({ fetched_at: null, datetime: "", tafs: {}, count: 0 });

export const routes: Routes = {
  "GET /api/taf/status": async (ctx) => {
    const data = await getJson<TafCache>(ctx, CACHE_KEY, emptyCache());
    const tafs = data.tafs || {};
    return {
      count: data.count ?? 0,
      active:
        data.active ??
        Object.values(tafs).filter((t) => !(t as { nil?: boolean })?.nil).length,
      datetime: data.datetime ?? "",
      fetched_at: data.fetched_at ?? null,
    };
  },

  "GET /api/taf/refresh": async (ctx) => {
    try {
      const info: TafSnapshot = await fetchLatest();
      await setJson(ctx, CACHE_KEY, info);
      return {
        ok: true,
        count: info.count ?? 0,
        active: info.active ?? 0,
        datetime: info.datetime ?? "",
        slots: info.slots ?? [],
        fetched_at: info.fetched_at ?? null,
      };
    } catch (exc) {
      return { error: (exc as Error)?.message ?? String(exc) };
    }
  },
};

export const jobs: Jobs = {};
