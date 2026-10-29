import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import loginBg from "@/assets/login-sakura-city.png.asset.json";
import vietjetPlane from "@/assets/login-vietjet-plane.png";
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

  return (
    <div className="sakura-login">
      <img src={loginBg.url} alt="" className="sakura-backdrop" />
      <div className="sakura-scene">
        <img src={loginBg.url} alt="Thành phố bên sông giữa những cành hoa anh đào" className="sakura-city" />
        <section className="sakura-brand">
          <img src={vietjetPlane} alt="Máy bay Vietjet Air" className="sakura-plane" />
          <div className="sakura-wordmark">vietjet<span>AIR</span></div>
          <h1>Sohee<br />Dispatch Board</h1>
          <div className="sakura-brand-rule" />
          <p>Connecting People,<br />Flying Further Together</p>
        </section>
        <main className="sakura-glass">
          <form onSubmit={submit}>
            <div className="sakura-field-group">
              <Label htmlFor="id">ID</Label>
              <Input id="id" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
                placeholder="Enter your ID" className="sakura-input" value={id} onChange={(e) => setId(e.target.value)} />
            </div>
            <div className="sakura-field-group">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoComplete="current-password" placeholder="********"
                className="sakura-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="sakura-forgot" title="Liên hệ người quản lý để đặt lại mật khẩu">
              <Button type="button" variant="link" disabled>Forgot password?</Button>
            </div>
            <Button type="submit" disabled={busy} className="sakura-signin">
              {busy ? "Đang đăng nhập…" : "SIGN IN"}
            </Button>
          </form>
          <div className="sakura-divider"><span />or<span /></div>
          <div title="Đăng nhập Google chưa được thiết lập">
            <Button type="button" variant="outline" disabled className="sakura-google">
              <span className="sakura-google-mark" aria-hidden="true">G</span>Sign in with Google
            </Button>
          </div>
          <div className="sakura-account" title="Liên hệ người quản lý để được cấp tài khoản">
            Are you new? <Button type="button" variant="link" disabled>Create an Account</Button>
          </div>
        </main>
        <span className="sakura-version">V 3.75</span>
      </div>
    </div>
  );
}
