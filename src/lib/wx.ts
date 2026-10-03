// Đánh giá nhanh TAF/METAR (client-safe): tìm điều kiện xấu.
export type WxLevel = "ok" | "bad" | "warn" | "nil";

export function wxAdvice(raw: string): { level: WxLevel; reasons: string[] } {
  if (!raw) return { level: "nil", reasons: ["Không có dữ liệu"] };
  const t = ` ${raw.toUpperCase()} `;
  const bad: string[] = [];
  const warn: string[] = [];
  if (/\s(\+?TS\w*|VCTS)\s/.test(t)) bad.push("Dông (TS)");
  if (/\s(\+RA|\+SHRA|FZRA|FZDZ|SN|GR)\s/.test(t)) bad.push("Mưa lớn / đóng băng");
  if (/\sFG\s/.test(t)) bad.push("Sương mù (FG)");
  for (const m of t.matchAll(/\s(\d{4})\s/g)) {
    const v = Number(m[1]);
    if (v < 9999 && v < 800) { bad.push(`Tầm nhìn ${v}m`); break; }
    if (v < 3000) { warn.push(`Tầm nhìn ${v}m`); break; }
  }
  for (const m of t.matchAll(/(BKN|OVC|VV)(\d{3})/g)) {
    const h = Number(m[2]) * 100;
    if (h < 300) { bad.push(`Trần mây ${m[1]}${m[2]}`); break; }
    if (h < 1000) { warn.push(`Trần mây ${m[1]}${m[2]}`); break; }
  }
  for (const m of t.matchAll(/(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT/g)) {
    const g = Number(m[4] ?? m[2]);
    if (g >= 35) { bad.push(`Gió ${m[0]}`); break; }
    if (g >= 25) { warn.push(`Gió ${m[0]}`); break; }
  }
  if (/\sSHRA\s|\sRA\s|\sCB/.test(t)) warn.push("Mưa / CB");
  if (bad.length) return { level: "bad", reasons: [...bad, ...warn] };
  if (warn.length) return { level: "warn", reasons: warn };
  return { level: "ok", reasons: [] };
}

export const wxClass: Record<WxLevel, string> = {
  ok: "bg-emerald-500/15 text-emerald-700",
  warn: "bg-amber-400/25 text-amber-800",
  bad: "bg-primary/15 text-primary font-semibold",
  nil: "bg-muted text-muted-foreground",
};
