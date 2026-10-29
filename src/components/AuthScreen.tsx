import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plane, Lock, UserRound, ShieldCheck, FileText, CloudSun, ArrowRight } from "lucide-react";
import loginBg from "@/assets/login-bg.jpg";
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
    "h-12 rounded-xl border-[color:var(--vj-line)] bg-card pl-10 text-base text-[color:var(--vj-ink)] placeholder:text-[color:var(--vj-muted)]/60 focus-visible:border-[color:var(--vj-red)] focus-visible:ring-[color:var(--vj-red)]/25";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[color:var(--vj-ink)]">
      <img src={loginBg} alt="" width={1920} height={1088} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--vj-sky) 82%, transparent) 0%, color-mix(in oklab, var(--vj-sky) 35%, transparent) 38%, transparent 60%)" }} />
      <svg aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-40 w-[60%]" viewBox="0 0 600 160" preserveAspectRatio="none">
        <path d="M0 160 C 250 150, 420 90, 600 10 L600 160 Z" fill="var(--vj-red)" />
        <path d="M0 160 C 250 140, 420 80, 600 0 L600 22 C 420 100, 260 150, 0 160 Z" fill="var(--vj-yellow)" />
      </svg>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-10 lg:flex-row lg:items-center lg:justify-between">
        <section className="hidden max-w-xl lg:block">
          <div className="text-3xl font-black italic text-[color:var(--vj-red)]">Sohee</div>
          <div className="mt-1 h-1 w-56" style={{ background: "linear-gradient(90deg, var(--vj-red), var(--vj-yellow))" }} />
          <div className="mt-2 text-sm font-semibold uppercase tracking-[0.5em] text-[color:var(--vj-muted)]">Dispatch Board</div>
          <h1 className="mt-8 text-5xl font-extrabold leading-tight text-[color:var(--vj-ink)]">
            Kết nối bầu trời
            <br />
            <span className="text-[color:var(--vj-red)]">vận hành mỗi ngày.</span>
          </h1>
          <p className="mt-5 text-lg text-[color:var(--vj-ink)]/80">
            Dữ liệu thời gian thực • Quyết định chính xác • Chuyến bay an toàn • Hành trình trọn vẹn.
          </p>
          <div className="mt-8 grid grid-cols-4 gap-3">
            {[
              { i: Plane, t: "Crewlist", s: "Real-time" },
              { i: FileText, t: "FPL / NOTAM", s: "Up to date" },
              { i: CloudSun, t: "Weather", s: "Global data" },
              { i: ShieldCheck, t: "Operations", s: "Safer flights" },
            ].map(({ i: Icon, t, s }) => (
              <div key={t} className="rounded-2xl bg-card/70 p-3 text-center shadow-sm backdrop-blur">
                <Icon className="mx-auto h-6 w-6 text-[color:var(--vj-red)]" />
                <div className="mt-2 text-sm font-bold text-[color:var(--vj-ink)]">{t}</div>
                <div className="text-xs text-[color:var(--vj-muted)]">{s}</div>
              </div>
            ))}
          </div>
        </section>

        <main className="mx-auto w-full max-w-md lg:mx-0">
          <div className="rounded-3xl border border-card/60 bg-card/90 p-8 shadow-2xl backdrop-blur-md sm:p-10">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--vj-red)] text-[color:var(--vj-on-red)] shadow-lg">
                <Plane className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xl font-extrabold text-[color:var(--vj-ink)]">Sohee</div>
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--vj-muted)]">Dispatch Board</div>
              </div>
            </div>
            <h2 className="mt-7 text-3xl font-extrabold text-[color:var(--vj-ink)]">Đăng nhập</h2>
            <p className="mt-1 text-sm text-[color:var(--vj-muted)]">Truy cập hệ thống quản lý khai thác bay.</p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <div className="relative">
                <Label htmlFor="id" className="sr-only">ID tài khoản</Label>
                <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--vj-muted)]" />
                <Input id="id" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  placeholder="Nhập ID tài khoản" className={field} value={id} onChange={(e) => setId(e.target.value)} />
              </div>
              <div className="relative">
                <Label htmlFor="pw" className="sr-only">Mật khẩu</Label>
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--vj-muted)]" />
                <Input id="pw" type="password" autoComplete="current-password" placeholder="Nhập mật khẩu"
                  className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" size="lg" disabled={busy}
                className="h-12 w-full rounded-xl text-base font-bold text-[color:var(--vj-on-red)] shadow-lg transition hover:brightness-110"
                style={{ background: "linear-gradient(90deg, var(--vj-red), var(--vj-red-deep))" }}>
                {busy ? "Đang đăng nhập…" : "Đăng nhập"} <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-[color:var(--vj-muted)]">Chưa có ID? Liên hệ người quản lý để được cấp tài khoản.</p>
          </div>
        </main>
      </div>
      <div className="absolute bottom-4 left-6 hidden text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--vj-on-red)] lg:block">Safer skies | Brighter journeys | Together</div>
    </div>
  );
}
