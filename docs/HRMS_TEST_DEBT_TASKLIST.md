# HRMS-Service Test Debt — Fix Tasklist

**Context:** `main`'s CI infrastructure was fixed in PRs #856/#857/#852/#855/#844/#854 (scanner-role
passwords, `civitas_admin` grants, missing service roles, stale test expectations). That work
exposed the *real*, previously-invisible test health of the monorepo for the first time: **1,370
individual failing test cases across 33 services**, unrelated to the infra fixes.

`hrms-service` alone accounts for **624 of the 1,370** (45.5% of the entire monorepo's failures).
This file tracks fixing it module by module. Once clean, the same process repeats for the next
service by size (`admin-service`, 251 failures — see BACKLOG note at the bottom).

Source data: `main` CI run, `Tests` job, 2026-09-01 (post-#854 merge). Counts will drift slightly
as fixes land and the suite is re-run — re-derive from a fresh `Tests` job log before trusting an
exact number, but the module *order* and *rough weight* should hold.

## Definition of done ("10/10") — every module below must clear ALL of these before being checked off

1. **Root cause understood and stated in the PR**, not just "made the assertion pass" — same
   standard as the CI-infra fixes: read the actual error, find the actual cause, don't paper over.
2. **Fix applied** at the correct layer (app code if it's a real bug; test code only if the test's
   expectation is provably stale/wrong, same as the CQRS-migration test fixes in #857/#854).
3. **Unit tests**: the specific failing test(s) pass; no unrelated tests in the same file regress.
4. **Integration test**: run the FULL `hrms-service` suite (not just the touched file) against a
   real Postgres — verifies the fix doesn't break sibling tests via shared fixtures/state, and
   catches the "passes alone, fails in the full run" class of bug this session hit twice already
   (`gl.test.ts` in asset-service, `double-entry-gl.test.ts` in finance-service).
5. **Security pass**: for anything touching auth, RBAC, tenant isolation (RLS), or PII — confirm
   the fix doesn't weaken an isolation boundary. Cross-tenant / cross-role tests must still fail
   the way they're supposed to (i.e. a "should reject" test staying red is correct; only "should
   succeed" tests should flip green).
6. **PR opened** with the root cause + fix + verification evidence in the description (mirror the
   style of #854/#856 — this is what made review fast and caught the sequence-seeding bug before
   it shipped).
7. **Code review** (self or delegated) before merge — don't skip this even under time pressure;
   it's what caught the #854 production-crash bug.
8. **CI green** on the PR's own diff-relevant checks (Typecheck, Lint, Secret Scan, the specific
   test files touched). NOTE: the whole-monorepo `Tests` job will keep showing pre-existing
   failures from *other* untouched modules until this whole tasklist is done — that's expected,
   don't block a module's merge on modules not yet reached. Confirm via CI log that failures
   remaining are OUTSIDE this module's files, same verification pattern used for #852/#855/#844.
9. **Merge + delete branch.**
10. **Re-derive the failure count** after merging to confirm the module's number actually dropped
    to (near) zero, and update the checkbox + count below.

## Module 0 — systemic infra bug (fix this FIRST, unlocks 43% of the service in one PR)

- [ ] **Live-server test harness gap** — 268 failures (43% of hrms-service), 100% failure rate in:
  - `tests/atdic-full-lifecycle.test.ts` (174/174)
  - `tests/dic-expert-destructive.test.ts` (59/59)
  - `tests/dic-rbac-personas.test.ts` (35/35)

  Root cause: these three files call real `fetch()` against `http://127.0.0.1:3012`, assuming
  hrms-service is running as a live HTTP server. The `Tests` CI job runs vitest in-process —
  nothing listens on that port. Fix: give these files a `beforeAll` that boots the Fastify app
  in-process (`buildApp()`, same pattern already used elsewhere in this repo, e.g.
  `finance-service/tests/integrity/double-entry-gl.test.ts`) instead of hitting a real socket, OR
  move them to a CI job that actually starts the service (check whether `Live Stack Verification`
  or `Integration Tests` already does this and these files belong there instead).
  Also check the *partially*-failing `dic-*` siblings for the same signature before assuming
  they're pure business-logic bugs: `tests/dic-full-lifecycle.test.ts` (13/38),
  `tests/dic-org-role-test.test.ts` (2/20), `tests/dic-employee-self-service.test.ts` (3/28),
  `tests/hrms.integration.test.ts` (8/23) — these may drop further once Module 0 lands.

## Modules — in priority order (by failure count, after Module 0 is excluded)

- [ ] **recruitment** — 72 failures, fragmented across ~17 small files (candidate, offer,
  interview-comms/scoring/recording/response, screening, screening-override, JD template ×2,
  panel, reference, resume, selection, publication, skills, rejection-notice, qualification,
  requisition). Check for a shared root cause (common fixture/mock) before treating as 17
  independent bugs — same shape as Module 0.
- [ ] **coverage-sweep / mixed files** — ~79 failures spread across files that touch many modules
  per file (`routes-coverage-a/b/g.test.ts`, `sprint9-coverage-b.test.ts`,
  `sprint15-coverage-sweep.test.ts`, `agent1-gap-routes.test.ts`, `gap-routes.test.ts`,
  `consumer-coverage-ext2.test.ts`, `shared-infra.test.ts`, `rls-isolation.test.ts`,
  `f3-leftover-hrms-cqrs.test.ts`). Needs per-line triage since one file ≠ one module here —
  do this last, after the real modules are clean, since some of these may auto-resolve once
  their underlying per-module bugs (below) are fixed.
- [ ] **medical** — 25 failures (`tests/medical-routes.test.ts`, 25/63)
- [ ] **assessment** — 15 failures (`attempt-route`, `result-route`, `assessment-blueprint-route`,
  `eligibility-route`)
- [ ] **consultant-invoice** — 13 failures (`consultant-invoice-route(s).test.ts`)
- [ ] **learning** — 13 failures (`tests/learning-integration.test.ts`, 13/17 — highest failure
  *rate* of any real module, worth an early look)
- [ ] **contractor-bill** — 12 failures (`contractor-bill-route(s).test.ts`)
- [ ] **leave** — 12 failures (`src/modules/leave/consumer.test.ts` 4/13 — real bugs, NOT the
  ECONNREFUSED pattern, confirmed distinct: "spy called wrong number of times",
  "expected undefined to be defined" — genuine consumer logic bugs; plus
  `tests/leave-world-class.test.ts` 4/59, `sprint9-coverage-b.test.ts` slice)
- [ ] **apprentice-stipend** — 11 failures
- [ ] **rti** — 11 failures (`tests/rti-routes.test.ts`, 11/50)
- [ ] **attendance** — 8 failures (`tests/geo-attendance-e2e.test.ts`, 8/23)
- [ ] **training-admin** — 8 failures (`tests/training-admin-integration.test.ts`, 8/13 — second
  highest failure rate)
- [ ] **competency** — 7 failures (`tests/competency-integration.test.ts`, 7/14)
- [ ] **gpf** — 6 failures
- [ ] **employee** — 6 failures (`tests/employee-consumer.test.ts`, 6/10)
- [ ] **workforce-planning** — 5 failures (`tests/workforce-planning-rls.test.ts` — RLS-related,
  apply extra care on the security-pass step)
- [ ] **apar** — 4 failures
- [ ] **manpower-planning** — 4 failures
- [ ] **claims** — 3 failures
- [ ] **reports** — 3 failures
- [ ] **self-service** — 3 failures (`otp-verify-route` — auth-adjacent, apply extra care on the
  security-pass step)
- [ ] **disciplinary** — 2 failures
- [ ] **reservation** — 1 failure

## After hrms-service is fully clean

Move to `admin-service` (251 failures, 18.3% of the monorepo) — re-run the same per-module
breakdown process on it before starting fixes, don't assume its internal module shape from this
file. Then work down the tier list from the original cross-service breakdown: finance-service (76),
workflow-service (61), notification-service (47), payroll-service (45), audit-service (37),
visitor-service (36), and the remaining ~26 services below that.
