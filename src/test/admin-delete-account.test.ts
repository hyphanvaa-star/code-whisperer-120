import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "owner-id", admin: true, owner: "hyphan",
  deleteUser: vi.fn(), from: vi.fn(), roleEq: vi.fn(), profileEq: vi.fn(), log: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: () => builder, inputValidator: () => builder,
    handler: (fn: (arg: unknown) => unknown) => (arg: { data: unknown }) => fn({
      data: arg.data, context: { userId: m.userId, supabase: {
        rpc: async () => ({ data: m.admin }),
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { original_username: m.owner } }) }) }) }),
      } },
    }) };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: m.from, auth: { admin: { deleteUser: m.deleteUser } },
} }));
vi.mock("@/lib/flights.server", () => ({ logActivity: m.log }));
import { deleteAccount } from "@/lib/admin.functions";

beforeEach(() => {
  vi.clearAllMocks(); m.userId = "owner-id"; m.admin = true; m.owner = "hyphan";
  m.deleteUser.mockResolvedValue({ error: null });
  m.roleEq.mockResolvedValue({ error: null }); m.profileEq.mockResolvedValue({ error: null });
  m.from.mockImplementation((table: string) => ({ delete: () => ({ eq: table === "user_roles" ? m.roleEq : m.profileEq }) }));
});
describe("Account deletion", () => {
  it("removes a leftover profile when Auth confirms user_not_found", async () => {
    m.deleteUser.mockResolvedValue({ error: { code: "user_not_found", status: 404, message: "User not found" } });
    expect(await deleteAccount({ data: { userId: "orphan-id" } })).toEqual({ ok: true });
    expect(m.roleEq).toHaveBeenCalledWith("user_id", "orphan-id");
    expect(m.profileEq).toHaveBeenCalledWith("id", "orphan-id");
    expect(m.log).toHaveBeenCalledWith("owner-id", "delete_account", "orphan-id");
  });
  it("also cleans up after successful Auth deletion", async () => {
    await deleteAccount({ data: { userId: "target-id" } });
    expect(m.deleteUser).toHaveBeenCalledWith("target-id");
    expect(m.profileEq).toHaveBeenCalledWith("id", "target-id");
  });
  it("does not clean up on an unrelated Auth failure", async () => {
    m.deleteUser.mockResolvedValue({ error: { status: 500, message: "User not found" } });
    await expect(deleteAccount({ data: { userId: "target-id" } })).rejects.toThrow("User not found");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("does not report success if profile cleanup fails", async () => {
    m.profileEq.mockResolvedValue({ error: { message: "failure" } });
    await expect(deleteAccount({ data: { userId: "target-id" } })).rejects.toThrow("chưa xóa được hồ sơ");
    expect(m.log).not.toHaveBeenCalled();
  });
  it("rejects non-admin callers before privileged deletion", async () => {
    m.admin = false;
    await expect(deleteAccount({ data: { userId: "target-id" } })).rejects.toThrow("Chỉ quản trị viên");
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
  it("rejects admins other than the account owner", async () => {
    m.owner = "another-admin";
    await expect(deleteAccount({ data: { userId: "target-id" } })).rejects.toThrow("Chỉ hyphan");
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
  it("prevents deleting the caller's own account", async () => {
    await expect(deleteAccount({ data: { userId: "owner-id" } })).rejects.toThrow("Không thể tự xóa");
    expect(m.deleteUser).not.toHaveBeenCalled();
  });
});