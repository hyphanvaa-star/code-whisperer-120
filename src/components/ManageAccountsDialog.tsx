import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createAccount, deleteAccount, listUsers, resetAccountPassword, setRole } from "@/lib/admin.functions";
import { passwordChecks } from "@/lib/password-rules";

const inp = "w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

export function ManageAccountsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsers);
  const createFn = useServerFn(createAccount);
  const resetFn = useServerFn(resetAccountPassword);
  const delFn = useServerFn(deleteAccount);
  const roleFn = useServerFn(setRole);
  const users = useQuery({ queryKey: ["users"], queryFn: () => usersFn() });
  const [u, setU] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const checks = passwordChecks(pw, u);
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, t: ok }); refresh(); return true; }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "Lỗi" }); return false; }
    finally { setBusy(false); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) return setMsg({ ok: false, t: "Mật khẩu chưa đạt: " + bad.map((b) => b.label.toLowerCase()).join(", ") });
    if (await run(() => createFn({ data: { username: u.trim(), password: pw, displayName: name, admin } }), `Đã tạo tài khoản ${u.trim().toLowerCase()}`)) { setU(""); setName(""); setPw(""); setAdmin(false); }
  };
  const reset = (id: string, login: string) => {
    const p = window.prompt(`Mật khẩu mới cho ${login}:`);
    if (!p) return;
    const bad = passwordChecks(p, login).filter((c) => !c.ok);
    if (bad.length) return setMsg({ ok: false, t: "Mật khẩu chưa đạt: " + bad.map((b) => b.label.toLowerCase()).join(", ") });
    void run(() => resetFn({ data: { userId: id, password: p } }), `Đã đổi mật khẩu cho ${login}`);
  };
  const remove = (id: string, login: string) => {
    if (!window.confirm(`Xóa hẳn tài khoản ${login}? Không khôi phục được.`)) return;
    void run(() => delFn({ data: { userId: id } }), `Đã xóa ${login}`);
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-y-auto rounded-2xl p-0">
        <div className="bg-header px-5 py-4 text-primary-foreground">
          <DialogTitle className="text-lg font-bold">Quản lý tài khoản</DialogTitle>
          <p className="text-xs opacity-85">Tạo tài khoản mới, đổi mật khẩu, cấp quyền hoặc xóa</p>
        </div>
        <form onSubmit={create} className="space-y-3 border-b border-border p-5">
          <p className="text-sm font-bold text-primary">Tạo tài khoản mới</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={inp} placeholder="ID đăng nhập (vd: nguyenvana)" value={u} onChange={(e) => setU(e.target.value)} required />
            <input className={inp} placeholder="Tên hiển thị (không bắt buộc)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inp} type="text" autoComplete="new-password" placeholder="Mật khẩu" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />Cho quyền quản trị</label>
          </div>
          <ul className="grid grid-cols-2 gap-1 text-xs">
            {checks.map((c) => <li key={c.label} className={c.ok ? "text-primary font-medium" : "text-muted-foreground"}>{c.ok ? "✓" : "○"} {c.label}</li>)}
          </ul>
          <p className="text-[11px] text-muted-foreground">Hệ thống còn tự chặn mật khẩu đã bị lộ hoặc quá dễ đoán.</p>
          <Button disabled={busy}>{busy ? "Đang xử lý…" : "Tạo tài khoản"}</Button>
          {msg && <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{msg.t}</p>}
        </form>
        <div className="p-5">
          <p className="mb-2 text-sm font-bold text-primary">Tài khoản hiện có</p>
          {users.isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
          <ul className="divide-y divide-border">
            {users.data?.map((x) => {
              const login = x.email.split("@")[0];
              const isAdm = x.roles.includes("admin");
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <div className="min-w-40 flex-1"><b>{login}</b> {x.name && x.name !== login && <span className="text-muted-foreground">· {x.name}</span>}
                    <div className="text-xs text-muted-foreground">{isAdm ? "Quản trị" : x.roles.includes("dispatcher") ? "Dispatcher" : "Chưa có quyền"}</div></div>
                  {!x.isSelf && <>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => roleFn({ data: { userId: x.id, role: "admin", grant: !isAdm } }), "Đã cập nhật quyền")}>{isAdm ? "Bỏ quản trị" : "Cho quản trị"}</Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => reset(x.id, login)}>Đổi mật khẩu</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(x.id, login)}>Xóa</Button>
                  </>}
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
