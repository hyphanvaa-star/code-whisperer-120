import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FplDb } from "./fpl";

/** FPL lookup tables (Sohee TOOL sheet) — dispatcher only, never bundled into the browser. */
export const getFplDb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FplDb> => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const mod = await import("./fpl-db.server");
    return mod.FPL_DB;
  });
