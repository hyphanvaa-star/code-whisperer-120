// Port of pdf_merge.py — gộp PDF/TXT (pdf-lib). Word (.doc/.docx) needs the
// Windows Word COM automation the original used; that is not available in a
// Worker, so those files return MergeError honestly instead of faking output.
export class MergeError extends Error {}

export const ALLOWED = new Set([".pdf", ".txt", ".doc", ".docx"]);
export const MAX_FILES = 30;
export const MAX_BYTES = 80 * 1024 * 1024;

export interface MergeInputFile {
  name: string;
  data: Uint8Array;
}
export interface MergePart {
  name: string;
  pages: number;
}
export interface MergeResult {
  bytes: Uint8Array;
  file: string;
  pages: number;
  parts: MergePart[];
}

function suffixOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}
function baseName(name: string): string {
  return name.replace(/^.*[/\\]/, "");
}

export async function mergeToPdf(files: MergeInputFile[]): Promise<MergeResult> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  if (!files.length) throw new MergeError("Chưa chọn file.");
  if (files.length > MAX_FILES) throw new MergeError(`Chọn tối đa ${MAX_FILES} file một lần.`);
  const total = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (total > MAX_BYTES) throw new MergeError("Tổng file quá lớn (hơn 80 MB).");

  const out = await PDFDocument.create();
  const parts: MergePart[] = [];
  let font: Awaited<ReturnType<typeof out.embedFont>> | null = null;

  for (const { name, data } of files) {
    const suffix = suffixOf(name);
    if (!ALLOWED.has(suffix)) throw new MergeError(`${name}: chỉ nhận file Word, TXT hoặc PDF.`);
    if (!data.byteLength) throw new MergeError(`${name}: file rỗng.`);

    if (suffix === ".pdf") {
      if (!(data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) {
        throw new MergeError(`${name}: không phải file PDF.`);
      }
      let src;
      try {
        src = await PDFDocument.load(data, { ignoreEncryption: true });
      } catch {
        throw new MergeError(`${name}: không đọc được PDF.`);
      }
      if (src.getPageCount() < 1) throw new MergeError(`${name}: PDF không có trang.`);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
      parts.push({ name: baseName(name), pages: pages.length });
    } else if (suffix === ".txt") {
      const text = new TextDecoder("utf-8").decode(data).replace(/^\ufeff/, "");
      if (!text.trim()) throw new MergeError(`${name}: file TXT không có chữ.`);
      if (!font) font = await out.embedFont(StandardFonts.Helvetica);
      const size = 11;
      const margin = 48;
      const width = 595, height = 842;
      const lineH = size * 1.4;
      const maxWidth = width - 2 * margin;
      const lines = wrapLines(text, font, size, maxWidth);
      const perPage = Math.max(1, Math.floor((height - 2 * margin) / lineH));
      let pageCount = 0;
      for (let start = 0; start < lines.length; start += perPage) {
        const page = out.addPage([width, height]);
        const chunk = lines.slice(start, start + perPage);
        let y = height - margin;
        for (const line of chunk) {
          page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) });
          y -= lineH;
        }
        pageCount++;
      }
      parts.push({ name: baseName(name), pages: pageCount });
    } else {
      throw new MergeError(`${name}: máy chủ chưa có Word để đổi file .doc/.docx sang PDF.`);
    }
  }
  if (out.getPageCount() < 1) throw new MergeError("Không có trang nào để gộp.");
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 15)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const file = `gop-${stamp}.pdf`;
  const bytes = await out.save();
  return { bytes, file, pages: out.getPageCount(), parts };
}

function wrapLines(text: string, font: { widthOfTextAtSize: (s: string, size: number) => number }, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (!para) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(" ")) {
      const trial = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) {
        cur = trial;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      if (font.widthOfTextAtSize(word, size) <= width) {
        cur = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) <= width) chunk += ch;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      cur = chunk;
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [""];
}
