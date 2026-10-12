import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  context: { userId: "owner-id", claims: { email: "old@app.local" }, supabase: { from: vi.fn() } },
  single: vi.fn(), updateEq: vi.fn(), signIn: vi.fn(), authUpdate: vi.fn(), upload: vi.fn(), remove: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: () => builder, inputValidator: () => builder,
    handler: (fn: (arg: unknown) => unknown) => (arg: { data?: unknown } = {}) => fn({ data: arg.data, context: m.context }) };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: m.signIn } }) }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), update: () => ({ eq: m.updateEq }) }),
  auth: { admin: { updateUserById: m.authUpdate } },
  storage: { from: () => ({ upload: m.upload, remove: m.remove }) },
} }));
vi.mock("@/lib/flights.server", () => ({ logActivity: vi.fn(), assertDispatcher: vi.fn() }));
import { saveMyAvatar, updateMyAccount } from "@/lib/account.functions";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_URL = "https://example.invalid";
  m.context.supabase.from.mockReturnValue({ select: () => ({ eq: () => ({ single: m.single }) }) });
  m.single.mockResolvedValue({ data: { email: "current@app.local", avatar_path: null }, error: null });
  m.signIn.mockResolvedValue({ error: null });
  m.authUpdate.mockResolvedValue({ error: null });
  m.updateEq.mockResolvedValue({ error: null });
  m.upload.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
});
describe("Self-service account changes", () => {
  it("uses current profile email without a persisted Auth session", async () => {
    const result = await updateMyAccount({ data: { currentPassword: "test-current", displayName: "New name" } });
    expect(result.ok).toBe(true);
    expect(m.signIn).toHaveBeenCalledWith({ email: "current@app.local", password: "test-current" });
    expect(m.updateEq).toHaveBeenCalledWith("id", "owner-id");
  });
  it("blocks incorrect current password before privileged writes", async () => {
    m.signIn.mockResolvedValue({ error: { message: "invalid" } });
    await expect(updateMyAccount({ data: { currentPassword: "bad", newPassword: "test-new" } })).rejects.toThrow("Mật khẩu hiện tại không đúng");
    expect(m.authUpdate).not.toHaveBeenCalled();
  });
  it("renames and changes password only for the authenticated owner", async () => {
    await updateMyAccount({ data: { currentPassword: "test-current", username: "newlogin", newPassword: "test-new" } });
    expect(m.authUpdate).toHaveBeenCalledWith("owner-id", { email: "newlogin@app.local", email_confirm: true, password: "test-new" });
  });
  it("rejects non-image avatar bytes", async () => {
    await expect(saveMyAvatar({ data: { image: "data:image/jpeg;base64,aGVsbG8=" } })).rejects.toThrow("Ảnh JPEG");
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("saves an avatar under the authenticated owner's folder", async () => {
    await saveMyAvatar({ data: { image: "data:image/jpeg;base64,/9j/2Q==" } });
    expect(m.upload.mock.calls[0][0]).toMatch(/^owner-id\/.+\.jpg$/);
    expect(m.updateEq).toHaveBeenCalledWith("id", "owner-id");
  });
});