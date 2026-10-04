import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Plane, ShieldCheck, FileDown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flight Dispatch Tool — Đăng nhập dispatcher" },
      { name: "description", content: "Công cụ nội bộ cho dispatcher: bảng chuyến bay, fuel, crew và tài liệu FliteBrief." },
      { property: "og:title", content: "Flight Dispatch Tool" },
      { property: "og:description", content: "Công cụ nội bộ cho dispatcher theo dõi chuyến bay." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/tool", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-mono text-sm font-bold tracking-widest text-primary">
          <Plane className="h-5 w-5" /> DISPATCH BOARD
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Đăng nhập</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-16">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Flight Dispatch Tool</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-foreground md:text-6xl">
          Mọi chuyến bay trong ca trực, <span className="text-primary">trên một màn hình.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Lấy dữ liệu trực tiếp từ FliteBrief: lọc theo dispatcher, xem fuel, tổ bay, tài liệu và lịch sử — tải PDF
          hàng loạt chỉ với vài cú bấm.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Vào bảng điều phối</Link>
          </Button>
        </div>
        <div className="mt-20 grid gap-4 md:grid-cols-3">
          {[
            { icon: Users, t: "Theo dispatcher", d: "Lọc nhanh theo người phụ trách, callsign, sân bay, số đăng ký." },
            { icon: FileDown, t: "Tải PDF hàng loạt", d: "Chọn nhiều chuyến, tải OFP và tài liệu đính kèm thành một file." },
            { icon: ShieldCheck, t: "Bảo mật", d: "Mỗi người một tài khoản, quản trị viên duyệt quyền. Mật khẩu hệ thống không bao giờ lộ ra trình duyệt." },
          ].map(({ icon: I, t, d }) => (
            <div key={t} className="rounded-lg border border-border bg-card p-5">
              <I className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold text-foreground">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
