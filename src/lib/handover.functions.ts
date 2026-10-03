import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const s = (max: number) => z.string().trim().max(max);
export const handoverRow = z.object({
  key: s(80),
  callsign: s(20),
  dep: s(8),
  arr: s(8),
  ac: s(12),
  std: s(20),
  sta: s(20),
  payload: s(20),
  extra: s(20),
  atc: z.boolean(),
  ezfw: z.boolean(),
  atfm: z.boolean(),
  note: s(500),
});
export type HandoverRow = z.infer<typeof handoverRow>;

const ident = z.object({
  shift: z.enum(["MORNING SHIFT", "NIGHT SHIFT"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromDsp: s(80),
});

export const getHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ident.parse(d))
  .handler(async ({ data, context }) => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("handovers")
      .select("to_dsp, flights, updated_at")
      .eq("shift", data.shift)
      .eq("shift_date", data.date)
      .eq("from_dsp", data.fromDsp)
      .maybeSingle();
    if (error) throw new Error("Không đọc được bảng giao ca");
    if (!row) return null;
    const parsed = z.array(handoverRow).safeParse(row.flights);
    return { toDsp: row.to_dsp, flights: parsed.success ? parsed.data : [], updatedAt: row.updated_at };
  });

export const saveHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ident.extend({ toDsp: s(80), flights: z.array(handoverRow).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { assertDispatcher, logActivity } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { error } = await context.supabase.from("handovers").upsert(
      {
        shift: data.shift,
        shift_date: data.date,
        from_dsp: data.fromDsp,
        to_dsp: data.toDsp,
        flights: data.flights,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shift,shift_date,from_dsp" },
    );
    if (error) throw new Error("Lưu bảng giao ca thất bại");
    await logActivity(context.userId, "handover.save", `${data.shift} ${data.date} ${data.fromDsp} (${data.flights.length})`);
    return { ok: true, savedAt: new Date().toISOString() };
  });
