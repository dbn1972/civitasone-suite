# Regression results (PASS 3)

<!-- V4-CERT-BEGIN -->
## V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 regression results (frozen SHA)

Regression lane (`cert/regression.json`, logs `~/orch-logs/closure/v4/cert/regression/`, per-log hashes `log-hashes.json`): DB tests on a disposable `postgis:16-3.4` on 127.0.0.1:55912, bootstrapped by `bootstrap-postgres.sh` (exit 0), reruns with the correct per-service DB and `--no-file-parallelism` are authoritative (earlier attempts kept in `attempt*/`).

| Gate | Status | Exit | Result |
|---|---|---|---|
| 20a-v4-pr-regression-tests | FAIL | 1 | 78 of 79 V4 PR test files PASS on the frozen SHA across 29 packages (apps/web, 25 services, packages/db,auth,storage). 1 file FAILS: citizen-service tests/service-gaps-partial-routes.test.ts (PR 2246, V4-G-12 fixtures) 10/38 red - see newDefects. All other defects PASS: V4-A-01..09, V4-B-01..11, V4-C-01..06, V4-D-01..07, V4-E-01..07, V4-F-01..06, V4-G-01..11 (V4-G-12 appeal-filing-integrity.test.ts 9/9 passes; its fixture suite is the red one). PR 2284 (V4-C-04 rest) building/event v4-c-04 test files do not exist at the SHA (superseded by closure3-s4-09-reference-sequences tests, which pass in 20c); parking/trade v4-c-04 pass. PR 2268 (V4-B-03) pass. Parallel-file runs of citizen/grant/building initially showed DB-collision/wrong-DB artefacts of my harness (kept in attempt*/ dirs); reruns with correct per-service DB and --no-file-parallelism are the authoritative logs. |
| 20b-run3-and-delta-regression-tests | FAIL | 1 | 242 of 243 collected files pass (2533 tests pass); 54 of 55 package jobs EXIT=0. Only failure is the same citizen-service service-gaps-partial-routes.test.ts (10 tests). One file in the list was not counted as passed by vitest summaries (244 listed vs 243 reported)- skipped/no tests, not a failure. |
| 20c-revert-proves-test-fails | PASS | 0 | All 10 tests FAIL when the fix is reverted, and PASS on the SHA (restored, git status clean each time): PR2241 V4-G-03 (2 fail), PR2238 V4-E-02 (2), PR2244 V4-G-06 (3), PR2240 V4-B-02/G-04/E-01 (3), PR2246 V4-G-12 appeal-filing-integrity (8), PR2270 V4-D-06 (3), PR2275 V4-G-05 (6), PR2258 V4-D-02 (2), PR2260 V4-D-01 (4), PR2266 V4-A-02 (4). Method note: bundles are squashed, so the reversal is the PR diff (non-test files) reverse-applied rather than git revert of a commit; PR2240 and PR2258 reversals delete a source file so failures there may be import-resolution rather than assertion failures. 4 other HIGH diffs (2242, 2261, 2262, 2252) did not reverse-apply cleanly due to later edits and were not used. |
| 20d-delta-static-integration-review | PASS_WITH_KNOWN | 0 | No conflict markers; no new migration number collision (the 15 duplicate-prefix dirs are pre-existing 'NNNb' or crm 0112 pairs, none among the 28 added files); tsc --noEmit EXIT=0 with 0 errors in all 55 changed services/packages. Delta is 4 release commits (#2227,#2279,#2281,#2280), 685 files. The only integration defect found is V4-INTEG-01 (test collision). apps/web tsc and next build were not run in this lane. |
| 20e-web-tsc-next-build | NOT_RUN |  | Out of this lane's scope; only web vitest regression tests run (apps/web 12 V4 files + 61 delta files pass). |

Cross-check by this auditor (command recorded as `xcheck-regression-logs`, log `cert/reports/xcheck-regression-logs.log`): grepping every regression log for failed Test Files/Tests finds only `services_citizen-service.log` (1 file failed, 10 tests failed) and `delta_services_citizen-service.log`; no other package log reports a failure.

Revert-proof (gate 20c): with the PR's non-test diff reverse-applied, the tests fail; on the SHA they pass. Caveat from the lane: PR2240 and PR2258 reversals delete a source file, so those failures may be import-resolution rather than assertion failures; 4 other HIGH diffs (#2242, #2261, #2262, #2252) did not reverse-apply cleanly, so their revert proof is not available from this lane (#2252 and others were shown to fail on origin/main by the reviewers in the PR comments).

| PR | Defect | Tests failing when reverted |
|---|---|---|
| PR #2241 | V4-G-03 | 2 |
| PR #2238 | V4-E-02 | 2 |
| PR #2244 | V4-G-06 | 3 |
| PR #2240 | V4-B-02 / V4-G-04 / V4-E-01 | 3 |
| PR #2246 | V4-G-12 (appeal-filing-integrity) | 8 |
| PR #2270 | V4-D-06 | 3 |
| PR #2275 | V4-G-05 | 6 |
| PR #2258 | V4-D-02 | 2 |
| PR #2260 | V4-D-01 | 4 |
| PR #2266 | V4-A-02 | 4 |

Other regression facts: 244 test files added or modified between `1eaeecae7` and the SHA (55 packages) ran serially: 242 of 243 collected files, 2533 tests pass; the only failure is `services/citizen-service/tests/service-gaps-partial-routes.test.ts` (V4-INTEG-01). apps/web: 12 V4 files and 61 delta files pass. `tsc --noEmit` exits 0 in all 55 changed services and packages. No conflict markers; no migration-number collision.

Full-suite results outside the regression lane (build/db/contract lanes and GitHub CI): see `release-readiness.md`. Summary of red results at the frozen SHA: citizen-service (10 tests, confirmed in GitHub CI), web auditResource (1 test, confirmed in GitHub CI), three architecture guards, cross-service-events contract (2 tests), tests/data-integrity (7), tests/cross-service (5), tests/cross-service-live payroll-posting-history (2), tests/security (1 deterministic), analytics-service (1, local only), grant-service (4 local only, passes in GitHub CI), finance pfms-adapter (12, unmigrated test DB, not rerun).

### Per-defect regression evidence

| Defect | Sev | Regression test(s) | Related CI guard / contract | Result |
|---|---|---|---|---|
| V4-A-01 | HIGH | apps/web/src/lib/sync/logout.test.ts; apps/web/src/lib/sync/swCache.test.ts; apps/web/src/middleware.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-02 | HIGH | apps/web/src/middlewareCspStorage.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-03 | MEDIUM | apps/web/src/app/api/careers/auth/tenantBinding.test.ts; apps/web/src/app/api/notification/upstreamFailure.test.ts; apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts; apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-04 | LOW | apps/web/src/middleware.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-05 | LOW | apps/web/src/app/api/careers/auth/tenantBinding.test.ts; apps/web/src/app/api/notification/upstreamFailure.test.ts; apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts; apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-06 | MEDIUM | apps/web/src/app/api/careers/auth/tenantBinding.test.ts; apps/web/src/app/api/notification/upstreamFailure.test.ts; apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts; apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-07 | LOW | apps/web/src/app/(app)/admin/metering/usageLimits.test.ts; apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.test.tsx; apps/web/src/lib/money.formGuard.test.ts; apps/web/src/lib/money.safeNumber.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-08 | LOW | apps/web/src/app/(app)/admin/metering/usageLimits.test.ts; apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.test.tsx; apps/web/src/lib/money.formGuard.test.ts; apps/web/src/lib/money.safeNumber.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-A-09 | LOW | apps/web/src/middleware.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-01 | MEDIUM | services/hrms-service/src/__tests__/comp-off-persist-real-db.test.ts; services/hrms-service/src/modules/leave/comp-off-authz.test.ts | tenant-table-rls-guard (new RLS table passes); web auditResource.test (FAILS, V4-CERT-02) | PASS in regression gate 20a/20b |
| V4-B-02 | HIGH | services/citizen-service/src/modules/documents/ownership.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-03 | MEDIUM | services/billing-service/tests/v4-b03-webhooks-public.test.ts; services/gateway-service/tests/v4-b03-billing-webhook-prefix.test.ts | authz-tenant-scanner (webhook entries were baselined; now stale) | PASS in regression gate 20a/20b |
| V4-B-04 | MEDIUM | services/notification-service/tests/v4b04-push-revoke-ownership.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-06 | MEDIUM | services/advertisement-service/tests/v4-b06-permit-verify-public.test.ts; services/building-service/tests/v4-b06-permit-verify-public.test.ts; services/gateway-service/tests/v4-b06-permit-verify-public-prefix.test.ts | tenant-table-rls-guard (FAILS on the new directory tables) | PASS in regression gate 20a/20b |
| V4-B-07 | MEDIUM | services/helpdesk-service/tests/v4-b07-ces-requester.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-08 | MEDIUM | services/finance-service/tests/statements-receipts-payments-opening.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-09 | LOW | services/knowledge-service/tests/v4-b-09-ai-prompt-hardening.test.ts | authz-tenant-scanner (ai/prompt entry was baselined; now stale) | PASS in regression gate 20a/20b |
| V4-B-10 | LOW | services/queue-service/tests/status.test.ts; services/queue-service/tests/v4-b-10-ops-auth.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-B-11 | LOW | services/finance-service/tests/statements-cashflow-fy-order.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-C-01 | MEDIUM | services/market-service/tests/v4-c-01-property-code-per-tenant.test.ts | tenant-index-guard + schema-drift-guard (PASS, db lane) | PASS in regression gate 20a/20b |
| V4-C-02 | MEDIUM | services/court-service/tests/commands-coverage.test.ts; services/court-service/tests/v4-c-02-addparty-case-tenant.test.ts; services/works-service/tests/v4-d-07-contractor-consumer-rethrow.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-C-03 | MEDIUM | services/asset-service/tests/v4-c-03-streetlight-pole-id-per-tenant.test.ts | tenant-index-guard + schema-drift-guard (PASS, db lane) | PASS in regression gate 20a/20b |
| V4-C-04 | MEDIUM | services/market-service/tests/v4-c-04-reference-numbers-unique.test.ts; services/building-service/tests/v4-c-04-reference-numbers-unique.test.ts [absent at SHA]; services/event-service/tests/v4-c-04-reference-numbers-unique.test.ts [absent at SHA]; services/parking-service/tests/v4-c-04-reference-numbers-unique.test.ts; services/trade-service/tests/v4-c-04-reference-numbers-unique.test.ts | closure3-s4-09 reference-sequence tests; schema-drift-guard | PASS in regression gate 20a/20b |
| V4-C-05 | MEDIUM | services/refund-service/tests/v4-c-05-request-number-unique.test.ts | schema-drift-guard | PASS in regression gate 20a/20b |
| V4-C-06 | LOW | packages/db/src/pool.timeouts.test.ts; packages/db/src/tenant-router.evict.test.ts; packages/db/src/tenant-router.property.test.ts; packages/db/src/tenant-router.test.ts | packages/db perf tests (PASS) | PASS in regression gate 20a/20b |
| V4-D-01 | HIGH | services/finance-service/tests/eft-initiate-tx-scope.test.ts; services/finance-service/tests/v4-d01-eft-payment-made-after-egress.test.ts | cross-service-events contract (stale baseline entry finance.payment.file_decided, V4-CERT-06) | PASS in regression gate 20a/20b |
| V4-D-02 | HIGH | services/finance-service/src/modules/payments/eoffice-rejection-reversal.test.ts; services/finance-service/tests/consumer-coverage-ext.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-D-03 | HIGH | services/grant-service/tests/v4-d03-duplicate-disbursement.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-D-04 | HIGH | services/grant-service/tests/v4-d04-failed-disbursement.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-D-05 | MEDIUM | services/grant-service/tests/v4-d05-disbursement-state-guard.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-D-06 | HIGH | services/hrms-service/src/modules/contracts/expiry-escalated.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-D-07 | MEDIUM | services/court-service/tests/commands-coverage.test.ts; services/court-service/tests/v4-c-02-addparty-case-tenant.test.ts; services/works-service/tests/v4-d-07-contractor-consumer-rethrow.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-E-02 | HIGH | services/citizen-service/src/modules/grievance/requests-list-scope.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-E-03 | MEDIUM | packages/auth/tests/v4-e-03-env-allowlist-call-sites.test.ts | secret-scanner.mjs (PASS) | PASS in regression gate 20a/20b |
| V4-E-05 | MEDIUM | packages/storage/src/index.test.ts; services/admin-service/tests/v4-e-05-presign-limits.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-E-06 | MEDIUM | services/hrms-service/src/modules/id-cards/qr-secret.security.test.ts | secret-scanner.mjs (PASS) | PASS in regression gate 20a/20b |
| V4-E-07 | MEDIUM | services/citizen-service/src/modules/issuance/seal-key.test.ts | secret-scanner.mjs (PASS) | PASS in regression gate 20a/20b |
| V4-F-01 | MEDIUM | services/gateway-service/tests/upstream-proxy-5xx-body.test.ts; services/telephony-service/tests/recording-download-cap.test.ts; services/workflow-service/tests/messages-expiry-race.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-F-02 | MEDIUM | services/visitor-service/tests/document-scan-multipart.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-F-03 | LOW | services/ml-service/tests/purge-s3-client-reuse.test.ts; services/visitor-service/tests/s3-client-singleton.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-F-04 | MEDIUM | packages/db/src/pool.timeouts.test.ts; packages/db/src/tenant-router.evict.test.ts; packages/db/src/tenant-router.property.test.ts; packages/db/src/tenant-router.test.ts | packages/db perf tests (PASS) | PASS in regression gate 20a/20b |
| V4-F-05 | LOW | services/gateway-service/tests/upstream-proxy-5xx-body.test.ts; services/telephony-service/tests/recording-download-cap.test.ts; services/workflow-service/tests/messages-expiry-race.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-F-06 | LOW | services/gateway-service/tests/upstream-proxy-5xx-body.test.ts; services/telephony-service/tests/recording-download-cap.test.ts; services/workflow-service/tests/messages-expiry-race.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-01 | HIGH | services/citizen-service/tests/v4g01-cert-verify-public.test.ts; services/gateway-service/tests/v4g01-cert-verify-public-prefix.test.ts | gateway public-prefixes contract tests (tests/contract/gateway.contract.test.ts) | PASS in regression gate 20a/20b |
| V4-G-02 | HIGH | services/citizen-service/src/modules/fee-payment/payment-intent-fee.test.ts; services/citizen-service/tests/service-gaps-routes.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-03 | HIGH | services/citizen-service/src/modules/documents/digilocker-legacy-verify.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-05 | HIGH | services/audit-service/tests/v4-g-05-hash-chain-verifiable.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-06 | HIGH | services/citizen-service/src/modules/catalogue/notification-bindings.recipient.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-07 | MEDIUM | services/notification-service/tests/v4g07-retry-payload.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-08 | HIGH | services/citizen-service/src/modules/fee-payment/gl-rejected.test.ts; services/finance-service/src/modules/revenue-gl/journal-type.test.ts; services/finance-service/src/modules/revenue-gl/unposted-receipt.test.ts; services/finance-service/tests/revenue-gl-consumer.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-09 | MEDIUM | services/citizen-service/src/modules/fee-payment/refund-approval.test.ts; services/finance-service/src/modules/revenue-gl/refund-gl.test.ts | cross-service-events contract (orphan citizen.refund.approved, V4-CERT-07) | PASS in regression gate 20a/20b |
| V4-G-10 | MEDIUM | services/citizen-service/tests/appeal-outcome-application.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |
| V4-G-11 | MEDIUM | services/citizen-service/tests/issuance-application-gate.test.ts | none identified (regression test is the only control) | PASS in regression gate 20a/20b |

<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Executed in the final-check pass (main `9d93535`)

Source: `~/orch-logs/closure/final-checks.json`; logs `~/orch-logs/closure/final/results.txt`, `rerun-results.txt`, `vitest.log`, `typecheck.log`, `lint.log`, `webbuild.log`, `contract.log`, `guard-*.log`, `db2-*.log`, `rerun-*.log`.

| Item | Result |
|---|---|
| install, typecheck 126/126, lint 67/67 (0 errors), web build, contract 148 passed / 1 skipped | pass |
| web vitest, `--maxWorkers=2` | 2401 files, 19859 tests, 0 failed |
| 31 CI guards | 28 pass first pass; bundle-size, schema-drift, tenant-index re-run with proper inputs and pass; money-precision, sql-injection, secret-scanner, package-exports now pass (failed at baseline) |
| 67 DB-backed service suites, one disposable PG, non-superuser roles, sequential | 62 green first pass; rerun on fresh PG + redis sidecar: helpdesk, inventory, visitor green; workflow 1 failing test; gateway 2 failing tests (spawn tsx) |
| The PG listened on 5435 inside its own container network namespace, so tests hard-coding localhost:5435 never touched the shared dev DB | stated by the run; container and volume removal is part of the rules |

Classification of the remaining local reds (analysis): workflow `delegations-routes.test.ts` "returns empty list for a fresh tenant" is non-idempotent (fixed tenant id; passes on fresh DB 1116/1116, fails on a reused DB); gateway tsx-subprocess tests fail with ENOENT in the container (harness artifact per the verifier, not re-run by it).

### Executed: CI

See the table in `release-readiness.md`. Net: main `9d93535` has Tests (1 known-flaky web test), E2E, Live Stack Verification, and Release Gate red; Coverage Gate, Integration Tests, Schema Integrity L3, Docker skipped; Security Scan green.

### Executed: Run 2 PASS 2 targeted evidence (per fixer, before/after tests)

Slice records: `~/orch-logs/closure/run2-pass2-s1.json` (S1), `~/orch-logs/closure/run2-pass2-s2.json` (S2), `~/orch-logs/closure/run2-pass2-s3.json` (S3), `~/orch-logs/closure/run2-pass2-s5.json` (S5), `~/orch-logs/closure/run2-pass2-s6.json` (S6). Examples recorded by the fixers: S5-01 knowledge uuid params 28/30 before, 30/30 after; S5-03 notification 10/11 before, 11/11 after; S6-04 Meilisearch 8 reject cases failed before, 41/41 after; S6-03 circuit breaker called fn 3x instead of 1 before, 13/13 after. S3 slice verification: web typecheck 8/8 tasks, eslint 0 errors on touched files, vitest groups all passing. S6 services ran on a disposable postgis:16 (port 55601), `--maxWorkers=2`, container and volume removed.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Integration branch: `closure/pass3-integration`, head `cca1ae6461f162b636bdc4321969c5e9419e530d`, worktree `~/worktrees/closure-p3` on EC2, draft PR #2171 ("DO NOT MERGE, regression evidence only"). Comparison baseline: origin/main `cdeb2b09ced7340623f6508936a744d99971c91f` (merge-base equals origin/main).

Included PRs (16): #2158 #2159 #2147 #2151 #2152 #2153 #2156 #2160 #2164 #2166 #2154 #2165 #2169 #2170 #2167 #2163. Excluded: #2161 (conflicts in `services/install-service/src/modules/stages/routes.ts`, `services/report-service/src/modules/jobs/consumer.ts`, `services/report-service/src/modules/jobs/routes.ts`, `services/report-service/src/modules/scheduled/repo.ts`). Migration collisions: none. Services touched: 26.

## Executed: local gates

| Check | Command | Exit | Result |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | 0 | ok (lockfile unchanged) |
| typecheck | `pnpm turbo typecheck --force --concurrency=4` | 0 | 126/126 tasks successful, 206s |
| lint | `pnpm turbo lint --concurrency=4` | 0 | 67/67 tasks successful; 0 errors (warnings only) |
| test:contract | `pnpm test:contract` | 0 | 2 files passed; 148 passed, 1 skipped; 0 failed |
| web vitest | `cd apps/web && npx vitest run --maxWorkers=2` | 1 | 2379 files (2378 pass, 1 fail); 19745 tests (19744 pass, 1 fail). Only failure: src/app/(app)/hr/audit-log/auditResource.test.ts > HR_AUDIT_RESOURCE_TYPES > covers every resource type the services emit (missing medical_employee_record). Class (a): identical failure on origin/main cdeb2b09c, introduced by #2150 already in main; low-risk fix is to add medical_employee_record to HR_AUDIT_RESOURCE_TYPES in apps/web auditResource.ts |
| web build | `flock /tmp/civitas-webbuild.lock pnpm --filter @civitasone/web build` | 0 | ok, 485s |
| guards-pass (exit 0) | `node scripts/ci/<guard>.mjs for all *guard*.mjs and *scanner*.mjs` | 0 | pass: arch, ci-config, contradictory-badge, datatable-render, deployment-declaration, empty-vs-error, evidence-suite-dbs, flaky-skip, jsx-a11y-ratchet, nested-tx, queue-publish-messageid, raw-session-guc, stat-tile-literal, tenant-predicate, tenant-router, tenant-table-rls, test-ledger-poison, authz-tenant-scanner, zero-test-module-scanner, bundle-size (rerun with build log, rc 0) |
| guard raw-status-leak-guard | `node scripts/ci/raw-status-leak-guard.mjs` | 1 | 1 NEW violation: apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx:65 (raw res.status in thrown Error). Baseline passed. NEW REGRESSION from #2166 (commit 6f98bca86). Same failure fails CI Architecture Guard. |
| guard money-precision-guard | `node scripts/ci/money-precision-guard.mjs` | 1 | 151 violations, identical count/set to baseline (class a) |
| guard secret-scanner | `node scripts/ci/secret-scanner.mjs` | 1 | 71 potential, identical to baseline (field names/test strings) (class a) |
| guard sql-injection-guard | `node scripts/ci/sql-injection-guard.mjs` | 1 | 24 patterns, same total as baseline (HIGH 10->11, MEDIUM 14->13): heuristic noise, one tagged-template tx`SELECT set_config(...)` in hrms visiting-cards/routes.ts now HIGH, one citizen helpdesk drizzle sql MEDIUM gone; baseline already failing (class a) |
| guard package-exports-guard | `node scripts/ci/package-exports-guard.mjs` | 1 | 10 unresolvable entry points (kms/plugin-sdk/security-headers dist unbuilt), identical to baseline, env artifact (class a/d) |
| guard schema-drift-guard / tenant-index-guard | `node scripts/ci/schema-drift-guard.mjs; node scripts/ci/tenant-index-guard.mjs` | 1 | need DB and ran with no DB at :5435 default; result invalid, not evaluated (DB-needing guards, excluded by brief) |
| postgres bootstrap | `disposable postgis/postgis:16-3.4 container, PGHOST=127.0.0.1 bash scripts/ci/bootstrap-postgres.sh` | 0 | rc 0, 496s; container and volume removed (docker rm -fv); not :5435 |

Timing source: `~/orch-logs/closure/p3/results.txt` (install 6s, typecheck 206s, lint 85s, contract 12s, web vitest 1580s, web build 485s). Logs under `~/orch-logs/closure/p3/`.

## Executed: DB-backed service suites (disposable Postgres, never :5435)

Bootstrap ran in the foreground, rc 0 in 496s, `postgis/postgis:16-3.4`; containers `closure-p3-pg` and `closure-p3-pg2` and their volumes were removed (`docker rm -fv`), per `pass3-regression.json` cleanup. Each suite: `CI=true DATABASE_URL=<service role> npx vitest run --maxWorkers=2`, sequential.

| Service | Exit | Result |
|---|---|---|
| asset-service | 0 | 47 files/581 tests pass |
| audit-service | 1 | 429 pass, 1 fail in full sequential run: tests/risk-routes.test.ts > GAP-AUDIT-RISK-REGISTER-07 exactly one audit event (fixed 700ms sleep timing flake, risk module untouched); 22/22 pass in isolation and the full suite passed 3/3 reruns (main and integration) on a fresh DB -> class (b) flake |
| citizen-service | 0 | 82 files/1264 tests pass |
| contract-service | 0 | 29/486 pass |
| court-service | 0 | 67/762 pass |
| document-service | 0 | 24 files pass, 2 skipped; 410 pass 11 skipped |
| estab-service | 0 | 83/933 pass |
| field-service | 0 | 8/220 pass |
| finance-service | 0 | 207/2287 pass |
| gateway-service | 1 | 293 pass 5 skipped; suite tests/sec-024-verify-real-http.test.ts failed to start (identity subprocess: permission denied for schema scim). Identical failure on origin/main; suite is skipped in CI (DATABASE_URL unset there) -> (a)/(d) |
| grant-service | 0 | 29/252 pass |
| helpdesk-service | 1 | 779 pass, 5 fail: catalogue-sweeper (2) + sla-linkage (3) sweeper tests (scanner-role cross-tenant discovery). Same 5 fail on origin/main (which also fails 3 gap2-catalogue-request-idor tests that the integration fixes). CI Tests job passed helpdesk -> (a)/(d) local-bootstrap env |
| hrms-service | 0 | 509 files/6940 tests pass, 9 skipped |
| identity-service | 1 | 592 pass, 16 fail (api-keys DB integration, SEC-024 internal verify, session reaper, scanner-role/scim permission). Identical 16 on origin/main; CI passes identity -> (a)/(d) local-bootstrap env |
| inspection-service | 0 | 69/1304 pass |
| inventory-service | 1 | 678 pass, 1 fail: tests/data-quality.test.ts DQ-FIN-03 (reads civitas_finance GL ledger for bigint-overflow rows left behind by earlier finance-service suite on the same DB, e.g. BIGINT-TEST-*, P4-BIG-*; leaking tests exist on main). Test-order pollution from sequential single-DB run -> (d); CI passes inventory |
| legal-service | 0 | 25/383 pass 3 skipped |
| payroll-service | 0 | 167 files/3065 tests pass |
| plugin-service | 0 | 16/229 pass |
| policy-service | 0 | 21/282 pass |
| procurement-service | 0 | 85/883 pass |
| project-service | 0 | 37/489 pass |
| revenue-service | 0 | 62/675 pass |
| visitor-service | 1 | 1192 pass, 6 fail + suite dpdp-erasure-cascade failed to load: analytics-nightly-aggregation, config-preset-reason, config-registry DPDP purge, dpdp-purge, turnstile-config (2). Identical set on origin/main (3 runs, fresh DB); CI passes visitor -> (a)/(d) local-bootstrap env (scanner role) |
| workflow-service | 1 | 1091 pass, 1 fail: tests/delegations-routes.test.ts GET /v1/workflow/delegations (state-dependent; failing on fresh DB on origin/main too); CI passes workflow -> (a) |
| works-service | 0 | 55/846 pass |

Service-level exit codes and durations: `p3/svc-results.txt`; per-service logs `p3/svc-<service>.log`. 19 services fully green, 7 red.

## Executed: CI on the integration (run ids ci.yml 39875490594, security 39875490486; main comparison run 39872889243)

Red: Architecture Guard, CVE / SCA Gate, CodeQL, E2E (Playwright), Tests, Trivy Container Scan (finance-service), (gateway-service), (hrms-service).
Green (17 jobs): Accessibility (WCAG 2.2 AA, axe-core), CodeQL SAST (javascript-typescript), Contract Tests, Dependency Audit (hygiene), Mobile (Flutter), Mutation Testing (Stryker), Procurement E2E Gate, QA Readiness, Quality Gates Domain (L10) & Canary (L11), Release Gate (evidence audit), Screen Verification Gate, Secret Scan (security run), Secret Scan (ci run), Trivy, Typecheck & Lint, Web Build, ZAP DAST (gateway baseline).
SKIPPED (no evidence): Build & Push Docker Images, Coverage Gate, Derive Docker Build Matrix, Integration Tests, Live Stack Verification, Quality Gates Schema Integrity (L3). These were skipped because the Tests job was red.
Raw per-job table: `p3/ci/p3-checks.tsv`; logs `p3/ci/tests-p3.log`, `p3/ci/tests-main.log`, `p3/ci/e2e-p3.log`, `p3/ci/e2e-main.log`, failing-spec lists `p3/ci/e2e-p3.fails`, `p3/ci/e2e-main.fails`.

## Classification of failures (PASS 3 analysis)

**(a) identical on origin/main (baseline):**

- web auditResource.test.ts covers every resource type (also main CI Tests and local main)
- ocr tests/process-stream.test.ts default window is 2 (CI Tests job; same on main CI run 39872889243; packages/ocr untouched by integration)
- E2E: 19 specs fail identically on main (auth error-param, crm contacts, hr leave form, employee-lifecycle transfer, leave-management list, 5x ux-quality leave, visual regression HRMS pages + Pay Structures + Empty employees, locations x2, tenant-admin breadcrumb)
- gateway sec-024-verify-real-http (local only, skipped in CI)
- identity 16 scanner/scim tests (local bootstrap env only)
- helpdesk 5 sweeper tests (local only)
- visitor 6+1 (local only)
- workflow delegations-routes (local only)
- CodeQL js/path-injection alerts #930/#931
- money-precision, secret-scanner, sql-injection, package-exports guards

**(b) known flaky:**
- audit-service risk-routes GAP-AUDIT-RISK-REGISTER-07 exactly one audit event (not in known-flaky.txt; timing flake, passes 3/3 on rerun and in isolation)
- E2E workforce.spec.ts:135 and specs/workforce.spec.ts:151 overtime form renders (failed first try, passed on retry: Playwright flaky)

**(d) environmental:**
- CVE / SCA Gate: next CRITICAL GHSA-2464-fhr4-w9xw + HIGH GHSA-p3m5-59mp-jv5r, same failure on main
- Trivy Container Scan finance/gateway/hrms: CVE-2026-94482 (next)
- inventory DQ-FIN-03 test-order pollution from finance suite on a shared DB
- Coverage Gate: SKIPPED in CI (needs Tests job, which was red), so coverage-known.txt latent list not evaluated

**(c) NEW regressions introduced by the integration:**
- **PR #2166** - Architecture Guard CI job / scripts/ci/raw-status-leak-guard.mjs: apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx:65 raw HTTP status in Error text. Evidence: Guard passes on baseline, fails locally and in CI job 120159948660 with 1 NEW violation; line comes from commit 6f98bca86 (reachable only via merge a26d9efeb p3: merge #2166). Low-risk fix: route via useFormError or status-leak-ok per guard message.
- **PR #2159** - E2E (Playwright) e2e/hrms-payroll/payroll-runs.spec.ts:28 shows KPI stat cards (expects /pending/ tile). Evidence: Fails on integration, passes on main E2E run 39872889243. page.tsx (hr/payroll) in commits 55b0c55df/caee07c59/adb939eb8 (merge 12fba572d #2159) replaced the Pending tile with Paid / In progress / Awaiting disbursement / Failed tiles; spec not updated.
- **PR #2159** - E2E visual-regression.spec.ts: Payroll Runs List, Payroll Run Detail (paid), Payroll Run Detail (draft), Empty payroll (no structures), Payroll run not found. Evidence: Pass on main, fail on integration: page height 1129px -> 1318px (e.g. Payroll Runs List 15898 px differ), from new tiles and paise money rendering in #2159; snapshots not regenerated.
- **PR #2152** - E2E plugins.spec.ts: plugins page shows plugin toggle cards / enabled status / disabled Aadhaar eSign (getByText PFMS Connector not found). Evidence: Pass on main, fail on integration. /plugins/installed now reads registry GET /api/v1/plugins for managers (commits d224f97fc, d5bd9683b, merge 5517afa38 #2152) but apps/web/e2e/global-setup.ts only mocks /api/v1/plugins/items.
- **PR #2156** - CodeQL check: 42 new alerts incl. 2 high js/path-injection at services/audit-service/src/modules/exports/routes.ts:110,142. Evidence: Same two alerts are already open on main (code-scanning #930 line 109, #931 line 139); #2156 (commit e793996e0) shifted the lines so GitHub reports them as new. Not a new defect; classify as (a) re-surfaced, listed here for visibility.

The CodeQL item is classified by PASS 3 as a re-surfaced alert (same two path-injection alerts #930 / #931 are open on main; #2156 shifted the lines), not a new defect. The raw-status-leak, payroll E2E, visual-regression and plugins E2E items are real regressions.

## PASS 4 verifier re-runs (executed by the verifier)

- Re-ran `raw-status-leak-guard` on `closure/pass3-integration` at `cca1ae646`: still fails at `DocVerificationChecklist.tsx:65`. Confirmed new regression from #2166.
- Re-ran `auditResource.test.ts`: fails ('medical_employee_record' missing), already failing on origin/main.
- Ran the regression tests for four test files (the three that lost `expect()` lines plus the analytics ml-insights tests) and `auditResource`: 54 of 55 passed; the single failure is `auditResource`.
- Did NOT re-run: the other guards, service suites, E2E, or regression tests for 8 FIXED defects.

## Not verified (PASS 3 own list)

- CI Coverage Gate, Integration Tests, Quality Gates Schema Integrity (L3), Live Stack Verification, Docker build: skipped in CI because the Tests job failed (its 2 failures are both baseline); so these gates are unverified on the integration
- schema-drift-guard and tenant-index-guard need a bootstrapped DB; not meaningfully evaluated locally
- E2E Playwright not re-run locally; E2E attribution is from CI logs and source inspection, not bisect by execution
- Local DB suites for gateway/identity/helpdesk/visitor/workflow fail identically on origin/main but pass in CI: root cause is scanner-role/scim grants in local bootstrap vs CI, not diagnosed
- Only services touched by the diff were run, not the whole monorepo test matrix; packages (schemas, outbox) tests were not run locally (CI Tests job covers them and passed)

## Analysis

- Typecheck 126/126, lint 0 errors, contract 148/1 skipped, and web build are green on the integration; these are the strongest positive evidence.
- No service-suite red was attributed to the integration: gateway, helpdesk, identity, visitor and workflow fail identically on origin/main; audit passed 3 of 3 reruns (timing flake, class b); inventory is test-order pollution from the finance suite on a shared DB. Note the attribution for helpdesk/identity/visitor/workflow/gateway rests on the "identical on origin/main" comparison logs (`p3/helpdesk-rerun-closure-p3*.log`, `p3/identity-*.fails`, `p3/c/visitor-*`, `p3/c/workflow-*`, `p3/gateway-sec024-base.log`); the root cause (scanner-role / scim grants in the local bootstrap versus CI) was not diagnosed.
- E2E attribution is from CI logs and source inspection, not bisection by execution.
- Because Coverage Gate, Integration Tests, Live Stack Verification and Schema Integrity (L3) were skipped, those gates have no evidence on the integration.
