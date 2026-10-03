import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFlights } from "@/lib/flights.functions";
import { getWx, type Wx } from "@/lib/ops.functions";
import { fmtUtc } from "@/lib/flight-model";
import { matchGlobal, useGlobalFilters } from "@/lib/global-filters";
import { wxAdvice, wxClass } from "@/lib/wx";
import { saveBlob } from "@/lib/download";
const downloadText = (n: string, t: string) => saveBlob(new Blob([t], { type: "text/plain" }), n);

export const Route = createFileRoute("/_authenticated/tools")({
  head: () => ({
    meta: [
      { title: "Công cụ hỗ trợ — Dispatch Board" },
      { name: "description", content: "Kiểm tra PIB/WX đính kèm, tải METAR/TAF theo chuyến." },
      { property: "og:title", content: "Công cụ hỗ trợ — Dispatch Board" },
      { property: "og:description", content: "Kiểm tra PIB/WX đính kèm, tải METAR/TAF theo chuyến." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AppShell><ToolsPage /></AppShell>),
});

const PIBWX: Record<string, [string, string]> = {
  OK: ["Đủ", "bg-emerald-500/15 text-emerald-700"],
  MISS_WX: ["Thiếu WX", "bg-amber-400/25 text-amber-800"],
  MISS_PIB: ["Thiếu PIB", "bg-amber-400/25 text-amber-800"],
  MISS_BOTH: ["Thiếu cả hai", "bg-primary/15 text-primary"],
};

function ToolsPage() {
  const fetchFlights = useServerFn(getFlights);
  const fetchWx = useServerFn(getWx);
  const [g] = useGlobalFilters();
  const [days, setDays] = useState(1);
  const [onlyMiss, setOnlyMiss] = useState(false);
  const [wx, setWx] = useState<Record<string, Wx>>({});
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState("");
  const say = (t: string) => setLog((l) => [`${new Date().toISOString().slice(11, 19)}Z  ${t}`, ...l].slice(0, 200));
  const fq = useQuery({ queryKey: ["flights", days], queryFn: () => fetchFlights({ data: { days } }), staleTime: 120_000 });
  const rows = useMemo(() => (fq.data?.flights ?? []).filter((f) => matchGlobal(f, g) && (!onlyMiss || f.pibWx !== "OK")), [fq.data, g, onlyMiss]);

  async function loadWx(codes: string[]) {
    const list = [...new Set(codes.filter((c) => /^[A-Z]{4}$/.test(c)))];
    if (!list.length) return say("Không có sân bay nào để tải WX.");
    setBusy(true);
    say(`Đang tải METAR/TAF cho ${list.length} sân…`);
    const acc: Record<string, Wx> = {};
    for (let i = 0; i < list.length; i += 40) {
      const r = await fetchWx({ data: { codes: list.slice(i, i + 40) } });
      for (const w of r.wx) acc[w.icao] = w;
      if (r.error) say(r.error);
    }
    setWx((p) => ({ ...p, ...acc }));
    const nil = Object.values(acc).filter((w) => !w.taf).map((w) => w.icao);
    say(`Xong WX: ${Object.keys(acc).length} sân${nil.length ? ` · không có TAF: ${nil.join(" ")}` : ""}`);
    setBusy(false);
  }
  const allCodes = () => rows.flatMap((f) => [f.dep, f.dest, f.alt1, f.alt2]);
  const exportWx = () => {
    const txt = Object.values(wx).map((w) => `${w.icao}\nMETAR ${w.metar || "NIL"}\n${w.taf || "TAF NIL"}\n`).join("\n");
    downloadText(`WX_${new Date().toISOString().slice(0, 10)}.txt`, txt);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-sm">
        <Row label="NẠP">
          <select className="h-8 rounded-md border border-input bg-background px-2" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} ngày</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => { fq.refetch(); say("Nạp lại chuyến từ FliteBrief"); }} disabled={fq.isFetching}>{fq.isFetching ? "Đang nạp…" : "Nạp chuyến"}</Button>
          <span className="text-muted-foreground">{rows.length} chuyến (theo bộ lọc chung)</span>
        </Row>
        <Row label="PIB / WX">
          <Button size="sm" onClick={() => loadWx(allCodes())} disabled={busy}>Tải WX tất cả</Button>
          <Button size="sm" variant="outline" onClick={() => setOnlyMiss((v) => !v)}>{onlyMiss ? "Hiện tất cả" : "Chỉ chuyến thiếu PIB/WX"}</Button>
          <Button size="sm" variant="outline" onClick={exportWx} disabled={!Object.keys(wx).length}>Xuất WX (.txt)</Button>
        </Row>
        <Row label="FLITEBRIEF">
          <span className="text-muted-foreground">Cột PIB/WX đọc file đính kèm thật trên FliteBrief.</span>
        </Row>
        <Row label="KHÁC">
          <Input className="h-8 w-64" placeholder="Tra WX: VVTS VVNB RCTP…" value={lookup} onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadWx(lookup.toUpperCase().split(/[\s,]+/))} />
          <Button size="sm" variant="outline" onClick={() => loadWx(lookup.toUpperCase().split(/[\s,]+/))} disabled={busy}>Tra</Button>
        </Row>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-2 py-2">FLT NO</th><th className="px-2 py-2">PIB/WX</th><th className="px-2 py-2">PIB</th><th className="px-2 py-2">STD</th><th className="px-2 py-2">WX (DEP / DEST / ALT)</th></tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const [lab, cls] = PIBWX[f.pibWx] ?? PIBWX.OK;
                const pib = f.attachments.filter((a) => a.kind === "PIB").length;
                return (
                  <tr key={f.id} className="border-t border-border align-top">
                    <td className="px-2 py-1.5 font-mono font-semibold">{f.callsign}<div className="text-xs font-normal text-muted-foreground">{f.dep}-{f.dest} · {f.reg}</div></td>
                    <td className="px-2 py-1.5"><span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{lab}</span></td>
                    <td className="px-2 py-1.5 text-xs">{pib ? `${pib} file` : "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{fmtUtc(f.std)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {[f.dep, f.dest, f.alt1, f.alt2].filter(Boolean).map((c, i) => {
                          const w = wx[c];
                          if (!w) return <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{c}</span>;
                          const a = wxAdvice(w.taf || w.metar);
                          return <span key={i} title={`${w.metar}\n\n${w.taf}\n\n${a.reasons.join(", ")}`} className={`rounded px-1.5 py-0.5 font-mono text-xs ${wxClass[a.level]}`}>{c}</span>;
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {fq.isLoading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Đang tải chuyến…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-2">
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">WX đã tải</div>
            {Object.values(wx).map((w) => (
              <div key={w.icao} className="mb-2 border-b border-border pb-2 font-mono text-[11px] leading-snug">
                <b>{w.icao}</b> <span className={`rounded px-1 ${wxClass[wxAdvice(w.taf || w.metar).level]}`}>{wxAdvice(w.taf || w.metar).reasons[0] ?? "OK"}</span>
                <div className="whitespace-pre-wrap">{w.metar || "METAR NIL"}</div>
                <div className="whitespace-pre-wrap text-muted-foreground">{w.taf || "TAF NIL"}</div>
              </div>
            ))}
          </div>
          <div className="h-40 overflow-auto rounded-lg border border-border bg-foreground/95 p-2 font-mono text-[11px] text-background">
            {log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div className="opacity-60">Log…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 rounded bg-primary/10 px-2 py-1 text-center text-xs font-bold text-primary">{label}</span>
      {children}
    </div>
  );
}
