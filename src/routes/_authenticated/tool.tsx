import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { updateMyAccount } from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated/tool")({
  head: () => ({
    meta: [
      { title: "Dispatch Board — Flight Dispatch Tool" },
      { name: "description", content: "Bảng điều phối chuyến bay VietJet: KHB, NOTAM, ATC, giới hạn tàu, giao ca." },
      { property: "og:title", content: "Dispatch Board — Flight Dispatch Tool" },
      { property: "og:description", content: "Bảng điều phối chuyến bay cho nhóm dispatcher." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ToolPage,
});

declare global {
  interface Window {
    __fbToken?: () => string | null;
    __fbRefresh?: () => Promise<string | null>;
    __fbExpired?: () => void;
  }
}

function ToolPage() {
  const [ready, setReady] = useState(false);
  const [toolVersion, setToolVersion] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const ctx = Route.useRouteContext();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const emailRef = useRef("");

  const sendAccount = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "sohee-account", email: emailRef.current },
      window.location.origin,
    );
  }, []);

  const signOut = useCallback(async () => {
    await ctx.queryClient.cancelQueries();
    ctx.queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [ctx.queryClient, navigate]);

  useEffect(() => {
    let token: string | null = null;
    let expiresAt = 0;
    const keep = (s: { access_token: string; expires_at?: number } | null) => {
      token = s?.access_token ?? null;
      expiresAt = (s?.expires_at ?? 0) * 1000;
    };
    window.__fbToken = () => token;
    // Làm mới phiên khi token hết hạn (tab để lâu/máy ngủ làm trễ việc tự làm mới).
    window.__fbRefresh = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session && data.session.expires_at && data.session.expires_at * 1000 - Date.now() > 60_000 && data.session.access_token !== token) {
        keep(data.session);
        return token;
      }
      const r = await supabase.auth.refreshSession();
      if (r.data.session) keep(r.data.session);
      return r.data.session?.access_token ?? null;
    };
    let expiredOnce = false;
    window.__fbExpired = () => {
      if (expiredOnce) return;
      expiredOnce = true;
      void navigate({ to: "/auth", replace: true });
    };
    // Quay lại tab / máy thức dậy: làm mới sớm nếu token sắp hết hạn.
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (expiresAt && expiresAt - Date.now() < 5 * 60_000) void window.__fbRefresh?.();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    const tick = setInterval(wake, 60_000);
    supabase.auth.getSession().then(({ data }) => {
      keep(data.session);
      emailRef.current = data.session?.user.email ?? "";
      setToolVersion(`${Date.now()}`);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      keep(s);
      emailRef.current = s?.user.email ?? "";
      if (!s) void navigate({ to: "/auth", replace: true });
    });
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = (ev.data || {}) as { type?: string };
      if (d.type === "sohee-signout") void signOut();
      if (d.type === "sohee-account-request") sendAccount();
      if (d.type === "sohee-account-edit") setEditOpen(true);
    };
    window.addEventListener("message", onMessage);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      clearInterval(tick);
    };
  }, [navigate, sendAccount, signOut]);

  if (!ready || !toolVersion) return <div className="p-6 text-sm text-muted-foreground">Đang mở Dispatch Board…</div>;
  return (
    <>
    {editOpen && <AccountDialog current={emailRef.current.split("@")[0]} onClose={() => setEditOpen(false)} onSaved={(u) => { emailRef.current = `${u}@app.local`; sendAccount(); }} />}
    <iframe
      ref={frame}
      key={toolVersion}
      title="Dispatch Board"
      src={`/tool-page?v=${toolVersion}`}
      onLoad={sendAccount}
      className="fixed inset-0 h-screen w-screen border-0"
    />
    </>
  );
}

function AccountDialog({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: (u: string) => void }) {
  const save = useServerFn(updateMyAccount);
  const [username, setUsername] = useState(current);
  const [displayName, setDisplayName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [cur, setCur] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw && pw !== pw2) return setMsg({ ok: false, t: "Hai lần nhập mật khẩu mới không khớp" });
    setBusy(true); setMsg(null);
    try {
      const r = await save({ data: {
        currentPassword: cur,
        username: username.trim() && username.trim().toLowerCase() !== current ? username.trim() : undefined,
        displayName: displayName.trim() || undefined,
        newPassword: pw || undefined,
      } });
      onSaved(r.username);
      setMsg({ ok: true, t: r.emailChanged ? `Đã lưu. Lần sau đăng nhập bằng: ${r.username}` : "Đã lưu thay đổi" });
      setCur(""); setPw(""); setPw2("");
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message.replace(/^.*?"message":"([^"]+)".*$/, "$1") : "Lỗi" });
    } finally { setBusy(false); }
  };
  const inp = "w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-card p-5 text-card-foreground shadow-xl">
        <h2 className="text-lg font-bold">Đổi tài khoản / mật khẩu</h2>
        <label className="block text-sm">Tên đăng nhập<input className={inp} value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="block text-sm">Tên hiển thị (để trống nếu giữ nguyên)<input className={inp} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label className="block text-sm">Mật khẩu mới (để trống nếu giữ nguyên)<input type="password" autoComplete="new-password" className={inp} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {pw && <label className="block text-sm">Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" className={inp} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        <label className="block text-sm font-semibold">Mật khẩu hiện tại (bắt buộc)<input type="password" required autoComplete="current-password" className={inp} value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{msg.t}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-input px-4 py-2 text-sm">Đóng</button>
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </form>
    </div>
  );
}
