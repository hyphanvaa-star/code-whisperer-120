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
      if (data.session) await supabase.auth.signOut();
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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#04140d] px-4">
      <style>{`
        @keyframes atc-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes atc-blink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: 0.15; } }
        @keyframes atc-blink-slow { 0%, 45% { opacity: 1; } 46%, 100% { opacity: 0.2; } }
        .atc-sweep { transform-origin: 600px 400px; animation: atc-sweep 9s linear infinite; }
        .atc-blink { animation: atc-blink 2.4s steps(1) infinite; }
        .atc-blink-2 { animation: atc-blink 3.1s steps(1) infinite; animation-delay: 0.9s; }
        .atc-blink-3 { animation: atc-blink-slow 4s steps(1) infinite; animation-delay: 1.6s; }
      `}</style>
      {/* nền màn hình radar ATC: tối, vòng tròn + tia quét, chấm nhấp nháy */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% 50%, rgba(16,60,38,0.55), transparent 70%)," +
            "radial-gradient(30rem 22rem at 50% 50%, rgba(34,120,70,0.18), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,222,128,0.06) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(74,222,128,0.06) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {/* vòng radar trung tâm */}
        <g stroke="#4ade80" strokeOpacity="0.35" strokeWidth="1">
          <circle cx="600" cy="400" r="120" />
          <circle cx="600" cy="400" r="230" strokeDasharray="3 7" />
          <circle cx="600" cy="400" r="340" />
          <circle cx="600" cy="400" r="450" strokeDasharray="3 7" />
          <circle cx="600" cy="400" r="560" strokeOpacity="0.2" />
          <path d="M600 -160V960M-160 400H1360" strokeOpacity="0.25" />
        </g>
        {/* tia quét radar */}
        <g className="atc-sweep">
          <path d="M600 400 L600 -160 A560 560 0 0 1 742 -135 Z" fill="rgba(74,222,128,0.14)" stroke="none" />
          <line x1="600" y1="400" x2="600" y2="-160" stroke="#4ade80" strokeOpacity="0.7" strokeWidth="1.5" />
        </g>
        {/* các đường bay nét đứt */}
        <g stroke="#4ade80" strokeOpacity="0.4" strokeWidth="1.2">
          <path d="M-60 640C240 430 560 360 1260 150" strokeDasharray="10 12" />
          <path d="M-60 300C300 300 520 520 1260 470" strokeDasharray="5 14" strokeOpacity="0.3" />
          <path d="M120 860C300 620 520 560 900 240" strokeDasharray="3 10" strokeOpacity="0.25" />
        </g>
        {/* chấm xanh lá: mục tiêu đang theo dõi */}
        <g fill="#4ade80">
          <circle className="atc-blink" cx="240" cy="250" r="5" />
          <circle className="atc-blink-2" cx="880" cy="560" r="5" />
          <circle className="atc-blink-3" cx="1020" cy="220" r="4" />
          <circle className="atc-blink-2" cx="150" cy="600" r="4" />
          <circle className="atc-blink" cx="520" cy="180" r="3.5" />
        </g>
        {/* chấm đỏ/hổ phách: cảnh báo */}
        <g fill="#f87171">
          <circle className="atc-blink-2" cx="720" cy="160" r="4.5" />
          <circle className="atc-blink" cx="1080" cy="640" r="4.5" />
        </g>
        <g fill="#fbbf24">
          <circle className="atc-blink-3" cx="420" cy="640" r="4" />
        </g>
        {/* nhãn data block kiểu ATC */}
        <g fontFamily="monospace" fontSize="11" fill="#4ade80" fillOpacity="0.55">
          <text x="252" y="244">VJC822 · FL350</text>
          <text x="892" y="554">VNA698 · FL390</text>
          <text x="1030" y="214">VJC84 · FL370</text>
        </g>
        {/* dấu thập toạ độ */}
        <g stroke="#4ade80" strokeOpacity="0.4">
          <path d="M660 620h22M671 609v22" />
          <path d="M950 430h22M961 419v22" />
          <path d="M300 180h22M311 169v22" />
        </g>
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{
          background: "linear-gradient(to top, rgba(2,10,6,0.7), transparent)",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Plane className="h-7 w-7" />
          </div>
          <h1 className="font-mono text-lg font-bold tracking-[0.3em] text-emerald-300">
            DISPATCH BOARD
          </h1>
          <p className="mt-1 text-sm text-emerald-100/60">
            Hệ thống điều phối chuyến bay nội bộ
          </p>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-emerald-400/20 bg-[#071c11]/85 p-8 shadow-2xl shadow-black/50 backdrop-blur-md">
          <h2 className="text-xl font-semibold text-emerald-50">Đăng nhập</h2>
          <p className="mt-1 text-sm text-emerald-100/60">
            Dùng ID và mật khẩu do quản lý cấp.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="id" className="text-emerald-100/80">ID tài khoản</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" />
                <Input
                  id="id"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="hyphan"
                  className="border-emerald-400/25 bg-black/30 pl-9 text-emerald-50 placeholder:text-emerald-100/30 focus-visible:ring-emerald-400/40"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw" className="text-emerald-100/80">Mật khẩu</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/40" />
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="border-emerald-400/25 bg-black/30 pl-9 text-emerald-50 placeholder:text-emerald-100/30 focus-visible:ring-emerald-400/40"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full font-semibold" disabled={busy}>
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </form>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2.5 text-xs text-emerald-100/60">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Hệ thống chỉ dành cho tài khoản được cấp. Chưa có ID? Liên hệ người quản lý
              để được cấp tài khoản.
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-emerald-100/40">
          Sohee — A product by Hy
        </p>
      </div>
    </div>
  );
}
