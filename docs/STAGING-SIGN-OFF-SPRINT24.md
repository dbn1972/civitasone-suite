# Staging Full-Data Smoke Run Sign-Off — Sprint 24, Task 40

**Status: BLOCKED — not signed off.**

## What the task asked for

Seed the staging tenant with ≥500 estab files, ≥1,000 inventory items, and
≥200 procurement POs, then run the full `tests/e2e-live/` suite against
staging and record pass/fail here.

## Scope adjustment (user-approved)

Full-scale seeding (500/1,000/200 records) was scaled down to a small,
clearly-tagged smoke dataset (5 estab files, 5 inventory items, 3 procurement
POs, all prefixed `E2E-SMOKE-<timestamp>`) before any attempt was made,
because:

- No seed script capable of that scale exists. `pnpm seed:uat`, referenced by
  the `.kiro/steering/uat-playbook.md` steering doc, is not a real script in
  `package.json` — checked directly, not assumed.
- Bulk-writing 1,700+ synthetic records into a shared staging environment
  other agents/users are actively using for UAT (per
  `.kiro/steering/git-workflow.md`'s own "multi-agent repo" warning) is a
  large, hard-to-reverse action against shared infrastructure.

## Second finding: the existing `tests/e2e-live/` suite cannot run against staging as-is

`tests/e2e-live/helpers/auth.ts`'s `injectAuthCookie` signs an HS256 JWT and
injects it as a cookie — this only works against the **local** dev stack
(`JWT_ALGORITHM=HS256` test override). Every service's `.env.example` confirms
production/staging defaults to `JWT_ALGORITHM=RS256`, verified against
real Keycloak-issued tokens. An injected HS256 cookie is rejected by staging's
gateway. A staging run requires driving a real browser through Keycloak's
actual hosted login page — there is no shortcut.

A new spec (`tests/e2e-live/specs/staging-smoke-scaled.spec.ts`) and a
dedicated config (`tests/e2e-live/playwright.staging.config.ts`, pointed at
`https://civitasone.65-2-205-201.nip.io` with no local `globalSetup`) were
written to do exactly that — log in through Keycloak's real form, then create
the scaled-down dataset via the UI (estab files) and direct API calls
(inventory items, procurement indent + POs), then verify each list page
renders the new records.

## Blocker: demo credentials do not work

The documented Super Admin demo account
(`admin@civitasone.dev` / `CivitasOne#2026!`, from
`.kiro/steering/quick-reference.md`) was rejected by staging's Keycloak with
**"Invalid username or password."** — confirmed via a real login attempt
(screenshot + trace captured), not assumed. This is not a scripting defect:
the login form rendered correctly, the username/password fields were filled
correctly, and the "Sign In" button submission reached Keycloak's real
`login-actions/authenticate` endpoint, which rejected the credentials.

Since the credentials in the steering doc are either stale or the account's
password has since been rotated, this cannot be resolved without either:
1. Corrected/current credentials for any of the three documented demo
   accounts (`admin@civitasone.dev`, `priya`, `meera`), or
2. A password reset on the existing Super Admin account, or
3. A newly provisioned service account scoped for automated smoke testing.

## What passed verification before the blocker

- Staging is reachable and correctly enforces auth (`/estab/files/new`
  returns a `307` redirect to the login flow when unauthenticated — checked
  directly).
- The Keycloak login page itself renders correctly and exposes the same three
  documented demo accounts (Super Admin / HR Admin / Employee) in its own
  SANDBOX test-account panel, confirming the account *names* are correct even
  though the *password* supplied did not authenticate.
- The login-flow automation (waiting for the Keycloak redirect, filling the
  real hosted form, submitting, and detecting the post-login redirect back
  into the app) works correctly up to the point of credential rejection.

## Artifacts

- `tests/e2e-live/specs/staging-smoke-scaled.spec.ts` — the scaled-down smoke
  spec (create + verify estab files / inventory items / procurement POs).
- `tests/e2e-live/playwright.staging.config.ts` — staging-specific Playwright
  config (no local `globalSetup`, `baseURL` pointed at the real deployment).

Both are committed and ready to run as soon as working credentials are
available — no further code changes should be needed.

## Sign-off

**NOT SIGNED OFF.** Blocked on staging credentials. Re-run this task once
valid credentials are supplied; update this report with the actual pass/fail
outcome at that time.
