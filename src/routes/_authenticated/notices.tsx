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
import { getSetting, saveNoticeRules } from "@/lib/settings.functions";
import { COND_LABEL, DEFAULT_RULES, needsFor, type NoticeRule, type RuleCond } from "@/lib/notices";
import { fmtUtc } from "@/lib/flight-model";

export const Route = createFileRoute("/_authenticated/notices")({
  head: () => ({
    meta: [
      { title: "Notice — Dispatch Board" },
      { name: "description", content: "Quy tắc notice và kiểm tra đính kèm từng chuyến." },
      { property: "og:title", content: "Notice — Dispatch Board" },
      { property: "og:description", content: "Quy tắc notice và kiểm tra đính kèm từng chuyến." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Notices />
    </AppShell>
  ),
});

function Notices() {
  const [tab, setTab] = useState<"check" | "rules">("check");
  const getFn = useServerFn(getSetting);
  const rulesQ = useQuery({
    queryKey: ["setting", "notice_rules"],
    queryFn: () => getFn({ data: { key: "notice_rules" } }),
  });
  const rules = useMemo<NoticeRule[]>(() => {
    try {
      const v = rulesQ.data?.json ? JSON.parse(rulesQ.data.json) : null;
      return Array.isArray(v) ? v : DEFAULT_RULES;
    } catch { return DEFAULT_RULES; }
  }, [rulesQ.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        {(["check", "rules"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t === "check" ? "Kiểm tra đính kèm" : "Luật notice"}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {rulesQ.data?.updatedAt ? `Luật cập nhật ${fmtUtc(rulesQ.data.updatedAt)}` : "Đang dùng luật mặc định của tool gốc"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rulesQ.isLoading ? <p className="p-6 text-sm text-muted-foreground">Đang tải…</p> : tab === "check" ? <Check rules={rules} /> : <RulesEditor initial={rules} />}
      </div>
    </div>
  );
}

function Check({ rules }: { rules: NoticeRule[] }) {
  const fetchFlights = useServerFn(getFlights);
  const [days, setDays] = useState(1);
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const fq = useQuery({ queryKey: ["flights", days], queryFn: () => fetchFlights({ data: { days } }), staleTime: 120_000 });

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    return (fq.data?.flights ?? [])
      .filter((f) => !s || [f.callsign, f.reg, f.dep, f.dest, f.dispatcher].some((v) => (v || "").toUpperCase().includes(s)))
      .map((f) => ({ f, needs: needsFor(f, rules) }))
      .filter((r) => !onlyMissing || r.needs.some((n) => !n.attached))
      .sort((a, b) => (a.f.std || "").localeCompare(b.f.std || ""));
  }, [fq.data, rules, q, onlyMissing]);

  const missingTotal = rows.reduce((n, r) => n + r.needs.filter((x) => !x.attached).length, 0);

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input placeholder="Tìm callsign / REG / sân bay / DSP" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} ngày</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyMissing} onCheckedChange={setOnlyMissing} /> Chỉ chuyến thiếu</label>
        <Button variant="outline" size="sm" onClick={() => fq.refetch()} disabled={fq.isFetching}>{fq.isFetching ? "Đang tải…" : "Làm mới"}</Button>
        <span className="ml-auto text-sm"><b>{rows.length}</b> chuyến · <b className="text-destructive">{missingTotal}</b> notice thiếu</span>
      </div>
      {fq.data?.error && <p className="mb-2 text-sm text-destructive">{fq.data.error}</p>}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">STD (Z)</th><th className="px-3 py-2">Chuyến</th><th className="px-3 py-2">Chặng</th><th className="px-3 py-2">REG</th><th className="px-3 py-2">DSP</th><th className="px-3 py-2">Notice cần có</th></tr>
          </thead>
          <tbody>
            {rows.map(({ f, needs }) => (
              <tr key={f.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">{fmtUtc(f.std)}</td>
                <td className="px-3 py-2 font-mono font-semibold">{f.callsign}</td>
                <td className="px-3 py-2 font-mono">{f.dep}–{f.dest}</td>
                <td className="px-3 py-2 font-mono">{f.reg} <span className="text-xs text-muted-foreground">{f.acType}</span></td>
                <td className="px-3 py-2 text-xs">{f.dispatcher}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {needs.map((n) => (
                      <span key={n.title} title={n.rule} className={`rounded px-2 py-0.5 text-xs ${n.attached ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-destructive/15 font-medium text-destructive"}`}>
                        {n.attached ? "✓" : "✗"} {n.title}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !fq.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Không có chuyến nào thiếu notice.</td></tr>}
            {fq.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Đang tải chuyến bay từ FliteBrief…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Xanh = đã có trên FliteBrief, đỏ = chưa đính kèm. Rê chuột vào tên để xem luật nào yêu cầu.</p>
    </div>
  );
}

function RulesEditor({ initial }: { initial: NoticeRule[] }) {
  const [rules, setRules] = useState<NoticeRule[]>(initial);
  const [saving, setSaving] = useState(false);
  const saveFn = useServerFn(saveNoticeRules);
  const qc = useQueryClient();
  useEffect(() => setRules(initial), [initial]);

  const upd = (i: number, p: Partial<NoticeRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => setRules((rs) => {
    const a = [...rs]; const j = i + d; if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j]!, a[i]!]; return a;
  });

  async function save() {
    setSaving(true);
    try {
      const clean = rules.map((r) => ({ ...r, values: r.values.filter(Boolean), files: r.files.filter(Boolean), effective_from: r.effective_from || undefined, effective_to: r.effective_to || undefined }));
      await saveFn({ data: { rules: clean } });
      await qc.invalidateQueries({ queryKey: ["setting", "notice_rules"] });
      toast.success("Đã lưu luật notice cho cả nhóm");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lưu thất bại");
    } finally { setSaving(false); }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu luật"}</Button>
        <Button variant="outline" onClick={() => setRules((r) => [...r, { name: "Luật mới", condition: "touches", values: [], files: [], enabled: true }])}>+ Thêm luật</Button>
        <Button variant="ghost" onClick={() => { if (confirm("Khôi phục luật mặc định của tool gốc?")) setRules(DEFAULT_RULES); }}>Khôi phục mặc định</Button>
      </div>
      {(() => {
        const today = new Date().toISOString().slice(0, 10);
        const expired = rules.filter((r) => r.effective_to && r.effective_to < today).length;
        const active = rules.filter((r) => r.enabled && !(r.effective_to && r.effective_to < today) && !(r.effective_from && r.effective_from > today)).length;
        return (
          <div className="mb-3 flex gap-3 text-sm">
            <span className="rounded-full bg-muted px-3 py-1">Tổng: <b>{rules.length}</b></span>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-700">Đang dùng: <b>{active}</b></span>
            <span className="rounded-full bg-primary/15 px-3 py-1 text-primary">Hết hạn: <b>{expired}</b></span>
          </div>
        );
      })()}
      <p className="mb-3 text-xs text-muted-foreground">Tên file: dùng <code>{"{REG}"}</code> cho số đăng ký tàu, <code>{"{REG3}"}</code> cho 3 số cuối. Thêm tên khác sau dấu <code>|</code> để coi như đã có dù đặt tên khác. Mỗi dòng một file.</p>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className={`grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[auto_1.2fr_1fr_1fr_1.6fr_auto] ${r.enabled ? "" : "opacity-60"}`}>
            <Switch checked={r.enabled} onCheckedChange={(v) => upd(i, { enabled: v })} className="mt-2" />
            <Input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} />
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={r.condition} onChange={(e) => upd(i, { condition: e.target.value as RuleCond })}>
              {Object.entries(COND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Input placeholder="Giá trị, cách nhau dấu phẩy" disabled={r.condition === "always" || r.condition === "has_reg"} value={r.values.join(", ")} onChange={(e) => upd(i, { values: e.target.value.split(/[,\s]+/).map((s) => s.toUpperCase()) })} />
            <textarea rows={Math.max(1, r.files.length)} className="rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs" value={r.files.join("\n")} onChange={(e) => upd(i, { files: e.target.value.split("\n") })} />
            <div className="flex items-start gap-1">
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)}>↑</Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)}>↓</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>Xoá</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:col-span-6">
              Hiệu lực từ <input type="date" className="rounded border border-input bg-background px-1" value={r.effective_from ?? ""} onChange={(e) => upd(i, { effective_from: e.target.value })} />
              đến <input type="date" className="rounded border border-input bg-background px-1" value={r.effective_to ?? ""} onChange={(e) => upd(i, { effective_to: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
