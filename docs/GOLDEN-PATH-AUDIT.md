# Golden-Path Audit — CivitasOne (evidence-led product review)

**Date:** 2026-06-27
**Author:** product/eng review
**Question:** Can a brand-new government office sign in and complete real work
(set up the office → run a first transaction) **unaided**, against the live
services — not mock fixtures?

This audit grounds the "zero-training" claim in evidence instead of assumptions.
It was produced by checking the running fleet and the actual backend routes the
front end depends on — not by reading the UI.

---

## North star (proposed)

**Time-to-First-Real-Transaction (TTFRT):** minutes from a new office's first
sign-in to posting their first *real* bill / payroll run / indent, with no
external help. Every bet below is judged by whether it lowers TTFRT or raises the
share of offices that reach it (activation rate).

Today TTFRT is **unmeasured** and, per the findings below, **likely blocked** for
a real office on at least two steps. We have been reporting a "90% zero-training"
score that no instrumentation supports.

---

## Method

- Confirmed the PM2 fleet: all 33 services + workers **online**.
- Verified, route-by-route in the service source, whether each endpoint the new
  setup wizard, sample-data control, and login flow depend on actually exists.

---

## Findings (ranked by impact on the golden path)

### P0 — Blocks or fakes the golden path

1. **Real login depends on external OIDC (Keycloak) that isn't proven here.**
   `apps/web/.../auth/login` redirects to the OIDC authorize URL. If Keycloak
   isn't provisioned/configured, a real clerk cannot sign in (the 500 seen
   earlier). A `dev-login` route exists for local testing only.
   *Impact:* the entire golden path is gated on auth we haven't validated
   end-to-end. **This is the single most important thing to prove.**

2. **Sample-data ("try it") has no backend.** The UI called
   `POST/DELETE /v1/admin/sample-data`; no such route exists in admin- or
   tenant-service. As built it would *always fail*.
   *Fix applied:* the control is now gated behind `NEXT_PUBLIC_SAMPLE_DATA_ENABLED`
   (default off) so we don't ship an always-failing button. *Bet:* build a
   tenant-scoped sample-data add/clear endpoint (with an `is_sample` marker) to
   actually deliver Requirement 15.

3. **Wizard progress pointed at endpoints that don't exist** — so steps would sit
   on "Couldn't check" forever, making setup feel broken:
   - departments → called `/v1/hrms/departments` (no such route).
   - leave-policies → called `/v1/hrms/leave-policies` (real path is
     `/v1/hrms/admin/leave-policies`).
   *Fix applied:* departments now reads `/v1/hrms/org-chart` (the real signal that
   structure exists); leave-policies now uses the correct admin path.

### P1 — Honest but degraded

4. **Org-profile step can't be auto-verified.** There is no fixed-path "current
   tenant profile" read; tenant-service only exposes `/v1/tenants/:tenantId`
   (needs the id). The step now reads `/v1/tenants/current` and honestly shows
   "Couldn't check" on a miss rather than faking completion.
   *Bet:* add a `/v1/tenants/current` (or `/v1/admin/tenant/profile`) read so this
   step becomes measurable — required to honestly report setup completion.

5. **No activation instrumentation.** We cannot see where offices drop off in the
   funnel (sign-in → org profile → branches → people → modules → first
   transaction). We are improving UX blind.
   *Bet:* emit funnel events for each wizard step and first-transaction, and chart
   TTFRT + step drop-off.

### P2 — Validation gap

6. **Zero-training is unvalidated by real users.** No moderated usability test has
   been run; prior screenshots used E2E mock fixtures, not a live login. One
   session with 3–5 actual clerks would surface more than the last several
   features combined.

---

## Endpoint reality check (what the wizard depends on)

| Setup step | Endpoint used | Exists? | Status after this audit |
| --- | --- | --- | --- |
| Org profile | `/v1/tenants/current` | ❌ (no current-tenant read) | Honest "unknown"; bet to add endpoint |
| Branch offices | `/v1/locations` | ✅ | Working |
| Departments | `/v1/hrms/org-chart` | ✅ | **Fixed** (was `/hrms/departments`) |
| People | `/identity/users` | ✅ | Working |
| Modules | `/v1/admin/tenant/modules` | ✅ | Working |
| Finance year / CoA | `/v1/finance/accounts` | ✅ | Working |
| Leave rules | `/v1/hrms/admin/leave-policies` | ✅ | **Fixed** (was `/hrms/leave-policies`) |
| Pay structure | `/v1/payroll/structures` | ✅ | Working |
| Sample data | `/v1/admin/sample-data` | ❌ | Gated off; bet to build |

After the fixes, **6 of 8 setup steps verify against real endpoints**; org-profile
needs a small backend read; sample-data needs a small backend build.

---

## Recommended sequence (what I'd do next, in order)

1. **Prove real auth + a live golden path.** Stand up/validate OIDC so a real
   clerk can sign in, then walk sign-in → wizard → first real transaction against
   live services. Fix whatever breaks. *(Unblocks everything; defines TTFRT.)*
2. **Instrument the activation funnel.** Emit per-step + first-transaction events;
   chart TTFRT and drop-off. *(Turns opinion into data.)*
3. **Add `/v1/tenants/current` read** so org-profile completion is honest and
   measurable.
4. **Build tenant-scoped sample-data** (add/clear, `is_sample` marker) and turn
   the flag on. *(Delivers safe "learn by doing".)*
5. **Run a 5-clerk moderated usability test** of the golden path; feed findings
   back into wizard copy and sequencing.

What we are **not** doing now: more breadth features, more modules to "100%",
more polish on screens a clerk may never reach until the golden path is proven.

---

## What changed in code with this audit

- Wizard progress now reads real endpoints (departments→org-chart;
  leave-policies→`/hrms/admin/leave-policies`); org-profile reads
  `/v1/tenants/current` and degrades honestly.
- Sample-data UI gated behind `NEXT_PUBLIC_SAMPLE_DATA_ENABLED` until its backend
  exists — no always-failing button shipped.
- Typecheck clean; web unit suites green.

---

## Auth root cause (resolved diagnosis) — the real reason the golden path is blocked

It is **not** a code bug. It is environment configuration. Evidence from the live fleet:

- The fleet runs with **`NODE_ENV=production`**, **`JWT_ALGORITHM=RS256`**, and no
  reachable Keycloak (`KEYCLOAK_URL` points at `civitasone-keycloak:8080`).
- The shared `@civitasone/auth` package verifies **RS256 via Keycloak JWKS** in
  production. Its HS256 dev fallback is **hard-disabled when `NODE_ENV=production`**
  (by design — a past security fix).
- The web app's gate (`(app)/layout.tsx`) only checks for a cookie's *presence*,
  so pages render — but every API call to the gateway/services is rejected for
  lack of a valid RS256 token, so loaders return `source:"error"` and the clerk
  sees "Showing saved information" everywhere.
- The built-in `dev-login` mints an **HS256** token and is gated behind
  `ENABLE_DEV_LOGIN=true` (not set). Even if enabled, its token would be rejected
  because the production fleet won't accept HS256.

**Conclusion:** to get a real end-to-end golden path we must either run a non-prod
profile that accepts the dev HS256 login, or stand up Keycloak. Flipping the live
fleet is a shared-system change and must be an explicit, owner-approved action.

### Path A — Staging/UAT profile with dev-login (fast, for validation)

Run the stack as a **non-production** environment so the HS256 dev path works.
Required env (all three must align):

```
# services (every service + worker)
NODE_ENV=staging            # anything other than "production"
JWT_ALGORITHM=HS256
JWT_SECRET=civitasone-dev-secret   # must match the web dev-login secret

# web app
ENABLE_DEV_LOGIN=true
JWT_SECRET=civitasone-dev-secret
```

Then sign in at `/auth/dev` (e.g. `superadmin` / `Civitas@123`) and the golden
path runs against live services. **Must be a separate/clearly-marked environment**
— never the production posture (it disables prod security like RS256 + fail-closed
secrets).

### Path B — Real Keycloak (production-faithful, for go-live)

```
KEYCLOAK_URL=<reachable keycloak>      # e.g. https://auth.example.gov.in
KEYCLOAK_REALM=civitasone
# web OIDC
KEYCLOAK_ISSUER_URL=<KEYCLOAK_URL>/realms/civitasone
KEYCLOAK_CLIENT_ID=civitasone-web
KEYCLOAK_REDIRECT_URI=<app-url>/api/auth/callback
```

Provision the realm + `civitasone-web` client (PKCE, redirect URIs), seed a user,
then `/auth/login` drives the real OIDC flow.

### Recommendation

- **For usability validation now:** Path A on a dedicated UAT instance. Cheapest
  way to watch a real clerk complete setup → first transaction and measure TTFRT.
- **For go-live:** Path B.
- I will **not** reconfigure the running fleet without explicit approval that this
  host is a dev/UAT box (not production with real data), since it means restarting
  ~49 processes and lowering the auth posture.

