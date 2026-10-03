import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Plane, ShieldCheck, LayoutGrid, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/flights.functions";
import { Button } from "@/components/ui/button";

export function useMe() {
  const fn = useServerFn(getMe);
  return useQuery({ queryKey: ["me"], queryFn: () => fn(), staleTime: 60_000 });
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const linkCls =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground";

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <Link to="/board" className="flex items-center gap-2 font-mono text-xs font-bold tracking-widest text-primary">
          <Plane className="h-4 w-4" /> DISPATCH BOARD
        </Link>
        <nav className="flex items-center gap-1">
          <Link to="/board" className={linkCls} activeProps={{ className: "bg-secondary text-foreground" }}>
            <LayoutGrid className="h-4 w-4" /> Chuyến bay
          </Link>
          {me.data?.isAdmin && (
            <Link to="/admin" className={linkCls} activeProps={{ className: "bg-secondary text-foreground" }}>
              <ShieldCheck className="h-4 w-4" /> Quản trị
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <UtcClock />
          <span className="hidden text-sm text-muted-foreground md:inline">{me.data?.name || me.data?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Thoát
          </Button>
        </div>
      </header>
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

function Pending({ email }: { email: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <Clock className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">Đang chờ cấp quyền</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tài khoản <span className="text-foreground">{email}</span> đã tạo xong. Nhờ quản trị viên vào mục Quản trị để
          cấp quyền dispatcher, sau đó tải lại trang.
        </p>
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
    <span className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-foreground">
      {p(now.getUTCHours())}:{p(now.getUTCMinutes())}Z
    </span>
  );
}
