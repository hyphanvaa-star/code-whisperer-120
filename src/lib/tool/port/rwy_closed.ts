/**
 * Runway-closure wording in NOTAM item E. States write it many ways ("RWY 25R/07L TEMPO CLOSED",
 * "RWY11 CLOSED", "RUNWAY 07L AND 07R ARE NOT AVBL", "CLOSURE OF RWY 10R/28L"), so the rule is built
 * from parts: runway designators, harmless filler words, then a closing word. Anything else between the
 * runway and the closing word (ILS, TWY, LGT, TORA…) means another facility is closed, not the runway.
 */
const RWY = "(?:RWYS?|RUNWAYS?)";
const DES = "\\d{2}\\s?[LCR]?";
const DES_LIST = `${DES}(?:\\s*(?:[/,&+-]|\\bAND\\b|\\bOR\\b|\\b${RWY})?\\s*${DES})*`;
const FILL_WORD = [
  "TEMPO(?:RARILY|RARY)?", "TEMP", "PARTIALLY", "PARTLY", "COMPLETELY", "TOTALLY", "FULLY", "ENTIRELY",
  "IS", "ARE", "WILL", "SHALL", "TO", "BE", "BEEN", "HAS", "HAVE", "REMAINS?", "NOW", "ALSO", "BOTH",
  "WHOLE", "ENTIRE", "FULL\\s+LENGTH", "DAILY", "DLY", "PHYSICALLY", "OPERATIONALLY",
].join("|");
const FILL = `(?:\\s*(?:[,:;-]|\\([^)]{0,40}\\)|\\b(?:${FILL_WORD})\\b))*`;
const SHUT = "(?:CLSD|CLOSED|CLOSURE|CLOSE)";
/** Unavailable wording: counts unless it is limited to one use ("NOT AVBL FOR INTERSECTION DEP"). */
const UNAVBL = "(?:NOT\\s+AVBL|NOT\\s+AVAILABLE|UNAVBL|UNAVAILABLE|NOT\\s+USABLE|UNUSABLE|U\\/S|UNSERVICEABLE|OUT\\s+OF\\s+(?:SERVICE|USE)|WITHDRAWN|SUSPENDED)";
const UNAVBL_OK = "(?!\\s+(?:FOR|TO)\\s+(?!ALL\\b|ANY\\b|TKOF\\b|TAKE|LDG\\b|LANDING|ACFT\\b|AIRCRAFT|OPS\\b|OPERATIONS?\\b|ARR\\w*\\s+AND|DEP\\w*\\s+AND|USE\\b))";
/** "RWY 10R/28L TEMPO CLSD", "RWY11 CLOSED", "RWY CLOSED". */
const HEAD = `\\b${RWY}\\s*(?:${DES_LIST})?${FILL}\\s*`;
const FORWARD = new RegExp(`${HEAD}\\b${SHUT}\\b`);
/** "RUNWAY 07L AND 07R ARE NOT AVBL" — only when the runway itself opens the sentence ("PAPI RWY 25L NOT AVBL" is the PAPI). */
const FORWARD_UNAVBL = new RegExp(`${HEAD}\\b${UNAVBL}(?![A-Z])${UNAVBL_OK}`, "g");
const SUBJECT_START = /^\s*(?:\(?\d{1,2}[.)]\s*)?(?:(?:THE|BOTH|ALL|FLW|FOLLOWING)\s+)*$/;
/** "CLOSURE OF RWY 10R/28L", "CLOSED RWY 11" — not runway parts such as shoulder, strip or lights. */
const REVERSE = new RegExp(`\\b${SHUT}\\s+(?:OF\\s+)?(?:THE\\s+)?${RWY}\\b(?!\\s*(?:\\d{2}\\s?[LCR]?\\s+)?(?:END|SHOULDERS?|STRIP|LGT|LIGHTS?|EDGE|CENTRE|CENTER|CL\\b|EXIT|HOLD\\w*|TURN\\w*|MARK\\w*|ENTR\\w*))`);

export function rwyClosedText(E: string): boolean {
  const t = String(E ?? "").toUpperCase();
  if (FORWARD.test(t) || REVERSE.test(t)) return true;
  for (const m of t.matchAll(FORWARD_UNAVBL)) {
    const before = t.slice(0, m.index);
    if (SUBJECT_START.test(before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf(";"), before.lastIndexOf(":")) + 1))) return true;
  }
  return false;
}
