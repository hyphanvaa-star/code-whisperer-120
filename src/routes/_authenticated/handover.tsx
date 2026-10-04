import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Save, ListPlus, Trash2 } from "lucide-react";
import { AppShell, useShift } from "@/components/AppShell";
import { getFlights } from "@/lib/flights.functions";
import { getHandover, saveHandover, type HandoverRow } from "@/lib/handover.functions";
import { fmtUtc, type Flight } from "@/lib/flight-model";
import { saveBlob } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import logoUrl from "@/assets/vj-logo.png";

export const Route = createFileRoute("/_authenticated/handover")({
  head: () => ({
    meta: [
      { title: "Giao ca — Dispatch Board" },
      { name: "description", content: "Bảng giao ca: chuyến bay, extra, ATC, EZFW, ATFM và ghi chú." },
      { property: "og:title", content: "Giao ca — Dispatch Board" },
      { property: "og:description", content: "Bảng giao ca ca sáng / ca đêm cho dispatcher." },
    ],
  }),
  component: () => (
    <AppShell>
      <Handover />
    </AppShell>
  ),
});

const todayUtc = () => new Date().toISOString().slice(0, 10);

function toRow(f: Flight): HandoverRow {
  const pax = (f.pax.adults ?? 0) + (f.pax.children ?? 0) + (f.pax.infants ?? 0);
  return {
    key: `${f.callsign.replace(/\s+/g, "").toUpperCase()}|${f.std ?? ""}`,
    callsign: f.callsign,
    dep: f.depIata || f.dep,
    arr: f.destIata || f.dest,
    ac: f.reg,
    std: f.std ? fmtUtc(f.std) : "",
    sta: f.sta ? fmtUtc(f.sta) : "",
    payload: pax ? String(pax) : "",
    extra: f.fuel.extra != null ? String(Math.round(f.fuel.extra)) : "",
    atc: false,
    ezfw: false,
    atfm: false,
    note: "",
  };
}

function Handover() {
  const [shift] = useShift();
  const [date, setDate] = useState(todayUtc);
  const [dsp, setDsp] = useState("");
  const [toDsp, setToDsp] = useState("");
  const [rows, setRows] = useState<HandoverRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchFlights = useServerFn(getFlights);
  const getFn = useServerFn(getHandover);
  const saveFn = useServerFn(saveHandover);

  const flightsQ = useQuery({
    queryKey: ["flights", 2],
    queryFn: () => fetchFlights({ data: { days: 2 } }),
    staleTime: 120_000,
  });
  const dispatchers = useMemo(() => {
    const set = new Set((flightsQ.data?.flights ?? []).map((f) => f.dispatcher).filter(Boolean));
    return [...set].sort();
  }, [flightsQ.data]);

  async function load() {
    if (!dsp) {
      toast.error("Chọn DSP trước");
      return;
    }
    setBusy(true);
    try {
      const saved = await getFn({ data: { shift, date, fromDsp: dsp } });
      const fresh = (flightsQ.data?.flights ?? [])
        .filter((f) => f.dispatcher === dsp && (f.std ?? "").slice(0, 10) >= date)
        .map(toRow);
      const byKey = new Map((saved?.flights ?? []).map((r) => [r.key, r]));
      // Giữ tick/ghi chú đã lưu, cập nhật số liệu mới từ FliteBrief.
      const merged = fresh.map((r) => {
        const old = byKey.get(r.key);
        byKey.delete(r.key);
        return old ? { ...r, atc: old.atc, ezfw: old.ezfw, atfm: old.atfm, note: old.note } : r;
      });
      setRows([...merged, ...byKey.values()]);
      if (saved) setToDsp(saved.toDsp);
      toast.success(`Đã nạp ${merged.length} chuyến${saved ? " (có dữ liệu đã lưu)" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nạp thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      await saveFn({ data: { shift, date, fromDsp: dsp, toDsp, flights: rows } });
      toast.success("Đã lưu bảng giao ca");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  const patch = (i: number, p: Partial<HandoverRow>) =>
    setRows((r) => (r ? r.map((x, j) => (j === i ? { ...x, ...p } : x)) : r));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-card px-4 py-3">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Ca</div>
          <div className="rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground">
            {shift === "MORNING SHIFT" ? "Ca sáng" : "Ca đêm"}
          </div>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          Ngày (UTC)
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-40" />
        </label>
        <div className="text-xs font-medium text-muted-foreground">
          DSP giao
          <Select value={dsp} onValueChange={setDsp}>
            <SelectTrigger className="mt-1 w-56">
              <SelectValue placeholder={flightsQ.isLoading ? "Đang tải…" : "Chọn DSP"} />
            </SelectTrigger>
            <SelectContent>
              {dispatchers.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          DSP nhận
          <Input value={toDsp} onChange={(e) => setToDsp(e.target.value)} className="mt-1 w-48" placeholder="Tên người nhận" />
        </label>
        <Button onClick={load} disabled={busy || !dsp || flightsQ.isLoading}>
          <ListPlus className="h-4 w-4" /> Nạp
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={save} disabled={busy || !rows}>
            <Save className="h-4 w-4" /> Lưu
          </Button>
          <Button
            variant="outline"
            disabled={!rows}
            onClick={() => rows && exportXlsx({ shift, date, dsp, toDsp, rows })}
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!rows ? (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
            Chọn <b className="text-foreground">DSP</b> rồi bấm <b className="text-foreground">Nạp</b> để lập bảng giao ca.
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">Không có chuyến nào của DSP này.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  {["Chuyến bay", "DEP", "ARR", "A/C", "STD", "STA", "Payload", "Extra", "ATC", "EZFW", "ATFM", "Note", ""].map(
                    (h) => (
                      <th key={h} className="px-2 py-2 text-left font-semibold">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono font-semibold">{r.callsign}</td>
                    <td className="px-2 font-mono">{r.dep}</td>
                    <td className="px-2 font-mono">{r.arr}</td>
                    <td className="px-2 font-mono">{r.ac}</td>
                    <td className="px-2 font-mono text-xs">{r.std}</td>
                    <td className="px-2 font-mono text-xs">{r.sta}</td>
                    <td className="px-2">
                      <Input value={r.payload} onChange={(e) => patch(i, { payload: e.target.value })} className="h-7 w-20" />
                    </td>
                    <td className="px-2">
                      <Input value={r.extra} onChange={(e) => patch(i, { extra: e.target.value })} className="h-7 w-20" />
                    </td>
                    {(["atc", "ezfw", "atfm"] as const).map((k) => (
                      <td key={k} className="px-2 text-center">
                        <Checkbox checked={r[k]} onCheckedChange={(v) => patch(i, { [k]: v === true })} />
                      </td>
                    ))}
                    <td className="px-2">
                      <Input value={r.note} onChange={(e) => patch(i, { note: e.target.value })} className="h-7 min-w-48" />
                    </td>
                    <td className="px-2">
                      <button
                        aria-label="Xoá dòng"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

async function exportXlsx(p: { shift: string; date: string; dsp: string; toDsp: string; rows: HandoverRow[] }) {
  const ExcelJS = await (await import("@/lib/exceljs-load")).loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  const headers = ["CHUYẾN BAY", "DEP", "ARR", "A/C", "STD", "STA", "PAYLOAD", "EXTRA FUEL", "ATC FILING", "EZFW", "ATFM FILLING", "NOTE"];
  [14, 10, 10, 10, 12, 12, 12, 14, 14, 12, 16, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.mergeCells("I1:L2");
  ws.getCell("I1").value = `${p.shift} HANDOVER`;
  ws.getCell("I1").font = { name: "Calibri", bold: true, size: 18, color: { argb: "FFC41E3A" } };
  ws.getCell("I1").alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells("D1:H2");
  ws.getCell("D1").value = `${p.date}\nGiao: ${p.dsp || "—"}  →  Nhận: ${p.toDsp || "—"}`;
  ws.getCell("D1").alignment = { wrapText: true, vertical: "middle" };
  try {
    const buf = await (await fetch(logoUrl)).arrayBuffer();
    const id = wb.addImage({ buffer: buf, extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 36 } });
  } catch {
    ws.getCell("A1").value = "vietjetAir.com";
  }
  const border = { style: "thin" as const, color: { argb: "FF9AA3AD" } };
  const all = { top: border, left: border, bottom: border, right: border };
  const head = ws.getRow(3);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = all;
  });
  const tick = (b: boolean) => (b ? "✓" : "");
  p.rows.forEach((r) => {
    const row = ws.addRow([r.callsign, r.dep, r.arr, r.ac, r.std, r.sta, r.payload, r.extra, tick(r.atc), tick(r.ezfw), tick(r.atfm), r.note]);
    row.eachCell({ includeEmpty: true }, (c, n) => {
      c.border = all;
      c.alignment = { horizontal: n === 12 ? "left" : "center", vertical: "middle", wrapText: n === 12 };
    });
  });
  const out = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Handover_${p.shift.startsWith("MORNING") ? "Morning" : "Night"}_${p.date}.xlsx`,
  );
}
