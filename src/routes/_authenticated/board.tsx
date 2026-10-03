import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGlobalFilters, matchGlobal } from "@/lib/global-filters";
import { toast } from "sonner";
import { zipSync } from "fflate";
import { RefreshCw, Download, Square, Search, FileText, Eye, AlertTriangle, Lock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getCrews, getFlights } from "@/lib/flights.functions";
import { fmtNum, fmtUtc, type Flight } from "@/lib/flight-model";
import { fetchFbFile, openBlob, safeName, saveBlob } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getSetting } from "@/lib/settings.functions";
import { getWx } from "@/lib/ops.functions";
import { checkLimits, DEFAULT_LIMITS, type Limits } from "@/lib/limits";
import { wxAdvice, wxClass } from "@/lib/wx";

export const Route = createFileRoute("/_authenticated/board")({
  head: () => ({
    meta: [
      { title: "Bảng chuyến bay — Dispatch Board" },
      { name: "description", content: "Danh sách chuyến bay theo dispatcher, fuel, crew và tài liệu." },
      { property: "og:title", content: "Bảng chuyến bay — Dispatch Board" },
      { property: "og:description", content: "Danh sách chuyến bay theo dispatcher." },
    ],
  }),
  component: () => (
    <AppShell>
      <Board />
    </AppShell>
  ),
});

const ALL = "__all__";
type PibFilter = "all" | "missing" | "ok";

function Board() {
  const fetchFlights = useServerFn(getFlights);
  const [days, setDays] = useState(1);
  const q = useQuery({
    queryKey: ["flights", days],
    queryFn: () => fetchFlights({ data: { days } }),
    staleTime: 120_000,
    refetchInterval: 5 * 60_000,
  });

  const [dispatcher, setDispatcher] = useState(ALL);
  const [text, setText] = useState("");
  const [dep, setDep] = useState("");
  const [dest, setDest] = useState("");
  const [onlyPdf, setOnlyPdf] = useState(false);
  const [pib, setPib] = useState<PibFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useEffect(() => {
    const d = localStorage.getItem("board.dispatcher");
    if (d) setDispatcher(d);
  }, []);
  useEffect(() => {
    localStorage.setItem("board.dispatcher", dispatcher);
  }, [dispatcher]);

  const flights = q.data?.flights ?? [];
  const dispatchers = useMemo(() => {
    const m = new Map<string, { n: number; a: number }>();
    for (const f of flights) {
      const k = f.dispatcher || "(chưa gán)";
      const e = m.get(k) ?? { n: 0, a: 0 };
      e.n++;
      e.a += f.attachments.length;
      m.set(k, e);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [flights]);

  const [gf] = useGlobalFilters();
  const filtered = useMemo(() => {
    const t = text.trim().toUpperCase();
    return flights.filter((f) => {
      if (!matchGlobal(f, gf)) return false;
      if (dispatcher !== ALL && (f.dispatcher || "(chưa gán)") !== dispatcher) return false;
      if (t && !`${f.callsign} ${f.reg} ${f.planNo}`.toUpperCase().includes(t)) return false;
      if (dep && !f.dep.includes(dep.toUpperCase()) && !f.depIata.includes(dep.toUpperCase())) return false;
      if (dest && !f.dest.includes(dest.toUpperCase()) && !f.destIata.includes(dest.toUpperCase())) return false;
      if (onlyPdf && !f.attachments.some((a) => a.isPdf) && !f.hasOfp) return false;
      if (pib === "missing" && f.pibWx === "OK") return false;
      if (pib === "ok" && f.pibWx !== "OK") return false;
      return true;
    });
  }, [flights, gf, dispatcher, text, dep, dest, onlyPdf, pib]);

  const selected = flights.find((f) => f.id === selectedId) ?? null;

  const getSet = useServerFn(getSetting);
  const limQ = useQuery({ queryKey: ["setting", "limits"], queryFn: () => getSet({ data: { key: "limits" } }) });
  const limits = useMemo<Limits>(() => {
    try { const v = limQ.data?.json ? JSON.parse(limQ.data.json) : null; return v?.aircraft ? v : DEFAULT_LIMITS; } catch { return DEFAULT_LIMITS; }
  }, [limQ.data]);
  const wxFn = useServerFn(getWx);
  const destCodes = useMemo(() => [...new Set(filtered.map((f) => f.dest).filter((c) => /^[A-Z]{4}$/.test(c)))].sort().slice(0, 40), [filtered]);
  const wxQ = useQuery({
    queryKey: ["wx", destCodes.join(",")],
    queryFn: () => wxFn({ data: { codes: destCodes } }),
    enabled: destCodes.length > 0,
    staleTime: 10 * 60_000,
  });
  const tafMap = useMemo(() => Object.fromEntries((wxQ.data?.wx ?? []).map((w) => [w.icao, w.taf])) as Record<string, string>, [wxQ.data]);

  // bulk download
  const [dl, setDl] = useState<{ done: number; total: number; label: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runDownload = useCallback(async () => {
    const list = flights.filter((f) => checked.has(f.id));
    if (!list.length) {
      toast.info("Tick chọn ít nhất một chuyến");
      return;
    }
    const jobs = list.flatMap((f) => {
      const base = `${(f.std ?? "").slice(0, 10).replace(/-/g, "")}_${f.callsign}_${f.dep}-${f.dest}`;
      const items: { f: Flight; kind: "att" | "ofp"; att?: number; name: string }[] = [];
      if (f.hasOfp) items.push({ f, kind: "ofp", name: `${base}/OFP_${f.callsign}.pdf` });
      for (const a of f.attachments.filter((x) => x.isPdf))
        items.push({ f, kind: "att", att: a.id, name: `${base}/${safeName(a.filename)}` });
      return items;
    });
    if (!jobs.length) {
      toast.info("Các chuyến đã chọn không có PDF");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const files: Record<string, Uint8Array> = {};
    let fails = 0;
    setDl({ done: 0, total: jobs.length, label: "" });
    for (let i = 0; i < jobs.length; i++) {
      if (ac.signal.aborted) break;
      const j = jobs[i]!;
      setDl({ done: i, total: jobs.length, label: j.name });
      try {
        const b = await fetchFbFile({ sector: j.f.id, att: j.att, kind: j.kind }, ac.signal);
        let name = j.name;
        for (let k = 2; files[name]; k++) name = j.name.replace(/\.pdf$/i, ` (${k}).pdf`);
        files[name] = new Uint8Array(await b.arrayBuffer());
      } catch (e) {
        if (ac.signal.aborted) break;
        fails++;
      }
    }
    const got = Object.keys(files).length;
    setDl(null);
    abortRef.current = null;
    if (got) {
      const zip = zipSync(files, { level: 0 });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      saveBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `FliteBrief_${stamp}.zip`);
    }
    if (ac.signal.aborted) toast.warning(`Đã dừng — lưu ${got} file`);
    else toast.success(`Tải xong ${got}/${jobs.length} file${fails ? `, ${fails} lỗi` : ""}`);
  }, [checked, flights]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !dl) runDownload();
      if (e.key === "Escape") abortRef.current?.abort();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [runDownload, dl]);

  const allChecked = filtered.length > 0 && filtered.every((f) => checked.has(f.id));

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Select value={dispatcher} onValueChange={setDispatcher}>
          <SelectTrigger className="h-8 w-60">
            <SelectValue placeholder="Dispatcher" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả dispatcher ({flights.length})</SelectItem>
            {dispatchers.map(([n, s]) => (
              <SelectItem key={n} value={n}>
                {n} · {s.n} chuyến · {s.a} file
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-8 w-44 pl-7 font-mono uppercase"
            placeholder="Callsign / reg"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Input className="h-8 w-20 font-mono uppercase" placeholder="Đi" maxLength={4} value={dep} onChange={(e) => setDep(e.target.value)} />
        <Input className="h-8 w-20 font-mono uppercase" placeholder="Đến" maxLength={4} value={dest} onChange={(e) => setDest(e.target.value)} />
        <Select value={pib} onValueChange={(v) => setPib(v as PibFilter)}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">PIB/WX: tất cả</SelectItem>
            <SelectItem value="missing">PIB/WX: còn thiếu</SelectItem>
            <SelectItem value="ok">PIB/WX: đủ</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Checkbox checked={onlyPdf} onCheckedChange={(v) => setOnlyPdf(!!v)} /> Có PDF
        </label>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d} ngày
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="secondary" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> Làm mới
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {dl ? (
            <>
              <div className="w-48">
                <Progress value={(dl.done / dl.total) * 100} />
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {dl.done}/{dl.total} {dl.label}
                </div>
              </div>
              <Button size="sm" variant="destructive" onClick={() => abortRef.current?.abort()}>
                <Square className="h-4 w-4" /> Dừng
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={runDownload} disabled={!checked.size} title="Ctrl + Enter">
              <Download className="h-4 w-4" /> Tải PDF ({checked.size})
            </Button>
          )}
        </div>
      </div>

      {q.data?.error && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/15 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {q.data.error}
        </div>
      )}
      {q.error && (
        <div className="border-b border-border bg-destructive/15 px-4 py-2 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* table */}
        <div className="min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(v) =>
                      setChecked((s) => {
                        const n = new Set(s);
                        for (const f of filtered) v ? n.add(f.id) : n.delete(f.id);
                        return n;
                      })
                    }
                  />
                </th>
                <th className="px-2 py-2">Callsign</th>
                <th className="px-2 py-2">Route</th>
                <th className="px-2 py-2">STD/STA</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">ALT</th>
                <th className="px-2 py-2">Reg</th>
                <th className="px-2 py-2">Limit</th>
                <th className="px-2 py-2">Attch</th>
                <th className="px-2 py-2">PIB/WX</th>
                <th className="px-2 py-2">TAF</th>
                <th className="px-2 py-2 text-right">Extra</th>
                <th className="px-2 py-2">DSP</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading &&
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td colSpan={13} className="px-3 py-2.5">
                      <div className="h-3 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                ))}
              {!q.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-12 text-center text-muted-foreground">
                    Không có chuyến nào khớp bộ lọc.
                  </td>
                </tr>
              )}
              {filtered.map((f) => {
                const lim = checkLimits(f, limits);
                const crit = lim.some((w) => w.severity === "critical");
                const taf = tafMap[f.dest];
                const tafLv = taf ? wxAdvice(taf) : null;
                return (
                <tr
                  key={f.id}
                  onClick={() => setSelectedId(f.id)}
                  className={cn(
                    "cursor-pointer border-b border-border/50 hover:bg-secondary/60",
                    selectedId === f.id && "bg-accent",
                  )}
                >
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checked.has(f.id)}
                      onCheckedChange={(v) =>
                        setChecked((s) => {
                          const n = new Set(s);
                          v ? n.add(f.id) : n.delete(f.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-foreground">
                    {f.callsign}
                    {f.isLocked && <Lock className="ml-1 inline h-3 w-3 text-muted-foreground" />}
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {f.dep}–{f.dest}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{fmtUtc(f.std)}<br /><span className="text-muted-foreground">{fmtUtc(f.sta)}</span></td>
                  <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{f.status || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{[f.alt1, f.alt2].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{f.reg || "—"} <RegBadge v={f.regMatch} /></td>
                  <td className="px-2 py-1.5 text-xs" title={lim.map((w) => w.text).join("\n")}>
                    {lim.length ? <span className={cn("rounded px-1.5 py-0.5", crit ? "bg-primary/15 font-semibold text-primary" : "bg-amber-400/25 text-amber-800")}>{crit ? "VI PHẠM" : "Lưu ý"} {lim.length}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{f.attachments.length}</td>
                  <td className="px-2 py-1.5">
                    <PibBadge v={f.pibWx} />
                  </td>
                  <td className="px-2 py-1.5 text-xs" title={taf || "Chưa có TAF"}>
                    {tafLv ? <span className={cn("rounded px-1.5 py-0.5", wxClass[tafLv.level])}>{tafLv.level === "ok" ? "OK" : tafLv.reasons[0] || tafLv.level.toUpperCase()}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtNum(f.fuel.extra)}</td>
                  <td className="truncate px-2 py-1.5 text-muted-foreground">{f.dispatcher || "—"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {q.data && (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              {filtered.length}/{flights.length} chuyến · cập nhật {new Date(q.data.fetchedAt).toLocaleTimeString("vi-VN")}
            </div>
          )}
        </div>

        {/* detail */}
        <aside className="min-h-0 overflow-auto border-l border-border bg-card/40">
          {selected ? <Detail f={selected} /> : <div className="p-6 text-sm text-muted-foreground">Chọn một chuyến để xem chi tiết.</div>}
        </aside>
      </div>
    </div>
  );
}

function PibBadge({ v }: { v: Flight["pibWx"] }) {
  const map = {
    OK: ["OK", "bg-success/15 text-success"],
    MISS_WX: ["Thiếu WX", "bg-warning/15 text-warning"],
    MISS_PIB: ["Thiếu PIB", "bg-warning/15 text-warning"],
    MISS_BOTH: ["Thiếu cả 2", "bg-destructive/15 text-destructive"],
  } as const;
  const [t, c] = map[v];
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", c)}>{t}</span>;
}

function RegBadge({ v }: { v: boolean | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return v ? (
    <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs text-success">Khớp</span>
  ) : (
    <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">Sai tàu</span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-mono text-foreground">{v}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-4">
      <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-primary">{title}</h3>
      {children}
    </section>
  );
}

function Detail({ f }: { f: Flight }) {
  const crewsFn = useServerFn(getCrews);
  const crews = useQuery({
    queryKey: ["crews", f.id],
    queryFn: () => crewsFn({ data: { sectorId: f.id } }),
    staleTime: 300_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, p: { kind: "att" | "ofp"; att?: number | undefined }, name: string, mode: "view" | "save") {
    setBusy(key);
    try {
      const b = await fetchFbFile({ sector: f.id, ...p });
      mode === "view" ? openBlob(b) : saveBlob(b, name);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-2xl font-bold text-foreground">{f.callsign}</h2>
          <span className="font-mono text-xs text-muted-foreground">Plan {f.planNo || "—"}</span>
        </div>
        <div className="mt-1 font-mono text-sm text-muted-foreground">
          {f.dep} → {f.dest}
          {(f.alt1 || f.alt2) && ` · ALT ${[f.alt1, f.alt2].filter(Boolean).join("/")}`}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {f.status && <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">{f.status}</span>}
          {f.etops && <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">ETOPS</span>}
          {f.needsReRelease && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">Cần release lại</span>}
          {f.verifiedBy && <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">Verified · {f.verifiedBy}</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" disabled={!f.hasOfp || busy === "ofp"} onClick={() => act("ofp", { kind: "ofp" }, `OFP_${f.callsign}.pdf`, "view")}>
            <Eye className="h-4 w-4" /> Xem OFP
          </Button>
          <Button size="sm" variant="ghost" disabled={!f.hasOfp || busy === "ofp"} onClick={() => act("ofp", { kind: "ofp" }, `OFP_${f.callsign}.pdf`, "save")}>
            <Download className="h-4 w-4" /> Tải OFP
          </Button>
        </div>
      </div>

      <Section title="Thời gian (UTC)">
        <Row k="STD / STA" v={`${fmtUtc(f.std)} · ${fmtUtc(f.sta)}`} />
        {f.etd && <Row k="ETD" v={fmtUtc(f.etd)} />}
        {f.atd && <Row k="ATD / ATA" v={`${fmtUtc(f.atd)} · ${fmtUtc(f.ata)}`} />}
        <Row k="EET" v={f.eet ? `${f.eet.slice(0, 2)}:${f.eet.slice(2)}` : "—"} />
        <Row k="Tàu bay" v={`${f.reg || "—"} ${f.acType}`} />
      </Section>

      <Section title={`Nhiên liệu (${f.fuel.units})`}>
        <div className="grid grid-cols-2 gap-x-6">
          <Row k="Trip" v={fmtNum(f.fuel.trip)} />
          <Row k="Block" v={fmtNum(f.fuel.total)} />
          <Row k="Taxi" v={fmtNum(f.fuel.taxi)} />
          <Row k="Reserve" v={fmtNum(f.fuel.reserve)} />
          <Row k="Alternate" v={fmtNum(f.fuel.alternate)} />
          <Row k="Contingency" v={fmtNum(f.fuel.contingency)} />
          <Row k="Extra" v={fmtNum(f.fuel.extra)} />
          <Row k="Tankering" v={fmtNum(f.fuel.tankering)} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 border-t border-border pt-2">
          <Row k="TOW" v={fmtNum(f.tow)} />
          <Row k="LWT" v={fmtNum(f.lwt)} />
        </div>
      </Section>

      <Section title={`Tổ bay (${f.crewCount})`}>
        {crews.isLoading && <div className="text-sm text-muted-foreground">Đang tải…</div>}
        {crews.data?.error && <div className="text-sm text-destructive">{crews.data.error}</div>}
        {crews.data && !crews.data.error && crews.data.crews.length === 0 && (
          <div className="text-sm text-muted-foreground">Chưa có tổ bay.</div>
        )}
        <ul className="space-y-1">
          {crews.data?.crews.map((c) => (
            <li key={c.id} className="flex justify-between gap-2 text-sm">
              <span className="text-foreground">
                {c.name} {c.commander && <span className="text-primary">★</span>}
                {c.deadheading && <span className="ml-1 text-xs text-muted-foreground">DHC</span>}
              </span>
              <span className="text-xs text-muted-foreground">{c.job}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Tài liệu (${f.attachments.length})`}>
        {f.attachments.length === 0 && <div className="text-sm text-muted-foreground">Không có file đính kèm.</div>}
        <ul className="space-y-1">
          {f.attachments.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-secondary">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={a.filename}>
                {a.filename}
              </span>
              {a.kind !== "OTHER" && <span className="rounded bg-info/15 px-1 text-[10px] text-info">{a.kind}</span>}
              <button
                className="text-muted-foreground hover:text-foreground"
                title="Xem"
                disabled={busy === `a${a.id}`}
                onClick={() => act(`a${a.id}`, { kind: "att", att: a.id }, a.filename, "view")}
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                className="text-muted-foreground hover:text-foreground"
                title="Tải"
                disabled={busy === `a${a.id}`}
                onClick={() => act(`a${a.id}`, { kind: "att", att: a.id }, safeName(a.filename), "save")}
              >
                <Download className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lịch sử">
        <ul className="space-y-1.5">
          {f.audit.map((x, i) => (
            <li key={i} className="text-xs">
              <span className="font-mono text-muted-foreground">{fmtUtc(x.at)}</span>{" "}
              <span className="text-foreground">{x.action}</span>
              {x.by && <span className="text-muted-foreground"> · {x.by}</span>}
            </li>
          ))}
          {f.audit.length === 0 && <li className="text-sm text-muted-foreground">Không có dữ liệu.</li>}
        </ul>
      </Section>
    </div>
  );
}
