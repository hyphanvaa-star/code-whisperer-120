// ATS route NOTAMs that only restrict the usable flight levels ("ATS ROUTE LIMITED TO",
// "- L642: FL320, FL360, FL400", LSWD level lists). The route stays open, so a flight on it
// is informed (green) rather than flagged as a closure. Browser-safe, no imports.

type N = Record<string, unknown>;

const HARD = /\b(?:CLSD|CLOSED|CLOSURE|NOT\s+AVBL|NOT\s+AVAILABLE|UNAVBL|UNAVAILABLE|SUSPENDED|WITHDRAWN|PROHIBITED|UNUSABLE|U\/S|DEACTIVATED)\b/;
const FL_WORDING = /\bLIMITED\s+TO\b|\bFL\s*LIMIT|\bLSWD\b|\bLEVELS?\s+(?:AVBL|AVAILABLE)\b|\b(?:AVBL|AVAILABLE)\s+(?:ONLY\s+)?(?:AT\s+|FOR\s+)?FL\s*\d{2,3}\b|\bONLY\s+FL\s*\d{2,3}\b|\bFL\s*\d{2,3}\s*(?:,|\/|AND)\s*FL\s*\d{2,3}\b/;

const q2 = (raw: unknown) => {
  let s = String(raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (s.startsWith("Q")) s = s.slice(1);
  return s.length >= 2 ? s.slice(0, 2) : "";
};

/** True when a route NOTAM only limits flight levels on the route and closes nothing. */
export function isRouteFlLimitOnly(n: N): boolean {
  const text = String(n.text ?? "").toUpperCase();
  const E = (String(n.e_field ?? "") || text.replace(/^Q\).*$/gm, "")).toUpperCase();
  if (!E.trim() || HARD.test(E)) return false;
  const q = /Q\)\s*[A-Z]{4}\s*\/\s*Q([A-Z]{2})([A-Z]{2})/.exec(text);
  const subj = q?.[1] || q2(n.qsubj);
  const cond = q?.[2] || q2(n.qcond);
  if (subj && !/^A[RTXNUP]/.test(subj)) return false;
  if (cond === "LT") return true;
  return FL_WORDING.test(E);
}
