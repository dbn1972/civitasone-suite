# Defect registry (CLOS-*)

<!-- V4-CERT-BEGIN -->
## V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 consolidated defect table (computed)

Scope: V4 cycle (discovery V4-*, plus certification-found V4-INTEG/V4-CERT)

| Severity | Found | Fixed | Verified | Awaiting Approval | Unresolved | Other (owner-accepted) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 1 | 0 |
| HIGH | 18 | 15 | 15 | 0 | 3 | 0 |
| MEDIUM | 34 | 26 | 26 | 0 | 8 | 0 |
| LOW | 19 | 12 | 12 | 0 | 7 | 0 |
| TOTAL | 72 | 53 | 53 | 0 | 19 | 0 |

V4 discovered defects only (V4-A..G):

| Severity | Found | Fixed | Verified | Awaiting Approval | Unresolved | Other (owner-accepted) |
|---|---|---|---|---|---|---|
| CRITICAL | 0 | 0 | 0 | 0 | 0 | 0 |
| HIGH | 16 | 15 | 15 | 0 | 1 | 0 |
| MEDIUM | 26 | 26 | 26 | 0 | 0 | 0 |
| LOW | 12 | 12 | 12 | 0 | 0 | 0 |
| TOTAL | 54 | 53 | 53 | 0 | 1 | 0 |

All runs (Run 1, Run 2, Run 3, V4, certification-found):

| Severity | Found | Fixed | Verified | Awaiting Approval | Unresolved | Other (owner-accepted) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 1 | 0 |
| HIGH | 39 | 35 | 15 | 0 | 4 | 0 |
| MEDIUM | 140 | 125 | 26 | 5 | 9 | 1 |
| LOW | 106 | 94 | 12 | 1 | 11 | 0 |
| TOTAL | 286 | 254 | 53 | 6 | 25 | 1 |

How the numbers are produced: `consolidate-defects.py` reads `v4-registry.json` (one row per defect) and counts rows by `severity` and `closureStatus`. Found = rows not DUPLICATE/NOT_REPRODUCED. Fixed = fix merged to main (FIXED_MERGED + VERIFIED + VERIFICATION_BLOCKED); Verified is a subset of Fixed (merged AND its regression test passed in the regression lane, no contradicting lane). Awaiting Approval = BLOCKED_FOR_APPROVAL. Unresolved = UNRESOLVED. Other = owner-accepted deferral. Invariant asserted by the script: Found = Fixed + Awaiting + Unresolved + Other. Excluded from Found: V4-B-05 (NOT_REPRODUCED), V4-E-01 (DUPLICATE of V4-B-02), V4-E-04 (DUPLICATE of V4-A-03), V4-G-04 (DUPLICATE of V4-B-02). Severity for V4-A..G is the independent verifier's (verify-*.json), not the discoverer's. Certification-found rows (V4-INTEG-01, V4-CERT-nn) carry a provisional severity assigned by the Release Certification Auditor; V4-CERT-15/16 each count one row for many scanner alerts (5 and 245). Earlier-run rows (RUN1/RUN2/RUN3) have no independent per-defect verification, so none of them is Verified.

Script: `quality-reports/final-closure/consolidate-defects.py` reads `v4-registry.json` (built by `v4-build-registry.py` from the lane/verify/remediation/cycle-2 JSON, the PR comments via `gh`, and the regression lane result) and writes `defect-summary.json`. Commands, exit codes, timestamps and hashes are in `evidence-manifest.json` under `v4_certification.commands`.

Rows by run: {"RUN1": {"rows": 60, "status": {"FIXED_MERGED": 51, "BLOCKED_FOR_APPROVAL": 5, "ACCEPTED_DEFERRAL": 1, "UNRESOLVED": 3}}, "RUN2": {"rows": 53, "status": {"FIXED_MERGED": 51, "UNRESOLVED": 1, "BLOCKED_FOR_APPROVAL": 1}}, "RUN3": {"rows": 101, "status": {"FIXED_MERGED": 99, "UNRESOLVED": 2}}, "V4": {"rows": 58, "status": {"VERIFIED": 53, "NOT_REPRODUCED": 1, "DUPLICATE": 3, "UNRESOLVED": 1}}, "V4-CERT": {"rows": 18, "status": {"UNRESOLVED": 18}}}

### V4 flow

58 defects were confirmed by seven discipline lanes (A-G) on `1eaeecae7`, each independently verified. 3 are duplicates (V4-E-04 of V4-A-03; V4-E-01 and V4-G-04 of V4-B-02), 1 is NOT_REPRODUCED (V4-B-05: `sanitationRoutes` is never registered), leaving 54 distinct defects. 47 fix PRs (#2235-#2278, plus cycle-2 #2282, #2283, #2284) were each independently reviewed (the last "Independent review (V4" comment on every PR is CLEAN), then bundled into #2280 (bundle A, merged 66b04aedd), #2281 (bundle B, shared packages, merged 400dbc822) and, for V4-C-04 building/event, CLOS3-S4-09 in #2279 (merged e845c0401). The originals are CLOSED. Limitation: every one of the 63 review comments was posted from the single GitHub account `dbn1972`; the reviewers were separate agents but the account does not prove independence.

Closure rule applied: VERIFIED only if merged AND its regression test passed in the regression lane (and no lane contradicts it). 53 V4 defects meet it. V4-G-12 does not: a test file changed by its PR fails 10 of 38 tests at the frozen SHA (V4-INTEG-01), so it is UNRESOLVED. V4-D-03 and V4-D-04 failed in local parallel runs on emulated Postgres but passed in the serial regression lane and in GitHub CI, so they are VERIFIED with that conflict recorded (V4-CERT-01).

### V4 registry index

| ID | Sev | Component | Closure status | Original PR | Bundle | Merge commit |
|---|---|---|---|---|---|---|
| V4-A-01 | HIGH | apps/web | VERIFIED | #2252 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-02 | HIGH | apps/web | VERIFIED | #2266 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-03 | MEDIUM | apps/web | VERIFIED | #2235 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-04 | LOW | apps/web | VERIFIED | #2247 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-05 | LOW | apps/web | VERIFIED | #2235 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-06 | MEDIUM | apps/web | VERIFIED | #2235 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-07 | LOW | apps/web | VERIFIED | #2236 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-08 | LOW | apps/web | VERIFIED | #2236 | #2280 (66b04aedd) | 66b04aedd |
| V4-A-09 | LOW | apps/web | VERIFIED | #2247 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-01 | MEDIUM | services/hrms-service | VERIFIED | #2271 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-02 | HIGH | services/citizen-service | VERIFIED | #2240 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-03 | MEDIUM | services/billing-service, services/gateway-service | VERIFIED | #2268 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-04 | MEDIUM | services/notification-service | VERIFIED | #2239 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-05 | MEDIUM | services/helpdesk-service | NOT_REPRODUCED | n/a | n/a | n/a |
| V4-B-06 | MEDIUM | services/advertisement-service, services/building-service, services/ga | VERIFIED | #2273 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-07 | MEDIUM | services/helpdesk-service | VERIFIED | #2253 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-08 | MEDIUM | services/finance-service | VERIFIED | #2256 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-09 | LOW | services/knowledge-service | VERIFIED | #2250 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-10 | LOW | services/queue-service | VERIFIED | #2251 | #2280 (66b04aedd) | 66b04aedd |
| V4-B-11 | LOW | services/finance-service | VERIFIED | #2255 | #2280 (66b04aedd) | 66b04aedd |
| V4-C-01 | MEDIUM | services/market-service | VERIFIED | #2264 | #2280 (66b04aedd) | 66b04aedd |
| V4-C-02 | MEDIUM | services/court-service, services/works-service | VERIFIED | #2259 | #2280 (66b04aedd) | 66b04aedd |
| V4-C-03 | MEDIUM | services/asset-service | VERIFIED | #2272 | #2280 (66b04aedd) | 66b04aedd |
| V4-C-04 | MEDIUM | services/market-service, services/building-service, services/event-ser | VERIFIED | #2265, #2284 | #2279 (e845c0401), #2280 (66b04aedd) | e845c0401, 66b04aedd |
| V4-C-05 | MEDIUM | services/refund-service | VERIFIED | #2267 | #2280 (66b04aedd) | 66b04aedd |
| V4-C-06 | LOW | packages/db | VERIFIED | #2257 | #2281 (400dbc822) | 400dbc822 |
| V4-D-01 | HIGH | services/finance-service | VERIFIED | #2260 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-02 | HIGH | services/finance-service | VERIFIED | #2258 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-03 | HIGH | services/grant-service | VERIFIED | #2261 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-04 | HIGH | services/grant-service | VERIFIED | #2262 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-05 | MEDIUM | services/grant-service | VERIFIED | #2263 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-06 | HIGH | services/hrms-service | VERIFIED | #2270 | #2280 (66b04aedd) | 66b04aedd |
| V4-D-07 | MEDIUM | services/court-service, services/works-service | VERIFIED | #2259 | #2280 (66b04aedd) | 66b04aedd |
| V4-E-01 | HIGH | services/citizen-service | DUPLICATE | #2240 | #2280 (66b04aedd) | 66b04aedd |
| V4-E-02 | HIGH | services/citizen-service | VERIFIED | #2238 | #2280 (66b04aedd) | 66b04aedd |
| V4-E-03 | MEDIUM | packages/auth | VERIFIED | #2274 | #2281 (400dbc822) | 400dbc822 |
| V4-E-04 | MEDIUM | apps/web | DUPLICATE | #2235 | #2280 (66b04aedd) | 66b04aedd |
| V4-E-05 | MEDIUM | packages/storage, services/admin-service | VERIFIED | #2276 | #2281 (400dbc822) | 400dbc822 |
| V4-E-06 | MEDIUM | services/hrms-service | VERIFIED | #2269 | #2280 (66b04aedd) | 66b04aedd |
| V4-E-07 | MEDIUM | services/citizen-service | VERIFIED | #2237 | #2280 (66b04aedd) | 66b04aedd |
| V4-F-01 | MEDIUM | services/gateway-service, services/telephony-service, services/workflo | VERIFIED | #2278 | #2280 (66b04aedd) | 66b04aedd |
| V4-F-02 | MEDIUM | services/visitor-service | VERIFIED | #2282 | #2280 (66b04aedd) | 66b04aedd |
| V4-F-03 | LOW | services/ml-service, services/visitor-service | VERIFIED | #2277 | #2280 (66b04aedd) | 66b04aedd |
| V4-F-04 | MEDIUM | packages/db | VERIFIED | #2257 | #2281 (400dbc822) | 400dbc822 |
| V4-F-05 | LOW | services/gateway-service, services/telephony-service, services/workflo | VERIFIED | #2278 | #2280 (66b04aedd) | 66b04aedd |
| V4-F-06 | LOW | services/gateway-service, services/telephony-service, services/workflo | VERIFIED | #2278 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-01 | HIGH | services/citizen-service, services/gateway-service | VERIFIED | #2283 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-02 | HIGH | services/citizen-service | VERIFIED | #2242 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-03 | HIGH | services/citizen-service | VERIFIED | #2241 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-04 | MEDIUM | services/citizen-service | DUPLICATE | #2240 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-05 | HIGH | services/audit-service | VERIFIED | #2275 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-06 | HIGH | services/citizen-service | VERIFIED | #2244 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-07 | MEDIUM | services/notification-service | VERIFIED | #2248 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-08 | HIGH | services/citizen-service, services/finance-service | VERIFIED | #2249 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-09 | MEDIUM | services/citizen-service, services/finance-service | VERIFIED | #2254 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-10 | MEDIUM | services/citizen-service | VERIFIED | #2243 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-11 | MEDIUM | services/citizen-service | VERIFIED | #2245 | #2280 (66b04aedd) | 66b04aedd |
| V4-G-12 | HIGH | services/citizen-service | UNRESOLVED | #2246 | #2280 (66b04aedd) | 66b04aedd |
| V4-INTEG-01 | MEDIUM | services/citizen-service (tests) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-01 | LOW | services/grant-service (tests) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-02 | MEDIUM | apps/web (hr/audit-log), services/hrms-service | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-03 | MEDIUM | services/advertisement-service, services/building-service (migrations) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-04 | LOW | tests (closure3-s4/s5 *.int.test.ts) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-05 | LOW | scripts/ci/authz-tenant-scanner-baseline.json | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-06 | LOW | tests/contract/cross-service-events.contract.test.ts | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-07 | MEDIUM | tests/contract, services/citizen-service, services/finance-service | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-08 | MEDIUM | tests/cross-service-live (hrms, payroll) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-09 | LOW | tests/security/idor-inventory.test.ts | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-10 | HIGH | db roles / scripts/ci/bootstrap-postgres.sh | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-11 | MEDIUM | services/telephony-service, services/citizen-service | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-12 | MEDIUM | tests/cross-service flow2/flow4/flow5 | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-13 | LOW | services/analytics-service (tests) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-14 | LOW | services/audit-service, apps/web (tests) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-17 | MEDIUM | services/queue-service/vitest.config.ts:10, services/hrms-service/src/ | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-15 | CRITICAL | repo (code scanning) | UNRESOLVED | n/a | n/a | n/a |
| V4-CERT-16 | HIGH | repo (code scanning) | UNRESOLVED | n/a | n/a | n/a |

### Defect-to-control mapping (each VERIFIED V4 defect)

The "related CI guard" column names a class-level guard where one exists; it is not a claim that the guard would have caught this exact defect.

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

### V4 defect detail (V4-A..G, then certification-found)

#### V4-A-01 - HIGH - VERIFIED
- Title: Service worker persists authenticated API data and personalised pages in Cache Storage and never clears them on logout
- Severity: HIGH
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read public/sw.js@1eaeecae7: networkFirst() puts every ok navigation (SHELL_CACHE) and GET /api/proxy/* (DATA_CACHE) in Cache Storage keyed by URL and serves it on fetch failure; the only caches.delete is the activate-handler version cleanup (sw.js:49-53). sync/logout.ts wipes IndexedDB/queue/responseCache/key/trust token only. Not run in a browser.
- Root cause: SW cache is not namespaced per user/tenant and is outside the logout wipe path
- Corrective action: - `/api/proxy` GETs: network-only (503 OFFLINE JSON on failure); never written to Cache Storage. Offline reads remain served by the encrypted per-user IndexedDB response cache. - Navigation/static/precache writes gated by `isCacheable()`: ok, not redirected, and not `Cache-Control: no-store|private`. - `CIVITASONE_PURGE` message: deletes all `civitasone-*` caches, re-seeds the public `/offline` fallback only. - `performLogout()` deletes `civitasone-*` caches directly (best-effort) and posts `CIVITASONE_PURGE` to the controlling SW. - `CACHE_VERSION` bumped to `v2`, `DATA_CACHE` removed, so activate evicts v1 caches.
- Changed files: apps/web/public/sw.js, apps/web/src/lib/sync/logout.ts, apps/web/src/middleware.ts
- Test cases: `apps/web/src/lib/sync/logout.test.ts`, `apps/web/src/lib/sync/swCache.test.ts`, `apps/web/src/middleware.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2252 round 3 head f287da5d4 -> CLEAN (2026-10-25T19:40:01Z): Head confirmed (3 commits, one defect each, MERGEABLE). Files confined to the slice: sw.js, middleware.ts (+/offline PUBLIC_SEGMENT), logout.ts, and their tests. No contract/RLS/CQRS/money changes; no secret literals in any commit
- PR: original #2252; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Only the user-agnostic /offline page is cached; offline behaviour for authenticated routes is degraded by design.

#### V4-A-02 - HIGH - VERIFIED
- Title: CSP connect-src 'self' blocks every browser direct-to-storage presigned upload
- Severity: HIGH
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read middleware.ts: connect-src is 'self' + Keycloak origin only, applied to every non-static path (matcher). documents.ts uploadToStorage does fetch(uploadUrl,{method:PUT}) against the presigned S3/LocalStack URL (AWS_ENDPOINT_URL=http://localstack:4566 in prod compose), a different origin, so the CSP blocks it. Not run in a browser.
- Root cause: Strict nonce CSP (H2 fix) was added without allow-listing the object-storage origin
- Corrective action: `STORAGE_ORIGIN` resolved once at module load, mirroring `KEYCLOAK_ORIGIN`: `NEXT_PUBLIC_STORAGE_ORIGIN`, else `AWS_ENDPOINT_URL`, else `https://<AWS_S3_BUCKET>.s3.<AWS_DEFAULT_REGION|ap-south-1>.amazonaws.com`. Reduced to `URL.origin`, http/https only, invalid values yield nothing. Appended to `connect-src`; no wildcards; no other directive touched.
- Changed files: apps/web/src/middleware.ts
- Test cases: `apps/web/src/middlewareCspStorage.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2266 round 1 head 36b10f721 -> CLEAN (2026-10-25T19:33:15Z): Verified: - Regression test: src/middlewareCspStorage.test.ts FAILS on origin/main middleware.ts (4 failed, 1 passed) and PASSES on head; with middleware.test.ts 31/31 pass. - Scope: 2 files (apps/web/src/middleware.ts, new test),
- PR: original #2266; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: - Requires the env var (or AWS_* vars) to be present in the web app's runtime env; with none set behaviour is unchanged (`'self'` + Keycloak). - Path-style S3 endpoints and CDNs in front of storage need `NEXT_PUBLIC_STORAGE_ORIGIN`. - `.env.example` / deployment env were outside this slice's file ownership and are not updated here. - CORS on the bucket for the app origin is a separate infra concern.

#### V4-A-03 - MEDIUM - VERIFIED
- Title: BFF proxy path guard bypassed by encoded slash segments: request can escape /api prefix to arbitrary gateway paths with the user's bearer token
- Severity: MEDIUM
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read route.ts:46: guard only rejects segments equal to '..' or '.'; target is built by joining segments, so a segment containing '/../' normalises via fetch/URL out of /api/. decodeURIComponent unguarded (URIError). Next decoding %2F inside catch-all params not exercised on a real server; impact limited to the caller's own token.
- Root cause: Per-segment string comparison instead of validating the normalised final URL; decodeURIComponent unguarded
- Corrective action: Reject any segment containing '/', '\\', '?', '#', or '..'; wrap decode in try/catch; verify new URL(target).pathname startsWith('/api/')
- Changed files: apps/web/src/app/api/careers/auth/otp-request/route.ts, apps/web/src/app/api/careers/auth/otp-verify/route.ts, apps/web/src/app/api/notification/mark-read/route.ts, apps/web/src/app/api/notification/stream/route.ts, apps/web/src/app/api/notification/stream/unread/route.ts, apps/web/src/app/api/proxy/[...path]/route.ts
- Test cases: `apps/web/src/app/api/careers/auth/tenantBinding.test.ts`, `apps/web/src/app/api/notification/upstreamFailure.test.ts`, `apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts`, `apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2235 round 1 head 6802c12ac -> CLEAN (2026-10-25T18:11:39Z): Diff reviewed in full (3 commits: V4-A-03+V4-E-04 path guard, V4-A-05 upstream 502/timeout, V4-A-06 careers tenant binding). One defect per commit, no out-of-scope hunks, all files within apps/web/src/app/api/{proxy,notification,c
- PR: original #2235; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-A-04 - LOW - VERIFIED
- Title: Auth middleware public-path allow-list uses bare prefix matching, so unrelated paths such as /contacts, /authz, /verifyx, /api/contactsX skip the session check
- Severity: LOW (discoverer said MEDIUM)
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read middleware.ts:25 and isPublicPath: PUBLIC.some(p=>pathname.startsWith(p)) with no boundary, so /contacts, /authz, /verifyx match. No such routes exist today, hence latent.
- Root cause: Segment-boundary logic applied to only two of the lists
- Corrective action: Match PUBLIC entries as p or p + '/' (keep trailing-slash entries and exact files as they are)
- Changed files: apps/web/src/middleware.ts
- Test cases: `apps/web/src/middleware.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2247 round 1 head 95fbff8c3 -> CLEAN (2026-10-25T19:05:49Z): Scope: 2 commits, one defect each (V4-A-04 d1fbab80, V4-A-09 95fbff8c); only apps/web/src/middleware.ts and middleware.test.ts touched, within slice ownership. No contract, migration, RLS, CQRS or money surface. No secret-shaped l
- PR: original #2247; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Low. Public matching is strictly narrower (only unrelated sibling prefixes lose public access; none exist today). Regression tests list every previously-public path and assert it stays public.

#### V4-A-05 - LOW - VERIFIED
- Title: BFF proxy does not catch upstream fetch failure: gateway down yields an unhandled exception / HTML 500 instead of the JSON error envelope
- Severity: LOW (discoverer said MEDIUM)
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read route.ts:65-73: await fetch(target) and arrayBuffer() have no try/catch or timeout, so a gateway outage rejects out of the handler (Next generic 500, not the JSON envelope). Not run.
- Root cause: Missing error boundary in the single funnel for all browser API traffic
- Corrective action: Wrap upstream fetch in try/catch returning NextResponse.json({code:'UPSTREAM_UNAVAILABLE'},{status:502}) and add an AbortSignal.timeout
- Changed files: apps/web/src/app/api/careers/auth/otp-request/route.ts, apps/web/src/app/api/careers/auth/otp-verify/route.ts, apps/web/src/app/api/notification/mark-read/route.ts, apps/web/src/app/api/notification/stream/route.ts, apps/web/src/app/api/notification/stream/unread/route.ts, apps/web/src/app/api/proxy/[...path]/route.ts
- Test cases: `apps/web/src/app/api/careers/auth/tenantBinding.test.ts`, `apps/web/src/app/api/notification/upstreamFailure.test.ts`, `apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts`, `apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2235 round 1 head 6802c12ac -> CLEAN (2026-10-25T18:11:39Z): Diff reviewed in full (3 commits: V4-A-03+V4-E-04 path guard, V4-A-05 upstream 502/timeout, V4-A-06 careers tenant binding). One defect per commit, no out-of-scope hunks, all files within apps/web/src/app/api/{proxy,notification,c
- PR: original #2235; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-A-06 - MEDIUM - VERIFIED
- Title: Public careers OTP routes forward an unvalidated client-supplied tenantId that contradicts the x-tenant-id header
- Severity: MEDIUM
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read otp-request/route.ts:16 (and otp-verify): body tenantId ?? TENANT_ID forwarded unvalidated while header uses TENANT_ID; careers/apply/route.ts:6-11 validates against UUID_RE. Upstream behaviour not exercised.
- Root cause: Inconsistent input validation across the public careers proxy routes
- Corrective action: Validate tenantId against UUID_RE, derive one tenant value and use it for both header and body
- Changed files: apps/web/src/app/api/careers/auth/otp-request/route.ts, apps/web/src/app/api/careers/auth/otp-verify/route.ts, apps/web/src/app/api/notification/mark-read/route.ts, apps/web/src/app/api/notification/stream/route.ts, apps/web/src/app/api/notification/stream/unread/route.ts, apps/web/src/app/api/proxy/[...path]/route.ts
- Test cases: `apps/web/src/app/api/careers/auth/tenantBinding.test.ts`, `apps/web/src/app/api/notification/upstreamFailure.test.ts`, `apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts`, `apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2235 round 1 head 6802c12ac -> CLEAN (2026-10-25T18:11:39Z): Diff reviewed in full (3 commits: V4-A-03+V4-E-04 path guard, V4-A-05 upstream 502/timeout, V4-A-06 careers tenant binding). One defect per commit, no out-of-scope hunks, all files within apps/web/src/app/api/{proxy,notification,c
- PR: original #2235; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-A-07 - LOW - VERIFIED
- Title: Money forms convert paise string to Number() with no safe-integer guard, silently altering amounts above 2^53 paise
- Severity: LOW (discoverer said MEDIUM)
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read NewMedicalClaimForm.tsx:53-67: amountMinor: Number(minor) with no isSafeInteger guard; Number('12345678901234567') is 12345678901234568. Needs amounts above ~90 trillion rupees.
- Root cause: Per-form guard copy-pasted inconsistently instead of a shared helper
- Corrective action: Provide minorToSafeNumber() in lib/money that returns null above Number.MAX_SAFE_INTEGER and use it in every body builder Cycle 2 added CreateTenderForm.tsx (minorToSafeNumber) on #2236.
- Changed files: apps/web/src/app/(app)/admin/metering/usageLimits.ts, apps/web/src/app/(app)/assets/[id]/AssetFinancialActions.tsx, apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx, apps/web/src/app/(app)/assets/insurance/claims/ClaimActions.tsx, apps/web/src/app/(app)/contracts/[id]/BondActions.tsx, apps/web/src/app/(app)/hr/medical/new/NewMedicalClaimForm.tsx, apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx, apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx, apps/web/src/lib/money.ts
- Test cases: `apps/web/src/app/(app)/admin/metering/usageLimits.test.ts`, `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.test.tsx`, `apps/web/src/lib/money.formGuard.test.ts`, `apps/web/src/lib/money.safeNumber.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2236 round 1 head 57b19701f -> CLEAN (2026-10-25T20:25:22Z): Scope: new commit 57b19701f (on top of aa1c36924, already reviewed CLEAN) touches only CreateTenderForm.tsx and its test; one defect (V4-A-07), trailer correct. No migrations, contracts, secret-shaped literals or gitleaks:allow. M
- PR: original #2236; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-A-08 - LOW - VERIFIED
- Title: Usage-limit cell reports 'over limit' for consumption below the limit because of Math.round
- Severity: LOW
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read usageLimits.ts:40-42: percent=Math.round(used/limit*100) feeds the >=100 and >=80 thresholds, so 996/1000 gives 100 and level bad.
- Root cause: Thresholds applied to the rounded percentage
- Corrective action: Compare the unrounded ratio (used/limit*100) to the thresholds, use Math.floor for display
- Changed files: apps/web/src/app/(app)/admin/metering/usageLimits.ts, apps/web/src/app/(app)/assets/[id]/AssetFinancialActions.tsx, apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx, apps/web/src/app/(app)/assets/insurance/claims/ClaimActions.tsx, apps/web/src/app/(app)/contracts/[id]/BondActions.tsx, apps/web/src/app/(app)/hr/medical/new/NewMedicalClaimForm.tsx, apps/web/src/app/(app)/procurement/contracts/new/CreateContractForm.tsx, apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx, apps/web/src/lib/money.ts
- Test cases: `apps/web/src/app/(app)/admin/metering/usageLimits.test.ts`, `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.test.tsx`, `apps/web/src/lib/money.formGuard.test.ts`, `apps/web/src/lib/money.safeNumber.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2236 round 1 head 57b19701f -> CLEAN (2026-10-25T20:25:22Z): Scope: new commit 57b19701f (on top of aa1c36924, already reviewed CLEAN) touches only CreateTenderForm.tsx and its test; one defect (V4-A-07), trailer correct. No migrations, contracts, secret-shaped literals or gitleaks:allow. M
- PR: original #2236; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-A-09 - LOW - VERIFIED
- Title: /logout and /offline are not in the public path list: signing out with an expired session detours through login, and the offline fallback redirects to a login page that cannot load offline
- Severity: LOW
- Component: apps/web
- Requirement: Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)
- Reproduction evidence: Read middleware.ts PUBLIC lists: no /logout or /offline entry, so an absent/expired access cookie redirects to /auth/login?next=. sw.js precaches /offline.
- Root cause: Routes omitted from PUBLIC list
- Corrective action: Add '/logout' and '/offline' to the public lists
- Changed files: apps/web/src/middleware.ts
- Test cases: `apps/web/src/middleware.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2247 round 1 head 95fbff8c3 -> CLEAN (2026-10-25T19:05:49Z): Scope: 2 commits, one defect each (V4-A-04 d1fbab80, V4-A-09 95fbff8c); only apps/web/src/middleware.ts and middleware.test.ts touched, within slice ownership. No contract, migration, RLS, CQRS or money surface. No secret-shaped l
- PR: original #2247; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Low. Public matching is strictly narrower (only unrelated sibling prefixes lose public access; none exist today). Regression tests list every previously-public path and assert it stays public.

#### V4-B-01 - MEDIUM - VERIFIED
- Title: HRMS comp-off is an in-memory array with no ownership or approval: any employee can mint, list and redeem comp-off for anyone
- Severity: MEDIUM (discoverer said HIGH)
- Component: services/hrms-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read comp-off-routes.ts at 1eaeecae7: module-level compOffStore array (l.30); POST/GET/redeem all requireRole(ALL_ROLES incl. employee, l.13) with no actor/employee scoping; route registered at app.ts:259. Redeem only flips status, nothing credits leave, so no balance impact.
- Root cause: Scaffold left in production routes: ALL_ROLES includes employee, no actor/employee scoping, no approval step, no DB table.
- Corrective action: Back with a tenant-RLS table and F3 command; restrict earn to HR or approved flow; scope list/redeem via resolveEmployeeForActor.
- Changed files: services/hrms-service/migrations/0252_hrms_comp_off.sql, services/hrms-service/src/modules/leave/comp-off-commands.ts, services/hrms-service/src/modules/leave/comp-off-consumer.ts, services/hrms-service/src/modules/leave/comp-off-routes.ts, services/hrms-service/src/modules/leave/consumer.ts, services/hrms-service/src/modules/leave/schema.ts, services/hrms-service/src/topics.ts
- Test cases: `services/hrms-service/src/__tests__/comp-off-persist-real-db.test.ts`, `services/hrms-service/src/modules/leave/comp-off-authz.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2271 round 2 head 1b49fcaac -> CLEAN (2026-10-25T20:54:44Z): Head changed from 357f3b75 to 1b49fcaa; the new commit touches only `services/hrms-service/src/modules/leave/comp-off-authz.test.ts` (adds a tenant-GUC `DELETE` of the test tenant's `leave.hrms_comp_off` rows in beforeAll/afterAll
- PR: original #2271; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Persistence added by cycle 2 (migration 0252_hrms_comp_off.sql). Integration defect V4-CERT-02: web auditResource.test fails because resourceType comp_off is not in HR_AUDIT_RESOURCE_TYPES.

#### V4-B-02 - HIGH - VERIFIED
- Title: Citizen document resubmit lacks ownership check: any citizen can supersede another citizen's deficient/rejected submission
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read routes.ts:157-163 (only requireRole CITIZEN_ROLES), commands.ts:249-253 (loads prior by tenant+id, no citizenId comparison), consumer.ts:166-185 (inserts new row under prior.citizenId and marks victim row superseded). GET at routes.ts:139-147 does assertOwnership. Requires knowing the victim submission UUID.
- Root cause: Ownership assertion applied to the read route only.
- Corrective action: - `commands.resubmit`: `assertOwnership(ctx, prior.citizenId)` (404 for non-owner, officers exempt) before any state/key check. - New `ownership.ts#assertApplicationAccess` (officer exempt; foreign application => 404): applied in `upload`, `digilockerFetchIntake`, `beginDigiLockerAuthorize` and the `/checklist` route. The callback inherits the check through the state bound at authorize. - An applicationId that resolves to no application is deliberately left to prior behaviour (existing `tests/service-gaps-partial-routes.test.ts` references an unmaterialised application id); the submission is still recorded under the caller's own citizenId.
- Changed files: services/citizen-service/src/modules/documents/commands.ts, services/citizen-service/src/modules/documents/ownership.ts, services/citizen-service/src/modules/documents/routes.ts
- Test cases: `services/citizen-service/src/modules/documents/ownership.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2240 round 1 head 6ee052381 -> CLEAN (2026-10-25T18:19:54Z): Verified on my own disposable postgis:16 (non-superuser `citizen_svc`, bootstrap applied): - Regression `documents/ownership.test.ts`: on origin/main code (commands.ts/routes.ts reverted) 3 fail (`expected 202 to be 404` on resubm
- PR: original #2240; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Resubmit of a submission whose `citizenId` is null is now denied for citizens (officers unaffected). An absent-application id is still accepted on upload (harmless: recorded under the caller). Related tests outside this slice's file ownership still reference an unmaterialised application id.

#### V4-B-03 - MEDIUM - VERIFIED
- Title: Billing payment-gateway webhooks (Razorpay, PayU, CCAvenue) are unreachable: not marked public so authPlugin returns 401
- Severity: MEDIUM
- Component: services/billing-service, services/gateway-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read: the three POST /v1/billing/webhooks/* routes have no config.public; authPlugin (packages/auth/src/plugin.ts:70-83) only skips /health,/ready,/metrics and config.public===true, so they 401. Razorpay HMAC uses JSON.stringify(req.body) (checkout-routes.ts:138). Fail-closed availability bug, not an exposure. Prior CLOS-S4-04 touches razorpay.ts but is a different file and issue; not treated as a duplicate.
- Root cause: Same bug shape previously fixed for fire/trade nocs verify; not applied here.
- Corrective action: - `config: { public: true }` on `POST /v1/billing/webhooks/{razorpay,payu,ccavenue}`. - Razorpay: `preParsing` hook captures the raw bytes; HMAC verified over them. Event is queued under the signed `notes.tenantId` (UUID) instead of `"system"`, because the consumer runs in the message tenant context and FORCE-RLS would otherwise reject its writes. - PayU: reverse hash `sha512(SALT|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key)` (+`additionalCharges|` prefix) with our configured key/salt, constant-time compare; form-urlencoded parser added in that route scope. - CCAvenue: `encResp` must be well-formed ciphertext that decrypts under the working key to `order_id=...` pairs. - Gateway public prefix `/api/v1/billing/webhooks` (exact sub-tree; all other billing routes keep their edge check). - Unconfigured gateway credentials -> 503 `WEBHOOK_NOT_CONFIGURED`; bad signature/has
- Changed files: services/billing-service/src/modules/gateways/ccavenue-adapter.ts, services/billing-service/src/modules/gateways/payu-adapter.ts, services/billing-service/src/modules/gateways/routes.ts, services/billing-service/src/modules/gateways/webhook-verify.ts, services/billing-service/src/modules/payments/checkout-routes.ts, services/gateway-service/src/app.ts, services/gateway-service/src/public-prefixes.ts
- Test cases: `services/billing-service/tests/v4-b03-webhooks-public.test.ts`, `services/gateway-service/tests/v4-b03-billing-webhook-prefix.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2268 round 1 head abf9278de -> CLEAN (2026-10-25T20:25:50Z): (BLOCKED_FOR_APPROVAL stays open for the owner; not for merge by agents). Verified on my own disposable Postgres 16 (non-superuser `billing_svc`, migrations applied, marker DB): - Regression tests FAIL on origin/main src and PASS 
- PR: original #2268; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Gateway forwards raw webhook bodies to billing-service; the provider-to-ledger path was not exercised against real providers or a live stack (E2E NOT_RUN).

#### V4-B-04 - MEDIUM - VERIFIED
- Title: Push subscription revoke has no ownership check: any citizen/employee can disable any user's push subscription
- Severity: MEDIUM
- Component: services/notification-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read push/routes.ts:99-103 (SELF_ROLES only, no lookup), commands.revokeSubscription publishes with id, consumer.ts:93-101 and repo.ts:42-54 update by tenant+id with no user_id predicate; non-existent id still returns 202.
- Root cause: Ownership check done in sibling DND/in-app routes but omitted here.
- Corrective action: V4-B-04 (MEDIUM, AUTO): `DELETE /v1/notification/push/subscriptions/:id` had no ownership check, so any citizen/employee could revoke any user's push subscription in the tenant, and unknown ids still returned 202. - Route now looks up the subscription owner; 404 unless the caller owns it or holds an admin role (foreign and unknown ids return the same 404, so ids cannot be probed). - The revoke command carries the owner `userId` and `repo.revokeSubscription` adds `user_id` to its WHERE (defence in depth; optional so already-queued commands still work).
- Changed files: services/notification-service/src/modules/push/commands.ts, services/notification-service/src/modules/push/consumer.ts, services/notification-service/src/modules/push/repo.ts, services/notification-service/src/modules/push/routes.ts
- Test cases: `services/notification-service/tests/v4b04-push-revoke-ownership.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2239 round 1 head 564788b1c -> CLEAN (2026-10-25T18:35:15Z): Verdict: CLEAN. No required fixes. Checked: - Scope: 1 commit, 1 defect (V4-B-04, MEDIUM). 5 files, all under services/notification-service/**; no out-of-scope hunks, no migration, no contract/event shape change (payload gains an 
- PR: original #2239; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-B-05 - MEDIUM - NOT_REPRODUCED
- Title: Sanitation complaints: any citizen can read or reopen any complaint and file complaints in another user's name
- Severity: MEDIUM
- Component: services/helpdesk-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read sanitation/routes.ts: GET /complaints/:id (l.135) and reopen (l.182) use CITIZEN_ROLES and findComplaint(id,tenant) with no reportedBy check; complaintView returns reportedBy, location, photo; POST accepts body.reportedBy (l.24,109).
- Root cause: latent dead code (module never registered)
- Corrective action: none; fix when sanitationRoutes is registered
- Changed files: none
- Test cases: none
- Verification result: sanitationRoutes is never registered (not in helpdesk-service/src/app.ts or anywhere else in the repo), so every /v1/helpdesk/sanitation/* path returns 404; a test run confirmed 404 for GET, reopen and POST (remediation-result.json, slice helpdesk). The missing ownership scoping is latent dead code to fix when the module is registered.
- Independent reviewer decision: none recorded
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: NOT_REPRODUCED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-B-06 - MEDIUM - VERIFIED
- Title: Advertisement and building permit public verification endpoints are unreachable anonymously (401)
- Severity: MEDIUM
- Component: services/advertisement-service, services/building-service, services/gateway-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read both verify routes: no config.public, so authPlugin returns 401 for anonymous callers; repo.findByVerificationCode uses scopedRead on RLS table without tenant predicate. Same defects documented as fixed for fire in fire-service nocs/routes.ts:50-66. Did not run a test.
- Root cause: Fix applied to fire/trade/shop only.
- Corrective action: - `config: { public: true }` on both `/permits/verify` routes; they now read a **non-RLS public directory table** (`adv_permit_directory`, `building_permit_directory`) holding only permit number, status, issue/validity dates (and advertisement type). No location / applicant / application data is copied. - The permits repos keep the directory in sync **inside the same transaction** as every write that changes public state: `insertPermit`, `updateStatus` / `updatePermitStatus`, `updateValidUntil` (all permit writes go through these; verified by grep). Updates are keyed on `(permit_id, tenant_id)`. - Migrations are additive and idempotent, and **backfill existing permits** so already-printed QR codes resolve. The backfill is one `DO` block (one transaction) that does `NO FORCE ROW LEVEL SECURITY` -> `INSERT ... SELECT ... ON CONFLICT DO NOTHING` -> `FORCE ROW LEVEL SECURITY` (an owner would
- Changed files: services/advertisement-service/migrations/0006_permit_public_directory.sql, services/advertisement-service/src/modules/permits/repo.ts, services/advertisement-service/src/modules/permits/routes.ts, services/building-service/migrations/0004_permit_public_directory.sql, services/building-service/src/modules/permits/repo.ts, services/building-service/src/modules/permits/routes.ts, services/gateway-service/src/public-prefixes.ts
- Test cases: `services/advertisement-service/tests/v4-b06-permit-verify-public.test.ts`, `services/building-service/tests/v4-b06-permit-verify-public.test.ts`, `services/gateway-service/tests/v4-b06-permit-verify-public-prefix.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2273 round 1 head 02f702633 -> CLEAN (2026-10-25T19:20:59Z): Reviewed the full diff vs origin/main (10 files, 1 commit, MERGEABLE). BLOCKED_FOR_APPROVAL: owner approval is still required before merge (migrations + public-route auth boundary). **Regression tests (run both ways, disposable Po
- PR: original #2273; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Public directory tables adv_permit_directory and building_permit_directory carry tenant_id without RLS in the same migration: tenant-table-rls-guard FAILS (V4-CERT-03).

#### V4-B-07 - MEDIUM - VERIFIED
- Title: Helpdesk CES submission has no role or ownership check; first anonymous-ish caller poisons the score and blocks the real requester
- Severity: MEDIUM
- Component: services/helpdesk-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read calendar-routes.ts:143-153: resolveContext only, ticketExists check, one-per-ticket 409; no requester comparison, so any tenant user can pre-empt the requester's CES.
- Root cause: Missing authorization.
- Corrective action: - V4-B-07 (MEDIUM, AUTO): CES submission now requires the caller to be the ticket requester (404 unknown ticket, 403 non-requester, checked before the one-per-ticket 409). - V4-B-05: NOT_REPRODUCED as an exploitable defect, no change. sanitationRoutes is never registered in helpdesk-service/src/app.ts (nor anywhere else in the repo), so all /v1/helpdesk/sanitation/* paths return 404 on origin/main; the missing ownership scoping in sanitation/routes.ts is latent dead code. It should be fixed before anyone registers the module.
- Changed files: services/helpdesk-service/src/modules/sla/calendar-queries.ts, services/helpdesk-service/src/modules/sla/calendar-routes.ts
- Test cases: `services/helpdesk-service/tests/v4-b07-ces-requester.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2253 round 3 head 07ee46754 -> CLEAN (2026-10-25T19:47:22Z): Head changed: one commit (07ee46754) on base 1eaeecae7, MERGEABLE. The earlier gitleaks:allow commit is gone; no secret literal or allow marker in the PR. The test reads the secret from process.env.JWT_SECRET (set by vitest config
- PR: original #2253; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-B-08 - MEDIUM - VERIFIED
- Title: Receipts and Payments statement reports closing_balance without opening balance
- Severity: MEDIUM
- Component: services/finance-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read financial-statements/routes.ts:204-221: closing_balance = SUM(receipt)-SUM(payment) filtered to FY dates only; no opening balance computed.
- Root cause: FY-window aggregation labelled as closing balance.
- Corrective action: Single query now aggregates all entries up to FY end: `opening_balance` = net of entries before FY start; `total_receipts`/`total_payments` = FY window only; `closing_balance` = opening + receipts - payments. A cash/bank row with only prior-FY entries is now also returned. Additive field `opening_balance`; existing field names unchanged; money stays bigint minor units; tenant filter unchanged. No migration. Endpoint path/method unchanged (api-baseline untouched).
- Changed files: services/finance-service/src/modules/financial-statements/routes.ts
- Test cases: `services/finance-service/tests/statements-receipts-payments-opening.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2256 round 1 head c79bc2292 -> CLEAN (2026-10-25T18:45:39Z): Reviewed full diff vs origin/main (2 files, 1 commit, 1 defect). - Regression test FAILS on origin/main src (`['undefined','300','100','200']` vs `['800','300','100','1000']`; `['undefined','7','0','7']` vs `['1000','7','0','1007'
- PR: original #2256; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Semantics change for existing callers of `closing_balance` (now includes opening). Opening is derived from `gl.finance_cash_book` receipt/payment history, so any pre-cutover balances not recorded as cash-book entries (opening-balance voucher) will not appear.

#### V4-B-09 - LOW - VERIFIED
- Title: /v1/knowledge/ai/prompt is an unrestricted LLM proxy for every authenticated principal
- Severity: LOW (discoverer said MEDIUM)
- Component: services/knowledge-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read knowledge-service ai/routes.ts:54-90: resolveContext only, caller-supplied system (max 2000) and userMessage forwarded; no requireRole; no rate-limit registration in knowledge-service/src/app.ts. Route returns 404 unless FEATURE_AI_ASSISTANT_ENABLED=true, so off by default.
- Root cause: Generic passthrough exposed as endpoint.
- Corrective action: Require a role, per-actor rate limit, and remove caller-controlled system prompt.
- Changed files: services/knowledge-service/src/modules/ai/prompt-limiter.ts, services/knowledge-service/src/modules/ai/routes.ts
- Test cases: `services/knowledge-service/tests/v4-b-09-ai-prompt-hardening.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2250 round 1 head 4e389ccc7 -> CLEAN (2026-10-25T18:28:45Z): Diff vs origin/main: 3 files, all under services/knowledge-service/**; one defect, one commit; no out-of-scope hunks; no migrations or contract changes; MERGEABLE, branch current with main. - Regression test v4-b-09-ai-prompt-hard
- PR: original #2250; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-B-10 - LOW - VERIFIED
- Title: queue-service ops endpoints marked public with presence-only auth
- Severity: LOW
- Component: services/queue-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read queue-service/src/app.ts:41-57: requireOpsAuth accepts any non-empty Authorization header or x-internal: 1; routes are config.public. Discloses only driver and health status.
- Root cause: Hand-rolled check bypasses authPlugin.
- Corrective action: Removed `requireOpsAuth` and `config.public`; `authPlugin` now verifies the bearer JWT (or `x-internal` + `x-tenant-id` + constant-time `INTERNAL_SERVICE_SECRET`). Gateway-proxied callers already carry a verified bearer. `vitest.config.ts` gains HS256 test env; `status.test.ts` now signs a token instead of sending a bare `x-internal: 1` (that bare header is exactly what is no longer accepted).
- Changed files: services/queue-service/src/app.ts, services/queue-service/vitest.config.ts
- Test cases: `services/queue-service/tests/status.test.ts`, `services/queue-service/tests/v4-b-10-ops-auth.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2251 round 1 head f10b526d1 -> CLEAN (2026-10-25T18:27:55Z): Scope: 4 files, all under services/queue-service/**, single commit and single defect (V4-B-10). No out-of-scope hunks. MERGEABLE. No contract change (routes and response shapes unchanged; only the ops catalogue auth labels). - Fix
- PR: original #2251; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-B-11 - LOW - VERIFIED
- Title: Cash-flow statement orders months 1..12, putting Jan-Mar of the FY first
- Severity: LOW
- Component: services/finance-service
- Requirement: Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)
- Reproduction evidence: Read routes.ts:233-241: GROUP BY/ORDER BY EXTRACT(MONTH) gives 1..12, so Jan-Mar of the FY sort before Apr-Dec.
- Root cause: No FY-relative ordering.
- Corrective action: Order by entry_date month start.
- Changed files: services/finance-service/src/modules/financial-statements/routes.ts
- Test cases: `services/finance-service/tests/statements-cashflow-fy-order.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2255 round 1 head f887b98fd -> CLEAN (2026-10-25T18:43:37Z): Diff vs origin/main (1eaeecae): 2 files, both in services/finance-service (routes.ts:240 one-line ORDER BY; new tests/statements-cashflow-fy-order.test.ts). One commit, one defect, slice-owned, no out-of-scope hunks, no contract/r
- PR: original #2255; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-C-01 - MEDIUM - VERIFIED
- Title: market_properties.property_code is globally UNIQUE (not per-tenant) while the value is tenant-supplied
- Severity: MEDIUM (discoverer said HIGH)
- Component: services/market-service
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: Read 0001_initial.sql:40 (property_code text NOT NULL UNIQUE), schema.ts:8 .unique(); no later migration alters it. Global unique index is cross-tenant by construction.
- Root cause: `0001_initial.sql:40` `property_code text NOT NULL UNIQUE` is a single-column, table-wide constraint (mirrored by `.unique()` in `properties/schema.ts`).
- Corrective action: Migration `0003_property_code_per_tenant_unique.sql` creates `UNIQUE INDEX (tenant_id, property_code)` and drops `market_properties_property_code_key`; drizzle schema updated. Idempotent (this repo re-applies all migration files; there is no ledger). Existing data cannot violate the weaker constraint.
- Changed files: services/market-service/migrations/0003_property_code_per_tenant_unique.sql, services/market-service/src/modules/properties/schema.ts
- Test cases: `services/market-service/tests/v4-c-01-property-code-per-tenant.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2264 round 1 head 0d9f7b6eb -> CLEAN (2026-10-25T19:10:16Z): Scope: 3 files (migration 0003, properties/schema.ts, new test), one defect, one commit, all inside services/market-service/**. No contract, route or consumer changes. Migration 0003 does not collide with origin/main (0001, 0002 o
- PR: original #2264; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Schema change (migration) applied only on disposable DBs in this certification; production migration sequencing not exercised.

#### V4-C-02 - MEDIUM - VERIFIED
- Title: Tenant A can fabricate a party row bound to tenant B case id (cross-tenant FK) and probe case-id existence
- Severity: MEDIUM (discoverer said HIGH)
- Component: services/court-service, services/works-service
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: routes.ts POST /cases/:id/parties passes URL id to commands.addParty, which publishes with no case lookup; consumer insertParty uses p.caseId; FK is REFERENCES court.cases(id) only (0001:125), FK checks bypass RLS.
- Root cause: see reproduction
- Corrective action: Two AUTO (MEDIUM) defects from the V4 closure run, one commit each. - **V4-C-02** court `addParty` trusted the URL case id and published with no lookup; the consumer FK check bypasses RLS, so a registrar could attach a PII party row to another tenant case id and probe case-id existence. Fix: tenant-scoped synchronous pre-check (`getCaseForPrecheck`, 404 `CASE_NOT_FOUND`) before publish. Composite FKs remain a separate protected change (not done here). - **V4-D-07** works `contractorCreate` / `contractorRate` consumers swallowed every non-NonRetryable error after rollback, losing the accepted command. Fix: rethrow all errors (matches `contractorUpdate`).
- Changed files: services/court-service/src/modules/party/commands.ts, services/works-service/src/modules/contractor/consumer.ts
- Test cases: `services/court-service/tests/commands-coverage.test.ts`, `services/court-service/tests/v4-c-02-addparty-case-tenant.test.ts`, `services/works-service/tests/v4-d-07-contractor-consumer-rethrow.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2259 round 1 head dc9b7fc5b -> CLEAN (2026-10-25T18:48:02Z): Diff read in full (5 files, 2 commits, one defect each, both with the Co-Authored-By trailer). Slice ownership respected (court-service, works-service/modules/contractor). No migrations, no contract changes, no secret-shaped liter
- PR: original #2259; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-C-03 - MEDIUM - VERIFIED
- Title: asset streetlight pole_id globally UNIQUE
- Severity: MEDIUM
- Component: services/asset-service
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: 0030_streetlight_tables.sql:39 pole_id text NOT NULL UNIQUE; migration comment 28-36 admits it.
- Root cause: `0030_streetlight_tables.sql:39` `pole_id text NOT NULL UNIQUE` (and `.unique()` in `streetlight/schema.ts`); the migration's own comment flagged it.
- Corrective action: In `0030_streetlight_tables.sql` (the slice-owned file): drop the column-level UNIQUE from the CREATE TABLE, add `CREATE UNIQUE INDEX IF NOT EXISTS asset_streetlights_tenant_pole_uidx (tenant_id, pole_id)` and `DROP CONSTRAINT IF EXISTS asset_streetlights_pole_id_key`. Migrations in this repo are re-applied in full (no ledger; see `scripts/ops/migrate-rollback.sh`), so databases that already ran the original 0030 pick up the change on the next run; fresh databases get the new shape directly. Drizzle schema updated. Existing data cannot violate the weaker constraint.
- Changed files: services/asset-service/migrations/0030_streetlight_tables.sql, services/asset-service/src/modules/streetlight/schema.ts
- Test cases: `services/asset-service/tests/v4-c-03-streetlight-pole-id-per-tenant.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2272 round 1 head f11087b5b -> CLEAN (2026-10-25T19:20:57Z): Scope: 3 files (migration 0030 edited in place, streetlight/schema.ts, new regression test), one commit, one defect, MERGEABLE, up to date with origin/main, within slice ownership. No out-of-scope hunks, no contract/event changes,
- PR: original #2272; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Schema change (migration) applied only on disposable DBs in this certification.

#### V4-C-04 - MEDIUM - VERIFIED
- Title: Random 6-digit reference numbers against a global UNIQUE column (birthday collisions ~50% at 1200 records)
- Severity: MEDIUM
- Component: services/market-service, services/building-service, services/event-service, services/parking-service, services/trade-service
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: Read parking bookings consumer:39 and trade licences consumer:54: PREFIX('ULB', randomInt(1,999999)); trade migration 0001 has UNIQUE on application_number/licence_number alone. Birthday collision math is standard.
- Root cause: `allotments/consumer.ts` and `lifecycle/consumer.ts` built the number suffix from `randomInt(1, 999999)` (computed before the transaction) against `allotment_number varchar(64) UNIQUE` and `request_number text UNIQUE`.
- Corrective action: Migration `0004_reference_number_sequences.sql` creates `market.allotment_number_seq` and `market.lifecycle_request_number_seq`, seeded one past the highest existing trailing number (idempotent; never moves backwards on re-apply; the seed read lifts and restores FORCE RLS since the owner otherwise sees zero rows). Consumers draw `nextval()` inside the same transaction as the insert (after `markProcessed`), so CQRS per-command idempotency is unchanged. Sequences are global, matching the global-unique columns and the pattern already used in crematorium/animal/advertisement/drainage.
- Changed files: services/market-service/migrations/0004_reference_number_sequences.sql, services/market-service/src/modules/allotments/consumer.ts, services/market-service/src/modules/allotments/repo.ts, services/market-service/src/modules/lifecycle/consumer.ts, services/market-service/src/modules/lifecycle/repo.ts, services/building-service/migrations/0004_reference_number_sequences.sql, services/building-service/src/modules/applications/consumer.ts, services/building-service/src/modules/applications/repo.ts, services/event-service/migrations/0003_reference_number_sequences.sql, services/event-service/src/modules/applications/consumer.ts (+13 more; full list in v4-registry.json)
- Test cases: `services/market-service/tests/v4-c-04-reference-numbers-unique.test.ts`, `services/building-service/tests/v4-c-04-reference-numbers-unique.test.ts` (not at the SHA), `services/event-service/tests/v4-c-04-reference-numbers-unique.test.ts` (not at the SHA), `services/parking-service/tests/v4-c-04-reference-numbers-unique.test.ts`, `services/trade-service/tests/v4-c-04-reference-numbers-unique.test.ts`
- Verification result: Market (#2265) and parking/trade (#2284, parking+trade commits) merged in #2280 (66b04aedd); building/event parts superseded by CLOS3-S4-09 merged in #2279 (e845c0401). Regression: parking/trade v4-c-04 tests PASS; building/event v4-c-04 test files do not exist at the SHA, covered by closure3-s4-09 reference-sequence tests that PASS in regression gate 20b/20c.
- Independent reviewer decision: PR #2265 round 1 head af29d7f93 -> CLEAN (2026-10-25T19:13:04Z): Verified on a disposable Postgres 16 (non-superuser `market_svc`): - Regression test `v4-c-04-reference-numbers-unique.test.ts` FAILS on origin/main code (6 unique violations swallowed into the DLQ) and PASSES on head; full market; PR #2284 round 1 head 2ceb41115 -> CLEAN (2026-10-25T20:32:06Z): Scope and mergeability - 4 commits, one per service, each a single defect (V4-C-04). 22 files, all inside slice ownership (migrations 0004 building / 0003 event / 0003 parking / 0006 trade, the listed consumers, repo.ts helpers, t
- PR: original #2265, #2284; bundle #2279 (e845c0401), #2280 (66b04aedd)
- Merge commit SHA: e845c04015b7090e789c96993a09b2bbc82150d9, 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: building and event applications are covered by CLOS3-S4-09 (#2279), not by #2284; the #2284 building/event commits were dropped from #2280 as duplicates.

#### V4-C-05 - MEDIUM - VERIFIED
- Title: refund requestNumber = Date.now() % 999999
- Severity: MEDIUM
- Component: services/refund-service
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: refund-service requests/consumer.ts:35 generateRequestNumber('ULB', Date.now() % 999999); migrations/0001:40 request_number varchar(64) NOT NULL UNIQUE (global).
- Root cause: `requests/consumer.ts:35` `generateRequestNumber("ULB", Date.now() % 999999)` computed before the transaction, into `request_number varchar(64) NOT NULL UNIQUE` (0001_initial.sql:40, global).
- Corrective action: Migration `0004_request_number_sequence.sql` creates `refund.request_number_seq`, seeded one past the highest existing trailing number (idempotent, never moves backwards; lifts then restores FORCE RLS around the seed read). The consumer draws `nextval()` inside the same transaction as the insert, after `markProcessed`, so per-command idempotency/audit/outbox atomicity is unchanged. Global sequence, matching the global-unique column and the pattern in crematorium/animal/advertisement/drainage. No money handling touched.
- Changed files: services/refund-service/migrations/0004_request_number_sequence.sql, services/refund-service/src/modules/requests/consumer.ts, services/refund-service/src/modules/requests/repo.ts
- Test cases: `services/refund-service/tests/v4-c-05-request-number-unique.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2267 round 1 head f6eb3df28 -> CLEAN (2026-10-25T19:15:25Z): Diff vs origin/main: 4 files, all inside services/refund-service/**; one defect, one commit; no out-of-scope hunks; no contract changes; no secret-shaped literals (test uses randomUUID); MERGEABLE. - Regression test: FAILS on orig
- PR: original #2267; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Schema change (migration) applied only on disposable DBs in this certification.

#### V4-C-06 - LOW - VERIFIED
- Title: TenantRouter LRU eviction ends a client still held by in-flight callers
- Severity: LOW (discoverer said MEDIUM)
- Component: packages/db
- Requirement: Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)
- Reproduction evidence: packages/db/src/tenant-router.ts:163-168 evicts LRU and calls end() on clients already returned to callers; no lease/refcount. Applies only with more than maxSiloClients(25) silo/shard tenants.
- Root cause: see reproduction
- Corrective action: fix(v4): db-pkg — silo-client eviction grace + DB statement/idle-tx timeouts
- Changed files: packages/db/src/pool.ts, packages/db/src/tenant-router.ts
- Test cases: `packages/db/src/pool.timeouts.test.ts`, `packages/db/src/tenant-router.evict.test.ts`, `packages/db/src/tenant-router.property.test.ts`, `packages/db/src/tenant-router.test.ts`
- Verification result: Merged to main in #2281 (400dbc822); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2257 round 1 head 6fe28d36d -> CLEAN (2026-10-25T19:02:43Z): Scope: 6 files, all under packages/db/src (pool.ts, tenant-router.ts + tests); two commits, one defect each; no out-of-scope hunks; migrations/contracts/guard baselines untouched; MERGEABLE; no secret-shaped literals or gitleaks:a
- PR: original #2257; bundle #2281 (400dbc822)
- Merge commit SHA: 400dbc8222dc64aa382b892cf2a5aff2b37e74a0
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-D-01 - HIGH - VERIFIED
- Title: Finance EFT initiation emits payment.made outcome=success before any bank file is sent; grant disbursements and payroll slips flip to completed/paid even when the NACH batch stays pending or is blocked
- Severity: HIGH
- Component: services/finance-service
- Requirement: A payment-success event must only follow actual dispatch/settlement; a pending or blocked bank batch must not mark beneficiaries paid.
- Reproduction evidence: finance-service/src/modules/integrations/consumer.ts:63-90 (paymentMade enqueued inside the prepare tx with outcome:'success'), :98-115 (blocked path returns after commit), :137-140 (upload failure swallowed, batch left pending); grant-service/src/modules/disbursement/consumer.ts:308-318; payroll-service/src/modules/integration/consumer.ts:335-342.
- Root cause: Success event is produced at batch-creation time inside the DB transaction (to satisfy TX-007), but the egress outcome is never fed back; no failure/ack event path exists for blocked or failed uploads, so the failure branch of the grant consumer is unreachable from this producer.
- Corrective action: Removed the payment.made enqueue from the batch-creation transaction. It is now enqueued in the follow-up transaction that records submissionStatus file_sent, i.e. only after sendNachFile succeeded (or sandbox with SFTP unconfigured, unchanged). Blocked or failed batches stay pending and emit nothing. Payload and topic are unchanged (frozen contract preserved).
- Changed files: services/finance-service/src/modules/integrations/consumer.ts
- Test cases: `services/finance-service/tests/eft-initiate-tx-scope.test.ts`, `services/finance-service/tests/v4-d01-eft-payment-made-after-egress.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2260 round 1 head f9dde713d -> CLEAN (2026-10-25T19:07:55Z): Reviewer: independent (not the builder). Reviewed the full diff vs origin/main (3 files, 1 commit). **Verified** - Regression test: `tests/v4-d01-eft-payment-made-after-egress.test.ts` run both ways on my own disposable Postgres 1
- PR: original #2260; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: (1) A blocked or failed batch emits no event at all (no failure event), so the grant disbursement stays initiated and the payroll run slips stay unpaid until the batch is sent or reconciled by PFMS reconcile; this is the safe direction but needs an operator/retry path. EFT batches have no payments rows, so the signed-release path (pfms/release.ts, outside this slice) cannot release them (NO_BENEFICIARIES); a manual re-send for a pending EFT batch will NOT emit payment.made. Follow-up recommended

#### V4-D-02 - HIGH - VERIFIED
- Title: eOffice rejection of a finance payment cancels it but leaves the bill 'paid', the AP/bank GL journal, cash-book entry and appropriation settlement in place; approval re-emits finance.payment.made a second time
- Severity: HIGH
- Component: services/finance-service
- Requirement: State change on a payment must be reflected consistently across bill, GL, cash book and budget; a payment event must be emitted once per payment.
- Reproduction evidence: payments/consumer.ts:461,474-505 vs payments/eoffice-consumer.ts:43-52.
- Root cause: The eOffice decision loop was bolted on assuming the payment is only created at release, but the payment is already fully posted at initiation.
- Corrective action: On `rejected`, in the same transaction as `markProcessed` and the status update: bill `paid`->`passed`; allocation actual->committed (guarded `actual_minor >= amount`); mirror GL journal (Dr Bank / Cr AP, type `adjustment`, id derived from `payment-reversal:<id>`, via the spine outbox command); offsetting cash-book IN row (`payment-reversal:<id>`, idempotent). The mirror journal is used instead of `finance.gl.reverse` because that path's maker-checker would wedge the compensation when the eOffice decider is also the original payer, and it is robust to posting order.
- Changed files: services/finance-service/src/modules/payments/eoffice-consumer.ts, services/finance-service/src/modules/payments/payment-reversal.ts
- Test cases: `services/finance-service/src/modules/payments/eoffice-rejection-reversal.test.ts`, `services/finance-service/tests/consumer-coverage-ext.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2258 round 1 head 931963e3e -> CLEAN (2026-10-25T20:36:20Z): (HIGH: stays open for owner approval; reviewer did not merge) Verified on a disposable postgis Postgres (non-superuser finance_svc), worktree at PR head: - Regression test eoffice-rejection-reversal.test.ts: FAILS on origin/main c
- PR: original #2258; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Approval-path re-emit removed in cycle 2; consumers keyed on paymentId were verified by reading code, not by a live-stack run.

#### V4-D-03 - HIGH - VERIFIED
- Title: Duplicate approval-gated grant disbursement for the same installment is accepted: double scheme-budget reservation and two EFT payouts after approval
- Severity: HIGH
- Component: services/grant-service
- Requirement: An installment may be paid at most once.
- Reproduction evidence: consumer.ts:72,156,222-259; repo.ts:77; migrations/0001_init.sql:193 (non-unique index); eoffice-consumer.ts:41-62.
- Root cause: Idempotency/duplicate guard keyed on installment status that is only updated at payout, not at hold; no uniqueness on active disbursement per installment.
- Corrective action: After taking the application row lock, reject the initiate (grant.disbursement.duplicate event, no row, no reservation) when a pending_approval / initiated / completed disbursement already exists for the installment (new repo.findActiveDisbursementForInstallmentTx). Failed and cancelled disbursements do not block a re-release. Concurrent initiates serialise on the application FOR UPDATE lock.
- Changed files: services/grant-service/src/modules/disbursement/consumer.ts, services/grant-service/src/modules/disbursement/repo.ts
- Test cases: `services/grant-service/tests/v4-d03-duplicate-disbursement.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file). Local certification runs of the grant-service package at --maxWorkers=2 on amd64-emulated Postgres failed (see V4-CERT-01) but the GitHub CI Tests job (run 40258410831, turbo test --maxWorkers=2) did NOT list grant-service#test among its 2 failed tasks, and the serial regression-lane run passes.
- Independent reviewer decision: PR #2261 round 1 head f4dda6edf -> CLEAN (2026-10-25T18:53:52Z): Verified on a disposable Postgres 16 (non-superuser service role, marker DB): - Regression test tests/v4-d03-duplicate-disbursement.test.ts: FAILS on origin/main src (2 failed, 2 rows instead of 1), PASSES on head (2/2). - Full gr
- PR: original #2261; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: No partial unique index was added (a migration could fail on existing duplicate rows in production data and is a protected boundary); the application-row lock plus guard serialises initiates. A DB-level partial unique index on (installment_id) WHERE status IN (pending_approval,initiated,completed) is the recommended follow-up after a data check. Textually conflicts with the V4-D-04 PR in repo.ts (adjacent hunks): merge one then rebase the other.

#### V4-D-04 - HIGH - VERIFIED
- Title: Failed grant disbursement (retries exhausted or PFMS reconcile failure) leaves installment 'disbursed' and scheme budget reserved forever
- Severity: HIGH
- Component: services/grant-service
- Requirement: A failed payout must release its budget reservation and allow the installment to be re-released.
- Reproduction evidence: grep releaseSchemeBudget shows a single caller (eoffice-consumer.ts:73); consumer.ts:259,307-318,350-356.
- Root cause: Compensation implemented only for the approval-rejection branch.
- Corrective action: New guarded transition repo.failInitiatedDisbursementTx (UPDATE ... WHERE status = initiated RETURNING). For the one delivery that performs initiated->failed, release the scheme budget reservation (releaseSchemeBudget) and revert the installment to pending, in the same transaction as markProcessed and the outcome event/audit. A re-delivered failure no longer releases twice (test seeds a second reservation to prove it) and a failure for a non-initiated row is a no-op.
- Changed files: services/grant-service/src/modules/disbursement/consumer.ts, services/grant-service/src/modules/disbursement/repo.ts
- Test cases: `services/grant-service/tests/v4-d04-failed-disbursement.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file). Same as V4-D-03: local parallel runs failed on emulated Postgres (V4-CERT-01); GitHub CI grant-service#test passed; serial regression-lane run passes.
- Independent reviewer decision: PR #2262 round 2 head 44ea9738b -> CLEAN (2026-10-25T19:32:01Z): No required fixes. - Head confirmed changed (4e5252106 -> 44ea9738b); the new commit only removes the stray blank line in consumer.ts. PR MERGEABLE. Scope: 3 files, all under services/grant-service/**; no contracts, migrations or 
- PR: original #2262; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Failures for non-initiated rows are now ignored by this path (previously overwrote status); the full state-machine guard for success results is V4-D-05 (separate BLOCKED PR). With V4-D-01 merged finance no longer emits premature success, so a failed upload is not auto-compensated (stays initiated). Textually conflicts with the V4-D-03 PR in repo.ts: merge one then rebase the other.

#### V4-D-05 - MEDIUM - VERIFIED
- Title: Grant pfmsReconcile and finance-paid consumers apply status changes with no state guard; a late/failed record overwrites a completed disbursement and the retry path can re-emit an EFT for a completed one
- Severity: MEDIUM
- Component: services/grant-service
- Requirement: Disbursement state transitions must be validated against the current state.
- Reproduction evidence: consumer.ts:270-306, 337-364.
- Root cause: No transition table / conditional UPDATE on status for the inbound result events.
- Corrective action: Inside the transaction, after markProcessed, re-read the row FOR UPDATE (repo.lockDisbursementByIdTx) and act only when status is initiated; any other state is ignored with an audit record (disbursement_result_ignored / pfms_reconcile_ignored). Retry count now comes from the locked row.
- Changed files: services/grant-service/src/modules/disbursement/consumer.ts, services/grant-service/src/modules/disbursement/repo.ts
- Test cases: `services/grant-service/tests/v4-d05-disbursement-state-guard.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2263 round 1 head bd47f8722 -> CLEAN (2026-10-25T18:59:25Z): Verified on my own disposable Postgres 16 (non-superuser grant_svc role): - Regression test fails on origin/main src (4 failed, 1 happy-path passed) and passes on the head (5/5). Full grant-service suite: 30 files / 257 tests pass
- PR: original #2263; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Policy decision for the owner: terminal states (completed/failed/cancelled) are final, and a success result for a pending_approval disbursement is ignored. A genuine late success for a row already marked failed is ignored (audited) and needs manual reconciliation. Overlaps V4-D-04 in consumer.ts; the PRs merge cleanly pairwise but should be merged sequentially and re-tested.

#### V4-D-06 - HIGH - VERIFIED
- Title: Contract expiry detector never auto-expires or separates escalated contracts: 'escalated' contracts fall outside its selection and the state machine
- Severity: HIGH
- Component: services/hrms-service
- Requirement: A contract with no renewal must be auto-expired and separated on its end date.
- Reproduction evidence: expiry-consumer.ts:43,86,247-258; domain.ts:41-47.
- Root cause: Status filter and transition table were not updated when the escalated state was added.
- Corrective action: Include 'escalated' in the selection and allow escalated -> expired.
- Changed files: services/hrms-service/src/modules/contracts/domain.ts, services/hrms-service/src/modules/contracts/expiry-consumer.ts
- Test cases: `services/hrms-service/src/modules/contracts/expiry-escalated.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2270 round 1 head 96fc2da73 -> CLEAN (2026-10-25T19:17:13Z): Verified on a disposable Postgres (non-superuser `hrms_svc`, full bootstrap), worktree at the PR head: - Regression test `contracts/expiry-escalated.test.ts`: 3/3 FAIL on origin/main src (escalated->expired false; status stays `es
- PR: original #2270; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-D-07 - MEDIUM - VERIFIED
- Title: Works contractor create/rate consumers swallow transient errors after rollback, so the accepted (202) command is silently lost with no retry
- Severity: MEDIUM
- Component: services/court-service, services/works-service
- Requirement: Transient failure in a consumer must propagate so the queue retries/dead-letters; markProcessed rolls back with the tx.
- Reproduction evidence: consumer.ts:49-53, 139-143 versus 87-90.
- Root cause: Catch block copied from a duplicate-handling fix and only rethrows the NonRetryable subtype.
- Corrective action: Two AUTO (MEDIUM) defects from the V4 closure run, one commit each. - **V4-C-02** court `addParty` trusted the URL case id and published with no lookup; the consumer FK check bypasses RLS, so a registrar could attach a PII party row to another tenant case id and probe case-id existence. Fix: tenant-scoped synchronous pre-check (`getCaseForPrecheck`, 404 `CASE_NOT_FOUND`) before publish. Composite FKs remain a separate protected change (not done here). - **V4-D-07** works `contractorCreate` / `contractorRate` consumers swallowed every non-NonRetryable error after rollback, losing the accepted command. Fix: rethrow all errors (matches `contractorUpdate`).
- Changed files: services/court-service/src/modules/party/commands.ts, services/works-service/src/modules/contractor/consumer.ts
- Test cases: `services/court-service/tests/commands-coverage.test.ts`, `services/court-service/tests/v4-c-02-addparty-case-tenant.test.ts`, `services/works-service/tests/v4-d-07-contractor-consumer-rethrow.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2259 round 1 head dc9b7fc5b -> CLEAN (2026-10-25T18:48:02Z): Diff read in full (5 files, 2 commits, one defect each, both with the Co-Authored-By trailer). Slice ownership respected (court-service, works-service/modules/contractor). No migrations, no contract changes, no secret-shaped liter
- PR: original #2259; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-E-01 - HIGH - DUPLICATE
- Title: Any citizen can resubmit (supersede) another citizen's document submission - no ownership check
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: New test `documents/ownership.test.ts` on origin/main code (before fix): `Tests 3 failed | 4 passed (7)` - - resubmit by another citizen: `expected 202 ... to be 404` - upload to another citizen's application: `expected 202 to be 404` - checklist of another citizen's application: `expected 200 to be 404` (4 positive controls - owner resubmit/upload/checklist, officer resubmit - passed). After fix: `Tests 7 passed (7)`.
- Root cause: `commands.resubmit` loaded the prior submission by tenant+id and never compared `prior.citizenId` with the caller (the sibling GET already used `assertOwnership`); application ids on upload/fetch/authorize/checklist were never tied to the caller.
- Corrective action: - `commands.resubmit`: `assertOwnership(ctx, prior.citizenId)` (404 for non-owner, officers exempt) before any state/key check. - New `ownership.ts#assertApplicationAccess` (officer exempt; foreign application => 404): applied in `upload`, `digilockerFetchIntake`, `beginDigiLockerAuthorize` and the `/checklist` route. The callback inherits the check through the state bound at authorize. - An applicationId that resolves to no application is deliberately left to prior behaviour (existing `tests/service-gaps-partial-routes.test.ts` references an unmaterialised application id); the submission is still recorded under the caller's own citizenId.
- Changed files: services/citizen-service/src/modules/documents/commands.ts, services/citizen-service/src/modules/documents/ownership.ts, services/citizen-service/src/modules/documents/routes.ts
- Test cases: `services/citizen-service/src/modules/documents/ownership.test.ts`
- Verification result: Duplicate of V4-B-02; remediated by PR 2240 (same change). Covered by that defect's regression test.
- Independent reviewer decision: PR #2240 round 1 head 6ee052381 -> CLEAN (2026-10-25T18:19:54Z): Verified on my own disposable postgis:16 (non-superuser `citizen_svc`, bootstrap applied): - Regression `documents/ownership.test.ts`: on origin/main code (commands.ts/routes.ts reverted) 3 fail (`expected 202 to be 404` on resubm
- PR: original #2240; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: DUPLICATE (duplicate of V4-B-02)
- Residual risk: Resubmit of a submission whose `citizenId` is null is now denied for citizens (officers unaffected). An absent-application id is still accepted on upload (harmless: recorded under the caller). Related tests outside this slice's file ownership still reference an unmaterialised application id.

#### V4-E-02 - HIGH - VERIFIED
- Title: GET /v1/citizen/requests returns every citizen's grievance summary tenant-wide to a bare citizen role
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Failing test first (before fix), `requests-list-scope.test.ts`: ``` × scopes a citizen to their own actorId -> expected undefined to be <actor> × does not let a citizen widen scope via citizenId query -> expected 200 to be 403 ✓ lets an officer list tenant-wide Tests 2 failed | 1 passed (3) ``` After fix: 3/3 pass.
- Root cause: The route called `queries.listRequests(tenantId, limit, offset)` which selects all tenant rows with no actor scoping, while the sibling `/v1/citizen/grievances` correctly used `resolveCitizenId`.
- Corrective action: Route resolves scope: officers -> optional `citizenId` filter (tenant-wide if omitted); citizens -> `resolveCitizenId(ctx, citizenId)` (own id; foreign id => 403). `citizenId` is threaded through `listRequests` into `listGrievancesByTenant` (tenant AND citizen predicate); cache key now includes scope so scoped results can't be served across actors. Response contract unchanged.
- Changed files: services/citizen-service/src/modules/grievance/queries.ts, services/citizen-service/src/modules/grievance/repo.ts, services/citizen-service/src/modules/grievance/routes.ts
- Test cases: `services/citizen-service/src/modules/grievance/requests-list-scope.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2238 round 1 head 9e0b85676 -> CLEAN (2026-10-25T18:19:44Z): Regression test requests-list-scope.test.ts: FAILS on origin/main (2 of 3: citizen scope undefined, foreign citizenId returns 200 not 403), PASSES 3/3 on head. - Full citizen-service suite on disposable Postgres (non-superuser cit
- PR: original #2238; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Citizen identity relies on the existing contract profile.id == JWT sub. The sibling route `/v1/citizen/requests/:id` (requests module) is out of this slice's file ownership and was not changed.

#### V4-E-03 - MEDIUM - VERIFIED
- Title: Auth tenant-header fallback and HS256 fallback keyed on NODE_ENV !== production deny-list
- Severity: MEDIUM
- Component: packages/auth
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Failing before fix (new test `packages/auth/tests/v4-e-03-env-allowlist-call-sites.test.ts`): `Tests 15 failed | 10 passed (25)` -- every `staging`/`uat`/`productoin`/unset case failed across toRequestContext, resolveServiceContext, assertInternalServiceSecret, authPlugin. After fix: all pass.
- Root cause: Deny-list `NODE_ENV !== "production"` at 4 call sites; `isProduction()` in index.ts had already been moved to an allow-list (SEC-017) but these sites were left behind.
- Corrective action: New `isDevOrTestEnv()` (true only for `development`/`test`), reused by `isProduction()` and the 4 remaining sites. Fails closed on unset/staging/typo.
- Changed files: packages/auth/src/context.ts, packages/auth/src/index.ts, packages/auth/src/plugin.ts
- Test cases: `packages/auth/tests/v4-e-03-env-allowlist-call-sites.test.ts`
- Verification result: Merged to main in #2281 (400dbc822); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2274 round 1 head 8d8e8fae6 -> CLEAN (2026-10-25T19:19:44Z): Diff vs origin/main read in full: 3 src files (context.ts, index.ts, plugin.ts) + 1 new test, all within packages/auth/**; one defect, one commit; no out-of-scope hunks; no migrations; no API/event contract change; MERGEABLE. - Re
- PR: original #2274; bundle #2281 (400dbc822)
- Merge commit SHA: 400dbc8222dc64aa382b892cf2a5aff2b37e74a0
- Closure status: VERIFIED
- Residual risk: Auth boundary change (NODE_ENV allow-list); anything relying on dev fallbacks outside the allow-list now fails closed.

#### V4-E-04 - MEDIUM - DUPLICATE
- Title: Web /api/proxy traversal guard bypassed by encoded slash in catch-all segment
- Severity: MEDIUM
- Component: apps/web
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Confirmed by the independent verifier (verify-E.json confirmed=true); no reproduction text recorded there; see the PR failing-first evidence.
- Root cause: see reproduction
- Corrective action: fix(v4): web-proxy — BFF path guard, upstream failure envelope, careers tenant binding
- Changed files: apps/web/src/app/api/careers/auth/otp-request/route.ts, apps/web/src/app/api/careers/auth/otp-verify/route.ts, apps/web/src/app/api/notification/mark-read/route.ts, apps/web/src/app/api/notification/stream/route.ts, apps/web/src/app/api/notification/stream/unread/route.ts, apps/web/src/app/api/proxy/[...path]/route.ts
- Test cases: `apps/web/src/app/api/careers/auth/tenantBinding.test.ts`, `apps/web/src/app/api/notification/upstreamFailure.test.ts`, `apps/web/src/app/api/proxy/[...path]/pathGuard.test.ts`, `apps/web/src/app/api/proxy/[...path]/upstreamFailure.test.ts`
- Verification result: Duplicate of V4-A-03; remediated by PR 2235 (same change). Covered by that defect's regression test.
- Independent reviewer decision: PR #2235 round 1 head 6802c12ac -> CLEAN (2026-10-25T18:11:39Z): Diff reviewed in full (3 commits: V4-A-03+V4-E-04 path guard, V4-A-05 upstream 502/timeout, V4-A-06 careers tenant binding). One defect per commit, no out-of-scope hunks, all files within apps/web/src/app/api/{proxy,notification,c
- PR: original #2235; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: DUPLICATE (duplicate of V4-A-03)
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-E-05 - MEDIUM - VERIFIED
- Title: Presigned upload URL does not enforce size limit or content-type
- Severity: MEDIUM
- Component: packages/storage, services/admin-service
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Before fix: new test `services/admin-service/tests/v4-e-05-presign-limits.test.ts` -> 5 failed (e.g. `expected 200 to be 400`); storage test `signs content-type...` failed. After: 5/5 and storage 15/15 pass.
- Root cause: Verified: generated URL had `X-Amz-SignedHeaders=host` only; `maxSizeMb` was advisory, `contentType` was an unchecked free string.
- Corrective action: - storage: opt-in `signContentType` (signs `content-type`); default off so other services' clients are unaffected. - admin route: `contentType` must be in the MIME set of the category's allowed extensions (closed set); optional `sizeBytes` (int > 0) rejected above the cap with `FILE_TOO_LARGE` and signed as `content-length`; content-type always signed; invalid body now 400 instead of 500.
- Changed files: packages/storage/src/index.ts, services/admin-service/src/modules/uploads/routes.ts
- Test cases: `packages/storage/src/index.test.ts`, `services/admin-service/tests/v4-e-05-presign-limits.test.ts`
- Verification result: Merged to main in #2281 (400dbc822); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2276 round 1 head 3a1838ce9 -> CLEAN (2026-10-25T19:26:36Z): Regression test v4-e-05-presign-limits.test.ts: 5 failures on origin/main routes.ts (expected 200 to be 400, etc.), 5/5 pass on head. Full admin-service suite on a disposable Postgres (partial bootstrap): 145 failed on main vs 140
- PR: original #2276; bundle #2281 (400dbc822)
- Merge commit SHA: 400dbc8222dc64aa382b892cf2a5aff2b37e74a0
- Closure status: VERIFIED
- Residual risk: Contract boundary change (presigned upload now enforces content-type and size).

#### V4-E-06 - MEDIUM - VERIFIED
- Title: ID-card QR HMAC falls back to hardcoded secret unless NODE_ENV is exactly production
- Severity: MEDIUM
- Component: services/hrms-service
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Confirmed by the independent verifier (verify-E.json confirmed=true); no reproduction text recorded there; see the PR failing-first evidence.
- Root cause: see reproduction
- Corrective action: fix(v4): hrms - ID-card QR secret fails closed
- Changed files: services/hrms-service/src/modules/id-cards/routes.ts
- Test cases: `services/hrms-service/src/modules/id-cards/qr-secret.security.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2269 round 1 head cddb22a3d -> CLEAN (2026-10-25T19:16:36Z): Diff vs origin/main: 2 files, both within slice (services/hrms-service/src/modules/id-cards/), 1 commit, 1 defect. No out-of-scope hunks, no migrations, no API/event contract change, no RLS/CQRS/outbox/money surface touched. - Reg
- PR: original #2269; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-E-07 - MEDIUM - VERIFIED
- Title: Citizen certificate seal key falls back to hardcoded literal with no production guard
- Severity: MEDIUM
- Component: services/citizen-service
- Requirement: Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)
- Reproduction evidence: Regression test `src/modules/issuance/seal-key.test.ts`: before the fix 4 of 7 failed (no throw in production/unset/blank/verify); after the fix 7/7 pass.
- Root cause: see reproduction
- Corrective action: - V4-E-07 (MEDIUM, AUTO_FIX): certificate seal key no longer falls back to a hardcoded literal. `issuanceSecret()` (services/citizen-service/src/modules/issuance/domain.ts) now throws `ISSUANCE_SEAL_KEY_UNSET` when neither CITIZEN_ISSUANCE_SECRET nor CITIZEN_PII_KEY is a non-blank value, except under NODE_ENV=test.
- Changed files: services/citizen-service/src/modules/issuance/domain.ts
- Test cases: `services/citizen-service/src/modules/issuance/seal-key.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2237 round 1 head 611630813 -> CLEAN (2026-10-25T18:22:49Z): Scope: 1 commit, 2 files (issuance/domain.ts, new issuance/seal-key.test.ts), both inside slice ownership; no out-of-scope hunks, no contract/migration/guard/threshold changes; MERGEABLE. - Regression test: on origin/main domain.t
- PR: original #2237; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Deployments that set neither env var would now fail certificate issuance/verify; the service already refuses to boot without CITIZEN_PII_KEY (app.ts), so no supported deployment is affected.

#### V4-F-01 - MEDIUM - VERIFIED
- Title: Workflow message-timeout sweeper expires subscriptions unconditionally; races with message match and with concurrent sweeps
- Severity: MEDIUM
- Component: services/gateway-service, services/telephony-service, services/workflow-service
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: Code read at 1eaeecae7: repo.ts expireSubscription updates by id only; markMessageMatched (consumer.ts:102) also updates by id only; sweeper.ts:47-60 always enqueues completeTask(reject); no in-flight guard on setInterval. Race is unambiguous.
- Root cause: Missing status predicate and rowcount check on the expiry UPDATE; no row claim (FOR UPDATE SKIP LOCKED) in the sweep.
- Corrective action: UPDATE ... WHERE id=? AND status='active' RETURNING id inside the tx; skip the enqueue/history/audit when no row is returned.
- Changed files: services/gateway-service/src/upstream-proxy.ts, services/telephony-service/src/modules/recordings/consumer.ts, services/workflow-service/src/modules/messages/consumer.ts, services/workflow-service/src/modules/messages/repo.ts, services/workflow-service/src/modules/messages/sweeper.ts
- Test cases: `services/gateway-service/tests/upstream-proxy-5xx-body.test.ts`, `services/telephony-service/tests/recording-download-cap.test.ts`, `services/workflow-service/tests/messages-expiry-race.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2278 round 1 head 961a543fe -> CLEAN (2026-10-25T19:27:52Z): Scope: 3 commits, one defect each (V4-F-01, V4-F-05, V4-F-06); 8 files, all inside slice ownership (workflow-service/src/modules/messages/**, telephony-service/src/modules/recordings/**, gateway-service/src/upstream-proxy.ts, plus
- PR: original #2278; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-F-02 - MEDIUM - VERIFIED
- Title: Visitor document-scan upload route can never work: @fastify/multipart is not a dependency or registered, so req.file is undefined
- Severity: MEDIUM
- Component: services/visitor-service
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: routes.ts:81 calls (req as any).file(); grep of all package.json/pnpm-lock/ts shows @fastify/multipart is not declared or registered anywhere; app.ts registers only cors/auth. TypeError -> 500 on every upload.
- Root cause: The plugin was never added; the route casts req to any, so the compiler cannot catch it.
- Corrective action: Add and register @fastify/multipart with limits.fileSize and files:1, and stream to storage instead of Buffer.concat (routes.ts:91).
- Changed files: pnpm-lock.yaml, services/visitor-service/package.json, services/visitor-service/src/app.ts, services/visitor-service/src/modules/document-scan/routes.ts, services/visitor-service/src/shared/multipart.ts
- Test cases: `services/visitor-service/tests/document-scan-multipart.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2282 round 1 head d92338386 -> CLEAN (2026-10-25T20:27:57Z): Regression test (tests/document-scan-multipart.test.ts): with no multipart plugin both tests fail (415 vs 202/413); with plugin but main routes.ts stream loop the oversize test fails (202 vs 413, truncation confirmed); on head bot
- PR: original #2282; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Adds a new runtime dependency @fastify/multipart 8.3.1 (exact pin, lockfile additions). The remediation lane said it needs owner approval for the dependency; no dependency-specific owner approval is recorded (the blanket approval 'close all by tomorrow morning' covers HIGH and BLOCKED_FOR_APPROVAL PRs; #2282 carries neither tag). Open approval-evidence item.

#### V4-F-03 - LOW - VERIFIED
- Title: New S3Client created per call and never destroyed in visitor-service document-scan (upload, download, cleanup) and ml-service purge
- Severity: LOW (discoverer said MEDIUM)
- Component: services/ml-service, services/visitor-service
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: new S3Client at routes.ts:41, consumer.ts:56, image-cleanup.ts:46 (per image), ml purge consumer.ts:53; no destroy() in visitor-service. Impact limited to socket/credential churn; unreferenced clients are GC'd and sockets idle out, so downgraded.
- Root cause: Client built inside the helper function instead of a lazy singleton.
- Corrective action: Hoist to a lazily-created singleton per service.
- Changed files: services/ml-service/src/modules/purge/consumer.ts, services/visitor-service/src/modules/document-scan/consumer.ts, services/visitor-service/src/modules/document-scan/image-cleanup.ts, services/visitor-service/src/modules/document-scan/routes.ts, services/visitor-service/src/shared/s3-client.ts
- Test cases: `services/ml-service/tests/purge-s3-client-reuse.test.ts`, `services/visitor-service/tests/s3-client-singleton.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2277 round 1 head 6e342c92c -> CLEAN (2026-10-25T19:23:47Z): Scope: V4-F-03 (LOW, AUTO), single commit, 7 files, all within services/visitor-service/** and services/ml-service/src/modules/purge/** (+ ml tests). MERGEABLE. - Regression tests: purge-s3-client-reuse FAILS on origin/main (expec
- PR: original #2277; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-F-04 - MEDIUM - VERIFIED
- Title: No statement_timeout, idle_in_transaction_session_timeout or max_lifetime on the shared postgres-js pools
- Severity: MEDIUM
- Component: packages/db
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: pool.ts options set only max, prepare, idle_timeout, connect_timeout, types, debug; grep for statement_timeout/idle_in_transaction/max_lifetime across ts/sql/yml/conf finds only a test comment.
- Root cause: Pool factory only configures connect/idle timeouts, never server-side query limits.
- Corrective action: Pass connection: { statement_timeout, idle_in_transaction_session_timeout } (env-tunable) and max_lifetime.
- Changed files: packages/db/src/pool.ts, packages/db/src/tenant-router.ts
- Test cases: `packages/db/src/pool.timeouts.test.ts`, `packages/db/src/tenant-router.evict.test.ts`, `packages/db/src/tenant-router.property.test.ts`, `packages/db/src/tenant-router.test.ts`
- Verification result: Merged to main in #2281 (400dbc822); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2257 round 1 head 6fe28d36d -> CLEAN (2026-10-25T19:02:43Z): Scope: 6 files, all under packages/db/src (pool.ts, tenant-router.ts + tests); two commits, one defect each; no out-of-scope hunks; migrations/contracts/guard baselines untouched; MERGEABLE; no secret-shaped literals or gitleaks:a
- PR: original #2257; bundle #2281 (400dbc822)
- Merge commit SHA: 400dbc8222dc64aa382b892cf2a5aff2b37e74a0
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-F-05 - LOW - VERIFIED
- Title: Telephony recording download reads entire carrier response into memory with no size cap
- Severity: LOW (discoverer said MEDIUM)
- Component: services/gateway-service, services/telephony-service, services/workflow-service
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: consumer.ts:54-56 res.arrayBuffer() then Buffer.from with no content-length or byte cap; only 60s timeout. URL is carrier-supplied (semi-trusted), so downgraded.
- Root cause: No streaming or size limit on the download path.
- Corrective action: Check content-length and stream via res.body with a byte counter that aborts above the cap.
- Changed files: services/gateway-service/src/upstream-proxy.ts, services/telephony-service/src/modules/recordings/consumer.ts, services/workflow-service/src/modules/messages/consumer.ts, services/workflow-service/src/modules/messages/repo.ts, services/workflow-service/src/modules/messages/sweeper.ts
- Test cases: `services/gateway-service/tests/upstream-proxy-5xx-body.test.ts`, `services/telephony-service/tests/recording-download-cap.test.ts`, `services/workflow-service/tests/messages-expiry-race.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2278 round 1 head 961a543fe -> CLEAN (2026-10-25T19:27:52Z): Scope: 3 commits, one defect each (V4-F-01, V4-F-05, V4-F-06); 8 files, all inside slice ownership (workflow-service/src/modules/messages/**, telephony-service/src/modules/recordings/**, gateway-service/src/upstream-proxy.ts, plus
- PR: original #2278; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-F-06 - LOW - VERIFIED
- Title: Gateway proxyFetch discards upstream 5xx response without consuming or cancelling the body
- Severity: LOW
- Component: services/gateway-service, services/telephony-service, services/workflow-service
- Requirement: Reliability and resource handling (V4.0 lane F)
- Reproduction evidence: upstream-proxy.ts:81-83 throws on status>=500 without consuming or cancelling res.body.
- Root cause: Early throw before the body is drained.
- Corrective action: void res.body?.cancel() before throwing.
- Changed files: services/gateway-service/src/upstream-proxy.ts, services/telephony-service/src/modules/recordings/consumer.ts, services/workflow-service/src/modules/messages/consumer.ts, services/workflow-service/src/modules/messages/repo.ts, services/workflow-service/src/modules/messages/sweeper.ts
- Test cases: `services/gateway-service/tests/upstream-proxy-5xx-body.test.ts`, `services/telephony-service/tests/recording-download-cap.test.ts`, `services/workflow-service/tests/messages-expiry-race.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2278 round 1 head 961a543fe -> CLEAN (2026-10-25T19:27:52Z): Scope: 3 commits, one defect each (V4-F-01, V4-F-05, V4-F-06); 8 files, all inside slice ownership (workflow-service/src/modules/messages/**, telephony-service/src/modules/recordings/**, gateway-service/src/upstream-proxy.ts, plus
- PR: original #2278; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: none recorded beyond the items in release-readiness.md

#### V4-G-01 - HIGH - VERIFIED
- Title: Public certificate QR verification is unreachable: gateway 401s anonymous callers and the service has no tenant context for its FORCE-RLS lookup
- Severity: HIGH
- Component: services/citizen-service, services/gateway-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: Code read at 1eaeecae7: PUBLIC_PREFIXES (gateway public-prefixes.ts:47-55) lacks /api/v1/citizen/certificates/verify; app.ts:187-199 returns 401 UNAUTHENTICATED when no bearer/api key on non-public path. citizen-service route is config:{public:true} but resolvePublicContext sets no tenant ALS; onRequest hooks only enter tenant from x-tenant-id or req.ctx; findCertByToken uses db.transaction with no GUC; migration 0015 FORCE RLS tenant_isolation on issuance.certificates uses portal.current_tenant_id() = NULLIF(current_setting('app.tenant_id',true),'')::uuid, so NULL => 0 rows. Both layers independently break anonymous verify.
- Root cause: 1. Gateway `PUBLIC_PREFIXES` had no entry for the verify path, so the bearer pre-check 401d every QR scan. 2. `issuance.certificates` is FORCE RLS (`tenant_id = portal.current_tenant_id()`); the anonymous route has no tenant, so `findCertByToken` always saw 0 rows.
- Corrective action: Gateway public prefix /api/v1/citizen/certificates/verify; citizen migration (token-scoped SELECT policy) and GUC set in findCertByToken (cycle-2 PR #2283). fix(v4)[APPROVAL REQUIRED][HIGH]: V4-G-01 public certificate QR verification
- Changed files: services/citizen-service/migrations/0043_certificate_public_verify_policy.sql, services/citizen-service/src/modules/issuance/domain.ts, services/citizen-service/src/modules/issuance/repo.ts, services/citizen-service/src/modules/issuance/routes.ts, services/gateway-service/src/public-prefixes.ts
- Test cases: `services/citizen-service/tests/v4g01-cert-verify-public.test.ts`, `services/gateway-service/tests/v4g01-cert-verify-public-prefix.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2283 round 2 head fc585de5d -> CLEAN (2026-10-25T20:46:47Z): Round-1 finding (all anonymous callers sharing one rate-limit bucket) is fixed. Verified on a disposable Postgres as the non-superuser citizen_svc role. - Head confirmed fc585de5d, MERGEABLE. 2 commits, 7 files, one defect each, a
- PR: original #2283; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Public verification endpoint is unauthenticated by design with a token-scoped SELECT policy (citizen migration 0044 after renumber) and a 30/min per-IP limit; no live-stack test of the public route.

#### V4-G-02 - HIGH - VERIFIED
- Title: Citizen-initiated payment intent computes the fee from caller-supplied subject, schedule and citizenId (self-service fee waiver / wrong amount booked)
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: fee-payment/validators.ts:42-48 createIntentBody.subject is free z.record; routes.ts:36 only requires CITIZEN_ROLES; commands.createPaymentIntent forwards body unchanged; consumer.ts:121 computeFee(sched.baseAmount, sched.exemptions, p.subject). domain.ts:34-50 shows a matching waive exemption returns amount 0. No ownership/service binding of applicationId or citizenId.
- Root cause: Command and consumer trusted `subject`, `citizenId`, `serviceId` from the request body; the consumer called `computeFee(sched.baseAmount, sched.exemptions, p.subject)`.
- Corrective action: - `commands.createPaymentIntent`: load the application (tenant-checked), `assertOwnership` (404 for non-owner citizens), 422 if `serviceId`/`scheduleId` do not belong to the application's service; publish the application's real `citizenId`/`serviceId` and an empty subject. - Consumer: re-derives application, service, schedule and exemption subject (the application's intake draft `formData`, frozen after submission) inside the same transaction; drops the payment silently-safe if the application is missing or the schedule mismatches. Payment `citizenId` now always the application owner. - `repo.findDraftFormDataByApplicationTx` added. - API/event contracts unchanged (request body shape is still accepted; `subject` is now ignored).
- Changed files: services/citizen-service/src/modules/fee-payment/commands.ts, services/citizen-service/src/modules/fee-payment/consumer.ts, services/citizen-service/src/modules/fee-payment/repo.ts
- Test cases: `services/citizen-service/src/modules/fee-payment/payment-intent-fee.test.ts`, `services/citizen-service/tests/service-gaps-routes.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2242 round 1 head 9bb60fc1a -> CLEAN (2026-10-25T18:49:59Z): (code and process). One residual security risk below needs an explicit owner decision before merge; it does not need a code change in this PR. Verified: - Regression test `payment-intent-fee.test.ts`: on origin/main source (test k
- PR: original #2242; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Exemption attributes come from the applicant's own draft `formData` (self-declared). Verifying that data (e.g. against a verified document) is a separate eligibility/document concern. The offline counter path (`/payments/offline`, officer-only) still takes an officer-supplied subject by design.

#### V4-G-03 - HIGH - VERIFIED
- Title: Legacy DigiLocker fetch marks any citizen-supplied docUri as verified/source_verified with the citizen as verifier, bypassing the PKCS#7 verification of the callback flow
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: documents/domain.ts:118 digiLockerFetch returns source_verified/fetched for any docUri when provider is configured; commands.ts:128-143 sets status verified; consumer.ts:46-62 stores verifiedBy=actor (the citizen), verifiedAt and emits citizen.document.verified. Route (routes.ts:43) open to CITIZEN_ROLES, only precondition is a live consent row. Exploitable only when DigiLocker env is configured (production).
- Root cause: `digiLockerFetch()` returns `source_verified` for any string when credentials exist (it never contacts the provider); `commands` copied that into the persisted status and the consumer stamped `verifiedBy = msg.actorId` and emitted the verified event.
- Corrective action: Commands always send `received/pending/unverified` for the legacy fetch and digilocker resubmit; the consumer ignores payload-claimed verification (defence for in-flight messages) and no longer sets a verifier or emits `document.verified` on this path. `domain.digiLockerFetch` is unchanged (its existing unit contract in tests/service-gaps-partial-domain.test.ts is preserved). Verified status now arises only from the callback (PKCS#7) or an officer `verify` decision.
- Changed files: services/citizen-service/src/modules/documents/commands.ts, services/citizen-service/src/modules/documents/consumer.ts
- Test cases: `services/citizen-service/src/modules/documents/digilocker-legacy-verify.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2241 round 1 head 8e1bdfff7 -> CLEAN (2026-10-25T18:19:55Z): Reviewer-verified (own disposable postgis:16 on :15941, non-superuser citizen_svc, removed after): - Regression test `documents/digilocker-legacy-verify.test.ts`: on origin/main code (commands.ts + consumer.ts reverted) 2 FAILED (
- PR: original #2241; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Behaviour change: legacy fetch documents with configured credentials now await officer verification (previously auto-verified). That is the intended fail-closed outcome. Previously persisted rows verified through this path are not retroactively corrected (recommend an officer re-verification query for `source='digilocker'` rows with `verified_by = created_by`).

#### V4-G-04 - MEDIUM - DUPLICATE
- Title: Citizen document routes lack application/submission ownership checks: resubmit supersedes another citizen's document, upload attaches to another application, checklist reads any application
- Severity: MEDIUM (discoverer said HIGH)
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: routes.ts resubmit (line ~157) has no assertOwnership; commands.resubmit loads prior by id+tenant only; consumer.ts:157-170 inserts new row with citizenId: prior.citizenId and marks prior superseded. upload (commands.ts:88) stores body.applicationId unchecked; checklist route (routes.ts:73) has no ownership check. GET /documents/:id does call assertOwnership (line 145), confirming the inconsistency. Downgraded from HIGH: exploitation needs the victim's unguessable deficient/rejected document UUID.
- Root cause: `commands.resubmit` loaded the prior submission by tenant+id and never compared `prior.citizenId` with the caller (the sibling GET already used `assertOwnership`); application ids on upload/fetch/authorize/checklist were never tied to the caller.
- Corrective action: - `commands.resubmit`: `assertOwnership(ctx, prior.citizenId)` (404 for non-owner, officers exempt) before any state/key check. - New `ownership.ts#assertApplicationAccess` (officer exempt; foreign application => 404): applied in `upload`, `digilockerFetchIntake`, `beginDigiLockerAuthorize` and the `/checklist` route. The callback inherits the check through the state bound at authorize. - An applicationId that resolves to no application is deliberately left to prior behaviour (existing `tests/service-gaps-partial-routes.test.ts` references an unmaterialised application id); the submission is still recorded under the caller's own citizenId.
- Changed files: services/citizen-service/src/modules/documents/commands.ts, services/citizen-service/src/modules/documents/ownership.ts, services/citizen-service/src/modules/documents/routes.ts
- Test cases: `services/citizen-service/src/modules/documents/ownership.test.ts`
- Verification result: Duplicate of V4-B-02; remediated by PR 2240 (same change). Covered by that defect's regression test.
- Independent reviewer decision: PR #2240 round 1 head 6ee052381 -> CLEAN (2026-10-25T18:19:54Z): Verified on my own disposable postgis:16 (non-superuser `citizen_svc`, bootstrap applied): - Regression `documents/ownership.test.ts`: on origin/main code (commands.ts/routes.ts reverted) 3 fail (`expected 202 to be 404` on resubm
- PR: original #2240; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: DUPLICATE (duplicate of V4-B-02)
- Residual risk: Resubmit of a submission whose `citizenId` is null is now denied for citizens (officers unaffected). An absent-application id is still accepted on upload (harmless: recorded under the caller). Related tests outside this slice's file ownership still reference an unmaterialised application id.

#### V4-G-05 - HIGH - VERIFIED
- Title: Audit hash chain cannot be re-verified: the timestamp bound into event_hash is never persisted, and payload is hashed pre-JSONB
- Severity: HIGH
- Component: services/audit-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: audit-service events/consumer.ts:33 now=new Date().toISOString() is hashed via computeHash (domain.ts:39-54) but repo.insert omits occurredAt, so schema.ts:21 defaultNow() stores a different instant; repo.ts:270 same. Hash is over JSON.stringify of pre-JSONB payload (jsonb reorders keys). grep finds no chain-verify routine in audit-service/src. Stored rows cannot reproduce event_hash exactly.
- Root cause: `now = new Date().toISOString()` was hashed but `occurredAt` was omitted from the insert; digest used `JSON.stringify` on an object whose key order jsonb does not preserve; no verify routine existed.
- Corrective action: - `nextOccurredAt()`: the hashed instant is persisted as `occurred_at`, strictly later than the previous link (unambiguous ordering). - `canonicalJson()` (JSON round-trip + recursive key sort) used inside `computeHash`. - `verifyChain()` (pure) + `repo.verifyTenantChain()` (read-only). Same chain-append logic in consumer and writeEvent; advisory lock / single-txn semantics unchanged.
- Changed files: services/audit-service/src/modules/events/consumer.ts, services/audit-service/src/modules/events/domain.ts, services/audit-service/src/modules/events/repo.ts
- Test cases: `services/audit-service/tests/v4-g-05-hash-chain-verifiable.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2275 round 1 head 0771ed098 -> CLEAN (2026-10-25T19:21:29Z): Reviewed on a disposable non-superuser Postgres (audit migrations 0001-0032 applied as the owning service role). - Regression test `tests/v4-g-05-hash-chain-verifiable.test.ts`: FAILS on origin/main src (real hash-mismatch asserti
- PR: original #2275; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Legacy rows are not retroactively verifiable. No scheduled verify job or HTTP route is added (kept minimal; `verifyTenantChain` is ready to be wired by owner decision). Clock skew across instances is bounded by the per-tenant advisory lock plus the strictly-increasing rule.

#### V4-G-06 - HIGH - VERIFIED
- Title: Citizen lifecycle notifications use the citizen profile UUID as the SMS/email/WhatsApp address; no recipient resolution exists in notification-service
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: citizen application/consumer.ts:98 and fee-payment/consumer.ts pass recipient=citizenId (or application id); notification-service deliveries/consumer.ts:113 effectiveRecipient = p.recipient ?? p.recipientId ?? actorId and is passed verbatim to adapters (email.ts:60 to:, sms.ts:71 To:). grep for resolveContact/address lookup in notification-service/src finds none. With real SMTP/Twilio send fails; with stub driver it is recorded as delivered.
- Root cause: Producers set `recipient = citizenId`; there is no recipient resolution anywhere between citizen-service and the adapters.
- Corrective action: `resolveCitizenAddress()` resolves the address from the citizen profile inside the producer's transaction (RLS-scoped, decrypted on read): email -> `email`, sms/whatsapp -> `mobile`, in_app -> citizen id. `recipientId` stays the citizen UUID (prefs/consent/suppression keying unchanged). If the citizen has no address for a channel the send is skipped rather than addressed to a UUID. Non-UUID ids are passed through unchanged (legacy). The approved-without-pack fallback is resolved to mobile (the system template is SMS). No event/API contract change: `NotificationSendPayload.recipient` was always documented as the destination; no migration.
- Changed files: services/citizen-service/src/modules/application/consumer.ts, services/citizen-service/src/modules/catalogue/notification-bindings.ts
- Test cases: `services/citizen-service/src/modules/catalogue/notification-bindings.recipient.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2244 round 1 head 863a2acd1 -> CLEAN (2026-10-25T18:34:12Z): Verified on a disposable Postgres (bootstrapped via scripts/ci/bootstrap-postgres.sh, non-superuser citizen_svc), removed afterwards: - Regression test notification-bindings.recipient.test.ts: FAILS on origin/main source (3 failed
- PR: original #2244; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: - Callers that pass no `recipientId` and a non-profile id (e.g. fee-payment falling back to the application id) now skip external-channel sends instead of sending to a bogus address. - notification-service still does not reject a UUID-shaped address for other producers (stub driver still records "delivered"); a guard there is a follow-up, not included to keep this change small. - Grievance/SLA/appeal paths outside the listed files that bypass `enqueuePackNotifications` are not covered (outside t

#### V4-G-07 - MEDIUM - VERIFIED
- Title: Delivery retry sweeper republishes without variables, eventType, category, campaignId or inline body: placeholders sent literally and the marketing-consent gate is skipped on retry
- Severity: MEDIUM
- Component: services/notification-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: deliveries/sweeper.ts:54-66 republishes payload with only templateId, recipient, recipientId, channel, deliveryId, retryCount. consumer reads variables/eventType/category/campaignId/body from payload, so placeholders render literally and isMarketingSend (consent-gate.ts:202-211) is false on retry. deliveries/schema.ts has no column storing the original payload.
- Root cause: The sweeper rebuilt the `notification.send` command from the delivery row only, which has no column for the original payload.
- Corrective action: - Migration 0051 adds nullable `retry_payload jsonb` (additive, `IF NOT EXISTS`). - On a failed send that will be retried, the consumer stores `{variables, eventType, category, campaignId, subject, body}` (only keys present) via `scheduleDeliveryRetry`, in the same transaction as the status change. - The sweeper spreads `row.retryPayload` into the republished payload. Rows queued before the migration have no payload and behave as before (OTP template stays fail-terminal).
- Changed files: services/notification-service/migrations/0051_deliveries_retry_payload.sql, services/notification-service/src/modules/deliveries/consumer.ts, services/notification-service/src/modules/deliveries/repo.ts, services/notification-service/src/modules/deliveries/schema.ts, services/notification-service/src/modules/deliveries/sweeper.ts
- Test cases: `services/notification-service/tests/v4g07-retry-payload.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2248 round 1 head dbb621029 -> CLEAN (2026-10-25T18:27:09Z): Regression test tests/v4g07-retry-payload.test.ts: FAILS on origin/main src (payload missing the 6 content keys), PASSES on head (disposable Postgres, non-superuser notification_svc, migrations 0001-0051 applied, scanner role BYPA
- PR: original #2248; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: - `retry_payload` can hold merge variables (potentially personal data). It is cleared only with the row; consider a purge/redaction on terminal status in a follow-up. OTP-style templates remain excluded from retry. - Rows already queued at deploy time retain the old lossy behavior until they finish. - Apply migration 0051 before deploying the code (the consumer writes the column).

#### V4-G-08 - HIGH - VERIFIED
- Title: Collected citizen fee is silently never posted to the GL when the revenue/bank head is missing: finance.gl.rejected has no citizen consumer and the handler acks
- Severity: HIGH
- Component: services/citizen-service, services/finance-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: finance revenue-gl/consumer.ts:92-105: on INVALID_HEAD_CODE it enqueues finance.gl.rejected and returns (acked, no retry). grep for glRejected/gl.rejected consumers: only asset-service f3-consumer.ts:670; citizen-service has none, and payment is already paid with receipt issued. Revenue silently never posted to GL.
- Root cause: The INVALID_HEAD_CODE branch emitted `finance.gl.rejected` and `return`ed (ack). `finance.gl.rejected` had no citizen subscriber (only asset-service filters on `journalId`).
- Corrective action: - finance `revenue-gl/consumer.ts`: on INVALID_HEAD_CODE, `captureError` (alert `GL_CITIZEN_RECEIPT_UNPOSTED`), emit `finance.gl.rejected` (payload now also carries `code`; additive), then throw `NonRetryableError` so the message dead-letters. The rejection transaction deliberately does NOT call `markProcessed`, so replaying from the DLQ after the chart is fixed posts the journal (spine journal is keyed by `citizen_receipt:<id>`). Same pattern as `gl/consumer.ts` for journal refusals. - citizen `topics.ts` + `fee-payment/consumer.ts`: consume `finance.gl.rejected`; for a payload with a `paymentId` that exists in the tenant, enqueue an `audit.event.record` with `outcome: "failure"`, action `payment_gl_post_failed`. Rejections without `paymentId` (asset journals) are ignored. - No payment status change: `reconciliation_status` has a CHECK constraint, and a new value would be a migration (p
- Changed files: services/citizen-service/src/modules/fee-payment/consumer.ts, services/citizen-service/src/topics.ts, services/finance-service/src/modules/revenue-gl/consumer.ts
- Test cases: `services/citizen-service/src/modules/fee-payment/gl-rejected.test.ts`, `services/finance-service/src/modules/revenue-gl/journal-type.test.ts`, `services/finance-service/src/modules/revenue-gl/unposted-receipt.test.ts`, `services/finance-service/tests/revenue-gl-consumer.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2249 round 1 head 1a1a9535a -> CLEAN (2026-10-25T18:32:34Z): (HIGH: stays open for owner approval; reviewer does not merge) Verified on a disposable Postgres (non-superuser `finance_svc`, removed after) with the worktree at the PR head: - Regression tests FAIL on origin/main sources and PAS
- PR: original #2249; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Dead-lettered receipts need an operator to fix the chart and replay from the DLQ (now alertable rather than invisible). The citizen payment row itself still shows `paid`; the failure is on the audit trail, not a payment-status flag.

#### V4-G-09 - MEDIUM - VERIFIED
- Title: Approved citizen refund emits no event (no GL reversal or disbursement) and a partial refund flips the whole payment to 'refunded'
- Severity: MEDIUM
- Component: services/citizen-service, services/finance-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: fee-payment/consumer.ts:309-322 refundDecide approve only updates refund row and sets payment.status='refunded'; no outbound event (topics.ts has only refundRequest/refundDecide commands; no consumer elsewhere). commands.requestRefund allows amount<=payment.amount and isRefundable (domain.ts:115) excludes 'refunded', so a partial refund makes the remainder unrefundable.
- Root cause: `refundDecide` approve branch only ran `updateRefund` + `updatePayment(status:'refunded')` + an audit event. `requestRefund` bounded the amount by the payment amount only, ignoring earlier approved refunds.
- Corrective action: - citizen: `EVENTS.refundApproved = "citizen.refund.approved"`; the approve branch emits it in the same transaction as the refund update (payload: `id`, `paymentId`, `applicationId`, `receiptNo`, `amountMinor` string, `currency`, `fullyRefunded`, `hoaCode?`, `serviceKey?`). The payment flips to `refunded` only when approved refunds cover it. `refundableBalance()` (domain) bounds request (command + consumer) and approval; approval of more than the remaining balance is a no-op. - finance: new `revenue-gl/refund-consumer.ts` (registered from `registerRevenueGlConsumers`): Dr revenue head / Cr bank for the refunded amount, journal `sourceKey = citizen_refund:<refundId>` (idempotent), type `journal`. A missing head raises `captureError` (`GL_CITIZEN_REFUND_UNPOSTED`) and dead-letters (`NonRetryableError`, not marked processed so a DLQ replay works). - The topic string is declared locally in `
- Changed files: services/citizen-service/src/modules/fee-payment/commands.ts, services/citizen-service/src/modules/fee-payment/consumer.ts, services/citizen-service/src/modules/fee-payment/domain.ts, services/citizen-service/src/topics.ts, services/finance-service/src/modules/revenue-gl/consumer.ts, services/finance-service/src/modules/revenue-gl/refund-consumer.ts
- Test cases: `services/citizen-service/src/modules/fee-payment/refund-approval.test.ts`, `services/finance-service/src/modules/revenue-gl/refund-gl.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2254 round 2 head 32b769db8 -> CLEAN (2026-10-25T19:55:25Z): Verified at the head (the head did change since round 1: f05e61cf -> 32b769db): - The follow-up commit restores `${BANK_CODE}` / `${revenueCode}` in both `INVALID_HEAD_CODE` messages, `refund-consumer.ts:40` and `:42`. They now ma
- PR: original #2254; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Refund event citizen.refund.approved is flagged as an orphan by the cross-service-events contract (V4-CERT-07).

#### V4-G-10 - MEDIUM - VERIFIED
- Title: Appeal outcomes never reach the application: an overturned or remanded rejection leaves the application permanently 'rejected'
- Severity: MEDIUM
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: application/domain.ts:46 rejected: [] (terminal); grep shows citizen.appeal.decided emitted only (appeal/consumer.ts:147) with no subscriber anywhere in citizen-service.
- Root cause: The issue-order consumer only updated the appeal row and emitted an event nobody consumes; the application transition table has no exit from `rejected`.
- Corrective action: In the same transaction as the appeal update (markProcessed + guarded write + history + audit), an issued `overturned` order moves a still-`rejected` application to `approved`, a `remanded` order moves it to `under_review`, and a `citizen_status_history` row is written. `upheld` / `modified` and applications no longer in `rejected` are untouched. A dedicated `assertAppealOutcomeTransition` is the only exit from `rejected`; the generic `assertStatusTransition` table (used by the status route) is unchanged so officers still cannot re-open via PATCH.
- Changed files: services/citizen-service/src/modules/appeal/consumer.ts, services/citizen-service/src/modules/application/domain.ts
- Test cases: `services/citizen-service/tests/appeal-outcome-application.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2243 round 1 head 3f4cb3a47 -> CLEAN (2026-10-25T18:25:49Z): (code and tests). The PR stays open: it is BLOCKED_FOR_APPROVAL and needs the owner's decision on the statutory mapping below. Verified on my own disposable non-superuser Postgres (`citizen_svc`, migrations via bootstrap-postgres.
- PR: original #2243; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: Combined with the V4-G-12 fixtures it produces the red citizen-service suite V4-INTEG-01.

#### V4-G-11 - MEDIUM - VERIFIED
- Title: Certificate issuance is decoupled from the application: no approved/paid precondition and the application never reaches 'issued'
- Severity: MEDIUM
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: issuance/validators.ts applicationId optional; issuance/consumer.ts:101-110 reads application only for notification variables; no approved/paid precondition; citizen.certificate.issued and citizen.document.verified have no subscribers (grep). Mitigated by officer-only maker-checker, so MEDIUM.
- Root cause: `issuanceApprove` only checked certificate state and maker != checker; the linked application was read solely for notification variables and never updated.
- Corrective action: Inside the existing single transaction (markProcessed + guarded write + audit): when the certificate has an `applicationId`, the application must exist in the tenant and be `approved`; if the service has an active fee schedule with `baseAmount > 0`, a payment with status `paid` / `offline_recorded` (or amount 0 for a full exemption) must exist. Otherwise the certificate stays `requested`, an `issue_blocked` certificate event and audit record are written, and nothing is issued. On success the application moves `approved -> issued` with a status-history row. Certificates with no applicationId keep legacy behaviour (the request body contract is unchanged).
- Changed files: services/citizen-service/src/modules/issuance/consumer.ts, services/citizen-service/src/modules/issuance/domain.ts
- Test cases: `services/citizen-service/tests/issuance-application-gate.test.ts`
- Verification result: Merged to main in #2280 (66b04aedd); regression test(s) PASS on the frozen SHA in the regression lane (cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file).
- Independent reviewer decision: PR #2245 round 1 head b97eecc9f -> CLEAN (2026-10-25T18:26:09Z): Verified on a disposable Postgres (non-superuser `citizen_svc`, bootstrapped via `scripts/ci/bootstrap-postgres.sh`): - Regression test `tests/issuance-application-gate.test.ts`: on origin/main src (consumer.ts/domain.ts reverted)
- PR: original #2245; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: VERIFIED
- Residual risk: The block is asynchronous (consumer-side), so the approve endpoint still returns 202 and the reason is visible only in the certificate event history. `citizen.document.verified` still has no subscriber (separate finding part, not changed here). Multi-currency / partial payments are not evaluated.

#### V4-G-12 - HIGH - UNRESOLVED
- Title: Appeal filing window is evaluated against a client-supplied decisionDate (never the application's actual decision time); applicationId/ownership not verified
- Severity: HIGH
- Component: services/citizen-service
- Requirement: Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)
- Reproduction evidence: appeal/commands.ts:47-49 assertWithinFilingWindow(new Date(body.decisionDate), windowDays) uses validator field decisionDate (validators.ts:13, only a YYYY-MM-DD regex). domain.ts:59-72 accepts any date whose deadline >= today, including future dates. applicationId (optional) is stored unchecked in consumer.ts:36-45; no lookup/ownership/rejected-status check.
- Root cause: `fileAppeal` fed `new Date(body.decisionDate)` into `assertWithinFilingWindow` and never looked the application up; the date validator only checked the YYYY-MM-DD shape and the window check accepts any future date.
- Corrective action: With an `applicationId`: the application is read (tenant-scoped via RLS plus an explicit tenant check), ownership is asserted (citizens: 404 for non-owners, existence not leaked), it must be `rejected` (else 409 NOT_APPEALABLE), the decision date is the server-recorded rejection time (latest `rejected` status-history row, falling back to the application's updated_at), the client date is ignored, and the appeal is attributed to the application's citizen. Without an `applicationId` (decisionRef-only appeals) the date cannot be verified server-side, so a future date is refused (422 INVALID_DECISION_DATE). Window length is still server-derived.
- Changed files: services/citizen-service/src/modules/appeal/commands.ts, services/citizen-service/src/modules/appeal/domain.ts
- Test cases: `services/citizen-service/tests/appeal-filing-integrity.test.ts`, `services/citizen-service/tests/service-gaps-partial-routes.test.ts`
- Verification result: Merged in #2280. Own regression test appeal-filing-integrity.test.ts PASSES 9/9, but the PR also changed tests/service-gaps-partial-routes.test.ts and that file FAILS 10 of 38 at the frozen SHA (regression gate 20a/20b, deterministic). A PR test file is red, so the VERIFIED rule is not met. Tracked as V4-INTEG-01.
- Independent reviewer decision: PR #2246 round 1 head 7e2265bba -> CLEAN (2026-10-25T20:25:54Z): Verified on a disposable Postgres (non-superuser citizen_svc, full CI bootstrap): - Regression test tests/appeal-filing-integrity.test.ts: on origin/main src, 8 of 9 FAIL (202 where 422/404/409 expected); on head, 9/9 PASS. - Full
- PR: original #2246; bundle #2280 (66b04aedd)
- Merge commit SHA: 66b04aedd827b7e4fdcb402731d6d45a678badc8
- Closure status: UNRESOLVED
- Residual risk: Its own appeal-filing-integrity.test.ts passes 9/9, but the SVC-089 fixture file service-gaps-partial-routes.test.ts is red at the integrated SHA (V4-INTEG-01).

### Certification-found defects (V4-INTEG-01, V4-CERT-nn)

Severity for these rows is provisional, assigned by the Release Certification Auditor. None is fixed: the lane was read-only on code.

#### V4-INTEG-01 - MEDIUM - UNRESOLVED
- Title: citizen-service suite red at integrated SHA: 10 of 38 tests in service-gaps-partial-routes.test.ts fail
- Severity: MEDIUM
- Component: services/citizen-service (tests)
- Requirement: Mandatory gate: unit/service tests green (V4.0 gates 4/20)
- Reproduction evidence: Deterministic on 3 fresh-DB runs plus an isolation run: the REMAND test files a second appeal against application 66666666-0000-4000-8000-000000000016 and gets 409 NOT_APPEALABLE (appeal/commands.ts:58); id is undefined, the test polls /appeals/undefined for 3s, exhausts the 200/min rate-limit bucket, and later SVC-084/SVC-089 IDOR tests return 500 (429 surfaced as unhandled error).
- Root cause: PR #2246 (V4-G-12 fixtures) and PR #2243 (V4-G-10: appeal outcome moves the application out of 'rejected') collide: an earlier test in the same file issues an order that now moves the shared seeded application out of 'rejected'. Each PR was clean alone (cycle 2 reported 38/38 on the #2246 head). CONFIRMED IN GITHUB CI: run 40258410831 Tests job failed on @civitasone/citizen-service#test (4 tests failed in the CI run, same file).
- Corrective action: Seed a separate rejected application per test (or reset status in beforeEach) and stop the rate-limit exhaustion; not applied (lane read-only).
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/regression.json gates 20a and 20b; build.json gate 4; db.json svc-citizen-service
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-G-10, V4-G-12

#### V4-CERT-01 - LOW - UNRESOLVED
- Title: grant-service v4-d03/v4-d04 tests fail under CI parallelism (cross-file isolation)
- Severity: LOW
- Component: services/grant-service (tests)
- Requirement: Mandatory gate: unit/service tests green under the CI configuration
- Reproduction evidence: Fresh-DB runs at --maxWorkers=2: 4 failures (grant_schemes_pkey duplicate key, deadlock, wrong totals) in tests/v4-d03-duplicate-disbursement.test.ts and tests/v4-d04-failed-disbursement.test.ts; they pass at maxWorkers=1 (regression lane). The db-lane rerun was still red. NOT reproduced in GitHub CI (run 40258410831 Tests job: grant-service#test succeeded), so this is classified as an environment/isolation sensitivity (amd64-emulated PG).
- Root cause: Cross-file shared fixtures/ids in the grant test suites; not triaged beyond that.
- Corrective action: Isolate fixtures per file or run the package serially; triage whether a real lock-ordering defect exists (a deadlock was reported).
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json gate 4; db.json svc-grant-service
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: If the reported deadlock is real, the V4-D-03/V4-D-04 fixes could hold a lock-order defect; not reproduced in GitHub CI.
- Related: V4-D-03, V4-D-04

#### V4-CERT-02 - MEDIUM - UNRESOLVED
- Title: web auditResource.test fails: hrms comp-off consumer emits resourceType comp_off not in HR_AUDIT_RESOURCE_TYPES
- Severity: MEDIUM
- Component: apps/web (hr/audit-log), services/hrms-service
- Requirement: Audit trail completeness: every audit resourceType must be visible in the HR audit-log filter
- Reproduction evidence: apps/web src/app/(app)/hr/audit-log/auditResource.test.ts fails deterministically at the SHA. CONFIRMED IN GITHUB CI: run 40258410831 Tests job, @civitasone/web#test, 1 failed of 20127.
- Root cause: V4-B-01 persistence (hrms comp-off-consumer, #2271 in #2280) added a new resourceType without updating the web allow-list.
- Corrective action: Add 'comp_off' to HR_AUDIT_RESOURCE_TYPES (and a label); not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json gate 4
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-B-01

#### V4-CERT-03 - MEDIUM - UNRESOLVED
- Title: tenant-table-rls-guard FAILS: adv_permit_directory and building_permit_directory have tenant_id without RLS
- Severity: MEDIUM
- Component: services/advertisement-service, services/building-service (migrations)
- Requirement: Tenant isolation: every tenant_id table has ENABLE/FORCE RLS + policy, or a justified baseline entry
- Reproduction evidence: node scripts/ci/tenant-table-rls-guard.mjs exit 1: advertisement-service/migrations/0006_permit_public_directory.sql and building-service/migrations/0005_permit_public_directory.sql. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_TENANT_TABLE_RLS).
- Root cause: Public verification directory tables added by V4-B-06 (#2273) without RLS or a baseline justification.
- Corrective action: Add RLS policy or baseline with written justification (public read model); not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json gate 14 tenant-table-rls-guard
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-B-06

#### V4-CERT-04 - LOW - UNRESOLVED
- Title: flaky-skip-guard FAILS: 7 un-inventoried skipIf in closure3 int tests
- Severity: LOW
- Component: tests (closure3-s4/s5 *.int.test.ts)
- Requirement: No silent skipped tests (flaky-skip-guard)
- Reproduction evidence: node scripts/ci/flaky-skip-guard.mjs exit 1: audit, billing x2, catalogue, contract, legal x2 int tests lack a FLAKY-SKIP reason/expiry. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_FLAKY_SKIP_GUARD).
- Root cause: Closure-3 integration tests added skipIf without inventory entries.
- Corrective action: Add FLAKY-SKIP reason+expiry or baseline; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json gate 14 flaky-skip-guard
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-05 - LOW - UNRESOLVED
- Title: authz-tenant-scanner ratchet FAILS on 4 stale baseline entries
- Severity: LOW
- Component: scripts/ci/authz-tenant-scanner-baseline.json
- Requirement: SEC-014 authz/tenant ratchet
- Reproduction evidence: node scripts/ci/authz-tenant-scanner.mjs exit 1 (build and db lanes): billing ccavenue/payu/razorpay webhooks and knowledge ai/prompt no longer reproduce but are still baselined. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_AUTHZ_TENANT_SCANNER).
- Root cause: Fixes landed (V4-B-03, V4-B-09) without regenerating the baseline.
- Corrective action: Regenerate with --write-baseline; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json, db.json (g-authz-scanner)
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-B-03, V4-B-09

#### V4-CERT-06 - LOW - UNRESOLVED
- Title: cross-service-events contract: stale baseline entry deadSubscriptions finance-service|finance.payment.file_decided
- Severity: LOW
- Component: tests/contract/cross-service-events.contract.test.ts
- Requirement: Contract baseline must not contain fixed defects
- Reproduction evidence: tests/contract: 1 file failed, 2 of 227 tests (this is the first). CONFIRMED IN GITHUB CI: Contract Tests job failed on BLOCKING baseline has no stale entries.
- Root cause: Fixed defect (V4-D-01) still baselined.
- Corrective action: Remove the baseline entry; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/contract-e2e.json gate 6a
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-D-01

#### V4-CERT-07 - MEDIUM - UNRESOLVED
- Title: cross-service-events contract: orphan event citizen.refund.approved (no recognised consumer)
- Severity: MEDIUM
- Component: tests/contract, services/citizen-service, services/finance-service
- Requirement: Every produced event has a consumer or an allow-list entry
- Reproduction evidence: Same contract file, second failure. A finance refund-consumer.ts exists, so the detector may miss it or an allow-list entry is needed. CONFIRMED IN GITHUB CI: Contract Tests job failed on BLOCKING no NEW orphan events.
- Root cause: Introduced with the V4-G-09 refund path; not triaged.
- Corrective action: Add PRODUCER_ONLY_ALLOWLIST/known-defects entry or fix the detector; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/contract-e2e.json gate 6a
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-G-09

#### V4-CERT-08 - MEDIUM - UNRESOLVED
- Title: payroll posting-history: hrms applyPosting event does not land a payroll history row (2 tests fail deterministically)
- Severity: MEDIUM
- Component: tests/cross-service-live (hrms, payroll)
- Requirement: Cross-service event delivery (outbox relay)
- Reproduction evidence: payroll-posting-history.test.ts ST-M01-11: 2 failed, also with maxWorkers=1 on a freshly bootstrapped DB; not covered by ci.yml.
- Root cause: Not triaged.
- Corrective action: Triage relay/consumer wiring; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/contract-e2e.json gates 19a/19b
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-09 - LOW - UNRESOLVED
- Title: tests/security idor-inventory sanity test fails: task-named route GET /v1/inventory/movements/:id does not exist
- Severity: LOW
- Component: tests/security/idor-inventory.test.ts
- Requirement: IDOR test inventory is accurate
- Reproduction evidence: Failed in both runs of tests/security (3 failed first run, 1 failed on rerun); two idor.test.ts 5000ms timeouts occurred in run 1 only (emulated amd64 PG).
- Root cause: Stale test expectation.
- Corrective action: Update the test; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/db.json G11
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-10 - HIGH - UNRESOLVED
- Title: service roles citizen_svc, legal_svc, telephony_svc have BYPASSRLS in the bootstrapped DB (RLS inert)
- Severity: HIGH
- Component: db roles / scripts/ci/bootstrap-postgres.sh
- Requirement: RLS must be effective for service roles (non-BYPASSRLS)
- Reproduction evidence: tests/data-integrity/rls-no-guc.test.ts: 4 failures incl. 'citizen: RLS inert via BYPASSRLS'. Not run by the ci.yml test job.
- Root cause: Unknown whether the roles come from the bootstrap script only or mirror production provisioning; not triaged.
- Corrective action: Verify role attributes in the target environment and remove BYPASSRLS; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/db.json G13
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Potential tenant-isolation bypass on three services if production roles match.

#### V4-CERT-11 - MEDIUM - UNRESOLVED
- Title: plaintext PII at rest: telephony.calls caller/callee numbers and citizen_profiles.mobile
- Severity: MEDIUM
- Component: services/telephony-service, services/citizen-service
- Requirement: PII at rest protection
- Reproduction evidence: tests/data-integrity/pii-at-rest.test.ts: 3 failures.
- Root cause: Not triaged.
- Corrective action: Encrypt or tokenise; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/db.json G13
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-12 - MEDIUM - UNRESOLVED
- Title: tests/cross-service topic-wiring assertions fail (5 tests read undefined constants)
- Severity: MEDIUM
- Component: tests/cross-service flow2/flow4/flow5
- Requirement: Cross-service flow wiring evidence
- Reproduction evidence: 5 failed/9 passed: GRN three-way match emit+consume, contract-expiry alert emit+consume, audit-trail topic agreement.
- Root cause: Not triaged; may be stale constants.
- Corrective action: Triage; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/db.json G12
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-13 - LOW - UNRESOLVED
- Title: analytics-service export-consumer 50MB limit test fails in the db lane (not seen in the build-lane turbo test)
- Severity: LOW
- Component: services/analytics-service (tests)
- Requirement: Unit/service tests green
- Reproduction evidence: svc-analytics-service: 1 failure, fails again on rerun.
- Root cause: Not triaged (environment, memory or emulation suspected).
- Corrective action: Triage; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/db.json svc-analytics-service
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-14 - LOW - UNRESOLVED
- Title: flaky under load and not in the known-flaky list: audit-service risk-routes GAP-AUDIT-RISK-REGISTER-07; web bills/new duplicate-submit
- Severity: LOW
- Component: services/audit-service, apps/web (tests)
- Requirement: Stable CI
- Reproduction evidence: Each failed once in the full run and passed on rerun (audit-service 450/450 on rerun).
- Root cause: Load-sensitive tests.
- Corrective action: Add to known-flaky with expiry or harden; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/build.json gate 4; db.json
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.

#### V4-CERT-17 - MEDIUM - UNRESOLVED
- Title: gitleaks secret scan FAILS on the frozen SHA commit: 2 generic-api-key findings in test files added by bundle A
- Severity: MEDIUM
- Component: services/queue-service/vitest.config.ts:10, services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32
- Requirement: Mandatory gate: secret scan (gitleaks) clean on the release commit
- Reproduction evidence: GitHub Security Scan run 40258410829, job Secret Scan (gitleaks-action, log-opts=-1): 'leaks found: 2', RuleID generic-api-key, commit 66b04aedd. Values redacted by gitleaks and not reproduced here. The build-lane scripts/ci/secret-scanner.mjs and the ci.yml grep patterns were clean, and gitleaks was not installed on the certification host, so only GitHub CI exercised this gate.
- Root cause: Secret-shaped string literals in test files (JWT_SECRET in a vitest config; const SECRET in a test) introduced by the V4 bundle; whether they are fake test values was not established by this lane.
- Corrective action: Replace with env-derived/obviously-fake values or add a justified gitleaks allow entry; not applied (lane read-only on code).
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/reports/job-121365184496.log
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Open at the frozen SHA; the certification lane was read-only on code.
- Related: V4-B-01

#### V4-CERT-15 - CRITICAL - UNRESOLVED
- Title: open CRITICAL code-scanning alerts on main: 5 (CodeQL 2, Trivy 3)
- Severity: CRITICAL
- Component: repo (code scanning)
- Requirement: No open CRITICAL scanner alerts at release
- Reproduction evidence: gh api code-scanning/alerts?state=open&ref=refs/heads/main: 2421 open, 5 critical. None from the frozen SHA (older SHAs 96e536cf9, e845c0401).
- Root cause: Not triaged in this certification.
- Corrective action: Triage/dismiss with justification or fix; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/security-perf/codeql-all.json
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Counted as one registry row; alerts=5.

#### V4-CERT-16 - HIGH - UNRESOLVED
- Title: open HIGH code-scanning alerts on main: 245 (CodeQL 68, Trivy 177)
- Severity: HIGH
- Component: repo (code scanning)
- Requirement: No untriaged HIGH scanner alerts at release
- Reproduction evidence: Same query. CodeQL high rules include missing-rate-limiting, path-injection, request-forgery, insufficient-password-hash (gateway api-key-auth.ts), disabling-certificate-validation; Trivy findings are mostly image CVEs (hrms/finance/gateway), node-forge CVE-2026-85393, uuid CVE-2026-41907.
- Root cause: Not triaged in this certification.
- Corrective action: Triage; not applied.
- Changed files: none
- Test cases: none
- Verification result: NOT FIXED. Found by: ~/orch-logs/closure/v4/cert/security-perf/codeql-all.json
- Independent reviewer decision: none (certification-found or not reproduced)
- PR: original n/a; bundle n/a
- Merge commit SHA: n/a (not merged)
- Closure status: UNRESOLVED
- Residual risk: Counted as one registry row; alerts=245.

### Earlier runs in the consolidated rows

Run 1 and Run 2 detail stays in the sections below. The rows are re-listed here so the counts above are reproducible; statuses are those of the 2026-10-24 refresh (not re-checked here), updated only where the frozen-SHA GitHub CI gives newer evidence (FINAL-E2E-01, FINAL-GATE-01) or the git log shows the fix landed (CLOS-S4-05 in #2279).

#### Run 1 (60 rows)

| ID | Sev | Status | Component | Title | Basis |
|---|---|---|---|---|---|
| CLOS-S1-01 | MEDIUM | FIXED_MERGED | apps/web | The Retry button on 'Could not load positions' calls fetchTenantPositions().then(setPositi | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-02 | MEDIUM | FIXED_MERGED | apps/web | fetchTenantPositions returns [] when !res.ok instead of throwing. Its consumers (ApprovalC | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-03 | LOW | FIXED_MERGED | apps/web | The draft load (line 64) and submitForApproval (line 112) both set the UI error to e.messa | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-04 | LOW | FIXED_MERGED | apps/web | previewError is set to e.message for any non-abort Error from previewEngineBinding, which | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-05 | LOW | FIXED_MERGED | apps/web | Filing an appeal uses plain fetch, and the catch renders e.message for any Error, so a net | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-06 | LOW | FIXED_MERGED | apps/web | The afterMutate polling chain re-arms with window.setTimeout(() => void tick(), 3000) up t | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-07 | LOW | FIXED_MERGED | apps/web | The file makes 5 plain fetch calls. The catches at lines 87, 103 and 126 render e.message | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-08 | LOW | FIXED_MERGED | apps/web | Plain fetch, and the catch renders e.message, so a network failure shows raw 'Failed to fe | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-09 | LOW | FIXED_MERGED | apps/web | Plain fetch, and the catch renders e.message. Offline verification shows raw 'Failed to fe | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-10 | LOW | FIXED_MERGED | apps/web | Plain fetch at 2 sites. The resolve error handler sets e.message, so a network failure sho | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-11 | LOW | FIXED_MERGED | apps/web | Plain fetch, and the catch renders e.message, so a network failure shows raw 'Failed to fe | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-12 | LOW | FIXED_MERGED | apps/web | Plain fetch, and the catch renders e.message, so offline registration shows raw 'Failed to | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-13 | LOW | FIXED_MERGED | apps/web | defaultRange() builds the default From/To dates with toISOString().slice(0,10), which is t | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-14 | LOW | FIXED_MERGED | apps/web | flash() starts an untracked window.setTimeout(() => setToast(null), 6000) on every call. A | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-15 | MEDIUM | FIXED_MERGED | apps/web | The derived due date is new Date(Date.now()+sla*3_600_000).toISOString().slice(0,10), the | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-16 | LOW | FIXED_MERGED | apps/web | Lines 286, 379, 406 and 407 render timestamps with new Date(x).toLocaleString('en-IN') and | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-01 | LOW | FIXED_MERGED | apps/web | Bare fetch() inside try. A network failure rejects with TypeError('Failed to fetch') and t | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-02 | LOW | FIXED_MERGED | apps/web | ask() and escalate() use bare fetch(). A network failure TypeError('Failed to fetch'), or | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-03 | LOW | FIXED_MERGED | apps/web | activateDomainPackStage3 uses bare fetch() and throws a plain Error. DomainPackActivatePan | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-04 | LOW | FIXED_MERGED | apps/web | Loading-state race. When domain or status changes, the effect aborts the previous load and | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-05 | LOW | FIXED_MERGED | apps/web | buildForecastSeries labels forecast days with new Date().toISOString().slice(0,10), which | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S2-06 | MEDIUM | FIXED_MERGED | apps/web | A missing sanctionDate (and createdAt at line 334) is replaced by new Date().toISOString() | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-01 | LOW | FIXED_MERGED | apps/web | isProductSelectable derives 'today' as now.toISOString().slice(0,10), the UTC date. Betwee | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-02 | LOW | FIXED_MERGED | apps/web | This is a server component with no 'use client', and the host runs UTC. The 'This month' s | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-03 | MEDIUM | FIXED_MERGED | apps/web | Four controls have no accessible name and rely on placeholder only: the 'Exemption reason' | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-04 | LOW | FIXED_MERGED | apps/web | The abort listener is added with signal?.addEventListener('abort', ...). An already-aborte | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-05 | LOW | FIXED_MERGED | apps/web | The legacy FileUpload fakes progress with a random setInterval (Math.random()*30 every 200 | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S3-06 | LOW | FIXED_MERGED | apps/web | The cached-data notice formats its timestamp with new Date(cachedAt).toLocaleString('en-IN | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S4-01 | MEDIUM | FIXED_MERGED | services/document-service | Folder routes read :id via `req.params as { id: string }` with no uuid validation, and fol | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S4-02 | MEDIUM | FIXED_MERGED | services/contract-service | GET /v1/contract/templates/:id/render calls JSON.parse(String(query.metadata)) with no try | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S4-03 | LOW | FIXED_MERGED | services/court-service | GET /v1/court/cases/overdue validates asOf only by regex, so 2026-13-45 passes and reaches | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S5-02 | LOW | FIXED_MERGED | services/hrms-service | limit = Math.min(Number(req.query.limit ?? 50), 100) is unvalidated. limit=abc gives NaN a | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S5-03 | LOW | FIXED_MERGED | services/hrms-service | limit: q.limit ? Math.min(200, Number(q.limit)) : 100 gives NaN or a negative for bad inpu | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S5-04 | LOW | FIXED_MERGED | services/legal-service | scheduleDailyUtc() creates a setTimeout, then a never-cleared, non-unref'd setInterval(run | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S6-01 | MEDIUM | FIXED_MERGED | services/revenue-service | Seven revenue-service module error handlers (analytics:37, arrears:21, bbps:15, billing:12 | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S6-03 | MEDIUM | FIXED_MERGED | services/revenue-service | GET rate-slabs, penalty-rules and rebate-rules read rateHeadId through an unvalidated cast | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S6-04 | MEDIUM | FIXED_MERGED | services/works-service | Path params workId (execution/routes.ts:110,119) and tenderId (tender/routes.ts:49) are ca | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S6-05 | LOW | FIXED_MERGED | packages/outbox | startOutboxPurge wraps its cycle in try {...} catch { /* swallow */ }. A persistent purge | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S6-08 | LOW | FIXED_MERGED | packages/schemas | createFastifyErrorHandler and isHttpError, the shared error envelope used by every domain | Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier |
| CLOS-S1-17 | MEDIUM | BLOCKED_FOR_APPROVAL | apps/web | The export range is sent as UTC boundaries: isoStart(d) is `${d}T00:00:00.000Z` and isoEnd | Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification. |
| CLOS-S4-04 | MEDIUM | BLOCKED_FOR_APPROVAL | services/billing-service | createOrder and fetchPayment call fetch() with no AbortSignal or timeout, unlike every ada | Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification. |
| CLOS-S4-05 | HIGH | FIXED_MERGED | services/finance-service | Defaults for postingDate, effectiveFrom, asOf, valueDate and paymentDate use new Date().to | fix merged in #2279 (commit message lists CLOS-S4-05) |
| CLOS-S5-05 | MEDIUM | BLOCKED_FOR_APPROVAL | services/hrms-service | The date-only default for asOf uses new Date().toISOString().slice(0,10), the UTC date, wh | Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification. |
| CLOS-S6-02 | LOW | BLOCKED_FOR_APPROVAL | services/revenue-service | The 400 validation response puts ZodError.message, a raw JSON dump of the issues array, in | Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification. |
| CLOS-S6-06 | MEDIUM | BLOCKED_FOR_APPROVAL | services/revenue-service | Business dates use new Date().toISOString().slice(0,10), the UTC date, which is the previo | Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification. |
| CLOS-S6-07 | MEDIUM | FIXED_MERGED | services/workflow-service | The substitute (delegate) lookup uses the UTC date as 'today'. Between 00:00 and 05:30 IST | closed: todayIST() in resolver.ts (defect-registry.md refresh 2026-10-24) |
| CLOS-FLAKY-DRAINAGE | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | drainage hotspotCode collision under concurrency | closed in #2182 (refresh 2026-10-24) |
| CLOS-CVE-NEXT | HIGH | FIXED_MERGED | see defect-registry.md run 1 | Next.js App Router DoS CVE-2026-94482 | closed in #2175 |
| DELEG-REVOKE-OWNERSHIP | HIGH | FIXED_MERGED | see defect-registry.md run 1 | delegation revoke/list ownership | closed in #2174 |
| DELEG-UTC | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | delegation active check uses UTC date | closed in #2181 |
| P3-NEW-1 | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | regression from #2166 (unrated in sources; MEDIUM assigned) | closed (no res.status in the file on main) |
| P3-NEW-2 | MEDIUM | ACCEPTED_DEFERRAL | see defect-registry.md run 1 | payroll visual-regression snapshots stale (unrated; MEDIUM assigned) | owner decision 2026-10-23 22:10 IST: accepted as known-stale |
| P3-NEW-3 | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | E2E regression from #2152 (unrated; MEDIUM assigned) | closed in source (global-setup.ts mock) |
| P3-NEW-4 | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | integration conflict, #2161 excluded (unrated; MEDIUM assigned) | closed: #2161 merged 2026-10-23 |
| P3-BASE-1 | MEDIUM | FIXED_MERGED | see defect-registry.md run 1 | web test red on main, pre-existing (unrated; MEDIUM assigned) | closed #2173 |
| FINAL-E2E-01 | HIGH | FIXED_MERGED | see defect-registry.md run 1 | duplicate h1#page-heading across loading.tsx and pages, 76 Playwright strict-mode violatio | GitHub CI run 40258410831 (frozen SHA): job E2E (Playwright) completed success; not re-run on the certification host (NOT_RUN locally) |
| FINAL-GATE-01 | HIGH | FIXED_MERGED | see defect-registry.md run 1 | Live Stack Verification contract score 10/10 fails | GitHub CI run 40258410831 (frozen SHA): job Live Stack Verification completed success; the local static-only score.mjs run (9.8/10, exit 1) |
| FINAL-GATE-02 | HIGH | UNRESOLVED | see defect-registry.md run 1 | Release Gate evidence audit, 11 gates UNMEASURED | GitHub CI run 40258410831 (frozen SHA): job Release Gate (evidence audit) FAILED at 04:36:42Z with blockers L3 and L6 UNMEASURED (no evidenc |
| FINAL-TEST-01 | LOW | UNRESOLVED | see defect-registry.md run 1 | workflow delegations-routes test non-idempotent | not re-verified |
| FINAL-FLAKY-01 | LOW | UNRESOLVED | see defect-registry.md run 1 | CreateContractForm GAP-CONTRACTS-NEW-02 flaky in CI | known-flaky; not re-verified |

#### Run 2 (53 rows)

| ID | Sev | Status | Component | Title | Basis |
|---|---|---|---|---|---|
| CLOS2-S1-01 | MEDIUM | FIXED_MERGED | apps/web | The per-user role loader never checks res.ok. A 401/403/500 JSON body has no data key, so | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S1-02 | LOW | FIXED_MERGED | apps/web | Attachment upload date is printed as a.uploadedAt.slice(0, 10). uploadedAt is a timestampt | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-03 | LOW | FIXED_MERGED | apps/web | Issued, due and returned dates are built as formatIndianDate(x.slice(0, 10)). The slice di | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-04 | LOW | FIXED_MERGED | apps/web | Same defect as IssuesTable: issuedAt and dueAt are sliced to 10 characters before formatIn | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-05 | LOW | FIXED_MERGED | apps/web | Carpet area is validated and submitted with parseInt(value,10) on a free-text input. parse | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-06 | LOW | FIXED_MERGED | apps/web | Seniority (months) uses the same lenient parseInt validation. '12.9', '3x' and '1e2' pass | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-07 | MEDIUM | FIXED_MERGED | apps/web | The account picker adapters searchAccounts and resolveAccounts return [] for a non-OK resp | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-08 | LOW | FIXED_MERGED | apps/web | searchFiles (EntityPicker adapter for the DFA file search) returns [] when !res.ok, so a f | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-09 | MEDIUM | FIXED_MERGED | apps/web | loadHistory is called as `void loadHistory(...)` in the mount effect with no catch, and fe | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-10 | MEDIUM | FIXED_MERGED | apps/web | fetchServiceDefinition, fetchA11yPreview and fetchServiceAnalytics (lines 171, 229, 240) u | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-11 | LOW | FIXED_MERGED | apps/web | Create and update obligation use a bare fetch (lines 75 and 113) and the catch renders e.m | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-12 | LOW | FIXED_MERGED | apps/web | The tag, AMC, transfer, disposal request, disposal and inter-org transfer handlers use bar | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-13 | LOW | FIXED_MERGED | apps/web | Add note, submit, sign and move use bare fetch and the catch renders e.message ('Failed to | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-14 | LOW | UNRESOLVED | apps/web | The notifications panel loader uses a bare fetch. Any network failure sets error='Failed t | LOW-risk, no PASS 2 record found (2026-10-24 refresh); not re-checked |
| CLOS2-S1-15 | LOW | FIXED_MERGED | apps/web | RTI detail load, respond and appeal use bare fetch (lines 88, 122, 135) and the catch rend | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S1-16 | LOW | FIXED_MERGED | apps/web | financialYearStartYear derives the Indian financial year from getUTCMonth, so between 00:0 | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-01 | MEDIUM | FIXED_MERGED | apps/web | Server component (no use client) derives the calendar date from the host clock via Date ge | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-02 | MEDIUM | FIXED_MERGED | apps/web | Server component (no use client) derives the calendar date from the host clock via Date ge | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-03 | LOW | FIXED_MERGED | apps/web | Server component (no use client) derives the calendar date from the host clock via Date ge | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-04 | LOW | FIXED_MERGED | apps/web | Server component (no use client) derives the calendar date from the host clock via Date ge | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-05 | LOW | FIXED_MERGED | apps/web | Server component (no use client) derives the calendar date from the host clock via Date ge | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-06 | LOW | FIXED_MERGED | apps/web | Effective-date input min is new Date().toISOString().split("T")[0], the UTC date, so betwe | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-07 | LOW | FIXED_MERGED | apps/web | The far-future limit compares effectiveDate with max.toISOString().slice(0,10), the UTC da | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-08 | LOW | FIXED_MERGED | apps/web | Exported CSV filename uses the UTC date, so a file exported 00:00-05:30 IST is named with | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S2-09 | MEDIUM | BLOCKED_FOR_APPROVAL | apps/web | The five numeric policy inputs use Number(e.target.value). Clearing a field gives Number(" | Pending owner decision as of the 2026-10-24 refresh; not re-checked |
| CLOS2-S3-01 | HIGH | FIXED_MERGED | apps/web | renderMarkdown escapes only & < > before building the link anchor. The href is taken from | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S3-02 | MEDIUM | FIXED_MERGED | apps/web | localStorage.getItem in the mount effect (line 11) and localStorage.setItem in cycle() (li | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-03 | MEDIUM | FIXED_MERGED | apps/web | deviceHeaders() reads sessionStorage.getItem(TRUST_KEY) with no try/catch (typeof guard on | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S3-04 | LOW | FIXED_MERGED | apps/web | useConfirmAction catches any thrown value and shows e.message. Consumers that call bare fe | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-05 | LOW | FIXED_MERGED | apps/web | empanel() catches with setError(e instanceof Error ? e.message : t('failed')). The bare fe | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-06 | LOW | FIXED_MERGED | apps/web | Invite-user dialog uses bare fetch (line 223) and its catch renders err.message for any Er | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-07 | LOW | FIXED_MERGED | apps/web | Create/edit master uses bare fetch (lines 305 and 311); the catch renders err.message for | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-08 | LOW | FIXED_MERGED | apps/web | renderMarkdown applies the bold/italic/code substitutions before the link substitution, so | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-09 | LOW | FIXED_MERGED | apps/web | formatRelativeTime computes Date.now() - new Date(iso).getTime() with no validity check. A | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-10 | LOW | FIXED_MERGED | apps/web | The offline 'Showing saved data from <timestamp>' banner formats cachedAt with new Date(ca | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S3-11 | MEDIUM | FIXED_MERGED | apps/web | Mappers substitute new Date().toISOString() when createdAt/updatedAt is absent: helpdesk t | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S3-12 | LOW | FIXED_MERGED | apps/web | The CSV download filename stamp is new Date().toISOString().slice(0, 10), the UTC date. Be | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S5-01 | MEDIUM | FIXED_MERGED | services/knowledge-service | Path :id is read via req.params as {id:string} with no UUID validation and passed to Drizz | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S5-02 | MEDIUM | FIXED_MERGED | services/knowledge-service | versionId (all callers) and documentId (callers whose clearedAccessLevels(ctx) is null, i. | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S5-03 | MEDIUM | FIXED_MERGED | services/notification-service | GET/PATCH/(line 78) /notifications/dlt-templates/:id cast :id without validation; dlt_temp | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-01 | MEDIUM | FIXED_MERGED | packages/rate-limit | Default keyGenerator reads (req as any).tenantId, a property nothing in the repo ever sets | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S6-02 | MEDIUM | FIXED_MERGED | packages/numbering | financialYear and resetBucket use UTC getters. For reference numbers minted between 00:00 | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S6-03 | LOW | FIXED_MERGED | packages/circuit-breaker | Header and call() doc state the half-open state runs ONE probe, but call() has no probe ga | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-04 | MEDIUM | FIXED_MERGED | packages/search | index(), bulkIndex(), remove() and removeAll() never check res.ok. Meilisearch 4xx/5xx (ba | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-05 | LOW | FIXED_MERGED | packages/search | bulkIndex() detects result.body.errors but only logs a warning with the count; it neither | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-06 | LOW | FIXED_MERGED | packages/storage | objectExists() and headObject() catch every error and return false/null, so a 403 (credent | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S6-07 | MEDIUM | FIXED_MERGED | packages/db | A malformed cached value makes JSON.parse(cached) throw inside the onRequest hook, so ever | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-08 | MEDIUM | FIXED_MERGED | services/visitor-service | getFullRoster maps every hash value through JSON.parse with no guard. One corrupt roster e | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-09 | LOW | FIXED_MERGED | services/visitor-service | popCommand does JSON.parse(raw) on the value already removed by rpop. A corrupt entry thro | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-10 | MEDIUM | FIXED_MERGED | services/telephony-service | The three Twilio/Exotel fetch calls (lines 101, 141, 183) have no AbortSignal or timeout. | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-11 | LOW | FIXED_MERGED | packages/client-core | exchangeAuthorizationCode and refreshAccessToken call fetch with no timeout; on a hung Key | fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24) |
| CLOS2-S6-12 | MEDIUM | FIXED_MERGED | packages/gov-adapters | PFMS disbursement/status (pfms.ts:122,151), GSTN token/filing/status (gstn.ts:102,167,223, | owner-approved, fixed and merged (#2186-#2192 via #2193) |
| CLOS2-S6-13 | MEDIUM | FIXED_MERGED | services/revenue-service | billDate is `new Date().toISOString().split('T')[0]`, the UTC date, so a bill generated be | owner-approved, fixed and merged (#2186-#2192 via #2193) |

#### Run 3 (101 rows; first time listed in these reports; IDs `CLOS3-*`, sources `run3-discover-*.json`, `run3-pass2-*.json`, `run3-blocked-approved.json`)

Merged in #2227 (`96e536cf9`, 70 low/medium fixes) and #2279 (`e845c0401`, 29 owner-approved fixes). Two rows have no PASS 2 record and are UNRESOLVED (CLOS3-S1-15 Low, CLOS3-S3-13 Medium).

| ID | Sev | Status | Component | Title | Basis |
|---|---|---|---|---|---|
| CLOS3-S1-01 | HIGH | FIXED_MERGED | apps/web | Opening the Fee step of the service designer with a flat or slab fee model starts an endle | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S1-02 | HIGH | FIXED_MERGED | apps/web | Opening the Approval chain step of an existing draft PATCHes the workflow definition every | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-03 | MEDIUM | FIXED_MERGED | apps/web | The Eligibility step PATCHes the rule set /api/proxy/v1/citizen/eligibility/rule-sets/:id | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-04 | MEDIUM | FIXED_MERGED | apps/web | With at least one enabled notification cell the Notifications step issues a GET of all tem | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-05 | MEDIUM | FIXED_MERGED | apps/web | Starting a second signed audit export while the first export's status poll is still in fli | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-06 | MEDIUM | FIXED_MERGED | apps/web | On the DAK inward register and the dispatch register, clicking Load more and then typing a | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-07 | MEDIUM | FIXED_MERGED | apps/web | When a search term changes while the previous load is still in flight, the loading flag tu | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-08 | MEDIUM | FIXED_MERGED | apps/web | If an autosave of the Phase 3 block fails (footer shows Offline), the edit is dropped perm | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-09 | MEDIUM | FIXED_MERGED | apps/web | When the notification template list request answers non-OK (for example 503), persistNotif | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-10 | MEDIUM | FIXED_MERGED | apps/web | The Register DAK form has no in-flight guard. Double-clicking Register (or pressing Enter | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-11 | MEDIUM | FIXED_MERGED | apps/web | Even with the autosave loop fixed (CLOS3-S1-01), a genuine edit of a saved flat fee create | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S1-12 | LOW | FIXED_MERGED | apps/web | If an export has not finished after 120 seconds the safety timer silently stops polling. T | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S1-13 | LOW | FIXED_MERGED | apps/web | The CRM RTI detail server page waits for the detail request and only then starts the indep | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S1-14 | LOW | FIXED_MERGED | apps/web | The CRM service request detail server page waits for the detail request and only then star | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S1-15 | LOW | UNRESOLVED | apps/web | The Projects & AUC page awaits getAucProjects() and then getMakerChecker() one after the o | no PASS 2 FIXED record and not in the owner-approved list; the delta regression gate 20b (242/243 files) passed but a per-defect test mappin |
| CLOS3-S2-01 | MEDIUM | FIXED_MERGED | apps/web | Optimistic Mark-done rollback restores the whole steps array captured before the click (se | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S2-02 | MEDIUM | FIXED_MERGED | apps/web | After saving the QC maker-checker policy the component calls router.refresh(), but the ser | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S2-03 | MEDIUM | FIXED_MERGED | apps/web | Form navigates immediately to /hr/apar/{id} after POST /v1/hrms/apar. The route returns 20 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S2-04 | LOW | FIXED_MERGED | apps/web | Batch status polling fetch has no timeout or AbortSignal. The poll loop awaits Promise.all | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S2-05 | LOW | FIXED_MERGED | apps/web | Server page awaits getData() (line 52) then getEmployees() (line 62) in series though neit | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S2-06 | LOW | FIXED_MERGED | apps/web | Redirect is a bare setTimeout(router.push, 700) with no cleanup. If the user navigates els | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-01 | HIGH | FIXED_MERGED | apps/web | SYNC_ENABLED=false makes the whole effect that owns flushRequestQueue() a no-op, and flush | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S3-02 | MEDIUM | FIXED_MERGED | apps/web | run() can overlap with itself. clear() only cancels the pending timer, not a tick already | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-03 | MEDIUM | FIXED_MERGED | apps/web | flushRequestQueue() has no re-entrancy lock. The browser 'online' event, the SW CIVITASONE | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-04 | MEDIUM | FIXED_MERGED | apps/web | Retry classification: every 4xx (including 408 Request Timeout and 429 Too Many Requests) | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-05 | MEDIUM | FIXED_MERGED | apps/web | The replay fetch has no timeout or AbortSignal. A hung connection (captive portal, half-op | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S3-06 | MEDIUM | FIXED_MERGED | apps/web | resolveNamespace() caches the promise even when /api/auth/session fails transiently (netwo | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S3-07 | MEDIUM | FIXED_MERGED | apps/web | Module-level `inflight` caches the identity promise permanently, including the failure res | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-08 | MEDIUM | FIXED_MERGED | apps/web | In useOfflineResource, `await readCache()` sits outside any try. readCache -> run() -> ope | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-09 | MEDIUM | FIXED_MERGED | apps/web | State sync: after a successful live fetch, setData(mapped) and setSource('live') are appli | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-10 | LOW | FIXED_MERGED | apps/web | useSeededResource awaits writeCache (line 248) and readCache (line 252) with no try/catch. | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-11 | MEDIUM | FIXED_MERGED | apps/web | State sync: markAsRead() and markAllAsRead() update the UI optimistically and only revert | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-12 | MEDIUM | FIXED_MERGED | apps/web | Race: the 15s setInterval fires an async fetch with no overlap guard, AbortController or s | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-13 | MEDIUM | UNRESOLVED | apps/web | Race: load() is used directly as the effect (`useEffect(load,[id])`) with no cancel flag o | no PASS 2 FIXED record and not in the owner-approved list; the delta regression gate 20b (242/243 files) passed but a per-defect test mappin |
| CLOS3-S3-14 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-15 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-16 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-17 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-18 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-19 | MEDIUM | FIXED_MERGED | apps/web | Duplicate-submit window: after a successful POST the form calls setTimeout(router.push, 60 | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-20 | LOW | FIXED_MERGED | apps/web | Race: openPreset() fires fetchPreset(p).then(setPresetDiff) with no ordering guard. Openin | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-21 | LOW | FIXED_MERGED | apps/web | trackActivation() wraps `void fetch(...)` in try/catch, but the catch cannot see an async | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-22 | LOW | FIXED_MERGED | apps/web | State sync: when `enabled` flips to false (for example a bell switched to prop data) the e | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-23 | LOW | FIXED_MERGED | apps/web | useConfirmAction runs onSuccess() inside the same try as onConfirm. If onSuccess throws (a | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S3-24 | MEDIUM | FIXED_MERGED | apps/web | fetchJson() (used by every server-rendered loader) issues the upstream request with no tim | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-01 | HIGH | FIXED_MERGED | services/billing-service | einvoiceGenerate consumer: `if (!(await markProcessed(tx, msg.messageId))) return;` sits i | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-02 | HIGH | FIXED_MERGED | services/billing-service | einvoiceCancel consumer has the same fall-through. On a redelivered cancel message markPro | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-03 | MEDIUM | FIXED_MERGED | services/fire-service | issueNoc checks `findActiveByApplicationId` OUTSIDE and BEFORE the write transaction, then | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-04 | MEDIUM | FIXED_MERGED | services/contract-service | POST /v1/contract/approval-levels enforces MAX_APPROVAL_LEVELS and computes `ordinal = cou | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-05 | MEDIUM | FIXED_MERGED | services/catalogue-service | POST /v1/catalogue/products/:id/versions checks for an already-open draft/pending version | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-06 | MEDIUM | FIXED_MERGED | services/estab-service | fileOpenVolume (and fileOpenPart just below, ~line 520) compute next volume/part number wi | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-07 | MEDIUM | FIXED_MERGED | services/billing-service | All four NIC e-invoice calls (auth :64, generateIrn :118, cancelIrn :153, getIrnByDocDetai | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-08 | MEDIUM | FIXED_MERGED | services/document-service | pub() (line 11) and createDak/createNoting/submitApproval (lines 18, 33, 40) call `void qu | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-09 | MEDIUM | FIXED_MERGED | services/event-service | Human-facing reference numbers use randomInt(1,999999): event permits (permits/consumer.ts | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S4-10 | LOW | FIXED_MERGED | services/catalogue-service | loadPublishable() documents itself as batched with no N+1 (lines 88-91) but loops `for (co | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-11 | LOW | FIXED_MERGED | services/crm-service | assertProductsSelectable runs `await productRepo.isSelectable(tenantId, id)` once per line | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-12 | LOW | FIXED_MERGED | services/crm-service | emitLeadScoredEvent wraps `queue.publish(...)` (not awaited) in try/catch, which only catc | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-13 | LOW | FIXED_MERGED | services/admin-service | startBreakGlassSweeper swallows every sweep failure with `.catch(() => { /* logged by call | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S4-14 | LOW | FIXED_MERGED | services/audit-service | Overdue sweep compares dueDate (a calendar date) with now.toISOString().slice(0,10), i.e. | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-01 | HIGH | FIXED_MERGED | services/notification-service | createNotificationPublisher() builds a new ioredis client on every call and nothing ever q | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-02 | HIGH | FIXED_MERGED | services/loyalty-service | redeemPoints inserts the redemption row, but the return value of enrolmentRepo.adjustBalan | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-03 | HIGH | FIXED_MERGED | services/loyalty-service | accruePoints inserts the accrual ledger row, then calls adjustBalance and ignores a false | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-04 | HIGH | FIXED_MERGED | services/notification-service | sweepDueSchedules commits claimSchedule (status scheduled -> queued) in its own tx, then c | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-05 | MEDIUM | FIXED_MERGED | services/notification-service | sweepHeldNotifications marks the held row `released` in a committed tx, then publishes the | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-06 | HIGH | FIXED_MERGED | services/hrms-service | The write-side consumer cases for extend (__2), corrigendum (__1) and cancel (__3) do not | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-07 | HIGH | FIXED_MERGED | services/legal-service | tick() reads ecourts.cause_list_syncs through the plain tenant `db` with no tenant context | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-08 | MEDIUM | FIXED_MERGED | services/inspection-service | fetchInspectorLeave calls GET {HRMS}/v1/hrms/leave?employeeId=..., a route that does not e | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-09 | MEDIUM | FIXED_MERGED | services/helpdesk-service | verifyAsset calls GET {ASSET}/v1/assets/{id}, but asset-service serves the detail at /v1/a | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-10 | MEDIUM | FIXED_MERGED | services/gateway-service | getEnabled() has no single-flight and no invalidation generation. A fetch that started bef | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-11 | MEDIUM | FIXED_MERGED | services/gateway-service | The Redis quota incr() does INCR and then a separate EXPIRE only when val === 1. If the pr | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-12 | MEDIUM | FIXED_MERGED | services/identity-service | None of the ~17 Keycloak fetch() calls (admin token, findUser, create/update/deactivate/lo | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-13 | MEDIUM | FIXED_MERGED | services/inspection-service | processOverdueFindings reads the overdue candidate list, then later calls updateFindingSta | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-14 | MEDIUM | FIXED_MERGED | services/legal-service | downloadAndStoreOrder arms a 30s abort timer but clears it in `finally` right after fetch( | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-15 | MEDIUM | FIXED_MERGED | services/legal-service | tick() selects tracked matters with .limit(500) and no ORDER BY, so with more than 500 tra | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-16 | MEDIUM | FIXED_MERGED | services/notification-service | RedisStreamSubscriber leaks its ioredis connection on failure paths. If connect() or subsc | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-17 | MEDIUM | FIXED_MERGED | services/hrms-service | Cache invalidation gap: listJobOpenings is cached 60s under resource 'job_opening' (querie | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-18 | MEDIUM | FIXED_MERGED | services/hrms-service | Leave approvals, rejections, applications and cancellations invalidate 'leave_apps_emp' an | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-19 | LOW | FIXED_MERGED | services/hrms-service | Resource 'attendance' (cache.listOrLoad in attendance/queries.ts:76) is never invalidated | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-20 | MEDIUM | FIXED_MERGED | services/project-service | listFundReleaseSummaries runs one findSchemeById query per fund-release row (N+1, up to q. | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-21 | MEDIUM | FIXED_MERGED | services/project-service | runRagTick loads milestones with one transaction per project (N+1, up to 1000 projects eve | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S5-22 | LOW | FIXED_MERGED | services/project-service | The DPR list handler selects up to 200 DPRs and then runs one projectProjects query per ro | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-23 | LOW | FIXED_MERGED | services/hrms-service | The OCR_DRIVER=external path calls fetch(endpoint, ...) with no timeout. A hung OCR endpoi | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S5-24 | LOW | FIXED_MERGED | services/notification-service | sweepDomainAuthChecks selects enabled sending domains with .limit(100) and no ORDER BY, so | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-01 | HIGH | FIXED_MERGED | services/report-service | deliverToRecipients publishes NOTIFICATION_SEND with messageId `notify-${jobId}-${recipien | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-02 | HIGH | FIXED_MERGED | services/stock-service | The main entryCreate handler does a read-modify-write on stock_valuation_rates with the no | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-03 | HIGH | FIXED_MERGED | services/workflow-service | The timer sweeper claims a timer by committing fire_at=NULL (tx at line 326), then publish | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-04 | MEDIUM | FIXED_MERGED | services/tenant-service | quotaIncrement reads quota.used, computes Math.max(0, used+delta) in JS, and writes it bac | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-05 | MEDIUM | FIXED_MERGED | services/report-service | In the runScheduled handler, markProcessed and touchLastRunAt commit, and only then publis | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-06 | MEDIUM | FIXED_MERGED | services/report-service | tick() selects due reports, then publishes the render job, delivers notifications (with 1s | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-07 | MEDIUM | FIXED_MERGED | services/tenant-service | Upgrade, cancel, suspend, renew and the self-service cancel and downgrade handlers read th | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-08 | MEDIUM | FIXED_MERGED | packages/cache | RedisCache.incr runs INCR and then EXPIRE as two commands, with the EXPIRE only when value | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-09 | MEDIUM | FIXED_MERGED | services/visitor-service | checkRateLimit does redis.incr(key) and then redis.expire only when count===1. If the expi | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S6-10 | MEDIUM | FIXED_MERGED | packages/circuit-breaker | A call that started while the breaker was closed and completes successfully AFTER the brea | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-11 | MEDIUM | FIXED_MERGED | packages/cache | getOrLoad and getOrLoadWithNegative write the loader result after an await. invalidate(key | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-12 | MEDIUM | FIXED_MERGED | packages/db | When the tenant-service quota fetch fails (network error or non-2xx), fetchQuotaFromServic | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-13 | MEDIUM | FIXED_MERGED | packages/storage | The S3Client is built with no request or connection timeout. The AWS SDK v3 NodeHttpHandle | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-14 | LOW | FIXED_MERGED | packages/search | The private fetch wrapper calls globalThis.fetch with no AbortSignal or timeout. A hung Me | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S6-15 | MEDIUM | FIXED_MERGED | services/visitor-service | listVisitRequests has no LIMIT and, for every returned row, calls logPiiAccess sequentiall | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S6-16 | MEDIUM | FIXED_MERGED | services/visitor-service | listBlacklistEntries (line 106) and listWatchlistEntries (line 147) are unbounded and log | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |
| CLOS3-S6-17 | LOW | FIXED_MERGED | services/tenant-service | Deterministic business rejections (assertTransition, not found, cannot renew) throw a plai | fixed in Run 3 PASS 2, merged in #2227 (96e536cf9); the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is no |
| CLOS3-S6-18 | LOW | FIXED_MERGED | services/visitor-service | visitor-service creates about 10 independent module-level ioredis clients with plain new R | owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401); the delta regression gate 20b (242/243 files) passed but a per-defe |

<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Run 1 status update (as of this refresh)

All Run 1 FIXED PRs are now MERGED: #2154 (`76c8cada9def1be751025b3fed76ca2c36a5303b`), #2165 (`1ef24f6b3a4fbebea5c8bff365b18033b8539b2d`), #2169 (`6058ae9673ce77bcdf2c9346cb8e55d52ed6f486`), #2170 (`ade86e9b58b36e67ee46fa07c7f5c1be46e92511`), #2167 (`4302a45ff3b3d3d3710427430d2a59fabcf5131f`), in addition to #2155 and #2157. Run 1 BLOCKED/UNRESOLVED items: CLOS-CVE-NEXT closed (#2175); DELEG-REVOKE-OWNERSHIP closed (#2174); DELEG-UTC closed (#2181); CLOS-FLAKY-DRAINAGE closed (#2182); P3-BASE-1 closed (#2173); P3-NEW-1 closed (no `res.status` in the file on current main); P3-NEW-3 closed in source (`/api/v1/plugins` mocked in `global-setup.ts`); P3-NEW-2 payroll snapshots accepted as stale (owner decision); P3-NEW-4 closed because #2161 merged 2026-10-23 08:43Z; CLOS-S6-07 closed (`todayIST()` in `resolver.ts`). Still BLOCKED: CLOS-S1-17, S4-04, S4-05, S5-05, S6-02, S6-06 (verified still present in code). No Run 1 defect is promoted to VERIFIED by me; the verifier's spot-checks are listed in `release-readiness.md`.

### Run 2 registry (IDs `CLOS2-S<n>-NN`; 53 discovered; sources `run2-discover-*.json`, `run2-pass2-*.json`, `run2-blocked-approved.json`)

Counts by status: FIXED low-risk 42; owner-approved BLOCKED then FIXED 9; still BLOCKED 1 (CLOS2-S2-09); LOW with no PASS 2 record 1 (CLOS2-S1-14). Slice 4 produced no findings. Evidence per row is the fixer's before/after recorded in the `run2-pass2-*.json` file for that slice (see `autonomous-fixes.md`); the approved nine were additionally spot-checked by the verifier on `9d93535`.

| ID | Sev | Risk at discovery | File:line | Status | Regression test / note |
|---|---|---|---|---|---|
| CLOS2-S1-01 | Medium | LOW | `apps/web/src/app/(app)/admin/users/AdminUsersManager.tsx:115` | BLOCKED then owner-approved; FIXED in #2186 (via #2193) | see PR #2186 |
| CLOS2-S1-02 | Low | LOW | `apps/web/src/app/(app)/estab/files/[id]/FileAttachments.tsx:138` | FIXED in #2179 -> #2193 | FileAttachments.test.tsx (IST rollover) |
| CLOS2-S1-03 | Low | LOW | `apps/web/src/app/(app)/estab/library/issues/IssuesTable.tsx:49` | FIXED in #2179 -> #2193 | IssuesTable.test.tsx (20:30Z / 19:00Z / 20:00Z) |
| CLOS2-S1-04 | Low | LOW | `apps/web/src/app/(app)/estab/library/[id]/CurrentLoansCard.tsx:51` | FIXED in #2179 -> #2193 | CurrentLoansCard.test.tsx (due 19:00Z -> 05 Nov) |
| CLOS2-S1-05 | Low | LOW | `apps/web/src/app/(app)/estab/quarters/QuarterCreateForm.tsx:65` | FIXED in #2179 -> #2193 | QuarterCreateForm.test.tsx (3 reject cases, 0, and 450 posts 450) |
| CLOS2-S1-06 | Low | LOW | `apps/web/src/app/(app)/estab/quarters/[id]/ApplyAllotmentForm.tsx:43` | FIXED in #2179 -> #2193 | ApplyAllotmentForm.test.tsx (reject cases + 12 submits 12) |
| CLOS2-S1-07 | Medium | LOW | `apps/web/src/app/(app)/crm/contacts/new/page.tsx:42` | FIXED in #2179 -> #2193 | page.accountSearchError.test.tsx, EditContactForm.accountSearchError.test.tsx |
| CLOS2-S1-08 | Low | LOW | `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx:69` | FIXED in #2179 -> #2193 | DfaPanel.test.tsx (500 shows error; empty ok shows No matches) |
| CLOS2-S1-09 | Medium | LOW | `apps/web/src/app/(app)/designer/[id]/test/page.tsx:37` | FIXED in #2179 -> #2193 | designer/[id]/test/page.test.tsx (new) |
| CLOS2-S1-10 | Medium | LOW | `apps/web/src/app/(app)/designer/_data/designerApi.ts:171` | FIXED in #2179 -> #2193 | designerApi.test.ts (3 offline cases) |
| CLOS2-S1-11 | Low | LOW | `apps/web/src/app/(app)/contracts/[id]/ObligationsPanel.tsx:96` | FIXED in #2179 -> #2193 | BondActions.test.tsx, ObligationsPanel.test.tsx (offline) |
| CLOS2-S1-12 | Low | LOW | `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx:180` | FIXED in #2179 -> #2193 | AssetDetailActions.test.tsx (Tag offline) |
| CLOS2-S1-13 | Low | LOW | `apps/web/src/app/(app)/estab/files/[id]/FileDetailActions.tsx:132` | FIXED in #2179 -> #2193 | FileDetailActions.test.tsx (note offline) |
| CLOS2-S1-14 | Low | LOW | `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:118` | UNRESOLVED (LOW, no PASS 2 record) | see PR - |
| CLOS2-S1-15 | Low | LOW | `apps/web/src/app/(app)/citizen/rti/[id]/RTIDetailClient.tsx:94` | FIXED in #2179 -> #2193 | RTIDetailClient.test.tsx (load + appeal offline) |
| CLOS2-S1-16 | Low | LOW | `apps/web/src/app/(app)/crm/forecast/period.ts:39` | FIXED in #2179 -> #2193 | period.test.ts (3 boundary asserts) |
| CLOS2-S2-01 | Medium | LOW | `apps/web/src/app/(app)/hr/payroll/returns/page.tsx:101` | FIXED in #2177 (merged) | payroll/returns/page.istClock.test.tsx |
| CLOS2-S2-02 | Medium | LOW | `apps/web/src/app/(app)/hr/payroll/form16/page.tsx:37` | FIXED in #2177 (merged) | payroll/form16/page.istClock.test.tsx |
| CLOS2-S2-03 | Low | LOW | `apps/web/src/app/(app)/hr/payroll/statutory/challans/page.tsx:52` | FIXED in #2177 (merged) | payroll/statutory/challans/page.istClock.test.tsx |
| CLOS2-S2-04 | Low | LOW | `apps/web/src/app/(app)/hr/dashboard/page.tsx:87` | FIXED in #2177 (merged) | dashboard/payrollDaysLeft.test.ts |
| CLOS2-S2-05 | Low | LOW | `apps/web/src/app/(app)/hr/holidays/page.tsx:73` | FIXED in #2177 (merged) | holidays/page.istClock.test.tsx |
| CLOS2-S2-06 | Low | LOW | `apps/web/src/app/(app)/hr/_components/ShiftChangeRequestForm.tsx:236` | FIXED in #2177 (merged) | _components/ShiftChangeRequestForm.istClock.test.tsx |
| CLOS2-S2-07 | Low | LOW | `apps/web/src/app/(app)/hr/promotion/PromoteWithApproval.tsx:185` | FIXED in #2177 (merged) | promotion/PromoteWithApproval.istClock.test.tsx |
| CLOS2-S2-08 | Low | LOW | `apps/web/src/app/(app)/hr/transfer/_components/TransferListFilters.tsx:134` | FIXED in #2177 (merged) | transfer/_components/TransferListFilters.istClock.test.tsx |
| CLOS2-S2-09 | Medium | BLOCKED_FOR_APPROVAL | `apps/web/src/app/(app)/hr/leave-policies/LeavePoliciesClient.tsx:491` | BLOCKED (pending owner decision) | see PR - |
| CLOS2-S3-01 | High | BLOCKED_FOR_APPROVAL | `apps/web/src/app/_components/AskCivitasOnePanel.tsx:36` | BLOCKED then owner-approved; FIXED in #2186 (via #2193) | see PR #2186 |
| CLOS2-S3-02 | Medium | LOW | `apps/web/src/app/_components/DarkModeToggle.tsx:11` | FIXED in #2180 -> #2193 | DarkModeToggle.test.tsx (+2) |
| CLOS2-S3-03 | Medium | BLOCKED_FOR_APPROVAL | `apps/web/src/lib/api/browserClient.ts:20` | BLOCKED then owner-approved; FIXED in #2186 (via #2193) | see PR #2186 |
| CLOS2-S3-04 | Low | LOW | `apps/web/src/app/_components/ds/ActionButton.tsx:49` | FIXED in #2180 -> #2193 | ActionButton.test.tsx (+2), useAsyncMutation.test.ts (+2) |
| CLOS2-S3-05 | Low | LOW | `apps/web/src/app/(app)/procurement/vendors/[id]/VendorActions.tsx:79` | FIXED in #2180 -> #2193 | VendorActions.test.tsx (new) |
| CLOS2-S3-06 | Low | LOW | `apps/web/src/app/(app)/tenant-admin/users/UsersTable.tsx:268` | FIXED in #2180 -> #2193 | UsersTable.test.tsx (+1) |
| CLOS2-S3-07 | Low | LOW | `apps/web/src/app/(app)/works/masters/MasterCreateForm.tsx:330` | FIXED in #2180 -> #2193 | MasterCreateForm.test.tsx (+1) |
| CLOS2-S3-08 | Low | LOW | `apps/web/src/app/_components/AskCivitasOnePanel.tsx:33` | FIXED in #2180 -> #2193 | AskCivitasOnePanel.test.ts (new, 5) |
| CLOS2-S3-09 | Low | LOW | `apps/web/src/app/_components/NotificationBell.tsx:75` | FIXED in #2180 -> #2193 | NotificationBell.relativeTime.test.ts (3), loaders.formatTimeAgo.test.ts (3) |
| CLOS2-S3-10 | Low | LOW | `apps/web/src/app/(app)/telephony/calls/page.tsx:177` | FIXED in #2180 -> #2193 | TelephonyLiveSummary.test.tsx (TZ=UTC), istDisplayGuard.test.ts (9 files) |
| CLOS2-S3-11 | Medium | BLOCKED_FOR_APPROVAL | `apps/web/src/app/_data/apiMappers.ts:740` | BLOCKED then owner-approved; FIXED in #2187 (via #2193) | see PR #2187 |
| CLOS2-S3-12 | Low | LOW | `apps/web/src/lib/crm/crmExport.ts:38` | FIXED in #2180 -> #2193 | crmExport.test.ts (new) |
| CLOS2-S5-01 | Medium | LOW | `services/knowledge-service/src/modules/categories/routes.ts:23` | FIXED in #2176 (merged) | knowledge-service/tests/closure2-s5-01-uuid-params.test.ts |
| CLOS2-S5-02 | Medium | LOW | `services/knowledge-service/src/modules/versions/routes.ts:43` | FIXED in #2176 (merged) | knowledge-service/tests/closure2-s5-02-versions-uuid.test.ts |
| CLOS2-S5-03 | Medium | LOW | `services/notification-service/src/modules/dlt/routes.ts:52` | FIXED in #2176 (merged) | notification-service/tests/closure2-s5-03-uuid-params.test.ts |
| CLOS2-S6-01 | Medium | BLOCKED_FOR_APPROVAL | `packages/rate-limit/src/index.ts:21` | BLOCKED then owner-approved; FIXED in #2188 (via #2193) | see PR #2188 |
| CLOS2-S6-02 | Medium | BLOCKED_FOR_APPROVAL | `packages/numbering/src/format.ts:150` | BLOCKED then owner-approved; FIXED in #2187 (via #2193) | see PR #2187 |
| CLOS2-S6-03 | Low | LOW | `packages/circuit-breaker/src/index.ts:74` | FIXED in #2178 -> #2193 | packages/circuit-breaker/tests/circuit-breaker.test.ts (4 cases) |
| CLOS2-S6-04 | Medium | LOW | `packages/search/src/meilisearch.ts:152` | FIXED in #2178 -> #2193 | packages/search/tests/search.test.ts (12 cases: 401/500 reject, 202 resolves) |
| CLOS2-S6-05 | Low | LOW | `packages/search/src/opensearch.ts:120` | FIXED in #2178 -> #2193 | packages/search/tests/search.test.ts (2 cases) |
| CLOS2-S6-06 | Low | BLOCKED_FOR_APPROVAL | `packages/storage/src/index.ts:207` | BLOCKED then owner-approved; FIXED in #2188 (via #2193) | see PR #2188 |
| CLOS2-S6-07 | Medium | LOW | `packages/db/src/quota-check.ts:110` | FIXED in #2178 -> #2193 | packages/db/src/quota-check.test.ts (4 cases: {bad, {}, null, valid) |
| CLOS2-S6-08 | Medium | LOW | `services/visitor-service/src/modules/evacuation/roster.ts:221` | FIXED in #2178 -> #2193 | services/visitor-service/tests/evacuation-roster.test.ts |
| CLOS2-S6-09 | Low | LOW | `services/visitor-service/src/modules/turnstile-control/command-queue.ts:117` | FIXED in #2178 -> #2193 | services/visitor-service/tests/turnstile-command-queue-corrupt.test.ts (2 cases) |
| CLOS2-S6-10 | Medium | LOW | `services/telephony-service/src/shared/carrier-adapter.ts:101` | FIXED in #2178 -> #2193 | services/telephony-service/tests/carrier-adapter-timeout.test.ts (3 cases) |
| CLOS2-S6-11 | Low | LOW | `packages/client-core/src/pkce.ts:80` | FIXED in #2178 -> #2193 | packages/client-core/tests/pkce-fetch.test.ts (5 cases) |
| CLOS2-S6-12 | Medium | BLOCKED_FOR_APPROVAL | `packages/gov-adapters/src/pfms.ts:122` | BLOCKED then owner-approved; FIXED in #2188 (via #2193) | see PR #2188 |
| CLOS2-S6-13 | Medium | BLOCKED_FOR_APPROVAL | `services/revenue-service/src/modules/billing/consumer.ts:61` | BLOCKED then owner-approved; FIXED in #2187 (via #2193) | see PR #2187 |

### Newly found by the verifier / final checks (not previously registered)

- **FINAL-E2E-01 (High, app defect, UNRESOLVED):** duplicate `<h1 id="page-heading">` across `(app)/**/loading.tsx` and pages; 76 Playwright strict-mode violations. Source: verifier, CI E2E on `9d93535`.
- **FINAL-GATE-01 (High, UNRESOLVED):** Live Stack Verification "Contract score must be 10/10" fails; cause unknown.
- **FINAL-GATE-02 (High, UNRESOLVED):** Release Gate evidence audit, 11 gates UNMEASURED.
- **FINAL-TEST-01 (Low, UNRESOLVED):** workflow delegations-routes "returns empty list for a fresh tenant" non-idempotent.
- **FINAL-FLAKY-01 (Low, known-flaky):** CreateContractForm GAP-CONTRACTS-NEW-02 failed in CI on `9d93535`; passed locally.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Baseline: frozen SHA `f82d57053f55237ace2515c8b84398923f3df5f7`. Source of record: `~/orch-logs/closure/pass1-result.json` (PASS 1), `pass2-*.json` (PASS 2), `pass3-regression.json` (PASS 3). Release decision for this run is the PASS 4 verifier's: **FAIL**.

## Status vocabulary and how it was applied

- **FIXED**: a fix and a regression test exist in a PR branch (merged or open). Before/after test evidence was recorded by the fixing agent in PASS 2.
- **VERIFIED**: only where the PASS 4 verifier spot-checked the defect, or the fix was merged with green CI.
- **BLOCKED**: held for owner approval (higher risk than the brief allows to fix autonomously).
- **UNRESOLVED**: discovered and not fixed (no autonomous fix applied, or fix not integrated).

**No defect is marked VERIFIED.** Reasons (executed facts): (1) the PASS 4 verifier's only recorded defect spot-check is the raw-status-leak regression (#2166), which confirmed a regression and is not a CLOS fix; it ran regression tests for four unrelated test files plus `auditResource` and states it "did not run regression tests for 8 distinct FIXED defects" and that "the spot-check requirement is not met". (2) The two merged closure PRs (#2155, #2157) were merged while required CI jobs were red (listed per defect below); the red jobs are classified baseline/environmental in `regression-results.md`, but the CI was not green, so the "merged with green CI" condition is not met. Promoting any row to VERIFIED is an owner decision.

All 39 LOW fixes below were classified LOW risk by PASS 1 and fixed in PASS 2. PASS 4 did not re-read the per-defect diffs.

## Summary

| Status | Count | IDs |
|---|---|---|
| FIXED (merged to main, CI not fully green) | 14 | CLOS-S1-01..04 (#2155); CLOS-S1-13..16, CLOS-S2-01..06 (#2157) |
| FIXED (open PR, not merged) | 25 | CLOS-S1-05..12 (#2154); CLOS-S3-01..06 (#2165); CLOS-S4-01..03, CLOS-S5-02..04 (#2169); CLOS-S6-01,03,04,05,08 (#2170) |
| BLOCKED | 7 + 4 | CLOS-S1-17, S4-04, S4-05, S5-05, S6-02, S6-06, S6-07; CLOS-FLAKY-DRAINAGE, CLOS-CVE-NEXT, DELEG-REVOKE-OWNERSHIP, DELEG-UTC |
| UNRESOLVED | 5 | P3-NEW-1..4 and P3-BASE-1 (found by PASS 3, no fix applied) |
| Rejected in PASS 1 | 1 | CLOS-S5-01 (claimed bug not present on origin/main) |

(14 merged + 25 open = 39 confirmed-LOW fixes.)


## FIXED defects (executed evidence is the before/after test result recorded by the fixer)

### CLOS-S1-01 - Medium
- **Status:** FIXED (merged to main in #2155, merge commit `c1e2138071564240f9e9fa94f8987423836495f5`)
- **Severity / risk class:** Medium / LOW
- **File:** `apps/web/src/app/(app)/designer/_components/GovernanceLinkageBuilder.tsx:79`
- **Root cause:** Retry handlers never reset positionsFailed
- **Fix:** shared retryPositions sets rows+clears flag, flags on failure
- **Regression test:** `GovernanceLinkageBuilder.test.tsx successful Retry`
- **Evidence:** before: expected <p> to be null; after: pass (log: `~/orch-logs/closure/pass2-designer.json`; PR head `cfe916f76f6dc9bcf581310535d74061bcc7cde0`; CI at merge: 25 jobs pass; red: CVE / SCA Gate, Coverage Gate, E2E (Playwright))
- **Requirement:** GovernanceLinkageBuilder.test.tsx covers only the initial failure (line 53), not a successful retry

### CLOS-S1-02 - Medium
- **Status:** FIXED (merged to main in #2155, merge commit `c1e2138071564240f9e9fa94f8987423836495f5`)
- **Severity / risk class:** Medium / LOW
- **File:** `apps/web/src/app/(app)/designer/_data/workflowBuilderApi.ts:92`
- **Root cause:** fetchTenantPositions returned [] on !res.ok
- **Fix:** throw toHumanError('load') Error
- **Regression test:** `workflowBuilderApi.test.ts fetchTenantPositions`
- **Evidence:** before: expected [] to be an instance of Error; after: pass (log: `~/orch-logs/closure/pass2-designer.json`; PR head `cfe916f76f6dc9bcf581310535d74061bcc7cde0`; CI at merge: 25 jobs pass; red: CVE / SCA Gate, Coverage Gate, E2E (Playwright))
- **Requirement:** none; the component tests mock this function, so the non-OK path is untested

### CLOS-S1-03 - Low
- **Status:** FIXED (merged to main in #2155, merge commit `c1e2138071564240f9e9fa94f8987423836495f5`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/designer/_data/useDesignerWizard.ts:112`
- **Root cause:** raw TypeError message shown in load/submit catches
- **Fix:** isNetworkFailure -> toHumanError copy
- **Regression test:** `useDesignerWizard.test.ts offline cases`
- **Evidence:** before: 'Failed to fetch' shown; after: pass (log: `~/orch-logs/closure/pass2-designer.json`; PR head `cfe916f76f6dc9bcf581310535d74061bcc7cde0`; CI at merge: 25 jobs pass; red: CVE / SCA Gate, Coverage Gate, E2E (Playwright))
- **Requirement:** UX-003/UX-016 (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md)

### CLOS-S1-04 - Low
- **Status:** FIXED (merged to main in #2155, merge commit `c1e2138071564240f9e9fa94f8987423836495f5`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/designer/_components/EngineBindingBuilder.tsx:168`
- **Root cause:** raw TypeError message in preview catch
- **Fix:** isNetworkFailure -> toHumanError copy
- **Regression test:** `EngineBindingBuilder.test.tsx offline preview`
- **Evidence:** before: 'Failed to fetch' shown; after: pass (log: `~/orch-logs/closure/pass2-designer.json`; PR head `cfe916f76f6dc9bcf581310535d74061bcc7cde0`; CI at merge: 25 jobs pass; red: CVE / SCA Gate, Coverage Gate, E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-05 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/appeals/AppealPanel.tsx:87`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch'; search returned [] on !res.ok so a 401/500 looked like 'no results'
- **Fix:** catch narrows to UserFacingError else t('errorGeneric'); window-expired is now a UserFacingError so it survives; search throws on !res.ok so the picker shows its error state
- **Regression test:** `apps/web/src/app/(app)/citizen/appeals/AppealPanel.network.test.tsx`
- **Evidence:** before: 3 tests: 2 failed (offline filing showed raw text; search 500 rendered no alert); window-expired guard passed; after: 3/3 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** GAP-CITIZEN-APPEALS-04 (raw body never shown)

### CLOS-S1-06 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.tsx:109`
- **Root cause:** afterMutate polling re-armed setTimeout with no cleanup (keeps fetching after unmount; overlapping chains); catches rendered raw e.message
- **Fix:** timer id + AbortController refs, cleared on unmount and before a new chain; tick passes the signal and bails when aborted; catches narrow to UserFacingError else generic copy
- **Regression test:** `apps/web/src/app/(app)/citizen/requests/[id]/RequestDetailClient.network.test.tsx`
- **Evidence:** before: 3 tests all failed: raw 'Failed to fetch' at load and add-action; AssertionError expected 6 to be 2 (polling fetched 4 more times after unmount); after: 3/3 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** GAP-CITIZEN-REQUESTS-DETAIL-05

### CLOS-S1-07 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.tsx:87`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** 3 catches narrow to UserFacingError else the translated fallback; the two deliberate plain Errors (profileInvalid, consentRequired) became UserFacingError so they still show
- **Regression test:** `apps/web/src/app/(app)/citizen/discovery/DiscoveryPanel.network.test.tsx`
- **Evidence:** before: 2 tests failed (consent and run showed no translated fallback); after: 2/2 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-08 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/eligibility/EligibilityCheck.tsx:43`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** narrow the catch to `instanceof UserFacingError ? e.message : <translated fallback>`; invalidJson throw became UserFacingError
- **Regression test:** `apps/web/src/app/(app)/citizen/eligibility/EligibilityCheck.network.test.tsx`
- **Evidence:** before: 1 failed: evaluationFailed text not found; after: 1/1 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-09 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/certificates/CertificateVerify.tsx:42`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** narrow the catch to `instanceof UserFacingError ? e.message : <translated fallback>`
- **Regression test:** `apps/web/src/app/(app)/citizen/certificates/CertificateVerify.network.test.tsx`
- **Evidence:** before: 1 failed: verifyFailed text not found; after: 1/1 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-10 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/payments/PaymentPanel.tsx:144`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** narrow the catch to `instanceof UserFacingError ? e.message : <translated fallback>`
- **Regression test:** `apps/web/src/app/(app)/citizen/payments/PaymentPanel.network.test.tsx`
- **Evidence:** before: 1 failed: resolveError text not found; after: 1/1 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-11 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/requests/LogRequestButton.tsx:49`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** narrow the catch to `instanceof UserFacingError ? e.message : <translated fallback>`
- **Regression test:** `apps/web/src/app/(app)/citizen/requests/LogRequestButton.network.test.tsx`
- **Evidence:** before: 1 failed: fallback text not found; after: 1/1 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-12 - Low
- **Status:** FIXED (open PR #2154, head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/citizen/rti/RegisterRTIButton.tsx:76`
- **Root cause:** catch rendered e.message for any Error, so a network TypeError showed raw 'Failed to fetch' instead of the translated fallback
- **Fix:** narrow the catch to `instanceof UserFacingError ? e.message : <translated fallback>`
- **Regression test:** `apps/web/src/app/(app)/citizen/rti/RegisterRTIButton.network.test.tsx`
- **Evidence:** before: 1 failed: registerErrorFallback not found; after: 1/1 pass (log: `~/orch-logs/closure/pass2-citizen-web.json`; PR head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc`; CI: 19 pass; red: CVE / SCA Gate, Tests, 3x Trivy (finance, gateway, hrms), E2E (Playwright))
- **Requirement:** UX-003

### CLOS-S1-13 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx:54`
- **Root cause:** defaultRange() builds the default From/To dates with toISOString().slice(0,10), which is the UTC date. For an IST user between 00:00 and 05:30 IST the default 'To' is yesterday, and the 30-day 'From' is shifted the same way.
- **Fix:** default range via istDateKey; before: expected 2026-10-21 to be 2026-10-22
- **Regression test:** `apps/web/src/app/(app)/audit/exports/ExportConsole.closure.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** istDateLocaleGuard.test.ts convention (IST day keys via lib/formatters istDateKey)

### CLOS-S1-14 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx:137`
- **Root cause:** flash() starts an untracked window.setTimeout(() => setToast(null), 6000) on every call. A second toast shown before the first timer fires is dismissed early by that first timer, and the timer also runs after unmount.
- **Fix:** toast timer held in ref, cleared on re-arm and unmount
- **Regression test:** `apps/web/src/app/(app)/audit/exports/ExportConsole.closure.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** GAP-AUDIT-EXPORTS-05 fixed the same class for the poll safety timer (safetyRef)

### CLOS-S1-15 - Medium
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Medium / LOW
- **File:** `apps/web/src/app/(app)/crm/service-requests/new/page.tsx:187`
- **Root cause:** The derived due date is new Date(Date.now()+sla*3_600_000).toISOString().slice(0,10), the UTC calendar date of the target instant, and it is used as the date input value. For IST users the due date is one day early whenever the target instant falls between 18:30Z and 24:00Z (00:00-05:30 IST the next day).
- **Fix:** istDateKey(target); before: 2026-03-10 vs 2026-03-11
- **Regression test:** `apps/web/src/app/(app)/crm/service-requests/new/page.sla.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** crm/rti/rtiStatus.ts:48 already pins IST with IST_OFFSET_MS for the same reason

### CLOS-S1-16 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/admin/integrations/_components/IntegrationDrawer.tsx:286`
- **Root cause:** Lines 286, 379, 406 and 407 render timestamps with new Date(x).toLocaleString('en-IN') and no timeZone, so the time follows the browser zone instead of IST and an unparseable value prints 'Invalid Date'. istDateLocaleGuard.test.ts misses this because it only matches toLocaleString calls whose arguments contain date-option keys. The same escape exists in analytics/kpi/KpiTable.tsx:26, analytics/data-warehouse/DataWarehouseTable.tsx:26, analytics/ai-insights/AiInsightsTable.tsx:26, approvals/_components/ApprovalsTable.tsx:85 and crm/pipeline/_components/KanbanBoard.tsx:276.
- **Fix:** 9 sites in 6 files now formatIndianDateTime; global guard NOT extended (about 20 more same-class sites remain outside the listed scope, some in open-PR files)
- **Regression test:** `apps/web/src/lib/istDateTimeSites.test.ts; analytics/kpi/KpiTable.closure.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** SF-07b / apps/web/src/lib/istDateLocaleGuard.test.ts

### CLOS-S2-01 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/install/InstallStepActions.tsx:34`
- **Root cause:** Bare fetch() inside try. A network failure rejects with TypeError('Failed to fetch') and the catch renders e.message raw to the operator.
- **Fix:** useFormError.fromException
- **Regression test:** `apps/web/src/app/(app)/install/InstallStepActions.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** apps/web/docs/ERROR-MESSAGES.md (UX-020: raw text never shown)

### CLOS-S2-02 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.tsx:54`
- **Root cause:** ask() and escalate() use bare fetch(). A network failure TypeError('Failed to fetch'), or a SyntaxError from res.json() on a non-JSON 200, is shown raw via e.message at lines 54 and 79.
- **Fix:** 3 cases; fromException for ask and escalate
- **Regression test:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** apps/web/docs/ERROR-MESSAGES.md

### CLOS-S2-03 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/install/domainPackApi.ts:132`
- **Root cause:** activateDomainPackStage3 uses bare fetch() and throws a plain Error. DomainPackActivatePanel.tsx:84 renders e.message, so a network failure shows raw 'Failed to fetch'. A malformed 202 body shows the raw res.json() SyntaxError text.
- **Fix:** fetch and json errors mapped to catalogued copy
- **Regression test:** `apps/web/src/app/(app)/install/domainPackApi.test.ts`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** apps/web/docs/ERROR-MESSAGES.md

### CLOS-S2-04 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.tsx:147`
- **Root cause:** Loading-state race. When domain or status changes, the effect aborts the previous load and starts a new one, which calls setLoading(true). The aborted call's catch returns early but its finally still runs setLoading(false), so the spinner clears while the new request is in flight. The aborted call's second (summary) fetch is swallowed by .catch(()=>null), so it also calls setSummary(null) after abort.
- **Fix:** abort guards on setLoading and result application
- **Regression test:** `apps/web/src/app/(app)/locations/maps/_components/MonitoringMap.test.tsx`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))
- **Requirement:** none (no existing test for abort ordering)

### CLOS-S2-05 - Low
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/inventory/page.tsx:19`
- **Root cause:** buildForecastSeries labels forecast days with new Date().toISOString().slice(0,10), which is the UTC date. The server renders in UTC, so between 00:00 and 05:30 IST the first forecast date is yesterday in IST and every chart label shifts by one day. The same issue is already fixed elsewhere (knowledge/_data/recordDue.ts istDateKey, legal/hearings/HearingsTable.tsx GAP-LEGAL-HEARINGS-04, inspection/assignments/AssignmentActions.tsx:61).
- **Fix:** buildForecastSeries moved to hubStats.ts, IST labels
- **Regression test:** `apps/web/src/app/(app)/inventory/hubStats.test.ts`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))

### CLOS-S2-06 - Medium
- **Status:** FIXED (merged to main in #2157, merge commit `cdeb2b09ced7340623f6508936a744d99971c91f`)
- **Severity / risk class:** Medium / LOW
- **File:** `apps/web/src/app/(app)/grants/_data.ts:231`
- **Root cause:** A missing sanctionDate (and createdAt at line 334) is replaced by new Date().toISOString(). A grant or application with no date therefore renders today's date as if it were real data. municipal/_data/municipalApi.ts:99 does the same for transition-history createdAt.
- **Fix:** null instead of now; types widened to string|null; display renders em-dash
- **Regression test:** `apps/web/src/app/(app)/grants/_data.test.ts; municipal/_data/municipalApi.closure.test.ts`
- **Evidence:** test named above; no before/after text recorded for this item (log: `~/orch-logs/closure/pass2-web-modules.json`; PR head `fad0c5b2757d14ce3910f65f4261c385083590c8`; CI at merge: 22 jobs pass; red: CVE / SCA Gate, Tests, E2E (Playwright))

### CLOS-S3-01 - Low
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/lib/crm/quotation.ts:152`
- **Root cause:** isProductSelectable derived 'today' from the UTC date
- **Fix:** Use IST date (now+19800000ms), same convention as lib/retirement.ts
- **Regression test:** `apps/web/src/lib/crm/quotation.test.ts (IST day boundary)`
- **Evidence:** before: 2 new tests failed: expected false to be true / true to be false; after: quotation.test.ts passes (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** SF-07 IST today guard (lib/istTodayGuard.test.ts); no IST-boundary test for isProductSelectable

### CLOS-S3-02 - Low
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/(app)/tenant-admin/breakglass/page.tsx:22`
- **Root cause:** Server component compared local (UTC) year/month for 'This Month'
- **Fix:** Compare istDateKey(...).slice(0,7) of event vs now
- **Regression test:** `tenant-admin/breakglass/page.test.tsx (This Month uses IST month)`
- **Evidence:** before: expected '0' to be '1'; after: passes (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** none (formatters.breakglass.test.ts covers formatting only)

### CLOS-S3-03 - Medium
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `apps/web/src/app/(app)/procurement/tenders/new/CreateTenderForm.tsx:232`
- **Root cause:** 4 single-source / EMD-exemption controls had no accessible name
- **Fix:** aria-label on 2 inputs; label htmlFor + id on select; id+aria-label on textarea
- **Regression test:** `procurement/tenders/new/CreateTenderForm.test.tsx (CLOS-S3-03)`
- **Evidence:** before: Unable to find a label with the text of: EMD exemption reason; after: passes (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** WCAG 2.2 AA 1.3.1/4.1.2; GAP-PROCUREMENT-TENDERS-NEW-02/03

### CLOS-S3-04 - Low
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/lib/bulkScan/xhrPut.ts:16`
- **Root cause:** xhrPut ignored an already-aborted signal and never removed its abort listener
- **Fix:** Resolve {ok:false,status:0} before creating the XHR when aborted; {once:true} listener removed on load/error/abort
- **Regression test:** `apps/web/src/lib/bulkScan/xhrPut.test.ts (new)`
- **Evidence:** before: pre-aborted test timed out (upload ran); listener-removal assertion failed; after: 3/3 pass (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** none (no xhrPut pre-aborted test)

### CLOS-S3-05 - Low
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/_components/FileUpload.tsx:40`
- **Root cause:** Legacy FileUpload kept its simulated-progress interval in a handler local; never cleared on unmount/remove
- **Fix:** Hold interval in a ref; clear in remove(), on restart and in unmount cleanup
- **Regression test:** `app/_components/FileUpload.test.tsx (timer cleanup)`
- **Evidence:** before: onUpload called 1 time after unmount / after remove; after: passes (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S3-06 - Low
- **Status:** FIXED (open PR #2165, head `4e24678cb7f3e8c5580859accc9a71df8c39665a`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `apps/web/src/app/_components/DataSourceBadge.tsx:66`
- **Root cause:** Bare toLocaleString('en-IN') on cachedAt renders in the viewer's zone
- **Fix:** Use formatDateTimeIST in DataSourceBadge, WbsTree, EscalationsTable, deliveries/page
- **Regression test:** `app/_components/DataSourceBadge.test.tsx (IST)`
- **Evidence:** before: expected text content '3:30 pm IST' not found (UTC time rendered); after: passes (log: `~/orch-logs/closure/pass2-web-shared.json`; PR head `4e24678cb7f3e8c5580859accc9a71df8c39665a`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** SF-07b istDateLocaleGuard

### CLOS-S4-01 - Medium
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `services/document-service/src/modules/folders/routes.ts:30`
- **Root cause:** document-service folders routes cast req.params as {id:string}; folders.id is uuid so a malformed id hit PG 22P02 (500 retryable) on GET, and was accepted (202) then failed async on the CQRS PATCH routes. Plugin has no local error handler and app-level one is registered after it, so a thrown ZodError would also 500.
- **Fix:** folders/routes.ts: parseFolderId() uuid-validates :id on all 4 routes and replies 400 VALIDATION_FAILED directly (same envelope as files/routes.ts). files/routes.ts left alone (#2147 area).
- **Regression test:** `document-service/tests/closure-s4-01-folder-id-uuid.test.ts`
- **Evidence:** before: 4 failed: GET /folders/not-a-uuid expected 400 got 500; PATCH rename/move expected 400 got 202; after: 5/5 pass; comp-007-folders-smoke still passes; full suite 406 passed/11 skipped (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S4-02 - Medium
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `services/contract-service/src/modules/templates/routes.ts:163`
- **Root cause:** templates render handler JSON.parse()d ?metadata with no guard: '{bad' -> SyntaxError 500; 5/null/[1]/'str' flowed into renderTemplateClauses (200).
- **Fix:** templates/routes.ts render handler only: try/catch + plain-object check, reply 400 INVALID_METADATA in flat sibling envelope (HttpError not used: plugin has no handler so it would 500). No plugin-wide handler added.
- **Regression test:** `contract-service/tests/closure-s4-02-render-metadata.test.ts`
- **Evidence:** before: 5 failed: '{bad' expected 400 got 500; 5/null/[1]/'str' expected 400 got 200; after: 7/7 pass; routes-templates-versions passes; full suite 484 passed (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S4-03 - Low
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `services/court-service/src/modules/case-registry/routes.ts:59`
- **Root cause:** case-registry overdue/analytics validated dates by regex only (2026-13-45 and 2026-02-30 reached PG -> 500) and defaulted to the UTC date (a day behind IST 00:00-05:30).
- **Fix:** routes.ts: isRealIsoDate() (round-trip calendar check) + istToday() (Intl en-CA, Asia/Kolkata); invalid values fall back to the default (no contract change); applied to asOf and analytics from/to.
- **Regression test:** `court-service/tests/closure-s4-03-overdue-asof.test.ts`
- **Evidence:** before: 4 failed: asOf=2026-13-45 and 2026-02-30 expected 200 got 500; default at 20:30Z expected 2026-10-23 got 2026-10-22; analytics 500; after: 5/5 pass; overdue.e2e/analytics.e2e/case-registry pass; full suite 696 passed/66 skipped (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S5-02 - Low
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `services/hrms-service/src/modules/social/routes.ts:289`
- **Root cause:** kudos/feed and social/feed parsed limit with bare Number(): abc->NaN (SQL LIMIT 22P02 -> 500; combined feed slice(0,NaN) -> empty), -5 -> SQL error / slice drops last 5.
- **Fix:** New hrms shared/clamp-limit.ts clampLimit(raw,fallback,max); used at both sites (50/100 and 30/50). Non-numeric or <1 falls back to default.
- **Regression test:** `hrms-service/tests/closure-s5-02-03-limit-params.test.ts`
- **Evidence:** before: kudos/feed limit=abc/-5/NaN expected 200 got 500; social/feed abc expected 8 items got 0, -5 got 3; limit=0 got 0; after: all pass; full suite 6916 passed/9 skipped (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S5-03 - Low
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `services/hrms-service/src/modules/recruitment/jd-template-routes.ts:21`
- **Root cause:** jd-templates list: Math.min(200,Number(q.limit)) gives negative for -1 -> PG 'LIMIT must not be negative' 500 (abc/NaN/0 already tolerated by drizzle). Verifier's second site recruitment/routes.ts:98-99 is NOT reachable with negatives: talentPoolQuerySchema already enforces /^\d+$/ on limit/offset, so no change made there.
- **Fix:** jd-template-routes.ts uses clampLimit(q.limit,100,200).
- **Regression test:** `hrms-service/tests/closure-s5-02-03-limit-params.test.ts (jd-templates block)`
- **Evidence:** before: limit=-1 expected 200 got 500 (PG 2201W); after: all pass; jd-template unit+integration pass (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** jd-template-repo.test.ts covers the repo limit, not route parsing

### CLOS-S5-04 - Low
- **Status:** FIXED (open PR #2169, head `3121310c8c313b754399eb8ec638d3f8c223fd9f`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `services/legal-service/src/cron/hearing-reminders.ts:68`
- **Root cause:** legal hearing-reminder cron discarded its setTimeout and the setInterval created inside it: no handle, never cleared, not unref'd.
- **Fix:** startHearingReminderCron() now returns stop() (clears both timers, idempotent), both timers unref'd, stop wired into index.ts graceful-shutdown cleanup before app.close. run() untouched.
- **Regression test:** `legal-service/tests/closure-s5-04-hearing-reminder-stop.test.ts`
- **Evidence:** before: 4 failed: TypeError stop is not a function; after: 4/4 pass; full suite 383 passed/3 skipped (log: `~/orch-logs/closure/pass2-services-a.json`; PR head `3121310c8c313b754399eb8ec638d3f8c223fd9f`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S6-01 - Medium
- **Status:** FIXED (open PR #2170, head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `services/revenue-service/src/modules/arrears/routes.ts:21`
- **Root cause:** Seven revenue-service module error handlers (analytics:37, arrears:21, bbps:15, billing:12, collection:21, rate-engine:17, trade-license:24) end with a bare 500 INTERNAL and never log the error. Unexpected exceptions are swallowed with no trace. Fastify-native 4xx (malformed JSON, 413, 415, 429), which are neither ZodError nor HttpError, also become 500 INTERNAL.
- **Fix:** see PR #2170 (PASS 1 proposed: In each handler use req (not _req) and call req.log.error({err:error}, 'unhandled error') before the 500; return error.statusCode when it is a 4xx number. Keep the envelope shape.)
- **Regression test:** `services/revenue-service/tests/closure-s6-01-error-handlers.test.ts`
- **Evidence:** before: 8 failed (500 vs 400; log spy not called); after: 8 passed; revenue suite 645/645 (log: `~/orch-logs/closure/pass2-services-b.json`; PR head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`; CI: 19 pass; same 6 red jobs as #2154)
- **Requirement:** none found; add a regression test in services/revenue-service/tests/*-routes.test.ts

### CLOS-S6-03 - Medium
- **Status:** FIXED (open PR #2170, head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `services/revenue-service/src/modules/rate-engine/routes.ts:91`
- **Root cause:** GET rate-slabs, penalty-rules and rebate-rules read rateHeadId through an unvalidated cast and only check presence. The column is uuid (schema.ts:33,53,71), so a non-uuid value hits Postgres 22P02 and returns 500 instead of 400. Lines 106 and 121 have the same defect.
- **Fix:** see PR #2170 (PASS 1 proposed: Parse the query with z.object({rateHeadId: z.string().uuid()}), as works-service tender/routes.ts:39 does with idParamSchema.)
- **Regression test:** `services/revenue-service/tests/closure-s6-03-rate-head-id.test.ts`
- **Evidence:** before: 3 failed (expected 200 to be 400); after: 6 passed (log: `~/orch-logs/closure/pass2-services-b.json`; PR head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S6-04 - Medium
- **Status:** FIXED (open PR #2170, head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`, not merged)
- **Severity / risk class:** Medium / LOW
- **File:** `services/works-service/src/modules/execution/routes.ts:110`
- **Root cause:** Path params workId (execution/routes.ts:110,119) and tenderId (tender/routes.ts:49) are cast without validation and passed to uuid columns. Non-uuid input gives a DB 22P02 and a 500 retryable:true instead of 400. The sibling route tender/routes.ts:39 already validates with v.idParamSchema.parse.
- **Fix:** see PR #2170 (PASS 1 proposed: Add v.idParamSchema.parse({id: workId}) or the tenderId equivalent in these three handlers, matching tender/routes.ts:39.)
- **Regression test:** `services/works-service/tests/closure-s6-04-uuid-params.test.ts`
- **Evidence:** before: 3 failed (expected 200 to be 400); after: 6 passed; works suite 643/643 (log: `~/orch-logs/closure/pass2-services-b.json`; PR head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S6-05 - Low
- **Status:** FIXED (open PR #2170, head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `packages/outbox/src/index.ts:559`
- **Root cause:** startOutboxPurge wraps its cycle in try {...} catch { /* swallow */ }. A persistent purge failure is never logged or counted, so the outbox grows silently. opts.logger is available but unused in the catch.
- **Fix:** see PR #2170 (PASS 1 proposed: catch (err) { logger?.warn({ err }, 'outbox purge cycle failed'); } and keep it non-throwing.)
- **Regression test:** `packages/outbox/tests/closure-s6-05-purge-failure-log.test.ts`
- **Evidence:** before: warn called 0 times; after: outbox suite 58 passed (log: `~/orch-logs/closure/pass2-services-b.json`; PR head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`; CI: 19 pass; same 6 red jobs as #2154)

### CLOS-S6-08 - Low
- **Status:** FIXED (open PR #2170, head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`, not merged)
- **Severity / risk class:** Low / LOW
- **File:** `packages/schemas/src/http.ts:41`
- **Root cause:** createFastifyErrorHandler and isHttpError, the shared error envelope used by every domain service via registerSchemaErrorHandler, have no unit test in packages/schemas. The Zod, SyntaxError, HttpError, statusCode normalisation and 500 fallthrough branches are unguarded.
- **Fix:** see PR #2170 (PASS 1 proposed: Add packages/schemas/tests/http-error-handler.test.ts covering each branch.)
- **Regression test:** `packages/schemas/tests/http-error-handler.test.ts`
- **Evidence:** before: no test existed; mutation of MALFORMED_BODY code makes it fail; after: 16 passed (log: `~/orch-logs/closure/pass2-services-b.json`; PR head `ee978a6f314a56eadf01250b6b046fbfbb28aa27`; CI: 19 pass; same 6 red jobs as #2154)

## Notes on specific FIXED items (analysis)

- CLOS-S1-16: nine sites in six files fixed; the global guard was NOT extended and about 20 more same-class (bare locale date/time) sites remain outside the listed scope, some in open-PR files (fixer note, `pass2-web-modules.json`).
- CLOS-S1-02, S1-06, S4-01, S4-02, S6-01, S6-04, S5-04 change observable behaviour on error/malformed-input paths (for example 202 to 400 on a malformed folder id, 200 to 400 on malformed works UUID params, polling/timer teardown). PASS 1 classified them LOW; PASS 4 did not re-check them against the brief's 'no API contract change' criterion. Treat as a reviewer item before merge.
- CLOS-S5-03: the verifier-suggested second site `recruitment/routes.ts:98-99` was found unreachable with negatives (schema enforces digits) so no change was made there.

## BLOCKED (held for owner approval; not fixed)

### CLOS-S1-17 - Medium
- **Status:** BLOCKED
- **Severity:** Medium
- **File:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx:44`
- **Root cause / observed:** The export range is sent as UTC boundaries: isoStart(d) is `${d}T00:00:00.000Z` and isoEnd(d) is `${d}T23:59:59.999Z`, while the officer picks IST calendar dates. Audit events from 00:00 to 05:30 IST on the From date are excluded, and events up to 05:30 IST the next day are included. This changes which audit records a signed export contains, so it is an audit/evidence-scope decision and not an autonomous display fix.
- **Proposed fix (not applied):** Owner decision needed: interpret From/To as IST day boundaries (+05:30) and document that on the form.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S4-04 - Medium
- **Status:** BLOCKED
- **Severity:** Medium
- **File:** `services/billing-service/src/modules/payments/razorpay.ts:90`
- **Root cause / observed:** createOrder and fetchPayment call fetch() with no AbortSignal or timeout, unlike every adapter in modules/gateways. A stalled Razorpay connection holds the checkout request open indefinitely. Non-ok upstream bodies are embedded in the thrown Error message (lines 101, 118), which is masked only by the route's generic 500 handler.
- **Proposed fix (not applied):** Add signal: AbortSignal.timeout(...) on both calls and map the abort to a 504 HttpError. This touches the payment path, so it is held for approval.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S4-05 - High
- **Status:** BLOCKED
- **Severity:** High
- **File:** `services/finance-service/src/modules/simplified/commands.ts:45`
- **Root cause / observed:** Defaults for postingDate, effectiveFrom, asOf, valueDate and paymentDate use new Date().toISOString().slice(0,10), the UTC date, at about 30 finance sites (treasury/consumer.ts:42,103,206; payments/consumer.ts:130,532,577; gl/consumer.ts:387,634,717; revenue-billing/consumer.ts; budget/*; bank-file-generator.ts:87,169; pfms/release.ts:136; integrations/consumer.ts:127,300). Between 00:00 and 05:30 IST a defaulted posting or value date is the previous Indian calendar day, which can land in a closed period or the previous financial year around 1 April.
- **Proposed fix (not applied):** Use one shared IST-today helper (asset-service/src/shared/dates.ts already has one) at these sites. It affects posting periods, so it is held for owner approval.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S5-05 - Medium
- **Status:** BLOCKED
- **Severity:** Medium
- **File:** `services/hrms-service/src/modules/seniority/routes.ts:126`
- **Root cause / observed:** The date-only default for asOf uses new Date().toISOString().slice(0,10), the UTC date, which is yesterday between 00:00 and 05:30 IST. hrms-service/src/shared/ist.ts todayIST() exists and documents this bug. Other UTC-today sites: seniority/routes.ts:147,199; workforce-core/holds/queries.ts:77; scheduler/tick.ts:99; social/pulse-routes.ts:255,315. Seniority and hold as-of are business rules.
- **Proposed fix (not applied):** Replace with todayIST() at the listed sites after the owner confirms the rule semantics.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S6-02 - Low
- **Status:** BLOCKED (PASS 1 recorded `risk: LOW` but listed it under blockedForApproval; treated as BLOCKED because the proposed fix changes the 400 response body shape on 7 routes, an API-contract change)
- **Severity:** Low
- **File:** `services/revenue-service/src/modules/arrears/routes.ts:23`
- **Root cause / observed:** The 400 validation response puts ZodError.message, a raw JSON dump of the issues array, in error.message, which is shown to the user. Same in analytics:39, bbps:17, billing:14, collection:23, rate-engine:19, trade-license:26.
- **Proposed fix (not applied):** Use message 'invalid request' and carry the issues (path and message) in a separate field; the envelope stays { error: { code, message } }.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S6-06 - Medium
- **Status:** BLOCKED
- **Severity:** Medium
- **File:** `services/revenue-service/src/modules/bbps/consumer.ts:26`
- **Root cause / observed:** Business dates use new Date().toISOString().slice(0,10), the UTC date, which is the previous day between 00:00 and 05:30 IST. Affected: revenue bbps/consumer.ts:26 (bill date), assessment/consumer.ts:63,219 (demand and due date), analytics/routes.ts:94,156 (arrears-aging as-of), stock-service entry/consumer.ts:178 (postingDate), sewerage connections/consumer.ts:132 (activationDate), works execution/consumer.ts:347 (acquisitionDate), workflow authority/routes.ts:79 (onDate).
- **Proposed fix (not applied):** Add a shared IST date helper (Intl timeZone Asia/Kolkata) and use it for these dates. This changes demand, due and posting dates, so it needs approval.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-S6-07 - Medium
- **Status:** BLOCKED
- **Severity:** Medium
- **File:** `services/workflow-service/src/modules/assignment/resolver.ts:100`
- **Root cause / observed:** The substitute (delegate) lookup uses the UTC date as 'today'. Between 00:00 and 05:30 IST a substitution that starts today is not active yet and one that ended yesterday is still active, so tasks go to the wrong person. shared/calendar.ts:33 (ymdUTC), used for SLA working days, has the same UTC basis.
- **Proposed fix (not applied):** Compute today in Asia/Kolkata (or the tenant timezone) for substitution and calendar checks.
- **Test:** none written (not fixed)
- **Evidence:** PASS 1 discovery record, `~/orch-logs/closure/pass1-result.json` (blockedForApproval)

### CLOS-FLAKY-DRAINAGE - Medium
- **Status:** BLOCKED
- **File:** drainage-service hotspot code generation (hotspotCode `DRNH-Date.now()-randomInt(1000,9999)`; complaintNumber uses the same scheme). Exact file path was not recorded in the sources I was given.
- **Root cause:** codes collide under concurrency; the UNIQUE-violation retry reuses the same payload, so an accepted (202) hotspot can be silently lost.
- **Proposed fix:** needs a DB sequence (schema change) or a new identifier format. Not applied.
- **Test:** existing test 'hotspot code generation no collisions under concurrency' (0/20 failures alone).
- **Evidence:** `pass2-flaky.json`: duplicate codes in 9/300 rounds of 50; full flow lost an accepted hotspot in 5/250 rounds. PR #2167 (open) documents it. `deferred-approval.md`.

### CLOS-CVE-NEXT - High
- **Status:** BLOCKED
- **Root cause:** CVE-2026-94482, a Next.js App Router DoS; fails the Trivy container scans (finance, gateway, hrms) and CVE / SCA Gate on every PR. PASS 3 also records next CRITICAL GHSA-2464-fhr4-w9xw and HIGH GHSA-p3m5-59mp-jv5r failing CVE / SCA on main.
- **Fix:** Next.js upgrade (dependency change, excluded by the brief). Not applied.
- **Evidence:** CI jobs on #2171 (run 39875490594 / security run 39875490486) and on main run 39872889243.

### DELEG-REVOKE-OWNERSHIP - High
- **Status:** BLOCKED
- **File:** workflow-service delegations routes (`DELETE /v1/workflow/delegations/:id`, `GET /v1/workflow/delegations`).
- **Root cause:** no ownership check; any workflow_user can revoke any delegation and list every delegation in the tenant.
- **Proposed fix:** revoke = delegator or admin; list = own unless admin; add ?mine / delegateId filters. Not applied (authZ change).
- **Evidence:** reported by the #2163 builder, `deferred-approval.md`.

### DELEG-UTC - Medium
- **Status:** BLOCKED (no approval decision recorded; severity per `deferred-approval.md`)
- **Root cause:** the service decides whether a delegation is active using UTC today(); should be IST. Self-delegation is blocked in the UI only, not in the service. Same class as CLOS-S6-07.
- **Evidence:** `deferred-approval.md` (#2163).

## Rejected in PASS 1

- CLOS-S5-01 (`scheduler.ts`): not a defect. On origin/main line 50 declares `const controller = new AbortController();`; the candidate's claim of a missing declaration was wrong; clearTimeout is called on success and error paths.

## UNRESOLVED (found by PASS 3 on the integration branch; labels below are local to this report, no CLOS id was assigned by the run)

### P3-NEW-1 - regression from #2166 (severity not rated in sources; it fails a mandatory CI job)
- **Status:** UNRESOLVED
- **File:** `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx:65` (commit `6f98bca86`, merge `a26d9efeb` on the integration branch).
- **Root cause:** thrown Error interpolates `res.status` (`verification-lane batch ${res.status}`); `scripts/ci/raw-status-leak-guard.mjs` reports 1 NEW violation. Guard passes on baseline.
- **Fix (suggested, not applied):** route through `useFormError`, or add the `status-leak-ok` suppression.
- **Test:** the guard itself. **Evidence:** local rc=1 (`p3/guard-raw-status-leak-guard.log`); CI Architecture Guard job 120159948660 red. Re-run and confirmed by the PASS 4 verifier at `cca1ae646` (the one verifier spot-check on record).

### P3-NEW-2 - E2E regression from #2159
- **Status:** UNRESOLVED
- **File:** `apps/web/e2e/hrms-payroll/payroll-runs.spec.ts:28` expects a /pending/ tile that #2159 replaced with Paid / In progress / Awaiting disbursement / Failed tiles; five visual-regression snapshots (Payroll Runs List, Run Detail paid and draft, Empty payroll, Run not found) not regenerated (page height 1129px to 1318px).
- **Evidence:** `p3/ci/e2e-p3.log`, `p3/ci/e2e-main.log` (passes on main run 39872889243).

### P3-NEW-3 - E2E regression from #2152
- **Status:** UNRESOLVED
- **File:** `apps/web/e2e/plugins.spec.ts` (3 tests); `apps/web/e2e/global-setup.ts` mocks only `/api/v1/plugins/items`, while `/plugins/installed` now reads `GET /api/v1/plugins`.
- **Evidence:** `p3/ci/e2e-p3.log`.

### P3-NEW-4 - integration conflict, #2161 excluded
- **Status:** UNRESOLVED
- **Root cause:** merge conflicts in `services/install-service/src/modules/stages/routes.ts`, `services/report-service/src/modules/jobs/consumer.ts`, `services/report-service/src/modules/jobs/routes.ts`, `services/report-service/src/modules/scheduled/repo.ts`. #2161 is not part of the integration, so its defects are not closed and not regression-tested.

### P3-BASE-1 - web test red on main (pre-existing, class a)
- **Status:** UNRESOLVED
- **File:** `apps/web/src/app/(app)/hr/audit-log/auditResource.test.ts` 'covers every resource type the services emit' (missing `medical_employee_record`); introduced by #2150 already in main. Red on origin/main and on the integration; makes the CI Tests job red.
- **Fix (suggested, not applied):** add `medical_employee_record` to `HR_AUDIT_RESOURCE_TYPES`.
- **Evidence:** `p3/vitest.log`, `p3/ci/tests-main.log`, `p3/ci/tests-p3.log`.

## Flaky-test work (PR #2167, `pass2-flaky.json`)

| Test | Status | Cause / note |
|---|---|---|
| CreatePOForm NEW-03 vendor search 500 Retry | FIXED | asserted synchronously before effect state; waitFor added (0/25 after; 0/60 before locally) |
| CustomFieldsManager rename / Required toggle (2 tests) | FIXED | product fix: stop leaked poll after unmount, plus regression test (12/45 and 2/45 before; 0/25 after) |
| Gov Rail NACH upstream error body not leaked | FIXED | random correlationId matched an Aadhaar-shaped scan (8/3000); id pinned |
| PromoteWithApproval failed employee search | FIXED | waitFor real condition |
| Selection lists page screened pool | FIXED | wait for editor |
| bulk assign unassigned report / bulk assign validates (2 tests) | FIXED | cascade of the late loser command in the concurrent test |
| membership two concurrent assignments exactly one wins | FIXED | wait until both commands wrote their audit event; not a product race |
| hotspot code generation no collisions | BLOCKED | see CLOS-FLAKY-DRAINAGE |
| trade-service restoreLicence notifies licensee | UNRESOLVED (NOT_REPRODUCED) | 0/39 runs failed; cause undetermined |
