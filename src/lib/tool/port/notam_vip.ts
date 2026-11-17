// VIP movement NOTAMs ("DEP/ARR ACFT MAY BE DLA DUE TO VIP MOV"): arrivals landing
// inside the published B)–C) window may hold, so the flight needs extra holding fuel.
// Browser-safe and self-contained: `isVipMovement` is inlined into the tool page.

/** Minutes around the planned arrival time checked against the VIP window. */
export const VIP_ARR_BEFORE_MIN = 30;
export const VIP_ARR_AFTER_MIN = 30;

export function isVipMovement(text: unknown): boolean {
  const t = String(text ?? "").toUpperCase();
  if (!/(?<![A-Z0-9])V?VIP(?![A-Z0-9])/.test(t)) return false;
  return /(?<![A-Z0-9])V?VIP\s*(?:MOV(?:EMENT)?S?|MVT|MVMT|FLT|FLIGHTS?|OPS|OPR|OPERATIONS?|ACFT|AIRCRAFT|ACT(?:IVITY|IVITIES)?|TFC|TRAFFIC|ARR(?:IVALS?)?|DEP(?:ARTURES?)?|SPECIAL)(?![A-Z0-9])|DUE\s+(?:TO\s+)?V?VIP(?![A-Z0-9])|(?:FOR|BY)\s+V?VIP(?![A-Z0-9])/.test(t);
}

export function vipWindow(eta: Date | null | undefined): [Date | null, Date | null] {
  if (!eta || Number.isNaN(eta.getTime())) return [null, null];
  return [new Date(eta.getTime() - VIP_ARR_BEFORE_MIN * 60_000), new Date(eta.getTime() + VIP_ARR_AFTER_MIN * 60_000)];
}

/** True only when the VIP window B)–C) overlaps arrival ±margin; unknown times never warn. */
export function vipOverlaps(b: Date | null, c: Date | null, eta: Date | null | undefined): boolean {
  const [lo, hi] = vipWindow(eta);
  if (!lo || !hi || !b) return false;
  return b <= hi && (c == null || c >= lo);
}

const hhmm = (d: Date | null) => (d ? d.toISOString().slice(11, 16).replace(":", "") : "?");
export function vipLabel(b: Date | null, c: Date | null): string {
  return `VIP ${hhmm(b)}–${c ? hhmm(c) : "PERM"}Z`;
}
