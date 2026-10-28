# Deferred approval items

<!-- V5-CERT-BEGIN -->
## V5 final UAT certification 2026-10-28 (frozen SHA `e2cbc29f038fd4552a2a924bc705ee45a13ef360`)

Scope: final UAT release certification of main at `e2cbc29f038fd4552a2a924bc705ee45a13ef360` (`e2cbc29f0`, the merge of #2348; its parents on main are #2349 `e978afb60` and bundle #2346 `35c9b722f`). Frozen SHA file: `~/orch-logs/closure/v5/FROZEN_SHA`. Five lanes (build, db, regression, contract-e2e, security-perf) wrote `~/orch-logs/closure/v5/cert/{build,db,regression,contract-e2e,security-perf}.json` plus per-lane log folders with `SHA256SUMS`; the consolidation is `~/orch-logs/closure/v5/cert/CONSOLIDATED.json` and `CONSOLIDATED.md`. All paths are on cloudsphere-ec2. **#2347 (D4c small modules, reviewed CLEAN) is not in this build** (owner choice C, 2026-10-28).

**Release decision (V5, UAT): PASS with exceptions** at `e2cbc29f0`. Performance and load tests are accepted-not-run for UAT (D2). This supersedes the V4 decision (FAIL at `66b04aedd`), which is kept lower in this file as history.

### V5 owner decisions and deferred items

Verbatim owner replies are in `~/orch-logs/closure/gapledger/owner-decisions-2026-10-26.md` (it accumulates entries through 2026-10-28), `owner-decisions-2026-10-28-c.md` and `~/orch-logs/closure/deferred-approval.md`.

#### Exceptions that make the release PASS with exceptions

| # | Exception | Owner's words (verbatim) and date | Scope and evidence |
|---|---|---|---|
| 1 | Performance and load tests not run for UAT (D2) | "D2 accept with conditions, D3 post-UAT" (2026-10-28 ~10:00 IST) | Conditions: (a) during UAT week, a light perf smoke on the UAT environment (~20-50 simulated users on login, dashboards, create/approve flows) with response times recorded; (b) before production, a full load test on a production-sized environment is a mandatory release gate for production; (c) reports state the exception ("PASS with performance/load accepted-not-run for UAT"). Lane gate `perf-load-k6` = NOT_RUN (`security-perf.json`). Scheduled "Perf k6 Suite" run 40676301332 on this SHA also failed (not investigated). Source: `gapledger/owner-decisions-2026-10-26.md`. |
| 2 | CI Tests job red on the frozen SHA | "1 accept, 2 dismiss and accept, 3 delete" (2026-10-28 ~16:30 IST), item 1: "CI Tests job red on frozen SHA e2cbc29f0 only from the timing-flaky packages/ocr tests/process-stream.test.ts (passes 3/3 locally); accepted as a known flake for UAT; fix post-UAT." | Main CI run 40631438476 has two attempts. Attempt 1 (`cert/contract-e2e/ci-tests-job.log`): the Tests job failed on two tests, `packages/ocr` `process-stream.test.ts` (pageConcurrency, 115 s in CI) and `services/report-service` `job-detail-and-schedule-status.integration.test.ts` ("scheduled report list"). Attempt 2 (re-run; `gh api repos/dbn1972/civitasone-suite/actions/runs/40631438476/attempts/2/jobs`, Tests job 122723678115, completed 2026-10-28T09:46Z): the Tests job failed ONLY on the same `packages/ocr` `process-stream.test.ts` test (1 failed / 296 passed); the report-service test passed (5/5). The remaining red is therefore exactly the test the owner's reply names. Both tests also pass 3/3 locally in the regression lane (`cert/regression/packages_ocr.ciflake-run{1,2,3}.json`, `gate-ci.log`). Side effect on the frozen SHA's first attempt: Integration Tests, Quality Gates L3 (Schema Integrity), Coverage Gate and Release Readiness were skipped and Release Gate (evidence audit) failed. |
| 3 | Trivy HIGH node-forge CVE-2026-85393 and uuid CVE-2026-41907 (x2) accepted until 2026-11-08; CodeQL #3683 and #20 dismissed | Same reply, item 2: "DISMISS CodeQL #3683 (false positive: API keys are 256-bit randomBytes from identity-service generateSecret; SHA-256 appropriate) and #20 (fixed: #2344 added @civitasone/rate-limit to all 46 authPlugin services; tests/architecture/auth-plugin-rate-limit.test.ts 67/67). ACCEPT Trivy HIGH node-forge CVE-2026-85393 and uuid CVE-2026-41907 (x2) as UAT exceptions until 2026-11-08." (2026-10-28 ~16:30 IST) | GitHub state read on 2026-10-28 with `gh api code-scanning/alerts/<n>`: #3683 and #20 are `dismissed`, reason "false positive", with the comments recorded. Open HIGH alerts remaining on main: Trivy #3838 (node-forge), #2049 and #2050 (uuid). node-forge is also on `cve-allowlist.json` to 2026-11-08; the uuid alerts are not on the CVE allow-list (the CVE/SCA gate passes: 0 un-allow-listed CRITICAL/HIGH). Rate-limit test 67/67 re-run in the security-perf lane. |
| 4 | Coverage Gate red for 27 services | PENDING OWNER CONFIRMATION. The owner's own wording was not found in the logs; written confirmation has been requested and is not yet recorded. Listed as an exception in `CONSOLIDATED.json` (`exceptionsUsed`) and in the V4 `deferred-approval-items.md` row of 2026-10-25, which records it as relayed by the orchestrator, not quoted. | On this SHA the Coverage Gate check was skipped in the first CI attempt (it follows the red Tests job), so no fresh coverage figure exists for this build. This exception is not counted as owner-accepted until the verbatim reply is added. |
| 5 | Remaining scanner backlog (D1) | "1 yes, 2 yes, 3 approve all" (2026-10-27 ~15:30 IST), item 1: accept the remaining Debian image CVEs (about 830 medium/low), the fastify 4.x items (deferred with the major upgrade, exp 8 Nov) and the 326 CodeQL notes as a known UAT backlog. | `security-perf.json` code-scanning gate: 885 open alerts on main on the frozen SHA (CodeQL 2 high / 1 medium / 24 warning / 303 note; Trivy 3 high / 290 medium / 259 low / 3 note) before the two CodeQL dismissals. 11 CVE allow-list entries expire 2026-11-08, zod GHSA-mrhx-c7xc-m3w5 expires 2026-11-23. |
| 6 | 3 credentials in git history (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password) | "continue with the current credentials ,no change" (2026-10-25, V4; `deferred-approval.md`) | The owner accepted the risk and did not rotate. Rotation after UAT is a RECOMMENDATION recorded in `CONSOLIDATED.json` and the task brief, not an owner decision; the owner's reply sets no rotation date. Values are intentionally not reproduced in these reports. |
| 7 | D3: startup check that service DB roles cannot bypass RLS | "D2 accept with conditions, D3 post-UAT" (2026-10-28 ~10:00 IST) | Not a UAT gate. Informational lane gate `rls-bypass-roles-informational`: in a partially bootstrapped disposable PG, 66 `*_svc` roles, 0 superuser/BYPASSRLS from the product DDL; 9/9 `*_scanner` roles have BYPASSRLS by design. `tests/data-integrity` 7 failures assume the shared dev-DB BYPASSRLS state (see registry REG5-D). |
| 8 | #2347 (D4c small modules) not in this build | "ok do  C" (2026-10-28 ~13:30 IST). Option C: certify main `e2cbc29f0` WITHOUT #2347 (reviewed CLEAN, blocked only by rotating timing flakes in untouched packages: install step-lifecycle, report schedule-list, ocr hardening ReDoS); it merges after the certification and ships in a follow-up UAT build. | `gapledger/owner-decisions-2026-10-28-c.md`. H4 ("H1 yes, H2 defer, H3 yes, H4 yes", 2026-10-28 ~06:50 IST) accepted removing the unstored Register Domain fields via #2339 -> #2347, so that item also lands with the follow-up build. |

#### Other decisions recorded for this cycle

| Date (IST) | Owner reply (verbatim) | Effect |
|---|---|---|
| 2026-10-26 | "approve all" | 42 B2 gap-ledger questions approved as recommended (list in `owner-decisions-2026-10-26.md`). |
| 2026-10-27 ~06:50 | "1 yes, 2 approve all, 3 yes, 4 B" | Dismiss 3 CodeQL false positives; follow-ups F1-F14; role-based notification delivery before UAT; build B4 (65 buildable ledger items) before UAT; final certification 2026-10-28. |
| 2026-10-27 ~12:10 | "1 yes, 2 yes, 3 yes, 4 approve all" | `pm2 resurrect` of the 35 saved processes; SIGUSR1 to kiro's tmux server; read-only :5435 check of stray rows (show owner before deleting); all 45 D4c recommendations (9 confirm-only, 8 deferred as known gaps, 29 to build). |
| 2026-10-27 ~15:30 | "1 yes, 2 yes, 3 approve all" | D1 code-scanning plan and backlog (exception 5); delete 6 roadcut test rows from :5435 by exact id; G1-G11 as recommended. |
| 2026-10-28 ~06:50 | "H1 yes, H2 defer, H3 yes, H4 yes" | H1: add role `bid_opening_committee` (shipped as #2349); H2 DEFER (post-UAT): LGD district/block pickers, UAT keeps free-text "Tehsil / Block"; H3: accept built-in starting deduction rates for UAT (SD 5%, IT TDS 2%, GST TDS 2%, labour cess 1%, retention 0%), finance to confirm in UAT, follow-up: finance hand-off still sends `deductions: []`; H4: accept removal of unstored Register Domain fields (#2339 -> #2347). |
| 2026-10-28 ~10:00 | "D2 accept with conditions, D3 post-UAT" | Exceptions 1 and 7. |
| 2026-10-28 ~13:30 | "ok do  C" | Exception 8 (certify without #2347). |
| 2026-10-28 ~16:30 | "1 accept, 2 dismiss and accept, 3 delete" | Exceptions 2 and 3; :5435 cleanup (56 rows). |
| 2026-10-25 (V4) | "close all by tomorrow morning" | Integrate V4 HIGH and BLOCKED_FOR_APPROVAL PRs after independent review is CLEAN and CI passes. |
| 2026-10-26 (V4) | "ok" | New dependency `@fastify/multipart` 8.3.1 (visitor-service, #2282 via #2280) approved. |
| 2026-10-23 22:10 (V4) | (recorded in `deferred-approval.md`) | payroll visual-regression snapshots accepted as known-stale. |

#### Not covered by an owner decision

| Item | State | Why it is not an accepted exception |
|---|---|---|
| Nightly run 40661951596 (2026-10-28 09:08 UTC, same SHA, job 122726887656): "Accessibility Full Sweep (WCAG 2.2 AA, axe-core)" | failure: 3 failed / 722 passed. The two route failures are not WCAG violations: the log says "/finance/medical REDIRECTED to /hr/medical as financeofficer" and "/finance/travel REDIRECTED to /hr/travel as financeofficer". The third failure is the aggregate baseline test (`a11y.spec.ts:456`), which fails only because those two routes could not be measured. | Classified as test maintenance, not a product defect: the sweep's route list is stale after those pages moved to HR. Update the route list post-UAT (post-UAT item 12). 722 checked routes pass. Default CI "Accessibility (WCAG 2.2 AA, axe-core)" job is success. |
| Same nightly: "Three-Way-Match Live (LocalStack SQS)" | failure: `three-way-match-live.test.ts` 2 failed / 1 passed, both SQS wait timeouts (`:77`, `:127`). | Environment-suspected (LocalStack SQS in CI) but UNVERIFIED: not investigated, no owner decision found. Not run locally (needs LocalStack; lane status NOT_RUN). |
| Same nightly: "Lighthouse Performance Baseline" | failure: `next build` ran out of memory on the runner (exit 134). The regular "Web Build" job is success. | Environment-suspected (runner memory) but UNVERIFIED: nightly-only, not investigated, no owner decision found. |
| "Perf k6 Suite" scheduled run 40676301332 | failure | Falls under D2 (perf/load accepted not run); not investigated. |
| Release Gate (evidence audit), Integration Tests, L3 Schema Integrity, Coverage Gate, Release Readiness on CI run 40631438476 | failure / skipped | Consequence of the red Tests job (exception 2); L3 and integration CI evidence does not exist for this SHA. The db lane ran the equivalent bootstrap, schema-drift, tenant-index and integration gates locally (all PASS). |
| quality-program L2 (authz-matrix) and L4 (input-validation) locally | not runnable in a plain checkout (REG5-06) | Unverified by the regression lane. The CI "Live Stack Verification" job, which includes "Run live quality lanes (L1 tenant isolation, L2 authz, L4 API contract)", is success on this SHA. |
| Dev-only fallback RSA key in `ecosystem.config.js:166` | low; gitleaks finding | `CONSOLIDATED.md`: owner to confirm it falls under the accepted history-credentials exception. No confirmation found. |
| Mobile integration, LocalStack/Keycloak/pgbouncer live tests, live-stack e2e-live/personas | NOT_RUN | No device/emulator or external infra on the host; unchanged from V4. CI "Mobile (Flutter)" check is success (unit/widget level). |

#### Pre-production conditions

Before production (not UAT gates): full load test on a production-sized environment (D2 condition b, mandatory); credential rotation; re-validate or retire the CVE allow-list entries; resolve the nightly failures; the second approver for theme publish (owner decision 34 of 2026-10-26).

#### Post-UAT list

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
12. Update the nightly accessibility sweep route list (`/finance/medical` and `/finance/travel` now redirect to `/hr/medical` and `/hr/travel`) and investigate the other nightly failures listed under "not covered" (Three-Way-Match Live SQS timeouts, Lighthouse runner OOM; both unverified).

<!-- V5-CERT-END -->

<!-- V4-CERT-BEGIN -->
## [Superseded by V5 above; history] V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 deferred and approval items

#### Owner decisions recorded for this cycle

| Date | Decision | Wording | Status |
|---|---|---|---|
| 2026-10-25 | Credential rotation (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password, all previously present in git history) | Owner, verbatim in chat: "continue with the current credentials ,no change" (source `~/orch-logs/closure/deferred-approval.md`) | ACCEPTED_RISK, not rotated, not a release blocker by owner decision |
| 2026-10-25 | Integration of V4 HIGH and BLOCKED_FOR_APPROVAL PRs | Orchestrator asked "may I merge the 16 high-severity fixes and the 14 protected-area fixes once they pass review?"; owner replied, verbatim: "close all by tomorrow morning" (source `deferred-approval.md`) | Approval to integrate after independent review CLEAN and CI gate; no review or gate step waived. Does not cover the new dependency in #2282 or any NOT_RUN gate |
| 2026-10-25 | Run 3 BLOCKED_FOR_APPROVAL items | Quoted in the #2279 PR body: "yes approved to fix all" | 29 findings fixed and merged in #2279 |
| 2026-10-25 | fastify / drizzle-orm / find-my-way major upgrades | Relayed by the orchestrator task for this certification (the owner's own wording is not in the logs this lane could read, so it is not quoted): deferred until after the outstanding tasks | DEFERRED; CVE exceptions expire 2026-11-08 (13 days after the certification date) |
| 2026-10-25 | zod 3.x | Relayed by the orchestrator task: exception accepted | Exception GHSA-mrhx-c7xc-m3w5 expires 2026-11-23 |
| 2026-10-25 | 27 coverage services and visual snapshots | Relayed by the orchestrator task: accepted deferrals | ACCEPTED_DEFERRAL; payroll visual-regression snapshots also accepted known-stale on 2026-10-23 22:10 IST (deferred-approval.md) |

#### Approval status (computed)

BLOCKED_FOR_APPROVAL rows across all runs: 6; V4 cycle rows awaiting approval: 0 (all V4 HIGH/BLOCKED PRs were integrated under "close all by tomorrow morning"). The pending rows are carried over from earlier runs, unchanged and not re-checked in V4 certification:

| ID | Sev | Run | Status |
|---|---|---|---|
| CLOS-S1-17 | MEDIUM | RUN1 | BLOCKED_FOR_APPROVAL |
| CLOS-S4-04 | MEDIUM | RUN1 | BLOCKED_FOR_APPROVAL |
| CLOS-S5-05 | MEDIUM | RUN1 | BLOCKED_FOR_APPROVAL |
| CLOS-S6-02 | LOW | RUN1 | BLOCKED_FOR_APPROVAL |
| CLOS-S6-06 | MEDIUM | RUN1 | BLOCKED_FOR_APPROVAL |
| CLOS2-S2-09 | MEDIUM | RUN2 | BLOCKED_FOR_APPROVAL |

#### Open approval-evidence items (not decided by the owner in any record this lane could read)

1. **#2282 / V4-F-02 new runtime dependency** `@fastify/multipart` 8.3.1 (exact pin; lockfile additions: multipart, busboy, deepmerge, error, stream-wormhole). The remediation lane marked it as needing owner approval; the PR carries no APPROVAL REQUIRED tag; the blanket approval covers HIGH and BLOCKED_FOR_APPROVAL PRs only. Needs an explicit owner acknowledgement or removal.
2. **Gate waivers**: none recorded. Every NOT_RUN mandatory gate below therefore has no owner deferral: gateway SEC-021 real-subprocess test, performance/load (gate 17), local Playwright/journey E2E, local live-stack contract score, local gitleaks, local Trivy, mobile tests, LocalStack cross-process, Keycloak e2e. (GitHub CI executed E2E, Live Stack Verification, Trivy and mobile jobs for the SHA and they succeeded; see `release-readiness.md`.)
3. **Time-boxed exceptions**: 10 CVE exceptions expire 2026-11-08; zod 2026-11-23.
4. **Decisions needed on certification findings**: whether `adv_permit_directory`/`building_permit_directory` get RLS or a justified baseline (V4-CERT-03); whether the two gitleaks findings are fake test values (V4-CERT-17); production role attributes (V4-CERT-10); triage policy for 5 critical / 245 high scanner alerts (V4-CERT-15/16).
5. **Deferred feature work from V4 notes**: none outstanding after cycle 2 (V4-A-07 tender, V4-D-02 second half, V4-B-01 persistence, V4-G-01, V4-F-02, V4-C-04 rest, V4-B-03 were all completed in cycle 2).

#### Not-run gates (no owner deferral)

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

<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Accepted deferrals (decided; not pending)

- **Payroll visual-regression snapshots**: ACCEPTED as known-stale for this release (owner, 2026-10-23 22:10 IST), like the 27 coverage services. Regenerating them via a CI x86 job is a follow-up. They do not block PASS.
- 27 services under the coverage threshold: accepted known-stale per the same owner decision (list not reproduced here; source: the owner decision text in `~/orch/closure-brief.md`).

### Resolved since the Run 1 list (previously pending, now approved and merged)

| Item | Resolution |
|---|---|
| CLOS-CVE-NEXT (High) | #2175 merged, Next 15.5.28 |
| DELEG-REVOKE-OWNERSHIP (High) | #2174 merged |
| DELEG-UTC (Medium) | #2181 (via #2193) |
| CLOS-FLAKY-DRAINAGE (Medium) | #2182 (via #2193), DB sequences |
| CLOS2-S1-01, S3-01, S3-03, S3-11, S6-01, S6-02, S6-06, S6-12, S6-13 | owner-approved (`~/orch-logs/closure/run2-blocked-approved.json`), fixed in #2186/#2187/#2188 (via #2193) |
| Run 1 CLOS-S6-07 (workflow substitute lookup UTC) | `resolver.ts` now uses `todayIST()` (read on current main) |

### Still PENDING owner decision (checked against current main on 2026-10-24)

| ID | Severity | Where | Status on current main |
|---|---|---|---|
| CLOS-S1-17 | Medium | `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx:46,49` | UTC `T00:00:00.000Z` / `T23:59:59.999Z` boundaries still present; audit-evidence scope decision |
| CLOS-S4-04 | Medium | `services/billing-service/src/modules/payments/razorpay.ts` | no `AbortSignal`/timeout (grep count 0); payment path |
| CLOS-S4-05 | High | `services/finance-service/src/modules/simplified/commands.ts:45,76` and ~30 finance sites | UTC date defaults still present; posting-period impact |
| CLOS-S5-05 | Medium | `services/hrms-service/src/modules/seniority/routes.ts:126,147` etc. | UTC default still present |
| CLOS-S6-02 (Run 1) | Low | revenue-service validation 400 bodies (`arrears/routes.ts:24` etc.) | raw ZodError JSON message still present; API body shape change |
| CLOS-S6-06 (Run 1) | Medium | `revenue-service/src/modules/bbps/consumer.ts:26` and the other listed UTC-date sites | still present (CLOS2-S6-13 fixed a different site, `billing/consumer.ts`) |
| CLOS2-S2-09 | Medium | `hr/leave-policies/LeavePoliciesClient.tsx:491` | empty numeric field saved as 0; leave-policy input rule; not fixed |
| CLOS2-S1-14 | Low | `estab/notifications/NotificationsPanel.tsx:118` | LOW-risk, no PASS 2 record found; unfixed by this run |
| Test hygiene | Low | workflow-service `delegations-routes.test.ts` fixed tenant | needs unique tenant or cleanup (verifier) |
| Known-flaky list additions | Low | helpdesk tests, inventory DQ-FIN-03 | verifier recommends adding; not done by me |
| Release gates without evidence | High | Live Stack contract score, Release Gate (11 UNMEASURED), Coverage, Integration, Schema L3 | decide fix plan or explicit waiver; the FAIL decision stands |

The older sections A-E below are the Run 1 list; items A and the rows in B that appear in the resolved table above are superseded.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Everything here needs an owner decision and was NOT fixed silently. Sources: `~/orch-logs/closure/deferred-approval.md`, `pass1-result.json` (blockedForApproval), and `~/orch-logs/closure/owner-questions-lanes.md` (questions collected from the open PRs).

## A. From `deferred-approval.md`


- CLOS-FLAKY-DRAINAGE (Medium, BLOCKED_FOR_APPROVAL): drainage hotspotCode = DRNH-Date.now()-randomInt(1000,9999)
  collides under concurrency; the UNIQUE-violation retry reuses the same payload, so an accepted (202) hotspot can
  be silently lost (5/250 rounds). complaintNumber uses the same scheme. Fix needs a DB sequence (schema) or a new id format. (#2167 evidence)
- CLOS-CVE-NEXT (High, BLOCKED_FOR_APPROVAL): CVE-2026-94482, a Next.js App Router DoS, fails the Trivy/CVE scans on every PR. Fix = Next.js upgrade (dependency).
- DELEG-REVOKE-OWNERSHIP (High, BLOCKED_FOR_APPROVAL): DELETE /v1/workflow/delegations/:id has no ownership check (any workflow_user can revoke any delegation); GET /v1/workflow/delegations lists every delegation in the tenant to any workflow_user. Proposed: revoke = delegator or admin; list = own (delegator/delegate) unless admin; add ?mine / delegateId filters. (#2163 builder)
- DELEG-UTC (Medium): the service decides whether a delegation is active using UTC today(); it should use IST. Self-delegation is blocked in the UI only, not in the service. (#2163)

## B. BLOCKED_FOR_APPROVAL items from PASS 1 (`pass1-result.json`)

| ID | Severity | File | Observed | Proposed fix (not applied) |
|---|---|---|---|---|
| CLOS-S1-17 | Medium | `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx:44` | The export range is sent as UTC boundaries: isoStart(d) is `${d}T00:00:00.000Z` and isoEnd(d) is `${d}T23:59:59.999Z`, while the officer picks IST calendar dates. Audit events from 00:00 to 05:30 IST on the From date are excluded, and events up to 05:30 IST the next day are included. This changes which audit records a signed export contains, so it is an audit/evidence-scope decision and not an autonomous display fix. | Owner decision needed: interpret From/To as IST day boundaries (+05:30) and document that on the form. |
| CLOS-S4-04 | Medium | `services/billing-service/src/modules/payments/razorpay.ts:90` | createOrder and fetchPayment call fetch() with no AbortSignal or timeout, unlike every adapter in modules/gateways. A stalled Razorpay connection holds the checkout request open indefinitely. Non-ok upstream bodies are embedded in the thrown Error message (lines 101, 118), which is masked only by the route's generic 500 handler. | Add signal: AbortSignal.timeout(...) on both calls and map the abort to a 504 HttpError. This touches the payment path, so it is held for approval. |
| CLOS-S4-05 | High | `services/finance-service/src/modules/simplified/commands.ts:45` | Defaults for postingDate, effectiveFrom, asOf, valueDate and paymentDate use new Date().toISOString().slice(0,10), the UTC date, at about 30 finance sites (treasury/consumer.ts:42,103,206; payments/consumer.ts:130,532,577; gl/consumer.ts:387,634,717; revenue-billing/consumer.ts; budget/*; bank-file-generator.ts:87,169; pfms/release.ts:136; integrations/consumer.ts:127,300). Between 00:00 and 05:30 IST a defaulted posting or value date is the previous Indian calendar day, which can land in a closed period or the previous financial year around 1 April. | Use one shared IST-today helper (asset-service/src/shared/dates.ts already has one) at these sites. It affects posting periods, so it is held for owner approval. |
| CLOS-S5-05 | Medium | `services/hrms-service/src/modules/seniority/routes.ts:126` | The date-only default for asOf uses new Date().toISOString().slice(0,10), the UTC date, which is yesterday between 00:00 and 05:30 IST. hrms-service/src/shared/ist.ts todayIST() exists and documents this bug. Other UTC-today sites: seniority/routes.ts:147,199; workforce-core/holds/queries.ts:77; scheduler/tick.ts:99; social/pulse-routes.ts:255,315. Seniority and hold as-of are business rules. | Replace with todayIST() at the listed sites after the owner confirms the rule semantics. |
| CLOS-S6-02 | Low | `services/revenue-service/src/modules/arrears/routes.ts:23` | The 400 validation response puts ZodError.message, a raw JSON dump of the issues array, in error.message, which is shown to the user. Same in analytics:39, bbps:17, billing:14, collection:23, rate-engine:19, trade-license:26. | Use message 'invalid request' and carry the issues (path and message) in a separate field; the envelope stays { error: { code, message } }. |
| CLOS-S6-06 | Medium | `services/revenue-service/src/modules/bbps/consumer.ts:26` | Business dates use new Date().toISOString().slice(0,10), the UTC date, which is the previous day between 00:00 and 05:30 IST. Affected: revenue bbps/consumer.ts:26 (bill date), assessment/consumer.ts:63,219 (demand and due date), analytics/routes.ts:94,156 (arrears-aging as-of), stock-service entry/consumer.ts:178 (postingDate), sewerage connections/consumer.ts:132 (activationDate), works execution/consumer.ts:347 (acquisitionDate), workflow authority/routes.ts:79 (onDate). | Add a shared IST date helper (Intl timeZone Asia/Kolkata) and use it for these dates. This changes demand, due and posting dates, so it needs approval. |
| CLOS-S6-07 | Medium | `services/workflow-service/src/modules/assignment/resolver.ts:100` | The substitute (delegate) lookup uses the UTC date as 'today'. Between 00:00 and 05:30 IST a substitution that starts today is not active yet and one that ended yesterday is still active, so tasks go to the wrong person. shared/calendar.ts:33 (ymdUTC), used for SLA working days, has the same UTC basis. | Compute today in Asia/Kolkata (or the tenant timezone) for substitution and calendar checks. |

CLOS-S6-02 was recorded by PASS 1 as `risk: LOW` yet listed under blockedForApproval; treated here as needing approval because the fix changes the 400 error body on 7 routes. Say if you want it moved back to autonomous fixes.

## C. Other decisions needed

- Trade-service `restoreLicence notifies the licensee` flake could not be reproduced (0/39); unverified hypotheses only. Decide whether to keep investigating.
- CLOS-S1-16 residual: about 20 more same-class bare-locale date/time sites remain; decide whether to extend the global guard and sweep them (some are in open-PR files).
- Release gate: PASS 3 found four low-risk, one-line-class regressions or defects (P3-NEW-1..3, P3-BASE-1 in `defect-registry.md`). Approve fixing them on a new branch, since this run's bounded loop has ended.
- Whether to promote any FIXED defect to VERIFIED (none currently qualifies; see `defect-registry.md`).

## D. Owner questions from the open PRs (copied verbatim from `owner-questions-lanes.md`)


## #2147 documents-idor
- Should assignedTo be validated against a tenant user directory? document-service has no lookup today, so this needs an IAM or HR call.
- Forward and acknowledge are enforced in the route; the async consumer still trusts the command, leaving a small race window if the dak is reassigned between check and consume. Add a conditional update on assigned_to in the consumer?
- Strict choice made: once someone else holds a dak, its creator can no longer forward or acknowledge it. Relax this if originators should keep control.

## #2153 helpdesk-shapes
- QTD uses the Indian fiscal quarter (Apr/Jul/Oct/Jan), consistent with FY. Should it be calendar quarters instead?
- Typeless tickets (internal form, inbox/CRM conversions, legacy rows) are treated as incidents for transitions. Should the internal form instead require an explicit ITIL type plus type fields (impactLevel, urgency)?
- Migration 0039 was chosen because 0038_helpdesk_note_is_internal.sql belongs to open PR #2145, which also touches citizen helpdesk files; a rebase may be needed when both merge.
- helpdesk-service allocates the gapless ticketNo in the worker, so the create ack cannot carry it. The form shows INT-<id8> until the detail page shows the real number. Is that acceptable?
- Process note: I used one pkill -f pattern (limited to my own 'timeout 1500 npx vitest' command) to stop a hung test run. This broke the rule against pattern kills. I saw no other agent's process affected, but ec2-user is shared. The hang was in my own new test (a circular import inside a vi.mock factory), now fixed.

## #2161 install-reports-meeting
- Nothing advances an install stage past in_progress (no executor writes completed/failed): wire Run to per-stage handlers or add a Mark complete action?
- MIS change: add a stored previous-period value to reports.kpis and compute change, or keep the dash?
- Report job detail now persists a PII-masked row preview readable by all report read roles (masking only when template configures piiColumns): restrict to requester/admins (overlaps PR #2148) or keep?
- Web Delete on a scheduled report now soft-deletes (hidden, not re-enableable) while Disable stays listed and re-enableable: is that the intended distinction?
- Confirm meeting participants.employeeId always equals the identity-service user id (used for attendance display-name lookup, same assumption minutes already makes).

## #2151 field-inspection
- Should field_admin get a tenant-wide sync/pull? I left it per-actor, which is the strictest option.
- 'Conducted' currently means membership in assignedInspectors. Should it also cover admins who ran the in_progress or completed transitions without being assigned, via inspection_history?
- The reviewer is any directory user, and the service does not role-check reviewerId. Should it be limited to reviewing_officer?
- Field task start/complete and visit check-in still accept any agent on any task. These are writes and out of scope here.

## #2160 revenue-dcb
- Should waivers and write-offs be reported separately from collections in efficiency KPIs? Waivers currently count toward collected, like write-offs.
- Adjustment legs are told apart by the 'Adjustment credit' / 'Adjustment debit' narration. Should the ledger get an explicit direction column instead?
- The fail-closed /revenue layout now denies any session whose roles cannot be read. Do dev and e2e sessions always carry roles?
- Approving a waiver larger than the demand's current balance can drive that balance negative, as write-off does today. Should I add a cap?
- Registering rate limiting added the workspace dependency @civitasone/rate-limit to revenue-service, with a 3-line lockfile change. Is that acceptable?

## #2164 citizen-grants
- Should a Rs 0 office fee override require feeWaiverReason server-side? Currently only persisted and audited; the publish gate test asserts fee 0 without a reason is valid.
- Add a tenant-admin UI field for settings.dpoEmail? It is settable today only via PATCH /v1/tenants/:id settings.
- Campaign contact lookup needs a CRM role; notifications users without CRM access can only paste contact ids. Acceptable, or add a notification-service-side lookup?
- Draft discard is async (202); a reload within queue latency may still show the draft. Make it synchronous?
- On deploy every existing sandbox pass becomes stale (NULL hash); designers must re-run the test once on pending drafts. Acceptable?

## #2152 policy-visitor-plugins
- Should the role-feature grant/revoke reason be required at the API? It is optional today because the admin matrix sends none.
- Should unknown keys in the visitor_policy namespace be rejected?
- protocol_officer was removed from the guard console rather than added to the service gate roles. Should it be able to verify and check in?
- Registry list is plugin_admin/super_admin only, so plugin_user now gets the error state on Installed.
- Registry Install for uploaded rows is not offered on Installed because the service install route takes a manifest, not a plugin id.

## #2156 audit-analytics-projects
- Add an observation due-date input to the Log Observation form (API already accepts optional dueDate)?
- Is the 15-minute query-string download token acceptable, or do you want a POST/header token exchange (larger web change)?
- Separate i18n pass for the hard-coded English ml-insights strings?
- Should project-service gain a project-wide allocated/released/utilised aggregate endpoint so the utilization page can be wired?

## #2166 inventory-assets-learning
- Low-stock total: the service now returns meta.total, but the web shows only a cap note at 500 rows. Do you want the exact total shown in the UI?
- Reconcile CSV export is limited to inventory_manager, inventory_admin and super_admin (the strictest safe choice). Should store keepers or finance readers get it too?
- New user-visible strings in DesignerCanvas, EnrolButton, LowStockTable and the fleet files follow those files' existing literal-English style, because they do not use next-intl yet. Converting them to t() with real en and hi values needs a wider pass over those components. Do it in this PR or as a follow-up?
- A newly created designer draft is applied by the async consumer. A very fast second Save can get a 404 or 409 until it lands, and the message tells the user to retry. Is that acceptable?
- The batched endpoint is POST /v1/citizen/documents/verification-lane/batch on citizen-service, a new route that the gateway or any route allowlist has not been checked against. Please confirm it routes through the /api/proxy path as intended.


## E. Flaky tests seen on other PRs (`flaky-observed.txt`)

```
drainage hotspot code generation 50-concurrent POST (seen on #2142)
CreatePOForm NEW-03 vendor search 500 Retry (seen on #2145)
Selection lists page DETAIL-14 auto-rank (seen on #2145)
trade-service restoreLicence notifies licensee (seen on #2145)
Gov Rail Contract NACH/APBS upstream error body not leaked (seen on #2142)
crm CustomFieldsManager save reflection GAP-CRM-CUSTOM-FIELDS-03 (seen on #2142)
payroll pay-group bulk assign/unassigned report + concurrent membership (seen on #2149)
court-service FULL-LIFECYCLE order MAKER cannot self-issue (seen on #2157, web-only PR)
```
