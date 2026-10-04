// Port of defect_pdf.py — pure parsing logic + PDF text extraction (unpdf
// instead of pdfplumber/pypdf, since the Worker runtime has no Python/native
// deps). Table layout is reconstructed from the AC REG / DEFECT / ACTION
// REQUIREMENT header column positions, mirroring the python `_extract_pypdf`
// fallback since unpdf (like pypdf) only gives flat page text, not real cells.

export class DefectPdfError extends Error {}

export interface AircraftLimitRow {
  reg: string;
  defect: string;
  limit: string;
}

const AC_RE = /\b(?:VN[\s-]?)?A\s*(\d{3})\b/i;
const BLOCK_TAG_RE = /\[\s*([A-Z][A-Z0-9 /_-]*)\s*\]\s*:?/gi;

export function normAc(raw: string | null | undefined): string {
  const s = String(raw ?? "").split(/\s+/).filter(Boolean).join(" ").toUpperCase();
  const m = /^(?:VN[\s-]?)?A?[\s-]?(\d{3})$/.exec(s);
  return m ? `VN-A${m[1]}` : "";
}

export function textOf(raw: unknown, multiline = false): string {
  const value = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!multiline) return value.split(/\s+/).filter(Boolean).join(" ");
  return value
    .split("\n")
    .map((line) => line.split(/\s+/).filter(Boolean).join(" "))
    .join("\n")
    .trim();
}

function headerKey(raw: unknown): string {
  return textOf(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, "reg" | "defect" | "action"> = {
  ACREG: "reg",
  AIRCRAFTREG: "reg",
  AIRCRAFTREGISTRATION: "reg",
  DEFECT: "defect",
  DEFECTDESCRIPTION: "defect",
  ACTIONREQUIREMENT: "action",
  ACTIONREQUIREMENTS: "action",
};

export function headerColumns(row: unknown[]): Record<"reg" | "defect" | "action", number> | null {
  const found: Partial<Record<"reg" | "defect" | "action", number>> = {};
  row.forEach((cell, index) => {
    const name = HEADER_ALIASES[headerKey(cell)];
    if (name && found[name] === undefined) found[name] = index;
  });
  if (found.reg === undefined || found.defect === undefined || found.action === undefined) return null;
  return found as Record<"reg" | "defect" | "action", number>;
}

/** Chuẩn hoá một block OPS, giữ mỗi bullet thành một dòng dễ đọc. */
function opsItems(raw: string): string[] {
  let text = textOf(raw, true);
  if (!text) return [];
  // Một số backend làm mất xuống dòng nhưng vẫn giữ chuỗi `- YÊU CẦU`.
  text = text.replace(/\s+(?=-\s+[A-Z0-9])/g, "\n");
  const items: string[] = [];
  let current: string[] = [];
  const bulletRe = /^(?:[-•·●▪◦–—]|\d+[.)])\s*(.*)$/;

  const flush = () => {
    const value = current.filter(Boolean).join(" ").trim();
    if (value) items.push(value);
    current = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.split(/\s+/).filter(Boolean).join(" ").trim();
    if (!line) continue;
    const bullet = bulletRe.exec(line);
    if (bullet) {
      flush();
      current.push((bullet[1] ?? "").trim());
    } else {
      current.push(line);
    }
  }
  flush();
  return items;
}

/** Chỉ lấy nội dung các block [OPS] trong ACTION REQUIREMENT. */
export function extractOpsLimit(actionRequirement: string): string {
  const text = textOf(actionRequirement, true);
  const matches = [...text.matchAll(BLOCK_TAG_RE)];
  const requirements: string[] = [];
  const seen = new Set<string>();
  matches.forEach((match, index) => {
    const tag = (match[1] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (tag !== "OPS") return;
    const end = index + 1 < matches.length ? matches[index + 1]!.index! : text.length;
    const start = match.index! + match[0].length;
    for (const item of opsItems(text.slice(start, end))) {
      const key = item.toUpperCase().split(/\s+/).filter(Boolean).join(" ");
      if (key && !seen.has(key)) {
        seen.add(key);
        requirements.push(item);
      }
    }
  });
  return requirements.join("\n");
}

function makeRow(reg: string, defect: string, action: string): AircraftLimitRow | null {
  const normalizedReg = normAc(reg);
  if (!normalizedReg) return null;
  return { reg: normalizedReg, defect: textOf(defect), limit: extractOpsLimit(action) };
}

/** Port of `_extract_pdfplumber`, operating on already-extracted table rows
 * (array of tables, each an array of rows, each an array of cells) so it
 * stays pure / unit-testable the same way the python test mocks pdfplumber. */
export function extractFromTables(tables: unknown[][][]): AircraftLimitRow[] {
  const rows: AircraftLimitRow[] = [];
  for (const table of tables) {
    let columns: Record<"reg" | "defect" | "action", number> | null = null;
    let current: { reg: string; defect: string; action: string } | null = null;

    const flush = () => {
      if (current) {
        const item = makeRow(current.reg, current.defect, current.action);
        if (item) rows.push(item);
      }
      current = null;
    };

    for (const tableRow of table) {
      if (!tableRow || !tableRow.length) continue;
      const detected = headerColumns(tableRow);
      if (detected) {
        flush();
        columns = detected;
        continue;
      }
      if (!columns) continue;
      const cell = (name: "reg" | "defect" | "action") => {
        const index = columns![name];
        return textOf(index < tableRow.length ? tableRow[index] : "", name === "action");
      };
      const reg = cell("reg");
      const defect = cell("defect");
      const action = cell("action");
      if (normAc(reg)) {
        flush();
        current = { reg, defect, action };
      } else if (current && (defect || action)) {
        if (defect) current.defect = `${current.defect} ${defect}`.trim();
        if (action) current.action = `${current.action}\n${action}`.trim();
      }
    }
    flush();
  }
  return rows;
}

/** Port of `_extract_pypdf`: split DEFECT / ACTION REQUIREMENT by the header
 * column positions found in the flat page text (same approach unpdf gives
 * us, since it has no table/cell model). */
export function extractFromPageTexts(pages: string[]): AircraftLimitRow[] {
  const rows: AircraftLimitRow[] = [];
  for (const pageText of pages) {
    const lines = pageText.split("\n");
    let positions: { reg: number; defect: number; action: number } | null = null;
    let issuePos: number | null = null;
    let remarkPos: number | null = null;
    for (const line of lines) {
      const upper = line.toUpperCase();
      const regPos = upper.indexOf("AC REG");
      const defectPos = upper.indexOf("DEFECT");
      const actionPos = upper.indexOf("ACTION REQUIREMENT");
      if (regPos >= 0 && defectPos > regPos && actionPos > defectPos) {
        positions = { reg: regPos, defect: defectPos, action: actionPos };
        const afterReg = upper.slice(regPos);
        const issueRel = afterReg.indexOf("ISSUE DATE");
        issuePos = issueRel >= 0 ? regPos + issueRel : -1;
        const afterAction = upper.slice(actionPos);
        const remarkRel = afterAction.indexOf("REMARK");
        remarkPos = remarkRel >= 0 ? actionPos + remarkRel : -1;
        break;
      }
    }
    if (!positions) continue;

    let current: { reg: string; defect: string; action: string } | null = null;
    const flush = () => {
      if (current) {
        const item = makeRow(current.reg, current.defect, current.action);
        if (item) rows.push(item);
      }
      current = null;
    };

    for (const raw of lines) {
      if (headerKey(raw).includes("ACTIONREQUIREMENT")) continue;
      const line = raw.replace(/\s+$/, "");
      const regEnd = issuePos != null && issuePos >= 0 ? issuePos : positions.defect;
      const regCell = line.slice(positions.reg, regEnd);
      const match = AC_RE.exec(regCell);
      const defect = textOf(line.slice(positions.defect, positions.action));
      const actionEnd = remarkPos != null && remarkPos >= 0 ? remarkPos : line.length;
      const action = textOf(line.slice(positions.action, actionEnd), true);
      if (match) {
        flush();
        current = { reg: `A${match[1]}`, defect, action };
      } else if (current && (defect || action)) {
        if (defect) current.defect = `${current.defect} ${defect}`.trim();
        if (action) current.action = `${current.action}\n${action}`.trim();
      }
    }
    flush();
  }
  return rows;
}

/** Khử các record AMOS lặp nhưng giữ riêng từng defect của cùng một tàu. */
export function groupRows(rows: AircraftLimitRow[]): AircraftLimitRow[] {
  const grouped: AircraftLimitRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item: AircraftLimitRow = {
      reg: normAc(row.reg ?? ""),
      defect: textOf(row.defect ?? ""),
      limit: textOf(row.limit ?? "", true),
    };
    const key = `${item.reg}\u0000${item.defect.toUpperCase().split(/\s+/).filter(Boolean).join(" ")}\u0000${item.limit.toUpperCase().split(/\s+/).filter(Boolean).join(" ")}`;
    if (!item.reg || seen.has(key)) continue;
    seen.add(key);
    grouped.push(item);
  }
  return grouped;
}

/** Giữ output Excel cũ: một tàu / một dòng, chỉ hai cột tàu và defect. */
export function legacyExcelRows(grouped: AircraftLimitRow[]): [string, string][] {
  const byAircraft = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const row of grouped) {
    const reg = row.reg;
    const defect = row.defect;
    if (!byAircraft.has(reg)) byAircraft.set(reg, []);
    if (!seen.has(reg)) seen.set(reg, new Set());
    const key = defect.toUpperCase().split(/\s+/).filter(Boolean).join(" ");
    if (defect && !seen.get(reg)!.has(key)) {
      seen.get(reg)!.add(key);
      byAircraft.get(reg)!.push(defect);
    }
  }
  return [...byAircraft.entries()].map(([reg, defects]) => [reg, defects.join(" - ")]);
}

export interface PosItem { x: number; y: number; w: number; str: string }

/** Tách bảng theo toạ độ chữ (giống pdfplumber): cột theo tâm tiêu đề, dòng
 * theo ô AC REG gần nhất theo trục dọc (AMOS căn giữa ô nhiều dòng). */
export function extractFromPositions(pages: PosItem[][]): AircraftLimitRow[] {
  const rows: AircraftLimitRow[] = [];
  let hdr: Record<string, number> | null = null;
  for (const items0 of pages) {
    const items = items0.filter((i) => i.str.trim());
    const find = (re: RegExp) => items.find((i) => re.test(i.str.trim().toUpperCase()));
    const h = { reg: find(/^AC REG$/), issue: find(/^ISSUE DATE$/), togo: find(/^TOGO$/), defect: find(/^DEFECT$/), action: find(/^ACTION REQUIREMENTS?$/), remark: find(/^REMARKS?$/) };
    let hy = Infinity;
    if (h.reg && h.defect && h.action) {
      const c = (i?: PosItem) => (i ? i.x + i.w / 2 : NaN);
      hdr = { reg: c(h.reg), issue: c(h.issue), togo: c(h.togo), defect: c(h.defect), action: c(h.action), remark: c(h.remark) };
      hy = h.reg.y;
    }
    if (!hdr) continue;
    const H = hdr;
    const regHi = Number.isNaN(H.issue) ? (H.reg + H.defect) / 2 : (H.reg + H.issue) / 2;
    const defLo = Number.isNaN(H.togo) ? H.defect - 60 : (H.togo + H.defect) / 2;
    const defHi = (H.defect + H.action) / 2;
    const actHi = Number.isNaN(H.remark) ? Infinity : (H.action + H.remark) / 2;
    const body = items.filter((i) => i.y < hy - 2);
    const anchors = body
      .filter((i) => i.x + i.w / 2 < regHi && /^(?:VN-?)?A\d{3}$/i.test(i.str.trim()))
      .map((i) => ({ reg: i.str.trim(), y: i.y, defect: [] as PosItem[], action: [] as PosItem[] }));
    if (!anchors.length) continue;
    for (const it of body) {
      const cx = it.x + it.w / 2;
      const col = cx >= defLo && cx < defHi ? "defect" : cx >= defHi && cx < actHi ? "action" : "";
      if (!col) continue;
      let best = anchors[0]!;
      for (const a of anchors) if (Math.abs(a.y - it.y) < Math.abs(best.y - it.y)) best = a;
      if (Math.abs(best.y - it.y) > 80) continue;
      best[col].push(it);
    }
    const join = (xs: PosItem[], nl: boolean) => xs.sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.str.trim()).join(nl ? "\n" : " ");
    for (const a of anchors) {
      const r = makeRow(a.reg, join(a.defect, false), join(a.action, true));
      if (r) rows.push(r);
    }
  }
  return rows;
}

/** Đọc bảng defect từ bytes PDF (toạ độ chữ; fallback tách theo text phẳng). */
export async function extractRows(blob: ArrayBuffer): Promise<AircraftLimitRow[]> {
  let pages: string[];
  const posPages: PosItem[][] = [];
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(blob));
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      posPages.push((tc.items as Array<{ str?: string; transform?: number[]; width?: number }>)
        .filter((i) => typeof i.str === "string" && i.transform)
        .map((i) => ({ x: i.transform![4]!, y: i.transform![5]!, w: i.width ?? 0, str: i.str! })));
    }
    const result = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(result.text) ? result.text : [String(result.text)];
  } catch (exc) {
    throw new DefectPdfError(`Lỗi đọc PDF: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
  let rows = extractFromPositions(posPages);
  if (!rows.length) rows = extractFromPageTexts(pages);
  return rows.filter((row) => /^VN-A\d{3}$/.test(row.reg));
}

export interface ProcessUploadResult {
  aircraft: AircraftLimitRow[];
  rows: number;
  aircraft_count: number;
  raw_rows: number;
  source: string;
  saved_at: string;
  ok: true;
  [key: string]: unknown;
}

/** Parse PDF -> grouped aircraft/defect/limit snapshot (no filesystem I/O;
 * the caller persists it via the app's own storage, per web.py `process_upload`
 * minus the Excel/metadata file writes which the Worker runtime can't do). */
export async function processUpload(
  blob: ArrayBuffer,
  opts: { sourceName?: string; extra?: Record<string, unknown> } = {},
): Promise<ProcessUploadResult> {
  if (!blob || blob.byteLength === 0) throw new DefectPdfError("File PDF rỗng.");
  const rows = await extractRows(blob);
  if (!rows.length) {
    const src = (opts.sourceName || "PDF").split(/[\\/]/).pop() || "PDF";
    throw new DefectPdfError(
      `Không tìm thấy bảng defect trong «${src}» ` +
        "(cần cột AC REG / DEFECT / ACTION REQUIREMENT — " +
        "đúng file là SUMMARY MP & OPS LIMITATION LIST, không phải STATUS REPORT).",
    );
  }
  const grouped = groupRows(rows);
  const aircraftCount = new Set(grouped.map((r) => r.reg)).size;
  const meta: Record<string, unknown> = {
    source: (opts.sourceName || "upload.pdf").split(/[\\/]/).pop() || "upload.pdf",
    rows: grouped.length,
    aircraft_count: aircraftCount,
    raw_rows: rows.length,
    saved_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(opts.extra ?? {})) {
    if (value !== null && value !== undefined && value !== "") meta[key] = value;
  }
  return { ...meta, aircraft: grouped, ok: true } as ProcessUploadResult;
}
