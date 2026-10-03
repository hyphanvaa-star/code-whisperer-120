// Client-only: extract text from an OFP PDF and cut ATC / EZFW blocks (port of atc_ezfw.py).
export async function pdfText(blob: Blob): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!("str" in it)) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      const arr = rows.get(y) ?? [];
      arr.push({ x: it.transform[4]!, s: it.str });
      rows.set(y, arr);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join("").replace(/\s+$/, ""));
    pages.push(lines.join("\n"));
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

const BREAKS = [
  /^V1:/, /^FLX:/, /^FUEL PLAN\b/, /^\s+FUEL\s+TIME\s*$/, /^FINAL FUEL ORDER/, /^GREATER THAN\b/, /^LRC\b/,
  /^PIC SIGNATURE/, /^PIC"S SIGNATURE/, /^CAPT\b/, /^ROUTE\b.*\bCRZ\b/, /^PLD\b/, /^FUEL CONSUMPTION\b/, /^WEIGHT CHANGE\b/,
];

function spaceOut(text: string) {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (BREAKS.some((rx) => rx.test(line)) && out.length && out[out.length - 1]!.trim()) out.push("");
    out.push(line.trimEnd());
  }
  return out.join("\n").replace(/^\n+|\n+$/g, "");
}

export function extractEzfw(text: string): string {
  const m = /^PLAN\s+(\d+)\s+\S+/m.exec(text);
  if (!m) throw new Error("OFP không có khối PLAN (trang fuel/EZFW).");
  let chunk = text.slice(m.index);
  const end = /^WEIGHT CHANGE[^\n]*/im.exec(chunk);
  if (end) chunk = chunk.slice(0, end.index + end[0].length);
  const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() && !/^Page\s*-/i.test(l));
  const out = spaceOut(lines.join("\n").trim());
  if (!out.toUpperCase().includes("FUEL PLAN")) throw new Error("Khối PLAN thiếu FUEL PLAN — kiểm tra OFP.");
  return out + "\n";
}

/** "VJ5513" -> "VJC5513" like file_callsign in the original. */
export const fileCallsign = (cs: string) => {
  const b = cs.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (b.startsWith("VJ") && !b.startsWith("VJC")) return "VJC" + b.slice(2);
  if (/^\d/.test(b)) return "VJC" + b;
  return b || "VJC";
};
export const mailCallsign = (cs: string) => { const b = fileCallsign(cs); return b.startsWith("VJC") ? "VJ" + b.slice(3) : b; };
