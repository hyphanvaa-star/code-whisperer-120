import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { NOTO_SANS_REGULAR_BASE64, NOTO_SANS_BOLD_BASE64 } from "../data/fonts/notoSansBase64";
import { VJ_LOGO_PNG_BASE64 } from "./vj_logo_base64";
import { WEATHER_SIDE, NOTAM_SIDE, OPS_SIDE, PERMIT_SIDE, NOTES_SIDE, PIC_ACK_LINES, defectBullets, sigWxText, padNotams, slash, type ReleaseSheet } from "./briefingRelease";
import { isNotamPlaceholder } from "./notam_pin";

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const INK = rgb(0, 0, 0);
const NOTES_INK = rgb(1, 0, 0);
const LEFT = 52.9, COL1 = 105.9, COL2 = 221.9, RIGHT = 558.9, TOP = 112, BOTTOM = 764;
const PAD = 3.2, LEADING = 1.22;

/** Word-wrap by actual glyph width, including long slash-separated airport lists. */
function wrap(text: string, width: number, size: number, font: PDFFont): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const token of para.split(/\s+/).filter(Boolean)) {
      const pieces: string[] = [];
      let piece = "";
      if (font.widthOfTextAtSize(token, size) <= width) pieces.push(token);
      else for (const char of token) {
        if (piece && font.widthOfTextAtSize(piece + char, size) > width) { pieces.push(piece); piece = ""; }
        piece += char;
      }
      if (piece) pieces.push(piece);
      pieces.forEach((word, index) => {
        const trial = line ? `${line} ${word}` : word;
        if (line && (index > 0 || font.widthOfTextAtSize(trial, size) > width)) { lines.push(line); line = word; }
        else line = trial;
      });
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export async function renderBriefingPdf(sheet: ReleaseSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(bytes(NOTO_SANS_REGULAR_BASE64));
  const bold = await doc.embedFont(bytes(NOTO_SANS_BOLD_BASE64));
  const logo = await doc.embedPng(bytes(VJ_LOGO_PNG_BASE64));
  const apt = (title: string, codes: string[]) => codes.length ? `${title}\n(${slash(codes)})` : title;
  const labels = [`Dept. APT (${sheet.dep || "—"})`, `Dest. APT (${sheet.dest || "—"})`, apt("Dest. Alternate(s)", sheet.dest_alts), apt("Enr. Alternate(s)", sheet.enroute_alts)];
  const wx = labels.map((label, i) => ({ label, body: sheet.wx[i]?.texts.join("\n\n") || "NIL", size: 8, bold: false, notes: false }));
  wx.push({ label: "En-route SIG Wx", body: sigWxText(sheet.sig_wx), size: 8, bold: false, notes: false });
  const cells = padNotams(sheet.notams);
  const split = splitDestAlts(sheet);
  const ntLabels = [labels[0], labels[1], split ? apt("Dest. Alternate 1", split[0]) : labels[2], labels[3], "FIR(s)"];
  const order = [0, 1, 2, 3, 4];
  if (split) { ntLabels.splice(3, 0, apt("Dest. Alternate 2", split[1])); order.splice(3, 0, 5); }
  const nt = order.map((ci, i) => ({ label: ntLabels[i]!, body: cells[ci] ?? "", size: 8, bold: false, notes: false }));
  const x = split ? 1 : 0;
  const rows = [...wx, ...nt,
    { label: `Check Tech log\nfor updates\nREG: ${sheet.reg || "—"}`, body: defectBullets(sheet.defects).join("\n"), size: 10.7, bold: false, notes: false },
    { label: sheet.permit_addr, body: sheet.permit_kind, size: 9.4, bold: false, notes: false },
    { label: "", body: sheet.notes, size: 11.5, bold: true, notes: true },
    ...PIC_ACK_LINES.map((body) => ({ label: "", body, size: 9.4, bold: false, notes: true })),
  ];
  const side = [{ start: 0, end: 4, text: WEATHER_SIDE }, { start: 5, end: 9 + x, text: NOTAM_SIDE },
    { start: 10 + x, end: 10 + x, text: OPS_SIDE }, { start: 11 + x, end: 11 + x, text: PERMIT_SIDE },
    { start: 12 + x, end: 12 + x, text: NOTES_SIDE }, { start: 13 + x, end: 15 + x, text: "PIC Ack" }];
  let factor = 1;
  const heightsAt = (scale: number) => {
    const heights = rows.map((row) => {
      const size = row.size * scale;
      const bodyWidth = RIGHT - (row.notes ? COL1 : COL2) - PAD * 2;
      const body = wrap(row.body, bodyWidth, size, row.bold ? bold : regular).length * size * LEADING + PAD * 2;
      const label = row.notes ? 0 : wrap(row.label, COL2 - COL1 - PAD * 2, 9.4 * scale, regular).length * 9.4 * scale * LEADING + PAD * 2;
      return Math.max(body, label, 12.5);
    });
    for (const group of side) {
      const sideSize = Math.min(9.4 * scale, (COL1 - LEFT - PAD * 2) / bold.widthOfTextAtSize("Limitations", 1));
      const need = wrap(group.text, COL1 - LEFT - PAD * 2, sideSize, bold).length * sideSize * LEADING + PAD * 2;
      const have = heights.slice(group.start, group.end + 1).reduce((sum, h) => sum + h, 0);
      if (need > have) heights[group.end] = (heights[group.end] ?? 0) + need - have;
    }
    return heights;
  };
  let heights = heightsAt(factor);
  while (heights.reduce((sum, h) => sum + h, 0) > BOTTOM - TOP && factor > 0.7) {
    factor = Math.max(0.7, factor - 0.025);
    heights = heightsAt(factor);
  }
  // Normal sheets stay on one Letter page; unusually long NOTAMs continue without truncation.
  let page = doc.addPage([612, 792]);
  const header = () => {
    page.drawImage(logo, { x: 53.3, y: 792 - 96.5, width: 94.7, height: 22.5 });
    const title = `Official Briefing for Flight Release: ${sheet.callsign}`;
    const size = Math.min(13.5, 13.5 * (RIGHT - 150) / bold.widthOfTextAtSize(title, 13.5));
    page.drawText(title, { x: 150 + (RIGHT - 150 - bold.widthOfTextAtSize(title, size)) / 2, y: 792 - 90.2, size, font: bold, color: INK });
    page.drawText("Published at:", { x: LEFT, y: 792 - 107.5, size: 8, font: regular, color: INK });
    page.drawText(sheet.published_at, { x: 138, y: 792 - 107.5, size: 10.5, font: regular, color: INK });
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => page.drawLine({ start: { x: x0, y: 792 - y0 }, end: { x: x1, y: 792 - y1 }, color: INK, thickness: 0.65 });
  const textBox = (text: string, x0: number, top: number, x1: number, bottom: number, size: number, font = regular, center = false, red = false) => {
    const lines = wrap(text, x1 - x0 - PAD * 2, size, font);
    const height = lines.length * size * LEADING;
    const start = center ? top + Math.max(PAD, (bottom - top - height) / 2) : top + PAD;
    lines.forEach((text, i) => {
      if (!text) return;
      page.drawText(text, { x: center ? x0 + (x1 - x0 - font.widthOfTextAtSize(text, size)) / 2 : x0 + PAD,
        y: 792 - start - size * 0.88 - i * size * LEADING, size, font, color: red ? NOTES_INK : INK });
    });
  };
  header();
  let y = TOP;
  let groupStart = TOP;
  rows.forEach((row, i) => {
    const height = heights[i] ?? 14;
    if (y + height > BOTTOM && y > TOP) { page = doc.addPage([612, 792]); header(); y = TOP; groupStart = TOP; }
    // A single very long row is split into complete wrapped chunks, never cropped.
    const font = row.bold ? bold : regular;
    const size = row.size * factor;
    const xBody = row.notes ? COL1 : COL2;
    const bodyLines = wrap(row.body, RIGHT - xBody - PAD * 2, size, font);
    const capacity = Math.max(1, Math.floor((BOTTOM - y - PAD * 2) / (size * LEADING)));
    const chunks: string[][] = [];
    for (let n = 0; n < bodyLines.length; n += capacity) chunks.push(bodyLines.slice(n, n + capacity));
    chunks.forEach((chunk, chunkIndex) => {
      if (chunkIndex) { page = doc.addPage([612, 792]); header(); y = TOP; groupStart = TOP; }
      const h = chunks.length > 1 ? Math.max(14, chunk.length * size * LEADING + PAD * 2) : height;
      const bottom = y + h;
      const group = side.find((g) => g.start <= i && g.end >= i);
      line(group?.start === i || chunkIndex > 0 || y === TOP ? LEFT : COL1, y, RIGHT, y);
      line(group?.end === i || chunks.length > 1 ? LEFT : COL1, bottom, RIGHT, bottom);
      line(LEFT, y, LEFT, bottom); line(COL1, y, COL1, bottom); line(RIGHT, y, RIGHT, bottom);
      if (!row.notes) { line(COL2, y, COL2, bottom); textBox(row.label, COL1, y, COL2, bottom, 9.4 * factor); }
      textBox(chunk.join("\n"), xBody, y, RIGHT, bottom, size, font, i >= 5 && i <= 9 && isNotamPlaceholder(row.body), i === 12);
      const sideSize = Math.min(9.4 * factor, (COL1 - LEFT - PAD * 2) / bold.widthOfTextAtSize("Limitations", 1));
      if (group && (i === group.end || chunks.length > 1)) textBox(group.text, LEFT, groupStart, COL1, bottom, sideSize, bold, true);
      if (group && i === group.end) groupStart = bottom;
      y = bottom;
    });
  });
  return doc.save();
}