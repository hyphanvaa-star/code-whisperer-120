import { createFileRoute } from "@tanstack/react-router";

async function authorized(request: Request): Promise<boolean> {
  const token = request.headers.get("x-pc-agent-token") ?? "";
  const { checkAgentToken } = await import("@/lib/tool/pcagent.server");
  return checkAgentToken(token);
}

export const Route = createFileRoute("/api/public/pc-agent/poll")({
  server: {
    handlers: {
      // The agent POSTs its heartbeat (printers, path existence) and gets
      // back pending jobs plus the paths it should check next time.
      POST: async ({ request }) => {
        if (!(await authorized(request))) return new Response("Unauthorized", { status: 401 });
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const pc = await import("@/lib/tool/pcagent.server");
        if (typeof body["status_of"] === "string") {
          return Response.json({ status: await pc.jobStatus(body["status_of"] as string) });
        }
        if (typeof body["progress_of"] === "string") {
          const lines = Array.isArray(body["lines"]) ? (body["lines"] as Array<{ text?: string; cls?: string }>) : [];
          await pc.appendProgress(body["progress_of"] as string, lines.slice(0, 500));
          return Response.json({ status: await pc.jobStatus(body["progress_of"] as string) });
        }
        const printers = Array.isArray(body["printers"]) ? body["printers"] : [];
        const pathsExist =
          body["paths_exist"] && typeof body["paths_exist"] === "object"
            ? (body["paths_exist"] as Record<string, boolean>)
            : {};
        const { requestIp } = await import("@/lib/tool/creds.server");
        const ip = requestIp(request);
        const login = String(body["user"] || request.headers.get("x-pc-agent-user") || "");
        const paired = typeof body["pair"] === "string" ? await pc.verifyPairToken(body["pair"] as string) : "";
        const uid = paired || (login ? await pc.resolveAgentUser(login) : "");
        await pc.recordHeartbeat({
          version: String(body["version"] || ""),
          printers: printers as never,
          paths_exist: pathsExist,
        }, ip, uid, body["offline"] === true);
        if (body["offline"] === true) return Response.json({ jobs: [], paired: !!uid, check_paths: [] });
        const jobs = await pc.claimPending(10, ip, printers, uid);
        // Paths the UI cares about, so the agent can report existence.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "tool.paths")
          .maybeSingle();
        const saved = (data?.value as Record<string, string> | null) ?? {};
        return Response.json({ jobs, paired: !!uid, check_paths: Object.values(saved).filter(Boolean) });
      },
    },
  },
});
