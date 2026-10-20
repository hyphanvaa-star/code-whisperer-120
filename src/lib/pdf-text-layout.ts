/** Rebuild fixed-width OFP text from PDF positions, not PDF item order/EOL flags. */
export interface PositionedText {
  str: string;
  width: number;
  height?: number;
  fontName?: string;
  transform: number[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export function fixedWidthPage(items: PositionedText[]): string {
  const text = items.filter(item => item.str.trim() && Number.isFinite(item.transform[4]) && Number.isFinite(item.transform[5]));
  if (!text.length) return '';
  const plan = text.find(item => /^PLAN\s+\d+/.test(item.str));
  const font = plan?.fontName;
  const widths = text.filter(item => !font || item.fontName === font)
    .map(item => item.width / item.str.length).filter(width => Number.isFinite(width) && width > 0);
  const charWidth = median(widths) || 6;
  const origin = plan?.transform[4] ?? Math.min(...text.map(item => item.transform[4] ?? 0));
  const rows: { y: number; items: PositionedText[] }[] = [];
  for (const item of [...text].sort((a, b) => (b.transform[5] ?? 0) - (a.transform[5] ?? 0))) {
    const y = item.transform[5] ?? 0;
    const last = rows[rows.length - 1];
    // Fonts on the same baseline can differ slightly; never round independent y's.
    if (last && Math.abs(last.y - y) <= 2) last.items.push(item);
    else rows.push({ y, items: [item] });
  }
  const gaps = rows.slice(1).map((row, i) => (rows[i]?.y ?? row.y) - row.y).filter(gap => gap > 2);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const pitch = sortedGaps[Math.floor((sortedGaps.length - 1) / 2)] || 12;
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const previous = rows[i - 1];
    if (previous) {
      const blanks = Math.min(3, Math.max(0, Math.round((previous.y - row.y) / pitch) - 1));
      for (let j = 0; j < blanks; j++) lines.push('');
    }
    let line = '';
    for (const item of row.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))) {
      const column = Math.max(0, Math.round(((item.transform[4] ?? origin) - origin) / charWidth));
      line += ' '.repeat(Math.max(0, column - line.length)) + item.str;
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}