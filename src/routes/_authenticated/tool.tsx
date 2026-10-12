import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccount, saveMyAvatar, updateMyAccount } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Camera, Trash2 } from "lucide-react";

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
  const profileRef = useRef({ avatarUrl: "", displayName: "" });
  const readAccount = useServerFn(getMyAccount);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void readAccount().then((p) => {
      if (!alive) return;
      emailRef.current = p.email;
      profileRef.current = p;
      sendAccount();
    }).catch(() => {}); };
    refresh();
    window.addEventListener("sohee-profile-updated", refresh);
    const timer = setInterval(refresh, 30 * 60_000);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("sohee-profile-updated", refresh); };
  }, [readAccount]);

  const sendAccount = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "sohee-account", email: emailRef.current, ...profileRef.current },
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
      if (ev.origin !== window.location.origin || ev.source !== frame.current?.contentWindow) return;
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
  const readAccount = useServerFn(getMyAccount);
  const saveAvatar = useServerFn(saveMyAvatar);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    readAccount().then((p) => { if (alive) { setAvatarUrl(p.avatarUrl); setDisplayName(p.displayName); } }).catch(() => {});
    return () => { alive = false; };
  }, [readAccount]);
  const changeAvatar = async (file: File | null) => {
    setAvatarBusy(true); setMsg(null);
    try {
      let image: string | null = null;
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Chọn ảnh JPG, PNG hoặc WebP tối đa 10 MB");
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext("2d");
        if (!ctx) { bitmap.close(); throw new Error("Không xử lý được ảnh"); }
        const edge = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 512, 512);
        bitmap.close(); image = canvas.toDataURL("image/jpeg", 0.9);
      }
      await saveAvatar({ data: { image } });
      const p = await readAccount(); setAvatarUrl(p.avatarUrl);
      window.dispatchEvent(new Event("sohee-profile-updated"));
      setMsg({ ok: true, t: file ? "Đã lưu ảnh đại diện" : "Đã xóa ảnh đại diện" });
    } catch (err) { setMsg({ ok: false, t: err instanceof Error ? err.message : "Không lưu được ảnh" }); }
    finally { setAvatarBusy(false); if (avatarInput.current) avatarInput.current.value = ""; }
  };
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
      window.dispatchEvent(new Event("sohee-profile-updated"));
      setMsg({ ok: true, t: r.emailChanged ? `Đã lưu. Lần sau đăng nhập bằng: ${r.username}` : "Đã lưu thay đổi" });
      setCur(""); setPw(""); setPw2("");
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message.replace(/^.*?"message":"([^"]+)".*$/, "$1") : "Lỗi" });
    } finally { setBusy(false); }
  };
  const inp = "w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]";
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy && !avatarBusy) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-lg">
        <DialogTitle>Tài khoản & ảnh đại diện</DialogTitle>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xl font-bold text-primary-foreground">
            {avatarUrl ? <img src={avatarUrl} alt="Ảnh đại diện" className="h-full w-full object-cover" /> : username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void changeAvatar(f); }} />
            <Button type="button" variant="outline" disabled={avatarBusy || busy} onClick={() => avatarInput.current?.click()}><Camera />{avatarBusy ? "Đang lưu…" : "Chọn ảnh"}</Button>
            {avatarUrl && <Button type="button" variant="ghost" disabled={avatarBusy || busy} onClick={() => void changeAvatar(null)}><Trash2 />Xóa ảnh</Button>}
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Tên đăng nhập<input className={inp} value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="block text-sm">Tên hiển thị (để trống nếu giữ nguyên)<input className={inp} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label className="block text-sm">Mật khẩu mới (để trống nếu giữ nguyên)<input type="password" autoComplete="new-password" className={inp} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {pw && <label className="block text-sm">Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" className={inp} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        <label className="block text-sm font-semibold">Mật khẩu hiện tại (bắt buộc)<input type="password" required autoComplete="current-password" className={inp} value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{msg.t}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy || avatarBusy} onClick={onClose}>Đóng</Button>
          <Button disabled={busy || avatarBusy}>{busy ? "Đang lưu…" : "Lưu"}</Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}
