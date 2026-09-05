# Skill — Service Production-Readiness Audit

**When to load:** Before declaring any service "done" or "production ready", and before starting a fix→PR→review→merge pass on a service that hasn't been through this audit yet. Every bug class below was found live, in this codebase, across 20+ services in one hardening pass (Sep 2026) — most of them more than once, in different services, because the same mistake gets copy-pasted along with the pattern it's part of.

---

## The rule

> A service is not "production ready" because its own tests are green. It is production ready when it has been checked against every bug class below, because every one of them passes a green test suite while still being wrong.

## How to run this audit on a service

1. Work in your own git worktree (`git worktree add /path/to/wt/<service>-audit -b fix/<service>-audit origin/main`) — never edit the primary checkout directly.
2. Go through sections 1–6 below in order, against the service's real source, not against what its comments or PR descriptions claim.
3. Every real finding gets fixed and a real regression test added, not just noted.
4. Verify against a fresh, isolated Postgres container (never the shared dev DB) — full suite, bare `npx vitest run`, at least 3 consecutive runs, with outbox/backlog state left to accumulate across runs rather than reset (several of the bugs below are backlog-size-dependent and only show up after repeated runs).
5. Open a PR. Get a genuinely independent review (different agent/session, not the one that made the fix) before merging. Re-verify after every round — a fix that "looks complete" at round 1 has, in this codebase's own history, turned out incomplete at round 2 and round 3 on the same PR. Don't stop until a review round finds nothing new.

---

## 1. Nested-transaction connection-pool deadlock

**The bug:** a repo function built on `scopedRead(fn)` — which internally opens its own `db.transaction(fn)` — gets called from *inside* an already-open outer `db.transaction()`. With `pool.max = 10`, once ~10 callers are concurrently in-flight, every outer transaction holds a connection while waiting on its own nested read to get an 11th connection that will never free up. Total, silent deadlock under load; passes every test that doesn't run enough concurrency to hit `pool.max`.

**How to find it:**
```bash
grep -rn 'scopedRead' services/<service>/src/modules/*/repo.ts
grep -rn 'db.transaction(async (tx)' services/<service>/src/modules/*/consumer.ts
```
For every `db.transaction` call site, check every repo function it calls: does that function use `scopedRead` (a *second* transaction) instead of taking the caller's `tx` directly?

**The fix:** add a `...InTx(tx, ...)` variant that reads through the caller's already-open `tx` — never opens its own transaction. Keep the original `scopedRead`-based function for its legitimate non-transactional callers (route handlers).

**The test:** spin up an isolated container, fire `pool.max + a few` concurrent commands through the fixed and unfixed code. Unfixed: `queue.drain()` never resolves, exactly `pool.max` connections stuck `idle in transaction`. Fixed: drains cleanly in milliseconds. A functional regression test alone (assert the command completes) does **not** prove this — you need the actual concurrent-load repro at least once, even if the checked-in test is a smaller, CI-safe version of it.

**Where this bit us:** notification-service (`checkQuota`/`checkDlt`, 3 call sites across 2 review passes before all were found), building-service (`submitApplication`/`issuePermit`/`decideApplication`, reintroduced in already-merged code from an earlier PR).

## 2. RLS sentinel-tenant blindness

**The bug:** platform-wide/system rows are seeded with `tenant_id = '00000000-0000-0000-0000-000000000000'` (a sentinel, meaning "belongs to no real tenant, visible to all"). The tenant-isolation RLS policy (`tenant_id = current_tenant_id()`) only matches a real tenant's own rows — it has no exception for the sentinel — so every real tenant's session silently sees **zero** platform-wide rows. Breaks whatever those rows back (system notification templates → blank notifications; default categories → invisible defaults) with no error anywhere, since a query returning zero rows looks identical to "correctly found nothing."

**How to find it:**
```sql
-- any migration seeding rows at the zero-UUID?
grep -rln "00000000-0000-0000-0000-000000000000" services/<service>/migrations/
-- does the tenant_isolation policy have a sentinel exception?
SELECT policyname, qual FROM pg_policies WHERE tablename = '<table>';
```
If a table has zero-UUID-seeded rows and its only RLS policy is the standard `tenant_id = current_tenant_id()` all-commands policy, real tenants cannot read those rows.

**The fix:** an ADDITIVE, `SELECT`-only permissive policy: `CREATE POLICY ... FOR SELECT USING (tenant_id = '00000000-...'::uuid)`. Leave the existing all-commands tenant policy untouched — this only widens reads of the sentinel value, never writes, and never widens access to other tenants' real rows.

**The test:** as a real (non-superuser) tenant role, with RLS active, query the sentinel-owned rows before the fix (expect empty) and after (expect them visible) — plus confirm non-sentinel cross-tenant isolation is unaffected in both directions, and that writes to the sentinel tenant are still blocked.

**Where this bit us:** notification-service's system/municipal templates (breaking every default notification), asset-service's default categories (identical shape, found by the same investigation).

## 3. Financial-integrity: server-derived amounts only

**The bug:** wiring a cross-service financial event (`finance.challan.create`, a GL journal entry, a disbursement) onto a route or consumer that accepts a client- or citizen-role-supplied amount with no server-side derivation or admin gate. Once that value reaches a real ledger, an attacker (or a confused client) controls what gets posted.

**How to find it:** for every call site that emits a cross-service financial event, trace the amount back to its source. Is it computed by a pure server-side function (`calculateFeeMinor`, etc.) from inputs the caller can't directly set the total from? Or is it read straight off the request body / command payload?

**The fix:** either derive the amount server-side, or gate the route to admin-only roles matching the pattern of sibling routes in the same service that already handle money correctly.

**Also check:** does the amount actually belong on the ledger at all? A **refundable deposit** is not revenue — folding it into the same challan as a genuine fee misbooks it (Dr Bank / Cr revenue-classified head) with no liability ever recorded, and no way to reverse it when the deposit is later refunded. If the event contract doesn't yet have the right shape for what you're modeling (e.g. no `finance.deposit.create`-style liability event, or using one would need a schema migration to persist the generated id for later disposition), the correct move is to exclude it and flag it as follow-up — not force it through the fee-challan path just to have *something* wired.

**Where this bit us:** sewerage-service's desludging route (citizen-suppliable `feeMinor` reaching a real GL journal, no admin gate); event-service's `createApplication` (a refundable deposit folded into the fee challan, misbooked as revenue — caught by review, fixed by excluding the deposit, matching roadcut-service's PR for the identical shape).

## 4. Test-infrastructure soundness (these look like flakes; they are bugs)

Three distinct shapes, all discovered via full-suite runs failing when the same file passed standalone:

**(a) TRUNCATE/relay race under default parallelism.** A new test file's blanket `TRUNCATE ... CASCADE`, or an unscoped `relayOnce()` batch call, races another concurrently-running file's writes to the same shared table (`_outbox.messages` has no per-file isolation). Real CI runs bare `vitest run` with default parallelism — a fix verified only under `--no-file-parallelism` doesn't prove anything about what CI will actually see.
- Fix: `fileParallelism: false` in the service's `vitest.config.ts`, and/or a `relayToCompletion` loop instead of trusting one bounded `relayOnce(limit)` call.

**(b) Cross-file `DATABASE_URL`/module-cache leak.** A dual-DSN test (flips `process.env.DATABASE_URL`, dynamically imports a service's `db.js`, flips again, imports another service's `db.js`) works fine alone. If vitest's `forks` pool coalesces two such files onto the *same* OS process — which `pool:"forks"` + `singleFork:false` reduces but does **not** guarantee against — the second file's dynamic import returns the first file's already-cached module, bound to the wrong DSN.
- **Do not assume `pool:"forks"` alone fixes this** — it was tried, looked correct, passed several verification rounds, and still failed ~1-in-5 to 1-in-10 full-suite runs on real re-verification. The check that actually catches it: run just the two DSN-flipping files together, repeatedly (10+ times) — if either one intermittently fails, `fileParallelism: false` is the real fix (serializes file *execution*, not just process isolation, so this can't happen regardless of the pool's scheduling).

**(c) Leftover unpublished garbage from other, unrelated pre-existing test files.** A service's older real-DB tests (predating cross-events wiring) never truncate their own outbox writes. Once a new test's `relayOnce(limit=100)` call shares that table, a large-enough backlog can fill the whole batch before ever reaching the new message.
- Fix at the read side (a `relayToCompletion` loop that drains to zero, not one bounded call) rather than retrofitting truncation into unrelated pre-existing files just to satisfy a new test.

**How to verify a fix for any of these actually holds:** 10–15 consecutive full-suite runs, bare `npx vitest run`, **without** resetting the DB between runs (let backlog accumulate — several of these only manifest once enough stale rows exist). 3 clean runs on a freshly-truncated DB proves nothing about (b) or (c).

## 5. Cross-service wiring completeness — don't under-notify

When wiring citizen-facing (or employee-facing, for internal-staff modules) notifications onto a service's consumers:
- **Punitive or negative transitions are still citizen-meaningful.** `revokePermit`, `rejectApplication`, a licence suspension — these were once wrongly excluded as "internal, back-office only" in an early pass and had to be added back after review. If a transition changes what a citizen/employee is entitled to, they need to hear about it, positive or negative.
- **A transition that changes how much of *their own money* comes back** (a deposit decision, a refund outcome) is citizen-meaningful even if it lives in a module named something internal-sounding like "post-event" or "reconciliation."
- **Don't invent a notification for a state transition no command actually drives.** Check the full `COMMANDS`/topics list against the domain's `VALID_TRANSITIONS` table — a status modeled in the state machine with no command that ever sets it is dead code, not a missing notification.
- **Genuinely internal steps stay unwired**: department-to-department workflow with no new citizen-facing information, the citizen's own self-initiated action (no need to notify them of what they just did), and internal record-keeping with no decision attached yet.

## 6. Frontend / UI end-to-end testing

Everything in sections 1–5 above was found by auditing backend service code — no frontend/UI pass has been run yet against this checklist. This section is general guidance to apply going forward, not a report of bugs already found, and should be updated with real findings (in the same style as the sections above) the first time it is actually run against a module's UI.

This repo already has real E2E infrastructure worth using rather than reinventing: Playwright (`apps/web/tests/e2e/`, `apps/web/playwright.config.ts` and the live/no-server config variants), a dedicated accessibility suite (`apps/web/tests/a11y/`, `pnpm test:a11y` / `test:a11y:full` / `test:a11y:baseline`), and Lighthouse CI (`pnpm test:lighthouse`).

**When auditing a module's frontend for production-readiness:**

- **Golden-path E2E, not just component/unit tests.** A component test proves a button calls the right handler; it does not prove the handler's result actually reaches the screen through the real API, the real auth context, and the real routing. Every module needs at least one Playwright spec that drives the browser through its actual primary workflow end-to-end (e.g. login → navigate to module → create/submit the module's core resource → see it reflected in a list/detail view), hitting a real (test) backend, not a mocked API layer.
- **The state a backend fix changes should have a UI assertion too, not just an API-level one.** Several backend fixes made under this audit (deadlock fixes, RLS fixes, financial-integrity fixes) only had backend integration tests. Where the affected data is user-visible (a status, a balance, a notification), add or confirm an E2E check that the UI actually reflects the corrected state — a backend fix that's invisible on the actual user-facing screen isn't verified from the user's perspective.
- **Money and status fields need an explicit rendering check.** A UI that silently renders `undefined`/`NaN`/blank for a money amount or a status badge (instead of erroring loudly) hides exactly the kind of backend defect this skill's other sections look for — a citizen or officer looking at a blank balance has no way to tell "the fee hasn't posted yet" from "the page is broken." Assert the actual rendered text/value, not just "the element exists."
- **Accessibility is not optional polish.** Run the existing `test:a11y` suite against any page/flow touched by a fix, not just new pages — GIGW/WCAG 2.2 AA obligations apply to every citizen- and officer-facing screen in a government system, and a backend change that alters what renders (a new status, a new notification banner, a new form field) can introduce a real accessibility regression even when the developer never touched a class name.
- **Don't let E2E specs silently rot into no-ops.** A Playwright spec that matches a selector too loosely, or that never actually waits for the async action it's testing to complete, can pass every run while testing nothing — structurally the same failure mode as this skill's section 4 (test files that pass while proving nothing). When adding an E2E spec, deliberately break the underlying feature once and confirm the spec actually fails — the same sabotage-check discipline used for backend regression tests throughout this audit.
- **Test against a real, isolated environment**, matching the backend discipline in this skill: point Playwright at a throwaway backend/DB instance seeded for the test, never at the shared dev environment or production.

## 7. Verification discipline

- Every "fixed"/"done" claim gets independently re-verified by a different agent/session before merge — never self-reviewed, no exceptions, regardless of how confident the fix looks.
- Re-derive counts and claims from source yourself; don't trust a relayed "found N instances" or "3/5 tests failed" without re-grepping/re-running it.
- If a reviewer finds something, fix it, then get **another** review round on the fix itself — a round-2 fix has, in this codebase's real history, still had a gap a round-3 review caught.
- When something looks flaky, don't dismiss it as environment noise — reproduce it deliberately (isolate to the smallest failing pair of files, query the actual DB state at the point of failure) until you have the real mechanism, not a guess.

## Forbidden patterns

- A repo function using `scopedRead`/its own `db.transaction()` called from inside another already-open `db.transaction()`.
- A table with zero-UUID/platform-wide seeded rows and no sentinel-exception SELECT policy.
- A cross-service financial event carrying an amount that isn't server-derived or admin-gated.
- A refundable/reversible amount (deposit, retention, escrow) folded into a revenue-classified challan or journal entry.
- A new real-DB test file verified only under `--no-file-parallelism` or only against a freshly-truncated DB.
- A dual-DSN (`DATABASE_URL`-flipping) test file in a `vitest.config.ts` without `fileParallelism: false`.
- Excluding a punitive/negative status transition from citizen notification as "internal" without checking whether it changes the citizen's actual entitlement or money.
- A UI that renders a money amount or status field as blank/`undefined`/`NaN` instead of erroring loudly.
- A new E2E spec that hasn't been sabotage-checked (break the feature once, confirm the spec actually fails).
- Merging your own fix without a review round from a different agent/session.
