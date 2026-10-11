import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell, useMe } from "@/components/AppShell";
import { listActivity, listUsers, setRole } from "@/lib/admin.functions";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Quản trị người dùng — Dispatch Board" },
      { name: "description", content: "Cấp quyền dispatcher và xem nhật ký hoạt động." },
      { property: "og:title", content: "Quản trị — Dispatch Board" },
      { property: "og:description", content: "Cấp quyền dispatcher và xem nhật ký hoạt động." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <AdminShell>
      <Admin />
    </AdminShell>
  ),
});

function Admin() {
  const me = useMe();
  const usersFn = useServerFn(listUsers);
  const logFn = useServerFn(listActivity);
  const roleFn = useServerFn(setRole);
  const qc = useQueryClient();
  const isAdmin = !!me.data?.isAdmin;
  const users = useQuery({ queryKey: ["users"], queryFn: () => usersFn(), enabled: isAdmin });
  const log = useQuery({ queryKey: ["activity"], queryFn: () => logFn(), enabled: isAdmin });

  if (!isAdmin) return <div className="p-8 text-sm text-muted-foreground">Chỉ quản trị viên được vào trang này.</div>;

  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.email ?? id.slice(0, 8);

  async function toggle(userId: string, role: "admin" | "dispatcher", grant: boolean) {
    try {
      await roleFn({ data: { userId, role, grant } });
      toast.success(grant ? "Đã cấp quyền" : "Đã gỡ quyền");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 font-semibold">Người dùng</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2">Tài khoản</th>
                <th className="px-3 py-2">Dispatcher</th>
                <th className="px-3 py-2">Quản trị</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-5 py-2.5">
                    <div className="text-foreground">{u.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {u.original && u.original !== u.email.split("@")[0] && (<div className="text-xs text-muted-foreground">Tài khoản gốc: {u.original}</div>)}
                  </td>
                  <td className="px-3">
                    <Switch
                      checked={u.roles.includes("dispatcher")}
                      onCheckedChange={(v) => toggle(u.id, "dispatcher", v)}
                    />
                  </td>
                  <td className="px-3">
                    <Switch
                      checked={u.roles.includes("admin")}
                      disabled={u.isSelf}
                      onCheckedChange={(v) => toggle(u.id, "admin", v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.isLoading && <div className="p-5 text-sm text-muted-foreground">Đang tải…</div>}
        </section>
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-5 py-3 font-semibold">Nhật ký hoạt động</h2>
          <ul className="max-h-[70vh] divide-y divide-border overflow-auto">
            {log.data?.map((l) => (
              <li key={l.id} className="px-5 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-foreground">{nameOf(l.user_id)}</span>
                  <span className="font-mono text-muted-foreground">{new Date(l.created_at).toLocaleString("vi-VN")}</span>
                </div>
                <div className="text-muted-foreground">
                  {l.action} {l.detail}
                </div>
              </li>
            ))}
            {log.data?.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">Chưa có hoạt động.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
