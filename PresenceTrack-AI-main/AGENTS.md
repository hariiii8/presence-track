<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## Project rules (PresenceTrack)

- Roles live only in `public.user_roles` (one row per user) and are checked with `has_role`/`has_any_role`; never read roles from profiles or auth metadata — prevents privilege escalation.
- `enterprise_users.id` is the app/person id used by ESP32 firmware and transit rows; `auth_user_id` links a sign-in only after email verification via the `on_auth_user_verified` trigger — keeps imported people linkable without trusting unverified emails.
- Enclave routes live under `src/routes/_authenticated/enclave.*` and each child guards itself with `canAccessEnclave` from `src/lib/enclaves.ts` — one console per role, no cross-role navigation.
- ESP32-CAM devices call `/api/public/esp32/*` and must send the `x-device-key` header matching the `ESP32_DEVICE_KEY` secret — these routes bypass site auth, so the key is the only gate.
- Dwell minutes and current zone are computed by the `apply_transit` database trigger on each transit insert — keeps accounting consistent regardless of which caller inserts.
- Modals render through `src/components/presence/layout/Modal.tsx` (portal) — glass cards use backdrop-filter, which traps fixed-position children.
