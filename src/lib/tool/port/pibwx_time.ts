// Only named first-page header fields establish a PIB/WX document's time.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export type DocumentKind = "pib" | "wx";
interface HeaderTime { field: string; time: Date | null }
const utc = (y: number, month: number, day: number, hour: number, minute: number) => {
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(Date.UTC(y, month, day, hour, minute));
  return date.getUTCFullYear() === y && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
};

function headerTimes(text: string, kind?: DocumentKind): HeaderTime[] {
  // Never cross into bulletin/weather body or a subsequent page.
  const header = String(text || "").toUpperCase().split(/\f|\b(?:METAR|TAF|NOTAM)\s*(?:\r?\n|:|\b[AB]\))/)[0] ?? "";
  const isPib = kind === "pib" || (!kind && /SYSTEM\s+TIME\s*:/.test(header));
  if (isPib) {
    return ["SYSTEM TIME", "BULLETIN VALIDITY PERIOD"].map((field) => {
      const label = field.replaceAll(" ", "\\s+");
      const match = new RegExp(`\\b${label}\\s*:\\s*(\\d{2}|20\\d{2})-(\\d{2})-(\\d{2})\\s+(\\d{2}):?(\\d{2})\\b`).exec(header);
      if (!match) return { field, time: null };
      const year = Number(match[1]);
      return { field, time: utc(year < 100 ? year + 2000 : year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) };
    });
  }
  const match = /\bE\s*\.?\s*T\s*\.?\s*D\s*\.?\s*:\s*(\d{2}):?(\d{2})\s*UTC\s+(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})\b/.exec(header);
  return [{ field: "E.T.D.", time: match ? utc(Number(match[5]), MONTHS.indexOf(match[4] ?? ""), Number(match[3]), Number(match[1]), Number(match[2])) : null }];
}

/** Compatibility export: only explicit header timestamps, never inferred METAR dates. */
export function pdfTimes(text: string, _ref: Date): Date[] {
  return headerTimes(text).flatMap(({ time }) => time ? [time] : []);
}

export interface TimeCheck {
  ok: boolean;
  nearestH: number | null;
  nearest: Date | null;
  field: string;
  reason?: string;
  fields: Array<{ field: string; time: Date; deltaH: number }>;
}

/** Every required header time must be readable and within maxH of STD (UTC). */
export function checkAgainstStd(text: string, std: Date, maxH = 6, kind?: DocumentKind): TimeCheck {
  const headers = headerTimes(text, kind);
  const fields = headers.flatMap(({ field, time }) => time ? [{ field, time, deltaH: Math.abs(time.getTime() - std.getTime()) / 3600e3 }] : []);
  const missing = headers.find(({ time }) => !time);
  if (missing || !Number.isFinite(std.getTime())) {
    return { ok: false, nearestH: null, nearest: null, field: missing?.field ?? "STD", reason: `không đọc được ${missing?.field ?? "STD"}`, fields };
  }
  // Report the failing field, not a nearer unrelated date that might hide stale data.
  const selected = fields.find(({ deltaH }) => deltaH > maxH) ?? fields[fields.length - 1];
  if (!selected) return { ok: false, nearestH: null, nearest: null, field: "", fields };
  return { ok: fields.every(({ deltaH }) => deltaH <= maxH), nearestH: Math.round(selected.deltaH * 100) / 100, nearest: selected.time, field: selected.field, fields };
}
