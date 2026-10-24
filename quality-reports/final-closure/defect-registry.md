# Defect registry (CLOS-*)

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
