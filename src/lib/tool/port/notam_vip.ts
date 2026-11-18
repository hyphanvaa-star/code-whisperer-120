// VIP movement NOTAMs ("DEP/ARR ACFT MAY BE DLA DUE TO VIP MOV"): arrivals landing
// inside the published B)–C) window may hold, so the flight needs extra holding fuel.
// Browser-safe and self-contained: `isVipMovement` is inlined into the tool page.

/** Minutes around the planned arrival time checked against the VIP window. */
export const VIP_ARR_BEFORE_MIN = 30;
export const VIP_ARR_AFTER_MIN = 30;

export function isVipMovement(text: unknown): boolean {
  // Self-contained (inlined via toString): VIP alone is not enough — the NOTAM must say
  // traffic is delayed / held because of the VIP. Sentences where works stop or are
  // exempted for VIP flights (e.g. "WORKING AREA WILL BE STOPPED WHEN THERE ARE VIP FLT OPS")
  // are removed first, so a maintenance RWY closure is never a VIP movement.
  const vipRe = /(?<![A-Z0-9])V?VIP(?![A-Z0-9])/;
  const kept = String(text ?? "").toUpperCase().replace(/\s+/g, " ")
    .split(/\.(?=\s|$)|;|(?<![A-Z0-9])RMK\b:?/)
    .filter((x) => {
      if (!vipRe.test(x)) return true;
      if (/(?<![A-Z0-9])(?:EXC(?:EPT)?|EXEMPT(?:ED)?|OTHER\s+THAN)\s+(?:FOR\s+)?V?VIP(?![A-Z0-9])/.test(x)) return false;
      const works = /(?<![A-Z0-9])(?:WORK(?:ING|S)?|WIP|MAINT(?:ENANCE)?|CONST(?:RUCTION)?|EQPT|EQUIPMENT|MACHINE(?:RY|S)?|VEH(?:ICLES?)?|PERSONNEL|WORKERS?|CREWS?|OBST(?:ACLES?)?)(?![A-Z0-9])/.test(x);
      const stop = /(?<![A-Z0-9])(?:STOP(?:PED|S)?|SUSPEND(?:ED|S)?|CEASE(?:D|S)?|VACATE(?:D|S)?|WITHDRAW[NS]?|REMOVED?|CLEARED|INTERRUPTED|HALTED)(?![A-Z0-9])/.test(x);
      return !(works && stop);
    });
  const t = kept.join(". ");
  if (!/(?<![A-Z0-9])V?VIP\s*(?:MOV(?:EMENT)?S?|MVT|MVMT|FLT|FLIGHTS?|OPS|OPR|OPERATIONS?|ACFT|AIRCRAFT|ACT(?:IVITY|IVITIES)?|TFC|TRAFFIC|ARR(?:IVALS?)?|DEP(?:ARTURES?)?|SPECIAL)(?![A-Z0-9])|DUE\s+(?:TO\s+)?V?VIP(?![A-Z0-9])|(?:FOR|BY)\s+V?VIP(?![A-Z0-9])/.test(t)) return false;
  // Delay / holding wording anywhere in the remaining VIP text.
  if (/(?<![A-Z0-9])(?:DLA|DLAS|DLY|DELAY(?:S|ED)?|HOLD(?:ING|S)?|HLDG|HLD)(?![A-Z0-9])/.test(t)) return true;
  // Or traffic stopped / aerodrome-runway closed in the same sentence as the VIP cause.
  return kept.some((x) => vipRe.test(x) &&
    /(?<![A-Z0-9])(?:CLSD|CLOSED|SUSPENDED|NOT\s+(?:AVBL|AVAILABLE|PERMITTED|ALLOWED)|PROHIBITED|STOPPED)(?![A-Z0-9])/.test(x));
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
