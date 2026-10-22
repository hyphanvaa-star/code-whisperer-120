// Port of wx_overlay.py — RainViewer radar catalog passthrough + JTWC/JMA storm
// overlays as GeoJSON. Pure parsing helpers only (no server-only imports) so
// they are unit-testable; the actual `fetch()` calls live in wx.server.ts.

export const RAINVIEWER_JSON = "https://api.rainviewer.com/public/weather-maps.json";
export const JTWC_RSS = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss";
export const JTWC_HOME = "https://www.metoc.navy.mil/jtwc/jtwc.html";
export const JMA_TARGET = "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json";
export const jmaFcstUrl = (code: string) => `https://www.jma.go.jp/bosai/typhoon/data/${code}/forecast.json`;

export const UA_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: JTWC_HOME,
  Accept: "*/*",
};

export const JMA_UA_HEADERS: Record<string, string> = {
  "User-Agent": UA_HEADERS["User-Agent"],
  Referer: "https://www.jma.go.jp/bosai/typhoon/",
  Accept: "application/json,text/plain,*/*",
};

const KMZ_HREF = /https?:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/([a-z0-9]+)\.kmz/gi;

/** Danh sách URL .kmz duy nhất tìm thấy trong RSS JTWC. */
export function parseKmzUrls(rss: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  KMZ_HREF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KMZ_HREF.exec(rss || ""))) {
    const url = m[0];
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** KML AABBGGRR -> (#RRGGBB, opacity 0..1). */
export function kmlColor(raw: string | null | undefined): [string, number] {
  const s = String(raw || "").replace(/[^0-9A-Fa-f]/g, "");
  if (s.length !== 8) return ["#ff00ff", 1.0];
  const aa = s.slice(0, 2), bb = s.slice(2, 4), gg = s.slice(4, 6), rr = s.slice(6, 8);
  return [`#${rr}${gg}${bb}`.toLowerCase(), parseInt(aa, 16) / 255.0];
}

const FCST_WHEN = /^(\d{1,2})\/(\d{2})Z/;
const KTS = /(\d+)\s*knots?/i;

function fcstDay(name: string): number | null {
  const m = FCST_WHEN.exec((name || "").trim());
  return m ? parseInt(m[1], 10) : null;
}

/** "03/06Z (TS … - 40 knots)" -> "03/06Z, 40KTS". */
export function fcstLabel(name: string): string {
  const raw = (name || "").trim();
  const m = FCST_WHEN.exec(raw);
  if (!m) return "";
  const when = `${String(parseInt(m[1], 10)).padStart(2, "0")}/${m[2]}Z`;
  const k = KTS.exec(raw);
  return k ? `${when}, ${k[1]}KTS` : when;
}

/** "2026-09-20T09:00:00Z" -> "20/09Z". */
export function zuluLabel(utc: string): string {
  const m = /-(\d{2})T(\d{2}):/.exec(utc || "");
  if (!m) return "";
  return `${String(parseInt(m[1], 10)).padStart(2, "0")}/${m[2]}Z`;
}

export type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

function coordsOf(text: string): number[][] {
  const pts: number[][] = [];
  for (const item of (text || "").trim().split(/\s+/).filter(Boolean)) {
    const parts = item.split(",");
    if (parts.length < 2) continue;
    const lon = parseFloat(parts[0] ?? "");
    const lat = parseFloat(parts[1] ?? "");
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
    pts.push([lon, lat]);
  }
  return pts;
}

function localName(tag: string): string {
  return tag.includes("}") ? tag.split("}").pop()! : tag;
}

type XEl = { tag: string; attrs: Record<string, string>; children: XEl[]; text: string };

/** Minimal XML parser — enough for the flat KML we read (no namespaces of note,
 *  no CDATA tricks). Mirrors what ElementTree gives web.py for this feed. */
function parseXml(xml: string): XEl {
  let i = 0;
  const n = xml.length;
  function skipMisc() {
    while (i < n) {
      if (xml.startsWith("<?", i)) { i = xml.indexOf("?>", i) + 2; continue; }
      if (xml.startsWith("<!--", i)) { i = xml.indexOf("-->", i) + 3; continue; }
      if (xml.startsWith("<!", i)) { i = xml.indexOf(">", i) + 1; continue; }
      if (/\s/.test(xml[i] ?? "")) { i++; continue; }
      break;
    }
  }
  function decode(s: string): string {
    return s
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  function parseElement(): XEl | null {
    skipMisc();
    if (xml[i] !== "<") return null;
    const tagMatch = /^<([a-zA-Z0-9_:.-]+)/.exec(xml.slice(i));
    if (!tagMatch) return null;
    const tag = tagMatch[1] ?? "";
    i += tagMatch[0].length;
    const attrs: Record<string, string> = {};
    while (true) {
      const rest = xml.slice(i);
      const attrMatch = /^\s+([a-zA-Z0-9_:.-]+)\s*=\s*"([^"]*)"/.exec(rest);
      if (attrMatch) {
        attrs[attrMatch[1] ?? ""] = decode(attrMatch[2] ?? "");
        i += attrMatch[0].length;
        continue;
      }
      break;
    }
    while (/\s/.test(xml[i] ?? "")) i++;
    if (xml.startsWith("/>", i)) {
      i += 2;
      return { tag, attrs, children: [], text: "" };
    }
    if (xml[i] !== ">") return { tag, attrs, children: [], text: "" };
    i++;
    const children: XEl[] = [];
    let text = "";
    while (i < n) {
      if (xml.startsWith("</", i)) {
        i = xml.indexOf(">", i) + 1;
        break;
      }
      if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        text += xml.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (xml[i] === "<") {
        const child = parseElement();
        if (child) children.push(child);
        continue;
      }
      const next = xml.indexOf("<", i);
      text += xml.slice(i, next === -1 ? n : next);
      i = next === -1 ? n : next;
    }
    return { tag, attrs, children, text: decode(text).trim() };
  }
  return parseElement() ?? { tag: "", attrs: {}, children: [], text: "" };
}

function child(el: XEl, name: string): XEl | null {
  return el.children.find((c) => localName(c.tag) === name) ?? null;
}
function children(el: XEl, name: string): XEl[] {
  return el.children.filter((c) => localName(c.tag) === name);
}
function text(el: XEl | null): string {
  return el ? el.text : "";
}

type KmlStyle = Record<string, unknown>;

function collectStyles(root: XEl): Record<string, KmlStyle> {
  const styles: Record<string, KmlStyle> = {};
  const maps: Array<[string, string]> = [];
  function walk(el: XEl) {
    const tag = localName(el.tag);
    if (tag === "Style") {
      const sid = (el.attrs.id || "").trim();
      const st: KmlStyle = {};
      const ls = child(el, "LineStyle");
      if (ls) {
        const [col, op] = kmlColor(text(child(ls, "color")));
        st.stroke = col;
        st.strokeOpacity = op;
        const w = text(child(ls, "width"));
        st.strokeWidth = w ? parseFloat(w) || 2 : 2;
      }
      const ps = child(el, "PolyStyle");
      if (ps) {
        if (text(child(ps, "fill")) === "0") {
          st.fillOpacity = 0.0;
        } else {
          const rawC = text(child(ps, "color"));
          if (rawC) {
            const [col, op] = kmlColor(rawC);
            st.fill = col;
            st.fillOpacity = op;
          }
        }
        if (text(child(ps, "outline")) === "0") st.strokeOpacity = 0.0;
      }
      const ico = child(el, "IconStyle");
      if (ico) {
        const href = text(child(child(ico, "Icon") ?? ico, "href"));
        if (href) st.icon = href;
        const sc = text(child(ico, "scale"));
        st.iconScale = sc ? parseFloat(sc) || 1.0 : 1.0;
      }
      if (sid) {
        styles["#" + sid] = st;
        styles[sid] = st;
      }
    } else if (tag === "StyleMap") {
      const sid = (el.attrs.id || "").trim();
      for (const pair of children(el, "Pair")) {
        if (text(child(pair, "key")).toLowerCase() === "normal") {
          maps.push(["#" + sid, text(child(pair, "styleUrl"))]);
          maps.push([sid, text(child(pair, "styleUrl"))]);
        }
      }
    }
    for (const c of el.children) walk(c);
  }
  walk(root);
  for (const [src, dst] of maps) {
    if (src && dst) styles[src] = { ...(styles[dst] ?? styles[dst.replace(/^#/, "")] ?? {}) };
  }
  return styles;
}

function geomFeatures(el: XEl, props: Record<string, unknown>): GeoFeature[] {
  const tag = localName(el.tag);
  const feats: GeoFeature[] = [];
  if (tag === "Point") {
    const pts = coordsOf(text(child(el, "coordinates")));
    if (pts.length) {
      feats.push({ type: "Feature", properties: { ...props }, geometry: { type: "Point", coordinates: pts[0] } });
    }
  } else if (tag === "LineString") {
    const pts = coordsOf(text(child(el, "coordinates")));
    if (pts.length >= 2) {
      feats.push({ type: "Feature", properties: { ...props }, geometry: { type: "LineString", coordinates: pts } });
    }
  } else if (tag === "Polygon") {
    const outer = child(el, "outerBoundaryIs");
    const ring = outer ? child(outer, "LinearRing") : child(el, "LinearRing");
    const pts = ring ? coordsOf(text(child(ring, "coordinates"))) : [];
    if (pts.length >= 3) {
      if (pts[0]?.[0] !== pts[pts.length - 1]?.[0] || pts[0]?.[1] !== pts[pts.length - 1]?.[1]) {
        pts.push([...(pts[0] ?? [])]);
      }
      feats.push({ type: "Feature", properties: { ...props }, geometry: { type: "Polygon", coordinates: [pts] } });
    }
  } else if (["MultiGeometry", "Placemark", "Folder", "Document"].includes(tag)) {
    for (const c of el.children) feats.push(...geomFeatures(c, props));
  }
  return feats;
}

/** Tương đương wx_overlay.kml_features(): KML text -> GeoJSON Feature[]. */
export function kmlFeatures(kml: string): GeoFeature[] {
  const root = parseXml(kml);
  const styles = collectStyles(root);
  const feats: GeoFeature[] = [];
  function walk(el: XEl, storm = "", folder = "") {
    const tag = localName(el.tag);
    if (tag === "Folder" || tag === "Document") {
      const name = text(child(el, "name"));
      let nstorm = storm, nfolder = folder;
      if (tag === "Folder" && name) {
        const low = name.toLowerCase();
        if (!low.includes("previous best track") && low !== "forecast") nstorm = name;
        nfolder = name;
      }
      for (const c of el.children) walk(c, nstorm, nfolder);
      return;
    }
    if (tag === "Placemark") {
      const name = text(child(el, "name"));
      const href = text(child(el, "styleUrl"));
      const st = { ...(styles[href] ?? styles[href.replace(/^#/, "")] ?? {}) };
      const props: Record<string, unknown> = { name, storm, folder, ...st };
      const lab = fcstLabel(name);
      if (lab) props.label = lab;
      const kt = KTS.exec(name);
      if (kt) props.kts = Number(kt[1]);
      if (folder.toLowerCase() === "forecast") props.track = "fcst";
      feats.push(...geomFeatures(el, props));
      return;
    }
    for (const c of el.children) walk(c, storm, folder);
  }
  walk(root);
  return feats;
}

/** Bỏ best-track ngày cũ; forecast giữ điểm + nhãn tau, chỉ 1 bộ vòng gió. */
export function todayFeatures(feats: GeoFeature[], asOf?: Date): GeoFeature[] {
  const day = (asOf ?? new Date()).getUTCDate();
  const groups: GeoFeature[][] = [];
  let buf: GeoFeature[] = [];
  let key: string | null = null;
  for (const f of feats) {
    const storm = String(f.properties.storm ?? "");
    if (key === null) key = storm;
    if (storm !== key) {
      groups.push(buf);
      buf = [f];
      key = storm;
    } else {
      buf.push(f);
    }
  }
  if (buf.length) groups.push(buf);
  const out: GeoFeature[] = [];
  for (const g of groups) out.push(...todayStorm(g, day));
  for (const f of out) {
    delete f.properties.folder;
    delete f.properties.storm;
  }
  return out;
}

function todayStorm(feats: GeoFeature[], day: number): GeoFeature[] {
  const rest: GeoFeature[] = [];
  const fcst: GeoFeature[] = [];
  let anyFolder = false;
  for (const f of feats) {
    const fol = String(f.properties.folder ?? "");
    const low = fol.toLowerCase();
    if (fol) anyFolder = true;
    if (low.includes("previous best track")) { f.properties.track = "past"; rest.push(f); continue; }
    if (low === "forecast") fcst.push(f);
    else rest.push(f);
  }
  if (!anyFolder) return feats;
  const dated = fcst.filter(
    (f) => f.geometry.type === "Point" && fcstDay(String(f.properties.name ?? "")) !== null,
  );
  const todayPts = dated.filter((f) => fcstDay(String(f.properties.name ?? "")) === day);
  const first = (todayPts.length ? todayPts : dated)[0] ?? null;
  const keepPt = new Set(dated);
  void first;
  let when = "";
  const picked: GeoFeature[] = [];
  for (const f of fcst) {
    const kind = f.geometry.type;
    const name = String(f.properties.name ?? "");
    const dd = fcstDay(name);
    if (kind === "Point" && dd !== null) {
      when = fcstLabel(name).split(",")[0] ?? "";
      if (keepPt.has(f)) picked.push(f);
      continue;
    }
    if (kind === "Polygon" && name.toUpperCase().includes("RADIUS")) {
      // Mỗi mốc dự báo giữ đủ vòng 34/50/64 KT như bản đồ JTWC.
      const kt = /(\d+)\s*KT/i.exec(name);
      f.properties.radii = kt ? Number(kt[1]) : 34;
      f.properties.when = when;
      f.properties.name = `${when} · bán kính gió ${f.properties.radii} KT`;
      picked.push(f);
      continue;
    }
    if (kind === "Polygon" && /swath/i.test(name)) f.properties.swath = true;
    picked.push(f);
  }
  return [...rest, ...picked];
}

function lonlat(pt: unknown): [number, number] | null {
  if (!Array.isArray(pt) || pt.length < 2) return null;
  const lat = Number(pt[0]);
  const lon = Number(pt[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return [lon, lat];
}

/** JMA bosai forecast.json -> GeoJSON (track, tâm, vòng gió). */
export function jmaFeatures(fcst: Array<Record<string, unknown>>, cat = ""): GeoFeature[] {
  const title = (fcst.find((x) => x.part === "title") ?? {}) as Record<string, unknown>;
  const name = String(((title.name as Record<string, unknown> | undefined)?.en as string | undefined) ?? "").trim() || "TC";
  const kind = (cat || "TC").trim().toUpperCase();
  const storm = `${kind} ${name}`.trim();
  const feats: GeoFeature[] = [];
  const line: number[][] = [];
  for (const part of fcst) {
    const p = part as Record<string, unknown>;
    const c = p.coord as Record<string, unknown> | undefined;
    if (!c) continue;
    const center = lonlat(c.center);
    if (!center) continue;
    if (p.part === "track" || p.part === "exactTrack") line.push(center);
    if (p.part === "forecast" || p.part === "exactTrack" || p.part === "track") {
      const at = String(p.time ?? p.initialTime ?? "");
      const label = zuluLabel(at);
      feats.push({
        type: "Feature",
        properties: { name: label, storm, folder: "forecast", label },
        geometry: { type: "Point", coordinates: center },
      });
    }
  }
  const lineFeat = line.length >= 2
    ? { type: "Feature" as const, properties: { name: "track", storm, folder: "track" }, geometry: { type: "LineString", coordinates: line } }
    : null;
  return lineFeat ? [lineFeat, ...feats] : feats;
}
