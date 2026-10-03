import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { getFlights } from "@/lib/flights.functions";
import type { Flight } from "@/lib/flight-model";
import { matchGlobal, useGlobalFilters } from "@/lib/global-filters";
import { saveBlob } from "@/lib/download";

export const Route = createFileRoute("/_authenticated/atc")({
  head: () => ({
    meta: [
      { title: "Check ATC avi — Dispatch Board" },
      { name: "description", content: "Đối chiếu FPL trên AviWeb với FliteBrief: REG CHECK, STD CHECK, DOF." },
      { property: "og:title", content: "Check ATC avi — Dispatch Board" },
      { property: "og:description", content: "Đối chiếu FPL trên AviWeb với FliteBrief: REG CHECK, STD CHECK, DOF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AppShell><AtcPage /></AppShell>),
});

type Avi = { callsign: string; status: string; reg: string; eobt: string; dof: string };
const normReg = (s: string) => (s || "").replace(/[-\s]/g, "").toUpperCase();
const hhmm = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0"); };
const dofOf = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };

// Port acFindFlight: cùng callsign → tách theo DOF → theo EOBT; mơ hồ thì null (N/A).
function findFlight(flights: Flight[], cs: string, dof: string, eobt: string) {
  let c = flights.filter((f) => f.callsign.toUpperCase().replace(/\s/g, "") === cs);
  if (c.length <= 1) return c[0] ?? null;
  if (dof.length === 6) { const h = c.filter((f) => dofOf(f.std) === dof); if (h.length === 1) return h[0]; if (h.length) c = h; }
  if (/^\d{4}$/.test(eobt)) { const h = c.filter((f) => hhmm(f.std) === eobt); if (h.length === 1) return h[0]; }
  return null;
}

// Đọc kết quả AviWeb dán vào: mỗi dòng có số hiệu VJxxx, trạng thái, REG VNAxxx, EOBT 4 số, DOF 6 số.
function parseAvi(text: string): Avi[] {
  const out: Avi[] = [];
  for (const line of text.split(/\r?\n/)) {
    const u = line.toUpperCase();
    const cs = u.match(/\b(VJC?|VJ)\s?(\d{2,4}[A-Z]?)\b/);
    if (!cs) continue;
    const reg = u.match(/\b(VN-?[A-Z]\d{3})\b|REG\/(\S+)/);
    const dof = u.match(/DOF\/(\d{6})|\b(\d{6})\b/);
    const eobt = u.match(/\b([01]\d|2[0-3])([0-5]\d)\b/);
    const st = u.match(/\b(FILED|ACK|ACCEPTED|APPROVED|ACT|ACTIVE|CNL|CANCELLED|REJ|REJECTED|DLA|CHG|PENDING|SENT|NEW)\b/);
    out.push({
      callsign: `VJ${cs[2] ?? ""}`.replace(/^VJC/, "VJ"),
      status: st?.[1] ?? "",
      reg: normReg(reg?.[1] ?? reg?.[2] ?? ""),
      eobt: eobt ? eobt[1] + eobt[2] : "",
      dof: dof?.[1] ?? dof?.[2] ?? "",
    });
  }
  return out;
}

const stCls = (s: string) => /CNL|REJ/.test(s) ? "text-primary font-semibold" : /ACK|ACC|APP|ACT/.test(s) ? "text-emerald-700 font-semibold" : "text-muted-foreground";

function AtcPage() {
  const fetchFlights = useServerFn(getFlights);
  const [g] = useGlobalFilters();
  const [days, setDays] = useState(1);
  const [paste, setPaste] = useState("");
  const fq = useQuery({ queryKey: ["flights", days], queryFn: () => fetchFlights({ data: { days } }), staleTime: 120_000 });
  const flights = fq.data?.flights ?? [];
  const avi = useMemo(() => parseAvi(paste), [paste]);
  const rows = useMemo(() => {
    if (avi.length) return avi.map((a) => ({ a, f: findFlight(flights, a.callsign, a.dof, a.eobt) }));
    return flights.filter((f) => matchGlobal(f, g)).map((f) => ({ a: null as Avi | null, f }));
  }, [avi, flights, g]);

  const exportX = async () => {
    const data = rows.map(({ a, f }, i) => ({
      "#": i + 1, "FLT NO": a?.callsign ?? f?.callsign, STATUS: a?.status ?? "", REG: a?.reg ?? "", "REG FB": f?.reg ?? "",
      "REG CHECK": a && f ? (normReg(a.reg) === normReg(f.reg) ? "TRUE" : "FALSE") : "N/A",
      EOBT: a?.eobt ?? "", STD: hhmm(f?.std ?? null), "STD CHECK": a?.eobt && f ? (a.eobt === hhmm(f.std) ? "TRUE" : "FALSE") : "", DOF: a?.dof ?? dofOf(f?.std ?? null),
    }));
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ATC");
    const cols = Object.keys(data[0] ?? {});
    ws.addRow(cols).font = { bold: true };
    for (const d of data) ws.addRow(cols.map((c) => (d as Record<string, unknown>)[c]));
    saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `ATC_check_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_320px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 text-sm">
          <select className="h-8 rounded-md border border-input bg-background px-2" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3].map((d) => <option key={d} value={d}>{d} ngày</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => fq.refetch()} disabled={fq.isFetching}>{fq.isFetching ? "Đang tải…" : "Nạp FliteBrief"}</Button>
          <Button size="sm" variant="outline" onClick={exportX} disabled={!rows.length}>Xuất Excel</Button>
          <span className="ml-auto text-xs text-muted-foreground">{avi.length ? `${avi.length} dòng AviWeb` : `${rows.length} chuyến FliteBrief`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>{["#", "FLT NO", "STATUS", "REG", "REG CHECK", "EOBT", "STD", "STD CHECK", "DOF", "GHI CHÚ"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(({ a, f }, i) => {
                const regOk = a && f ? normReg(a.reg) === normReg(f.reg) : null;
                const stdOk = a?.eobt && f ? a.eobt === hhmm(f.std) : null;
                const note = !a ? "Chưa có kết quả AviWeb" : !f ? "Không tách được chuyến trên FliteBrief (N/A)" :
                  [regOk === false && `REG FB ${f.reg}`, stdOk === false && `STD FB ${hhmm(f.std)}`, /CNL/.test(a.status) && "FPL đã huỷ"].filter(Boolean).join(" · ");
                return (
                  <tr key={i} className="border-t border-border font-mono text-xs">
                    <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1.5 font-semibold">{a?.callsign ?? f?.callsign}</td>
                    <td className={`px-2 py-1.5 ${stCls(a?.status ?? "")}`}>{a?.status || "—"}</td>
                    <td className="px-2 py-1.5">{a?.reg || f?.reg}</td>
                    <td className={`px-2 py-1.5 font-bold ${regOk === true ? "text-emerald-700" : regOk === false ? "text-primary" : "text-muted-foreground"}`}>{regOk == null ? "N/A" : regOk ? "TRUE" : "FALSE"}</td>
                    <td className="px-2 py-1.5">{a?.eobt}</td>
                    <td className="px-2 py-1.5">{hhmm(f?.std ?? null)}</td>
                    <td className={`px-2 py-1.5 font-bold ${stdOk ? "text-emerald-700" : stdOk === false ? "text-primary" : ""}`}>{stdOk == null ? "" : stdOk ? "TRUE" : "FALSE"}</td>
                    <td className="px-2 py-1.5">{a?.dof || dofOf(f?.std ?? null)}</td>
                    <td className="px-2 py-1.5 font-sans">{note}</td>
                  </tr>
                );
              })}
              {fq.isLoading && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Đang tải chuyến…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-2 border-l border-border bg-card p-3 text-sm">
        <b>Kết quả AviWeb</b>
        <p className="text-xs text-muted-foreground">Mở AviWeb, copy danh sách FPL (Ctrl+A, Ctrl+C) rồi dán vào đây — máy tự đọc số hiệu, trạng thái, REG, EOBT, DOF và đối chiếu với FliteBrief. Khi có tài khoản AviWeb chung, nút tự lấy sẽ được bật.</p>
        <textarea className="min-h-0 flex-1 rounded-md border border-input bg-background p-2 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={"VJ120 ACK VNA651 0100 DOF/261004\nVJ122 FILED VNA652 0200 DOF/261004"} />
        <Button size="sm" variant="outline" onClick={() => setPaste("")}>Xoá</Button>
      </div>
    </div>
  );
}
