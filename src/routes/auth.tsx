import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plane, Lock, UserRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Dispatch Board" },
      { name: "description", content: "Đăng nhập hệ thống Dispatch Board." },
      { property: "og:title", content: "Đăng nhập — Dispatch Board" },
      { property: "og:description", content: "Đăng nhập hệ thống Dispatch Board." },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "Nhập ID tài khoản")
    .max(255)
    .regex(/^[a-z0-9._@-]+$/i, "ID chỉ gồm chữ, số, . _ -"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/tool", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/tool", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ id, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }
    const raw = parsed.data.id;
    const account = raw.includes("@") ? raw : `${raw.toLowerCase()}@app.local`;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: account,
        password: parsed.data.password,
      });
      if (error) toast.error("Sai ID hoặc mật khẩu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* nền: wash màu + chấm lưới + mạng đường bay kiểu biểu đồ hàng không */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55rem 32rem at 12% -8%, color-mix(in oklab, var(--primary) 15%, transparent), transparent 62%)," +
            "radial-gradient(46rem 30rem at 108% 112%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 60%)," +
            "radial-gradient(40rem 26rem at 94% -14%, color-mix(in oklab, var(--info) 7%, transparent), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--foreground) 9%, transparent) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full text-primary opacity-[0.18]"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      >
        {/* vòng radar ở góc dưới phải */}
        <g strokeDasharray="4 9" opacity="0.75">
          <circle cx="1080" cy="720" r="150" />
          <circle cx="1080" cy="720" r="265" />
          <circle cx="1080" cy="720" r="385" />
        </g>
        {/* các đường bay */}
        <path d="M-60 640C240 430 560 360 1260 150" strokeDasharray="11 13" strokeWidth="1.7" />
        <path d="M-60 300C300 300 520 520 1260 470" strokeDasharray="6 15" opacity="0.8" />
        <path d="M120 860C300 620 520 560 900 240" strokeDasharray="3 11" opacity="0.6" />
        {/* điểm waypoint */}
        <g>
          <circle cx="174" cy="504" r="4.5" fill="currentColor" stroke="none" />
          <circle cx="174" cy="504" r="11" strokeDasharray="3 4" />
          <circle cx="450" cy="395" r="4.5" fill="currentColor" stroke="none" />
          <circle cx="450" cy="395" r="11" strokeDasharray="3 4" />
          <circle cx="801" cy="286" r="4.5" fill="currentColor" stroke="none" />
          <circle cx="801" cy="286" r="11" strokeDasharray="3 4" />
          <circle cx="244" cy="346" r="3.5" fill="currentColor" stroke="none" />
          <circle cx="435" cy="580" r="3.5" fill="currentColor" stroke="none" />
        </g>
        {/* dấu thập toạ độ */}
        <g opacity="0.8">
          <path d="M660 620h22M671 609v22" />
          <path d="M950 430h22M961 419v22" />
          <path d="M300 180h22M311 169v22" />
        </g>
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, var(--foreground) 5%, transparent), transparent)",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Plane className="h-7 w-7" />
          </div>
          <h1 className="font-mono text-lg font-bold tracking-[0.3em] text-foreground">
            DISPATCH BOARD
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hệ thống điều phối chuyến bay nội bộ
          </p>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-2xl backdrop-blur-md">
          <h2 className="text-xl font-semibold text-card-foreground">Đăng nhập</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dùng tài khoản dispatcher đã được cấp.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="dispatcher@example.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Mật khẩu</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full font-semibold" disabled={busy}>
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </form>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Hệ thống chỉ dành cho tài khoản được cấp quyền. Chức năng tạo tài khoản
              và đăng nhập Google hiện đang tắt.
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sohee — A product by Rosie
        </p>
      </div>
    </div>
  );
}
