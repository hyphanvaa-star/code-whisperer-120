import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCrews, getFlights } from "@/lib/flights.functions";
import { getFplDb } from "@/lib/fpl.functions";
import { acFamily, defaults, localHm, normReg, payDefault, renderFpl, reqBytes, utcHhmm, type FplDb, type FplFlight, type FplOpts } from "@/lib/fpl";
import { fmtUtc, type Flight } from "@/lib/flight-model";

export const Route = createFileRoute("/_authenticated/khb")({
  head: () => ({
    meta: [
      { title: "Tạo KHB / FPL — Dispatch Board" },
      { name: "description", content: "Sinh khối FPL.req theo công thức sheet TOOL từ chuyến FliteBrief." },
      { property: "og:title", content: "Tạo KHB / FPL — Dispatch Board" },
      { property: "og:description", content: "Sinh khối FPL.req theo công thức sheet TOOL từ chuyến FliteBrief." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Khb />
    </AppShell>
  ),
});

type Row = { f: FplFlight; o: FplOpts; src: Flight };

function toFpl(db: FplDb, f: Flight): Row {
  const dep = (f.depIata || f.dep).toUpperCase(), arr = (f.destIata || f.dest).toUpperCase();
  const d = defaults(db, dep, arr);
  const etd = f.etd ?? f.std;
  return {
    src: f,
    f: {
      key: String(f.id), flt: f.callsign.replace(/\D/g, "").replace(/^0+/, ""), date: etd?.slice(0, 10) ?? "",
      reg: normReg(f.reg), ac: acFamily(f.acType), dep, arr, etdUtc: utcHhmm(etd), staLocal: localHm(f.sta, db.tz[arr] ?? "07:00"),
      cptId: "", cptName: "", cpt2Id: "", cpt2Name: "", foId: "", foName: "",
    },
    o: { extra: "0", seq: "", ...d, rte: "", rmk: "", pcrTo: "", pay: "", utc: "", dsp: "" },
  };
}

function Khb() {
  const dbFn = useServerFn(getFplDb);
  const flFn = useServerFn(getFlights);
  const crewFn = useServerFn(getCrews);
  const dbQ = useQuery({ queryKey: ["fpl-db"], queryFn: () => dbFn(), staleTime: Infinity });
  const fq = useQuery({ queryKey: ["flights", 2], queryFn: () => flFn({ data: { days: 2 } }), staleTime: 120_000 });
  const [dspFilter, setDspFilter] = useState("");
  const [dsp, setDsp] = useState("");
  const [s, setS] = useState("");
  const [picked, setPicked] = useState<Row[]>([]);
  const [loadingCrew, setLoadingCrew] = useState(false);
  useEffect(() => { setDsp(localStorage.getItem("fpl_dsp") ?? ""); }, []);
  useEffect(() => { if (dbQ.data && !dsp) setDsp(dbQ.data.dsp); }, [dbQ.data, dsp]);

  const dsps = useMemo(() => [...new Set((fq.data?.flights ?? []).map((f) => f.dispatcher).filter(Boolean))].sort(), [fq.data]);
  const list = useMemo(() => {
    const k = s.trim().toUpperCase();
    return (fq.data?.flights ?? []).filter((f) => (!dspFilter || f.dispatcher === dspFilter) && (!k || [f.callsign, f.reg, f.dep, f.dest].some((v) => v.toUpperCase().includes(k))));
  }, [fq.data, dspFilter, s]);

  const db = dbQ.data;
  const text = useMemo(() => (db ? picked.map((r) => renderFpl(db, r.f, { ...r.o, dsp })).join("\n\n") : ""), [db, picked, dsp]);

  const toggle = (f: Flight) => {
    if (!db) return;
    setPicked((p) => p.some((r) => r.f.key === String(f.id)) ? p.filter((r) => r.f.key !== String(f.id)) : [...p, toFpl(db, f)].sort((a, b) => (a.src.std ?? "").localeCompare(b.src.std ?? "")));
  };
  const setOpt = (key: string, k: keyof FplOpts, v: string) => setPicked((p) => p.map((r) => (r.f.key === key ? { ...r, o: { ...r.o, [k]: v } } : r)));
  const setF = (key: string, k: keyof FplFlight, v: string) => setPicked((p) => p.map((r) => (r.f.key === key ? { ...r, f: { ...r.f, [k]: v } } : r)));

  const loadCrew = async () => {
    setLoadingCrew(true);
    try {
      const next = await Promise.all(picked.map(async (r) => {
        const { crews } = await crewFn({ data: { sectorId: r.src.id } });
        const live = crews.filter((c) => !c.deadheading);
        const isFo = (c: (typeof live)[number]) => /\bFO\b|FIRST|F\/O|SFO/i.test(c.job);
        const isCp = (c: (typeof live)[number]) => c.commander || /\bCP\b|CAPT|CPT|PIC|TRI|TRE|LTC/i.test(c.job);
        const idOf = (c: (typeof live)[number]) => c.username.replace(/\D/g, "") || c.username;
        const byId = (a: (typeof live)[number], b: (typeof live)[number]) => Number(idOf(a)) - Number(idOf(b));
        const cps = live.filter((c) => isCp(c) && !isFo(c)).sort(byId), fos = live.filter(isFo).sort(byId);
        return { ...r, f: { ...r.f,
          cptId: cps[0] ? idOf(cps[0]) : "", cptName: cps[0]?.name.toUpperCase() ?? "",
          cpt2Id: cps[1] ? idOf(cps[1]) : "", cpt2Name: cps[1]?.name.toUpperCase() ?? "",
          foId: fos[0] ? idOf(fos[0]) : "", foName: fos[0]?.name.toUpperCase() ?? "" } };
      }));
      setPicked(next);
      toast.success("Đã lấy crew từ FliteBrief");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không lấy được crew"); } finally { setLoadingCrew(false); }
  };

  const download = () => {
    localStorage.setItem("fpl_dsp", dsp);
    const blob = new Blob([reqBytes(text)], { type: "application/octet-stream" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "FPL.req"; a.click(); URL.revokeObjectURL(a.href);
  };

  if (dbQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">Đang tải bảng tra…</p>;
  if (dbQ.error || !db) return <p className="p-6 text-sm text-destructive">Không tải được bảng tra FPL.</p>;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[360px_1fr]">
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex gap-2">
            <select className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={dspFilter} onChange={(e) => setDspFilter(e.target.value)}>
              <option value="">Tất cả DSP</option>
              {dsps.map((d) => <option key={d}>{d}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => fq.refetch()} disabled={fq.isFetching}>{fq.isFetching ? "…" : "Làm mới"}</Button>
          </div>
          <Input placeholder="Tìm chuyến / REG / sân" value={s} onChange={(e) => setS(e.target.value)} />
          <div className="flex gap-2 text-xs">
            <button className="text-primary hover:underline" onClick={() => db && setPicked(list.map((f) => toFpl(db, f)))}>Chọn tất cả ({list.length})</button>
            <button className="text-muted-foreground hover:underline" onClick={() => setPicked([])}>Bỏ chọn</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {fq.data?.error && <p className="p-3 text-sm text-destructive">{fq.data.error}</p>}
          {list.map((f) => {
            const on = picked.some((r) => r.f.key === String(f.id));
            return (
              <label key={f.id} className={`flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm ${on ? "bg-primary/10" : "hover:bg-muted"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(f)} />
                <span className="w-20 font-mono font-semibold">{f.callsign}</span>
                <span className="font-mono text-xs">{f.depIata || f.dep}-{f.destIata || f.dest}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{fmtUtc(f.etd ?? f.std)}</span>
              </label>
            );
          })}
          {fq.isLoading && <p className="p-3 text-sm text-muted-foreground">Đang tải chuyến…</p>}
        </div>
      </section>

      <section className="flex min-h-0 flex-col gap-3 overflow-auto">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-sm">DSP</span>
          <Input value={dsp} onChange={(e) => setDsp(e.target.value.toUpperCase())} className="w-56" />
          <Button size="sm" variant="outline" onClick={loadCrew} disabled={!picked.length || loadingCrew}>{loadingCrew ? "Đang lấy crew…" : "Lấy crew từ FliteBrief"}</Button>
          <Button size="sm" variant="outline" disabled={!text} onClick={() => { navigator.clipboard.writeText(text); toast.success("Đã copy"); }}>Copy text</Button>
          <Button size="sm" disabled={!text} onClick={download}>Tải FPL.req</Button>
          <span className="ml-auto text-xs text-muted-foreground">TLK {db.tlk} · payload ngày {db.payloadDate}</span>
        </div>

        {!!picked.length && (
          <div className="overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left uppercase text-muted-foreground">
                <tr>{["Chuyến", "REG", "ETD Z", "Extra", "Seq", "Route Q", "ETP POA", "FL", "TALT", "ALT1", "ALT2", "RTE", "PAY", "TO PCR", "CPT", "FO", "RMK", ""].map((h) => <th key={h} className="px-1.5 py-1.5">{h}</th>)}</tr>
              </thead>
              <tbody>
                {picked.map((r) => {
                  const cell = (k: keyof FplOpts, w = "w-16", ph = "") => <td className="px-1 py-1"><Input value={r.o[k]} placeholder={ph} onChange={(e) => setOpt(r.f.key, k, e.target.value.toUpperCase())} className={`h-7 px-1.5 font-mono text-xs ${w}`} /></td>;
                  return (
                    <tr key={r.f.key} className="border-t border-border">
                      <td className="px-1.5 font-mono font-semibold">VJ{r.f.flt}<div className="font-normal text-muted-foreground">{r.f.dep}-{r.f.arr}</div></td>
                      <td className="px-1"><Input value={r.f.reg} onChange={(e) => setF(r.f.key, "reg", e.target.value.toUpperCase())} className="h-7 w-20 px-1.5 font-mono text-xs" /></td>
                      {cell("utc", "w-14", r.f.etdUtc)}
                      {cell("extra", "w-12")}
                      {cell("seq", "w-10")}
                      {cell("routeQ", "w-24")}
                      {cell("etpPoa", "w-24")}
                      {cell("fl", "w-14")}
                      {cell("talt", "w-14")}
                      {cell("alt1", "w-14")}
                      {cell("alt2", "w-14")}
                      {cell("rte", "w-10")}
                      {cell("pay", "w-16", payDefault(db, r.f.flt))}
                      {cell("pcrTo", "w-16")}
                      <td className="px-1"><Input value={`${r.f.cptId} ${r.f.cptName}`.trim()} onChange={(e) => { const [id = "", ...n] = e.target.value.toUpperCase().split(" "); setF(r.f.key, "cptId", id); setF(r.f.key, "cptName", n.join(" ")); }} className="h-7 w-40 px-1.5 text-xs" /></td>
                      <td className="px-1"><Input value={`${r.f.foId} ${r.f.foName}`.trim()} onChange={(e) => { const [id = "", ...n] = e.target.value.toUpperCase().split(" "); setF(r.f.key, "foId", id); setF(r.f.key, "foName", n.join(" ")); }} className="h-7 w-40 px-1.5 text-xs" /></td>
                      {cell("rmk", "w-28")}
                      <td className="px-1"><button className="text-muted-foreground hover:text-destructive" onClick={() => setPicked((p) => p.filter((x) => x.f.key !== r.f.key))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <pre className="min-h-[200px] flex-1 overflow-auto whitespace-pre rounded-lg border border-border bg-card p-3 font-mono text-xs">{text || "Chọn chuyến bên trái để sinh FPL text."}</pre>
      </section>
    </div>
  );
}
