import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import loginBgUrl from "@/assets/login-city-left-clear.jpg";
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

  return (
    <div className="sakura-login">
      <img src={loginBgUrl} alt="" className="sakura-backdrop" />
      <div className="sakura-scene">
        <img src={loginBgUrl} alt="Thành phố bên sông giữa những cành hoa anh đào" className="sakura-city" />
        <img src={vietjetPlane} alt="Máy bay Vietjet Air" className="sakura-plane" />
        <section className="sakura-brand">
          <div className="sakura-wordmark">VietJet<span>Air.com</span></div>
          <h1>Sohee<br />Dispatch Board</h1>
          <div className="sakura-brand-rule" />
          <p>Connecting People,<br />Flying Further Together</p>
          <div className="sakura-tags"><span>✈ Safety</span><span>⏱ On-time</span><span>🌸 Teamwork</span></div>
        </section>
        <main className="sakura-glass">
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
        <span className="sakura-version">V 4.01</span>
      </div>
    </div>
  );
}
