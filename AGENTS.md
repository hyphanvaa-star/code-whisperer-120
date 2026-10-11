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
- FliteBrief access lives only in `src/lib/flitebrief.server.ts`; cookies persist in service-role-only `fb_session` so workers share one login. PDFs download via `/api/fb/file` with a bearer token so external credentials never reach the browser.
- Every server fn / route touching flight data must call `assertDispatcher` — route guards are UX only.
- Roles live in `user_roles` (`admin`, `dispatcher`); first signup becomes admin via the `handle_new_user` trigger.
- Python-tool port proceeds endpoint group by group per `roadmap.md`: every original `/api/*` endpoint goes into `src/lib/tool/handlers/<group>.server.ts` with web.py's exact JSON shapes; `src/lib/tool/router.server.ts` owns auth (bearer or `fbt` cookie for GET) and returns `{error, not_ported}` for unported routes. Pure module ports live in `src/lib/tool/port/<module>.ts` with tests in `__tests__/`.
- Original `src/tool/page.html` runs via `/tool-page` iframe at `/tool`; only the `src/routes/tool-page.ts` shim may alter it. ATC uses global CSS tokens and CSS-only empty marks to preserve operational data. The iframe uses a per-load URL nonce plus no-store headers so revisions never reuse a stale document. AFTN book/default-address edits use this shim and the shared two-column editor; cells keep local text storage and lookup for TPL compatibility.
- Background jobs encode kind+params in the job id and run while `/api/stream` streams (`src/lib/tool/jobs.ts`), because workers share no memory.
- Persistent tool state uses `app_settings` keys and files use the private `tool-files` bucket via `src/lib/tool/store.server.ts`, replacing web.py's local `data/` folder.
- NOTAM summaries use per-flight `verdictOf`/`fleetVerdict` in `port/notam_verdict.ts`, not raw map hit counts (those include distant/unresolved/above-ceiling areas). Every FliteBrief NOTAM tracking/fleet place is filtered through `apply24h` before enrichment and counting — the upstream ICAO payload is ALL, not the portal's 24H selection.
- PC-only work (RICOH printing, Outlook COM, D:\ drive, folder pickers) runs in the Python helper `pc-agent/pc_agent.py`: web enqueues rows in service-role-only `pc_jobs` via `src/lib/tool/pcagent.server.ts`; the helper polls `/api/public/pc-agent/poll` and posts to `/report` with the `PC_AGENT_TOKEN` secret — a Worker cannot reach LAN devices.
- Server-side Excel reading uses SheetJS (`xlsx` from the SheetJS CDN tarball) because ExcelJS crashes on files with pictures/drawings; ExcelJS stays only for writing, loaded via `src/lib/exceljs-load.ts`.
- Airport country flags are bundled locally via the generated global ICAO-to-country dataset so flight cards need no third-party image requests.
- Per-user account overrides (FliteBrief/Omni/OWA/Outlook/AviWeb) live encrypted in service-role-only `user_credentials`; code reads logins via `env()` from `src/lib/tool/creds.server.ts` (request-scoped, falls back to team secrets) — each dispatcher may use their own account.
- AIP SUP/DAH rings/hours are fetched in `src/lib/tool/aip_sup.server.ts` (parsers in `port/aip_sup.ts`, cache in app_settings `aip_sup:*`), attached as `notam.sup_geoms` by the Check NOTAM handler — NOTAM text often only names the SUP area. JP ENR/KR KOCA use national parsers and country caches; client fixes preserve server arcs and separate areas.
- Every publish bumps the version badge #appVersion in src/tool/page.html (V1, V2, …) so users can tell builds apart.
- All briefing generation paths use `src/lib/tool/briefing-data.server.ts` for cached TAF, defects and pinned NOTAMs, so draft/export/aircraft replacement cannot silently omit a source. Briefing PDFs use `src/lib/tool/port/briefingPdf.ts` (original three-column Letter layout, embedded fonts); overflow continues rather than truncating operational text.
- Omni tokens are cached in service-role-only `omni_session` (via `src/lib/tool/omni_session.server.ts`) and can be supplied by the dispatcher's browser login, because Omni rejects token creation from the cloud runtime's IPv6 X-Forwarded-For.
- Named ENR 5.1 areas (WS/WM/WB/VV/VT/VI/RK…) resolve first from the bundled snapshot `src/lib/tool/data/aip_enr_rings.json` via `port/aip_enr_catalog.ts`; tracking ATS routes use bundled `ats_routes.json` via `/api/notam/vnchart` — live national AIP fetches are slow/unreliable inside a request.
- KHB keys flight/date/route/ETD and resets on Crewlist changes; rows can be reused.
- Normal/EDTO PDFs use shim overlays and template coordinates to preserve cells; EDTO loads its asset pointer.
- Team chat (group + 1-1) lives in `chat_rooms`/`chat_messages` with dispatcher-scoped RLS and admin-only delete; floating UI is `src/components/chat/ChatWidget.tsx` in `__root`, polling every 4s instead of Realtime to avoid publication config.
