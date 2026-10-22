import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { shouldDelete } from "@/lib/tool/port/file_retention";

export const Route = createFileRoute("/api/public/cron/cleanup-files")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const bucket = supabaseAdmin.storage.from("tool-files");
        const now = Date.now();
        const doomed: string[] = [];
        const walk = async (dir: string, depth: number) => {
          for (let off = 0; ; off += 1000) {
            const { data } = await bucket.list(dir, { limit: 1000, offset: off });
            if (!data?.length) break;
            for (const f of data) {
              const p = dir ? `${dir}/${f.name}` : f.name;
              if (!f.id) { if (depth < 5) await walk(p, depth + 1); continue; }
              const t = Date.parse(f.updated_at || f.created_at || "");
              if (Number.isFinite(t) && shouldDelete(p, t, now)) doomed.push(p);
            }
            if (data.length < 1000) break;
          }
        };
        for (const top of ["excel", "atc", "merged", "briefing", "regnotice", "notices-tmp"]) await walk(top, 1);
        for (let i = 0; i < doomed.length; i += 100) await bucket.remove(doomed.slice(i, i + 100));
        return Response.json({ deleted: doomed.length });
      },
    },
  },
});
