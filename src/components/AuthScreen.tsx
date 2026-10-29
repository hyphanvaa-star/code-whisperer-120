import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plane } from "lucide-react";
import loginBg from "@/assets/login-bg-longthanh.jpg";
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
    "h-12 rounded-lg border-white/25 bg-white/90 text-base text-neutral-900 placeholder:text-neutral-400 focus-visible:border-white focus-visible:ring-white/40";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <img src={loginBg} alt="" width={1920} height={1088} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10 lg:flex-row lg:items-center lg:justify-between">
        <section className="hidden max-w-xl text-white lg:block">
          <div className="flex items-center gap-2 text-2xl font-black italic tracking-wide">
            <Plane className="h-6 w-6" /> Vietjet Air
          </div>
          <h1 className="mt-10 text-6xl font-extrabold uppercase leading-[1.05] tracking-tight">
            Sohee
            <br />
            Dispatch Board
          </h1>
          <p className="mt-6 text-lg font-medium text-white/90">
            Kết nối bầu trời, vận hành mỗi ngày.
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            Dữ liệu thời gian thực, quyết định chính xác — mọi chuyến bay đều trong tầm tay bạn.
          </p>
        </section>

        <main className="mx-auto w-full max-w-md lg:mx-0">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
            <form onSubmit={submit} className="space-y-5">
              <div>
                <Label htmlFor="id" className="mb-1.5 block text-sm font-medium text-white/90">
                  ID tài khoản
                </Label>
                <Input
                  id="id"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Nhập ID tài khoản"
                  className={field}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pw" className="mb-1.5 block text-sm font-medium text-white/90">
                  Mật khẩu
                </Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
                  className={field}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={busy}
                className="h-12 w-full rounded-lg text-base font-bold uppercase tracking-wide text-white shadow-lg transition hover:brightness-110"
                style={{ background: "linear-gradient(90deg, var(--vj-red), var(--vj-red-deep))" }}
              >
                {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-white/60">
              Chưa có ID? Liên hệ người quản lý để được cấp tài khoản.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
