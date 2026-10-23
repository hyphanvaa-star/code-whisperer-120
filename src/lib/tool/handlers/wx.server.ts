import type { Jobs, Routes } from "../types";
import { getJson, setJson, putFile, listFiles } from "../store.server";
import { fetchLatest, type TafSnapshot } from "../port/taf";
import { jobId } from "../jobs";
import {
  download as metwxDownload,
  SITES,
  DEFAULT_ORDER,
  type WxResult,
  type MetTransport,
} from "../port/metwx";
import * as pc from "../pcagent.server";
import type { Ctx } from "../types";

/** Dự phòng cho đài chỉ có IP: trợ lý PC trên máy công ty gửi request hộ. */
function pcTransport(ctx: Ctx): MetTransport {
  return async (req) => {
    const agent = await pc.agentInfo(ctx);
    if (!pc.agentOnline(agent)) throw new Error("trợ lý PC chưa kết nối");
    const id = await pc.enqueue("http_fetch", { ...req, timeout_s: Math.ceil(req.timeoutMs / 1000) });
    let r: Record<string, unknown>;
    try {
      r = await pc.waitResult(id, req.timeoutMs + 60_000);
    } catch (e) {
      const msg = (e as Error).message;
      if (/không biết lệnh/.test(msg)) throw new Error("trợ lý PC cần cập nhật bản v4.0 trở lên");
      throw e;
    }
    const body = Buffer.from(String(r["body_b64"] || ""), "base64");
    return new Response(body.length ? body : null, {
      status: Number(r["status"]) || 502,
      headers: { "content-type": String(r["content_type"] || "application/octet-stream") },
    });
  };
}
import { safeFilename } from "../core/models";

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
      if (!info.count) return { error: `Đài TAF (${info.source}) không trả bản TAF nào — thử lại sau ít phút.` };
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
  parseKmzUrls, kmlFeatures, todayFeatures,
} from "../port/wx_overlay";
import { unzipSync, strFromU8 } from "fflate";
import { jmaCode, jmaStorm, jtwcStorms, mergeStorms, type Storm } from '../port/storms';

let stormsCacheAt = 0;
let stormsCache: unknown = null;
const STORM_TTL_MS = 300_000;

type StormResult = { features: unknown[]; storms: Storm[]; source: string; warning?: string | undefined };
type Getter = (url: string) => Promise<Response>;
const directGet: Getter = (url) => fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(12000) });
/** Trợ lý PC trên mạng văn phòng tải hộ khi navy.mil chặn máy chủ. */
function pcGetter(ctx: Ctx): Getter {
  const t = pcTransport(ctx);
  return (url) => t({ session: "jtwc", method: "GET", url, headers: { ...(UA_HEADERS as Record<string, string>) }, timeoutMs: 25000 });
}
async function fetchJtwcStorms(get: Getter = directGet, source = "JTWC"): Promise<StormResult> {
  const rssRes = await get(JTWC_RSS);
  if (!rssRes.ok) throw new Error(`JTWC RSS ${rssRes.status}`);
  const rss = await rssRes.text();
  const storms = jtwcStorms(rss);
  const kmzUrls = parseKmzUrls(rss);
  const features: unknown[] = [];
  await Promise.all(kmzUrls.slice(0, 16).map(async (url) => {
    try {
      const r = await get(url);
      if (!r.ok) return;
      const buf = new Uint8Array(await r.arrayBuffer());
      const files = unzipSync(buf);
      const kmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".kml"));
      if (!kmlName) return;
      const kml = strFromU8(files[kmlName] as Uint8Array);
      const feats = todayFeatures(kmlFeatures(kml));
      features.push(...feats);
    } catch {
      // một storm lỗi không chặn các storm khác
    }
  }));
  return { features, storms, source, warning: kmzUrls.length && !features.length ? 'Không tải được bản đồ JTWC' : undefined };
}

async function fetchJmaStorms(): Promise<StormResult> {
  const r = await fetch(JMA_TARGET, { headers: JMA_UA_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`JMA ${r.status}`);
  const targets = (await r.json()) as Array<Record<string, unknown>>;
  const features: unknown[] = [];
  const storms: Storm[] = [];
  let failed = 0;
  await Promise.all(targets.map(async (t) => {
    const code = jmaCode(t);
    if (!code) { failed++; return; }
    try {
      const fr = await fetch(jmaFcstUrl(code), { headers: JMA_UA_HEADERS, signal: AbortSignal.timeout(12000) });
      if (!fr.ok) { failed++; return; }
      const fcst = (await fr.json()) as Array<Record<string, unknown>>;
      const parsed = jmaStorm(fcst, t);
      features.push(...parsed.features);
      storms.push(parsed.storm);
      if (!parsed.features.length) failed++;
    } catch {
      failed++;
    }
  }));
  return { features, storms, source: "JMA", warning: failed ? 'Một số bản tin bão JMA chưa tải được' : undefined };
}

async function stormsPayload(force: boolean, ctx?: Ctx) {
  const now = Date.now();
  if (!force && stormsCache && now - stormsCacheAt < STORM_TTL_MS) return stormsCache;
  let out: StormResult;
  try {
    out = await fetchJtwcStorms();
  } catch (e) {
    out = { features: [], storms: [], source: 'JTWC', warning: String((e as Error).message) };
  }
  if (!out.features.length && ctx) {
    try {
      const viaPc = await fetchJtwcStorms(pcGetter(ctx), "JTWC (qua trợ lý PC)");
      if (viaPc.features.length || viaPc.storms.length >= out.storms.length) out = viaPc;
    } catch {
      // trợ lý PC offline/lỗi → rơi tiếp xuống JMA
    }
  }
  if (!out.features.length) {
    try {
      const jma = await fetchJmaStorms();
      out = { ...jma, storms: mergeStorms(out.storms, jma.storms), warning: jma.warning || (out.storms.length && !jma.features.length ? out.warning || 'Có cảnh báo bão, chưa tải được bản đồ' : undefined) };
    } catch (e) {
      out.warning = `Chưa tải được bản đồ bão: ${String((e as Error).message)}`;
    }
  }
  const payload = { type: "FeatureCollection", ...out, error: !out.features.length && !out.storms.length && out.warning ? out.warning : undefined, at: new Date().toISOString() };
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
      return await stormsPayload(force, ctx);
    } catch (exc) {
      return { features: [], storms: [], error: String((exc as Error)?.message ?? exc) };
    }
  },

  // Trình duyệt tự tải RSS + KMZ JTWC (navy.mil cho phép) khi máy chủ bị chặn;
  // máy chủ chỉ giải nén/đọc KML giống hệt luồng JTWC gốc.
  "POST /api/wx/storms-kmz": async (ctx: Parameters<Routes[string]>[0]) => {
    const body = await ctx.json();
    const rss = String(body["rss"] ?? "");
    const list = ((body["kmz"] as unknown[]) ?? []).map(String).slice(0, 16);
    const features: unknown[] = [];
    for (const b64 of list) {
      try {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const files = unzipSync(buf);
        const kmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".kml"));
        if (!kmlName) continue;
        features.push(...todayFeatures(kmlFeatures(strFromU8(files[kmlName] as Uint8Array))));
      } catch { /* bỏ qua bão lỗi */ }
    }
    const payload = { type: "FeatureCollection", features, storms: jtwcStorms(rss), source: "JTWC", at: new Date().toISOString() };
    if (features.length) { stormsCache = payload; stormsCacheAt = Date.now(); }
    return payload;
  },

  // Port of web.py "/api/wx/download" → start_wx_download(): trả {id} rồi job
  // "wx_download" chạy trong /api/stream. Các đài MET mở được từ internet nên
  // server tự tải trực tiếp (metwx.download), lưu PDF vào store "pibwx/".
  "POST /api/wx/download": async (ctx: Parameters<Routes[string]>[0]) => {
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
        transport: pcTransport(ctx),
        // Không dùng lại file cũ — luôn tải bản mới.
        hasFile: async () => false,
      });
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error)?.message ?? exc}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: want.length, missing: want });
      return;
    }

    // Lưu PDF vào store "pibwx/" (thay ổ đĩa data/pibwx của bản PC).
    const savedMeta: Array<{ callsign: string; filename: string }> = [];
    const pcCopies: { name: string; bytes: Uint8Array }[] = [];
    for (const s of res.saved) {
      try {
        await putFile(ctx, `pibwx/${safeFilename(s.filename)}`, s.bytes, "application/pdf");
        savedMeta.push({ callsign: s.callsign, filename: s.filename });
        pcCopies.push({ name: safeFilename(s.filename), bytes: s.bytes });
      } catch (exc) {
        emit({ type: "line", text: `✗ ${s.callsign}: không lưu được ${s.filename} — ${(exc as Error)?.message ?? exc}`, cls: "bad" });
        res.missing.push(s.callsign);
      }
    }

    if (pcCopies.length) {
      const { queueFilesToPc } = await import("./pc.server");
      const dest = await queueFilesToPc(ctx, "pibwx", pcCopies).catch(() => null);
      emit({ type: "line", text: dest ? `💾 lưu ${pcCopies.length} file WX về máy: ${dest}` : "· trợ lý PC chưa bật — chưa lưu được file về ổ D/C", cls: dest ? undefined : "bad" });
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
