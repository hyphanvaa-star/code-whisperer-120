// Port of handover.py — "Bảng giao ca" JSON store + Excel export (sheet
// CHUYẾN BAY / NOTE layout). xlsx generation uses exceljs instead of openpyxl.
import { VJ_LOGO_PNG_BASE64 } from "./vj_logo_base64";

export interface HandoverFlight {
  key: string;
  callsign: string;
  dep: string;
  arr: string;
  ac: string;
  std: string;
  sta: string;
  payload: string;
  extra: string;
  atc: string;
  ezfw: string;
  atfm: string;
  note: string;
}

export interface HandoverData {
  shift: string;
  date: string;
  from_dsp: string;
  to_dsp: string;
  flights: HandoverFlight[];
}

export const HEADERS = [
  "CHUYẾN BAY",
  "DEP",
  "ARR",
  "A/C",
  "STD",
  "STA",
  "PAYLOAD",
  "EXTRA FUEL",
  "ATC FILING",
  "EZFW",
  "ATFM FILLING",
  "NOTE",
] as const;

export const COL_WIDTHS = [14, 10, 10, 10, 12, 12, 12, 14, 14, 12, 16, 40] as const;

export const FLIGHT_KEYS = [
  "key", "callsign", "dep", "arr", "ac", "std", "sta",
  "payload", "extra", "atc", "ezfw", "atfm", "note",
] as const;

export function empty(): HandoverData {
  return {
    shift: "MORNING SHIFT",
    date: "",
    from_dsp: "",
    to_dsp: "",
    flights: [],
  };
}

function normShift(value: unknown): string {
  const text = String(value ?? "").trim().toUpperCase().replace(/_/g, " ");
  if (text === "NIGHT SHIFT" || text === "NIGHT" || text === "CA 2" || text === "CA2") return "NIGHT SHIFT";
  return "MORNING SHIFT";
}

function cleanFlight(row: unknown): HandoverFlight | null {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const out = {} as Record<(typeof FLIGHT_KEYS)[number], string>;
  for (const k of FLIGHT_KEYS) out[k] = String(r[k] ?? "").trim();
  if (!FLIGHT_KEYS.some((k) => k !== "key" && out[k])) return null;
  if (!out.key) {
    const cs = out.callsign.toUpperCase().replace(/\s+/g, "");
    out.key = `${cs}|${out.std}`;
  }
  return out as HandoverFlight;
}

export function normalize(payload: unknown): HandoverData {
  const data = empty();
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return data;
  const p = payload as Record<string, unknown>;
  data.shift = normShift(p["shift"]);
  data.date = String(p["date"] ?? "").trim();
  data.from_dsp = String(p["from_dsp"] ?? "").trim();
  data.to_dsp = String(p["to_dsp"] ?? "").trim();
  const flights: HandoverFlight[] = [];
  const seen = new Set<string>();
  const rawFlights = Array.isArray(p["flights"]) ? p["flights"] : [];
  for (const row of rawFlights) {
    const item = cleanFlight(row);
    if (!item) continue;
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    flights.push(item);
  }
  data.flights = flights;
  return data;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function utcStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function utcStampCompact(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** Port of handover.xlsx_bytes — logo trái, MORNING/NIGHT SHIFT HANDOVER phải, header dòng 3. */
export async function xlsxBytes(payload: unknown): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const data = normalize(payload);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  const thin = { style: "thin" as const, color: { argb: "FF9AA3AD" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  const title = `${data.shift} HANDOVER`;
  ws.mergeCells("I1:L2");
  const titleCell = ws.getCell("I1");
  titleCell.value = title;
  titleCell.font = { name: "Calibri", bold: true, size: 18, color: { argb: "FFC62A72" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells("A1:C2");
  const logoCell = ws.getCell("A1");
  logoCell.value = "vietjetAir.com";
  logoCell.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFC62A72" } };
  logoCell.alignment = { horizontal: "left", vertical: "middle" };
  try {
    const id = wb.addImage({ base64: VJ_LOGO_PNG_BASE64, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 46 } });
    logoCell.value = "";
  } catch {
    // keep text fallback
  }

  const meta: string[] = [];
  if (data.date) meta.push(data.date);
  if (data.from_dsp || data.to_dsp) {
    meta.push(`Giao: ${data.from_dsp || "—"}  →  Nhận: ${data.to_dsp || "—"}`);
  }
  ws.mergeCells("D1:H2");
  const metaCell = ws.getCell("D1");
  metaCell.value = meta.join("\n");
  metaCell.alignment = { wrapText: true, vertical: "middle" };

  const headFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F4F6" } };
  HEADERS.forEach((header, idx) => {
    const col = idx + 1;
    const cell = ws.getCell(3, col);
    cell.value = header;
    cell.font = { name: "Calibri", bold: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = headFill;
    cell.border = border;
    ws.getColumn(col).width = COL_WIDTHS[idx];
  });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;
  ws.getRow(3).height = 28;

  const rows = [...data.flights];
  const blank = (): HandoverFlight => {
    const out = {} as Record<(typeof FLIGHT_KEYS)[number], string>;
    for (const k of FLIGHT_KEYS) out[k] = "";
    return out as HandoverFlight;
  };
  while (rows.length < 24) rows.push(blank());

  rows.forEach((row, offset) => {
    const r = 4 + offset;
    const values = [
      row.callsign || "",
      row.dep || "",
      row.arr || "",
      row.ac || "",
      row.std || "",
      row.sta || "",
      row.payload || "",
      row.extra || "",
      row.atc || "",
      row.ezfw || "",
      row.atfm || "",
      row.note || "",
    ];
    values.forEach((value, idx) => {
      const col = idx + 1;
      const cell = ws.getCell(r, col);
      cell.value = value;
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = { horizontal: col < 12 ? "center" : "left", vertical: "middle", wrapText: true };
      cell.border = border;
    });
    ws.getRow(r).height = 20;
  });

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 3 }];
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 1;
  ws.pageSetup.printTitlesRow = "1:3";
  const stamp = data.date || utcStamp();
  ws.headerFooter.oddHeader = `&L&"Calibri"vietjetAir.com&R&"Calibri"${stamp}`;

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Port of handover.xlsx_filename. */
export function xlsxFilename(payload: unknown): string {
  const data = normalize(payload);
  const digits = data.date.replace(/[^0-9]/g, "").slice(0, 8);
  const day = digits || utcStampCompact();
  const ca = data.shift === "NIGHT SHIFT" ? "NIGHT" : "MORNING";
  return `${ca}_SHIFT_HANDOVER_${day}.xlsx`;
}
