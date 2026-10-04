// Port of aip_rffs.py — tra AIP sân bay: ô ICAO + chữ tìm, tải tờ AD/FAC.
// Live network fetch (ERSA PDF text, eAIP HTML, Chrome asset proxy) runs with
// native fetch() inside the handler; PDF text extraction is not available in
// this runtime (no pdf.js) so .pdf lookups cannot be text-searched here.

const RFFS_BLOCK = /RESCUE AND FIRE\s*FIGHTING SERVICES\s*([\s\S]{0,1200})/i;
const CAT_LINE = /CAT(?:EGORY)?[\s\-]*([1-9]|10)\b([^\n]{0,40})/i;
const KR_CAT = /AD Category for fire fighting\s+Category\s*(10|[1-9])/is;
const ICAO_RE = /^[A-Z]{4}$/;
const RFFS_QUERY = /cứu\s*ho[ảa]|cuu\s*hoa|rf+f+s|arff|fire\s*fight|rescue and fire|\bcat\b/i;

export const _CYCLE_TTL = 6 * 3600;

export function icaoOf(raw: string): string {
  return String(raw || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export function parseRffs(text: string): { cat: string; hours: string; cat_line: string; snippet: string } {
  const blob = String(text || "");
  const hit = RFFS_BLOCK.exec(blob);
  const chunk = hit ? hit[1] : "";
  let line = "", cat = "", hours = "";
  const m = CAT_LINE.exec(chunk || blob.slice(0, 2500));
  if (m && hit) {
    cat = m[1];
    const rest = (m[2] || "").replace(/\s+/g, " ").trim().replace(/^[ .]+|[ .]+$/g, "");
    hours = rest;
    line = `CAT ${cat}` + (hours ? ` ${hours}` : "");
  }
  if (hit && !hours && /within ats hr/i.test(chunk)) {
    hours = "Within ATS HR";
    if (line && !line.includes("ATS")) line = `${line} Within ATS HR`;
  }
  let effectiveHit = hit;
  let effectiveChunk = chunk;
  if (!line) {
    const km = KR_CAT.exec(blob);
    if (km) {
      cat = km[1];
      line = `CAT ${cat}`;
      if (!hit) {
        effectiveHit = km;
        effectiveChunk = blob.slice(Math.max(0, km.index - 80), km.index + km[0].length + 400);
      }
    }
  }
  let snippet = "";
  if (effectiveHit) {
    snippet = effectiveChunk.replace(/[ \t]+/g, " ").trim();
    snippet = snippet.replace(/\n{2,}/g, "\n").slice(0, 700);
  }
  return { cat, hours, cat_line: line, snippet };
}

export function htmlText(raw: Uint8Array | string): string {
  let blob = typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: false }).decode(raw);
  blob = blob.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  blob = blob.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  blob = blob.replace(/<[^>]+>/gi, "\n");
  blob = decodeHtmlEntities(blob);
  blob = blob.replace(/\xa0/g, " ").replace(/\ufffd/g, " ");
  return blob.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function queryTerms(query: string): string[] {
  const raw = String(query || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const out: string[] = [];
  const add = (term: string) => {
    const t = term.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  add(raw);
  if (RFFS_QUERY.test(raw)) {
    for (const extra of [
      "RESCUE AND FIRE FIGHTING SERVICES",
      "AD Category for fire fighting",
      "FIRE FIGHTING",
      "Category 10",
      "ARFF",
      "RFFS",
    ]) add(extra);
  }
  const words = raw.match(/[\w]{3,}|[^\W\d_]{2,}/gu) || [];
  const stop = new Set(["the", "and", "for", "của", "sân", "bay"]);
  for (const w of words) if (!stop.has(w.toLowerCase())) add(w);
  return out;
}

export function findHits(text: string, query: string, limit = 5): { term: string; snippet: string }[] {
  const blob = String(text || "");
  const hits: { term: string; snippet: string }[] = [];
  const seen = new Set<number>();
  for (const term of queryTerms(query)) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob))) {
      const start = Math.max(0, m.index - 120);
      const end = Math.min(blob.length, m.index + m[0].length + 220);
      const key = Math.floor(start / 80);
      if (seen.has(key)) continue;
      seen.add(key);
      let snip = blob.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) snip = "…" + snip;
      if (end < blob.length) snip = snip + "…";
      hits.push({ term, snippet: snip });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

type Doc = { kind: "pdf" | "html"; raw: Uint8Array; url: string; cycle: string; text: string };

async function httpGet(url: string, timeoutMs = 15000): Promise<{ status: number; body: Uint8Array }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { headers: { "User-Agent": "DispatchBoard-AIP/1.0" }, signal: ctrl.signal });
    clearTimeout(timer);
    const buf = new Uint8Array(await resp.arrayBuffer());
    return { status: resp.status, body: buf };
  } catch {
    return { status: 0, body: new Uint8Array() };
  }
}

async function fetchErsaFac(icao: string): Promise<{ raw: Uint8Array; url: string; cycle: string }> {
  const code = icaoOf(icao);
  if (!ICAO_RE.test(code) || !code.startsWith("Y")) {
    throw new Error(`${code || icao}: ERSA chỉ dùng cho sân Úc (Y…)`);
  }
  const cycles = ["03SEP2026", "01OCT2026", "09JUL2026", "26NOV2026"];
  let lastErr = "không thấy PDF ERSA";
  for (const cycle of cycles) {
    const url = `https://www.airservicesaustralia.com/aip/current/ersa/FAC_${code}_${cycle}.pdf`;
    const { status, body } = await httpGet(url);
    if (status >= 400 || !(body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46)) {
      lastErr = `HTTP ${status}`;
      continue;
    }
    return { raw: body, url, cycle };
  }
  throw new Error(`${code}: ${lastErr}`);
}

async function fetchKoreaAd(icao: string): Promise<Doc> {
  const code = icaoOf(icao);
  if (!ICAO_RE.test(code) || !code.startsWith("RK")) {
    throw new Error(`${code || icao}: eAIP Hàn chỉ dùng cho sân RK…`);
  }
  const cycles = ["2026-09-17", "2026-09-02-AIRAC", "2026-08-05-AIRAC"];
  let lastErr = "không thấy tờ AD 2";
  for (const cycle of cycles) {
    const url = `https://aim.koca.go.kr/eaipPub/Package/${cycle}/html/eAIP/KR-AD-2.${code}-en-GB.html`;
    const { status, body } = await httpGet(url, 20000);
    if (status >= 400 || body.length < 2000) { lastErr = `${cycle} HTTP ${status}`; continue; }
    const text = new TextDecoder().decode(body);
    if (!text.includes(code)) { lastErr = `${cycle} không phải tờ ${code}`; continue; }
    return { kind: "html", raw: body, url, cycle, text: htmlText(body) };
  }
  throw new Error(`${code}: ${lastErr}`);
}

async function fetchIndiaAd(icao: string): Promise<Doc> {
  const code = icaoOf(icao);
  if (!ICAO_RE.test(code) || !/^(VA|VE|VI|VO)/.test(code)) {
    throw new Error(`${code || icao}: eAIP Ấn chỉ dùng cho sân VA/VE/VI/VO`);
  }
  const cycles = ["04-2026", "09-2026", "08-2026", "07-2026", "06-2026", "05-2026", "06-2024"];
  let lastErr = "không thấy tờ AD 2 Ấn Độ";
  for (const cycle of cycles) {
    const urls = [
      `https://aim-india.aai.aero/eaip-v2-${cycle}/eAIP/IN-AD%202.1${code}-en-GB.html`,
      `https://aim-india.aai.aero/eaip/eaip-v2-${cycle}/eAIP/IN-AD%202.1${code}-en-GB.html`,
    ];
    for (const url of urls) {
      const { status, body } = await httpGet(url, 18000);
      if (status >= 400 || body.length < 1500) { lastErr = `${cycle} HTTP ${status || "timeout"}`; continue; }
      return { kind: "html", raw: body, url, cycle, text: htmlText(body) };
    }
  }
  throw new Error(`${code}: ${lastErr}`);
}

async function fetchAd(icao: string): Promise<Doc> {
  const code = icaoOf(icao);
  if (code.startsWith("Y")) {
    const { raw, url, cycle } = await fetchErsaFac(code);
    return { kind: "pdf", raw, url, cycle, text: "" };
  }
  if (code.startsWith("RK")) return fetchKoreaAd(code);
  if (/^(VA|VE|VI|VO)/.test(code)) return fetchIndiaAd(code);
  throw new Error(`${code}: chưa có link AIP trong sổ account — cần Chrome trên máy dispatcher.`);
}

export async function facPdf(icao: string): Promise<Uint8Array> {
  const code = icaoOf(icao);
  const { raw } = await fetchErsaFac(code);
  return raw;
}

export async function viewPage(icao: string, query = ""): Promise<{ blob: Uint8Array; contentType: string }> {
  const doc = await fetchAd(icao);
  if (doc.kind === "pdf") return { blob: doc.raw, contentType: "application/pdf" };
  return { blob: doc.raw, contentType: "text/html; charset=utf-8" };
}

function assetAllowed(url: string): boolean {
  try {
    const p = new URL(url);
    if (p.protocol !== "http:" && p.protocol !== "https:") return false;
    const host = p.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("192.168.")) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchAsset(url: string): Promise<{ blob: Uint8Array; contentType: string }> {
  if (!assetAllowed(url)) throw new Error("URL asset không hợp lệ");
  const { status, body } = await httpGet(url, 20000);
  if (status >= 400 || !body.length) throw new Error(`asset HTTP ${status || "timeout"}`);
  const suffix = (new URL(url).pathname.split(".").pop() || "").toLowerCase();
  const mimes: Record<string, string> = {
    css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp", pdf: "application/pdf",
    woff: "font/woff", woff2: "font/woff2",
  };
  const ctype = body[0] === 0x25 ? "application/pdf" : mimes[suffix] || "application/octet-stream";
  return { blob: body, contentType: ctype };
}

export async function lookup(icao: string, opts: { query?: string; topic?: string } = {}): Promise<Record<string, unknown>> {
  const code = icaoOf(icao);
  let q = String(opts.query || "").trim();
  const topic = String(opts.topic || "").trim().toLowerCase();
  if (!q && (topic === "rffs" || topic === "cat")) q = "RFFS";
  if (!q && topic && topic !== "all") q = opts.topic!.trim();
  const out: Record<string, unknown> = {
    ok: false, icao: code, query: q, cat: "", hours: "", cat_line: "", headline: "",
    snippet: "", hits: [], found: false, source: "", url: "", portal: "", note: "",
    pdf: "", view: "", cycle: "", error: "",
  };
  if (!ICAO_RE.test(code)) {
    out.error = "Nhập mã ICAO 4 chữ (vd RKSI, YBBN).";
    return out;
  }
  let doc: Doc;
  try {
    doc = await fetchAd(code);
  } catch (exc) {
    out.error = String((exc as Error).message || exc);
    out.note = "Chưa có link AIP trong sổ account.";
    return out;
  }
  const text = doc.kind === "pdf" ? "" : doc.text;
  const parsed = parseRffs(text);
  const hits = q ? findHits(text, q) : [];
  const rffsQ = !q || RFFS_QUERY.test(q);
  let finalHits = hits;
  if (!hits.length && parsed.snippet && rffsQ) finalHits = [{ term: "RFFS", snippet: parsed.snippet }];
  out.ok = true;
  Object.assign(out, parsed);
  out.hits = finalHits;
  out.source = code.startsWith("Y") ? `ERSA FAC ${code} ${doc.cycle}` : `eAIP AD 2 ${code} ${doc.cycle}`;
  out.url = doc.url;
  out.cycle = doc.cycle;
  if (doc.kind === "pdf" && code.startsWith("Y")) {
    out.pdf = `/api/aip/fac.pdf?icao=${code}`;
    out.view = out.pdf;
  } else {
    out.view = "/api/aip/view?icao=" + encodeURIComponent(code);
    if (q) out.view += "&q=" + encodeURIComponent(q);
  }
  out.headline = parsed.cat_line || (finalHits[0]?.term ?? "đã mở tờ AD");
  if (parsed.cat_line && rffsQ) {
    out.found = true;
    out.snippet = finalHits.length ? finalHits.slice(0, 3).map((h) => h.snippet).join("\n---\n") : parsed.snippet;
  } else if (finalHits.length) {
    out.snippet = finalHits.slice(0, 3).map((h) => h.snippet).join("\n---\n");
    out.found = true;
  } else if (!q) {
    out.found = true;
    out.note = "Đã mở cả tờ AD. Gõ chữ vào ô tìm nếu muốn nhảy tới mục.";
  } else {
    out.found = false;
    out.note = `Đã mở tờ AD ${code} nhưng không thấy «${q}». Cuộn trang trong khung, hoặc đổi chữ tìm.`;
    if (!out.snippet) out.snippet = parsed.snippet || "";
  }
  return out;
}
