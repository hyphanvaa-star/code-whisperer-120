import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFlights } from "@/lib/flights.functions";
import { getNotams, type Notam, type Place } from "@/lib/ops.functions";
import { fmtUtc } from "@/lib/flight-model";
import { matchGlobal, useGlobalFilters } from "@/lib/global-filters";

export const Route = createFileRoute("/_authenticated/notam")({
  head: () => ({
    meta: [
      { title: "Check NOTAM — Dispatch Board" },
      { name: "description", content: "Check NOTAM sân đi/đến/dự bị theo chuyến, lọc 24H, bản đồ vùng NOTAM." },
      { property: "og:title", content: "Check NOTAM — Dispatch Board" },
      { property: "og:description", content: "Check NOTAM sân đi/đến/dự bị theo chuyến, lọc 24H, bản đồ vùng NOTAM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AppShell><NotamPage /></AppShell>),
});

// Port notam_in_24h: còn hiệu lực hoặc bắt đầu trong 24h.
function in24h(n: Notam, now = Date.now()) {
  const st = Date.parse(n.start), en = Date.parse(n.end);
  if (!Number.isNaN(st) && st > now + 24 * 3600e3) return false;
  if (!Number.isNaN(en) && en < now) return false;
  return true;
}
// Mức quan trọng theo Q-code (như tool gốc tô đỏ đường băng đóng, sân đóng, nav aid…)
function sev(n: Notam): "hi" | "mid" | "lo" {
  const q = n.qcode.toUpperCase().slice(1);
  const e = n.eField.toUpperCase();
  if (/^(MR|FA|MX)..*(LC|AH|CL)?/.test(q) && /CLSD|CLOSED/.test(e)) return "hi";
  if (/^(MR|FA)/.test(q) || /RWY.*CLSD|AD CLSD|ILS.*U\/S|FUEL NOT AVBL/.test(e)) return "hi";
  if (/^(IC|IG|IL|NV|ND|PI|PD|PA|OB|RA|RD|RT|WM|WE)/.test(q)) return "mid";
  return "lo";
}
const SEV = { hi: "border-l-primary bg-primary/5", mid: "border-l-amber-500 bg-amber-400/10", lo: "border-l-border" };

// "2103N10548E" → [lat, lon]
function parseCoord(c: string): [number, number] | null {
  const m = c.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])/);
  if (!m) return null;
  const lat = (+m[1] + +m[2] / 60) * (m[3] === "S" ? -1 : 1);
  const lon = (+m[4] + +m[5] / 60) * (m[6] === "W" ? -1 : 1);
  return [lat, lon];
}

function NotamPage() {
  const fetchFlights = useServerFn(getFlights);
  const fetchNotams = useServerFn(getNotams);
  const [g] = useGlobalFilters();
  const [days, setDays] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [places, setPlaces] = useState<Place[]>([]);
  const [only24, setOnly24] = useState(true);
  const [q, setQ] = useState("");
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState("");
  const [focus, setFocus] = useState<string>("");
  const [onlyHi, setOnlyHi] = useState(false);
  const fq = useQuery({ queryKey: ["flights", days], queryFn: () => fetchFlights({ data: { days } }), staleTime: 120_000 });
  const flights = useMemo(() => (fq.data?.flights ?? []).filter((f) => matchGlobal(f, g)), [fq.data, g]);

  async function run(list: string[]) {
    const u = [...new Set(list.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{4}$/.test(c)))];
    if (!u.length) return;
    setBusy(`Đang lấy NOTAM ${u.length} sân/FIR từ FliteBrief…`);
    const out: Place[] = [];
    for (let i = 0; i < u.length; i += 20) {
      setBusy(`Đang lấy NOTAM ${Math.min(i + 20, u.length)}/${u.length}…`);
      const r = await fetchNotams({ data: { codes: u.slice(i, i + 20) } });
      out.push(...r.places);
    }
    setPlaces(out);
    setFocus(out[0]?.code ?? "");
    setBusy("");
  }
  const checkSelected = () => {
    const fs = flights.filter((f) => sel.has(f.id));
    run(fs.flatMap((f) => [f.dep, f.dest, f.alt1, f.alt2]));
  };

  const shown = useMemo(() => places.map((p) => {
    const k = q.trim().toUpperCase();
    const ns = p.notams.filter((n) => (!only24 || in24h(n)) && (!onlyHi || sev(n) === "hi") && (!k || n.text.toUpperCase().includes(k)));
    return { p, ns };
  }), [places, only24, q, onlyHi]);
  const cur = shown.find((x) => x.p.code === focus);
  const pts = (cur?.ns ?? []).map((n) => ({ n, c: parseCoord(n.coords) })).filter((x) => x.c) as { n: Notam; c: [number, number] }[];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 text-sm">
        <select className="h-8 rounded-md border border-input bg-background px-2" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 2, 3].map((d) => <option key={d} value={d}>{d} ngày</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => setSel(new Set(flights.map((f) => f.id)))}>Chọn tất cả</Button>
        <Button size="sm" variant="outline" onClick={() => setSel(new Set())}>Bỏ chọn</Button>
        <Button size="sm" onClick={checkSelected} disabled={!sel.size || !!busy}>Check ({sel.size} chuyến)</Button>
        <Input className="h-8 w-56" placeholder="Get: VVTS VVNB VVHN…" value={codes} onChange={(e) => setCodes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(codes.split(/[\s,]+/))} />
        <Button size="sm" variant="outline" onClick={() => run(codes.split(/[\s,]+/))} disabled={!!busy}>Get</Button>
        <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={only24} onChange={(e) => setOnly24(e.target.checked)} /> 24H</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyHi} onChange={(e) => setOnlyHi(e.target.checked)} /> Chỉ quan trọng</label>
        <Input className="h-8 w-48" placeholder="Tìm trong NOTAM (RWY, ILS…)" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <span className="text-xs text-primary">{busy}</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_380px]">
        <div className="min-h-0 overflow-auto border-r border-border bg-card">
          {fq.isLoading && <p className="p-3 text-xs text-muted-foreground">Đang tải chuyến…</p>}
          {flights.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-xs hover:bg-muted">
              <input type="checkbox" checked={sel.has(f.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(f.id) : n.delete(f.id); setSel(n); }} />
              <span className="font-mono font-semibold">{f.callsign}</span>
              <span className="font-mono">{f.dep}-{f.dest}</span>
              <span className="ml-auto font-mono text-muted-foreground">{fmtUtc(f.std).slice(6)}</span>
            </label>
          ))}
        </div>
        <div className="min-h-0 overflow-auto p-3">
          {!places.length && !busy && <p className="text-sm text-muted-foreground">Chọn chuyến rồi bấm Check, hoặc gõ mã sân/FIR rồi Get.</p>}
          <div className="mb-2 flex flex-wrap gap-1">
            {shown.map(({ p, ns }) => (
              <button key={p.code} onClick={() => setFocus(p.code)}
                className={`rounded-full px-3 py-1 font-mono text-xs ${focus === p.code ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {p.code} <b>{ns.length}</b>{ns.some((n) => sev(n) === "hi") && " ●"}
              </button>
            ))}
          </div>
          {cur && (
            <div>
              <div className="mb-2 text-sm"><b>{cur.p.code}</b> {cur.p.name} {cur.p.kind === "FIR" ? "(FIR)" : cur.p.fir && `· FIR ${cur.p.fir}`} · {cur.ns.length}/{cur.p.notams.length} NOTAM
                {cur.p.error && <span className="ml-2 text-primary">{cur.p.error}</span>}</div>
              {cur.ns.map((n) => (
                <pre key={n.id + n.ident} className={`mb-2 whitespace-pre-wrap rounded border border-l-4 border-border p-2 font-mono text-[11px] leading-snug ${SEV[sev(n)]}`}>{n.text}</pre>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 overflow-auto border-l border-border bg-card p-2">
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Bản đồ vùng NOTAM {cur && `— ${cur.p.code}`}</div>
          <NotamMap pts={pts} />
          <p className="mt-1 text-[11px] text-muted-foreground">{pts.length} NOTAM có toạ độ (vòng tròn = bán kính Q-line). Rê chuột vào điểm để xem.</p>
        </div>
      </div>
    </div>
  );
}

function NotamMap({ pts }: { pts: { n: Notam; c: [number, number] }[] }) {
  if (!pts.length) return <div className="flex h-72 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">Không có toạ độ</div>;
  const lats = pts.map((p) => p.c[0]), lons = pts.map((p) => p.c[1]);
  const pad = 0.5;
  const minLa = Math.min(...lats) - pad, maxLa = Math.max(...lats) + pad, minLo = Math.min(...lons) - pad, maxLo = Math.max(...lons) + pad;
  const W = 360, H = 360;
  const sc = Math.min(W / (maxLo - minLo), H / (maxLa - minLa));
  const x = (lo: number) => (lo - minLo) * sc, y = (la: number) => H - (la - minLa) * sc;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-border bg-muted/40">
      {pts.map(({ n, c }, i) => {
        const r = Number(n.coords.slice(11)) || 5;
        const s = sev(n);
        return (
          <g key={i}>
            <circle cx={x(c[1])} cy={y(c[0])} r={Math.max(3, (r / 60) * sc)} className={s === "hi" ? "fill-primary/20 stroke-primary" : "fill-amber-400/20 stroke-amber-600"} />
            <circle cx={x(c[1])} cy={y(c[0])} r={2.5} className="fill-foreground"><title>{n.text}</title></circle>
          </g>
        );
      })}
    </svg>
  );
}
