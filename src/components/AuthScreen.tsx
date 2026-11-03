import { markBrowserSession } from "@/lib/browser-session";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import loginBgUrl from "@/assets/login-shanghai-day2.jpg";
import vietjetPlane from "@/assets/login-vietjet-plane.png";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, ShieldCheck, User } from "lucide-react";

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

  useEffect(() => {
    let alive = true;
    // Khôi phục phiên đã lưu; cổng /tool vẫn xác thực người dùng trước khi mở.
    void supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) void navigate({ to: "/tool", replace: true });
    }).catch(() => {});
    return () => { alive = false; };
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
      if (error) {
        toast.error("Sai ID hoặc mật khẩu");
      } else {
        markBrowserSession();
        navigate({ to: "/tool", replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sakura-login">
      <img src={loginBgUrl} alt="" className="sakura-backdrop" />
      <div className="sakura-scene">
        <img src={loginBgUrl} alt="Thành phố bên sông giữa những cành hoa anh đào" className="sakura-city" />
        <svg className="sakura-atc" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g className="atc-routes">
            <path d="M-20 120 L380 260 L760 180 L1180 300 L1620 210" />
            <path d="M120 -20 L380 260 L520 520" />
            <path d="M760 180 L900 -20" />
            <path d="M760 180 L980 420 L1180 300 L1400 -20" />
            <path d="M-20 420 L240 380 L520 520 L980 420 L1620 470" />
            <path d="M240 380 L380 260" />
            <path d="M1180 300 L1350 520" />
          </g>
          <g className="atc-pts">
            {[[380,260],[760,180],[1180,300],[240,380],[520,520],[980,420],[1350,520]].map(([x,y]) => (
              <g key={`${x}-${y}`}><circle cx={x} cy={y} r="5" /><path d={`M${x} ${y-11} L${x+10} ${y+7} L${x-10} ${y+7} Z`} /></g>
            ))}
          </g>
          <circle className="atc-ring" cx="760" cy="180" r="120" />
          <circle className="atc-ring" cx="760" cy="180" r="220" />
        </svg>
        <section className="sakura-brand">
          <div className="sakura-wordmark">VietJet<span>Air.com</span></div>
          <h1>Sohee<br />Dispatch Board</h1>
          <div className="sakura-brand-rule" />
          <p>Connecting People,<br />Flying Further Together</p>
          <div className="sakura-tags"><span>✈ Safety</span><span>⏱ On-time</span><span>🌸 Teamwork</span></div>
        </section>
        <div className="sakura-tow">
        <img src={vietjetPlane} alt="Máy bay Vietjet Air" className="sakura-plane" />
        <svg className="sakura-ropes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M8 4 L4 100" />
          <path d="M8 4 L96 100" />
          <circle cx="8" cy="4" r="1.4" />
        </svg>
        <div className="sakura-pole" aria-hidden="true"><i /><i /></div>
        <main className="sakura-glass sakura-flag">
          <div className="sakura-form-mark">✈ SOHEE · DISPATCH ✈</div>
          <h2 className="sakura-form-title">Đăng nhập</h2>
          <p className="sakura-form-sub">Dùng ID và mật khẩu do quản lý cấp.</p>
          <form onSubmit={submit}>
            <div className="sakura-field-group">
              <Label htmlFor="id">ID tài khoản</Label>
              <div className="sakura-input-wrap">
                <User className="sakura-input-icon" aria-hidden="true" />
                <Input id="id" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  placeholder="hyphan" className="sakura-input" value={id} onChange={(e) => setId(e.target.value)} />
              </div>
            </div>
            <div className="sakura-field-group">
              <Label htmlFor="pw">Mật khẩu</Label>
              <div className="sakura-input-wrap">
                <Lock className="sakura-input-icon" aria-hidden="true" />
                <Input id="pw" type="password" autoComplete="current-password" placeholder="********"
                  className="sakura-input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="sakura-signin">
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </form>
          <div className="sakura-note">
            <ShieldCheck className="sakura-note-icon" aria-hidden="true" />
            <p>Hệ thống chỉ dành cho tài khoản được cấp. Chưa có ID? Liên hệ người quản lý để được cấp tài khoản.</p>
          </div>
        </main>
        </div>
        <span className="sakura-version">V 4.79</span>
      </div>
    </div>
  );
}
