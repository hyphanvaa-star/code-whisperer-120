/**
 * Background jobs, web edition.
 *
 * web.py starts a thread and returns {id}; the page then opens
 * EventSource('/api/stream?id=...'). Server workers do not share memory, so the
 * id itself carries the job kind + params, and /api/stream runs the job while
 * streaming its messages. Same message shapes as the original queue.
 */
export function jobId(kind: string, params: Record<string, unknown>): string {
  const raw = JSON.stringify({ k: kind, p: params });
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(raw))) : Buffer.from(raw).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseJobId(id: string): { k: string; p: Record<string, unknown> } | null {
  try {
    const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
    const raw = decodeURIComponent(escape(atob(b64)));
    const v = JSON.parse(raw) as { k?: unknown; p?: unknown };
    if (typeof v.k !== "string") return null;
    return { k: v.k, p: (v.p as Record<string, unknown>) ?? {} };
  } catch {
    return null;
  }
}
