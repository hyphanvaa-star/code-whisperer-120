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

  // Port of web.py "/api/wx/download" → start_wx_download(): trả {id} rồi job
  // "wx_download" chạy trong /api/stream. Các đài MET mở được từ internet nên
  // server tự tải trực tiếp (metwx.download), lưu PDF vào store "pibwx/".
  "POST /api/wx/download": async (ctx) => {
    const payload = await ctx.json();
    const callsigns = ((payload["callsigns"] as unknown[]) ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    if (!callsigns.length) return { error: "Chưa có số hiệu chuyến bay nào trong cột PIB/WX." };
    const sites = ((payload["sites"] as unknown[]) ?? []).map(String).filter(Boolean);
    return {
      id: jobId("wx_download", {
        callsigns,
        sites,
        overwrite: Boolean(payload["overwrite"]),
        max_age_h: Number(payload["max_age_h"]) || 8.0,
      }),
    };
  },
});

export const wxJobs: Jobs = {
  // Port of web.py start_wx_download().work(): stream từng dòng tiến trình rồi
  // kết thúc bằng {type:"end", code, elapsed, ok, skipped, failed, missing,
  // files, folder} — đúng shape trang gốc đang đọc.
  wx_download: async (params, emit, ctx) => {
    const t0 = Date.now();
    const want = ((params["callsigns"] as string[]) ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
    const sites = ((params["sites"] as string[]) ?? []).filter(Boolean);
    const overwrite = Boolean(params["overwrite"]);
    const maxAgeH = Number(params["max_age_h"]) || 8.0;
    const use = sites.length ? sites : [...DEFAULT_ORDER];
    const day = new Date();
    const dd = `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${day.getUTCFullYear()}`;
    emit({
      type: "line",
      text: `▶ ${want.length} chuyến · ngày ${dd} · chỉ nhận file upload trong ${maxAgeH}h qua · đài: ${use.map((s) => SITES[s]?.name ?? s).join(", ")}`,
    });

    let res: WxResult;
    try {
      res = await metwxDownload(want, {
        sites: use,
        overwrite,
        maxAgeH,
        onProgress: (text, cs) => emit({ type: "line", text: `  ${text}`, found: cs || undefined }),
        hasFile: async (filename) => {
          const existing = await listFiles(ctx, "pibwx");
          return existing.some((f) => f.name === filename);
        },
      });
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error)?.message ?? exc}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: want.length, missing: want });
      return;
    }

    // Lưu PDF vào store "pibwx/" (thay ổ đĩa data/pibwx của bản PC).
    const savedMeta: Array<{ callsign: string; filename: string }> = [];
    for (const s of res.saved) {
      try {
        await putFile(ctx, `pibwx/${safeFilename(s.filename)}`, s.bytes, "application/pdf");
        savedMeta.push({ callsign: s.callsign, filename: s.filename });
      } catch (exc) {
        emit({ type: "line", text: `✗ ${s.callsign}: không lưu được ${s.filename} — ${(exc as Error)?.message ?? exc}`, cls: "bad" });
        res.missing.push(s.callsign);
      }
    }

    for (const cs of res.missing) emit({ type: "line", text: `✗ ${cs}: chưa phát hành WX`, cls: "bad" });
    for (const e of res.errors.slice(0, 10)) emit({ type: "line", text: `! ${e}`, cls: "bad" });

    // Một file chỉ xuất hiện một lần dù nhiều site được thử.
    const seen = new Map<string, { callsign: string; filename: string; new: boolean; source: string }>();
    for (const s of savedMeta) seen.set(s.filename.toLowerCase(), { ...s, new: true, source: "wx" });
    for (const s of res.skipped) {
      const k = s.filename.toLowerCase();
      if (!seen.has(k)) seen.set(k, { ...s, new: false, source: "wx" });
    }
    emit({
      type: "end",
      code: res.missing.length ? 2 : 0,
      elapsed: (Date.now() - t0) / 1000,
      ok: savedMeta.length,
      skipped: res.skipped.length,
      failed: res.missing.length,
      missing: res.missing,
      files: [...seen.values()],
      folder: "pibwx",
    });
  },
};

Object.assign(jobs, wxJobs);
