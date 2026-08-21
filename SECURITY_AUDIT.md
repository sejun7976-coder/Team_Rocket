# Browser/API security audit

Edge Function names, the Supabase project URL, and the publishable key are public SPA inputs. Security does not depend on obscuring them.

## Server authorization boundaries

- `admin-create-user`, `admin-list-users`, `admin-list-access-logs`, `admin-reset-password`, `admin-set-user-status`, `admin-list-projects`, and `create-project` call `requireSystemAdmin()`.
- `sync-project-member`, `remove-project-member`, `github-retry`, and `delete-github-repository` call `requireReadyUser()` and perform project-role checks in their service-role RPC/query path.
- `complete-first-login` and `record-access-event` intentionally call `requireUser()` because password-change-required users must be able to complete the account lifecycle and record that authentication. Both reject inactive/missing profiles before state changes.
- `bootstrap-system-admin` is a temporary CLI-only Function protected by its one-time high-entropy secret and is deleted immediately after bootstrap.
- Caller identity always comes from the verified JWT. Request bodies do not select the acting user. `begin_project_creation` independently requires service role and verifies that `p_created_by` is an active `profiles.system_role='admin'` user.

## Browser bundle and sensitive values

- Browser code consumes only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, and other Edge secrets are read only through `Deno.env` in Function bundles.
- Raw PIN/password, derived credentials, Authorization JWTs, and GitHub tokens are not logged. Error responses expose allow-listed error codes and generic messages, not secret-bearing upstream bodies.
- Credential derivation is a Hosted Auth minimum-length compatibility layer, not an entropy increase.

## Data and transport controls

- Business tables use explicit Data API GRANTs plus RLS. `anon` receives no business-table privileges. `user_access_logs` has RLS enabled, no browser policy, and no `anon`/`authenticated` GRANT.
- Edge CORS uses the official Supabase JS CORS header set while overriding `Access-Control-Allow-Origin` with the configured `FRONTEND_URL` origin.
- Shared JSON parsing enforces content type and a payload-size cap. Endpoint-specific UUID, text, repository, key-envelope, event, date, and pagination validation runs before mutations.
- IP, country, and user-agent access metadata comes from hosted gateway headers. The access-event JSON body accepts only `eventType`; body-supplied network fields are ignored.
- Admin access-log queries enforce a 90-day lower bound even if an older date is supplied. The app-owned table is also deleted after 90 days; Supabase-managed Auth Audit DB retention remains a Dashboard/platform policy and is not mutated by application code.

## Abuse/rate-limit review

Highest priority for operational rate limiting:

1. Supabase Auth password login and refresh endpoints: keep Dashboard Auth rate limits and attack protection enabled.
2. `admin-create-user`, `admin-reset-password`, and `admin-set-user-status`: low-volume administrative mutations; monitor admin audit events and apply gateway limits if exposed beyond the small trusted cohort.
3. `create-project`, `github-retry`, member sync/removal, and repository deletion: GitHub-costing mutations already require authorization and idempotency/role checks; add per-user gateway limits if usage grows.
4. `record-access-event`: service RPC suppresses same-user/same-event retries within five seconds and runs indexed 90-day cleanup under an advisory lock.
5. Read endpoints: pagination and server-side maximum page sizes prevent unbounded extraction.

Supabase/GitHub upstream rate limits remain authoritative. No client-provided counter is trusted.
