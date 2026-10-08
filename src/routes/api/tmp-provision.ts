import { createFileRoute } from "@tanstack/react-router";

// One-off provisioning route: creates the two internal ID/PASS accounts, then this file is deleted.
const KEY = "prov-7f3a9c2d";

const ACCOUNTS = [
  { id: "hyphan", password: "Hydeptrai@1", role: "admin" },
  { id: "roise", password: "221098", role: "dispatcher" },
];

export const Route = createFileRoute("/api/tmp-provision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== KEY) return new Response("no", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const out: Array<Record<string, unknown>> = [];

        for (const acc of ACCOUNTS) {
          const email = `${acc.id}@app.local`;
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: acc.password,
            email_confirm: true,
            data: { username: acc.id, full_name: acc.id },
          });
          const row: Record<string, unknown> = {
            id: acc.id,
            email,
            user_id: data?.user?.id ?? null,
            create_error: error?.message ?? null,
          };
          const uid = data?.user?.id;
          if (uid) {
            const roles = acc.role === "admin" ? ["admin", "dispatcher"] : ["dispatcher"];
            for (const role of roles) {
              const { error: re } = await supabaseAdmin
                .from("user_roles")
                .insert({ user_id: uid, role });
              if (re) row[`role_${role}_error`] = re.message;
            }
          }
          out.push(row);
        }
        return Response.json(out);
      },
    },
  },
});
