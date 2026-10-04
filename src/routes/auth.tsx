import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Dispatch Board" },
      { name: "description", content: "Đăng nhập hoặc tạo tài khoản dispatcher." },
      { property: "og:title", content: "Đăng nhập — Dispatch Board" },
      { property: "og:description", content: "Đăng nhập hoặc tạo tài khoản dispatcher." },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("Email không hợp lệ").max(255),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) toast.error("Sai email hoặc mật khẩu");
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: { emailRedirectTo: window.location.origin + "/auth", data: { full_name: name.trim().slice(0, 100) } },
        });
        if (error) toast.error(error.message);
        else if (!data.session) toast.success("Đã gửi email xác nhận — mở hộp thư để kích hoạt tài khoản.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("Đăng nhập Google thất bại");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-2 font-mono text-sm font-bold tracking-widest text-primary">
          <Plane className="h-5 w-5" /> DISPATCH BOARD
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "in" | "up")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="in">Đăng nhập</TabsTrigger>
            <TabsTrigger value="up">Tạo tài khoản</TabsTrigger>
          </TabsList>
        </Tabs>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "up" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Họ tên</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Mật khẩu</Label>
            <Input
              id="pw"
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "in" ? "Đăng nhập" : "Tạo tài khoản"}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> hoặc <div className="h-px flex-1 bg-border" />
        </div>
        <Button variant="secondary" className="w-full" onClick={google}>
          Tiếp tục với Google
        </Button>
        {mode === "up" && (
          <p className="mt-4 text-xs text-muted-foreground">
            Tài khoản mới cần quản trị viên cấp quyền dispatcher trước khi xem được dữ liệu chuyến bay.
          </p>
        )}
      </div>
    </div>
  );
}
