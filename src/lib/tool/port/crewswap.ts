// Port of crewswap.py: swap crew for one flight (out_ids/in_ids are staff ids
// compared from two Excel sheets). Network calls are injected so this stays
// unit-testable without a server import.
import type { Flight } from "../core/models";

export function staffDigits(v: unknown): string {
  const m = /(\d+)\s*$/.exec(String(v ?? "").trim());
  return m ? m[1]!.replace(/^0+/, "") : "";
}
export function usernameOf(staffId: string): string {
  const n = String(staffId ?? "").trim().replace(/^0+/, "");
  if (!n) return "";
  return n.length < 4 ? `VJC${n.padStart(4, "0")}` : `VJC${n}`;
}

export interface CrewRow {
  username?: string;
  forename?: string;
  surname?: string;
  job?: string | { name?: string } | undefined;
  pos?: string;
  deadheading?: boolean;
  deleted_on?: unknown;
  id?: number;
  [k: string]: unknown;
}

function jobName(row: CrewRow): string {
  const job = row.job;
  if (job && typeof job === "object") return String(job.name ?? "").trim();
  return String(job ?? "").trim();
}
function label(row: CrewRow): string {
  const name = [String(row.forename ?? "").trim(), String(row.surname ?? "").trim()].filter(Boolean).join(" ");
  const pos = jobName(row) || String(row.pos ?? "").trim();
  let tail = pos ? ` (${pos})` : "";
  if (row.deadheading) tail += " [DHD]";
  return `${row.username ?? "?"} ${name}${tail}`.trim();
}

export interface CrewItem {
  staff_id: string;
  username: string;
  label: string;
  note: string;
}
export interface CrewPlan {
  sector_id: number;
  callsign: string;
  route: string;
  remove: CrewItem[];
  add: CrewItem[];
  keep: string[];
  absent: CrewItem[];
  not_found: CrewItem[];
  already: CrewItem[];
  note: string;
  payload: CrewRow[];
}

function item(staffId: string, username: string, labelText = "", note = ""): CrewItem {
  return { staff_id: staffId, username, label: labelText, note };
}

export interface PlanSwapOps {
  currentCrew: CrewRow[];
  findUser: (username: string) => CrewRow | null;
  newRow: (sectorId: number, user: CrewRow) => CrewRow;
}

export function planSwap(flight: Flight, outIds: Iterable<string>, inIds: Iterable<string>, ops: PlanSwapOps): CrewPlan {
  const plan: CrewPlan = {
    sector_id: flight.id,
    callsign: flight.callsign,
    route: flight.route,
    remove: [],
    add: [],
    keep: [],
    absent: [],
    not_found: [],
    already: [],
    note: "",
    payload: [],
  };

  const wantOut = new Set([...outIds].map(staffDigits).filter(Boolean));
  const wantIn = new Set([...inIds].map(staffDigits).filter(Boolean));
  const both = [...wantOut].filter((x) => wantIn.has(x));
  if (both.length) {
    plan.note = "bỏ qua " + both.sort().join(", ") + " — có ở cả tổ bay cũ và mới";
    for (const x of both) {
      wantOut.delete(x);
      wantIn.delete(x);
    }
  }
  if (!wantOut.size && !wantIn.size) {
    plan.note = plan.note || "không có ai cần đổi";
    return plan;
  }

  const existing = ops.currentCrew;
  const keepRows: CrewRow[] = [];
  const hit = new Set<string>();
  for (const row of existing) {
    const d = staffDigits(row.username);
    if (d && wantOut.has(d)) {
      hit.add(d);
      plan.remove.push(item(d, String(row.username ?? ""), label(row)));
    } else {
      keepRows.push(row);
      plan.keep.push(label(row));
    }
  }
  for (const d of [...wantOut].filter((x) => !hit.has(x)).sort()) {
    plan.absent.push(item(d, usernameOf(d), "", "không có trên chuyến này"));
  }

  const have = new Set(keepRows.map((r) => staffDigits(r.username)).filter(Boolean));
  const newRows: CrewRow[] = [];
  for (const d of [...wantIn].sort()) {
    if (have.has(d)) {
      plan.already.push(item(d, usernameOf(d), "", "đã có trên chuyến"));
      continue;
    }
    const un = usernameOf(d);
    const user = ops.findUser(un);
    if (user === null) {
      plan.not_found.push(item(d, un, "", "không có user này trên FliteBrief"));
      continue;
    }
    const row = ops.newRow(flight.id, user);
    newRows.push(row);
    have.add(d);
    plan.add.push(item(d, un, label(user)));
  }

  plan.payload = [...keepRows, ...newRows];
  return plan;
}

export interface CrewResult {
  removed: number;
  added: number;
  failed: number;
  error: string;
}

export interface ApplySwapOps {
  /** POST sectors/{id}/crews with the full list; returns HTTP status + body text. */
  post: (payload: CrewRow[]) => Promise<{ status: number; text: string }>;
  onLine?: (text: string, cls?: string) => void;
}

export function isEmptyPlan(plan: CrewPlan): boolean {
  return !plan.remove.length && !plan.add.length;
}

export async function applySwap(plan: CrewPlan, ops: ApplySwapOps): Promise<CrewResult> {
  const res: CrewResult = { removed: 0, added: 0, failed: 0, error: "" };
  const say = (text: string, cls = "") => ops.onLine?.(text, cls);

  if (isEmptyPlan(plan)) {
    say("· không có ai cần đổi");
    return res;
  }
  if (!plan.payload.length) {
    res.error = "danh sách mới sẽ RỖNG — dừng lại, gửi lên là xoá sạch tổ bay của chuyến";
    res.failed = plan.remove.length + plan.add.length;
    say("✗ " + res.error, "bad");
    return res;
  }

  let r: { status: number; text: string };
  try {
    r = await ops.post(plan.payload);
  } catch (exc) {
    res.error = `lỗi mạng khi lưu tổ bay: ${(exc as Error).message || exc}`;
    res.failed = plan.remove.length + plan.add.length;
    say("✗ " + res.error, "bad");
    return res;
  }

  if (![200, 201, 204].includes(r.status) || r.text.trim().toLowerCase() === "false") {
    res.error = `lưu tổ bay thất bại: HTTP ${r.status} — ${r.text.slice(0, 160)}`;
    res.failed = plan.remove.length + plan.add.length;
    say("✗ " + res.error, "bad");
    return res;
  }

  for (const x of plan.remove) say(`✓ đã bỏ   ${x.label || x.username}`);
  for (const x of plan.add) say(`✓ đã thêm ${x.label || x.username}`);
  res.removed = plan.remove.length;
  res.added = plan.add.length;
  return res;
}
