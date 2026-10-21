import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Database, RotateCcw, History, KeyRound, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { accountDetails, resetPersonalData, createAccount, deleteAccount, listActivity, listUsers, resetAccountPassword, setRole, updateAccountInfo } from "@/lib/admin.functions";
import { passwordChecks } from "@/lib/password-rules";

const inp = "w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";
const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const card = "rounded-xl border border-border bg-card p-4 shadow-sm";

const ACTION: Record<string, string> = {
  reset_personal: "Về bản chung",
  update_account: "Tự sửa tài khoản", create_account: "Tạo tài khoản", reset_password: "Đổi mật khẩu",
  delete_account: "Xóa tài khoản", edit_account: "Sửa thông tin", grant_role: "Cấp quyền", revoke_role: "Gỡ quyền",
};

function Checks({ pw, user }: { pw: string; user: string }) {
  const c = passwordChecks(pw, user);
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {c.map((x) => <li key={x.label} className={x.ok ? "font-medium text-primary" : "text-muted-foreground"}>{x.ok ? "✓" : "○"} {x.label}</li>)}
    </ul>
  );
}
const badPw = (pw: string, u: string) => passwordChecks(pw, u).filter((c) => !c.ok).map((b) => b.label.toLowerCase()).join(", ");

export function ManageAccountsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsers);
  const logFn = useServerFn(listActivity);
  const createFn = useServerFn(createAccount);
  const resetFn = useServerFn(resetAccountPassword);
  const delFn = useServerFn(deleteAccount);
  const roleFn = useServerFn(setRole);
  const infoFn = useServerFn(updateAccountInfo);
  const users = useQuery({ queryKey: ["users"], queryFn: () => usersFn() });
  const log = useQuery({ queryKey: ["activity"], queryFn: () => logFn() });
  const detFn = useServerFn(accountDetails);
  const resetDataFn = useServerFn(resetPersonalData);
  const ids = (users.data ?? []).map((x) => x.id);
  const det = useQuery({ queryKey: ["acct-details", ids.join(",")], enabled: ids.length > 0, queryFn: () => detFn({ data: { userIds: ids } }) });
  const [sel, setSel] = useState<string | "new">("new");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  // new account
  const [nu, setNu] = useState(""); const [nn, setNn] = useState(""); const [np, setNp] = useState(""); const [na, setNa] = useState(false);
  // edit
  const [eu, setEu] = useState(""); const [en, setEn] = useState(""); const [ep, setEp] = useState("");

  const user = users.data?.find((x) => x.id === sel);
  const login = user?.email.split("@")[0] ?? "";
  useEffect(() => { setEu(login); setEn(user?.name ?? ""); setEp(""); setMsg(null); }, [sel, login, user?.name]);

  const list = useMemo(() => (users.data ?? []).filter((x) => (x.email + " " + x.name).toLowerCase().includes(q.toLowerCase())), [users.data, q]);
  const userLog = (log.data ?? []).filter((l) => l.user_id === sel || l.detail?.includes(String(sel)) || (login && l.detail?.includes(login)));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, t: ok }); await qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["activity"] }); qc.invalidateQueries({ queryKey: ["acct-details"] }); return true; }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "Lỗi" }); return false; }
    finally { setBusy(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = badPw(np, nu); if (b) return setMsg({ ok: false, t: "Mật khẩu chưa đạt: " + b });
    if (await run(() => createFn({ data: { username: nu.trim(), password: np, displayName: nn, admin: na } }), `Đã tạo ${nu.trim().toLowerCase()}`)) { setNu(""); setNn(""); setNp(""); setNa(false); }
  };
  const saveInfo = (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return;
    void run(() => infoFn({ data: { userId: user.id, username: eu.trim().toLowerCase() !== login ? eu.trim() : undefined, displayName: en } }), "Đã lưu thông tin");
  };
  const savePw = (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return;
    const b = badPw(ep, login); if (b) return setMsg({ ok: false, t: "Mật khẩu chưa đạt: " + b });
    void run(() => resetFn({ data: { userId: user.id, password: ep } }), `Đã đặt mật khẩu mới cho ${login}`).then((ok) => ok && setEp(""));
  };

  const Msg = msg && <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{msg.t}</p>;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-3 bg-header px-6 py-4 text-primary-foreground">
          <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => { if (!busy) onClose(); }}><ArrowLeft />Quay lại</Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/15"><Users className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold">Quản lí tài khoản</h2>
            <p className="text-xs opacity-85">{users.data?.length ?? 0} tài khoản · chỉ hyphan thấy mục này</p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(520px,1.1fr)_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-muted/30">
            <div className="flex gap-2 p-3">
              <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className={inp + " pl-8"} placeholder="Tìm tài khoản…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Button variant={sel === "new" ? "default" : "outline"} onClick={() => setSel("new")}><UserPlus />Tạo mới</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
              <table className="w-full overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
                <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Tài khoản</th><th className="px-3 py-2">Quyền</th><th className="px-3 py-2">Dữ liệu riêng</th><th className="px-3 py-2">Ngày tạo</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.isLoading && <tr><td colSpan={4} className="p-3 text-muted-foreground">Đang tải…</td></tr>}
                  {list.map((x) => {
                    const l = x.email.split("@")[0]; const adm = x.roles.includes("admin"); const d = det.data?.[x.id];
                    const own = d?.edits.filter((e) => e.personal).length ?? 0;
                    return (
                      <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer transition-colors ${sel === x.id ? "bg-primary/10" : "hover:bg-muted/60"}`}>
                        <td className="px-3 py-2"><div className="flex items-center gap-3"><Avatar url={d?.avatarUrl} text={l} size="h-9 w-9" /><div className="min-w-0"><div className="truncate font-semibold">{l}{x.isSelf && " (bạn)"}</div><div className="truncate text-xs text-muted-foreground">{x.name || "—"}</div></div></div></td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${adm ? "bg-primary text-primary-foreground" : x.roles.includes("dispatcher") ? "bg-muted text-foreground" : "bg-destructive/10 text-destructive"}`}>{adm ? "Quản trị" : x.roles.includes("dispatcher") ? "Dispatcher" : "Đã khóa"}</span></td>
                        <td className="px-3 py-2">{own ? <span className="font-semibold text-primary">{own} mục</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(x.createdAt).toLocaleDateString("vi-VN")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-6">
            {sel === "new" ? (
              <form onSubmit={create} className={card + " max-w-xl space-y-4"}>
                <h3 className="flex items-center gap-2 font-bold"><UserPlus className="h-4 w-4 text-primary" />Tạo tài khoản mới</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><span className={lbl}>ID đăng nhập</span><input className={inp} value={nu} onChange={(e) => setNu(e.target.value)} placeholder="vd: nguyenvana" required /></label>
                  <label><span className={lbl}>Tên hiển thị</span><input className={inp} value={nn} onChange={(e) => setNn(e.target.value)} placeholder="không bắt buộc" /></label>
                </div>
                <label className="block"><span className={lbl}>Mật khẩu</span><input className={inp} type="text" autoComplete="new-password" value={np} onChange={(e) => setNp(e.target.value)} required /><Checks pw={np} user={nu} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={na} onChange={(e) => setNa(e.target.checked)} />Cho quyền quản trị (vẫn không quản lí được tài khoản)</label>
                {Msg}
                <Button disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</Button>
              </form>
            ) : user ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar url={det.data?.[user.id]?.avatarUrl} text={login} size="h-16 w-16 text-xl" />
                  <div className="flex-1">
                    <h3 className="text-xl font-bold">{login}</h3>
                    <p className="text-sm text-muted-foreground">{user.name || "—"} · tạo ngày {new Date(user.createdAt).toLocaleDateString("vi-VN")}{user.original && user.original !== login ? ` · ID gốc: ${user.original}` : ""}</p>
                  </div>
                </div>
                {Msg}
                <div className="grid gap-4 lg:grid-cols-2">
                  <form onSubmit={saveInfo} className={card + " space-y-3"}>
                    <h4 className="text-sm font-bold">Thông tin đăng nhập</h4>
                    <label className="block"><span className={lbl}>ID đăng nhập</span><input className={inp} value={eu} disabled={user.isSelf} onChange={(e) => setEu(e.target.value)} /></label>
                    <label className="block"><span className={lbl}>Tên hiển thị</span><input className={inp} value={en} onChange={(e) => setEn(e.target.value)} /></label>
                    <Button size="sm" disabled={busy}>Lưu thông tin</Button>
                  </form>
                  <form onSubmit={savePw} className={card + " space-y-3"}>
                    <h4 className="flex items-center gap-2 text-sm font-bold"><KeyRound className="h-4 w-4 text-primary" />Mật khẩu</h4>
                    <p className="text-xs text-muted-foreground">Mật khẩu được mã hóa nên không ai xem được, kể cả hyphan. Đặt mật khẩu mới rồi báo lại cho người dùng.</p>
                    <input className={inp} type="text" autoComplete="new-password" placeholder="Mật khẩu mới" value={ep} onChange={(e) => setEp(e.target.value)} />
                    {ep && <Checks pw={ep} user={login} />}
                    <Button size="sm" disabled={busy || !ep}>Đặt mật khẩu mới</Button>
                  </form>
                </div>
                {!user.isSelf && (
                  <div className={card + " flex flex-wrap items-center gap-3"}>
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="flex-1 text-sm">Quyền: <b>{user.roles.includes("admin") ? "Quản trị" : user.roles.includes("dispatcher") ? "Dispatcher" : "Chưa có quyền"}</b></span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => roleFn({ data: { userId: user.id, role: "dispatcher", grant: !user.roles.includes("dispatcher") } }), "Đã cập nhật quyền")}>{user.roles.includes("dispatcher") ? "Khóa dùng" : "Cho dùng"}</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => roleFn({ data: { userId: user.id, role: "admin", grant: !user.roles.includes("admin") } }), "Đã cập nhật quyền")}>{user.roles.includes("admin") ? "Bỏ quản trị" : "Cho quản trị"}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => { if (window.confirm(`Xóa hẳn tài khoản ${login}? Không khôi phục được.`)) void run(() => delFn({ data: { userId: user.id } }), `Đã xóa ${login}`).then((ok) => ok && setSel("new")); }}><Trash2 />Xóa</Button>
                  </div>
                )}
                <div className={card}>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold"><Database className="h-4 w-4 text-primary" />Điều chỉnh dữ liệu</h4>
                  <ul className="divide-y divide-border text-sm">
                    {(det.data?.[user.id]?.edits ?? []).map((e) => (
                      <li key={e.key} className="flex items-center gap-3 py-2">
                        <span className="flex-1 font-medium">{e.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.personal ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{e.personal ? "Bản riêng" : "Bản chung"}</span>
                        <span className="w-14 text-right text-xs text-muted-foreground">{e.size} dòng</span>
                        <span className="w-36 text-right font-mono text-xs text-muted-foreground">{new Date(e.updatedAt).toLocaleString("vi-VN")}</span>
                        {e.personal ? <Button size="sm" variant="ghost" disabled={busy} title="Xóa bản riêng, người này quay về bản chung" onClick={() => { if (window.confirm(`Đưa ${e.label} của ${login} về bản chung?`)) void run(() => resetDataFn({ data: { key: e.key } }), "Đã đưa về bản chung"); }}><RotateCcw /></Button> : <span className="w-9" />}
                      </li>
                    ))}
                    {det.isLoading && <li className="py-3 text-muted-foreground">Đang tải…</li>}
                    {!det.isLoading && !(det.data?.[user.id]?.edits.length) && <li className="py-3 text-muted-foreground">Người này chưa chỉnh dữ liệu nào.</li>}
                  </ul>
                </div>
                <div className={card}>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 text-primary" />Lịch sử thay đổi</h4>
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">
                    {userLog.map((l) => (
                      <li key={l.id} className="flex gap-3 py-2">
                        <span className="w-36 shrink-0 font-mono text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("vi-VN")}</span>
                        <span className="font-medium">{ACTION[l.action] ?? l.action}</span>
                        <span className="truncate text-muted-foreground">{l.user_id === user.id ? (l.detail ?? "") : "(do hyphan)"}</span>
                      </li>
                    ))}
                    {userLog.length === 0 && <li className="py-3 text-muted-foreground">Chưa có thay đổi nào.</li>}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </div>
    </div>
  );
}

function Avatar({ url, text, size }: { url?: string; text: string; size: string }) {
  return url
    ? <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ring-2 ring-primary/20`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary`}>{text.slice(0, 2).toUpperCase()}</span>;
}
