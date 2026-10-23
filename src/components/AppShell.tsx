import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import {
  LogOut, ShieldCheck, Clock, Sun, Moon, ArrowLeft, FileText, ClipboardList, LayoutGrid, ListChecks, Wrench,
  FileWarning, Radio, Plane, Paperclip, User, Send, MapPin, Tag, X,
  Download,
} from "lucide-react";
import { useGlobalFilters } from "@/lib/global-filters";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/flights.functions";
import { logAuthEvent } from "@/lib/auth-activity.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/vj-logo.png";

export function useMe() {
  const fn = useServerFn(getMe);
  return useQuery({ queryKey: ["me"], queryFn: () => fn(), staleTime: 60_000 });
}

export type Shift = "MORNING SHIFT" | "NIGHT SHIFT";

/** Ca hiện tại theo giờ VN: 06:00–18:00 = ca sáng. Người dùng có thể đổi tay. */
export function useShift() {
  const [shift, setShiftState] = useState<Shift>("MORNING SHIFT");
  useEffect(() => {
    const saved = localStorage.getItem("shift") as Shift | null;
    if (saved === "MORNING SHIFT" || saved === "NIGHT SHIFT") setShiftState(saved);
    else {
      const vnHour = (new Date().getUTCHours() + 7) % 24;
      setShiftState(vnHour >= 6 && vnHour < 18 ? "MORNING SHIFT" : "NIGHT SHIFT");
    }
    const on = (e: Event) => setShiftState((e as CustomEvent<Shift>).detail);
    window.addEventListener("shift-change", on);
    return () => window.removeEventListener("shift-change", on);
  }, []);
  const setShift = (s: Shift) => {
    localStorage.setItem("shift", s);
    window.dispatchEvent(new CustomEvent("shift-change", { detail: s }));
  };
  return [shift, setShift] as const;
}

const TABS = [
  { to: "/khb", label: "Tạo KHB", icon: FileText },
  { to: "/handover", label: "Giao ca", icon: ClipboardList },
  { to: "/board", label: "Hiển thị chung", icon: LayoutGrid },
  { to: "/compare", label: "Dữ liệu so sánh", icon: ListChecks },
  { to: "/tools", label: "Công cụ hỗ trợ", icon: Wrench },
  { to: "/notam", label: "Check NOTAM", icon: FileWarning },
  { to: "/ver", label: "Dữ liệu thay đổi theo ver", icon: ListChecks },
  { to: "/autoload", label: "Tự động tải", icon: Download },
  { to: "/atc", label: "Check ATC avi", icon: Radio },
  { to: "/aircraft", label: "Giới hạn tàu và sân bay", icon: Plane },
  { to: "/notices", label: "Thiết lập file add", icon: Paperclip },
] as const;

function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await logAuthEvent({ data: { event: "sign_out" } }).catch(() => {});
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  };
}

function Brand() {
  return (
    <Link to="/board" className="flex items-center gap-3">
      <span className="rounded-md bg-card px-2 py-1 shadow-sm">
        <img src={logo} alt="Vietjet" className="h-6 w-auto" />
      </span>
      <span className="hidden font-mono text-xs font-bold tracking-[0.2em] text-primary-foreground sm:inline">
        DISPATCH BOARD
      </span>
    </Link>
  );
}

function FilterField({ label, icon: Icon, children }: { label: string; icon: typeof User; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-foreground/80">
        <Icon className="h-3 w-3" /> {label}
      </span>
      {children}
    </label>
  );
}

const fieldCls =
  "h-8 rounded-lg border border-border bg-card px-2.5 font-mono text-xs uppercase text-foreground shadow-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20";

function GlobalFilterBar() {
  const [f, set] = useGlobalFilters();
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <FilterField label="Dispatcher" icon={User}>
        <input className={cn(fieldCls, "w-32 normal-case")} placeholder="— Tất cả —" value={f.dispatcher} onChange={(e) => set({ dispatcher: e.target.value })} />
      </FilterField>
      <FilterField label="Callsign" icon={Send}>
        <input className={cn(fieldCls, "w-24")} placeholder="VJC210" value={f.callsign} onChange={(e) => set({ callsign: e.target.value })} />
      </FilterField>
      <FilterField label="Dep" icon={MapPin}>
        <input className={cn(fieldCls, "w-20")} maxLength={4} placeholder="VVTS" value={f.dep} onChange={(e) => set({ dep: e.target.value })} />
      </FilterField>
      <FilterField label="Dest" icon={MapPin}>
        <input className={cn(fieldCls, "w-20")} maxLength={4} placeholder="VVVH" value={f.dest} onChange={(e) => set({ dest: e.target.value })} />
      </FilterField>
      <FilterField label="Reg" icon={Tag}>
        <input className={cn(fieldCls, "w-24")} placeholder="VNA666" value={f.reg} onChange={(e) => set({ reg: e.target.value })} />
      </FilterField>
      {(f.dispatcher || f.callsign || f.dep || f.dest || f.reg) && (
        <button
          onClick={() => set({ dispatcher: "", callsign: "", dep: "", dest: "", reg: "" })}
          className="mb-0.5 inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
        >
          <X className="h-3 w-3" /> Xoá lọc
        </button>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  const [shift, setShift] = useShift();

  return (
    <div className="bg-app flex h-screen flex-col gap-2 p-2">
      <header className="shrink-0 rounded-2xl border border-primary/15 bg-header-soft px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <GlobalFilterBar />
          <div className="ml-auto flex items-center gap-3">
            <div className="flex rounded-full border border-border bg-card p-0.5 text-xs font-semibold">
              {(["MORNING SHIFT", "NIGHT SHIFT"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setShift(s)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-1 transition",
                    shift === s ? "bg-foreground text-background shadow" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "MORNING SHIFT" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {s === "MORNING SHIFT" ? "Ca sáng" : "Ca đêm"}
                </button>
              ))}
            </div>
            <UtcClock />
            <Link to="/board" className="flex flex-col items-end leading-none">
              <span className="text-2xl font-extrabold tracking-tight text-foreground">
                Dispatch <span className="text-info">Board</span>
              </span>
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow">
                <Plane className="h-3.5 w-3.5" /> Vietjet Air
              </span>
            </Link>
            <div className="flex flex-col items-end gap-1">
              <span className="max-w-32 truncate text-xs text-muted-foreground">{me.data?.name || me.data?.email}</span>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs hover:bg-accent"
              >
                <LogOut className="h-3.5 w-3.5" /> Thoát
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-primary/10 bg-header-soft px-3 py-2.5">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-primary shadow-sm transition hover:-translate-y-px hover:border-primary/40"
              activeProps={{ className: "!border-primary !bg-primary !text-primary-foreground shadow-md" }}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="min-h-0 flex-1">
          {me.isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Đang tải…</div>
          ) : me.data && !me.data.isDispatcher ? (
            <Pending email={me.data.email} />
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

/** Layout riêng cho trang Quản trị — không có hàng tab nghiệp vụ. */
export function AdminShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="bg-header text-primary-foreground shadow-md">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4">
          <Brand />
          <span className="flex items-center gap-1 rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" /> Quản trị hệ thống
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/board" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-primary-foreground/15">
              <ArrowLeft className="h-4 w-4" /> Về Dispatch Board
            </Link>
            <button onClick={signOut} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-primary-foreground/15">
              <LogOut className="h-4 w-4" /> Thoát
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        {me.isLoading ? (
          <div className="text-sm text-muted-foreground">Đang tải…</div>
        ) : !me.data?.isAdmin ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm">Bạn không có quyền quản trị.</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** Khung cho tab đang được chuyển từ tool gốc sang web. */
export function PortingPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tab này đang được chuyển từ tool gốc sang chạy trên web. Các chức năng sẽ có:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Pending({ email }: { email: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <Clock className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">Đang chờ cấp quyền</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tài khoản <span className="text-foreground">{email}</span> đã tạo xong. Nhờ quản trị viên cấp quyền dispatcher,
          sau đó tải lại trang.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => location.reload()}>
          Tải lại
        </Button>
      </div>
    </div>
  );
}

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs font-semibold text-foreground">
      {p(now.getUTCHours())}:{p(now.getUTCMinutes())}Z
    </span>
  );
}
