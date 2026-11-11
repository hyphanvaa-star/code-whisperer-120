// Browser-safe parsing for the AIMS "Daily Flight Schedule" (DAYREP) report.
// The server client in `aims.server.ts` does the HTTP; everything here is pure
// so the request shapes can be tested without an AIMS session.

export type DayrepPage = {
  uid: string;
  scen: string;
  token: string;
  params: Record<string, unknown>;
};

/** Reads session id, anti-forgery token and the user's saved report settings from /AIMS/DAYREP. */
export function parseDayrepPage(html: string): DayrepPage | null {
  const s = html.match(/\$USER_SESSION\s*=\s*\{\s*uid\s*:\s*'([^']*)'\s*,\s*scen\s*:\s*'([^']*)'/);
  const t = html.match(/name=["']?__RequestVerificationToken["']?\s+type=["']?hidden["']?\s+value=["']?([^"'\s>]+)/);
  const marker = "var dayRepViewParameters=";
  const i = html.indexOf(marker);
  if (!s || !t || i < 0) return null;
  const params = readJsonAt(html, i + marker.length);
  if (!params || typeof params !== "object" || !("DayRepState" in params)) return null;
  return { uid: s[1] ?? "", scen: s[2] ?? "", token: t[1] ?? "", params: params as Record<string, unknown> };
}

/** Reads one JSON object literal starting at `start` (string-aware brace matching). */
export function readJsonAt(text: string, start: number): unknown {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-11" → "2026/11/11 00:00" (AIMS server date format). */
export function aimsDate(iso: string): string {
  const m = iso.match(ISO_DATE);
  if (!m) throw new Error(`Ngày không hợp lệ: ${iso}`);
  return `${m[1]}/${m[2]}/${m[3]} 00:00`;
}

/** Vietnam calendar date (UTC+7) for `now`, plus `addDays`. */
export function vnDate(now: Date, addDays = 0): string {
  const d = new Date(now.getTime() + 7 * 3600_000 + addDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * The RunReport body: the user's own saved DAYREP settings (columns, crew
 * display, time range) with only the date range replaced, so the export
 * matches what they download by hand.
 */
export function buildRunParams(saved: Record<string, unknown>, start: string, end: string): Record<string, unknown> {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) throw new Error("Ngày không hợp lệ");
  if (start > end) throw new Error("Ngày bắt đầu phải trước ngày kết thúc");
  const days = (Date.parse(end) - Date.parse(start)) / 86400_000;
  if (days > 7) throw new Error("Chỉ tải tối đa 7 ngày một lần");
  const params = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
  const state = (params["DayRepState"] ?? {}) as Record<string, unknown>;
  const main = (state["mainParameters"] ?? {}) as Record<string, unknown>;
  main["DateRange"] = { start: aimsDate(start), end: aimsDate(end) };
  state["mainParameters"] = main;
  state["TaskId"] = null;
  const out = (state["outputParameters"] ?? {}) as Record<string, unknown>;
  out["ExportCSV"] = false;
  state["outputParameters"] = out;
  params["DayRepState"] = state;
  return params;
}

export type AimsTask = { status: number; progress: number; link: string; error: string };

/** Finds our task in a /progressfilter reply. status 3 = done, 2 = cancelled/failed. */
export function findTask(reply: unknown, taskId: string): AimsTask | null {
  if (!Array.isArray(reply)) return null;
  const it = reply.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === taskId) as Record<string, unknown> | undefined;
  if (!it) return null;
  return {
    status: Number(it["status"]) || 0,
    progress: Number(it["progress"]) || 0,
    link: typeof it["link"] === "string" ? (it["link"] as string) : "",
    error: typeof it["error"] === "string" ? (it["error"] as string) : "",
  };
}

/** DevExpress viewer page → reportId. */
export function parseViewerReportId(html: string): string {
  const m = html.match(/var viewerModel=\{"reportId":"([0-9a-f]+)"/) ?? html.match(/"reportId":"([0-9a-f]{16,})"/);
  return m?.[1] ?? "";
}

export const AIMS_EXPORT_OPTIONS =
  '{"Csv":{"@EncodingType":"UTF8","@SkipEmptyColumns":"false"},"Html":{"@EmbedImagesInHTML":"true"},"Text":{"@EncodingType":"UTF8"}}';

export function startBuildArg(reportId: string): string {
  return JSON.stringify({ reportId, reportUrl: "", drillDownKeys: [], sortingState: [], timeZoneOffset: 0, parameters: {}, editingFieldValues: [] });
}

export function exportArg(documentId: string): string {
  return JSON.stringify({ documentId, exportOptions: AIMS_EXPORT_OPTIONS, format: "xlsx", editingFieldValues: [] });
}

/** Crewlist file name: never contains "VER n", so FPL/Crewlist pairing keeps it on the Crewlist side. */
export function aimsFileName(start: string, end: string, now: Date): string {
  const hm = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(11, 16).replace(":", "h");
  const d = (s: string) => s.slice(8, 10) + s.slice(5, 7);
  return `AIMS ${d(start)}-${d(end)} ${hm}.xlsx`;
}
