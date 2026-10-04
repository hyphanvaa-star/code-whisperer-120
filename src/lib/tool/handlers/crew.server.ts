// Port of web.py "/api/crew/plan" + "/api/crew/add" (crew.py add-pilot-to-FliteBrief
// logic + the crew_plan/_validated_crew_assignments/start_crew_add glue in web.py).
import type { Ctx, Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import { loadFlights } from "../core/gantts.server";
import { pickFlights, inOpsWindow } from "../port/notices";
import * as excelMod from "./excel.server";
import {
  CrewPlanError,
  buildCrewPlan,
  readCrewBlocks,
  rosterRevision,
  validateCrewAssignments,
  type FlightCrew,
  type Pilot,
  type CrewPlanResult,
} from "../port/crewPlan";

const ALLCREW = "/webapi/allcrew";
const sectorCrewsPath = (sectorId: number) => `/webapi/sectors/${sectorId}/crews`;

async function crewSource(ctx: Ctx) {
  const state = await excelMod.currentExcel(ctx);
  if (!state) throw new CrewPlanError("Chưa nạp file Crewlist — bấm 'Crewlist Aims' trước.");
  const sheetName = state.sheet || "";
  const { buf, sheets } = await excelMod.readSheet(ctx, state.file);
  const revision = await rosterRevision(buf, sheetName);
  const sheet = excelMod.pickSheet(sheets, sheetName);
  const blocks = await readCrewBlocks(sheet, sheet.name);
  return { state: { file: state.file, sheet: sheetName }, blocks, revision };
}

async function crewPlan(ctx: Ctx, callsigns: string[], days: number): Promise<CrewPlanResult> {
  const { state, blocks, revision } = await crewSource(ctx);
  const flights = pickFlights(await loadFlights(days), callsigns);
  if (!flights.length) {
    throw new CrewPlanError(
      "Không có chuyến nào khớp danh sách trong bảng. Gõ số hiệu vào cột FLT NO (hoặc PIB/WX) trước.",
    );
  }
  return buildCrewPlan(state.file, state.sheet, revision, blocks, flights);
}

async function validatedCrewAssignments(
  ctx: Ctx,
  callsigns: string[],
  assignmentsRaw: Record<string, unknown>,
  rosterRevisionParam: string,
  days: number,
) {
  if (!rosterRevisionParam) throw new CrewPlanError("Thiếu roster_revision — hãy lập lại kế hoạch crew.");
  if (typeof assignmentsRaw !== "object" || assignmentsRaw === null) {
    throw new CrewPlanError("assignments phải là object sector_id → block_id/skip.");
  }
  const plan = await crewPlan(ctx, callsigns, days);
  if (plan.roster_revision !== rosterRevisionParam) {
    throw new CrewPlanError("File Excel đã thay đổi sau khi bạn xem crew — hãy chọn lại.", "stale_revision");
  }

  const currentFlights = new Map<number, Awaited<ReturnType<typeof loadFlights>>[number]>();
  for (const f of pickFlights(await loadFlights(days), callsigns)) currentFlights.set(f.id, f);

  const { state: freshState, blocks: freshBlocks, revision: freshRevision } = await crewSource(ctx);

  const validated = validateCrewAssignments({
    plan,
    assignmentsRaw,
    rosterRevision: rosterRevisionParam,
    currentFlights,
    inOpsWindow,
    freshRevision,
    freshFile: freshState.file,
    freshSheet: freshState.sheet,
    freshBlocks,
  });
  return { plan, validated };
}

// --------------------------------------------------------------------------- #
// FliteBrief calls (port of crew.find_user / current_crew / add_crew)
// --------------------------------------------------------------------------- #

async function findUser(username: string): Promise<Record<string, unknown> | null> {
  const { fbGet } = await import("@/lib/flitebrief.server");
  const want = username.trim().toUpperCase();
  const tryOp = async (op: string) => {
    const params = new URLSearchParams({
      "filter[logic]": "and",
      "filter[filters][0][field]": "username",
      "filter[filters][0][operator]": op,
      "filter[filters][0][value]": username,
    });
    try {
      const res = await fbGet(`${ALLCREW}?${params.toString()}`);
      const d = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const rows = Array.isArray(d?.data) ? d.data : [];
      for (const r of rows) if (String(r["username"] ?? "").trim().toUpperCase() === want) return r;
    } catch {
      /* ignore, caller falls back / returns null */
    }
    return null;
  };
  return (await tryOp("eq")) ?? (await tryOp("contains"));
}

async function currentCrew(sectorId: number): Promise<Array<Record<string, unknown>>> {
  const { fbJson } = await import("@/lib/flitebrief.server");
  const data = await fbJson<unknown>(sectorCrewsPath(sectorId));
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).filter((c) => !c["deleted_on"]);
}

function newCrewRow(sectorId: number, user: Record<string, unknown>) {
  return {
    sector_id: sectorId,
    user_id: user["id"],
    forename: user["forename"] || "",
    surname: user["surname"] || "",
    username: user["username"] || "",
    pos: user["pos"] || "",
    commander: user["commander"] || 0,
    duty_code: user["duty_code"] ?? null,
    deadheading: user["deadheading"] ?? null,
  };
}

interface AddResult {
  sector_id: number;
  added: string[];
  already: string[];
  skipped_dhd: string[];
  not_found: string[];
  error: string;
}

/** Port of crew.add_crew. */
async function addCrew(sectorId: number, pilots: Pilot[], dryRun: boolean): Promise<AddResult> {
  const res: AddResult = { sector_id: sectorId, added: [], already: [], skipped_dhd: [], not_found: [], error: "" };
  const { pilotSkip, pilotUsername } = await import("../port/crewPlan");

  for (const p of pilots) {
    if (pilotSkip(p)) res.skipped_dhd.push(`${p.name || p.raw.trim().slice(0, 28)} (${p.flags})`);
  }
  const want = pilots.filter((p) => !pilotSkip(p) && p.staff_id);
  if (!want.length) return res;

  let existing: Array<Record<string, unknown>>;
  try {
    existing = await currentCrew(sectorId);
  } catch (e) {
    res.error = `không đọc được crew hiện có: ${e instanceof Error ? e.message : String(e)}`;
    return res;
  }

  const haveIds = new Set(existing.map((c) => c["user_id"]));
  const haveUsers = new Set(existing.map((c) => String(c["username"] ?? "").toUpperCase()));
  const newRows: Array<Record<string, unknown>> = [];

  for (const p of want) {
    const username = pilotUsername(p);
    if (haveUsers.has(username.toUpperCase())) {
      res.already.push(username);
      continue;
    }
    const user = await findUser(username);
    if (user === null) {
      res.not_found.push(username);
      continue;
    }
    if (haveIds.has(user["id"])) {
      res.already.push(username);
      continue;
    }
    newRows.push(newCrewRow(sectorId, user));
    haveIds.add(user["id"]);
    haveUsers.add(username.toUpperCase());
    res.added.push(username);
  }

  if (!newRows.length || dryRun) return res;

  const { fbRequest } = await import("@/lib/flitebrief.server");
  const payload = [...existing, ...newRows];
  const body = new URLSearchParams({ data: JSON.stringify(payload) });
  const r = await fbRequest("POST", sectorCrewsPath(sectorId), { body });
  const text = await r.text().catch(() => "");
  if (![200, 201, 204].includes(r.status) || text.trim().toLowerCase() === "false") {
    res.error = `lưu crew thất bại: HTTP ${r.status} — ${text.slice(0, 160)}`;
    res.added = [];
    return res;
  }
  return res;
}

export const routes: Routes = {
  "POST /api/crew/plan": async (ctx) => {
    const body = await ctx.json();
    const callsigns = ((body["callsigns"] as unknown[]) ?? []).map((x) => String(x));
    const days = Number.parseInt(String(body["days"] ?? "1"), 10) || 1;
    try {
      return await crewPlan(ctx, callsigns, days);
    } catch (e) {
      const out: Record<string, unknown> = { error: e instanceof Error ? e.message : String(e) };
      if (e instanceof CrewPlanError) out["code"] = e.code;
      return out;
    }
  },

  "POST /api/crew/add": async (ctx) => {
    const body = await ctx.json();
    const assignments = (body["assignments"] ?? {}) as Record<string, unknown>;
    if (typeof assignments !== "object" || assignments === null || Array.isArray(assignments)) {
      return { error: "assignments phải là object sector_id → block_id/skip." };
    }
    const callsigns = ((body["callsigns"] as unknown[]) ?? []).map((x) => String(x));
    const days = Number.parseInt(String(body["days"] ?? "1"), 10) || 1;
    const dryRun = !!body["dry_run"];
    const rev = String(body["roster_revision"] ?? "");
    try {
      await validatedCrewAssignments(ctx, callsigns, assignments, rev, days);
      return { id: jobId("crew_add", { callsigns, days, dry_run: dryRun, assignments, roster_revision: rev }) };
    } catch (e) {
      const out: Record<string, unknown> = { error: e instanceof Error ? e.message : String(e) };
      if (e instanceof CrewPlanError) out["code"] = e.code;
      return out;
    }
  },
};

export const jobs: Jobs = {
  // Port of web.py start_crew_add() work(): validates again (job runs fresh,
  // separate request from /api/crew/add's own validation) then adds each block.
  crew_add: async (params, emit, ctx) => {
    const t0 = Date.now();
    const callsigns = ((params["callsigns"] as string[] | undefined) ?? []).map(String);
    const days = Number(params["days"] ?? 1) || 1;
    const dryRun = !!params["dry_run"];
    const assignments = (params["assignments"] as Record<string, unknown>) ?? {};
    const rosterRevisionParam = String(params["roster_revision"] ?? "");

    let plan: CrewPlanResult;
    let validated: Awaited<ReturnType<typeof validatedCrewAssignments>>["validated"];
    try {
      const r = await validatedCrewAssignments(ctx, callsigns, assignments, rosterRevisionParam, days);
      plan = r.plan;
      validated = r.validated;
    } catch (e) {
      emit({ type: "line", text: `✗ ${e instanceof Error ? e.message : String(e)}`, cls: "bad" });
      emit({ type: "end", code: 1, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 1, dhd: 0, not_found: 0, missing: [] });
      return;
    }

    const mode = dryRun ? "[XEM TRƯỚC] " : "";
    emit({ type: "line", text: `▶ ${mode}${validated.length} sector · Excel có ${plan.blocks} block crew · bỏ qua DHD/*` });

    let ok = 0, already = 0, skip = 0, nf = 0, fail = 0;
    for (let i = 0; i < validated.length; i++) {
      const { flight, block } = validated[i]!;
      const progress = (i + 1) / Math.max(1, validated.length);
      if (block === null) {
        const target = plan.targets.find((t) => t.sector_id === flight.id);
        const text = target?.missing
          ? `! ${flight.callsign} (${flight.route}): Excel không có crew`
          : `⊘ ${flight.callsign} (${flight.route}): đã chọn bỏ qua`;
        emit({ type: "line", text, cls: target?.missing ? "bad" : undefined, progress });
        continue;
      }
      const source = `Excel ${block.dep && block.arr ? `${block.dep}-${block.arr}` : "?"} dòng ${block.row_no}`;
      const audit = `${flight.callsign} (${flight.route}) ← ${source}`;
      const r = await addCrew(flight.id, block.pilots, dryRun);
      if (r.error) {
        fail++;
        emit({ type: "line", text: `✗ ${audit}: ${r.error}`, cls: "bad", progress });
        continue;
      }
      if (r.added.length) {
        ok += r.added.length;
        const verb = dryRun ? "sẽ thêm" : "đã thêm";
        emit({ type: "line", text: `✓ ${audit} · ${verb}: ${r.added.join(", ")}`, found: flight.callsign, progress });
      } else if (!r.skipped_dhd.length && !r.not_found.length) {
        emit({ type: "line", text: `· ${audit}: crew đã đủ`, progress });
      }
      already += r.already.length;
      skip += r.skipped_dhd.length;
      nf += r.not_found.length;
      for (const s of r.skipped_dhd) emit({ type: "line", text: `    ⊘ bỏ DHD/*: ${s}` });
      for (const u of r.not_found) emit({ type: "line", text: `    ? không có user ${u} trên hệ thống`, cls: "bad" });
    }

    emit({
      type: "end",
      code: fail ? 2 : 0,
      elapsed: (Date.now() - t0) / 1000,
      ok, skipped: already, failed: fail, dhd: skip, not_found: nf, missing: [],
    });
  },
};
