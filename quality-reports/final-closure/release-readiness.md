# Release readiness

<!-- V4-CERT-BEGIN -->
## V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 release decision

**DECISION: FAIL**

Rules applied (V4): PASS only if every mandatory gate PASSes (PASS_WITH_KNOWN only for owner-accepted deferrals), evidence is complete, approvals are satisfied and no release-blocking defect is open. A NOT_RUN mandatory gate without an owner deferral gives BLOCKED. A failing gate or an open HIGH/CRITICAL defect gives FAIL. FAIL outranks BLOCKED here because gates fail and HIGH/CRITICAL defects are open; the NOT_RUN gates would on their own have forced BLOCKED. Nothing was rounded up.

### Consolidated defect table (V4 cycle, computed by `consolidate-defects.py`)

| Severity | Found | Fixed | Verified | Awaiting Approval | Unresolved | Other (owner-accepted) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 1 | 0 |
| HIGH | 18 | 15 | 15 | 0 | 3 | 0 |
| MEDIUM | 34 | 26 | 26 | 0 | 8 | 0 |
| LOW | 19 | 12 | 12 | 0 | 7 | 0 |
| TOTAL | 72 | 53 | 53 | 0 | 19 | 0 |

How the numbers are produced: `consolidate-defects.py` reads `v4-registry.json` (one row per defect) and counts rows by `severity` and `closureStatus`. Found = rows not DUPLICATE/NOT_REPRODUCED. Fixed = fix merged to main (FIXED_MERGED + VERIFIED + VERIFICATION_BLOCKED); Verified is a subset of Fixed (merged AND its regression test passed in the regression lane, no contradicting lane). Awaiting Approval = BLOCKED_FOR_APPROVAL. Unresolved = UNRESOLVED. Other = owner-accepted deferral. Invariant asserted by the script: Found = Fixed + Awaiting + Unresolved + Other. Excluded from Found: V4-B-05 (NOT_REPRODUCED), V4-E-01 (DUPLICATE of V4-B-02), V4-E-04 (DUPLICATE of V4-A-03), V4-G-04 (DUPLICATE of V4-B-02). Severity for V4-A..G is the independent verifier's (verify-*.json), not the discoverer's. Certification-found rows (V4-INTEG-01, V4-CERT-nn) carry a provisional severity assigned by the Release Certification Auditor; V4-CERT-15/16 each count one row for many scanner alerts (5 and 245). Earlier-run rows (RUN1/RUN2/RUN3) have no independent per-defect verification, so none of them is Verified.

### Why FAIL (each item has evidence)

| Gate / condition | Result | Detail | Evidence |
|---|---|---|---|
| Gate 4 unit/service tests | FAIL | build lane 118/123 tasks; GitHub CI Tests job failed (citizen-service#test, web#test) | cert/build.json; ci-run-40258410831.json |
| Gate 5/9 service suites with DB | FAIL | 63/67 green locally; analytics, audit (flaky), citizen, grant red locally; citizen red in CI | cert/db.json |
| Gate 6a contract tests | FAIL | cross-service-events 2 failures (confirmed in CI) | cert/contract-e2e.json |
| Gate 11 tenant isolation/IDOR/RLS tests | FAIL | tests/security idor-inventory deterministic failure | cert/db.json |
| Gate 12 cross-service flows (tests/cross-service) | FAIL | 5 failed / 9 passed | cert/db.json |
| Gate 13 DB integrity (tests/data-integrity) | FAIL | 7 failed / 19 passed, BYPASSRLS roles + PII at rest | cert/db.json |
| Gate 14 Architecture Guard | FAIL | tenant-table-rls-guard, flaky-skip-guard, authz-tenant-scanner (confirmed in CI) | cert/build.json; CI Architecture Guard |
| Gate 14 gitleaks (CI) | FAIL | 2 findings in the frozen-SHA commit; not runnable locally | job-121365184496.log |
| Gate 15b open code-scanning alerts | FAIL | 5 critical / 245 high open on main, untriaged | cert/security-perf/codeql-all.json |
| Gate 18 recovery/resilience | FAIL (unverified) | root 91/91, circuit-breaker 18/18, billing adapters 37/37 pass; finance pfms-adapter 12/28 failed on an unmigrated test DB and was NOT rerun; lane called it PASS_WITH_KNOWN but no owner deferral covers it, so it cannot be PASS | cert/security-perf.json |
| Gate 19 cross-service-live | FAIL | payroll-posting-history 2 tests deterministic | cert/contract-e2e/xs.log, xs2.log |
| Gate 20 regression | FAIL | citizen-service service-gaps-partial-routes 10/38 red (V4-INTEG-01) | cert/regression.json |
| Release Gate (evidence audit, CI) | FAIL | L3, L6 and SLO UNMEASURED | job-121392646315.log |

### Open HIGH / CRITICAL defects

| ID | Sev | Run | Status | Title |
|---|---|---|---|---|
| V4-G-12 | HIGH | V4 | UNRESOLVED | Appeal filing window is evaluated against a client-supplied decisionDate (never the application's actual decis |
| V4-CERT-10 | HIGH | V4-CERT | UNRESOLVED | service roles citizen_svc, legal_svc, telephony_svc have BYPASSRLS in the bootstrapped DB (RLS inert) |
| V4-CERT-15 | CRITICAL | V4-CERT | UNRESOLVED | open CRITICAL code-scanning alerts on main: 5 (CodeQL 2, Trivy 3) |
| V4-CERT-16 | HIGH | V4-CERT | UNRESOLVED | open HIGH code-scanning alerts on main: 245 (CodeQL 68, Trivy 177) |
| FINAL-GATE-02 | HIGH | RUN1 | UNRESOLVED | Release Gate evidence audit, 11 gates UNMEASURED |

### Gates that passed

| Gate | Result | Detail | Evidence |
|---|---|---|---|
| Gate 1 install --frozen-lockfile | PASS | exit 0 | cert/build/g1-install.log |
| Gate 2 turbo build, web tsc, web next build | PASS | 99/99 tasks; tsc empty; next build ok | cert/build |
| Gate 3 forced typecheck, forced lint, jsx-a11y ratchet | PASS | 0 lint errors (warnings only) | cert/build |
| Gate 14 other architecture guards (18+) and guard unit tests | PASS | exit 0 | cert/build/a01..b-* |
| Gate 14 secret scan (repo scripts) | PASS | secret-scanner.mjs and ci.yml grep clean | cert/build/s01, s02 |
| Gate 14 dependency scan | PASS_WITH_KNOWN | 0 unallow-listed HIGH/CRITICAL; 11 allow-listed, 10 expire 2026-11-08, zod 2026-11-23; owner deferral recorded | cert/security-perf/cve-gate.log |
| Gate 16 bootstrap-postgres, tenant-index-guard, schema-drift-guard | PASS | 0 migration failures, 8 baselined drifts, no new | cert/db.json |
| Gate 12 root integration + eOffice loop-back | PASS | 133 passed, 9 skipped (LocalStack) | cert/db.json |
| Gate 6b remaining contract files; 19c module-gating-standalone | PASS | 45 tests; 10/10 | cert/contract-e2e.json |

### Gates executed only by GitHub CI (not run on the certification host)

These are recorded from the GitHub run record (snapshot 2026-10-26T04:42:48Z); this lane did not execute them.

| Gate | Status |
|---|---|
| Gate 8 Playwright E2E | NOT_RUN locally; CI job E2E (Playwright) success; Procurement E2E Gate success |
| Gate 7 live-stack contract score 10/10 | NOT_RUN locally; CI job Live Stack Verification success |
| Gate 15 Trivy container scan | NOT_RUN locally; CI Trivy jobs (hrms, gateway, finance) success |
| Mobile (Flutter) tests | NOT_RUN locally; CI job Mobile (Flutter) success |
| Accessibility axe, Mutation, Screen Verification, QA Readiness, L10/L11, ZAP DAST, CodeQL SAST job, CVE/SCA gate | executed only in GitHub CI; jobs success |

The GitHub CI run (`40258410831`) for the frozen SHA ended **failure**; the Docker image matrix jobs succeeded. Job table in `baseline-assessment.md`.

### NOT_RUN with no owner deferral

| Lane | Gate | Status | Reason |
|---|---|---|---|
| build | 4b Gateway SEC-021 real-subprocess test (GATEWAY_SPAWN_TESTS=1) | NOT_RUN | omitted for time after the main test failures; containers torn down |
| build | 14 gitleaks (local) | NOT_RUN | gitleaks not installed on cloudsphere-ec2 (GitHub CI ran it: FAIL, see CI table) |
| contract-e2e | 6c render-smoke contract (apps/web jsdom) | NOT_RUN | not executed in the lane (GitHub CI Contract Tests job executed it) |
| contract-e2e | 7 scripts/contract/score.mjs 10/10 on a live stack | NOT_RUN | needs live gateway stack on fixed shared ports |
| contract-e2e | 8 Playwright E2E; 19d journey e2e (tests/e2e-live, tests/e2e-personas, apps/web/e2e) | NOT_RUN | needs full live stack; prefer-CI rule |
| contract-e2e | mobile integration tests (apps/mobile Flutter) | NOT_RUN | flutter/dart not installed on EC2 |
| db | Web tsc / next build / LocalStack cross-process / Keycloak e2e | NOT_RUN | out of scope for the db lane; LocalStack absent (tests/integration/cross-process.localstack.test.ts skipped) |
| security-perf | 15 Trivy (local) | NOT_RUN | no local Trivy for the SHA (GitHub Security Scan Trivy jobs ran: see CI table) |
| security-perf | 17 Performance/load (k6 scripts/perf, tests/load; service N+1 suites) | NOT_RUN | needs a booted stack on shared dev Postgres/Redis, forbidden by the lane rules; only packages/db perf 3/3 and packages/cache perf-007 6/6 ran |
| regression | 20e web tsc / next build | NOT_RUN | outside the regression lane (build lane ran them: PASS) |

### Approvals and evidence completeness

- V4 HIGH and BLOCKED_FOR_APPROVAL PRs: approved ("close all by tomorrow morning"), reviewed CLEAN. Not covered: the new dependency in #2282; every NOT_RUN gate.
- Awaiting approval from earlier runs: 6 rows (listed in `deferred-approval-items.md`).
- Evidence incomplete: SEC-021 spawn test, perf/load, local E2E/journey/mobile/LocalStack/Keycloak, finance pfms-adapter rerun, render-smoke locally.
- Environment caveat: tests ran on amd64-emulated Postgres; some local-only failures (grant-service, analytics-service, IDOR timeouts) did not reproduce in GitHub CI or on rerun and are recorded as LOW/environmental, not dismissed.

### What would change the decision

Clear V4-INTEG-01, V4-CERT-02..07 (small test/baseline fixes); resolve or formally triage V4-CERT-10, V4-CERT-15, V4-CERT-16, FINAL-GATE-02 (Release Gate L3/L6/SLO evidence); resolve V4-CERT-17 gitleaks; run or have the owner defer the NOT_RUN gates; record the approval for the #2282 dependency and decide the 6 pending earlier-run approvals; rerun finance pfms-adapter on a migrated DB. Then recertify a new frozen SHA: this decision applies to `66b04aedd827b7e4fdcb402731d6d45a678badc8` only.

### Residual risk accepted by the owner (does not change the decision)

Credentials in git history (not rotated); CVE exceptions until 2026-11-08 / 2026-11-23; payroll visual snapshots stale; 27 coverage services and visual snapshots deferred.

<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Executed evidence (final checks on main `9d93535`; source `~/orch-logs/closure/final-checks.json`, logs in `~/orch-logs/closure/final/`)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm turbo typecheck --force --concurrency=4` | pass, 126/126 tasks |
| `pnpm turbo lint --concurrency=4` | pass, 67/67 tasks, 0 errors |
| web vitest `--maxWorkers=2` | pass: 2401 files, 19859 tests, 0 failed |
| web build (flock) | pass |
| `pnpm test:contract` | pass: 148 passed, 1 skipped |
| `scripts/ci` guards and scanners (31) | 28 exit 0 on first pass. `bundle-size-guard`, `schema-drift-guard`, `tenant-index-guard` failed only for missing inputs (no build log given; DB guards hit default :5435); re-run with the web build log and a disposable PG, all three exit 0. `money-precision`, `sql-injection`, `secret-scanner`, `package-exports` failed at baseline and pass now. |
| DB-backed service suites, 67 services, one disposable PG (non-superuser roles, `--maxWorkers=2`) | 62 of 67 green first pass (about 31.5k tests). Red: gateway, helpdesk, inventory, visitor, workflow. On rerun with a fresh PG plus redis sidecar: helpdesk, inventory, visitor pass; **workflow still fails 1 test; gateway fails the 2 tests that spawn tsx subprocesses.** Exit code of this item: 1. |

### Executed evidence (CI on GitHub)

| Run | Result |
|---|---|
| CI `9d93535` (#2147, latest completed on main) | green: Web Build, Typecheck & Lint, Secret Scan, Architecture Guard, Mobile, Accessibility, Procurement E2E Gate, Screen Verification, Quality Gates L10/L11, QA Readiness, Mutation, Contract Tests |
| CI `9d93535` Tests | **failure**: 122 of 123 turbo tasks passed; only `@civitasone/web#test` failed, on CreateContractForm GAP-CONTRACTS-NEW-02 (listed known-flaky in `~/orch-logs/known-flaky.txt`; passed in the local full run) |
| CI `9d93535` E2E (Playwright) | **failure** (also failed on `db755f3`) |
| CI `9d93535` Live Stack Verification, "Contract score must be 10/10" | **failure** (also on `db755f3`) |
| CI `9d93535` Release Gate (evidence audit) | **failure** (also on `db755f3`) |
| CI `9d93535` Schema Integrity L3, Integration Tests, Coverage Gate, Docker matrix, Docker build | skipped (because Tests failed) |
| Security Scan `9d93535` (8 jobs: CVE/SCA, dep audit, 3x Trivy, secret scan, ZAP, CodeQL) | success |
| CI `db755f3` (previous): Tests, Integration Tests and others | success; E2E, Live Stack Verification, Coverage Gate, Release Gate **failure** |
| Release Gate workflow, last 10 completed runs | skipped |

### Verifier's reasons for FAIL (executed by the verifier, quoted in substance)

1. **E2E (Playwright) red on main `9d93535`: 43 failed, 17 flaky, 544 passed.** About 79 failure messages are `expect(locator).toBeVisible`; 76 of them are "strict mode violation: `#page-heading` resolved to 2 or 3 elements". Many `(app)/**/loading.tsx` files render `<h1 id="page-heading">` while the page's own h1 is also present (my grep on the refreshed tree finds 43 `loading.tsx` files carrying `id="page-heading"`). About 20 failures are payroll `toHaveScreenshot` diffs; the others are hrms-payroll attendance, RBAC, payroll-config, hr-submodules page-load specs. This is a real app defect and is **unfixed**.
2. **Live Stack Verification "Contract score must be 10/10"** (`node scripts/contract/score.mjs`) fails on `db755f3` and `9d93535`; the step log could not be retrieved, so the cause is unexplained and unfixed.
3. **Release Gate (evidence audit)** fails on main: 11 gates UNMEASURED (L1, L2, L3, L4, L6 and others, "no evidence artifact found"), 4 gates PASS.
4. **CI Tests red** on the known-flaky NewContractForm test; passed 3 of 3 local re-runs. Because Tests failed, Coverage Gate, Integration Tests, Schema Integrity L3 and Docker jobs have no evidence on the head SHA. Coverage Gate also failed on `db755f3`.
5. **workflow-service `tests/delegations-routes.test.ts` "returns empty list for a fresh tenant"** is a test-hygiene defect: fixed tenant `aaaaaaaa-1111-4000-8000-aaa000000001`, asserts empty list. Fresh PG: full suite 1116/1116. Second run against the same DB: 1 failure. Passes in CI only because each job gets a fresh DB. Needs a unique tenant per run or cleanup.
6. Gateway tsx-spawn tests (ENOENT inside the container, a harness artifact), helpdesk, inventory and visitor failures were accepted by the verifier from the earlier report and CI, not re-run; the verifier recommends adding the helpdesk tests and the inventory DQ-FIN-03 test to the known-flaky list. (The verifier text available to me was cut off after this point; I have not reconstructed the rest.)

Verifier spot-checks that held (executed by the verifier on `9d93535`): CLOS2-S1-01 (17 tests), CLOS2-S3-01 renderMarkdown XSS probe (no attribute breakout), CLOS2-S3-03 and S3-11 (191 tests), CLOS2-S6-01 (7 tests), S6-02 numbering IST (30), S6-06 storage (13), S6-12 PFMS timeouts (6), S6-13 revenue billing date and drainage sequence numbers (suites green on a disposable PG), delegation IST and party scoping. The money-precision, sql-injection, secret-scanner and package-exports guards exit 0 on re-run.

### Status of the Run 1 blockers listed below (analysis from the refreshed tree; checked by reading current main)

| Run 1 blocker | Now |
|---|---|
| 1. DocVerificationChecklist raw `res.status` | no `res.status` in the file; guard passes per final checks. Closed. |
| 2. payroll-runs snapshots / KPI spec | snapshots ACCEPTED as known-stale by owner decision 2026-10-23 22:10 IST (accepted deferral, not a pending decision). |
| 3. plugins E2E mock | `apps/web/e2e/global-setup.ts` now mocks `/api/v1/plugins`. Closed in source. |
| 4. CVE-2026-94482 / Next.js | #2175 merged (Next 15.5.28). Security Scan on `9d93535` all 8 jobs success. Closed. |
| 5. DELEG-REVOKE-OWNERSHIP | #2174 merged. Closed (verifier saw it addressed in routes.ts). |
| 6. auditResource `medical_employee_record` | present at `auditResource.ts:78` (#2173). Closed. |
| 7. gates with no evidence | **still open**: Coverage Gate, Integration Tests, Schema Integrity L3, Live Stack Verification, Release Gate have no green run on `9d93535`. |
| 8. red service suites | gateway tsx-spawn (2) and workflow (1) still red locally; others pass on fresh PG. |

### Still blocking release (open as of this refresh)

1. E2E: the `#page-heading` duplicate-id defect (76 strict-mode violations) and the other page-load spec failures.
2. Live Stack Verification contract score step (unexplained).
3. Release Gate evidence audit (11 gates UNMEASURED).
4. CI Tests flake (CreateContractForm) causing downstream gates to be skipped.
5. workflow-service delegations-routes test non-idempotent (unique tenant per run needed).
6. Pending owner decisions in `deferred-approval-items.md`.

### Recommendations (not executed)

Fix `loading.tsx` duplicate `page-heading` ids (one PR; app defect), triage the remaining E2E specs, make the workflow delegations test hermetic, quarantine-or-fix the CreateContractForm flake at the root cause, find the `score.mjs` failing contract, produce evidence artifacts for the 11 UNMEASURED gates, then re-run CI on main and re-run verification. The FAIL stands until then.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

## Decision

**FAIL.** This is the PASS 4 independent verifier's decision, reproduced unchanged. Nothing in this report overrides it.

## Executed evidence (what was actually run)

- Integration `closure/pass3-integration` @ `cca1ae6461f162b636bdc4321969c5e9419e530d` (draft #2171, 16 PRs; #2161 excluded for conflicts).
- Green locally: install, typecheck (126/126), lint (0 errors, warnings only), `pnpm test:contract` (148 passed, 1 skipped), web build (485s), 20 of 31 guards (incl. bundle-size on rerun).
- Red locally: web vitest (1 failure, `auditResource.test.ts`, also red on origin/main), `raw-status-leak-guard` (1 NEW violation, #2166), baseline-failing guards (money-precision 151, secret-scanner 71, sql-injection 24, package-exports 10, same as baseline), 7 service suites (audit, gateway, helpdesk, identity, inventory, visitor, workflow; 19 services green).
- CI on #2171: red Architecture Guard, CVE / SCA Gate, CodeQL, E2E (Playwright), Tests, 3x Trivy container scan; 17 jobs green; 6 skipped.
- PASS 4 verifier re-ran `raw-status-leak-guard` (fails) and `auditResource.test.ts` (fails), and ran four test files plus auditResource (54/55 pass).

## Release blockers (from the verifier's list)

1. Architecture Guard failure: raw `res.status` in the thrown Error at `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx:65` (#2166, commit `6f98bca86`). Route it through `useFormError` or add a `status-leak-ok` suppression.
2. E2E `hrms-payroll/payroll-runs.spec.ts:28` expects a /pending/ tile that #2159 removed; five visual-regression snapshots (Payroll Runs List, Run Detail paid and draft, Empty payroll, Run not found) not regenerated.
3. E2E `plugins.spec.ts`: three tests fail because `/plugins/installed` now reads `GET /api/v1/plugins` (#2152) and `apps/web/e2e/global-setup.ts` does not mock it.
4. CVE-2026-94482 (Next.js App Router DoS) fails CVE / SCA and Trivy. Upgrade pending owner approval.
5. DELEG-REVOKE-OWNERSHIP (High): any workflow_user can revoke or list any delegation. Pending owner approval.
6. Web vitest 'auditResource covers every resource type the services emit' (missing `medical_employee_record`) is red on main and on the integration. Add the type to `HR_AUDIT_RESOURCE_TYPES` (from #2150).
7. Mandatory gates with no evidence: Coverage Gate, Integration Tests, Live Stack Verification, Schema Integrity (L3) were skipped; schema-drift-guard and tenant-index-guard were not evaluated.
8. Seven service suites red locally: audit, gateway, helpdesk, identity, inventory, visitor, workflow. Five of them (gateway, helpdesk, identity, visitor, workflow) fail the same way on origin/main.

Additional verifier findings: CLOS-FLAKY-DRAINAGE (Medium) unapproved; #2161's defects are not closed because it is excluded; the ml-insights test rewrite is a behaviour change, not a clean low-risk test fix; the spot-check requirement for FIXED defects is not met (8 distinct FIXED defects had no regression test run by the verifier; per-defect diffs not read).

## Status of this run's own work (executed facts)

- 39 LOW defects fixed with regression tests: 14 merged to main (#2155, #2157), 25 in open PRs (#2154, #2165, #2169, #2170) plus 9 flaky-test fixes in #2167. None is marked VERIFIED.
- 7 defects plus 4 other items are BLOCKED awaiting owner approval (`deferred-approval-items.md`).
- Seven security PRs merged during the run (`security-findings.md`).
- Loop bounds: PASS 1 to PASS 4 completed once; no correction cycles beyond the first are recorded in the sources I was given.

## Analysis (not executed evidence)

- Most red CI jobs are baseline/environmental per PASS 3 (CVE, auditResource, 19 E2E specs red on main), but that does not make them acceptable for release: a release candidate needs these gates green or explicitly waived by the owner.
- Four regressions are attributable to the integration (#2166, #2159 x2, #2152) and have small obvious fixes, which would be low-risk under the brief; they were not fixed because the bounded loop ended at PASS 4.
- Skipped gates are a larger risk than the failures: until Tests is green, Coverage Gate, Integration Tests, Live Stack Verification and Schema Integrity do not run, so correctness of the DB-touching changes (migrations 0038, 0039, 0046) in integration is unproven in CI.

## Recommendations (not executed)

1. Fix, in one small PR each or one bundle: DocVerificationChecklist raw status; add `medical_employee_record`; regenerate the five payroll snapshots and update the payroll KPI spec; mock `GET /api/v1/plugins` in e2e global-setup.
2. Decide the Next.js CVE upgrade and DELEG-REVOKE-OWNERSHIP (owner approval).
3. Re-run CI on the integration (or on main after merging) so the skipped gates execute; run schema-drift-guard and tenant-index-guard against a bootstrapped disposable DB.
4. Resolve the #2161 conflicts and reintegrate it before any release candidate.
5. Have a verifier run regression tests for all 39 fixes and mark VERIFIED where they pass.
6. Re-run the final verification after the above; the current FAIL stands until then.
