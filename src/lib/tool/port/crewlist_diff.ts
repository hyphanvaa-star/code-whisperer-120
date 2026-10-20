// Crewlist-vs-crewlist crew change detection, merged into the FPL VER diff rows.
// FPL VER files carry no crew column, so crew changes come only from the two
// most recent crewlists the dispatcher uploaded.
import { crewChanged, crewIn, crewOut, legWhen, type DiffResult } from "./xlsdiff";

const ddmm = (d: Date | null) =>
  d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "";
const hm = (t: { h: number; m: number } | null) =>
  t ? `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}` : "";

/** Same flight = same digits, route and day. Returns number of crew-changed flights merged. */
export function mergeCrewlistDiff(rows: Array<Record<string, unknown>>, crew: DiffResult, days: string[] = []): number {
  const allowDays = new Set(days.map((d) => d.slice(0, 5)));
  let n = 0;
  for (const c of crew.changes) {
    if (!c.old || !c.new || !crewChanged(c)) continue;
    const o = c.old, nw = c.new;
    const day = ddmm(nw.day);
    if (allowDays.size && day && !allowDays.has(day)) continue;
    const crewObj = {
      changed: true,
      out: crewOut(c),
      in: crewIn(c),
      n: Math.max(crewOut(c).length, crewIn(c).length),
      dhd: [...new Set([...o.dhd, ...nw.dhd])].sort(),
      raw_old: o.crewRaw.trim(),
      raw_new: nw.crewRaw.trim(),
      source: "crewlist",
    };
    const route = `${c.dep}-${c.arr}`;
    const digits = nw.digits;
    const hit = rows.find((r) =>
      String(r["flt"] ?? "").replace(/\D/g, "").replace(/^0+/, "") === digits &&
      r["route"] === route && (!day || !r["day_new"] || r["day_new"] === day));
    n++;
    if (hit) { hit["crew"] = crewObj; continue; }
    rows.push({
      flt: c.flt,
      route,
      std_old: hm(o.std),
      std_new: hm(nw.std),
      day_new: day,
      when_new: legWhen(nw) != null ? new Date(legWhen(nw)!).toISOString() : "",
      when_old: legWhen(o) != null ? new Date(legWhen(o)!).toISOString() : "",
      reg: { changed: false, old: nw.reg || "—", new: nw.reg || "—" },
      crew: crewObj,
      delay: { min: 0, changed: false, from: "", to: "", kind: "" },
      atc: { kind: "", label: "" },
    });
  }
  return n;
}
