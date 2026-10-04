import type { Jobs, Routes } from "../types";
import { getJson } from "../store.server";

// Port of the web.py "/api/taf/*" endpoints (taf.py). Keep JSON shapes identical to web.py.
// taf.fetch_latest() logs into the TSN MET station at 113.161.121.25 / 118.69.213.84 (a
// Vietjet-internal network) — unreachable from this Cloudflare Worker, so refresh always
// fails here with a Vietnamese explanation instead of faking success. status/snapshot still
// read whatever cache was last stored under "wx.taf" (never populated in this environment).
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

  "GET /api/taf/refresh": async () => {
    try {
      throw new Error(
        "Không kết nối được đài TAF (TSN MET nội bộ, 113.161.121.25 / 118.69.213.84) — cần PC helper trong mạng Vietjet để tải TAF mới.",
      );
    } catch (exc) {
      return { error: String((exc as Error).message ?? exc) };
    }
  },
};

export const jobs: Jobs = {};
