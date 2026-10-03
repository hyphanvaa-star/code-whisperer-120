import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Crew, Flight } from "./flight-model";

export const getFlights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ days: z.number().int().min(1).max(4) }).parse(d))
  .handler(async ({ data, context }): Promise<{ flights: Flight[]; fetchedAt: string; error: string | null }> => {
    const { assertDispatcher, toFlight } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { fbJson, FliteBriefError } = await import("./flitebrief.server");
    try {
      let raw = await fbJson<unknown>(`/webapi/gantts?days=${data.days}`);
      if (raw && !Array.isArray(raw) && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        raw = o.sectors ?? o.flights ?? o.data ?? o.results ?? [];
      }
      const list = (Array.isArray(raw) ? raw : [])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map(toFlight)
        .sort((a, b) => (a.std ?? "9").localeCompare(b.std ?? "9") || a.callsign.localeCompare(b.callsign));
      return { flights: list, fetchedAt: new Date().toISOString(), error: null };
    } catch (e) {
      console.error(e);
      return {
        flights: [],
        fetchedAt: new Date().toISOString(),
        error: e instanceof FliteBriefError ? e.message : "Không kết nối được FliteBrief, thử lại sau",
      };
    }
  });

export const getCrews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sectorId: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }): Promise<{ crews: Crew[]; error: string | null }> => {
    const { assertDispatcher, toCrew } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { fbJson } = await import("./flitebrief.server");
    try {
      const raw = await fbJson<unknown>(`/webapi/sectors/${data.sectorId}/crews`);
      const arr = Array.isArray(raw) ? raw : ((raw as { crews?: unknown[] })?.crews ?? []);
      const crews = (arr as Record<string, unknown>[]).map(toCrew).filter((c): c is Crew => !!c);
      crews.sort((a, b) => Number(b.commander) - Number(a.commander) || a.dept.localeCompare(b.dept));
      return { crews, error: null };
    } catch (e) {
      console.error(e);
      return { crews: [], error: "Không tải được danh sách tổ bay" };
    }
  });

export const getMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email, display_name")
      .eq("id", context.userId)
      .maybeSingle();
    const r = (roles ?? []).map((x) => x.role);
    return {
      userId: context.userId,
      email: profile?.email ?? "",
      name: profile?.display_name ?? "",
      isAdmin: r.includes("admin"),
      isDispatcher: r.includes("dispatcher") || r.includes("admin"),
    };
  });
