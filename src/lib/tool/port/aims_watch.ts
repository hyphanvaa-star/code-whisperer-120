// AIMS auto-check: compares a fresh AIMS Daily Flight Schedule against the
// dispatcher's current Crewlist and lists what AIMS changed (pure, browser-safe).
import { crewChanged, crewIn, crewOut, delayMin, regChanged, type DiffResult, type Leg } from "./xlsdiff";

export interface AimsChange {
  flt: string;
  route: string;
  day: string;
  kinds: Array<"reg" | "crew" | "time" | "added" | "removed">;
  text: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ddmm = (d: Date | null) => (d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}` : "");
const hm = (t: Leg["std"]) => (t ? `${pad(t.h)}:${pad(t.m)}` : "—");
const list = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(", ")} +${xs.length - 4}` : xs.join(", "));

/** Ops-day range for the watcher: the day that started at `fromTime` (VN time), through the next day. */
export function watchRange(nowMs: number, fromTime = "00:00"): { start: string; end: string } {
  const vn = new Date(nowMs + 7 * 3600_000);
  const [h, m] = fromTime.split(":").map((x) => Number.parseInt(x, 10) || 0);
  const mins = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  const startMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - (mins < h! * 60 + m! ? 864e5 : 0);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(startMs), end: iso(startMs + 864e5) };
}

/** True when both names are AIMS downloads for the same date range ("AIMS 1111-1211 …"). */
export function sameAimsRange(a: string, b: string): boolean {
  const re = /^AIMS (\d{4}-\d{4})\b/;
  const x = re.exec(a || ""), y = re.exec(b || "");
  return !!x && !!y && x[1] === y[1];
}

/** Changes AIMS made relative to the baseline. Added/removed sectors only count when the
 *  baseline covers the same AIMS range, otherwise a different export window looks like changes. */
export function summarizeAimsChanges(res: DiffResult, includeAddRemove: boolean): AimsChange[] {
  const out: AimsChange[] = [];
  for (const c of res.changes) {
    const leg = c.new || c.old;
    if (!leg) continue;
    const base = { flt: c.flt, route: `${c.dep}-${c.arr}`, day: ddmm(leg.day) };
    if (!c.old || !c.new) {
      if (!includeAddRemove) continue;
      out.push({ ...base, kinds: [c.old ? "removed" : "added"], text: c.old ? "Chuyến bị bỏ khỏi AIMS" : `Chuyến mới trên AIMS (STD ${hm(leg.std)}${leg.reg ? `, tàu ${leg.reg}` : ""})` });
      continue;
    }
    const kinds: AimsChange["kinds"] = [];
    const parts: string[] = [];
    if (regChanged(c)) { kinds.push("reg"); parts.push(`Tàu ${c.old.reg || "—"} → ${c.new.reg || "—"}`); }
    if (crewChanged(c)) {
      kinds.push("crew");
      const i = crewIn(c), o = crewOut(c);
      parts.push(`Crew${i.length ? ` vào ${list(i)}` : ""}${o.length ? `${i.length ? ";" : ""} ra ${list(o)}` : ""}`);
    }
    const d = delayMin(c);
    if (d) { kinds.push("time"); parts.push(`ETD ${c.old.etd ? hm(c.old.etd) : `STD ${hm(c.old.std)}`} → ${hm(c.new.etd)} (${d > 0 ? "+" : ""}${d}′)`); }
    if (kinds.length) out.push({ ...base, kinds, text: parts.join(" · ") });
  }
  return out;
}
