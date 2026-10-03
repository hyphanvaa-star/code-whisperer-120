import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getFlights } from "@/lib/flights.functions";
import { getSetting, saveLimits } from "@/lib/settings.functions";
import { checkLimits, DEFAULT_LIMITS, type Limits } from "@/lib/limits";
import { fmtUtc } from "@/lib/flight-model";

export const Route = createFileRoute("/_authenticated/aircraft")({
  head: () => ({
    meta: [
      { title: "Tàu / Defect — Dispatch Board" },
      { name: "description", content: "Kiểm tra giới hạn tàu, defect, curfew và sân bay theo từng chuyến." },
      { property: "og:title", content: "Tàu / Defect — Dispatch Board" },
      { property: "og:description", content: "Kiểm tra giới hạn tàu, defect, curfew và sân bay theo từng chuyến." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <AircraftPage />
    </AppShell>
  ),
});

function AircraftPage() {
  const [tab, setTab] = useState<"check" | "edit">("check");
  const getFn = useServerFn(getSetting);
  const q = useQuery({ queryKey: ["setting", "limits"], queryFn: () => getFn({ data: { key: "limits" } }) });
  const limits = useMemo<Limits>(() => {
    try { const v = q.data?.json ? JSON.parse(q.data.json) : null; return v?.aircraft ? v : DEFAULT_LIMITS; } catch { return DEFAULT_LIMITS; }
  }, [q.data]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        {(["check", "edit"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {t === "check" ? "Kiểm tra giới hạn" : "Danh sách defect / giới hạn"}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {q.data?.updatedAt ? `Cập nhật ${fmtUtc(q.data.updatedAt)}` : "Đang dùng danh sách của tool gốc"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Đang tải…</p> : tab === "check" ? <Check limits={limits} /> : <Editor initial={limits} />}
      </div>
    </div>
  );
}

function Check({ limits }: { limits: Limits }) {
  const fetchFlights = useServerFn(getFlights);
  const [days, setDays] = useState(1);
  const [s, setS] = useState("");
  const [onlyRed, setOnlyRed] = useState(false);
  const fq = useQuery({ queryKey: ["flights", days], queryFn: () => fetchFlights({ data: { days } }), staleTime: 120_000 });
  const rows = useMemo(() => {
    const k = s.trim().toUpperCase();
    return (fq.data?.flights ?? [])
      .filter((f) => !k || [f.callsign, f.reg, f.dep, f.dest, f.dispatcher].some((v) => (v || "").toUpperCase().includes(k)))
      .map((f) => ({ f, w: checkLimits(f, limits) }))
      .filter((r) => r.w.length && (!onlyRed || r.w.some((x) => x.severity === "critical")));
  }, [fq.data, limits, s, onlyRed]);
  const red = rows.filter((r) => r.w.some((x) => x.severity === "critical")).length;
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input placeholder="Tìm callsign / REG / sân bay / DSP" value={s} onChange={(e) => setS(e.target.value)} className="w-72" />
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} ngày</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyRed} onCheckedChange={setOnlyRed} /> Chỉ vi phạm (đỏ)</label>
        <Button variant="outline" size="sm" onClick={() => fq.refetch()} disabled={fq.isFetching}>{fq.isFetching ? "Đang tải…" : "Làm mới"}</Button>
        <span className="ml-auto text-sm"><b>{rows.length}</b> chuyến dính giới hạn · <b className="text-destructive">{red}</b> vi phạm</span>
      </div>
      {fq.data?.error && <p className="mb-2 text-sm text-destructive">{fq.data.error}</p>}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">STD (Z)</th><th className="px-3 py-2">Chuyến</th><th className="px-3 py-2">Chặng / ALT</th><th className="px-3 py-2">REG</th><th className="px-3 py-2">DSP</th><th className="px-3 py-2">Cảnh báo</th></tr>
          </thead>
          <tbody>
            {rows.map(({ f, w }) => (
              <tr key={f.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">{fmtUtc(f.std)}</td>
                <td className="px-3 py-2 font-mono font-semibold">{f.callsign}</td>
                <td className="px-3 py-2 font-mono text-xs">{f.dep}–{f.dest}<div className="text-muted-foreground">{[f.alt1, f.alt2].filter(Boolean).join(" / ")}</div></td>
                <td className="px-3 py-2 font-mono">{f.reg} <span className="text-xs text-muted-foreground">{f.acType}</span></td>
                <td className="px-3 py-2 text-xs">{f.dispatcher}</td>
                <td className="space-y-1 px-3 py-2">
                  {w.map((x, i) => (
                    <div key={i} className={`rounded px-2 py-1 text-xs ${x.severity === "critical" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
                      <div className="font-medium">{x.text}</div>
                      {x.evidence && <div className="whitespace-pre-line opacity-80">{x.evidence}</div>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {!rows.length && !fq.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Không có chuyến nào dính giới hạn.</td></tr>}
            {fq.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Đang tải chuyến bay từ FliteBrief…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Đỏ = có bằng chứng vi phạm (curfew, sân đóng, APU INOP tới sân không có APU, fuel penalty, ngoài nội địa…). Vàng = tàu có giới hạn cần lưu ý.</p>
    </div>
  );
}

type Sec = keyof Limits;
const COLS: Record<Sec, { label: string; cols: [string, string][] }> = {
  aircraft: { label: "Defect theo tàu", cols: [["reg", "REG"], ["defect", "Defect"], ["limit", "Giới hạn khai thác"]] },
  airports: { label: "Sân bay", cols: [["code", "Sân"], ["limit", "Giới hạn"]] },
  curfew: { label: "Curfew (UTC)", cols: [["code", "Sân"], ["start", "Đóng từ"], ["end", "Đến"]] },
  special: { label: "Đặc biệt (loại tàu + sân)", cols: [["reg", "Loại tàu"], ["code", "Sân"], ["limit", "Giới hạn"]] },
};

function Editor({ initial }: { initial: Limits }) {
  const [L, setL] = useState<Limits>(initial);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveLimits);
  const qc = useQueryClient();
  useEffect(() => setL(initial), [initial]);
  const upd = (sec: Sec, i: number, k: string, v: string) =>
    setL((p) => ({ ...p, [sec]: (p[sec] as Record<string, string>[]).map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const add = (sec: Sec) => setL((p) => ({ ...p, [sec]: [...p[sec], Object.fromEntries(COLS[sec].cols.map(([k]) => [k, ""]))] }));
  const del = (sec: Sec, i: number) => setL((p) => ({ ...p, [sec]: (p[sec] as unknown[]).filter((_, j) => j !== i) }));
  const onSave = async () => {
    setSaving(true);
    try {
      const clean = Object.fromEntries((Object.keys(COLS) as Sec[]).map((k) => [k, (L[k] as Record<string, string>[]).filter((r) => Object.values(r).some((v) => v.trim()))])) as Limits;
      await save({ data: { limits: clean } });
      toast.success("Đã lưu cho cả nhóm");
      qc.invalidateQueries({ queryKey: ["setting", "limits"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Lưu thất bại"); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-6 p-4">
      <div className="flex gap-2">
        <Button onClick={onSave} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</Button>
        <Button variant="outline" onClick={() => setL(DEFAULT_LIMITS)}>Khôi phục bản gốc</Button>
      </div>
      {(Object.keys(COLS) as Sec[]).map((sec) => (
        <section key={sec} className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="font-semibold">{COLS[sec].label} <span className="text-xs text-muted-foreground">({L[sec].length})</span></h3>
            <Button size="sm" variant="outline" onClick={() => add(sec)}>+ Thêm</Button>
          </header>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr>{COLS[sec].cols.map(([, l]) => <th key={l} className="px-2 py-1">{l}</th>)}<th /></tr></thead>
            <tbody>
              {(L[sec] as Record<string, string>[]).map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {COLS[sec].cols.map(([k]) => (
                    <td key={k} className="px-2 py-1"><Input value={r[k] ?? ""} onChange={(e) => upd(sec, i, k, e.target.value)} className={`h-8 ${k === "limit" || k === "defect" ? "" : "w-28 font-mono"}`} /></td>
                  ))}
                  <td className="px-2 py-1 text-right"><Button size="sm" variant="ghost" onClick={() => del(sec, i)}>Xoá</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
