import { createFileRoute } from "@tanstack/react-router";

async function authorized(request: Request): Promise<boolean> {
  const token = request.headers.get("x-pc-agent-token") ?? "";
  const { checkAgentToken } = await import("@/lib/tool/pcagent.server");
  return checkAgentToken(token);
}

export const Route = createFileRoute("/api/public/pc-agent/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "payload không hợp lệ" }, { status: 400 });
        }
        const id = String(body["id"] || "");
        if (!id) return Response.json({ error: "thiếu id" }, { status: 400 });
        const ok = body["ok"] === true;
        const result =
          body["result"] && typeof body["result"] === "object"
            ? (body["result"] as Record<string, unknown>)
            : {};
        const { finishJob } = await import("@/lib/tool/pcagent.server");
        await finishJob(id, ok, result);
        return Response.json({ ok: true });
      },
    },
  },
});
