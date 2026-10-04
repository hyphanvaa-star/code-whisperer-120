// Port of briefing.py — pure matching logic (no disk/server access; the
// Worker gets its file list from the private bucket instead of a local
// folder, see handlers/briefing.server.ts).
import type { Flight } from "../core/models";

// Accepts VJC1112_Briefing.pdf, VJC1112-briefing.pdf, VJC1112.pdf
const RE_BRIEF = /^(?<cs>[A-Z]{2,3}\d{1,5})(?:[\s._-]*brief(?:ing)?)?$/i;

export function briefCallsign(name: string): string {
  const stem = String(name ?? "").replace(/\.pdf$/i, "").trim();
  const m = RE_BRIEF.exec(stem);
  return m?.groups?.["cs"] ? m.groups["cs"].toUpperCase() : "";
}

export interface BriefFile {
  name: string;
  callsign: string;
}

/** web.py briefing.list_files(): keep only names that parse to a callsign, sorted by name. */
export function listBriefFiles(names: string[]): BriefFile[] {
  const out: BriefFile[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    if (!name.toLowerCase().endsWith(".pdf")) continue;
    const cs = briefCallsign(name);
    if (!cs) continue;
    out.push({ name, callsign: cs });
  }
  return out;
}

export interface BriefPlan {
  file: BriefFile;
  flight: Flight | null;
  note: string;
  already: boolean;
}

export function briefLabel(plan: BriefPlan): string {
  return plan.flight ? `${plan.flight.callsign} (${plan.flight.route})` : plan.file.callsign;
}

/** web.py briefing._pick_closest. */
export function pickClosest(cands: Flight[], now = new Date()): Flight | null {
  const withStd = cands.filter((f) => f.std !== null);
  if (!withStd.length) return null;
  withStd.sort((a, b) => Math.abs(a.std!.getTime() - now.getTime()) - Math.abs(b.std!.getTime() - now.getTime()));
  const best = withStd[0]!;
  const bestDay = best.std!.toISOString().slice(0, 10);
  const sameDay = withStd.filter((f) => f.std!.toISOString().slice(0, 10) === bestDay);
  if (sameDay.length > 1) return null;
  return best;
}

/** web.py briefing.preview(). */
export function previewBriefing(flights: Flight[], files: BriefFile[], now = new Date()): BriefPlan[] {
  const plans: BriefPlan[] = [];
  for (const bf of files) {
    const cands = flights.filter((f) => f.callsign.toUpperCase() === bf.callsign);
    if (!cands.length) {
      plans.push({ file: bf, flight: null, note: "không thấy chuyến trên FliteBrief", already: false });
      continue;
    }
    let f: Flight | null;
    if (cands.length === 1) {
      f = cands[0]!;
    } else {
      f = pickClosest(cands, now);
      if (!f) {
        const legs = cands.map((c) => c.route).join(", ");
        plans.push({
          file: bf,
          flight: null,
          note: `${cands.length} chặng trùng số hiệu cùng ngày (${legs}) — bỏ qua`,
          already: false,
        });
        continue;
      }
    }
    const have = f.attachments.some((a) => a.filename().toLowerCase() === bf.name.toLowerCase());
    plans.push({ file: bf, flight: f, note: have ? "đã có trên chuyến" : "", already: have });
  }
  return plans;
}
