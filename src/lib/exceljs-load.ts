// Loads ExcelJS reliably in every runtime (browser, dev SSR, Worker build).
// The Node entry ("exceljs") depends on fs/streams and its CJS interop differs
// between bundlers, so we use the self-contained browser bundle and probe for
// the namespace that actually carries `Workbook`.
type ExcelJSNS = typeof import("exceljs");

let cached: ExcelJSNS | null = null;

export async function loadExcelJS(): Promise<ExcelJSNS> {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await import("exceljs/dist/exceljs.min.js");
  const candidates = [m, m?.default, m?.default?.default, m?.["module.exports"], (globalThis as any).ExcelJS];
  const ns = candidates.find((c) => c && typeof c.Workbook === "function");
  if (!ns) throw new Error("Không nạp được thư viện Excel");
  cached = ns as ExcelJSNS;
  return cached;
}
