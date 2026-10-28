# Release readiness

<!-- V5-CERT-BEGIN -->
## V5 final UAT certification 2026-10-28 (frozen SHA `e2cbc29f038fd4552a2a924bc705ee45a13ef360`)

Scope: final UAT release certification of main at `e2cbc29f038fd4552a2a924bc705ee45a13ef360` (`e2cbc29f0`, the merge of #2348; its parents on main are #2349 `e978afb60` and bundle #2346 `35c9b722f`). Frozen SHA file: `~/orch-logs/closure/v5/FROZEN_SHA`. Five lanes (build, db, regression, contract-e2e, security-perf) wrote `~/orch-logs/closure/v5/cert/{build,db,regression,contract-e2e,security-perf}.json` plus per-lane log folders with `SHA256SUMS`; the consolidation is `~/orch-logs/closure/v5/cert/CONSOLIDATED.json` and `CONSOLIDATED.md`. All paths are on cloudsphere-ec2. **#2347 (D4c small modules, reviewed CLEAN) is not in this build** (owner choice C, 2026-10-28).

**Release decision (V5, UAT): PASS with exceptions** at `e2cbc29f0`. Performance and load tests are accepted-not-run for UAT (D2). This supersedes the V4 decision (FAIL at `66b04aedd`), which is kept lower in this file as history.

### Decision

**Release decision (V5, UAT): PASS with exceptions** at `e2cbc29f0`. Performance and load tests are accepted-not-run for UAT (D2). This supersedes the V4 decision (FAIL at `66b04aedd`), which is kept lower in this file as history.

Why PASS rather than the lane consolidation's BLOCKED: `CONSOLIDATED.md` was written before the owner's 2026-10-28 ~16:30 IST reply and recorded BLOCKED (not FAIL) for three open items: the CI Tests job red on the frozen SHA, five open HIGH code-scanning alerts, and stray rows in the shared dev Postgres :5435. It stated "A CI re-run plus D1 triage should allow PASS with exceptions". The owner then replied, verbatim, "1 accept, 2 dismiss and accept, 3 delete" (`~/orch-logs/closure/gapledger/owner-decisions-2026-10-28-c.md`), which accepts the flaky Tests job, dismisses/accepts the HIGH alerts and approves the cleanup. No CI re-run was done; the Tests-job red is accepted as a known flake, not proven green. The lane files and `CONSOLIDATED.*` were not edited.

**Verification of "no HIGH/CRITICAL product defect is open"** (re-checked against the lane files, not copied from the brief). The `newDefects` and gate entries in the five lane JSONs contain: (a) no CRITICAL; (b) HIGH only as REG5-01 (process incident, no product defect) and the five HIGH code-scanning alerts, of which #3683 and #20 are dismissed as false positives with reasons recorded and #3838, #2049, #2050 are owner-accepted until 2026-11-08; (c) every red lane gate is classified in the lane files as environment (c) or timing flake (b), each with an isolated rerun that passed, or as a fixture false positive: tests/security idor (5000 ms timeout on emulated amd64 PG; 11/11 at a 30 s diagnostic timeout), tests/data-integrity (7 failures that assume the shared dev-DB role state; D3), 3 service-suite flakes (audit-service x2, legal-service x1; all pass on isolated reruns), secret-scanner (test-fixture false positive), steering/governance (needs host-only `.kiro`; stale snapshots), quality-program L2/L4 (cannot load in a plain checkout), gitleaks 395 findings (triaged test/example noise; CI Secret Scan job success on 3031 commits). Limits of this check: gates marked `verified: false` in `CONSOLIDATED.json` were not individually re-opened by the consolidation, and the nightly-only failures under "not covered by an owner decision" were not classified by any lane.

### Lanes

| Lane | Gate rows | Status counts | Evidence |
|---|---|---|---|
| build | 50 | FAIL 5, PASS 45 | `~/orch-logs/closure/v5/cert/build.json`, folder `build/` |
| db | 15 | FAIL 3, NOT_RUN 1, PASS 11 | `~/orch-logs/closure/v5/cert/db.json`, folder `db/` |
| regression | 11 | FAIL 3, NOT_RUN 1, PASS 7 | `~/orch-logs/closure/v5/cert/regression.json`, folder `regression/` |
| contract-e2e | 5 | NOT_RUN 1, PASS 4 | `~/orch-logs/closure/v5/cert/contract-e2e.json`, folder `contract-e2e/` |
| security-perf | 20 | FAIL 3, NOT_RUN 1, PASS 16 | `~/orch-logs/closure/v5/cert/security-perf.json`, folder `security-perf/` |

Lane-level pass/fail detail is in `baseline-assessment.md` (full gate table), `regression-results.md` and `security-findings.md`.

### Owner-accepted exceptions

| # | Exception | Owner's words (verbatim) and date | Scope and evidence |
|---|---|---|---|
| 1 | Performance and load tests not run for UAT (D2) | "D2 accept with conditions, D3 post-UAT" (2026-10-28 ~10:00 IST) | Conditions: (a) during UAT week, a light perf smoke on the UAT environment (~20-50 simulated users on login, dashboards, create/approve flows) with response times recorded; (b) before production, a full load test on a production-sized environment is a mandatory release gate for production; (c) reports state the exception ("PASS with performance/load accepted-not-run for UAT"). Lane gate `perf-load-k6` = NOT_RUN (`security-perf.json`). Scheduled "Perf k6 Suite" run 40676301332 on this SHA also failed (not investigated). Source: `gapledger/owner-decisions-2026-10-26.md`. |
| 2 | CI Tests job red on the frozen SHA | "1 accept, 2 dismiss and accept, 3 delete" (2026-10-28 ~16:30 IST), item 1: "CI Tests job red on frozen SHA e2cbc29f0 only from the timing-flaky packages/ocr tests/process-stream.test.ts (passes 3/3 locally); accepted as a known flake for UAT; fix post-UAT." | CI run 40631438476. The saved CI log (`cert/contract-e2e/ci-tests-job.log`) shows two failed tests: `packages/ocr` `process-stream.test.ts` (pageConcurrency, 115 s in CI) and `services/report-service` `job-detail-and-schedule-status.integration.test.ts` ("scheduled report list"). The owner's wording names only the ocr test; the report-service test is a second failure that the same reply does not name (it is described as a rotating timing flake in the 2026-10-28 ~13:30 IST choice-C reply). Both pass 3/3 locally in the regression lane (`cert/regression/packages_ocr.ciflake-run{1,2,3}.json`, `gate-ci.log`). Side effect: Integration Tests, Quality Gates L3 (Schema Integrity), Coverage Gate and Release Readiness were skipped and Release Gate (evidence audit) failed on this SHA. |
| 3 | Trivy HIGH node-forge CVE-2026-85393 and uuid CVE-2026-41907 (x2) accepted until 2026-11-08; CodeQL #3683 and #20 dismissed | Same reply, item 2: "DISMISS CodeQL #3683 (false positive: API keys are 256-bit randomBytes from identity-service generateSecret; SHA-256 appropriate) and #20 (fixed: #2344 added @civitasone/rate-limit to all 46 authPlugin services; tests/architecture/auth-plugin-rate-limit.test.ts 67/67). ACCEPT Trivy HIGH node-forge CVE-2026-85393 and uuid CVE-2026-41907 (x2) as UAT exceptions until 2026-11-08." (2026-10-28 ~16:30 IST) | GitHub state read on 2026-10-28 with `gh api code-scanning/alerts/<n>`: #3683 and #20 are `dismissed`, reason "false positive", with the comments recorded. Open HIGH alerts remaining on main: Trivy #3838 (node-forge), #2049 and #2050 (uuid). node-forge is also on `cve-allowlist.json` to 2026-11-08; the uuid alerts are not on the CVE allow-list (the CVE/SCA gate passes: 0 un-allow-listed CRITICAL/HIGH). Rate-limit test 67/67 re-run in the security-perf lane. |
| 4 | Coverage Gate red for 27 services | Owner's own wording not found in the logs read. Listed as an accepted exception in `CONSOLIDATED.json` (`exceptionsUsed`) and in the V4 `deferred-approval-items.md` row of 2026-10-25, which records it as relayed by the orchestrator, not quoted. | On this SHA the Coverage Gate check shows "skipped" (it follows the red Tests job), so no fresh coverage figure exists for this build. |
| 5 | Remaining scanner backlog (D1) | "1 yes, 2 yes, 3 approve all" (2026-10-27 ~15:30 IST), item 1: accept the remaining Debian image CVEs (about 830 medium/low), the fastify 4.x items (deferred with the major upgrade, exp 8 Nov) and the 326 CodeQL notes as a known UAT backlog. | `security-perf.json` code-scanning gate: 885 open alerts on main on the frozen SHA (CodeQL 2 high / 1 medium / 24 warning / 303 note; Trivy 3 high / 290 medium / 259 low / 3 note) before the two CodeQL dismissals. 11 CVE allow-list entries expire 2026-11-08, zod GHSA-mrhx-c7xc-m3w5 expires 2026-11-23. |
| 6 | 3 credentials in git history (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password) | "continue with the current credentials ,no change" (2026-10-25, V4; `deferred-approval.md`) | Risk accepted, not rotated. Rotation after UAT is the plan recorded in `CONSOLIDATED.json` (`exceptionsUsed`: "rotate post-UAT") and in the task brief; the 2026-10-25 reply itself sets no date. Values are intentionally not reproduced in these reports. |
| 7 | D3: startup check that service DB roles cannot bypass RLS | "D2 accept with conditions, D3 post-UAT" (2026-10-28 ~10:00 IST) | Not a UAT gate. Informational lane gate `rls-bypass-roles-informational`: in a partially bootstrapped disposable PG, 66 `*_svc` roles, 0 superuser/BYPASSRLS from the product DDL; 9/9 `*_scanner` roles have BYPASSRLS by design. `tests/data-integrity` 7 failures assume the shared dev-DB BYPASSRLS state (see registry REG5-D). |
| 8 | #2347 (D4c small modules) not in this build | "ok do  C" (2026-10-28 ~13:30 IST). Option C: certify main `e2cbc29f0` WITHOUT #2347 (reviewed CLEAN, blocked only by rotating timing flakes in untouched packages: install step-lifecycle, report schedule-list, ocr hardening ReDoS); it merges after the certification and ships in a follow-up UAT build. | `gapledger/owner-decisions-2026-10-28-c.md`. H4 ("H1 yes, H2 defer, H3 yes, H4 yes", 2026-10-28 ~06:50 IST) accepted removing the unstored Register Domain fields via #2339 -> #2347, so that item also lands with the follow-up build. |

### Not covered by an owner decision (read before relying on the PASS)

| Item | State | Why it is not an accepted exception |
|---|---|---|
| Nightly run 40661951596 (2026-10-28 09:08 UTC, same SHA): "Accessibility Full Sweep (WCAG 2.2 AA, axe-core)" | failure: 3 failed / 722 passed. Failed: `/finance/medical` and `/finance/travel` (financeofficer list) and the aggregate "enforce baseline" test (routes listed as not measured, `a11y.spec.ts:456`). | Not in the five certification lanes and not covered by any owner decision found. Not investigated beyond the CI log. The default CI "Accessibility (WCAG 2.2 AA, axe-core)" job is success. |
| Same nightly: "Three-Way-Match Live (LocalStack SQS)" | failure: `three-way-match-live.test.ts` 2 failed / 1 passed, both SQS wait timeouts (`:77`, `:127`). | Not investigated; no owner decision found. Not run locally either (needs LocalStack; lane status NOT_RUN). |
| Same nightly: "Lighthouse Performance Baseline" | failure: `next build` ran out of memory on the runner (exit 134). The regular "Web Build" job is success. | Runner-memory failure in a nightly-only job; D2 covers performance exceptions in general. |
| "Perf k6 Suite" scheduled run 40676301332 | failure | Falls under D2 (perf/load accepted not run); not investigated. |
| Release Gate (evidence audit), Integration Tests, L3 Schema Integrity, Coverage Gate, Release Readiness on CI run 40631438476 | failure / skipped | Consequence of the red Tests job (exception 2); L3 and integration CI evidence does not exist for this SHA. The db lane ran the equivalent bootstrap, schema-drift, tenant-index and integration gates locally (all PASS). |
| quality-program L2 (authz-matrix) and L4 (input-validation) locally | not runnable in a plain checkout (REG5-06) | Unverified by the regression lane. The CI "Live Stack Verification" job, which includes "Run live quality lanes (L1 tenant isolation, L2 authz, L4 API contract)", is success on this SHA. |
| Dev-only fallback RSA key in `ecosystem.config.js:166` | low; gitleaks finding | `CONSOLIDATED.md`: owner to confirm it falls under the accepted history-credentials exception. No confirmation found. |
| Mobile integration, LocalStack/Keycloak/pgbouncer live tests, live-stack e2e-live/personas | NOT_RUN | No device/emulator or external infra on the host; unchanged from V4. CI "Mobile (Flutter)" check is success (unit/widget level). |

### Incidents recorded

**Shared-DB incident (:5435), regression lane (REG5-01, gate R5-10).** The regression lane's first forward/delta runs (09:14-09:31 UTC) pinned `PGPORT`/`DATABASE_URL` and scanner DSNs but not the per-service test DSNs (about 30 test files default to the shared Postgres on :5435), so about 15 integration test files connected to the shared dev database. Evidence: the shared Postgres log showed failed statements only (320x `retry_payload` of `deliveries` missing, 137x `composition.tenant_enforcement_mode` missing, 10x `is_control` of `finance_heads` missing); successful statements are not logged, so writes may have succeeded. Those runs are kept in `cert/regression/run1-env-leak-5435/` and are not used as evidence; forward and delta were re-run 09:33-09:47 UTC with every variable pinned to the lane's own container. Detection and cleanup (as reported to this author by the orchestrator; the scan output and delete log were not found under `~/orch-logs/closure` when this report was written, so they are not cited as files): a read-only scan of all 64 databases on :5435 located 56 test rows in `civitas_admin` `composition.tenant_entitlement` for fixture tenants `0a000000-0000-4000-8000-00000000e001` and `0a000000-0000-4000-8000-00000000f001`, written at 2026-10-28 09:19 UTC by `tests/cross-service-live/module-gating-standalone.live.test.ts` (the contract-e2e lane's `index.txt` shows that file run at 09:18:58-09:19:38 UTC). The owner approved deletion ("1 accept, 2 dismiss and accept, 3 delete", item 3: "DELETE: 56 test rows ... written to the shared dev DB :5435 at 2026-10-28 09:19 UTC by the E1 regression lane"); 56 rows were deleted. Earlier, related :5435 cases: the read-only check of #2330 reviewer rows (approved 2026-10-27 ~12:10 IST) and deletion of 6 roadcut test rows plus outbox rows by exact id (approved 2026-10-27 ~15:30 IST). Process fix (fail-closed DSN defaults) is a post-UAT item.

**GRN-detail 500 caught on the live stack.** After bundle #2346 (`35c9b722f`, UAT B4 + D4c bundle) the live stack returned HTTP 500 on the procurement GRN detail route. It was fixed in #2348 (`e2cbc29f0`, "fix(main): procurement GRN detail 500 on live stack + stock new-item test"), which is the frozen SHA. Evidence on this SHA: CI "Live Stack Verification" job 122723682047 success, "Verify all screens against live gateway" and "Contract score must be 10/10" steps success (10/10), "Procurement E2E Gate" job 122723682092 success (`cert/contract-e2e/ci-evidence.log`). The nightly "Three-Way-Match Live (LocalStack SQS)" run on the same SHA failed (see not-covered list); the lane did not investigate it.

### CI state on the frozen SHA

CI check-runs on the frozen SHA (`gh api commits/<sha>/check-runs`, read 2026-10-28; Docker image build jobs all success): success - Typecheck & Lint, Web Build, Architecture Guard, Contract Tests, Screen Verification Gate, Live Stack Verification, E2E (Playwright), Procurement E2E Gate, Accessibility (WCAG 2.2 AA, axe-core), Secret Scan, CVE / SCA Gate, CodeQL SAST, Dependency Audit, Trivy (finance, gateway, hrms), Mobile (Flutter), Mutation Testing, QA Readiness, Quality Gates L10/L11, ZAP DAST. failure - Tests (see exception 2), Release Gate (evidence audit), and the nightly-only Accessibility Full Sweep, Three-Way-Match Live, Lighthouse Performance Baseline and Build fleet + run k6 suite. skipped - Integration Tests, Quality Gates L3, Coverage Gate, Release Readiness, Create GitHub Release. The jobs API returned HTTP 502 for run 40631438476 during the lanes, so lane-level CI statements rest on check-runs and per-job logs saved under `cert/contract-e2e/`.

### Pre-production conditions

Before production (not UAT gates): full load test on a production-sized environment (D2 condition b, mandatory); credential rotation; re-validate or retire the CVE allow-list entries; resolve the nightly failures; the second approver for theme publish (owner decision 34 of 2026-10-26).

### Post-UAT list

1. Fix flaky timing tests: `packages/ocr` process-stream pageConcurrency; `services/report-service` job-detail/schedule list; install-service step-lifecycle; citizen-service service-gaps (SVC-090); helpdesk ticket-payload-shapes; legal-service advocate-master; notification role-desk-fanout; audit-service exports/risk routes under parallel load.
2. Resolve the duplicate crm-service migration number `0112` (two files, added by #1938 and #1946; `cert/regression/gate-static.log`).
3. Make the shared-DB fallbacks fail closed: about 30 test files and the bootstrap/schema-drift/scanner DSN variables default to :5435 (REG5-01).
4. Plan the major upgrades behind the allow-listed advisories: fastify 4.x (5 entries), drizzle-orm, find-my-way, extract-zip (2), zod 3.x; re-validate the allow-list before 2026-11-08 (11 entries) and 2026-11-23 (zod). Node-forge and uuid patches when a fix exists.
5. Raise coverage for the 27 services behind the Coverage Gate.
6. Speed up CI (the frozen-SHA CI run took 46 minutes and the ocr test took 115 s on the runner).
7. Rotate the 3 credentials that are in git history (exception 6) and confirm the `ecosystem.config.js:166` dev fallback key.
8. D3: add the startup check that service DB roles cannot bypass RLS; make `tests/data-integrity` independent of dev-DB state.
9. Ship #2347 (D4c small modules, plus the H4 Register Domain field removal) in a follow-up UAT build.
10. About 20 product decisions are still open or deferred (for example H2 LGD district/block pickers on works proposals, H3 finance hand-off still sending `deductions: []`, G4 requester notice on approved downgrade, second approver for theme publish before production). The full list is not itemised in the lane files read for this report; see `deferred-approval-items.md`.
11. Fix or retire stale tooling: `scripts/ci/secret-scanner.mjs` fixture false positive (not wired into CI), `scripts/governance` snapshot tests that need the host-only `.kiro`, and make `tests/quality-program` L2/L4 runnable from a plain checkout.
12. Investigate the nightly failures listed under "not covered" above.

### Change from V4

| Topic | V4 (`66b04aedd`, FAIL) | V5 (`e2cbc29f0`) |
|---|---|---|
| Open code-scanning alerts on main | 2421 (5 CRITICAL, 245 HIGH) | 885 (0 CRITICAL, 5 HIGH: 2 dismissed, 3 accepted) |
| authz-tenant-scanner (SEC-014) | FAIL (4 stale baseline entries) | PASS (37 tracked legacy entries) |
| tests/cross-service (flows) | FAIL (5 failed / 9 passed) | PASS (15/15) |
| maker-checker / grant / citizen suites | FAIL | PASS |
| payroll-posting-history (cross-service-live) | 2/4 | 4/4 |
| tests/security | 3 failed, then 1 (incl. a deterministic inventory-service failure) | inventory fixed; only 5000 ms idor timeouts on emulated PG remain |
| tests/data-integrity | 7 failed / 19 passed | 7 failed / 19 passed (unchanged; env/D3) |
| Service suites | several failing | 67 services, 46114 tests, 46078 passed, 3 flaky (pass on isolated rerun) |
| secret-scanner.mjs | PASS | FAIL (fixture false positive added by #2312) |
| finance-service pfms/traces adapters | FAIL (unmigrated DB) | PASS 28/28 (own migrated PG) |

<!-- V5-CERT-END -->

<!-- V4-CERT-BEGIN -->
## [Superseded by V5 above; history] V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

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
