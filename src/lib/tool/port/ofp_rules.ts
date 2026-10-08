// "OFP check data" — bảng luật dispatcher tự chỉnh trong tab KHB; nút OFP trên
// header đọc bảng này khi kiểm OFP. Luật "waypoint_time": giờ tới điểm (ETD +
// CTIME cộng dồn trong OFP) phải trước giờ giới hạn, có buffer cảnh báo sớm.

export type OfpRule = {
  id: string;
  name: string; // NỘI DUNG
  condition: string; // ĐIỀU KIỆN
  note: string; // NOTE
  type: "info" | "waypoint_time";
  waypoints?: string[]; // KAPLI, ENVAR
  limit_utc?: string; // "1700"
  buffer_min?: number; // 15
  scope?: "all" | "intl" | "domestic";
  enabled?: boolean;
};

export const DEFAULT_OFP_RULES: OfpRule[] = [
  { id: "lim_ac", name: "LIMIT TÀU", condition: "giới hạn liên quan đến FL - hay penalty - …", note: "CHECK TRONG TAB GIỚI HẠN", type: "info", enabled: true },
  { id: "lim_apt", name: "LIMIT SÂN BAY", condition: "vô các khoảng thời gian đóng cửa hay curfew", note: "CHECK TRONG TAB GIỚI HẠN", type: "info", enabled: true },
  { id: "lim_sp", name: "LIMIT ĐẶC BIỆT", condition: "các sân bay dự bị A333 hay các giới hạn đặc biệt khác", note: "CHECK TRONG TAB GIỚI HẠN", type: "info", enabled: true },
  {
    id: "kapli_envar", name: "KAPLI/ENVAR", condition: "TIME TO KAPLI < 1700Z ( BUFFER 15M)",
    note: "giá trị thời gian trong ofp tới điểm kapli phải bé hơn 1700z , buffer 15 phút là 1645z là phải warning lên",
    type: "waypoint_time", waypoints: ["KAPLI"], limit_utc: "1700", buffer_min: 15, scope: "all", enabled: true,
  },
];

export function cleanOfpRules(rows: unknown[]): OfpRule[] {
  const out: OfpRule[] = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const s = (k: string) => String(o[k] ?? "").trim();
    const name = s("name");
    if (!name) return;
    const wps = (Array.isArray(o["waypoints"]) ? (o["waypoints"] as unknown[]).map(String) : s("waypoints").split(/[\s,/;]+/))
      .map((w) => w.trim().toUpperCase()).filter((w) => /^[A-Z0-9]{2,7}$/.test(w));
    const lim = s("limit_utc").replace(/[^0-9]/g, "").padStart(4, "0").slice(-4);
    const type = s("type") === "waypoint_time" || (wps.length && /^\d{4}$/.test(lim) && lim !== "0000") ? "waypoint_time" : "info";
    const scope = (["all", "intl", "domestic"].includes(s("scope")) ? s("scope") : "all") as OfpRule["scope"];
    out.push({
      id: s("id") || `r${i}_${Date.now().toString(36)}`,
      name, condition: s("condition"), note: s("note"), type,
      ...(type === "waypoint_time" ? { waypoints: wps, limit_utc: lim, buffer_min: Math.max(0, Number(o["buffer_min"]) || 0), scope } : {}),
      enabled: o["enabled"] !== false,
    } as OfpRule);
  });
  return out;
}

/** CTIME cộng dồn (phút) tới từng điểm trong bảng nav log của OFP + ETD (HHMM). */
export function parseWaypointTimes(text: string): { etd: string | null; wpts: Record<string, number> } {
  const etdM = /ETD\/ETA\s+(\d{4})Z/i.exec(text) || /\bETD\s+(\d{4})Z/i.exec(text);
  const lines = text.split(/\r?\n/);
  const wpts: Record<string, number> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const m = /^\s*\S+\s+([A-Z][A-Z0-9]{1,6})\/?\s+\d/.exec(lines[i]!);
    if (!m) continue;
    const next = lines[i + 1]!;
    if (!/^\s*[NS]\d{4,5}[EW]\d{5,6}\b/.test(next)) continue;
    const t = /\s(\d{1,2})\/(\d{2})\s+\d{3,6}\/[.\d]*\s*$/.exec(next);
    if (!t) continue;
    const name = m[1]!;
    if (!(name in wpts)) wpts[name] = Number(t[1]) * 60 + Number(t[2]);
  }
  return { etd: etdM ? etdM[1]! : null, wpts };
}

type Warn = { kind: string; text: string; severity: string; check: string; evidence: string; defect: string; limit: string };
const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0");
};

/** Áp luật waypoint_time lên dữ liệu OFP đã đọc (w.etd, w.wpts). */
export function checkOfpRules(
  f: { dep?: string | null; dest?: string | null; dep_icao?: string | null; dest_icao?: string | null },
  rules: OfpRule[],
  w: Record<string, unknown>,
): Warn[] {
  const out: Warn[] = [];
  const etd = String(w["etd"] || "");
  const wpts = (w["wpts"] || {}) as Record<string, number>;
  if (!/^\d{4}$/.test(etd)) return out;
  const etdMin = Number(etd.slice(0, 2)) * 60 + Number(etd.slice(2));
  const dep = String(f.dep_icao || f.dep || ""), dest = String(f.dest_icao || f.dest || "");
  const domestic = dep.startsWith("VV") && dest.startsWith("VV");
  for (const r of rules) {
    if (r.enabled === false || r.type !== "waypoint_time" || !r.limit_utc) continue;
    if (r.scope === "intl" && domestic) continue;
    if (r.scope === "domestic" && !domestic) continue;
    const lim = Number(r.limit_utc.slice(0, 2)) * 60 + Number(r.limit_utc.slice(2));
    const buf = r.buffer_min || 0;
    for (const wp of r.waypoints || []) {
      if (!(wp in wpts)) continue;
      const abs = etdMin + wpts[wp]!;
      // Giờ tới điểm so với giới hạn trong cùng ngày UTC của ETD.
      const at = abs % 1440;
      const ev = `ETD ${etd}Z + ${Math.floor(wpts[wp]! / 60)}:${String(wpts[wp]! % 60).padStart(2, "0")} → ${wp} ${hhmm(abs)}Z`;
      const cond = `${r.name}: ${wp} phải trước ${r.limit_utc}Z`;
      if (at >= lim) {
        out.push({ kind: "ofp_rule", text: `${cond} — OFP tới ${wp} lúc ${hhmm(abs)}Z (VI PHẠM)`, severity: "critical", check: "ofp", evidence: ev, defect: "", limit: r.condition || r.name });
      } else if (at >= lim - buf) {
        out.push({ kind: "ofp_rule", text: `${cond} — OFP tới ${wp} lúc ${hhmm(abs)}Z, trong buffer ${buf}' (từ ${hhmm(lim - buf)}Z)`, severity: "warning", check: "ofp", evidence: ev, defect: "", limit: r.condition || r.name });
      }
    }
  }
  return out;
}
