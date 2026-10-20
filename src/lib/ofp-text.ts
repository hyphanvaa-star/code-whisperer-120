// Client-only: extract text from an OFP PDF and cut ATC / EZFW blocks (port of atc_ezfw.py).
import { fixedWidthPage, type PositionedText } from './pdf-text-layout';
import { extractEzfw as cutEzfw } from './tool/port/atc_ezfw';
export async function pdfText(blob: Blob): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(fixedWidthPage(tc.items.filter(item => 'str' in item) as PositionedText[]));
  }
  return pages.join("\n");
}

export function extractAtc(text: string): string {
  const start = text.indexOf("(FPL-");
  if (start < 0) throw new Error("OFP không có điện văn (FPL-… ).");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1).trim() + "\n";
    }
  }
  throw new Error("Khối (FPL-… trong OFP không đóng ngoặc.");
}

export const joinAtcBlocks = (blocks: string[]) => {
  const parts = blocks.map((b) => b.trim()).filter(Boolean);
  return parts.length ? parts.join("\n".repeat(5)) + "\n" : "";
};

export function extractEzfw(text: string): string {
  return cutEzfw(text);
}

/** "VJ5513" -> "VJC5513" like file_callsign in the original. */
export const fileCallsign = (cs: string) => {
  const b = cs.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (b.startsWith("VJ") && !b.startsWith("VJC")) return "VJC" + b.slice(2);
  if (/^\d/.test(b)) return "VJC" + b;
  return b || "VJC";
};
export const mailCallsign = (cs: string) => { const b = fileCallsign(cs); return b.startsWith("VJC") ? "VJ" + b.slice(3) : b; };
