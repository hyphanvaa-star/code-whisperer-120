import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KEYS = z.enum(["notice_rules"]);

export const getSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: KEYS }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("app_settings").select("value, updated_at").eq("key", data.key).maybeSingle();
    if (error) throw new Error(error.message);
    return { value: (row?.value ?? null) as unknown, updatedAt: row?.updated_at ?? null };
  });

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  condition: z.enum(["always", "has_reg", "dep", "dest", "touches", "route", "ac_type", "reg_in", "prefix_or_touches", "touches_or_alt"]),
  values: z.array(z.string().trim().max(20)).max(200),
  files: z.array(z.string().trim().min(1).max(300)).max(30),
  enabled: z.boolean(),
  effective_from: z.string().max(10).optional(),
  effective_to: z.string().max(10).optional(),
});

export const saveNoticeRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rules: z.array(ruleSchema).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertDispatcher, logActivity } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { error } = await context.supabase.from("app_settings").upsert({
      key: "notice_rules", value: data.rules, updated_by: context.userId, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    await logActivity(context.supabase, context.userId, "notice_rules.save", { count: data.rules.length });
    return { ok: true };
  });
