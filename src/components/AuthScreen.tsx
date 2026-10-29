import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plane, Lock, UserRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "Nhập ID tài khoản")
    .max(255)
    .regex(/^[a-z0-9._@-]+$/i, "ID chỉ gồm chữ, số, . _ -"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự").max(72),
});

export function AuthScreen() {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Cờ báo việc xoá phiên cũ lúc mở trang đã xong — tránh đăng nhập bị xoá nhầm.
  const ready = useRef<Promise<void> | null>(null);

  useEffect(() => {
    // Mỗi lần mở web đều bắt đăng nhập lại: xoá phiên đăng nhập đang lưu sẵn.
    // Phải CHỜ xoá xong mới cho đăng nhập, nếu không lần bấm đầu bị signOut()
    // xoá mất phiên vừa tạo và người dùng phải bấm lần thứ 2.
    ready.current = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.auth.signOut({ scope: "local" });
    })();
    // Không đăng ký onAuthStateChange: submit() tự điều hướng sau khi đã set
    // cờ fb-login-done. Listener trước đây điều hướng sớm hơn cờ khiến guard
    // ở /_authenticated signOut() rồi đá về lại trang đăng nhập.
  }, []);

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
      await ready.current; // đảm bảo phiên cũ đã được dọn sạch
      const { error } = await supabase.auth.signInWithPassword({
        email: account,
        password: parsed.data.password,
      });
      if (error) {
        toast.error("Sai ID hoặc mật khẩu");
      } else {
        sessionStorage.setItem("fb-login-done", "1");
        navigate({ to: "/tool", replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-12 rounded-xl border-[color:var(--vj-line)] bg-[color:var(--vj-sky)] pl-10 text-base text-[color:var(--vj-ink)] placeholder:text-[color:var(--vj-muted)]/60 focus-visible:border-[color:var(--vj-red)] focus-visible:ring-[color:var(--vj-red)]/25";

  return (
    <div className="flex min-h-screen bg-[color:var(--vj-sky)]">
      <style>{`
        @keyframes vj-fly { 0% { transform: translate(-10%, 30%) rotate(-12deg); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translate(110%, -40%) rotate(-12deg); opacity: 0; } }
        .vj-fly { animation: vj-fly 14s ease-in-out infinite; }
      `}</style>

      {/* Bảng thương hiệu bên trái: đỏ - vàng kiểu hãng bay */}
      <aside
        className="relative hidden w-[46%] overflow-hidden lg:flex lg:flex-col lg:justify-between p-12 text-[color:var(--vj-on-red)]"
        style={{ background: "linear-gradient(150deg, var(--vj-red) 0%, var(--vj-red-deep) 100%)" }}
      >
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none">
          <path d="M-50 640 C 180 520, 380 560, 680 300" stroke="var(--vj-yellow)" strokeWidth="46" strokeLinecap="round" opacity="0.95" />
          <path d="M-50 720 C 200 610, 420 640, 680 420" stroke="var(--vj-on-red)" strokeWidth="2" strokeDasharray="6 12" opacity="0.5" />
          <circle cx="520" cy="120" r="180" stroke="var(--vj-on-red)" strokeOpacity="0.12" />
          <circle cx="520" cy="120" r="260" stroke="var(--vj-on-red)" strokeOpacity="0.08" />
        </svg>
        <div className="vj-fly pointer-events-none absolute left-0 top-1/3">
          <Plane className="h-10 w-10 rotate-45" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--vj-on-red)] text-[color:var(--vj-red)] shadow-lg">
            <Plane className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-wide">Sohee</div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] opacity-80">Dispatch Board</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <span className="inline-block rounded-full bg-[color:var(--vj-yellow)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[color:var(--vj-ink)]">
            Flight Dispatch
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight">
            Điều phối chuyến bay
            <br />
            nhanh, chính xác, an toàn.
          </h1>
          <p className="mt-4 text-base opacity-85">
            Theo dõi Crewlist, FPL, NOTAM và thời tiết trên một màn hình duy nhất.
          </p>
        </div>

        <p className="relative text-xs opacity-70">Sohee - Dispatch Board</p>
      </aside>

      {/* Khung đăng nhập */}
      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--vj-red)] text-[color:var(--vj-on-red)] shadow-lg">
              <Plane className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-extrabold text-[color:var(--vj-ink)]">Sohee</div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[color:var(--vj-red)]">Dispatch Board</div>
            </div>
          </div>

          <div className="rounded-3xl border border-[color:var(--vj-line)] bg-card p-8 shadow-[0_24px_60px_-24px_color-mix(in_oklab,var(--vj-red)_35%,transparent)] sm:p-10">
            <div className="mb-1 h-1.5 w-14 rounded-full" style={{ background: "linear-gradient(90deg, var(--vj-red), var(--vj-yellow))" }} />
            <h2 className="mt-5 text-3xl font-extrabold text-[color:var(--vj-ink)]">Đăng nhập</h2>
            <p className="mt-2 text-sm text-[color:var(--vj-muted)]">Dùng ID và mật khẩu do quản lý cấp.</p>

            <form onSubmit={submit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="id" className="text-sm font-semibold text-[color:var(--vj-ink)]">ID tài khoản</Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--vj-muted)]" />
                  <Input id="id" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                    placeholder="hyphan" className={field} value={id} onChange={(e) => setId(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw" className="text-sm font-semibold text-[color:var(--vj-ink)]">Mật khẩu</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--vj-muted)]" />
                  <Input id="pw" type="password" autoComplete="current-password" placeholder="••••••••"
                    className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <Button type="submit" size="lg" disabled={busy}
                className="h-12 w-full rounded-xl text-base font-bold text-[color:var(--vj-on-red)] shadow-lg transition hover:brightness-110"
                style={{ background: "linear-gradient(90deg, var(--vj-red), var(--vj-red-deep))" }}>
                {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              </Button>
            </form>

            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[color:var(--vj-yellow)] bg-[color:var(--vj-yellow)]/15 px-3.5 py-3 text-xs text-[color:var(--vj-ink)]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--vj-red)]" />
              <span>Hệ thống chỉ dành cho tài khoản được cấp. Chưa có ID? Liên hệ người quản lý để được cấp tài khoản.</span>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-[color:var(--vj-muted)] lg:hidden">Sohee - Dispatch Board</p>
        </div>
      </main>
    </div>
  );
}
