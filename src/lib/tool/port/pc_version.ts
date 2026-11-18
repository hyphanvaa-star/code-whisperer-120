// Browser-safe PC helper version compare.
/** "6.8" < "6.9" < "6.10" — so số từng phần, bản rỗng coi là cũ. */
export function pcVersionBelow(v: string | undefined, min: string): boolean {
  const a = String(v || "").split(".").map(n => parseInt(n, 10) || 0);
  const b = min.split(".").map(n => parseInt(n, 10) || 0);
  if (!String(v || "").trim()) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}
