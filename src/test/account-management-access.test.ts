import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "huydoan-id",
  admin: true,
  original: "huydoan" as string | null,
  profileError: null as { message: string } | null,
  roleError: null as { message: string } | null,
  profileRead: vi.fn(),
  updateUser: vi.fn(),
  privilegedFrom: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = {
    middleware: () => builder,
    inputValidator: () => builder,
    handler: (fn: (arg: unknown) => unknown) => (arg?: { data: unknown }) => fn({
      data: arg?.data,
      context: {
        userId: m.userId,
        supabase: {
          rpc: async () => ({ data: m.admin, error: m.roleError }),
          from: () => ({ select: () => ({ eq: (key: string, id: string) => {
            m.profileRead(key, id);
            return { maybeSingle: async () => ({ data: m.original === null ? null : { original_username: m.original }, error: m.profileError }) };
          } }) }),
        },
      },
    }),
  };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { admin: { updateUserById: m.updateUser } }, from: m.privilegedFrom,
} }));
vi.mock("@/lib/flights.server", () => ({ logActivity: m.log }));

import {
  accountDetails, amIAccountOwner, createAccount, deleteAccount,
  resetAccountPassword, resetPersonalData, updateAccountInfo,
} from "@/lib/admin.functions";

beforeEach(() => {
  vi.clearAllMocks();
  m.userId = "huydoan-id"; m.admin = true; m.original = "huydoan";
  m.profileError = null; m.roleError = null;
  m.updateUser.mockResolvedValue({ error: null });
  m.privilegedFrom.mockReturnValue({ update: () => ({ eq: async () => ({ error: null }) }) });
});

describe("Account Management access", () => {
  it("allows the existing huydoan admin account", async () => {
    expect(await amIAccountOwner()).toEqual({ ok: true });
    expect(m.profileRead).toHaveBeenCalledWith("id", "huydoan-id");
  });
  it("preserves hyphan access", async () => {
    m.userId = "hyphan-id"; m.original = "hyphan";
    expect(await amIAccountOwner()).toEqual({ ok: true });
  });
  it("does not grant access to another admin", async () => {
    m.original = "another-admin";
    expect(await amIAccountOwner()).toEqual({ ok: false });
  });
  it("requires huydoan to retain the server-verified admin role", async () => {
    m.admin = false;
    expect(await amIAccountOwner()).toEqual({ ok: false });
    expect(m.profileRead).not.toHaveBeenCalled();
  });
  it("rejects a missing immutable identity", async () => {
    m.original = null;
    expect(await amIAccountOwner()).toEqual({ ok: false });
  });
  it("fails closed when the identity read fails", async () => {
    m.profileError = { message: "read failed" };
    expect(await amIAccountOwner()).toEqual({ ok: false });
  });
  it("fails closed when the role check fails", async () => {
    m.roleError = { message: "role failed" };
    expect(await amIAccountOwner()).toEqual({ ok: false });
  });
  it("lets huydoan reset an account password through the protected handler", async () => {
    expect(await resetAccountPassword({ data: { userId: "target-id", password: "only-a-test-value" } })).toEqual({ ok: true });
    expect(m.updateUser).toHaveBeenCalledWith("target-id", { password: "only-a-test-value" });
    expect(m.log).toHaveBeenCalledWith("huydoan-id", "reset_password", "target-id");
  });
  it("lets huydoan edit account information through the protected handler", async () => {
    expect(await updateAccountInfo({ data: { userId: "target-id", displayName: "Test dispatcher" } })).toEqual({ ok: true });
    expect(m.privilegedFrom).toHaveBeenCalledWith("profiles");
    expect(m.log).toHaveBeenCalledWith("huydoan-id", "edit_account", "target-id");
  });
  const protectedActions = [
    { name: "create", run: () => createAccount({ data: { username: "test-user", password: "only-a-test-value" } }) },
    { name: "reset password", run: () => resetAccountPassword({ data: { userId: "target-id", password: "only-a-test-value" } }) },
    { name: "delete", run: () => deleteAccount({ data: { userId: "target-id" } }) },
    { name: "edit", run: () => updateAccountInfo({ data: { userId: "target-id", displayName: "Test" } }) },
    { name: "account data", run: () => accountDetails({ data: { userIds: ["target-id"] } }) },
    { name: "reset personal data", run: () => resetPersonalData({ data: { key: "fpl.route@u:00000000-0000-0000-0000-000000000001" } }) },
  ];
  it.each(protectedActions)("blocks other admins from $name", async ({ run }) => {
    m.original = "another-admin";
    await expect(run()).rejects.toThrow();
    expect(m.updateUser).not.toHaveBeenCalled();
    expect(m.privilegedFrom).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });
});