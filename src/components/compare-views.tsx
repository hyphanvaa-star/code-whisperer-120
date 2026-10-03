import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, GitCompare, Loader2, Search, Upload } from "lucide-react";
import { getCrews, getFlights } from "@/lib/flights.functions";
import type { Crew } from "@/lib/flight-model";
import { saveBlob } from "@/lib/download";
import {
  compare, detectMapping, diffVersions, legLabel, matchedFlights, readTable, FIELDS, TABLE_COLUMNS, DEFAULT_FIELDS,
  type CompareResult, type Mapping, type Sheet, type VerResult,
} from "@/lib/excelcmp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


function FilePick({ label, onFile, name }: { label: string; onFile: (f: File) => void; name?: string | undefined }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <Button variant="outline" size="sm" onClick={() => ref.current?.click()}><Upload className="mr-1 h-4 w-4" />{label}</Button>
      <span className="max-w-[260px] truncate text-sm text-muted-foreground">{name || "Chưa chọn file"}</span>
    </div>
  );
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>, onTick?: (done: number) => void) {
  const out: R[] = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); onTick?.(++done); }
  }));
  return out;
}

export function FbCompare() {
  const fetchFlights = useServerFn(getFlights);
  const fetchCrews = useServerFn(getCrews);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [days, setDays] = useState("2");
  const [all, setAll] = useState(false);
  const [tol, setTol] = useState("0");
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState<CompareResult | null>(null);
  const [filter, setFilter] = useState<"all" | "bad" | "miss" | "ok">("all");
  const [q, setQ] = useState("");
  const [showMap, setShowMap] = useState(false);
  const sheet = sheets.find((s) => s.name === sheetName);

  const load = async (f: File) => {
    try {
      const s = await readTable(f);
      const best = s.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
      setSheets(s); setSheetName(best.name); setMapping(detectMapping(best.header)); setFileName(f.name); setRes(null);
      toast.success(`Đã đọc ${f.name}: ${best.rows.length} dòng`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const run = async () => {
    if (!sheet) return;
    setBusy("Đang tải chuyến bay FliteBrief…");
    try {
      const fr = await fetchFlights({ data: { days: Number(days) } });
      if (fr.error) throw new Error(fr.error);
      const crews = new Map<number, Crew[]>();
      const wantCrew = mapping["crew"] && (all || DEFAULT_FIELDS.includes("crew"));
      if (wantCrew) {
        const m = matchedFlights(sheet, fr.flights, mapping);
        setBusy(`Đang tải tổ bay 0/${m.length}…`);
        await pool(m, 6, async (f) => { const r = await fetchCrews({ data: { sectorId: f.id } }); crews.set(f.id, r.crews); }, (d) => setBusy(`Đang tải tổ bay ${d}/${m.length}…`));
      }
      const r = compare(sheet, fr.flights, crews, { mapping, tolerance: Number(tol) || 0, ...(all ? {} : { fields: DEFAULT_FIELDS }) });
      setRes(r);
      toast.success(`Đối chiếu xong: ${r.clean} khớp · ${r.mismatched} lệch · ${r.notFound} không thấy`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };

  const rows = useMemo(() => {
    if (!res) return [];
    const s = q.trim().toUpperCase();
    return res.rows.filter((r) => (filter === "all" || (filter === "bad" ? r.matched && r.diffs.length : filter === "miss" ? !r.matched : r.matched && !r.diffs.length))
      && (!s || JSON.stringify(r).toUpperCase().includes(s)));
  }, [res, filter, q]);

  const exportXlsx = async () => {
    if (!res) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Doi chieu");
    ws.addRow(["Dòng", ...TABLE_COLUMNS.map(([, l]) => l), "Kết quả", "Ghi chú"]).font = { bold: true };
    for (const r of res.rows) {
      const line = ws.addRow([r.rowNo, ...TABLE_COLUMNS.map(([k]) => {
        const c = r.cells[k];
        if (!c) return k === "callsign" ? r.callsign : "";
        return c.mapped && c.same === false ? `${c.excel} ≠ ${c.flite}` : c.flite;
      }), !r.matched ? "KHÔNG THẤY" : r.diffs.length ? `LỆCH ${r.diffs.map((d) => d.label).join(", ")}` : "KHỚP", [r.note, r.cells["crew"]?.detail].filter(Boolean).join(" · ")]);
      if (!r.matched || r.diffs.length) line.font = { color: { argb: "FFC41E3A" } };
    }
    ws.columns.forEach((c) => { c.width = 18; });
    saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `DoiChieu_${fileName.replace(/\.[^.]+$/, "")}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <FilePick label="Nạp Excel / CSV" onFile={load} name={fileName} />
        {sheets.length > 1 && (
          <Select value={sheetName} onValueChange={(v) => { setSheetName(v); const s = sheets.find((x) => x.name === v); if (s) setMapping(detectMapping(s.header)); setRes(null); }}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{sheets.map((s) => <SelectItem key={s.name} value={s.name}>{s.name} ({s.rows.length})</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{[1, 2, 3, 4].map((d) => <SelectItem key={d} value={String(d)}>FliteBrief {d} ngày</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={all} onCheckedChange={(v) => setAll(!!v)} />So mọi cột map được</label>
        {all && <label className="flex items-center gap-1.5 text-sm">Sai số số liệu <Input className="h-8 w-20" value={tol} onChange={(e) => setTol(e.target.value)} /></label>}
        <Button size="sm" variant="ghost" disabled={!sheet} onClick={() => setShowMap((v) => !v)}>Gắn cột ({Object.keys(mapping).length})</Button>
        <Button size="sm" disabled={!sheet || !!busy} onClick={run}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <GitCompare className="mr-1 h-4 w-4" />}Đối chiếu</Button>
        {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
      </div>

      {showMap && sheet && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 md:grid-cols-4 lg:grid-cols-6">
          {FIELDS.map((f) => (
            <label key={f.key} className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">{f.label}</span>
              <Select value={mapping[f.key] ?? "__none"} onValueChange={(v) => setMapping((m) => { const n = { ...m }; if (v === "__none") delete n[f.key]; else n[f.key] = v; return n; })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none">— không —</SelectItem>{sheet.header.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          ))}
        </div>
      )}

      {!sheet && <Empty text="Nạp file crewlist / kế hoạch bay (.xlsx hoặc .csv). File chỉ đọc trên máy bạn, không tải lên máy chủ." />}

      {res && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {([["all", `Tất cả ${res.rows.length}`], ["ok", `Khớp ${res.clean}`], ["bad", `Lệch ${res.mismatched}`], ["miss", `Không thấy ${res.notFound}`]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{l}</Button>
            ))}
            <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="h-8 w-56 pl-7" placeholder="Tìm…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <span className="text-muted-foreground">FliteBrief: {res.flightsTotal} chuyến · sheet {res.sheet}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportXlsx}><Download className="mr-1 h-4 w-4" />Xuất Excel</Button>
          </div>
          <div className="overflow-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                <tr><th className="px-2 py-2 text-left">Dòng</th>{TABLE_COLUMNS.map(([k, l]) => <th key={k} className="px-2 py-2 text-left">{l}</th>)}<th className="px-2 py-2 text-left">Ghi chú</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNo} className={`border-t align-top ${!r.matched ? "bg-warning/10" : r.diffs.length ? "bg-destructive/5" : ""}`}>
                    <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{r.rowNo}</td>
                    {!r.matched ? (
                      <><td className="px-2 py-1.5 font-mono font-semibold">{r.callsign}</td><td colSpan={TABLE_COLUMNS.length - 1} className="px-2 py-1.5 text-warning">Không ghép được chuyến</td></>
                    ) : TABLE_COLUMNS.map(([k]) => {
                      const c = r.cells[k];
                      if (!c) return <td key={k} />;
                      const bad = c.mapped && c.same === false;
                      return (
                        <td key={k} className={`px-2 py-1.5 ${k === "callsign" ? "font-mono font-semibold" : ""} ${bad ? "text-destructive" : ""}`} title={c.detail || undefined}>
                          {k === "crew" ? (
                            c.mapped ? <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${bad ? "bg-destructive/15" : "bg-success/15 text-success"}`}>{c.verdict}</span> : <span className="line-clamp-2 text-xs">{c.flite}</span>
                          ) : bad ? (<><div className="font-semibold">{c.flite}</div><div className="text-xs line-through opacity-70">Excel: {c.excel}</div></>)
                            : <span className={c.mapped && c.same ? "text-success" : ""}>{c.flite}</span>}
                          {k === "crew" && c.detail && <div className="mt-0.5 max-w-[280px] text-xs text-muted-foreground">{c.detail}</div>}
                        </td>
                      );
                    })}
                    <td className="max-w-[320px] px-2 py-1.5 text-xs text-muted-foreground">{r.note}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={TABLE_COLUMNS.length + 2} className="p-6 text-center text-muted-foreground">Không có dòng nào</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sheet && <RawSheet sheet={sheet} />}
    </div>
  );
}

function RawSheet({ sheet }: { sheet: Sheet }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    return sheet.rows.map((r, i) => [sheet.headerRow + 2 + i, r] as const).filter(([, r]) => !s || r.some((v) => String(v ?? "").toUpperCase().includes(s))).slice(0, 400);
  }, [sheet, q]);
  const fmt = (v: unknown) => (v instanceof Date ? v.toISOString().replace("T", " ").slice(0, 16).replace(" 00:00", "") : v == null ? "" : String(v));
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Excel nguyên bản — {sheet.name} ({sheet.rows.length} dòng)</summary>
      <div className="px-3 pb-2"><Input className="h-8 w-64" placeholder="Tìm trong Excel…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted"><tr><th className="px-2 py-1">#</th>{sheet.header.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 text-left">{h}</th>)}</tr></thead>
          <tbody>{rows.map(([n, r]) => <tr key={n} className="border-t"><td className="px-2 py-1 text-muted-foreground">{n}</td>{sheet.header.map((h, i) => <td key={h} className="whitespace-nowrap px-2 py-1">{fmt(r[i])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function VersionCompare() {
  const [a, setA] = useState<{ name: string; sheet: Sheet } | null>(null);
  const [b, setB] = useState<{ name: string; sheet: Sheet } | null>(null);
  const [res, setRes] = useState<VerResult | null>(null);
  const pickBest = async (f: File) => { const s = await readTable(f); return { name: f.name, sheet: s.reduce((x, y) => (y.rows.length > x.rows.length ? y : x)) }; };
  const load = (set: typeof setA) => async (f: File) => { try { set(await pickBest(f)); setRes(null); } catch (e) { toast.error((e as Error).message); } };
  const run = () => { if (!a || !b) return; try { setRes(diffVersions(a.sheet, b.sheet)); } catch (e) { toast.error((e as Error).message); } };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
        <FilePick label="Bản cũ" onFile={load(setA)} name={a?.name} />
        <FilePick label="Bản mới" onFile={load(setB)} name={b?.name} />
        <Button size="sm" disabled={!a || !b} onClick={run}><GitCompare className="mr-1 h-4 w-4" />So sánh</Button>
      </div>
      {!res && <Empty text="So hai phiên bản kế hoạch bay của CÙNG một ngày: đổi tàu (REG), đổi crew (bỏ DHD), delay theo ETD. Gợi ý điện ATC CHG / DLA." />}
      {res && (
        <>
          {res.warn && <div className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">{res.warn}</div>}
          <div className="flex flex-wrap gap-3 text-sm">
            <Stat label="Thay đổi" v={res.rows.length} /><Stat label="Đổi tàu" v={res.nReg} /><Stat label="Đổi crew" v={res.nCrew} /><Stat label="Delay" v={res.nDelay} />
            <Stat label="Mới thêm" v={res.added.length} /><Stat label="Đã bỏ" v={res.removed.length} />
            <span className="self-center text-muted-foreground">{res.oldLegs} → {res.newLegs} chặng</span>
          </div>
          <div className="overflow-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{["FLT thay đổi", "Đổi tàu", "Đổi crew", "Delay", "ATC"].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}</tr></thead>
              <tbody>
                {res.rows.map((r, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-2 py-1.5"><div className="font-mono font-semibold">{r.flt} <span className="font-normal">{r.route}</span></div><div className="text-xs text-muted-foreground">{r.dayNew} STD {r.stdNew}</div></td>
                    <td className="px-2 py-1.5">{r.reg.changed ? <span className="text-destructive">{r.reg.old} → <b>{r.reg.new}</b></span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5 text-xs">{r.crew.changed ? <><div className="text-destructive">Ra: {r.crew.out.join(", ") || "—"}</div><div className="text-success">Vào: {r.crew.in.join(", ") || "—"}</div></> : <span className="text-muted-foreground">—</span>}{r.crew.dhd.length > 0 && <div className="text-muted-foreground">DHD: {r.crew.dhd.join(", ")}</div>}</td>
                    <td className="px-2 py-1.5">{r.delay.min ? <span className="font-semibold text-destructive">{r.delay.min > 0 ? "+" : ""}{r.delay.min}′ <span className="text-xs font-normal">({r.delay.from || r.stdNew} → {r.delay.to})</span></span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5">{r.atc && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{r.atc}</span>}</td>
                  </tr>
                ))}
                {!res.rows.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Không có chuyến nào thay đổi</td></tr>}
              </tbody>
            </table>
          </div>
          {(res.added.length > 0 || res.removed.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="rounded-lg border bg-card p-3"><div className="mb-1 font-medium">Mới thêm</div>{res.added.map((l, i) => <div key={i} className="font-mono text-xs">{legLabel(l)}</div>)}</div>
              <div className="rounded-lg border bg-card p-3"><div className="mb-1 font-medium">Đã bỏ</div>{res.removed.map((l, i) => <div key={i} className="font-mono text-xs">{legLabel(l)}</div>)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const Stat = ({ label, v }: { label: string; v: number }) => (
  <div className="rounded-lg border bg-card px-3 py-1.5"><span className="text-muted-foreground">{label} </span><b className="font-mono">{v}</b></div>
);
const Empty = ({ text }: { text: string }) => <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
