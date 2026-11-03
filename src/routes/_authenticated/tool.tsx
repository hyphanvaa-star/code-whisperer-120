import { clearBrowserSession } from "@/lib/browser-session";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccount, saveMyAvatar, updateMyAccount } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Camera, KeyRound, ShieldCheck, Trash2, User } from "lucide-react";
import { passwordChecks } from "@/lib/password-rules";
import { amIAccountOwner } from "@/lib/admin.functions";
import { logAuthEvent } from "@/lib/auth-activity.functions";
import { ManageAccountsDialog } from "@/components/ManageAccountsDialog";

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
    __fbUserId?: () => string | null;
    __fbRefresh?: () => Promise<string | null>;
    __fbExpired?: () => void;
  }
}

function ToolPage() {
  const [ready, setReady] = useState(false);
  const [toolVersion, setToolVersion] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ownerRef = useRef(false);
  const checkOwner = useServerFn(amIAccountOwner);
  const ctx = Route.useRouteContext();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const emailRef = useRef("");
  const profileRef = useRef({ avatarUrl: "", displayName: "" });
  const readAccount = useServerFn(getMyAccount);
  const sendAccount = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "sohee-account", email: emailRef.current, ...profileRef.current, canManage: ownerRef.current },
      window.location.origin,
    );
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void readAccount().then((p) => {
      if (!alive) return;
      emailRef.current = p.email;
      profileRef.current = p;
      sendAccount();
    }).catch(() => {}); };
    refresh();
    let liveTimer: ReturnType<typeof setInterval> | undefined;
    const sendLive = () => {
      void import("@/lib/admin.functions").then(async (m) => {
        const { presence } = await import("@/lib/presence");
        const users = await m.listUsers();
        const count = users.filter((u) => presence(u.lastSeen).live).length;
        if (alive) frame.current?.contentWindow?.postMessage({ type: "sohee-live-count", count }, window.location.origin);
      }).catch(() => {});
    };
    void checkOwner().then((r) => {
      if (!alive) return;
      ownerRef.current = r.ok; sendAccount();
      if (r.ok) { setTimeout(sendLive, 2500); liveTimer = setInterval(sendLive, 30_000); }
    }).catch(() => {});
    window.addEventListener("sohee-profile-updated", refresh);
    const timer = setInterval(refresh, 30 * 60_000);
    return () => { alive = false; clearInterval(timer); if (liveTimer) clearInterval(liveTimer); window.removeEventListener("sohee-profile-updated", refresh); };
  }, [readAccount, sendAccount, checkOwner]);

  // Tín hiệu online: mỗi 40s khi tab đang mở.
  useEffect(() => {
    const id = ctx.user.id;
    const beat = () => { if (id) void import("@/lib/admin.functions").then((m) => m.pingPresence()).catch(() => {}); };
    const first = setTimeout(beat, 1500);
    beat();
    window.addEventListener("focus", beat);
    const t = setInterval(beat, 40_000);
    document.addEventListener("visibilitychange", beat);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener("focus", beat); document.removeEventListener("visibilitychange", beat); };
  }, [ctx.user.id]);

  const signOut = useCallback(async () => {
    await ctx.queryClient.cancelQueries();
    ctx.queryClient.clear();
    await logAuthEvent({ data: { event: "sign_out" } }).catch(() => {});
    clearBrowserSession();
    await supabase.auth.signOut({ scope: "local" });
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
    window.__fbUserId = () => ctx.user.id;
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
      if (d.type === "sohee-accounts-manage" && ownerRef.current) setManageOpen(true);
    };
    window.addEventListener("message", onMessage);
    return () => {
      sub.subscription.unsubscribe();
      delete window.__fbUserId;
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      clearInterval(tick);
    };
  }, [navigate, sendAccount, signOut, ctx.user.id]);

  if (!ready || !toolVersion) return <div className="p-6 text-sm text-muted-foreground">Đang mở Dispatch Board…</div>;
  return (
    <>
    {editOpen && <AccountDialog current={emailRef.current.split("@")[0]} onClose={() => setEditOpen(false)} onSaved={(u) => { emailRef.current = `${u}@app.local`; sendAccount(); }} />}
    {manageOpen && <ManageAccountsDialog onClose={() => setManageOpen(false)} />}
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

export function AccountDialog({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: (u: string) => void }) {
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
    if (pw) {
      const bad = passwordChecks(pw, username).filter((c) => !c.ok);
      if (bad.length) return setMsg({ ok: false, t: "Mật khẩu mới chưa đạt: " + bad.map((b) => b.label.toLowerCase()).join(", ") });
    }
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
  const inp = "w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";
  const lbl = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const checks = passwordChecks(pw, username);
  const okCount = checks.filter((c) => c.ok).length;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy && !avatarBusy) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md gap-0 overflow-y-auto rounded-2xl p-0">
        <div className="bg-header px-5 pb-10 pt-5 text-primary-foreground">
          <DialogTitle className="text-lg font-bold tracking-tight">Tài khoản & ảnh đại diện</DialogTitle>
          <p className="mt-0.5 text-xs opacity-85">Cập nhật thông tin đăng nhập và hình ảnh của bạn</p>
        </div>
        <div className="-mt-8 flex items-end gap-4 px-5">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-2xl font-bold text-primary shadow-lg ring-4 ring-card">
            {avatarUrl ? <img src={avatarUrl} alt="Ảnh đại diện" className="h-full w-full object-cover" /> : username.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void changeAvatar(f); }} />
            <Button type="button" size="sm" variant="outline" className="shadow-sm" disabled={avatarBusy || busy} onClick={() => avatarInput.current?.click()}><Camera />{avatarBusy ? "Đang lưu…" : "Chọn ảnh"}</Button>
            {avatarUrl && <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={avatarBusy || busy} onClick={() => void changeAvatar(null)}><Trash2 />Xóa ảnh</Button>}
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 px-5 pb-5 pt-4">
        <div className="rounded-xl border border-border bg-muted/30 p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary"><User className="h-3.5 w-3.5" />Thông tin</p>
          <div className="space-y-3">
            <label className="block"><span className={lbl}>Tên đăng nhập</span><input className={inp} value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label className="block"><span className={lbl}>Tên hiển thị <span className="font-normal normal-case">(để trống nếu giữ nguyên)</span></span><input className={inp} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary"><KeyRound className="h-3.5 w-3.5" />Đổi mật khẩu</p>
          <div className="space-y-3">
            <label className="block"><span className={lbl}>Mật khẩu mới <span className="font-normal normal-case">(để trống nếu giữ nguyên)</span></span><input type="password" autoComplete="new-password" className={inp} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <div className="rounded-lg border border-border bg-card p-3 text-xs leading-snug">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Mật khẩu mới phải đủ:</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${okCount === checks.length ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{okCount}/{checks.length}</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                {checks.map((c) => (
                  <li key={c.label} className={`flex items-center gap-1.5 transition-colors ${c.ok ? "font-medium text-primary" : "text-muted-foreground"}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${c.ok ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{c.ok ? "✓" : "○"}</span>
                    {c.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                Hệ thống còn tự chặn mật khẩu đã bị lộ trên mạng hoặc quá dễ đoán (12345678, password, Abc@1234).
                Mẹo: ghép 3 từ không liên quan + ký tự đặc biệt + số, ví dụ <span className="font-mono font-semibold text-foreground">Hanoi!Office99</span>.
              </p>
            </div>
            {pw && <label className="block"><span className={lbl}>Nhập lại mật khẩu mới</span><input type="password" autoComplete="new-password" className={inp} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
          </div>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          <label className="block"><span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary"><ShieldCheck className="h-3.5 w-3.5" />Mật khẩu hiện tại (bắt buộc)</span><input type="password" required autoComplete="current-password" className={inp} value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Nhập mật khẩu hiện tại để xác nhận mọi thay đổi.</p>
        </div>
        {msg && <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{msg.t}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={busy || avatarBusy} onClick={onClose}>Đóng</Button>
          <Button className="min-w-24 shadow-sm" disabled={busy || avatarBusy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}
