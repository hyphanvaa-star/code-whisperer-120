import type { ReleaseSheet } from "./briefingRelease";
export type PreviousBriefing = Pick<ReleaseSheet, "notams" | "notes" | "permit_addr" | "permit_kind">;
type Item = { str: string; x: number; y: number };
const linesOf = (items: Item[]) => {
  const rows: Item[][] = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs((r[0]?.y ?? 0) - item.y) < 2);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").trim()).filter(Boolean).join("\n");
};
/** Extract table cells using drawn boundaries, never mixed WX/NOTAM reading order. */
export async function readPreviousBriefing(bytes: Uint8Array, callsign: string): Promise<PreviousBriefing> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes.slice());
  const { OPS } = await getResolvedPDFJS();
  const result: PreviousBriefing = { notams: ["", "", "", "", "", ""], notes: "", permit_addr: "", permit_kind: "" };
  let section = "wx", weatherSeen = false, notamSeen = false, notesSeen = false, permitSeen = false, titleSeen = false;
  const append = (old: string, text: string) => [old, text].filter(Boolean).join("\n");
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const width = page.getViewport({ scale: 1 }).width;
      const left = width * 52.9 / 612, c1 = width * 105.9 / 612, c2 = width * 221.9 / 612, right = width * 558.9 / 612;
      const content = await page.getTextContent();
      const items: Item[] = content.items.flatMap((item) => "str" in item && item.str.trim()
        ? [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }] : []);
      const title = linesOf(items.filter((i) => /Official Briefing for Flight Release/i.test(i.str)));
      if (title) {
        const cs = /Flight Release\s*:\s*([A-Z0-9]+)/i.exec(title)?.[1];
        if (cs?.toUpperCase() !== callsign.toUpperCase()) throw new Error("Briefing cũ không đúng số hiệu chuyến — giữ nguyên tờ cũ.");
        titleSeen = true;
      }
      const ops = await page.getOperatorList();
      const ys: number[] = [];
      const addLine = (x0: number, y0: number, x1: number, y1: number) => {
        if (Math.abs(y0 - y1) < 0.5 && Math.min(x0, x1) <= c1 + 2 && Math.max(x0, x1) >= right - 2) ys.push(y0);
      };
      ops.fnArray.forEach((op, index) => {
        if (op !== OPS.constructPath) return;
        const args = ops.argsArray[index];
        const box = args?.[2];
        if (box?.length === 4) addLine(box[0], box[1], box[2], box[3]);
        else if (Array.isArray(args?.[0]) && args?.[1]) {
          let pos = 0, x = 0, y = 0;
          for (const code of args[0]) {
            if (code === OPS.moveTo) { x = args[1][pos++]; y = args[1][pos++]; }
            else if (code === OPS.lineTo) { const nx = args[1][pos++], ny = args[1][pos++]; addLine(x, y, nx, ny); x = nx; y = ny; }
            else if (code === OPS.rectangle) { const rx = args[1][pos++], ry = args[1][pos++], w = args[1][pos++], h = args[1][pos++]; addLine(rx, ry, rx + w, ry); addLine(rx, ry + h, rx + w, ry + h); }
            else if (code === OPS.curveTo) pos += 6;
            else if (code === OPS.curveTo2 || code === OPS.curveTo3) pos += 4;
          }
        }
      });
      const bounds = [...new Set(ys.map((y) => Math.round(y * 10) / 10))].sort((a, b) => b - a);
      if (bounds.length < 2) throw new Error("Không đọc được khung Briefing cũ — giữ nguyên tờ cũ.");
      for (let r = 0; r < bounds.length - 1; r++) {
        const top = bounds[r] ?? 0, bottom = bounds[r + 1] ?? 0;
        const row = items.filter((i) => i.y < top && i.y > bottom && i.x >= left && i.x < right);
        const side = linesOf(row.filter((i) => i.x < c1 - 1));
        const label = linesOf(row.filter((i) => i.x >= c1 - 1 && i.x < c2 - 1));
        const body = linesOf(row.filter((i) => i.x >= c2 - 1));
        if (/NOTES\s+by|Dispatcher/i.test(side)) { section = "notes"; notesSeen = true; }
        else if (/Flight\s+Permits/i.test(side)) { section = "permit"; permitSeen = true; }
        else if (/PIC\s+Ack/i.test(side) || /^The Flight Crew study|^If any doubts|^By receiving and reviewing/i.test(label)) section = "pic";
        else if (/Check Tech log/i.test(label) || /A\/C OPS/i.test(side)) section = "ops";
        else if (/Dept\.?\s*APT/i.test(label)) {
          if (weatherSeen) { section = "notam"; notamSeen = true; } else weatherSeen = true;
        }
        if (section === "notam") {
          const cell = /Dept\.?\s*APT/i.test(label) ? 0 : /Dest\.?\s*APT/i.test(label) ? 1
            : /Dest\.?\s*Alternate\s*2/i.test(label) ? 5 : /Dest\.?\s*Alternate/i.test(label) ? 2
            : /Enr\.?\s*Alternate/i.test(label) ? 3 : /FIR/i.test(label) ? 4 : -1;
          if (cell < 0 && body) throw new Error("Có ô NOTAM cũ chưa nhận diện được — giữ nguyên tờ cũ.");
          if (cell >= 0) result.notams[cell] = append(result.notams[cell] ?? "", body);
        } else if (section === "notes") result.notes = append(result.notes, linesOf(row.filter((i) => i.x >= c1 - 1)));
        else if (section === "permit") { result.permit_addr = append(result.permit_addr, label); result.permit_kind = append(result.permit_kind, body); }
      }
    }
    if (!titleSeen || !notamSeen || !notesSeen || !permitSeen) throw new Error("Chưa đọc đủ NOTAM/NOTES/Permits của Briefing cũ — giữ nguyên tờ cũ.");
    return result;
  } finally { await pdf.loadingTask.destroy(); }
}
/** Preserve only these fields AFTER fresh weather and pins. */
export function restorePreviousBriefing(sheet: ReleaseSheet, previous: PreviousBriefing): ReleaseSheet {
  return { ...sheet, ...previous, notams: [...previous.notams] };
}
