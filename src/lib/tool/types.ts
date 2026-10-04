import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Request context handed to every ported web.py endpoint. */
export type Ctx = {
  request: Request;
  url: URL;
  /** Query string, like web.py `params` (use q() for first value). */
  params: URLSearchParams;
  /** Path such as "/api/flights". */
  route: string;
  userId: string;
  /** Supabase client acting as the signed-in user (RLS applies). */
  supabase: SupabaseClient<Database>;
  /** Parsed JSON body (POST); {} when empty or not JSON. */
  json: () => Promise<Record<string, unknown>>;
};

/** Return a Response, or any JSON-able value (sent like web.py `self._json`). */
export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

/** Keys look like "GET /api/flights" or "POST /api/limits". A key ending in "*" matches a prefix. */
export type Routes = Record<string, Handler>;

/** Messages pushed to the page's EventSource exactly like web.py job queues
 *  ({type:"line", text}, {type:"progress", ...}, {type:"end", code, elapsed, ...}). */
export type Emit = (msg: Record<string, unknown>) => void;

export type JobFn = (params: Record<string, unknown>, emit: Emit, ctx: Ctx) => Promise<void>;

export type Jobs = Record<string, JobFn>;

export const q = (p: URLSearchParams, k: string, dflt = "") => p.get(k) ?? dflt;
