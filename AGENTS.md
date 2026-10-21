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
- Both Outlook draft and KHB ATC/EZFW use `port/ofp_layout.ts` with the browser-safe `pdf-text-layout.ts` coordinate renderer; keep general weight extraction separate so fixed-width columns survive without changing other OFP parsers.
- KHB ATC/EZFW exports validate both ICAO DOF/REG and PLAN date/route/REG against the uniquely selected in-window Crewlist/FliteBrief sector before queuing PC writes; completion requires the helper's returned file path.
- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- KHB PLD uses `port/fpl_payload.ts` to match Omni by date/route and separate crewlist STD (ETD fallback); nearest schedule must be unique to avoid arbitrary duplicate selection, and explicit PAY wins to preserve edits.
- FliteBrief access lives only in `src/lib/flitebrief.server.ts`; cookies persist in service-role-only `fb_session` so workers share one login. PDFs download via `/api/fb/file` with a bearer token so external credentials never reach the browser.
- Every server fn / route touching flight data must call `assertDispatcher` — route guards are UX only.
- PC helper pairs by login (`_uid` tag); IP match is only a fallback — office NAT splits IPs.
- Roles live in `user_roles` (`admin`, `dispatcher`); first signup becomes admin via `handle_new_user`.
- Port groups follow `roadmap.md`: handlers in `src/lib/tool/handlers/<group>.server.ts` preserve web.py JSON; `router.server.ts` owns bearer/GET-cookie auth and `{error, not_ported}`. Pure ports and tests live in `port/` and `port/__tests__/`.
- KHB labels/REQ share browser-safe `khb-pilot-name` via the HTML shim and FPL port; preserve full source names for identity matching.
- Original `src/tool/page.html` runs via `/tool-page` iframe at `/tool`; only the `src/routes/tool-page.ts` shim may alter it. ATC uses global CSS tokens and CSS-only empty marks to preserve operational data. The iframe uses a per-load URL nonce plus no-store headers so revisions never reuse a stale document. AFTN book/default-address edits use this shim and the shared two-column editor; cells keep local storage and lookup for TPL compatibility.
- Jobs encode kind+params in id; run via `/api/stream` (`jobs.ts`); no shared memory.
- State: `app_settings`; files: private `tool-files` via `store.server.ts`.
- PIB/WX attachment validation is centralized in `port/pibwx_time.ts` and receives only first-page text plus document kind, so body timestamps cannot authorize a stale file.
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
- Team config tables (notice rules, KHB CI/taxi/route/alt/era/PCR) are two-tier via `LAYERED_KEYS` in `src/lib/tool/store.server.ts`: admin writes the team key, others write `<key>@u:<uid>` — so one dispatcher edit never changes others.
- Special limits are structured rows (`rule`/`acs`/`apts`) evaluated by browser-safe `src/lib/special-rules.js`, shared by the tool page (via shim) and `limits_check.ts`; aircraft groups live in admin-only `limits.acgroups` so one rule set is interpreted identically everywhere. Legacy free-text rows keep the old parser.
