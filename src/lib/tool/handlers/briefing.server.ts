import type { Jobs, Routes } from "../types";
import { jobId } from "../jobs";
import * as store from "../store.server";
import { loadFlights } from "../core/gantts.server";
import { listBriefFiles, previewBriefing, briefLabel, type BriefFile } from "../port/briefing";
import { mergeToPdf, MergeError } from "../port/pdfMerge";

// Port of web.py briefing.py + pdf_merge.py + the regnotice split/list routes.
//
// Original briefing.py reads a local PC folder (config paths "briefing") —
// not reachable from a Worker. Files are kept instead in the shared private
// bucket under "briefing/<name>.pdf"; nothing in our scope uploads there yet,
// so the list is honestly empty until an upload endpoint is wired, same as
// port/attch.ts's brief_disk already assumes.
const BRIEF_DIR = "briefing";
// MEL/RegNotice: mỗi người tự tách PDF, lưu riêng theo tài khoản của họ.
const regDir = (ctx: { userId: string }) => `regnotice/${ctx.userId}`;

async function briefFiles(ctx: Parameters<Routes[string]>[0]): Promise<BriefFile[]> {
  const entries = await store.listFiles(ctx, BRIEF_DIR);
  return listBriefFiles(entries.filter((e) => e.metadata?.["size"] !== 0).map((e) => e.name));
}

async function briefingPreview(ctx: Parameters<Routes[string]>[0], days: number) {
  const flights = await loadFlights(days);
  const files = await briefFiles(ctx);
  const plans = previewBriefing(flights, files);
  return {
    folder: BRIEF_DIR,
    total: plans.length,
    ready: plans.filter((p) => p.flight && !p.already).length,
    already: plans.filter((p) => p.already).length,
    unmatched: plans.filter((p) => !p.flight).length,
    duplicate_groups: [] as unknown[],
    rows: plans.map((p) => ({
      file: p.file.name,
      callsign: p.file.callsign,
      flight: p.flight ? briefLabel(p) : "",
      sector: p.flight ? p.flight.id : 0,
      sector_id: p.flight ? p.flight.id : 0,
      already: p.already,
      overwrite: !!p.overwrite,
      note: p.note,
    })),
  };
}

export const routes: Routes = {
  "GET /api/briefing/preview": async (ctx) => {
    const days = Number(ctx.params.get("days") ?? "1") || 1;
    return briefingPreview(ctx, days);
  },

  "POST /api/briefing/attach": async (ctx) => {
    const body = await ctx.json();
    const days = Number(body["days"] ?? 1) || 1;
    return { id: jobId("briefing_attach", { days, dry_run: !!body["dry_run"], sector_ids: body["sector_ids"] ?? null }) };
  },

  // web.py _api_merge_pdf: multipart "file" fields, merged in selection order.
  "POST /api/pdf/merge": async (ctx) => {
    let form: FormData;
    try {
      form = await ctx.request.formData();
    } catch {
      return { error: "Không đọc được danh sách file." };
    }
    const files: { name: string; data: Uint8Array }[] = [];
    for (const [key, value] of form.entries()) {
      if (key !== "file" || !(value instanceof File)) continue;
      files.push({ name: value.name, data: new Uint8Array(await value.arrayBuffer()) });
    }
    try {
      const r = await mergeToPdf(files);
      const path = `merged/${r.file}`;
      await store.putFile(ctx, path, r.bytes, "application/pdf");
      return { ok: true, path, file: r.file, pages: r.pages, parts: r.parts };
    } catch (e) {
      if (e instanceof MergeError) return { error: e.message };
      return { error: `${e instanceof Error ? e.constructor.name : "Error"}: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  // Tải lại file PDF đã gộp (lưu trên máy chủ ở merged/).
  "GET /api/pdf/merged-file/*": async (ctx) => {
    const name = (ctx.route.split("/").pop() || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!name.toLowerCase().endsWith(".pdf")) return new Response("Tên file không hợp lệ", { status: 400 });
    const buf = await store.getFile(ctx, `merged/${name}`);
    if (!buf) return new Response("Không có file", { status: 404 });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },

  "GET /api/regnotice/list": async (ctx) => {
    const entries = await store.listFiles(ctx, regDir(ctx));
    const files = entries
      .map((e) => e.name)
      .filter((n) => /^VNA.*\.pdf$/i.test(n))
      .map((n) => n.replace(/\.pdf$/i, "").toUpperCase());
    return { files };
  },

  "GET /api/regnotice/file/*": async (ctx) => {
    const name = (ctx.route.split("/").pop() || "").replace(/[^A-Za-z0-9.]/g, "").toUpperCase().replace(/\.PDF$/, "") + ".pdf";
    const buf = await store.getFile(ctx, `${regDir(ctx)}/${name}`);
    if (!buf) return new Response("Không có file MEL", { status: 404 });
    return new Response(buf, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" } });
  },

  // web.py split_regnotice_pdf: split a combined PDF by "Status of VN-Axxx" page headers.
  "POST /api/split-regnotice": async (ctx) => {
    const buf = new Uint8Array(await ctx.request.arrayBuffer());
    if (!buf.byteLength) return { error: "Không nhận được nội dung file" };
    if (buf.byteLength > 50 * 1024 * 1024) return { error: "File PDF quá lớn (> 50 MB)" };
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const { PDFDocument } = await import("pdf-lib");
      // pdf.js chiếm (detach) buffer được truyền vào → đưa bản sao, giữ buf cho pdf-lib.
      const pdf = await getDocumentProxy(buf.slice());
      const { text } = await extractText(pdf, { mergePages: false });
      const pageTexts = Array.isArray(text) ? text : [text];
      const pattern = /Status of (VN-A\d{3})/;
      const codePages = new Map<string, number[]>();
      let current: string | null = null;
      for (let i = 0; i < pageTexts.length; i++) {
        const m = pattern.exec(pageTexts[i] ?? "");
        if (m) current = m[1]!;
        if (current) {
          if (!codePages.has(current)) codePages.set(current, []);
          codePages.get(current)!.push(i);
        }
      }
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const results: { code: string; file: string; pages: number }[] = [];
      for (const code of [...codePages.keys()].sort()) {
        const pages = codePages.get(code)!;
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, pages);
        for (const p of copied) out.addPage(p);
        const fname = `${code.replace("-", "")}.pdf`;
        const bytes = await out.save();
        await store.putFile(ctx, `${regDir(ctx)}/${fname}`, bytes, "application/pdf");
        results.push({ code, file: fname, pages: pages.length });
      }
      return { total: results.length, output_dir: "MEL của bạn (lưu riêng)", files: results };
    } catch (e) {
      return { error: `${e instanceof Error ? e.constructor.name : "Error"}: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

/** Upload a PDF to FliteBrief's notice store and attach it to a sector.
 *  Shared by briefing_attach above and briefswap.server.ts's swap job. */
export async function uploadAndAttach(
  sectorId: number,
  bytes: Uint8Array,
  filename: string,
  title: string,
): Promise<{ ok: boolean; error?: string }> {
  const { fbRequest } = await import("@/lib/flitebrief.server");
  try {
    const form = new FormData();
    form.append("file-upload", new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
    const up = await fbRequest("POST", "/webapi/notices/upload", { body: form, accept: "application/json" });
    const upJson = (await up.json().catch(() => ({}))) as Record<string, unknown>;
    if (!up.ok || !upJson["result"]) {
      return { ok: false, error: String(upJson["message"] || `HTTP ${up.status}`) };
    }
    const fileKey = String(upJson["id"] || "");
    const orgFile = String(upJson["org_file"] || "");
    if (!fileKey) return { ok: false, error: "không nhận được file_key" };
    const att = await fbRequest("POST", `/webapi/sectors/${sectorId}/attachments`, {
      body: {
        file_key: fileKey,
        org_file_name: orgFile,
        file_type: "application/pdf",
        attachment_type: "GENERAL",
        title,
        needs_acknowledging: false,
      },
    });
    if (![200, 201, 204].includes(att.status)) return { ok: false, error: `gắn sector ${sectorId}: HTTP ${att.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const jobs: Jobs = {
  // Port of web.py start_briefing_attach(): upload + attach each file via
  // FliteBrief's Web API (api/upload.py: POST /webapi/notices/upload, then
  // POST /webapi/sectors/{id}/attachments).
  briefing_attach: async (params, emit, ctx) => {
    const t0 = Date.now();
    const days = Number(params["days"] ?? 1) || 1;
    const dryRun = !!params["dry_run"];
    const sectorIds = params["sector_ids"] as unknown[] | null | undefined;
    const end = (code: number, extra: Record<string, unknown>) =>
      emit({ type: "end", code, elapsed: (Date.now() - t0) / 1000, ...extra });

    const { fbRequest } = await import("@/lib/flitebrief.server");

    if (!dryRun) {
      try {
        const r = await fbRequest("GET", "/webapi/sector/attachments/privileges");
        const d = r.ok ? ((await r.json()) as Record<string, unknown>) : {};
        if (!d["create"]) {
          emit({ type: "line", text: "✗ tài khoản không có quyền đính kèm", cls: "bad" });
          return end(1, { ok: 0, skipped: 0, failed: 0, missing: [] });
        }
      } catch {
        emit({ type: "line", text: "✗ không đọc được quyền đính kèm", cls: "bad" });
        return end(1, { ok: 0, skipped: 0, failed: 0, missing: [] });
      }
    }

    const flights = await loadFlights(days);
    const files = await briefFiles(ctx);
    let plans = previewBriefing(flights, files);
    if (sectorIds && sectorIds.length) {
      const keep = new Set(sectorIds.map((v) => Number(v)).filter((n) => Number.isFinite(n)));
      const chosen = flights.filter((f) => keep.has(f.id));
      const keepCs = new Set(chosen.map((f) => f.callsign.toUpperCase()));
      if (keepCs.size) plans = plans.filter((p) => keepCs.has(p.file.callsign));
      // Chặng người dùng đã chọn thắng mọi nhận diện tự động (kể cả trùng số hiệu).
      const { briefCallsign } = await import("../port/briefing");
      plans = plans.map((p) => {
        const f = chosen.find((x) => x.callsign.toUpperCase() === p.file.callsign);
        if (!f) return p;
        const have = f.attachments.some((a) => !a.is_deleted && briefCallsign(a.filename()) === p.file.callsign);
        return { file: p.file, flight: f, note: have ? "ghi đè briefing cũ" : "", already: false, overwrite: have };
      });
    }
    if (!plans.length) {
      emit({ type: "line", text: `✗ folder ${BRIEF_DIR} không có file briefing nào`, cls: "bad" });
      return end(1, { ok: 0, skipped: 0, failed: 0, missing: [] });
    }

    const todo = plans.filter((p) => p.flight && !p.already);
    emit({
      type: "line",
      text: `▶ ${plans.length} file trong folder · ${todo.length} cần đính kèm${dryRun ? "  [chạy thử, không ghi]" : ""}`,
    });
    for (const p of plans) {
      if (!p.flight) emit({ type: "line", text: `! ${p.file.callsign}: ${p.note}`, cls: "bad" });
    }

    let ok = 0, skipped = 0, failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const pl = todo[i]!;
      const flight = pl.flight!;
      const progress = (i + 1) / Math.max(1, todo.length);
      if (dryRun) {
        ok++;
        emit({ type: "line", text: `· [thử] ${briefLabel(pl)} ← ${pl.file.name}`, progress });
        continue;
      }
      try {
        const blob = await store.getFile(ctx, `${BRIEF_DIR}/${pl.file.name}`);
        if (!blob?.byteLength) throw new Error("file Briefing rỗng hoặc không đọc được trong kho");
        if (pl.overwrite) {
          const { briefCallsign } = await import("../port/briefing");
          const old = flight.attachments.filter((a) => !a.is_deleted
            && [a.original_filename, a.title].some((n) => briefCallsign(String(n || "")) === pl.file.callsign));
          for (const a of old) {
            const del = await fbRequest("DELETE", `/webapi/sectors/${flight.id}/attachments/${a.id}`);
            if (![200, 201, 204].includes(del.status)) throw new Error(`không xoá được briefing cũ ${a.original_filename || a.title}: HTTP ${del.status}`);
            emit({ type: "line", text: `   − xoá briefing cũ ${a.original_filename || a.title}` });
          }
        }
        const form = new FormData();
        form.append("file-upload", new Blob([blob], { type: "application/pdf" }), pl.file.name);
        const up = await fbRequest("POST", "/webapi/notices/upload", { body: form, accept: "application/json" });
        const upJson = (await up.json().catch(() => ({}))) as Record<string, unknown>;
        if (!up.ok || !upJson["result"]) {
          throw new Error(String(upJson["message"] || `HTTP ${up.status}`));
        }
        const fileKey = String(upJson["id"] || "");
        const orgFile = String(upJson["org_file"] || "");
        if (!fileKey) throw new Error("không nhận được file_key");
        const att = await fbRequest("POST", `/webapi/sectors/${flight.id}/attachments`, {
          body: {
            file_key: fileKey,
            org_file_name: orgFile,
            file_type: "application/pdf",
            attachment_type: "GENERAL",
            title: pl.file.name.replace(/\.pdf$/i, ""),
            needs_acknowledging: false,
          },
        });
        if (![200, 201, 204].includes(att.status)) throw new Error(`gắn sector ${flight.id}: HTTP ${att.status}`);
        ok++;
        emit({ type: "line", text: `✓ ${briefLabel(pl)} ← ${pl.file.name}${pl.overwrite ? " (ghi đè)" : ""}`, progress });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: "line", text: `✗ ${briefLabel(pl)}: ${msg}`, cls: "bad", progress });
      }
    }

    const missing = plans.filter((p) => !p.flight).map((p) => p.file.callsign);
    end(failed ? 2 : 0, { ok, skipped, failed, missing });
  },
};
