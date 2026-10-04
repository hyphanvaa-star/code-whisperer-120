import { createFileRoute } from "@tanstack/react-router";
import { fbGet } from "@/lib/flitebrief.server";
export const Route = createFileRoute("/zz-debug-notam")({
  server: { handlers: { GET: async ({ request }) => {
    if (!request.headers.get("x-dbg")) return new Response("no", { status: 404 });
    const r = await fbGet("/webapi/icaos/VVTS");
    return new Response(`${r.status} ${r.headers.get("content-type")}\n` + (await r.text()).slice(0, 3000));
  } } },
});
