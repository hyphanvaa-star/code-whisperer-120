import type { Jobs, Routes } from "../types";
import { applyFilters, listDispatchers, loadFlights } from "../core/gantts.server";

// Port of the web.py endpoints for group "core". Keep JSON shapes identical to web.py.
export const routes: Routes = {
  // Web app has real login, so the local passcode gate is always open.
  "GET /api/gate/status": () => ({ unlocked: true, default_password: false, locked: false, fails: 0, max_tries: 5 }),
  "POST /api/gate/lock": () => ({ ok: true, locked: false }),
  "POST /api/gate/unlock": () => ({ ok: true, unlocked: true }),
  "POST /api/gate/enter": () => ({ ok: true, unlocked: true }),
  "GET /api/heartbeat": () => ({ ok: true }),
  "GET /api/tab-close": () => ({ ok: true }),
  "POST /api/tab-close": () => ({ ok: true }),
  "POST /api/quit": () => ({ ok: true }),
  "POST /api/stop": () => ({ ok: true }),
  "GET /api/dispatchers": async ({ params }) => {
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const scoped = applyFilters(flights, params, true);
    return { dispatchers: listDispatchers(scoped), total: scoped.length };
  },
};
export const jobs: Jobs = {};
