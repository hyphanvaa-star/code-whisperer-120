// Port of excelcmp/reader.py. Reads xlsx/xlsm/csv into plain Sheet tables and
// finds the header row. No pandas/pyxlsb in a Worker: .xlsb is not supported
// here (exceljs only reads xlsx/csv) — callers should report that in Vietnamese.
export class ExcelError extends Error {}

export interface Sheet {
  name: string;
  header: string[];
  rows: unknown[][];
  header_row: number; // 0-based row index in the source file
}

export const SUPPORTED = [".xlsx", ".xlsm", ".csv"] as const;

const HEADER_SCAN = 25;
const MAX_ROWS = 20000;

function clean(v: unknown): string {
  if (v == null) return "";
  return String(v).split(/\s+/).filter(Boolean).join(" ");
}

function scoreHeader(row: unknown[]): number {
  const vals = row.map(clean);
  const filled = vals.filter((v) => v);
  if (filled.length < 2) return 0;
  let texty = 0;
  for (const v of filled) {
    if (Number.isNaN(Number(v.replace(/,/g, "")))) texty++;
  }
  const unique = new Set(filled.map((v) => v.toLowerCase())).size;
  return texty * 2 + unique + filled.length;
}

function dedupe(header: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  header.forEach((h, i) => {
    let name = h || `col${i + 1}`;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      name = `${name}_${n}`;
    } else {
      seen.set(key, 1);
    }
    out.push(name);
  });
  return out;
}

function toSheet(name: string, rows: unknown[][]): Sheet | null {
  if (!rows.length) return null;
  let bestI = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN); i++) {
    const s = scoreHeader(rows[i] ?? []);
    if (s > bestScore) {
      bestI = i;
      bestScore = s;
    }
  }
  if (bestScore <= 0) return null;
  const header = dedupe((rows[bestI] ?? []).map(clean));
  const body = rows.slice(bestI + 1).filter((r) => r.some((v) => clean(v)));
  return { name, header, rows: body, header_row: bestI };
}

function sniffDelimiter(sample: string): string {
  const cands = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const c of cands) {
    const count = sample.split("\n")[0]?.split(c).length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function decodeCsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Try utf-8 (with/without BOM); fall back to latin-1.
  try {
    let start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

async function rawXlsx(buf: ArrayBuffer): Promise<Array<[string, unknown[][]]>> {
  const ExcelJS = await (await import("@/lib/exceljs-load")).loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: Array<[string, unknown[][]]> = [];
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    let i = 0;
    ws.eachRow({ includeEmpty: true }, (row) => {
      if (i >= MAX_ROWS) return;
      const vals: unknown[] = [];
      const cellCount = Math.max(row.cellCount, ws.columnCount);
      for (let c = 1; c <= cellCount; c++) {
        const cell = row.getCell(c);
        let v: unknown = cell.value;
        if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
          v = (v as Record<string, unknown>)["result"];
        } else if (v && typeof v === "object" && "text" in (v as Record<string, unknown>)) {
          v = (v as Record<string, unknown>)["text"];
        }
        vals.push(v === undefined ? null : v);
      }
      rows.push(vals);
      i++;
    });
    out.push([ws.name, rows]);
  });
  return out;
}

function rawCsv(name: string, buf: ArrayBuffer): Array<[string, unknown[][]]> {
  const text = decodeCsv(buf);
  const sample = text.slice(0, 8192);
  const delim = sniffDelimiter(sample);
  const rows = parseCsv(text, delim).slice(0, MAX_ROWS);
  return [[name, rows]];
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function stemOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

/** Read every sheet with recognisable tabular data from an uploaded file's bytes. */
export async function readTable(filename: string, buf: ArrayBuffer): Promise<Sheet[]> {
  const ext = extOf(filename);
  if (!(SUPPORTED as readonly string[]).includes(ext)) {
    throw new ExcelError(`Không hỗ trợ đuôi '${ext}'. Chỉ nhận: ${SUPPORTED.join(", ")}`);
  }
  let raw: Array<[string, unknown[][]]>;
  if (ext === ".csv") raw = rawCsv(stemOf(filename), buf);
  else raw = await rawXlsx(buf);

  const sheets: Sheet[] = [];
  for (const [name, rows] of raw) {
    const sh = toSheet(name, rows);
    if (sh && sh.rows.length) sheets.push(sh);
  }
  if (!sheets.length) {
    throw new ExcelError("File không có sheet nào chứa bảng dữ liệu nhận dạng được");
  }
  return sheets;
}

/** Iterate a Sheet's rows as {header: value} dicts, like Sheet.dicts() in Python. */
export function* sheetDicts(sheet: Sheet): Generator<Record<string, unknown>> {
  for (const r of sheet.rows) {
    const d: Record<string, unknown> = {};
    sheet.header.forEach((h, i) => {
      d[h] = i < r.length ? r[i] : null;
    });
    yield d;
  }
}
