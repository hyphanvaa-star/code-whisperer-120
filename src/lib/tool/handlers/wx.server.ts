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

// ---- /api/wx/radar, /api/wx/storms, /api/wx/download (wx_overlay.py port) ----
import {
  RAINVIEWER_JSON, UA_HEADERS, JTWC_RSS, JMA_UA_HEADERS, JMA_TARGET, jmaFcstUrl,
  parseKmzUrls, kmlFeatures, todayFeatures, jmaFeatures,
} from "../port/wx_overlay";
import { unzipSync, strFromU8 } from "fflate";

let stormsCacheAt = 0;
let stormsCache: unknown = null;
const STORM_TTL_MS = 300_000;

async function fetchJtwcStorms(): Promise<{ features: unknown[]; source: string }> {
  const rssRes = await fetch(JTWC_RSS, { headers: UA_HEADERS });
  if (!rssRes.ok) throw new Error(`JTWC RSS ${rssRes.status}`);
  const rss = await rssRes.text();
  const kmzUrls = parseKmzUrls(rss);
  const features: unknown[] = [];
  for (const url of kmzUrls) {
    try {
      const r = await fetch(url, { headers: UA_HEADERS });
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      const files = unzipSync(buf);
      const kmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".kml"));
      if (!kmlName) continue;
      const kml = strFromU8(files[kmlName] as Uint8Array);
      const feats = todayFeatures(kmlFeatures(kml));
      features.push(...feats);
    } catch {
      // một storm lỗi không chặn các storm khác
    }
  }
  return { features, source: "jtwc" };
}

async function fetchJmaStorms(): Promise<{ features: unknown[]; source: string }> {
  const r = await fetch(JMA_TARGET, { headers: JMA_UA_HEADERS });
  if (!r.ok) throw new Error(`JMA ${r.status}`);
  const targets = (await r.json()) as Array<Record<string, unknown>>;
  const features: unknown[] = [];
  for (const t of targets) {
    const code = String(t.code ?? t.id ?? "");
    if (!code) continue;
    try {
      const fr = await fetch(jmaFcstUrl(code), { headers: JMA_UA_HEADERS });
      if (!fr.ok) continue;
      const fcst = (await fr.json()) as Array<Record<string, unknown>>;
      features.push(...jmaFeatures(fcst));
    } catch {
      // bỏ qua storm lỗi
    }
  }
  return { features, source: "jma" };
}

async function stormsPayload(force: boolean) {
  const now = Date.now();
  if (!force && stormsCache && now - stormsCacheAt < STORM_TTL_MS) return stormsCache;
  let out: { features: unknown[]; source: string };
  try {
    out = await fetchJtwcStorms();
    if (!out.features.length) out = await fetchJmaStorms();
  } catch {
    out = await fetchJmaStorms();
  }
  const payload = { type: "FeatureCollection", features: out.features, source: out.source, at: new Date().toISOString() };
  stormsCache = payload;
  stormsCacheAt = now;
  return payload;
}

Object.assign(routes, {
  "GET /api/wx/radar": async () => {
    try {
      const r = await fetch(RAINVIEWER_JSON, { headers: UA_HEADERS });
      if (!r.ok) throw new Error(`RainViewer ${r.status}`);
      return await r.json();
    } catch (exc) {
      return { error: String((exc as Error)?.message ?? exc) };
    }
  },

  "GET /api/wx/storms": async (ctx: Parameters<Routes[string]>[0]) => {
    const force = ctx.params.get("refresh") === "1";
    try {
      return await stormsPayload(force);
    } catch (exc) {
      return { features: [], storms: [], error: String((exc as Error)?.message ?? exc) };
    }
  },

  // metwx.py: đăng nhập + tải flight folder từ TSN/Nội Bài/Đà Nẵng — các IP nội
  // bộ hãng (113.161.121.25, 14.177.232.218, danmet.vatm.vn) không gọi được từ
  // Cloudflare Worker, và PC agent (pc-agent/pc_agent.py) hiện chưa có handler
  // cho job này. Báo lỗi rõ ràng thay vì giả vờ thành công.
  "POST /api/wx/download": async () => ({
    error:
      "Tải WX (TSN/Nội Bài/Đà Nẵng) cần vào mạng nội bộ hãng — chưa chạy được từ server, " +
      "và trợ lý PC hiện chưa hỗ trợ job này. Gửi cho quản trị để bổ sung.",
  }),
});
