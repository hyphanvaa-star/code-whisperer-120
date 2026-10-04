// Port of crew.py (parsing + planning parts, no HTTP) plus the crew_plan /
// _validated_crew_assignments helpers from web.py. FliteBrief calls (find_user,
// current_crew, add_crew) live in handlers/crew.server.ts since they need fetch.
import type { Flight } from "../core/models";
import type { Sheet } from "./excelcmp_reader";

export class CrewError extends Error {}

export class CrewPlanError extends Error {
  code: string;
  constructor(message: string, code = "invalid_crew_plan") {
    super(message);
    this.code = code;
  }
}

// -LE QUANG HIEU(CP) 7391        | -MARK NILENDRA MOHAN SILVA(CP, DHD) 3978
// -PATEL VIVEK MANOJKUMAR - NTSC(CP) 19529
const RE_PILOT = /^\s*-?\s*([^()]+?)\s*\(([^)]*)\)\s*(\d{3,6})/s;
const RE_ANY_ID = /\)\s*(\d{3,6})/;

export interface Pilot {
  raw: string;
  name: string;
  flags: string; // "CP", "FO", "CP, DHD", "CP+"…
  staff_id: string;
}

export function pilotDeadheading(p: Pilot): boolean {
  return p.flags.toUpperCase().includes("DHD");
}
export function pilotStarred(p: Pilot): boolean {
  return p.raw.includes("*");
}
/** DHD hoặc có dấu * thì không add lên hệ thống. */
export function pilotSkip(p: Pilot): boolean {
  return pilotDeadheading(p) || pilotStarred(p);
}
/** Mã nhân viên -> username FliteBrief. Mã 3 chữ số được đệm thêm 0. */
export function pilotUsername(p: Pilot): string {
  if (!p.staff_id) return "";
  const n = p.staff_id.replace(/^0+/, "") || p.staff_id;
  return n.length < 4 ? `VJC${n.padStart(4, "0")}` : `VJC${n}`;
}

export function parsePilot(text: unknown): Pilot {
  const raw = String(text ?? "");
  const p: Pilot = { raw, name: "", flags: "", staff_id: "" };
  const m = RE_PILOT.exec(raw);
  if (m) {
    p.name = (m[1] ?? "").split(/\s+/).filter(Boolean).join(" ");
    p.flags = (m[2] ?? "").trim();
    p.staff_id = m[3] ?? "";
    return p;
  }
  const m2 = RE_ANY_ID.exec(raw);
  if (m2) p.staff_id = m2[1] ?? "";
  return p;
}

export interface FlightCrew {
  fltno: string;
  pilots: Pilot[];
  block_id: string;
  row_no: number;
  date: string;
  dep: string;
  arr: string;
  std: string;
}

export function flightCrewRoute(b: FlightCrew): string {
  return b.dep && b.arr ? `${b.dep}-${b.arr}` : "";
}
export function flightCrewToAdd(b: FlightCrew): Pilot[] {
  return b.pilots.filter((p) => !pilotSkip(p) && p.staff_id);
}
export function flightCrewSkipped(b: FlightCrew): Pilot[] {
  return b.pilots.filter((p) => pilotSkip(p));
}

/** Port of crew.normalize_fltno. */
export function normalizeFltno(value: unknown): string {
  const key = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!key) return "";
  return /[A-Z]/.test(key) ? key : `VJC${key}`;
}

async function sha256Hex(parts: Array<string | ArrayBuffer>): Promise<string> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = parts.map((p) => (typeof p === "string" ? enc.encode(p) : new Uint8Array(p)));
  let len = 0;
  for (const c of chunks) len += c.length;
  const buf = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function blockId(sheetName: string, rowNo: number, fltno: string): Promise<string> {
  const hex = await sha256Hex([`${sheetName}\0${rowNo}\0${fltno}`]);
  return hex.slice(0, 16);
}

/** Port of crew.roster_revision: fingerprint file bytes + sheet name. */
export async function rosterRevision(buf: ArrayBuffer, sheetName: string): Promise<string> {
  return sha256Hex([buf, "\0", sheetName]);
}

function findCol(header: string[], ...names: string[]): string | null {
  for (const want of names) {
    const w = want.trim().toLowerCase();
    for (const h of header) if (h.trim().toLowerCase() === w) return h;
  }
  for (const want of names) {
    const w = want.trim().toLowerCase();
    for (const h of header) if (h.trim().toLowerCase().includes(w)) return h;
  }
  return null;
}

function cellValue(row: Record<string, unknown>, col: string | null): string {
  if (!col) return "";
  const value = row[col];
  return value == null ? "" : String(value).split(/\s+/).filter(Boolean).join(" ");
}

function sheetDicts(sheet: Sheet): Record<string, unknown>[] {
  return sheet.rows.map((r) => {
    const d: Record<string, unknown> = {};
    sheet.header.forEach((h, i) => (d[h] = i < r.length ? r[i] : null));
    return d;
  });
}

/** Port of crew.read_crew_blocks for an already-selected sheet. */
export async function readCrewBlocks(sheet: Sheet, sheetName: string): Promise<Map<string, FlightCrew[]>> {
  const cFlt = findCol(sheet.header, "FLT", "Flight No", "flightno", "callsign");
  const cCrew = findCol(sheet.header, "Crew");
  if (!cFlt || !cCrew) {
    throw new CrewError(`không thấy cột FLT và/hoặc Crew. Các cột đọc được: ${JSON.stringify(sheet.header)}`);
  }
  const cDate = findCol(sheet.header, "DATE", "Flight Date", "DOF");
  const cDep = findCol(sheet.header, "DEP", "Departure", "From");
  const cArr = findCol(sheet.header, "ARR", "Arrival", "DEST", "To");
  const cStd = findCol(sheet.header, "STD", "Departure Time");

  const out = new Map<string, FlightCrew[]>();
  let cur: FlightCrew | null = null;
  const dicts = sheetDicts(sheet);
  for (let i = 0; i < dicts.length; i++) {
    const row = dicts[i]!;
    const offset = sheet.header_row + 2 + i;
    const fltS = cellValue(row, cFlt);
    if (fltS) {
      const key = normalizeFltno(fltS);
      cur = {
        fltno: key,
        block_id: await blockId(sheetName, offset, key),
        row_no: offset,
        date: cellValue(row, cDate),
        dep: cellValue(row, cDep).toUpperCase(),
        arr: cellValue(row, cArr).toUpperCase(),
        std: cellValue(row, cStd),
        pilots: [],
      };
      const arr = out.get(key) ?? [];
      arr.push(cur);
      out.set(key, arr);
    }
    const crewCell = row[cCrew];
    if (cur !== null && crewCell !== null && crewCell !== undefined && crewCell !== "") {
      cur.pilots.push(parsePilot(crewCell));
    }
  }
  return out;
}

/** Port of crew.read_crew: unique-only view; duplicates fail-safe. */
export function readCrewUnique(blocks: Map<string, FlightCrew[]>): Map<string, FlightCrew> {
  const dup = [...blocks.entries()].filter(([, v]) => v.length > 1).map(([k]) => k).sort();
  if (dup.length) throw new CrewError("Excel có callsign trùng cần chọn theo route: " + dup.join(", "));
  const out = new Map<string, FlightCrew>();
  for (const [key, values] of blocks) {
    const block = values[0]!;
    out.set(key, block);
    const digits = key.replace(/\D/g, "");
    if (digits && !out.has(digits)) out.set(digits, block);
  }
  return out;
}

// --------------------------------------------------------------------------- #
// web.py crew_plan / _validated_crew_assignments (pure parts)
// --------------------------------------------------------------------------- #

function parseDateLoose(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.replace("Z", "+00:00"));
  if (iso) return { y: +iso[1]!, m: +iso[2]!, d: +iso[3]! };
  const fmts: Array<[RegExp, (m: RegExpExecArray) => { y: number; m: number; d: number }]> = [
    [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m) => ({ d: +m[1]!, m: +m[2]!, y: +m[3]! })],
    [/^(\d{2})\/(\d{2})\/(\d{2})$/, (m) => ({ d: +m[1]!, m: +m[2]!, y: 2000 + +m[3]! })],
    [/^(\d{4})\/(\d{2})\/(\d{2})$/, (m) => ({ y: +m[1]!, m: +m[2]!, d: +m[3]! })],
    [/^(\d{2})-(\d{2})-(\d{4})$/, (m) => ({ d: +m[1]!, m: +m[2]!, y: +m[3]! })],
    [/^(\d{2})-(\d{2})-(\d{2})$/, (m) => ({ d: +m[1]!, m: +m[2]!, y: 2000 + +m[3]! })],
    [/^(\d{4})(\d{2})(\d{2})$/, (m) => ({ y: +m[1]!, m: +m[2]!, d: +m[3]! })],
  ];
  for (const [re, f] of fmts) {
    const mm = re.exec(s);
    if (mm) return f(mm);
  }
  return null;
}

function parseTimeLoose(raw: string): { h: number; mi: number; s: number } | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return { h: +m[1]!, mi: +m[2]!, s: +m[3]! };
  m = /^(\d{2}):(\d{2})$/.exec(s);
  if (m) return { h: +m[1]!, mi: +m[2]!, s: 0 };
  m = /^(\d{2})(\d{2})$/.exec(s);
  if (m) return { h: +m[1]!, mi: +m[2]!, s: 0 };
  m = /^(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (m) return { h: +m[1]!, mi: +m[2]!, s: +m[3]! };
  return null;
}

/** Port of web.py _crew_local_when: ghép DATE + STD của roster thành "giờ local"
 *  naive, trả về mốc thời gian tính bằng mili-giây UTC-giả (chỉ dùng để so lệch). */
export function crewLocalWhen(block: FlightCrew): number | null {
  const day = parseDateLoose(String(block.date ?? ""));
  if (!day) return null;
  const time = parseTimeLoose(String(block.std ?? "")) ?? { h: 0, mi: 0, s: 0 };
  return Date.UTC(day.y, day.m - 1, day.d, time.h, time.mi, time.s);
}

/** fb_local tương ứng: std (UTC) + 7h, lấy như giờ "naive". */
function fbLocalWhen(std: Date): number {
  const shifted = new Date(std.getTime() + 7 * 3600_000);
  return Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds(),
  );
}

export function crewRouteMatches(block: FlightCrew, flight: Flight): boolean {
  const route: [string, string] = [(block.dep || "").toUpperCase(), (block.arr || "").toUpperCase()];
  if (!route[0] || !route[1]) return false;
  const a: [string, string] = [(flight.dep_iata || "").toUpperCase(), (flight.dest_iata || "").toUpperCase()];
  const b: [string, string] = [(flight.dep_icao || "").toUpperCase(), (flight.dest_icao || "").toUpperCase()];
  return (route[0] === a[0] && route[1] === a[1]) || (route[0] === b[0] && route[1] === b[1]);
}

/** Port of web.py _crew_candidate_score: [route_rank, gap_seconds, row_no]. */
export function crewCandidateScore(block: FlightCrew, flight: Flight): [number, number, number] {
  let routeRank: number;
  if (block.dep && block.arr) routeRank = crewRouteMatches(block, flight) ? 0 : 2;
  else routeRank = 1;
  const local = crewLocalWhen(block);
  let gap = Infinity;
  if (local !== null && flight.std) gap = Math.abs(fbLocalWhen(flight.std) - local) / 1000;
  return [routeRank, gap, block.row_no || 0];
}

function cmpScore(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export interface CrewCandidate {
  block_id: string;
  row_no: number;
  callsign: string;
  date: string;
  dep: string;
  arr: string;
  route: string;
  std: string;
  pilots: Array<{ username: string; name: string; flags: string; skipped: boolean }>;
  pilot_count: number;
  skipped_count: number;
  recommended: boolean;
}

export function crewCandidateDict(block: FlightCrew, recommended: boolean): CrewCandidate {
  return {
    block_id: block.block_id,
    row_no: block.row_no,
    callsign: block.fltno,
    date: block.date,
    dep: block.dep,
    arr: block.arr,
    route: flightCrewRoute(block),
    std: block.std,
    pilots: block.pilots.map((p) => ({
      username: pilotUsername(p),
      name: p.name || p.raw.trim(),
      flags: p.flags,
      skipped: pilotSkip(p),
    })),
    pilot_count: flightCrewToAdd(block).length,
    skipped_count: flightCrewSkipped(block).length,
    recommended,
  };
}

export interface CrewTarget {
  sector_id: number;
  callsign: string;
  route: string;
  route_iata: string;
  std: string;
  requires_choice: boolean;
  missing: boolean;
  assignment: string;
  recommended: string;
  candidates: CrewCandidate[];
}

export interface CrewPlanResult {
  file: string;
  sheet: string;
  roster_revision: string;
  targets: CrewTarget[];
  assignments: Record<string, string>;
  duplicate_groups: Array<{ callsign: string; excel_blocks: number; sectors: number }>;
  needs_choice: boolean;
  blocks: number;
}

/** Port of web.py crew_plan() body (after flights/blocks are already loaded). */
export function buildCrewPlan(
  file: string,
  sheet: string,
  revision: string,
  blocks: Map<string, FlightCrew[]>,
  flights: Flight[],
): CrewPlanResult {
  const targetsByCallsign = new Map<string, Flight[]>();
  for (const flight of flights) {
    const key = normalizeFltno(flight.callsign);
    const arr = targetsByCallsign.get(key) ?? [];
    arr.push(flight);
    targetsByCallsign.set(key, arr);
  }

  const targets: CrewTarget[] = [];
  const assignments: Record<string, string> = {};
  const duplicateGroups: CrewPlanResult["duplicate_groups"] = [];

  for (const [callsign, group] of targetsByCallsign) {
    const candidates = [...(blocks.get(callsign) ?? [])];
    const ambiguousGroup = candidates.length > 1 || group.length > 1;
    if (ambiguousGroup) {
      duplicateGroups.push({ callsign, excel_blocks: candidates.length, sectors: group.length });
    }
    for (const flight of group) {
      const ranked = [...candidates].sort((a, b) => cmpScore(crewCandidateScore(a, flight), crewCandidateScore(b, flight)));
      const recommended = ranked[0]?.block_id ?? "";
      const requiresChoice = ambiguousGroup && candidates.length > 0;
      let assignment = "";
      if (!candidates.length || (flight.crew_count > 0 && !requiresChoice)) assignment = "skip";
      else if (!requiresChoice) assignment = candidates[0]!.block_id;
      if (assignment) assignments[String(flight.id)] = assignment;
      targets.push({
        sector_id: flight.id,
        callsign: flight.callsign,
        route: flight.route,
        route_iata: flight.dep_iata && flight.dest_iata ? `${flight.dep_iata}-${flight.dest_iata}` : "",
        std: flight.std ? flight.std.toISOString() : "",
        requires_choice: requiresChoice,
        missing: !candidates.length,
        assignment,
        recommended,
        candidates: candidates.map((block) => crewCandidateDict(block, block.block_id === recommended)),
      });
    }
  }

  return {
    file,
    sheet,
    roster_revision: revision,
    targets,
    assignments,
    duplicate_groups: duplicateGroups,
    needs_choice: targets.some((t) => t.requires_choice),
    blocks: [...blocks.values()].reduce((n, v) => n + v.length, 0),
  };
}

export interface ValidatedAssignment {
  flight: Flight;
  block: FlightCrew | null;
}

/** Port of web.py _validated_crew_assignments (minus the initial crew_plan()
 *  call, which the caller must do and pass in as `plan`). */
export function validateCrewAssignments(opts: {
  plan: CrewPlanResult;
  assignmentsRaw: Record<string, unknown>;
  rosterRevision: string;
  currentFlights: Map<number, Flight>;
  inOpsWindow: (f: Flight) => boolean;
  freshRevision: string;
  freshFile: string;
  freshSheet: string;
  freshBlocks: Map<string, FlightCrew[]>;
}): ValidatedAssignment[] {
  const { plan, assignmentsRaw, rosterRevision, currentFlights, inOpsWindow, freshRevision, freshFile, freshSheet, freshBlocks } = opts;

  if (!rosterRevision) throw new CrewPlanError("Thiếu roster_revision — hãy lập lại kế hoạch crew.");
  if (plan.roster_revision !== rosterRevision) {
    throw new CrewPlanError("File Excel đã thay đổi sau khi bạn xem crew — hãy chọn lại.", "stale_revision");
  }

  const targetById = new Map<number, CrewTarget>();
  for (const t of plan.targets) targetById.set(t.sector_id, t);

  const clean = new Map<number, string>();
  for (const [rawSector, rawBlock] of Object.entries(assignmentsRaw)) {
    const sectorId = Number(rawSector);
    if (!Number.isFinite(sectorId)) throw new CrewPlanError(`sector_id không hợp lệ: ${rawSector}`);
    if (clean.has(sectorId)) throw new CrewPlanError(`sector_id bị lặp: ${sectorId}`);
    clean.set(sectorId, String(rawBlock ?? "").trim());
  }

  const expected = new Set(targetById.keys());
  const actual = new Set(clean.keys());
  const extra = [...actual].filter((x) => !expected.has(x)).sort((a, b) => a - b);
  const missing = [...expected].filter((x) => !actual.has(x)).sort((a, b) => a - b);
  if (extra.length) throw new CrewPlanError("Payload có sector lạ: " + extra.join(", "));
  if (missing.length) throw new CrewPlanError("Chưa chọn hoặc bỏ qua crew cho sector: " + missing.join(", "));

  const usedBlocks = new Set<string>();
  const validated: ValidatedAssignment[] = [];

  if (freshRevision !== rosterRevision || freshFile !== plan.file || freshSheet !== (plan.sheet || "")) {
    throw new CrewPlanError("File Excel đã thay đổi sau khi bạn xem crew — hãy chọn lại.", "stale_revision");
  }
  const allBlocks = new Map<string, FlightCrew>();
  for (const values of freshBlocks.values()) for (const block of values) allBlocks.set(block.block_id, block);

  for (const [sectorId, target] of targetById) {
    const flight = currentFlights.get(sectorId);
    if (!flight || !inOpsWindow(flight)) {
      throw new CrewPlanError(`Sector ${sectorId} không còn trong cửa sổ thao tác.`);
    }
    const choice = clean.get(sectorId) ?? "";
    if (choice === "skip") {
      validated.push({ flight, block: null });
      continue;
    }
    const allowed = new Set(target.candidates.map((c) => String(c.block_id)));
    if (!choice || !allowed.has(choice)) {
      throw new CrewPlanError(`Block ${choice || "(trống)"} không thuộc ${flight.callsign} sector ${sectorId}.`);
    }
    if (usedBlocks.has(choice)) {
      throw new CrewPlanError(`Block Excel ${choice} bị gán cho nhiều sector — hãy chọn/skip lại.`);
    }
    const block = allBlocks.get(choice);
    if (!block || normalizeFltno(block.fltno) !== normalizeFltno(flight.callsign)) {
      throw new CrewPlanError(`Block Excel ${choice} không còn khớp ${flight.callsign}.`);
    }
    usedBlocks.add(choice);
    validated.push({ flight, block });
  }
  return validated;
}
