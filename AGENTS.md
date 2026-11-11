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
- Login uses scoped sakura CSS and password sign-in; disable unconfigured alternatives. Preserve sessions across tabs but drop them after a browser restart via the session-cookie marker in `src/lib/browser-session.ts`; the managed gate validates users, and explicit sign-out clears sessions to avoid cross-tab logout.
- Compare handover scope is browser-local via the `cmp_validation` shim: broaden only the Compare read (crew reads drop the DSP filter only for out-of-scope IDs), dedupe by sector/DSP, resolve actions via the live catalogue; never change the primary filter or other tabs.
- Compare actions stay in `cmp_validation`/`cmp_sync`: REG FPL prefers Excel revisions; BF/CHG/REG/CREW/REQ actions accept Crewlist-version diffs or the live loaded-Crewlist vs FliteBrief mismatch (`cmpLiveChange`), on unique in-window sectors. CFP REQ reuses `vReqCell`/chgreq, and acknowledges successful downloads by user/sector/change so failures and later changes remain visible.
- Compare source borders use browser-safe `cmp_sync`: FPL pairs use `cmpFplPair` for same-date numeric VER order, Crewlist order stays intact; keep fresh sector checks, swap confirmations and row picking; attachment completion never proves an aircraft/OFP update.
- Compare cell fills repaint only their sector and sync-check batches repaint only touched rows; index rows per result array to avoid full-table work per row.
- Editable Compare notes are browser-local and keyed by user plus sector identity; background redraws retain edits without sharing notes across users or flight dates.
- Compare ATC status reuses the authenticated ATC check job with explicit sector/date/route, validates returned DOF, and caches only by full sector identity to prevent stale-day status reuse.
- Compare callsign phase badges reuse the existing OpsCore OOOI renderer and flight refresh; repaint badges in place to preserve editable notes.
- Operational catalogue reads are always clipped to −6/+24 hours at read time; ATC selection uses `port/operational_flight.ts` for unique sector/date/route matching and validates source DOF before using OFP or AviWeb EOBT, so missing identity never falls back to yesterday.
- Both Outlook draft and KHB ATC/EZFW use `port/ofp_layout.ts` with the browser-safe `pdf-text-layout.ts` coordinate renderer; keep general weight extraction separate so fixed-width columns survive without changing other OFP parsers.
- KHB ATC/EZFW exports validate both ICAO DOF/REG and PLAN date/route/REG against the uniquely selected in-window Crewlist/FliteBrief sector before queuing PC writes; completion requires the helper's returned file path.
- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- KHB PLD uses `port/fpl_payload.ts` to match Omni by date/route and separate crewlist STD (ETD fallback); nearest schedule must be unique to avoid arbitrary duplicate selection, and explicit PAY wins to preserve edits.
- KHB Validation/PLD presentation is patched through `port/khb_payload.ts`; Validation consumes the live Compare verdicts and missing states without duplicating its thresholds. Keep OFP weights and raw Omni EST separate, and match a unique in-window sector by flight/UTC date (computed from local ETD + ETD UTC)/route/REG before reading weights so Crewlist row IDs never address another sector. Validation matches without REG to expose mismatches; explicit EST downloads use existing endpoints in raw mode to avoid independent rounding rules.
- FliteBrief access lives only in `src/lib/flitebrief.server.ts`; cookies persist in service-role-only `fb_session` so workers share one login. PDFs download via `/api/fb/file` with a bearer token so external credentials never reach the browser.
- Every server fn / route touching flight data must call `assertDispatcher` — route guards are UX only.
- PC helper pairs by login (`_uid` tag); IP match is only a fallback — office NAT splits IPs.
- PC helper tool discovery prefers bundled `app/tool` and accepts both source `.py` and sourceless `.pyc` for required modules; discovery errors stay noninteractive so background retries cannot open folder prompts.
- PC helper hidden startup uses `pc-agent/background.py` via pythonw/VBS with a Windows-session mutex and stop event; the ZIP keeps only launchers at root and code under `app/`, which `cai-tro-ly.bat` compiles to sourceless .pyc and hides on the user PC (bytecode must match their Python). Header AGENT dot polls `GET /api/pc/status` (heartbeat <90s). Repackage `public/agent/tro-ly-pc.zip` from an explicit source allowlist whenever helper files change.
- Roles live in `user_roles` (`admin`, `dispatcher`); first signup becomes admin via `handle_new_user`.
- Port groups follow `roadmap.md`: handlers in `src/lib/tool/handlers/<group>.server.ts` preserve web.py JSON; `router.server.ts` owns bearer/GET-cookie auth and `{error, not_ported}`. Pure ports and tests live in `port/` and `port/__tests__/`.
- KHB labels/REQ share browser-safe `khb-pilot-name` via the HTML shim and FPL port; preserve full source names for identity matching.
- Patch original `src/tool/page.html` only through `/tool-page`; preserve nonce/no-store caching. ATC stays above hover panels with Send/Copy intact. Hidden tips leave hit-testing; General TAF binds the whole cell and reads current flight data. AFTN keeps the shared editor, storage and TPL lookup.
- Jobs encode kind+params in id; run via `/api/stream` (`jobs.ts`); no shared memory.
- State: `app_settings`; files: private `tool-files` via `store.server.ts`.
- PIB/WX attachment validation is centralized in `port/pibwx_time.ts` and receives only first-page text plus document kind, so body timestamps cannot authorize a stale file.
- Defect PDFs share `defect-limits.server.ts`: persist summary/manual ownership, replace summary rows, preserve manual/LOW EGT; edits become manual via tool-page shim.
- PC-only work (RICOH printing, Outlook COM, D:\ drive, folder pickers) runs in the Python helper `pc-agent/pc_agent.py`: web enqueues rows in service-role-only `pc_jobs` via `src/lib/tool/pcagent.server.ts`; the helper polls `/api/public/pc-agent/poll` and posts to `/report` with `PC_AGENT_TOKEN` — a Worker cannot reach LAN devices.
- Server-side Excel reading uses SheetJS (`xlsx` CDN tarball) — ExcelJS crashes on files with pictures/drawings; ExcelJS stays only for writing, via `src/lib/exceljs-load.ts`.
- Airport flags use bundled ICAO-country data, no requests.
- Per-user account overrides (FliteBrief/Omni/OWA/Outlook/AviWeb) live encrypted in service-role-only `user_credentials`; code reads logins via `env()` from `src/lib/tool/creds.server.ts` (request-scoped, falls back to team secrets) — each dispatcher may use their own login.
- Account dialog metadata is remembered through the HTML shim in a user-ID-scoped browser cache containing only usernames, mailboxes and saved-password flags; never cache passwords, and reject stale or cross-user reads to avoid leaking another user's account or overwriting edits.
- Publish bumps #appVersion.
- KHB caches completed Validation verdicts by sector identity (flight/date/route/registration/time), preserving them during partial background reads and repainting only changed results to avoid stale cross-sector verdicts.
- Flight catalogue refreshes use the HTML shim's flight_refresh patch: force fresh unfiltered reads, reject out-of-order/error responses, and preserve selected options as disabled when absent, so background updates cannot silently switch DSP scope.
- Passive FPL watcher status must not change Outlook login state; active Outlook Web login/PIB operations verify and refresh tokens, while real authentication failures remain visible.
- Briefing uses `briefing-data.server.ts` for TAF/defects/pins and `port/briefingPdf.ts` for Unicode three-column Letter PDFs with lossless overflow. Replacement reads actual sector PDFs via `port/briefingPrevious.ts`, preserves cells after fresh sources, and aborts before deletion on parse failure to prevent data loss.
- Omni tokens are cached in service-role-only `omni_session` (via `src/lib/tool/omni_session.server.ts`) and can come from the dispatcher's browser login — Omni rejects token creation from the runtime's IPv6 X-Forwarded-For.
- Normal/EDTO PDFs use shim overlays and template coordinates to preserve cells; EDTO loads its asset pointer. KHB keys flight/date/route/ETD and resets on Crewlist changes; rows can be reused.
- NOTAM pins use `notam.pins:<userId>` to isolate libraries.
- Chat uses `chat_rooms`/`chat_messages` (files: private `chat-files`, signed URLs), dispatcher RLS, admin-only delete and 4s polling. Root's single auth subscriber passes identity to user-keyed ChatWidget: show on login, clear on logout/account change.
- Account edits use profiles/claims, not sessionless getUser; avatars: owner-only writes, signed URLs. Mount account menu on body to avoid header clipping.
- Ver tab crew changes come from diffing the two newest non-VER crewlists (`port/crewlist_diff.ts`) — FPL VER files have no crew column.
- KHB lightning actions resolve fresh FliteBrief sector identity through version/fbreg, never spreadsheet row IDs; crew acknowledgement checks active staff IDs and roles with the old pilot absent, and unreadable crew blocks writes to preserve the existing roster.
- Team config tables (notice rules, KHB CI/taxi/route/alt/era/PCR) are two-tier via `LAYERED_KEYS` in `src/lib/tool/store.server.ts`: admin writes the team key, others write `<key>@u:<uid>` — so one dispatcher edit never changes others.
- Storm warning identities and modern JMA forecast parsing live in browser-safe `port/storms.ts`; retain JTWC RSS names when overlays fail and distinguish unavailable data from confirmed empty feeds. Toolbar changes load through the tool-page shim to preserve the original HTML.
- tool-files retention lives in pure `port/file_retention.ts`, run hourly by cron route `/api/public/cron/cleanup-files` (admin client, cron secret) — workers cannot clean up after a session ends.
- Named ENR resolves FIR-scoped AIP IDs before SUP; unknowns stay manual. Database uses this catalogue. All-area Layer changes plotting only. NOTAM counters share pure `notam_counts` over assessed and dropped rows.
