import { createFileRoute } from "@tanstack/react-router";

// Catch-all for the original tool's /api/* calls. Real work lives in
// src/lib/tool/router.server.ts (auth + dispatcher check + handler table).
async function go(request: Request) {
  const { handleToolApi } = await import("@/lib/tool/router.server");
  return handleToolApi(request);
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => go(request),
      POST: ({ request }) => go(request),
    },
  },
});
