import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, ShieldCheck, Clock, Sun, Moon, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/flights.functions";
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
  { to: "/board", label: "Hiển thị chung" },
  { to: "/compare", label: "Dữ liệu so sánh" },
  { to: "/tools", label: "Công cụ hỗ trợ" },
  { to: "/notam", label: "NOTAM" },
  { to: "/khb", label: "Tạo KHB" },
  { to: "/handover", label: "Giao ca" },
  { to: "/aircraft", label: "Tàu / Defect" },
  { to: "/notices", label: "Notice" },
  { to: "/atc", label: "ATC" },
] as const;

function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
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

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  const [shift, setShift] = useShift();

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="bg-header shrink-0 text-primary-foreground shadow-md">
        <div className="flex h-12 items-center gap-4 px-4">
          <Brand />
          <div className="flex rounded-full bg-primary-foreground/15 p-0.5 text-xs font-semibold">
            {(["MORNING SHIFT", "NIGHT SHIFT"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShift(s)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-3 py-1 transition",
                  shift === s ? "bg-card text-primary shadow" : "text-primary-foreground/85 hover:text-primary-foreground",
                )}
              >
                {s === "MORNING SHIFT" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {s === "MORNING SHIFT" ? "Ca sáng" : "Ca đêm"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <UtcClock />
            <span className="hidden text-sm text-primary-foreground/90 md:inline">{me.data?.name || me.data?.email}</span>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-primary-foreground/15"
            >
              <LogOut className="h-4 w-4" /> Thoát
            </button>
          </div>
        </div>
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-3">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="relative whitespace-nowrap px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            activeProps={{ className: "!text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" }}
          >
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
    <span className="rounded-md bg-primary-foreground/15 px-2 py-0.5 font-mono text-xs font-semibold">
      {p(now.getUTCHours())}:{p(now.getUTCMinutes())}Z
    </span>
  );
}
