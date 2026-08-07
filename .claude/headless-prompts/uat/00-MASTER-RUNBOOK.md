# CivitasOne UAT Pack — Master Runbook (Claude Code executable)

**Generated:** 2026-08-05 · **Companion:** `CLAUDE-UAT-GAP-REPORT-2026-08-05.md`

This pack is a set of module-wise functional checkpoints written as **instructions Claude Code can execute** against the repo and a running stack. Every checkpoint is grounded in real routes/files verified during the 2026-08-05 code sweep — no invented paths.

## Layers

Each checkpoint is tagged with the layer it exercises:

- **[UX]** — design/content/a11y verification. Claude Code: read the page component, and (if browser tooling available) render and screenshot it; compare against `figma-prompts/` where applicable.
- **[BROWSER]** — live click-through via Playwright/Chrome against the running web app (localhost:3000, gateway :8080). Requires seeded tenant + test users per role.
- **[API]** — direct gateway calls (curl/fetch) asserting status codes, envelopes (`202 Accepted` for CQRS writes, error envelopes with `correlationId`), and eventual consistency (poll GET after 202).
- **[CODE]** — static verification in the repo (grep/read the cited file:line; run the cited test).

## How to run with Claude Code

For any module file in this pack, prompt Claude Code with:

```
Read <pack-file>. Execute checkpoints <range> against the stack at
BASE_URL=http://localhost:3000 GATEWAY=http://localhost:8080 using test users
in .env.uat. For each checkpoint record: PASS / FAIL / BLOCKED / EXPECT-FAIL-CONFIRMED,
evidence (response body, screenshot path, or file:line), and one-line notes.
Do not mark a checkpoint PASS without captured evidence. Emit a results table at the end.
```

Conventions:

- **EXPECT-FAIL** checkpoints encode known defects from the gap report. They should FAIL today; when they pass, the defect is fixed — update the register. Never "fix" a test to make an EXPECT-FAIL pass.
- CQRS writes return **202** and apply asynchronously — always poll the read endpoint (≤30 s) before asserting state.
- Run role checks with at least: `super_admin`, `tenant_admin`, module officer (maker), module approver (checker), plain employee (ESS). SoD checkpoints require two distinct users.
- Multi-tenant checkpoints require two seeded tenants; assert zero cross-tenant rows on every list.

## Status & sign-off values

Status: Not Tested · Pass · Fail · Partial · Blocked · Expect-Fail-Confirmed · Not Applicable.
Sign-off: Pending · Accepted · Accepted with Conditions · Rejected.

## Pack contents

| File | Scope |
|---|---|
| `01-platform.md` | identity, tenant, policy, admin, gateway, audit, notification, workflow, install, plugins, themes |
| `02-finance-revenue.md` | finance, billing, revenue, grants |
| `03-operations.md` | procurement, contracts, assets, stock, inventory, projects, works, inspection, field |
| `04-people.md` | hrms (incl. recruitment/ATS), payroll, estab, learning |
| `05-citizen-engagement.md` | citizen, helpdesk, telephony, crm, visitor, court, legal, meeting |
| `06-knowledge-insight-web-mobile.md` | knowledge, reports, analytics, ml, ai, locations, metadata, cdp/catalogue/journeys/loyalty/recommendations, cross-cutting web UX, mobile |
| `07-ai-scale-invariant-battery.md` | repo-wide automated checks (endpoint cross-map, CQRS/zod/tenancy/idempotency greps) — re-run after every fix wave |

## Order of execution (recommended)

1. `07` first (5 minutes, catches regressions statically before anyone clicks anything).
2. `01` platform (auth, tenancy, notifications — everything else depends on it).
3. `02`–`05` in parallel by module owners.
4. `06` cross-cutting last (i18n, offline, a11y, mobile).

## Global preconditions

- Stack up: Postgres, Redis, Keycloak, queue driver, gateway :8080, web :3000; all `/health` green (`registerOpsRoutes` exposes `/health`, `/ready`, `/metrics` on every service).
- Seed: 2 tenants, role users above, and module seed data (chart of accounts requires tenant-onboard seed — there is NO account-create endpoint by design; see finance pack).
- Before multi-tenant runs, resolve gap-report #13 (hrms/estab workers lack `runWithTenant`) or async writes may silently fail under FORCE RLS.
