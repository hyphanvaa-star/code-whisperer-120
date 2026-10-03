import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFlights } from "@/lib/flights.functions";
import type { Flight } from "@/lib/flight-model";
import { fetchFbFile, saveBlob } from "@/lib/download";
import { extractAtc, extractEzfw, fileCallsign, joinAtcBlocks, mailCallsign, pdfText } from "@/lib/ofp-text";

export const Route = createFileRoute("/_authenticated/autoload")({
  head: () => ({
    meta: [
      { title: "Tự động tải — Dispatch Board" },
      { name: "description", content: "Flight Plan Outlook, Omni, in GD và cắt ATC + EZFW từ OFP FliteBrief." },
      { property: "og:title", content: "Tự động tải — Dispatch Board" },
      { property: "og:description", content: "Flight Plan Outlook, Omni, in GD và cắt ATC + EZFW từ OFP FliteBrief." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <AutoLoad />
    </AppShell>
  ),
});

const OPS_BACK_H = 6, OPS_AHEAD_H = 24;

function findFlight(flights: Flight[], want: string): Flight {
  const digits = want.replace(/\D/g, "");
  if (!digits) throw new Error("Nhập số hiệu chuyến, ví dụ 5513.");
  const rx = new RegExp(`(?<!\\d)${digits}(?!\\d)`);
  const hits = flights.filter((f) => rx.test(f.callsign));
  if (!hits.length) throw new Error(`Không thấy chuyến ${digits} trên FliteBrief (cửa sổ đang nạp).`);
  const now = Date.now();
  const fresh = hits.filter((f) => {
    const t = f.std ? Date.parse(f.std) : NaN;
    return t >= now - OPS_BACK_H * 3600e3 && t <= now + OPS_AHEAD_H * 3600e3;
  });
  if (!fresh.length) {
    const days = [...new Set(hits.map((f) => (f.std ? `${f.std.slice(8, 10)}/${f.std.slice(5, 7)}` : "?")))].sort();
    throw new Error(`Chuyến ${digits} chỉ có sector ngoài khung khai thác (−6h…+24h): ngày ${days.join(", ")}. Chưa có OFP hôm nay thì chờ OMC release rồi soạn lại.`);
  }
  return fresh.sort((a, b) => (a.std || "").localeCompare(b.std || ""))[0]!;
}

function Card({ title, lead, children }: { title: string; lead: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h4 className="font-semibold text-primary">{title}</h4>
      <p className="text-sm text-muted-foreground">{lead}</p>
      {children}
    </section>
  );
}

const Log = ({ lines }: { lines: string[] }) => (
  <pre className="max-h-48 min-h-16 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap">{lines.join("\n") || "—"}</pre>
);

function AutoLoad() {
  const fetchFlights = useServerFn(getFlights);
  const fq = useQuery({ queryKey: ["flights", 2], queryFn: () => fetchFlights({ data: { days: 2 } }), staleTime: 120_000 });
  const [want, setWant] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [atcAll, setAtcAll] = useState("");

  async function run() {
    const flights = fq.data?.flights ?? [];
    const specs = want.split(/[\s,;]+/).filter(Boolean);
    if (!specs.length) { toast.info("Nhập số hiệu, ví dụ 5513 1832"); return; }
    setBusy(true);
    const out: string[] = [];
    const files: Record<string, Uint8Array> = {};
    const atcBlocks: string[] = [];
    const now = new Date();
    const tag = `${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const sp of specs) {
      try {
        const f = findFlight(flights, sp);
        if (!f.hasOfp) throw new Error("chưa lấy được OFP");
        const text = await pdfText(await fetchFbFile({ sector: f.id, kind: "ofp" }));
        const fc = fileCallsign(f.callsign);
        const atc = extractAtc(text);
        files[`ATC_${fc}.txt`] = strToU8(atc);
        atcBlocks.push(atc);
        let ez = "";
        try { ez = extractEzfw(text); files[`EZFW_${fc}.txt`] = strToU8(ez); } catch (e) { out.push(`${f.callsign}: ${(e as Error).message}`); }
        out.push(`✓ ${f.callsign} ${f.dep}-${f.dest} — ATC_${fc}.txt${ez ? `, EZFW_${fc}.txt` : ""} · tiêu đề: ATC + EZFW ${mailCallsign(f.callsign)} ${tag}`);
      } catch (e) {
        out.push(`✗ ${sp}: ${(e as Error).message}`);
      }
      setLog([...out]);
    }
    setAtcAll(joinAtcBlocks(atcBlocks));
    const names = Object.keys(files);
    if (names.length) {
      const zip = zipSync(files);
      saveBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `ATC_EZFW_${tag}.zip`);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <Card title="✈ Flight Plan (Outlook)" lead={<>Tool gốc quét hộp thư chung OMC, thư mục <b>FLIGHT PLAN</b> mỗi <b>15 giây</b> và tải Excel <b>FPL VER</b> xuống <b>D:\FPL</b>.</>}>
        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          Trạng thái: <b className="text-amber-700">Chờ kết nối hộp thư chung</b>. Trong lúc chờ, bạn mở tab <b>Dữ liệu thay đổi theo ver</b> và chọn file FPL VER để so bản.
        </div>
      </Card>
      <Card title="📦 Omni (như TAF)" lead={<>Tool gốc tự tải Omni <b>ngày hôm nay</b> xuống <b>D:\Omni</b> mỗi <b>1 giờ</b>.</>}>
        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          Trình duyệt không được tự ghi vào ổ D: của máy. Phần này cần trợ lý chạy trên máy tính văn phòng.
        </div>
      </Card>
      <Card title="🖨 Print GD" lead={<>Tải Excel folder <b>GENDEC</b>, đối chiếu <b>TÀU</b> với crewlist rồi in RICOH MP 5055.</>}>
        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          In thẳng ra máy in văn phòng cần trợ lý trên máy tính văn phòng.
        </div>
      </Card>
      <Card title="✉ ATC + EZFW" lead={<>Nhập số hiệu (vd <b>5513</b> hoặc <b>5513 1832</b>). Cắt <b>ATC_VJCxxxx.txt</b> và <b>EZFW_VJCxxxx.txt</b> từ OFP FliteBrief, tải về một file zip.</>}>
        <div className="flex gap-2">
          <Input value={want} onChange={(e) => setWant(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && run()} placeholder="5513 1832" className="font-mono" />
          <Button onClick={run} disabled={busy || fq.isLoading}>{busy ? "Đang cắt…" : "Cắt ATC + EZFW"}</Button>
        </div>
        <Log lines={log} />
        {atcAll && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">Điện văn ATC gộp
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(atcAll); toast.success("Đã copy"); }}>Copy</Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs">{atcAll}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}
