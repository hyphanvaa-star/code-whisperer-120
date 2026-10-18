import type { Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import type { Flight } from "../core/models";
import { formatReg, defectsFor, draftFromFlight, toPdf, pdfFilename } from "../port/briefingRelease";
import { uploadAndAttach } from "./briefing.server";
import { loadBriefingData } from "../briefing-data.server";
import { readPreviousBriefing, restorePreviousBriefing } from "../port/briefingPrevious";

// Port of web.py "/api/briefswap/*" (api/briefswap.py + web.py briefswap_preview /
// start_briefswap). Đổi tờ Official Briefing khi đổi tàu: soạn mới → xoá cũ → gắn mới.

function briefCallsignOf(name: string): string {
  const m = /([A-Z]{2,3}\d{2,4})/.exec((name || "").toUpperCase());
  return m ? m[1] : "";
}

/** Port of briefswap.py attachments_on(): briefing đang gắn, tên khớp VJCxxx_Briefing. */
function attachmentsOn(flight: Flight) {
  const cs = (flight.callsign || "").toUpperCase();
  if (!cs) return [];
  return flight.attachments.filter((a) => {
    if (a.is_deleted) return false;
    for (const raw of [a.original_filename, a.title]) {
      const s = String(raw ?? "");
      // Chỉ tờ briefing (tên có "brief"); PIB/WX/notice cùng số hiệu chuyến không được xoá.
      if (!/brief/i.test(s) || /\bPIB|NOTAM|WX|MET/i.test(s)) continue;
      if (briefCallsignOf(s) === cs) return true;
    }
    return false;
  });
}

function csFile(callsign: string): string {
  const cs = (callsign || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${cs}_Briefing.pdf`;
}

async function findSector(sectorId: number, days: number): Promise<Flight> {
  const { loadFlights } = await import("../core/gantts.server");
  const flights = await loadFlights(days);
  const f = flights.find((x) => x.id === sectorId);
  if (!f) throw new Error(`không thấy chuyến sector_id=${sectorId} trên FliteBrief`);
  return f;
}

async function opsWindowCheck(f: Flight): Promise<string> {
  const { inOpsWindow } = await import("../port/notices");
  if (inOpsWindow(f)) return "";
  const label = "STD trong −6h…+24h (ngày VN ±1 khi còn trong cửa sổ)";
  return `${f.callsign}: ngoài cửa sổ thao tác (${label}) — STD ${f.std ?? ""}.`;
}

async function loadAircraft(ctx: Parameters<Routes[string]>[0]): Promise<unknown[]> {
  const { getJson } = await import("../store.server");
  const data = await getJson<{ aircraft?: unknown[] } | null>(ctx, "limits", null);
  return Array.isArray(data?.aircraft) ? data.aircraft : [];
}

async function upPrivileges(): Promise<Record<string, unknown>> {
  const { fbJson } = await import("@/lib/flitebrief.server");
  try {
    return await fbJson<Record<string, unknown>>("/webapi/sector/attachments/privileges");
  } catch {
    return {};
  }
}

function planReplace(flight: Flight, newReg: string, aircraft: unknown[]) {
  const useReg = formatReg(newReg || flight.reg);
  const deleteList = attachmentsOn(flight).map((a) => ({
    id: a.id,
    filename: a.original_filename || a.title || String(a.id),
    title: a.title || a.original_filename,
  }));
  return {
    sector_id: flight.id,
    callsign: flight.callsign,
    route: flight.route,
    new_reg: useReg,
    old_reg: formatReg(flight.reg),
    filename: csFile(flight.callsign),
    defects: defectsFor(useReg, aircraft),
    delete: deleteList,
  };
}

async function fetchOfpPdfLocal(sectorId: number): Promise<Uint8Array | null> {
  const { fbGet } = await import("@/lib/flitebrief.server");
  for (const path of [`/webapi/sectors/${sectorId}/ofp/0`, `/webapi/sectors/${sectorId}/ofp`]) {
    const res = await fbGet(path, "application/pdf");
    if (!res.ok || res.status === 204) continue;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength) return buf;
  }
  return null;
}

async function ofpPdfTextLocal(blob: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(blob);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

export const routes: Routes = {
  "GET /api/briefswap/preview": async (ctx) => {
    const sectorId = Number(ctx.params.get("sector_id") || "0");
    const newReg = ctx.params.get("new_reg") || "";
    const days = Number(ctx.params.get("days") || "2") || 2;
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!newReg.trim()) return { error: "thiếu số hiệu tàu mới" };
    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      return { error: (exc as Error).message };
    }
    const why = await opsWindowCheck(f);
    if (why) return { error: `${why} Không đổi briefing chuyến đã bay / ngoài ngày.` };
    const aircraft = await loadAircraft(ctx);
    const plan = planReplace(f, newReg, aircraft);
    const privileges = await upPrivileges();
    return { ...plan, privileges };
  },

  "POST /api/briefswap/preview": async (ctx) => {
    const body = await ctx.json();
    const sectorId = Number(body["sector_id"] ?? 0);
    const newReg = String(body["new_reg"] ?? "");
    const days = Number(body["days"] ?? 2) || 2;
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!newReg.trim()) return { error: "thiếu số hiệu tàu mới" };
    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      return { error: (exc as Error).message };
    }
    const why = await opsWindowCheck(f);
    if (why) return { error: `${why} Không đổi briefing chuyến đã bay / ngoài ngày.` };
    const aircraft = await loadAircraft(ctx);
    const plan = planReplace(f, newReg, aircraft);
    const privileges = await upPrivileges();
    return { ...plan, privileges };
  },

  "POST /api/briefswap/run": async (ctx) => {
    const body = await ctx.json();
    const sectorId = Number(body["sector_id"] ?? 0);
    const newReg = String(body["new_reg"] ?? "");
    const days = Number(body["days"] ?? 2) || 2;
    if (!sectorId) return { error: "thiếu sector_id" };
    if (!newReg.trim()) return { error: "thiếu số hiệu tàu mới" };
    return { id: jobId("briefswap", { sectorId, newReg, days }) };
  },
};

export const jobs: Jobs = {
  // Port of web.py start_briefswap(): soạn OFP → draft PDF mới (defect tàu mới)
  // → xoá briefing cũ trên sector → gắn tờ mới.
  briefswap: async (params, emit, ctx) => {
    const t0 = Date.now();
    const sectorId = Number(params["sectorId"]);
    const newReg = String(params["newReg"] ?? "");
    const days = Number(params["days"] ?? 2);
    const end = (code: number, extra: Record<string, unknown> = {}) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ok: 0, skipped: 0, failed: 0, missing: [], ...extra });

    let f: Flight;
    try {
      f = await findSector(sectorId, days);
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error).message}`, cls: "bad" });
      return end(1, { failed: 1 });
    }
    const why = await opsWindowCheck(f);
    if (why) {
      emit({ type: "line", text: `✗ ${why}`, cls: "bad" });
      return end(1, { failed: 1 });
    }

    const aircraft = await loadAircraft(ctx);
    const plan = planReplace(f, newReg, aircraft);
    emit({ type: "line", text: `▶ ${plan.callsign} (${plan.route}) · briefing ${plan.old_reg || "?"} → ${plan.new_reg}` });
    for (const d of plan.delete) emit({ type: "line", text: `- sẽ xoá  ${d.filename}` });
    if (plan.defects.length) emit({ type: "line", text: `· defect tàu mới: ${plan.defects.length} mục` });
    else emit({ type: "line", text: "· tàu mới không có defect trong limits" });

    const priv = await upPrivileges();
    if (!priv["create"]) {
      emit({ type: "line", text: "✗ tài khoản không có quyền đính kèm", cls: "bad" });
      return end(1, { failed: plan.delete.length || 1 });
    }

    let sheet;
    try {
      // Actual sector attachment is authoritative, never callsign-only saved edits.
      const oldFiles = attachmentsOn(f).sort((a, b) => (b.created_on?.getTime() ?? 0) - (a.created_on?.getTime() ?? 0) || b.id - a.id);
      let previous;
      if (oldFiles.length) {
        const old = oldFiles[0];
        if (!old) throw new Error("Không xác định được Briefing cũ.");
        const { fbGet } = await import("@/lib/flitebrief.server");
        emit({ type: "line", text: `· đang đọc NOTAM/NOTES/Permits từ ${old.original_filename || old.title} (ID ${old.id})…` });
        const res = await fbGet(`/webapi/sectors/${f.id}/attachments/${old.id}`, "application/pdf");
        if (!res.ok) throw new Error("Không tải được Briefing cũ — giữ nguyên tờ cũ, chưa đổi BF.");
        previous = await readPreviousBriefing(new Uint8Array(await res.arrayBuffer()), f.callsign);
        emit({ type: "line", text: `✓ Đã đọc cột NOTAM (${previous.notams.filter(Boolean).length} ô có nội dung) và NOTES/Permits từ Briefing cũ; WX lấy mới, REG ${plan.new_reg} + MEL tàu mới`, cls: "ok" });
      } else emit({ type: "line", text: "· Chuyến chưa có Briefing cũ — soạn mới, NOTES để trống" });
      sheet = await draftFromFlight(f, {
        ...await loadBriefingData(ctx),
        fetchPdf: fetchOfpPdfLocal,
        pdfText: ofpPdfTextLocal,
        applyEdits: false,
        reg: newReg,
        aircraft,
      });
      sheet.reg = formatReg(newReg || sheet.reg);
      sheet.defects = defectsFor(sheet.reg, aircraft);
      if (previous) sheet = restorePreviousBriefing(sheet, previous);
    } catch (exc) {
      emit({ type: "line", text: `✗ ${(exc as Error).message}`, cls: "bad" });
      return end(1, { failed: 1 });
    }
    const pdf = await toPdf(sheet);
    const filename = pdfFilename(sheet);
    emit({ type: "line", text: `   · soạn ${filename} · REG ${sheet.reg} · ${sheet.defects.length} defect` });

    const { fbRequest } = await import("@/lib/flitebrief.server");
    let deleted = 0;
    let failedDel = 0;
    for (const item of plan.delete) {
      try {
        const res = await fbRequest("DELETE", `/webapi/sectors/${f.id}/attachments/${item.id}`);
        if ([200, 201, 204].includes(res.status)) {
          deleted++;
          emit({ type: "line", text: `   − xoá briefing cũ ${item.filename}` });
        } else {
          failedDel++;
          emit({ type: "line", text: `   ✗ không xoá được ${item.filename}`, cls: "bad" });
        }
      } catch {
        failedDel++;
        emit({ type: "line", text: `   ✗ không xoá được ${item.filename}`, cls: "bad" });
      }
    }
    if (failedDel) {
      emit({ type: "line", text: "✗ xoá briefing cũ thất bại — chưa gắn tờ mới", cls: "bad" });
      return end(2, { ok: 0, failed: failedDel, deleted });
    }

    const uploaded = await uploadAndAttach(f.id, pdf, filename, filename.replace(/\.pdf$/i, ""));
    if (!uploaded.ok) {
      emit({ type: "line", text: `   ✗ gắn briefing mới: ${uploaded.error}`, cls: "bad" });
      return end(2, { ok: 0, failed: 1, deleted });
    }
    emit({ type: "line", text: `   + gắn ${filename}` });
    emit({ type: "line", text: `⬆ xong: xoá ${deleted} · thêm 1 · đã có 0 · lỗi 0` });
    end(0, { ok: 1, skipped: 0, failed: 0, deleted });
  },
};
