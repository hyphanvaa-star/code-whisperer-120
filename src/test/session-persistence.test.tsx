import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, getSession, getUser, signOut, signInWithPassword } = vi.hoisted(() => ({
  navigate: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  createFileRoute: () => (options: unknown) => options,
  Outlet: () => null,
  redirect: (options: unknown) => options,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, getUser, signOut, signInWithPassword } },
}));

import { AuthScreen } from "@/components/AuthScreen";
import { Route } from "@/routes/_authenticated/route";

// The router mock returns options directly so the actual gate runs in isolation.
const gate = Route as unknown as { beforeLoad: () => Promise<unknown> };

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("Saved login across tabs", () => {
  it("opens a new tab without a tab flag and keeps the valid user signed in", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "dispatcher" } } } });
    getUser.mockResolvedValue({ data: { user: { id: "dispatcher" } }, error: null });
    await expect(gate.beforeLoad()).resolves.toEqual({ user: { id: "dispatcher" } });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns to the board when the login page opens with a saved session", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "dispatcher" } } } });
    await act(async () => { render(<AuthScreen />); });
    expect(navigate).toHaveBeenCalledWith({ to: "/tool", replace: true });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps the login page open after an explicit logout cleared the session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await act(async () => { render(<AuthScreen />); });
    expect(navigate).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("still blocks protected pages when the saved session is invalid", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Expired session" } });
    await expect(gate.beforeLoad()).rejects.toEqual({ to: "/auth" });
  });
});