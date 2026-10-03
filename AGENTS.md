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
- Port of the original Python tool proceeds phase by phase per `roadmap.md`.
