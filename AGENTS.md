<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- FliteBrief access lives only in `src/lib/flitebrief.server.ts`; session cookies persist in the service-role-only `fb_session` table so all workers share one login.
- Every server fn / route touching flight data must call `assertDispatcher` — route guards are UX only.
- PDF downloads go through `/api/fb/file` with a bearer token, so external credentials never reach the browser.
- Roles live in `user_roles` (`admin`, `dispatcher`); first signup becomes admin via the `handle_new_user` trigger.
- Port of the original Python tool proceeds endpoint group by group per `roadmap.md`.
- Business logic from the original Python tool is ported to server fns; a PC helper is only for printing/intranet-only sources, because the web runtime cannot run Python or reach company devices.
- The UI is the original web.py PAGE served verbatim from `src/tool/page.html` via `/tool-page` inside an iframe at `/tool`; only the injected shim in `src/routes/tool-page.ts` may alter it, so the screen stays identical to the original tool.
- Every original `/api/*` endpoint is ported into `src/lib/tool/handlers/<group>.server.ts` with web.py's exact JSON shapes; `src/lib/tool/router.server.ts` owns auth (bearer or `fbt` cookie for GET) and returns `{error, not_ported}` for unported routes.
- Background jobs encode kind+params in the job id and run while `/api/stream` streams (`src/lib/tool/jobs.ts`), because workers share no memory.
- Persistent tool state uses `app_settings` keys and files use the private `tool-files` bucket via `src/lib/tool/store.server.ts`, replacing web.py's local `data/` folder.
- Pure ports of Python modules live in `src/lib/tool/port/<module>.ts` with original tests ported to `src/lib/tool/port/__tests__/`.
- PC-only work (RICOH printing, Outlook COM, D:\ drive, folder pickers) runs in the Python helper `pc-agent/pc_agent.py` on the company PC: web enqueues rows in service-role-only `pc_jobs` via `src/lib/tool/pcagent.server.ts`; the helper polls `/api/public/pc-agent/poll` and posts to `/report` with the `PC_AGENT_TOKEN` secret, because a Worker cannot reach LAN devices.
- Server-side Excel reading uses SheetJS (`xlsx` from the SheetJS CDN tarball) because ExcelJS crashes on files with pictures/drawings; ExcelJS stays only for writing, loaded via `src/lib/exceljs-load.ts`.
- Airport country flags are bundled locally and resolved through the generated global ICAO-to-country dataset so flight cards work without third-party image requests.
- The embedded `/tool-page` uses a fresh per-load URL nonce plus explicit no-store headers so header/UI revisions never reuse a stale iframe document.
- Per-user account overrides (FliteBrief/Omni/OWA/Outlook/AviWeb) live encrypted in service-role-only `user_credentials`; code reads logins via `env()` from `src/lib/tool/creds.server.ts` (request-scoped, falls back to team secrets), because each dispatcher may use their own account.
- AIP SUP/DAH rings and hours are fetched in `src/lib/tool/aip_sup.server.ts` (parsers in `port/aip_sup.ts`, cache in app_settings `aip_sup:*`), attached as `notam.sup_geoms` by the Check NOTAM handler, because NOTAM text often only names the SUP area.
