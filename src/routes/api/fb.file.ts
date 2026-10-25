import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const Q = z.object({
  sector: z.coerce.number().int().positive(),
  att: z.coerce.number().int().positive().optional(),
  kind: z.enum(["att", "ofp"]).default("att"),
});

async function authorize(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.split(".").length !== 3) return null;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const sb = createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return null;
  const { assertDispatcher } = await import("@/lib/flights.server");
  try {
    await assertDispatcher(sb, data.user.id);
  } catch {
    return null;
  }
  return data.user.id;
}

export const Route = createFileRoute("/api/fb/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await authorize(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });
        const parsed = Q.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success || (parsed.data.kind === "att" && !parsed.data.att)) {
          return new Response("Bad request", { status: 400 });
        }
        const { sector, att, kind } = parsed.data;
        const path =
          kind === "ofp" ? `/webapi/sectors/${sector}/ofp/0` : `/webapi/sectors/${sector}/attachments/${att}`;
        const { fbGet } = await import("@/lib/flitebrief.server");
        const { logActivity } = await import("@/lib/flights.server");
        try {
          const { loadFlights } = await import("@/lib/tool/core/gantts.server");
          if (!(await loadFlights(3, true)).some(f => f.id === sector)) return new Response("Chuyến ngoài khung −6/+24 giờ hoặc không còn trên FliteBrief", { status: 409 });
          const res = await fbGet(path, "application/pdf,*/*");
          if (!res.ok) return new Response("Không tải được file", { status: res.status === 404 ? 404 : 502 });
          await logActivity(userId, "download", `${kind} ${sector}/${att ?? ""}`);
          return new Response(res.body, {
            headers: {
              "Content-Type": res.headers.get("content-type") ?? "application/pdf",
              "Content-Disposition": res.headers.get("content-disposition") ?? "inline",
              "Cache-Control": "private, no-store",
            },
          });
        } catch (e) {
          console.error(e);
          return new Response("Không kết nối được FliteBrief", { status: 502 });
        }
      },
    },
  },
});
