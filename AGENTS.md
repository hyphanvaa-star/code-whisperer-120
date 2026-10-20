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
- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- KHB PLD uses `port/fpl_payload.ts` to match Omni by date/route, never seed or another day; explicit PAY wins to preserve edits.
- FliteBrief access lives only in `src/lib/flitebrief.server.ts`; cookies persist in service-role-only `fb_session` so workers share one login. PDFs download via `/api/fb/file` with a bearer token so external credentials never reach the browser.
- Every server fn / route touching flight data must call `assertDispatcher` — route guards are UX only.
- PC helper pairs by login (`_uid` tag); IP match is only a fallback — office NAT splits IPs.
- Roles live in `user_roles` (`admin`, `dispatcher`); first signup becomes admin via `handle_new_user`.
- Python-tool port proceeds group by group per `roadmap.md`: every original `/api/*` endpoint goes into `src/lib/tool/handlers/<group>.server.ts` with web.py's exact JSON shapes; `src/lib/tool/router.server.ts` owns auth (bearer or `fbt` cookie for GET) and returns `{error, not_ported}` for unported routes. Pure module ports live in `src/lib/tool/port/<module>.ts`, tests in `__tests__/`.
- Original `src/tool/page.html` runs via `/tool-page` iframe at `/tool`; only the `src/routes/tool-page.ts` shim may alter it. ATC uses global CSS tokens and CSS-only empty marks to preserve operational data. The iframe uses a per-load URL nonce plus no-store headers so revisions never reuse a stale document. AFTN book/default-address edits use this shim and the shared two-column editor; cells keep local storage and lookup for TPL compatibility.
- Jobs encode kind+params in id; run via `/api/stream` (`jobs.ts`); no shared memory.
- State: `app_settings`; files: private `tool-files` via `store.server.ts`.
- Mail/upload PDFs share `defect-limits.server.ts`: replace exact old-report rows, preserve manual/edited/LOW EGT rows, return merged limits to the editor.
- PC-only work (RICOH printing, Outlook COM, D:\ drive, folder pickers) runs in the Python helper `pc-agent/pc_agent.py`: web enqueues rows in service-role-only `pc_jobs` via `src/lib/tool/pcagent.server.ts`; the helper polls `/api/public/pc-agent/poll` and posts to `/report` with `PC_AGENT_TOKEN` — a Worker cannot reach LAN devices.
- Server-side Excel reading uses SheetJS (`xlsx` CDN tarball) — ExcelJS crashes on files with pictures/drawings; ExcelJS stays only for writing, via `src/lib/exceljs-load.ts`.
- Airport flags use bundled ICAO-country data; no external requests.
- Per-user account overrides (FliteBrief/Omni/OWA/Outlook/AviWeb) live encrypted in service-role-only `user_credentials`; code reads logins via `env()` from `src/lib/tool/creds.server.ts` (request-scoped, falls back to team secrets) — each dispatcher may use their own login.
- Each publish bumps page.html #appVersion.
- Briefing uses `briefing-data.server.ts` for TAF/defects/pins and `port/briefingPdf.ts` for Unicode three-column Letter PDFs with lossless overflow. Replacement reads actual sector PDFs via `port/briefingPrevious.ts`, preserves cells after fresh sources, and aborts before deletion on parse failure to prevent data loss.
- Omni tokens are cached in service-role-only `omni_session` (via `src/lib/tool/omni_session.server.ts`) and can come from the dispatcher's browser login — Omni rejects token creation from the runtime's IPv6 X-Forwarded-For.
- Normal/EDTO PDFs use shim overlays and template coordinates to preserve cells; EDTO loads its asset pointer. KHB keys flight/date/route/ETD and resets on Crewlist changes; rows can be reused.
- NOTAM pins use `notam.pins:<userId>` to isolate libraries.
- Chat uses `chat_rooms`/`chat_messages`, dispatcher RLS, admin-only delete and 4s polling. Root's single auth subscriber passes identity to user-keyed ChatWidget: show on login, clear on logout/account change.
- Account edits use profiles/claims, not sessionless getUser; avatars: owner-only writes, signed URLs.
- Ver tab crew changes come from diffing the two newest non-VER crewlists (`port/crewlist_diff.ts`) — FPL VER files have no crew column.
