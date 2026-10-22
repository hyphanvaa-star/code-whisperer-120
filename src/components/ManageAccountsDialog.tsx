import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Database, RotateCcw, History, KeyRound, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { accountDetails, resetPersonalData, createAccount, deleteAccount, listActivity, listUsers, resetAccountPassword, setRole, updateAccountInfo } from "@/lib/admin.functions";
import { passwordChecks } from "@/lib/password-rules";

const inp = "w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";
const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const card = "rounded-2xl border border-border bg-card p-5 shadow-sm";

const ACTION: Record<string, string> = {
  reset_personal: "Về bản chung",
  update_account: "Tự sửa tài khoản", create_account: "Tạo tài khoản", reset_password: "Đổi mật khẩu",
  delete_account: "Xóa tài khoản", edit_account: "Sửa thông tin", grant_role: "Cấp quyền", revoke_role: "Gỡ quyền",
  sign_in: "Đăng nhập", sign_out: "Đăng xuất",
};

function Checks({ pw, user }: { pw: string; user: string }) {
  const c = passwordChecks(pw, user);
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {c.map((x) => <li key={x.label} className={x.ok ? "font-bold text-primary" : "font-medium text-foreground/75"}>{x.ok ? "✓" : "○"} {x.label}</li>)}
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

  const all = users.data ?? [];
  const stats = [
    { k: "Tổng tài khoản", v: all.length },
    { k: "Quản trị", v: all.filter((x) => x.roles.includes("admin")).length },
    { k: "Dispatcher", v: all.filter((x) => !x.roles.includes("admin") && x.roles.includes("dispatcher")).length },
    { k: "Đã khóa", v: all.filter((x) => !x.roles.includes("admin") && !x.roles.includes("dispatcher")).length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="bg-header px-6 py-4 text-primary-foreground shadow-md">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => { if (!busy) onClose(); }}><ArrowLeft />Quay lại</Button>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-foreground/15 ring-1 ring-primary-foreground/25"><Users className="h-5 w-5" /></div>
            <div className="mr-auto">
              <h2 className="text-xl font-extrabold tracking-tight">Quản lí tài khoản</h2>
              <p className="text-xs opacity-85">Chỉ hyphan thấy mục này</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {stats.map((s) => (
                <div key={s.k} className="min-w-[96px] rounded-xl bg-primary-foreground/12 px-3 py-1.5 ring-1 ring-primary-foreground/20">
                  <div className="text-lg font-extrabold leading-tight">{s.v}</div>
                  <div className="text-[11px] font-medium opacity-85">{s.k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,320px)_minmax(380px,460px)_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-card">
            <div className="space-y-2 border-b border-border p-4">
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className={inp + " pl-9"} placeholder="Tìm tài khoản…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Button className="w-full" variant={sel === "new" ? "default" : "outline"} onClick={() => setSel("new")}><UserPlus />Tạo tài khoản mới</Button>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
              {users.isLoading && <p className="p-3 text-sm text-muted-foreground">Đang tải…</p>}
              {list.map((x) => {
                const l = x.email.split("@")[0]; const adm = x.roles.includes("admin"); const d = det.data?.[x.id];
                const own = d?.edits.filter((e) => e.personal).length ?? 0;
                const active = sel === x.id;
                return (
                  <button type="button" key={x.id} onClick={() => setSel(x.id)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${active ? "border-primary bg-primary/10 shadow-sm" : "border-transparent hover:border-border hover:bg-muted/60"}`}>
                    <Avatar url={d?.avatarUrl} text={l} size="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-[15px] font-bold">{l}{x.isSelf && <span className="text-xs font-medium text-muted-foreground">(bạn)</span>}</div>
                      <div className="truncate text-xs text-muted-foreground">{x.name || "—"} · {new Date(x.createdAt).toLocaleDateString("vi-VN")}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${adm ? "bg-primary text-primary-foreground" : x.roles.includes("dispatcher") ? "bg-secondary text-secondary-foreground" : "bg-destructive/10 text-destructive"}`}>{adm ? "Quản trị" : x.roles.includes("dispatcher") ? "Dispatcher" : "Đã khóa"}</span>
                      {own > 0 && <span className="text-[11px] font-semibold text-primary">{own} mục riêng</span>}
                    </div>
                  </button>
                );
              })}
              {!users.isLoading && list.length === 0 && <p className="p-3 text-sm text-muted-foreground">Không tìm thấy tài khoản.</p>}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto bg-muted p-6">
            {sel === "new" ? (
              <form onSubmit={create} className={card + " mx-auto max-w-xl space-y-4 p-6"}>
                <h3 className="flex items-center gap-2 text-lg font-bold"><UserPlus className="h-5 w-5 text-primary" />Tạo tài khoản mới</h3>
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
              <div className="mx-auto max-w-5xl space-y-4">
                <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <Avatar url={det.data?.[user.id]?.avatarUrl} text={login} size="h-16 w-16 text-xl" />
                  <div className="flex-1">
                    <h3 className="text-2xl font-extrabold tracking-tight">{login}</h3>
                    <p className="text-sm text-muted-foreground">{user.name || "—"} · tạo ngày {new Date(user.createdAt).toLocaleDateString("vi-VN")}{user.original && user.original !== login ? ` · ID gốc: ${user.original}` : ""}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${user.roles.includes("admin") ? "bg-primary text-primary-foreground" : user.roles.includes("dispatcher") ? "bg-secondary text-secondary-foreground" : "bg-destructive/10 text-destructive"}`}>{user.roles.includes("admin") ? "Quản trị" : user.roles.includes("dispatcher") ? "Dispatcher" : "Đã khóa"}</span>
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
                      <li key={e.key} className="py-2">
                        <details>
                          <summary className="flex cursor-pointer list-none items-center gap-3">
                            <span className="flex-1 font-medium">▸ {e.label}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.personal ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{e.personal ? "Bản riêng" : "Bản chung"}</span>
                            <span className="w-20 text-right text-xs text-muted-foreground">{e.changes?.length ?? 0} lần sửa</span>
                            <span className="w-36 text-right font-mono text-xs text-muted-foreground">{new Date(e.updatedAt).toLocaleString("vi-VN")}</span>
                            {e.personal ? <Button size="sm" variant="ghost" disabled={busy} title="Xóa bản riêng, người này quay về bản chung" onClick={(ev) => { ev.preventDefault(); if (window.confirm(`Đưa ${e.label} của ${login} về bản chung?`)) void run(() => resetDataFn({ data: { key: e.key } }), "Đã đưa về bản chung"); }}><RotateCcw /></Button> : <span className="w-9" />}
                          </summary>
                          <ul className="mt-2 max-h-80 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 text-xs">
                            {(e.changes ?? []).map((c, i) => (
                              <li key={i} className="py-1">
                                <div className="font-mono font-bold text-muted-foreground">{new Date(c.at).toLocaleString("vi-VN")}</div>
                                {c.added.map((t, j) => <div key={"a" + j} className="break-words text-primary">+ Thêm: {t}</div>)}
                                {c.removed.map((t, j) => <div key={"r" + j} className="break-words text-destructive">− Xoá: {t}</div>)}
                              </li>
                            ))}
                            {!e.changes?.length && <li className="text-muted-foreground">Chưa ghi nhận thêm/xoá nào (chỉ ghi từ bản này trở đi).</li>}
                          </ul>
                        </details>
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

function Avatar({ url, text, size }: { url?: string | undefined; text: string; size: string }) {
  return url
    ? <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ring-2 ring-primary/20`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary`}>{text.slice(0, 2).toUpperCase()}</span>;
}
