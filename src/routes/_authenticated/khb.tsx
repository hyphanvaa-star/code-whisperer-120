import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCrews, getFlights } from "@/lib/flights.functions";
import { getFplDb } from "@/lib/fpl.functions";
import { getSetting } from "@/lib/settings.functions";
import { DEFAULT_LIMITS, type Limits } from "@/lib/limits";
import { useGlobalFilters, matchGlobal } from "@/lib/global-filters";
import { acFamily, defaults, localHm, normReg, renderFpl, reqBytes, utcHhmm, type FplDb, type FplFlight, type FplOpts } from "@/lib/fpl";
import type { Flight } from "@/lib/flight-model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/khb")({
  head: () => ({
    meta: [
      { title: "Tạo KHB / FPL — Dispatch Board" },
      { name: "description", content: "Lưới Tạo KHB: gõ số hiệu, tự điền route/ALT/crew, xuất FPL.req theo sheet TOOL." },
      { property: "og:title", content: "Tạo KHB / FPL — Dispatch Board" },
      { property: "og:description", content: "Lưới Tạo KHB: gõ số hiệu, tự điền route/ALT/crew, xuất FPL.req theo sheet TOOL." },
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

const SHEET = 30;
type Row = { f: FplFlight; o: FplOpts; src: Flight; on: boolean };

function toRow(db: FplDb, f: Flight): Row {
  const dep = (f.depIata || f.dep).toUpperCase(), arr = (f.destIata || f.dest).toUpperCase();
  const etd = f.etd ?? f.std;
  return {
    src: f, on: true,
    f: {
      key: String(f.id), flt: f.callsign.replace(/\D/g, "").replace(/^0+/, ""), date: etd?.slice(0, 10) ?? "",
      reg: normReg(f.reg), ac: acFamily(f.acType), dep, arr, etdUtc: utcHhmm(etd), staLocal: localHm(f.sta, db.tz[arr] ?? "07:00"),
      cptId: "", cptName: "", cpt2Id: "", cpt2Name: "", foId: "", foName: "",
    },
    o: { extra: "0", seq: "", ...defaults(db, dep, arr), rte: "", rmk: "", pcrTo: "", pay: "", utc: "", dsp: "" },
  };
}

/* ---- giới hạn theo ô (port ftLimHits của tool gốc) ---- */
type K = "dep" | "arr" | "talt" | "alt1" | "alt2";
type Hit = { sev: "crit" | "warn"; why: string };
const nApt = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const aptHit = (v: string, code: string) => { const a = nApt(v), c = nApt(code); return !!a && !!c && (a === c || a.endsWith(c) || c.endsWith(a)); };
const hmOf = (s: string) => { const m = (s || "").replace(":", "").match(/^(\d{2})(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const inCurfew = (t: number, s: string, e: string) => {
  const a = hmOf(s), b = hmOf(e);
  if (a != null && b != null) return a === b || (a < b ? t >= a && t <= b : t >= a || t <= b);
  if (a != null) return t >= a; if (b != null) return t <= b; return false;
};
const typeMatch = (tok: string, ac: string) => {
  const t = tok.toUpperCase(); const a = ac === "330" ? "A330" : ac === "321" ? "A321" : ac === "320" ? "A320" : "";
  if (!a) return false; if (/33/.test(t)) return a === "A330"; if (/321|A21|NEO/.test(t)) return a === "A321"; if (/320/.test(t)) return a === "A320"; return t.includes(a);
};
function limHits(r: Row, L: Limits) {
  const etaZ = utcHhmm(r.src.sta);
  const places: [K, string, string][] = [["dep", r.f.dep, "DEP"], ["arr", r.f.arr, "DEST"], ["talt", r.o.talt, "TALT"], ["alt1", r.o.alt1, "ALT1"], ["alt2", r.o.alt2, "ALT2"]];
  const h: Record<K, Hit[]> = { dep: [], arr: [], talt: [], alt1: [], alt2: [] };
  const regK = nApt(r.f.reg);
  const apuInop = L.aircraft.some((x) => nApt(x.reg).endsWith(regK.slice(-3)) && /APU/i.test(x.defect + x.limit) && /INOP|U\/S|UNSERVICEABLE/i.test(x.defect + x.limit));
  for (const a of L.airports) {
    if (!a.code || !a.limit) continue;
    const closed = /CLOSED|RECONSTRUCTION/i.test(a.limit), noApu = /NO APU|NO.*APU SERVICE/i.test(a.limit);
    for (const [k, v, role] of places) if (aptHit(v, a.code))
      h[k].push({ sev: closed || (noApu && apuInop) ? "crit" : "warn", why: `${role} ${v}: ${a.limit}${noApu && apuInop ? " — tàu APU INOP" : ""}` });
  }
  for (const c of L.curfew) for (const [k, v, role] of places) if (c.code && aptHit(v, c.code)) {
    const t = hmOf(k === "dep" ? r.f.etdUtc : etaZ);
    if (t == null) h[k].push({ sev: "warn", why: `${role} ${v} có curfew ${c.start}→${c.end} UTC` });
    else if (inCurfew(t, c.start, c.end)) h[k].push({ sev: "crit", why: `CURFEW ${v}: ${role} trong ${c.start}→${c.end} UTC` });
    else {
      const f = (x: number | null) => { if (x == null) return ""; const y = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(y / 60)).padStart(2, "0")}:${String(y % 60).padStart(2, "0")}`; };
      const a = hmOf(c.start), b = hmOf(c.end);
      if ((a != null && inCurfew(t, f(a - 90), f(a))) || (b != null && inCurfew(t, f(b), f(b + 90))))
        h[k].push({ sev: "warn", why: `SÁT CURFEW ${v}: ${role} trong vùng đệm 1h30 của ${c.start}→${c.end} UTC` });
    }
  }
  for (const s of L.special) {
    if (!s.reg || !s.code || !s.limit) continue;
    const roles = places.filter((p) => aptHit(p[1], s.code)); if (!roles.length) continue;
    if (/ONLY OPS/i.test(s.limit)) { if (!typeMatch(s.reg, r.f.ac)) roles.forEach(([k, v]) => h[k].push({ sev: "crit", why: `${s.reg} @ ${v}: ${s.limit}` })); continue; }
    if (!typeMatch(s.reg, r.f.ac)) continue;
    const destAlt = /DESTINATION ALTERNATE/i.test(s.limit), toAlt = /TAKE[\s-]?OFF\s+ALT|T\/O\s+ALT/i.test(s.limit);
    roles.forEach(([k, v, role]) => {
      if ((destAlt || toAlt) && !((destAlt && (role === "ALT1" || role === "ALT2")) || (toAlt && role === "TALT"))) return;
      h[k].push({ sev: "crit", why: `${s.reg} @ ${role} ${v}: ${s.limit}` });
    });
  }
  return h;
}
const perfSev = (t: string) => /FUEL PENALT|APU INOP|APU U\/S|EDTO IS NOT|DOWNGRADED TO CAT|CAT 1|CAT I\b|LIMITED TO|MAX(?:IMUM)?.{0,16}(TOW|LWT|ZFW)/i.test(t) ? "crit" : /NOT REQUIRE|CONSIDER RSVP|CONSIDER IROP|DATA MODE/i.test(t) ? "ok" : "warn";

function Khb() {
  const dbFn = useServerFn(getFplDb), flFn = useServerFn(getFlights), crewFn = useServerFn(getCrews), setFn = useServerFn(getSetting);
  const dbQ = useQuery({ queryKey: ["fpl-db"], queryFn: () => dbFn(), staleTime: Infinity });
  const fq = useQuery({ queryKey: ["flights", 2], queryFn: () => flFn({ data: { days: 2 } }), staleTime: 120_000 });
  const lq = useQuery({ queryKey: ["setting", "limits"], queryFn: () => setFn({ data: { key: "limits" } }) });
  const limits = useMemo<Limits>(() => { try { const v = lq.data?.json ? JSON.parse(lq.data.json) : null; return v?.aircraft ? v : DEFAULT_LIMITS; } catch { return DEFAULT_LIMITS; } }, [lq.data]);
  const [gf] = useGlobalFilters();
  const db = dbQ.data;

  const [rows, setRows] = useState<(Row | null)[]>(() => Array(SHEET).fill(null));
  const [pending, setPending] = useState<string[]>(() => Array(SHEET).fill(""));
  const [dsp, setDsp] = useState("");
  const [extra, setExtra] = useState(""), [seq, setSeq] = useState("");
  const [stat, setStat] = useState("Gõ số hiệu vào cột Số rồi Enter (nhiều số cách nhau bằng dấu cách).");
  const [preview, setPreview] = useState("");
  const [lib, setLib] = useState<null | "ci" | "taxi" | "route" | "alt" | "era" | "pcr">(null);
  const [pld, setPld] = useState(false);
  useEffect(() => { setDsp(localStorage.getItem("fpl_dsp") ?? ""); }, []);
  useEffect(() => { if (db && !dsp) setDsp(db.dsp); }, [db, dsp]);

  const flights = fq.data?.flights ?? [];
  const filled = rows.filter(Boolean) as Row[];
  const picked = filled.filter((r) => r.on);

  const findFlights = (nums: string[]) => {
    const now = Date.now();
    const found: Flight[] = [], miss: string[] = [];
    for (const n of nums) {
      const k = n.replace(/\D/g, "").replace(/^0+/, ""); if (!k) continue;
      const c = flights.filter((f) => f.callsign.replace(/\D/g, "").replace(/^0+/, "") === k && matchGlobal(f, { ...gf, callsign: "" }))
        .sort((a, b) => Math.abs(Date.parse(a.std ?? "") - now) - Math.abs(Date.parse(b.std ?? "") - now));
      const inWin = c.filter((f) => { const t = Date.parse(f.std ?? ""); return t > now - 6 * 3600e3 && t < now + 24 * 3600e3; })
        .sort((a, b) => (a.std ?? "").localeCompare(b.std ?? ""));
      if (inWin[0]) c.unshift(inWin[0]);
      if (c[0] && !found.includes(c[0])) found.push(c[0]); else if (!c[0]) miss.push(n);
    }
    return { found, miss };
  };

  const enter = (i: number, v: string) => {
    if (!db) return;
    const nums = v.trim().split(/[\s,;]+/).filter(Boolean);
    if (!nums.length) { setRows((r) => r.map((x, j) => (j === i ? null : x))); return; }
    const { found, miss } = findFlights(nums);
    setRows((prev) => {
      const next = [...prev]; let at = i;
      for (const f of found) { if (next.some((x) => x?.f.key === String(f.id))) continue; while (at < next.length && next[at] && at !== i) at++; if (at >= next.length) next.push(null); next[at] = toRow(db, f); at++; }
      while (next.length < SHEET) next.push(null);
      return next;
    });
    setPending((p) => p.map((x, j) => (j === i ? "" : x)));
    setStat(`Đã thêm ${found.length} chuyến${miss.length ? `. Không có trên FliteBrief: ${miss.join(" ")}` : ""}`);
  };

  const upd = (i: number, fn: (r: Row) => Row) => setRows((p) => p.map((x, j) => (j === i && x ? fn(x) : x)));
  const setO = (i: number, k: keyof FplOpts, v: string) => upd(i, (r) => ({ ...r, o: { ...r.o, [k]: v } }));
  const setFF = (i: number, k: keyof FplFlight, v: string) => upd(i, (r) => ({ ...r, f: { ...r.f, [k]: v } }));
  const allOn = filled.length > 0 && filled.every((r) => r.on);

  const text = useMemo(() => (db ? picked.map((r) => renderFpl(db, r.f, { ...r.o, dsp })).join("\n\n") : ""), [db, picked, dsp]);

  const loadCrew = async (only?: Row[]) => {
    const targets = only ?? filled.filter((r) => !r.f.cptName && !r.f.foName);
    if (!targets.length) return;
    setStat(`Đang lấy crew ${targets.length} chuyến…`);
    const res = await Promise.all(targets.map(async (r) => {
      try {
        const { crews } = await crewFn({ data: { sectorId: r.src.id } });
        const live = crews.filter((c) => !c.deadheading);
        const isFo = (c: (typeof live)[number]) => /\bFO\b|FIRST|F\/O|SFO/i.test(c.job);
        const isCp = (c: (typeof live)[number]) => c.commander || /\bCP\b|CAPT|CPT|PIC|TRI|TRE|LTC/i.test(c.job);
        const idOf = (c: (typeof live)[number]) => c.username.replace(/\D/g, "") || c.username;
        const byId = (a: (typeof live)[number], b: (typeof live)[number]) => Number(idOf(a)) - Number(idOf(b));
        const cps = live.filter((c) => isCp(c) && !isFo(c)).sort(byId), fos = live.filter(isFo).sort(byId);
        return [r.f.key, { cptId: cps[0] ? idOf(cps[0]) : "", cptName: cps[0]?.name.toUpperCase() ?? "", cpt2Id: cps[1] ? idOf(cps[1]) : "", cpt2Name: cps[1]?.name.toUpperCase() ?? "", foId: fos[0] ? idOf(fos[0]) : "", foName: fos[0]?.name.toUpperCase() ?? "" }] as const;
      } catch { return [r.f.key, null] as const; }
    }));
    const m = new Map(res);
    setRows((p) => p.map((x) => { const c = x && m.get(x.f.key); return x && c ? { ...x, f: { ...x.f, ...c } } : x; }));
    setStat(`Đã lấy crew ${res.filter((x) => x[1]).length}/${targets.length} chuyến`);
  };
  // tự lấy crew khi có chuyến mới trên lưới
  const crewKey = filled.filter((r) => !r.f.cptName && !r.f.foName).map((r) => r.f.key).join(",");
  useEffect(() => { if (crewKey) void loadCrew(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [crewKey]);

  const roundPld = () => {
    if (!db) return;
    const on = !pld; setPld(on);
    if (!on) { setRows((p) => p.map((x) => (x ? { ...x, o: { ...x.o, pay: "" } } : x))); setStat("Đã tắt làm tròn payload."); return; }
    let n = 0; const miss: string[] = [];
    setRows((p) => p.map((x) => {
      if (!x) return x; const v = db.payload["VJ" + x.f.flt];
      if (v == null) { miss.push("VJ" + x.f.flt); return x; }
      n++; return { ...x, o: { ...x.o, pay: String(Math.ceil((v + 1000) / 100) * 100) } };
    }));
    setStat(`Đã làm tròn ${n} chuyến (payload ngày ${db.payloadDate})${miss.length ? ` · ${miss.length} chuyến cần tự chỉnh: ${miss.join(" ")}` : ""}`);
  };

  const extraFill = () => {
    let n = 0;
    setRows((p) => p.map((x) => {
      if (!x) return x;
      const t = limHits(x, limits); const wx = [...t["arr"], ...t["dep"]].some((h) => h.sev === "crit");
      const cur = String(x.src.fuel?.extra ?? "").replace(/\D/g, "");
      if (cur && cur !== "0") { n++; return { ...x, o: { ...x.o, extra: cur } }; }
      if (wx) { n++; return { ...x, o: { ...x.o, extra: "500" } }; }
      return x;
    }));
    setStat(`Extra ${n} chuyến (theo extra FliteBrief / giới hạn sân).`);
  };

  const exportReq = () => {
    if (!text) { toast.error("Chọn ít nhất một chuyến."); return; }
    localStorage.setItem("fpl_dsp", dsp);
    const blob = new Blob([reqBytes(text)], { type: "application/octet-stream" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "FPL.req"; a.click(); URL.revokeObjectURL(a.href);
    setStat(`Đã xuất FPL.req ${picked.length} chuyến.`);
  };

  if (dbQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">Đang tải bảng tra sohee…</p>;
  if (dbQ.error || !db) return <p className="p-6 text-sm text-destructive">Không tải được bảng tra FPL.</p>;

  const pendingNote = (k: string) => toast.info(`${k}: cần tài khoản AviWeb — đang chờ bạn cung cấp.`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <Grp>
          {([["ci", "Cost Index"], ["taxi", "Taxi fuel"], ["route", "Route"], ["alt", "ALT route"], ["era", "ERA"], ["pcr", "PCR"]] as const).map(([k, l]) => (
            <TB key={k} onClick={() => setLib(k)}>{l}</TB>
          ))}
        </Grp>
        <Grp>
          <TB onClick={extraFill}>Extra autofill</TB>
          <TB onClick={roundPld} active={pld}>{pld ? "✓ " : ""}Auto Rounding PLD</TB>
          <TB onClick={() => { setRows(Array(SHEET).fill(null)); setPreview(""); setPld(false); setStat("Đã xoá lưới."); }}>Clear data</TB>
        </Grp>
        <Grp>
          <span className="text-xs text-muted-foreground">Extra</span>
          <input className="h-7 w-16 rounded border border-input bg-card px-1.5 font-mono text-xs" value={extra} onChange={(e) => setExtra(e.target.value.toUpperCase())} />
          <TB onClick={() => setRows((p) => p.map((x) => (x?.on ? { ...x, o: { ...x.o, extra } } : x)))}>Áp extra</TB>
          <span className="text-xs text-muted-foreground">Số đầu</span>
          <input className="h-7 w-14 rounded border border-input bg-card px-1.5 font-mono text-xs" value={seq} onChange={(e) => setSeq(e.target.value.replace(/\D/g, ""))} />
          <TB onClick={() => { let n = parseInt(seq, 10) || 100; setRows((p) => p.map((x) => (x?.on ? { ...x, o: { ...x.o, seq: String(n++) } } : x))); }}>Đánh số</TB>
        </Grp>
        <Grp>
          <TB onClick={() => setPreview(text || "(chưa chọn chuyến)")}>Xem</TB>
          <TB primary onClick={exportReq}>Xuất FPL.req</TB>
        </Grp>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Grp>
          <TB onClick={() => pendingNote("Get ATC")}>Get ATC</TB>
          <TB onClick={() => pendingNote("Get ATC convert")}>Get ATC convert</TB>
          <TB onClick={() => pendingNote("Data Convert")}>Data Convert</TB>
          <TB onClick={() => void loadCrew(picked)}>Lấy lại crew</TB>
          <TB onClick={() => { navigator.clipboard.writeText(text); toast.success("Đã copy"); }}>Copy text</TB>
        </Grp>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {fq.isLoading ? "Đang tải chuyến FliteBrief…" : stat}
        </span>
        <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-sm font-semibold">
          Dispatcher :
          <input className="h-7 w-48 rounded border border-input px-2 font-mono text-xs uppercase" value={dsp} onChange={(e) => setDsp(e.target.value.toUpperCase())} />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-primary text-left text-[11px] font-bold uppercase text-primary-foreground">
            <tr>
              <th className="px-2 py-2"><input type="checkbox" checked={allOn} onChange={(e) => setRows((p) => p.map((x) => (x ? { ...x, on: e.target.checked } : x)))} /></th>
              {["Số", "A/C performance", "Ngày", "Tàu", "Loại", "Đi", "Đến", "ETD", "ETD UTC", "ETA UTC", "CPT", "FO", "Enroute ALT", "ETP POA", "FL", "Route", "TALT", "ALT1", "ALT2", "Extra", "PCR T/O", "RMK"].map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (!r) return (
                <tr key={"b" + i} className="border-b border-border even:bg-muted/40">
                  <td />
                  <td className="px-1 py-1"><input className="h-7 w-14 rounded-md border border-input bg-card px-1.5 font-mono" value={pending[i] ?? ""} onChange={(e) => setPending((p) => p.map((x, j) => (j === i ? e.target.value : x)))} onKeyDown={(e) => e.key === "Enter" && enter(i, pending[i] ?? "")} /></td>
                  {Array.from({ length: 21 }).map((_, j) => <td key={j} className="px-2 text-center text-muted-foreground/50">—</td>)}
                </tr>
              );
              const hits = limHits(r, limits);
              const perf = limits.aircraft.filter((x) => nApt(x.reg).slice(-3) === nApt(r.f.reg).slice(-3) && (x.defect || x.limit));
              const etd = localHm(r.src.etd ?? r.src.std, db.tz[r.f.dep] ?? "07:00");
              const cell = (k: keyof FplOpts, w = "w-14", hk?: K) => {
                const hs = hk ? hits[hk] : [];
                const sev = hs.some((h) => h.sev === "crit") ? "crit" : hs.length ? "warn" : "";
                return (
                  <td className="px-1 py-1">
                    <input title={hs.map((h) => h.why).join("\n") || undefined} value={r.o[k]} onChange={(e) => setO(i, k, e.target.value.toUpperCase())}
                      className={cn("h-7 rounded-md border border-input bg-card px-1.5 font-mono", w, sev === "crit" && "border-destructive bg-destructive/15 font-bold text-destructive", sev === "warn" && "border-warning bg-warning/15")} />
                  </td>
                );
              };
              const ro = (v: string, hk?: K) => {
                const hs = hk ? hits[hk] : [];
                const sev = hs.some((h) => h.sev === "crit") ? "crit" : hs.length ? "warn" : "";
                return <td title={hs.map((h) => h.why).join("\n") || undefined} className={cn("whitespace-nowrap px-2 font-mono", sev === "crit" && "bg-destructive/15 font-bold text-destructive", sev === "warn" && "bg-warning/20")}>{v || "—"}</td>;
              };
              return (
                <tr key={r.f.key} className={cn("border-b border-border", r.on ? "bg-primary/5" : "even:bg-muted/40")}>
                  <td className="px-2 text-center"><input type="checkbox" checked={r.on} onChange={() => upd(i, (x) => ({ ...x, on: !x.on }))} /></td>
                  <td className="px-1 py-1"><input className="h-7 w-14 rounded-md border border-input bg-card px-1.5 font-mono font-bold" defaultValue={r.f.flt} onKeyDown={(e) => e.key === "Enter" && enter(i, (e.target as HTMLInputElement).value)} /></td>
                  <td className="max-w-56 px-2 py-1">
                    {perf.length ? perf.map((p, j) => {
                      const s = perfSev(p.defect + " " + p.limit);
                      return <div key={j} title={p.limit} className={cn("truncate rounded px-1 text-[10px]", s === "crit" ? "bg-destructive/15 font-semibold text-destructive" : s === "warn" ? "bg-warning/20" : "text-muted-foreground")}>{p.defect || p.limit}</div>;
                    }) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  {ro(r.f.date.split("-").reverse().join("/"))}
                  <td className="px-1"><input className="h-7 w-20 rounded-md border border-input bg-card px-1.5 font-mono" value={r.f.reg} onChange={(e) => setFF(i, "reg", e.target.value.toUpperCase())} /></td>
                  {ro(r.f.ac ? "A" + r.f.ac : r.src.acType)}
                  {ro(r.f.dep, "dep")}
                  {ro(r.f.arr, "arr")}
                  {ro(etd)}
                  {ro(r.f.etdUtc)}
                  {ro(utcHhmm(r.src.sta))}
                  <td className="whitespace-nowrap px-2"><Crew id={r.f.cptId} name={r.f.cptName} />{r.f.cpt2Name && <Crew id={r.f.cpt2Id} name={r.f.cpt2Name} />}</td>
                  <td className="whitespace-nowrap px-2"><Crew id={r.f.foId} name={r.f.foName} /></td>
                  {cell("routeQ", "w-28")}
                  {cell("etpPoa", "w-28")}
                  {cell("fl", "w-12")}
                  {cell("rte", "w-20")}
                  {cell("talt", "w-14", "talt")}
                  {cell("alt1", "w-14", "alt1")}
                  {cell("alt2", "w-14", "alt2")}
                  {cell("extra", "w-14")}
                  {cell("pcrTo", "w-16")}
                  {cell("rmk", "w-28")}
                </tr>
              );
            })}
          </tbody>
        </table>
        {preview && (
          <div className="border-t border-border p-3">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold">Xem trước FPL <button className="text-muted-foreground hover:text-foreground" onClick={() => setPreview("")}>Đóng</button></div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-foreground p-3 font-mono text-[11px] text-background">{preview}</pre>
          </div>
        )}
      </div>
      <Library db={db} kind={lib} onClose={() => setLib(null)} />
    </div>
  );
}

function Crew({ id, name }: { id: string; name: string }) {
  if (!name) return <span className="text-muted-foreground/50">—</span>;
  return <div className="leading-tight"><span className="font-mono text-[10px] text-muted-foreground">{id}</span> <span className="font-semibold">{name}</span></div>;
}
function Grp({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-1.5 py-1 shadow-sm">{children}</div>;
}
function TB({ children, onClick, primary, active }: { children: ReactNode; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold transition",
      primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : active ? "bg-foreground text-background" : "text-foreground hover:bg-accent hover:text-accent-foreground")}>
      {children}
    </button>
  );
}

function Library({ db, kind, onClose }: { db: FplDb; kind: null | "ci" | "taxi" | "route" | "alt" | "era" | "pcr"; onClose: () => void }) {
  const [q, setQ] = useState("");
  const title = { ci: "Cost Index", taxi: "Taxi fuel", route: "Route (ETP / hold)", alt: "ALT route", era: "ERA", pcr: "PCR" }[kind ?? "ci"];
  let head: string[] = [], body: string[][] = [];
  if (kind === "ci") { head = ["Vùng", "A320", "A321CEO", "A321NEO", "A330", "Sân"]; body = db.ci.map((r) => [r.id, r.a320, r.a321ceo, r.a321neo, r.a330, r.airports.join(" ")]); }
  if (kind === "taxi") { head = ["Sân", "Loại", "Taxi"]; body = Object.entries(db.taxi).map(([k, v]) => [...k.split("|"), String(v)]); }
  if (kind === "route") { head = ["Chặng", "Hold ngày", "Hold đêm"]; body = Object.entries(db.etp).map(([k, v]) => [k, v[0], v[1]]); }
  if (kind === "alt") { head = ["Chặng", "Enroute ALT", "ETP POA", "FL", "TALT", "ALT1", "ALT2"]; body = Object.entries(db.alt).map(([k, v]) => [k, v.etp_pod, v.etp_poa, v.fl, v.talt, v.alt1, v.alt2]); }
  if (kind === "era") { head = ["Chặng", "ERA"]; body = Object.entries(db.era).map(([k, v]) => [k, v]); }
  if (kind === "pcr") { head = ["Sân", ...db.pcrHead]; body = db.pcrDep.map((d, i) => [d, ...(db.pcrGrid[i] ?? []).map(String)]); }
  const k = q.trim().toUpperCase();
  const shown = k ? body.filter((r) => r.join(" ").toUpperCase().includes(k)) : body;
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{title} <span className="text-xs font-normal text-muted-foreground">· nguồn {db.source}</span></DialogTitle></DialogHeader>
        <input autoFocus placeholder="Tìm…" className="h-8 rounded-md border border-input px-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-primary text-left text-primary-foreground"><tr>{head.map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
            <tbody>{shown.slice(0, 500).map((r, i) => <tr key={i} className="border-t border-border even:bg-muted/40">{r.map((c, j) => <td key={j} className="px-2 py-1 font-mono">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{shown.length} dòng. Sửa bảng tra: gửi file sohee mới để cập nhật cho cả nhóm.</p>
      </DialogContent>
    </Dialog>
  );
}
