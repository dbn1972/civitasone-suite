# Skill — QA / Test Strategy

**When to load:** Before writing a new mock in a `vi.mock(...)` block, when a test that "should" catch a regression doesn't, before declaring a flaky test "just flaky," and whenever asked whether this suite's coverage is trustworthy.

---

## The rule

> A green test suite proves a test ran, not that the behavior it claims to check is actually being checked. The single most repeated failure in this codebase's test history is a mock that silently stopped exercising the real code path while its assertion kept passing.

## 1. The actual shape of the test pyramid here — know what you're relying on

Sampled counts across six services (co-located unit tests in `src/**/*.test.ts`, integration tests in `services/<svc>/tests/*.test.ts`, per-service contract tests):

| Service | unit | integration | contract |
|---|---|---|---|
| finance-service | 0 | 106 | 0 |
| hrms-service | 22 | 230 | 0 |
| payroll-service | 4 | 68 | 0 |
| notification-service | 0 | 72 | 0 |
| asset-service | 0 | 21 | 0 |
| inspection-service | 4 | 60 | 0 |

**The pyramid is inverted at the per-service level.** Almost all test mass is integration-shaped (real-DB or heavily-mocked-DB tests in `tests/`), with near-zero true co-located unit tests in most services. Contract tests are not per-service at all — they live centrally at the repo root (`tests/contract/gateway.contract.test.ts`, `cross-service-events.contract.test.ts`, `screens.contract.test.ts`, `crm-link-integrity.contract.test.ts`). E2E is thin relative to the integration-test mass below it: only 5 Playwright configs and roughly a dozen spec files total across `tests/e2e/` and `tests/a11y/`, against 500+ integration tests — this matches skill 16's own admission that frontend E2E is "a first pass only." When judging whether a change is well-tested, weight this shape: a service with 0 unit tests and 100+ integration tests is not undertested in raw count, but it is testing everything through the heaviest, slowest layer, and integration tests are exactly where the stale-mock failure mode in §3 lives.

## 2. A "contract test" here may be static, not live — read which kind before trusting it

`tests/contract/gateway.contract.test.ts` is a real, useful test, but it validates something narrower than its name suggests: it imports `SERVICE_ROUTES` directly from `services/gateway-service/src/registry.js` (a data structure, not a running process) and asserts a route table's own prefix-matching logic resolves ~40 sample paths correctly. **It does not make a live HTTP call to a running gateway** — it would not catch a gateway that is actually unreachable, or a route registered in the table but never wired to a real handler. That end-to-end check exists as a *separate* CI job, "Screen Verification Gate," which starts a mock gateway and asserts real HTTP 200s. Before treating "the contract test passed" as proof a route works live, check which of these two you're actually looking at.

## 3. The stale-mock bug class — the single most important thing in this skill

**The pattern:** a test mocks a repo/module function by name (`vi.mock(".../repo.js", () => ({ foo: vi.fn(...) }))`). Later, production code changes to call a *different*, related function (very often the `...Tx` suffix convention from the nested-transaction-deadlock fix pattern in skill 16 — see that skill's §1 for why a `...Tx` sibling gets added next to an existing function). The mock factory still only defines the *old* name. Because `vi.mock` factories are typically the sole source of truth for that module inside the test (no `...(await importOriginal())` fallback, or one that doesn't cover the new export), the real, unmocked new function runs for real against the test's fake/stub dependencies — and either throws silently (swallowed by whatever error handling sits between it and the assertion) or returns `undefined`/a no-op. **The test's assertion checks the OLD symbol, which was never called, and passes anyway** — providing zero actual coverage of the behavior it claims to test, while looking exactly like every other green test in the run.

This has happened, independently, at least four times in this repo's real history — not a hypothetical:

- **finance-service, PR #1076** (`services/finance-service/tests/consumer-coverage-ext.test.ts`): a test titled `ml.prediction.anomaly_detected skips dismissed transaction` mocked `isTransactionDismissed` and asserted on `createAnomalyFlag` — both non-Tx. Once the handler started calling `isTransactionDismissedTx` directly, `dismissed` was always `false` in the test regardless of the mock, and the `createAnomalyFlag` assertion was vacuously true since production always calls `createAnomalyFlagTx`. The commit message documents the fix was verified by **sabotage-check**: "temporarily hardcoding `dismissed = false` in the handler made this test fail as expected, then reverted" — that is the correct way to confirm a fixed test actually catches a regression, not just that it's green again.
- **hrms-service, PR #872**: `leaveApprove`'s command handler calls `repo.approveLeaveApp` for the race-safe approve path, but the test's `vi.mock("./repo.js")` only stubbed `updateLeaveApp` — `approveLeaveApp` was `undefined` on the mocked module, so every approve-path call threw a `TypeError` inside the queue subscriber, silently killing the approve flow. The same PR also found a mocked Drizzle-style query builder chain that only implemented `select -> from -> where -> limit`, silently skipping `orderBy` in 5 places — and because `startRelay` swallows and logs relay-cycle errors rather than propagating them, this masked two *other* tests failing silently as well.
- **hrms-service, PR #893**: a cache mock was missing `invalidateResource` — "the real `Cache` class has always had it; the mock was stale." Fixing the mock then exercised the real code path for the first time and surfaced an actual production bug: `lifecycleReinstate` was writing an employee status (`'active'`) that migration `0025_employee_status_contract.sql` had explicitly retired, silently rolling back every reinstate transaction. **A stale mock doesn't just hide missing coverage — fixing it can surface a real, previously-undetected bug**, exactly as it did here.
- **visitor-service, PR #970**: a fake Drizzle query chain's `.where()` exposed `.limit()` but wasn't thenable — awaiting the chain resolved to the chain object itself, not rows. Both resulting uncaught rejections were silently replayed ~20ms later by the queue's retry/backoff, landing inside a *later* test's assertion window instead of the test that actually triggered them: cross-test contamination caused by a mock shape bug, not a real race condition.

**When you touch a repo/module file that gets a new `...Tx` (or otherwise renamed/superseded) export, grep every test file that mocks that module and check whether the mock needs a forwarding entry for the new name** — the established fix shape (seen across all four examples above and throughout the tenantTransaction re-audit) is `fooTx: (...a) => H.foo(...a.slice(1))`, delegating to the same spy the original assertions already reference, so value-based assertions (`toHaveBeenCalledWith`) keep proving what they always proved. **Do not add a mock entry that only makes `toHaveBeenCalled()` true** — that reintroduces the exact vacuous-pass failure mode this section is about.

## 4. Flaky-test policy — documented, but the enforcement mechanism doesn't exist yet

`docs/TEST-INFRA.md` states the policy plainly (§2, "Determinism Rules (B2)", marked "Status: Implemented"): ban `Date.now()`/`Math.random()` without injection, require injected clocks (`vi.useFakeTimers()`), tests must be order-independent (Vitest runs in random order by default), and — quoted directly — **"Quarantine flaky tests to `tests/quarantine/` — a flaky is a bug."**

**No `tests/quarantine/` directory exists anywhere in this repo, at any path.** No CI retry logic exists either — no `retries`/`retry` config in any per-service `vitest.config.ts`, and the only `continue-on-error: true` entries in the workflow files are for two unrelated steps, not test retries. The policy is marked "Implemented" but its stated enforcement mechanism is not present. Treat "flaky" reports the way skill 16 insists: **reproduce deliberately (isolate to the smallest failing pair of files, check actual DB/queue state at the point of failure) rather than dismissing as environment noise** — there is currently no quarantine safety net catching what determinism-rule violations slip through.

## 5. UAT — two real, distinct systems, not one

- **`docs/uat/CHANGELOG.md`** is a per-wave UAT log. Each wave carries three tables: **Bugs Fixed** (`# | Bug | Files Touched | User-Visible Change`), **Tests Added**, and a numbered **Manual UAT Verification Needed** checklist naming the exact user-visible steps a human should click through. It also has a **Risk Areas** section stating blast radius per shared-package change in plain language (e.g. `packages/auth — timingSafeEqual added. All services affected. Verify login works.`). Write this shape for any change to a shared package.
- **`.claude/headless-prompts/uat/00-MASTER-RUNBOOK.md`** is a formal, Claude-Code-executable UAT pack split into 7 module-scoped files, each checkpoint tagged by layer (`[UX]/[BROWSER]/[API]/[CODE]`). It defines explicit **Status** values (`Not Tested · Pass · Fail · Partial · Blocked · Expect-Fail-Confirmed · Not Applicable`) and **Sign-off** values (`Pending · Accepted · Accepted with Conditions · Rejected`), and states the rule directly: **"Never 'fix' a test to make an EXPECT-FAIL pass."** An `Expect-Fail-Confirmed` result is a legitimate, intentional outcome (e.g. a permission check correctly denying access) — don't "fix" it into a `Pass` by weakening the check it's verifying.

## 6. Mutation testing (Stryker) — a ratchet, not a coverage-percentage vanity metric

`stryker.config.mjs`'s header states its purpose directly: it proves test suites *actually catch bugs*, not merely achieve line coverage — "a surviving mutant means: we changed production logic and NO test failed. That is a test suite gap, regardless of line-coverage percentage." It's deliberately scoped to the 8 highest-value domain files (finance `budget/gl/payments` domain logic, workflow `authority/quorum/decisions` domain logic, payroll `payroll/fnf` domain logic) rather than the whole repo — mutation testing is expensive; spend it where a silent logic bug would be most damaging (money and authority decisions), not everywhere.

The threshold discipline is worth copying verbatim into how you phrase any other quality gate: `thresholds: { high: 90, low: 70, break: 68 }`, with the measured (not estimated) burn-down history logged inline — 35.1% → 58.31% → 68.03% → 71.29% across successive passes — and the comment: **"`break` is held just below the measured score so a regression fails the build; it is a floor, not the target. Raise it as the burn-down continues; never lower."** Report quality-gate progress the same way: state the measured number, hold the enforced floor just under it, and only ever move the floor up.

## Known gaps — not covered by this skill

See `.claude/skills/16-production-readiness-audit.md`'s own "Known gaps" section first — the two most QA-shaped items from that list are named again here rather than duplicated in full:

- **Coverage tracking** — this skill (like skill 16) finds gaps by targeted reasoning about known failure shapes (the stale-mock pattern in §3, the flaky-policy gap in §4), not by measuring what fraction of the codebase has been examined this way. A clean pass through this skill's checks is not a coverage percentage.
- **Chaos/resilience testing** — nothing here tests suite behavior under downstream service outages or partial infra failure beyond the specific Postgres-pool-exhaustion shape skill 16 covers in its §1.
- **Real usability/UX testing methodology** — the UAT process in §5 verifies documented workflows execute correctly; it does not evaluate whether a workflow is discoverable or appropriate for its actual users, the same gap skill 16 names for itself.
