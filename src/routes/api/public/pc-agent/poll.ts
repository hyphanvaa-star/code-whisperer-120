import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/** Shared-token check for the company-PC helper (reads env at call time). */
function authorized(request: Request): boolean {
  const token = request.headers.get("x-pc-agent-token") ?? "";
  const want = process.env["PC_AGENT_TOKEN"] ?? "";
  if (!token || !want) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/pc-agent/poll")({
  server: {
    handlers: {
      // The agent POSTs its heartbeat (printers, path existence) and gets
      // back pending jobs plus the paths it should check next time.
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const pc = await import("@/lib/tool/pcagent.server");
        const printers = Array.isArray(body["printers"]) ? body["printers"] : [];
        const pathsExist =
          body["paths_exist"] && typeof body["paths_exist"] === "object"
            ? (body["paths_exist"] as Record<string, boolean>)
            : {};
        await pc.recordHeartbeat({
          version: String(body["version"] || ""),
          printers: printers as never,
          paths_exist: pathsExist,
        });
        const jobs = await pc.claimPending(5);
        // Paths the UI cares about, so the agent can report existence.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "tool.paths")
          .maybeSingle();
        const saved = (data?.value as Record<string, string> | null) ?? {};
        return Response.json({ jobs, check_paths: Object.values(saved).filter(Boolean) });
      },
    },
  },
});
