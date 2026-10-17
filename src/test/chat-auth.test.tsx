import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWidget } from "@/components/chat/ChatWidget";

const { readAvatars } = vi.hoisted(() => ({ readAvatars: async () => ({}) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => readAvatars }));
vi.mock("@/lib/account.functions", () => ({ getChatAvatars: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve),
        insert: () => query,
      };
      return query;
    },
  },
}));

afterEach(cleanup);

describe("Chat login lifecycle", () => {
  it("becomes available after login without reloading the page", async () => {
    const view = render(<ChatWidget key="signed-out" userId={null} />);
    expect(screen.queryByRole("button", { name: "Chat nội bộ" })).toBeNull();
    await act(async () => { view.rerender(<ChatWidget key="dispatcher" userId="dispatcher" />); });
    expect(screen.getByRole("button", { name: "Chat nội bộ" })).toBeEnabled();
  });

  it("hides chat immediately after logout", async () => {
    const view = render(<ChatWidget key="dispatcher" userId="dispatcher" />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Chat nội bộ" })).toBeEnabled();
    view.rerender(<ChatWidget key="signed-out" userId={null} />);
    expect(screen.queryByRole("button", { name: "Chat nội bộ" })).toBeNull();
  });
});