# Security findings

<!-- V4-CERT-BEGIN -->
## V4 certification refresh 2026-10-26 (frozen SHA `66b04aedd827b7e4fdcb402731d6d45a678badc8`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `66b04aedd827b7e4fdcb402731d6d45a678badc8` (66b04aedd, the squash of bundle #2280; bundles #2279 `e845c0401` and #2281 `400dbc822` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

### V4 security findings

#### Security defects fixed in V4 (executed evidence: regression lane PASS unless noted)

| Defect | Sev | Status | Title | Control |
|---|---|---|---|---|
| V4-A-01 | HIGH | VERIFIED | Service worker persists authenticated API data and personalised pages in Cache Storage and never clears them on logout | apps/web/src/lib/sync/logout.test.ts |
| V4-A-02 | HIGH | VERIFIED | CSP connect-src 'self' blocks every browser direct-to-storage presigned upload | apps/web/src/middlewareCspStorage.test.ts |
| V4-A-03 | MEDIUM | VERIFIED | BFF proxy path guard bypassed by encoded slash segments: request can escape /api prefix to arbitrary gateway paths with the user's bearer token | apps/web/src/app/api/careers/auth/tenantBinding.test.ts |
| V4-A-04 | LOW | VERIFIED | Auth middleware public-path allow-list uses bare prefix matching, so unrelated paths such as /contacts, /authz, /verifyx, /api/contactsX skip the sess | apps/web/src/middleware.test.ts |
| V4-B-01 | MEDIUM | VERIFIED | HRMS comp-off is an in-memory array with no ownership or approval: any employee can mint, list and redeem comp-off for anyone | services/hrms-service/src/__tests__/comp-off-persist-real-db.test.ts |
| V4-B-02 | HIGH | VERIFIED | Citizen document resubmit lacks ownership check: any citizen can supersede another citizen's deficient/rejected submission | services/citizen-service/src/modules/documents/ownership.test.ts |
| V4-B-03 | MEDIUM | VERIFIED | Billing payment-gateway webhooks (Razorpay, PayU, CCAvenue) are unreachable: not marked public so authPlugin returns 401 | services/billing-service/tests/v4-b03-webhooks-public.test.ts |
| V4-B-04 | MEDIUM | VERIFIED | Push subscription revoke has no ownership check: any citizen/employee can disable any user's push subscription | services/notification-service/tests/v4b04-push-revoke-ownership.test.ts |
| V4-B-06 | MEDIUM | VERIFIED | Advertisement and building permit public verification endpoints are unreachable anonymously (401) | services/advertisement-service/tests/v4-b06-permit-verify-public.test.ts |
| V4-B-07 | MEDIUM | VERIFIED | Helpdesk CES submission has no role or ownership check; first anonymous-ish caller poisons the score and blocks the real requester | services/helpdesk-service/tests/v4-b07-ces-requester.test.ts |
| V4-B-09 | LOW | VERIFIED | /v1/knowledge/ai/prompt is an unrestricted LLM proxy for every authenticated principal | services/knowledge-service/tests/v4-b-09-ai-prompt-hardening.test.ts |
| V4-B-10 | LOW | VERIFIED | queue-service ops endpoints marked public with presence-only auth | services/queue-service/tests/status.test.ts |
| V4-C-02 | MEDIUM | VERIFIED | Tenant A can fabricate a party row bound to tenant B case id (cross-tenant FK) and probe case-id existence | services/court-service/tests/commands-coverage.test.ts |
| V4-E-02 | HIGH | VERIFIED | GET /v1/citizen/requests returns every citizen's grievance summary tenant-wide to a bare citizen role | services/citizen-service/src/modules/grievance/requests-list-scope.test.ts |
| V4-E-03 | MEDIUM | VERIFIED | Auth tenant-header fallback and HS256 fallback keyed on NODE_ENV !== production deny-list | packages/auth/tests/v4-e-03-env-allowlist-call-sites.test.ts |
| V4-E-05 | MEDIUM | VERIFIED | Presigned upload URL does not enforce size limit or content-type | packages/storage/src/index.test.ts |
| V4-E-06 | MEDIUM | VERIFIED | ID-card QR HMAC falls back to hardcoded secret unless NODE_ENV is exactly production | services/hrms-service/src/modules/id-cards/qr-secret.security.test.ts |
| V4-E-07 | MEDIUM | VERIFIED | Citizen certificate seal key falls back to hardcoded literal with no production guard | services/citizen-service/src/modules/issuance/seal-key.test.ts |
| V4-G-01 | HIGH | VERIFIED | Public certificate QR verification is unreachable: gateway 401s anonymous callers and the service has no tenant context for its FORCE-RLS lookup | services/citizen-service/tests/v4g01-cert-verify-public.test.ts |
| V4-G-02 | HIGH | VERIFIED | Citizen-initiated payment intent computes the fee from caller-supplied subject, schedule and citizenId (self-service fee waiver / wrong amount booked) | services/citizen-service/src/modules/fee-payment/payment-intent-fee.test.ts |
| V4-G-03 | HIGH | VERIFIED | Legacy DigiLocker fetch marks any citizen-supplied docUri as verified/source_verified with the citizen as verifier, bypassing the PKCS#7 verification | services/citizen-service/src/modules/documents/digilocker-legacy-verify.test.ts |
| V4-G-05 | HIGH | VERIFIED | Audit hash chain cannot be re-verified: the timestamp bound into event_hash is never persisted, and payload is hashed pre-JSONB | services/audit-service/tests/v4-g-05-hash-chain-verifiable.test.ts |
| V4-G-06 | HIGH | VERIFIED | Citizen lifecycle notifications use the citizen profile UUID as the SMS/email/WhatsApp address; no recipient resolution exists in notification-service | services/citizen-service/src/modules/catalogue/notification-bindings.recipient.test.ts |
| V4-G-08 | HIGH | VERIFIED | Collected citizen fee is silently never posted to the GL when the revenue/bank head is missing: finance.gl.rejected has no citizen consumer and the ha | services/citizen-service/src/modules/fee-payment/gl-rejected.test.ts |

All of the above are merged in #2280/#2281. HIGH items: V4-A-01 (service-worker cache not purged on logout), V4-A-02 (CSP blocked presigned uploads, availability), V4-B-02 (citizen document ownership), V4-G-01..G-03, G-05, G-06, G-08, V4-E-02 (citizen requests list leaked all citizens). V4-E-03 and V4-E-05 are auth/contract boundary changes approved under "close all by tomorrow morning". Open security-relevant follow-ups from certification: V4-CERT-03 (RLS on new public directory tables), V4-CERT-10 (BYPASSRLS roles), V4-CERT-11 (plaintext PII), V4-CERT-17 (gitleaks), V4-CERT-15/16 (scanner alerts).

#### Dependency scan (gate 14, `node scripts/ci/cve-audit-gate.mjs`, exit 0, 2026-10-26T02:21:48Z to 02:24:57Z, log sha256 prefix d297a60c6819)

PASS_WITH_KNOWN: 0 unallow-listed CRITICAL/HIGH; 11 allow-listed exceptions. 10 expire **2026-11-08** (13 days after certification): fastify x5 (GHSA-jx2c-rxcm-jvmq, 667r-xxjv-c9mm, p68q-wchp-6fh7, hwr6-493r-vm6h, 9q9j-q6p8-xq58), drizzle-orm gpj5-g38j-94v9, find-my-way c96f-x56v-gq3h, extract-zip x2 (jmr9-qjv8-65gv, 7pqw-9j4j-h8q3), node-forge 86w9-cpqp-85rv. zod GHSA-mrhx-c7xc-m3w5 expires **2026-11-23** (28 days). Owner decisions: fastify/drizzle-orm/find-my-way major upgrades deferred until after the outstanding tasks; zod 3.x exception accepted (see `deferred-approval-items.md`). These exceptions are time-boxed: if the deferred upgrades are not done by 2026-11-08 the gate will fail.

#### Secret scanning

- Local: `scripts/ci/secret-scanner.mjs` exit 0 and the `ci.yml` secret-scan grep patterns clean (build lane, 2026-10-26T03:02:57Z to 03:03:03Z). gitleaks was not installed on the host (NOT_RUN locally).
- GitHub Security Scan run 40258410829, job Secret Scan (gitleaks-action): **FAILED**, 2 `generic-api-key` findings in the frozen-SHA commit (`services/queue-service/vitest.config.ts:10`, `services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32`; values redacted and not reproduced in these reports). Tracked as V4-CERT-17. The GitHub CI run's own Secret Scan job (grep patterns) succeeded.
- This certification's reports contain no secret literals (checked with the `ci.yml` patterns and `secret-scanner.mjs`, commands recorded in the evidence manifest).

#### Code scanning and container scanning

`gh api code-scanning/alerts?state=open&ref=refs/heads/main`: **2421 open alerts**, none from the frozen SHA (older SHAs `96e536cf9`, `e845c0401`): CodeQL 2 critical / 68 high / 14 medium / 34 warning / 1561 note; Trivy 3 critical / 177 high. High CodeQL rules include js/missing-rate-limiting, js/path-injection, js/request-forgery, js/insufficient-password-hash (gateway `api-key-auth.ts`), js/disabling-certificate-validation; Trivy findings are mostly image CVEs on hrms/finance/gateway, plus node-forge CVE-2026-85393 and uuid CVE-2026-41907 (evidence `cert/security-perf/codeql-all.json`). Not triaged: V4-CERT-15 (CRITICAL) and V4-CERT-16 (HIGH) are UNRESOLVED. The GitHub Security Scan jobs for the frozen SHA (CodeQL SAST, Trivy hrms/gateway/finance, CVE/SCA gate, Dependency Audit, ZAP DAST baseline) all completed success; a successful scan job is not the same as zero alerts.

#### Tenant isolation and data protection (tests not run by the ci.yml test job)

- `tests/data-integrity`: 7 failed / 19 passed. Roles `citizen_svc`, `legal_svc`, `telephony_svc` carry BYPASSRLS in the bootstrapped DB, which makes RLS inert for those services (V4-CERT-10, HIGH, cause not triaged: bootstrap-only or production-like is unknown). Plaintext PII at rest: `telephony.calls.caller_number/callee_number`, `citizen portal.citizen_profiles.mobile` (V4-CERT-11).
- `tests/security`: IDOR/RLS-GUC suite 3 failed on run 1 and 1 on rerun. Two of the first-run failures were 5000 ms timeouts on emulated PG; the deterministic failure is a stale sanity test (V4-CERT-09).
- `tenant-table-rls-guard` FAILS for `adv_permit_directory` and `building_permit_directory` (V4-CERT-03).

#### Accepted risk

Credentials present in git history (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password): owner decision "continue with the current credentials ,no change". ACCEPTED_RISK, not rotated. Residual risk: anyone with repo history access holds working non-production-looking credentials; rotating was explicitly declined.

#### Review limitation and disclosure

All 63 independent-review comments (on the 47 fix PRs, counted from the PR comments by `gh`) were posted from one GitHub account (`dbn1972`). One stray, failed `psql` probe to the shared dev Postgres occurred in the contract-e2e lane (nothing read).

<!-- V4-CERT-END -->

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

## CREDENTIAL ROTATION NOTICE (action required)

PR #2192 cleared the 71 secret-scanner findings **from the current tree only**; it does not remove them from git history. Per the #2193 PR body, the following **remain in git history and must be rotated**:

1. the Keycloak `admin-cli` client secret;
2. the `dev-superadmin` password;
3. the UAT demo password.

Rotation is an owner/ops action and has not been performed or verified by this run. Values are intentionally not reproduced here. History rewriting was not done.

## Security fixes in this closure (Run 2 and approved release blockers)

| Fix | Detail |
|---|---|
| CLOS2-S3-01 (High) | AI-assistant `renderMarkdown` link/attribute injection (quote in link target broke out of `href`). Fixed in #2186, conflict with #2180 hand-merged to keep a strict http(s) allow-list. Verifier probe: double quote, single quote, `javascript:` payloads give `#` or entity-escaped output. |
| CLOS2-S1-01 (Medium) | Admin role loader ignored `res.ok`, so a failed load stored an empty role set and the Save path could wipe roles. Fixed: load guard + Save disabled after failed load (#2186). Verifier: 17 tests pass. |
| CLOS2-S3-03 (Medium) | device-id header storage crash with blocked storage (#2186). |
| CLOS2-S6-01 (Medium) | rate-limit default key never contained tenant id, so tenants behind one gateway/NAT shared buckets; fixed (#2188). |
| CLOS2-S6-06, S6-12 | storage errors no longer swallowed as "not found"; gov-adapter (PFMS/GSTN/NIC e-way) fetch timeouts (#2188). |
| #2190 | 24 sql-injection-guard findings cleared by code changes; guard exits 0 in the final checks. |
| #2192 | 71 secret-scanner findings cleared without touching the scanner; guard exits 0 in the final checks (see rotation notice). |
| #2191, #2184 | money precision (bigint minor units) payroll and other services; money-precision guard exits 0 in the final checks. |
| #2175 | Next.js 15.5.28 for CVE-2026-94482, GHSA-p3m5-59mp-jv5r, GHSA-2464-fhr4-w9xw. Security Scan on `9d93535`: all 8 jobs success. |
| #2174 | workflow delegation revoke/list ownership scoping (DELEG-REVOKE-OWNERSHIP). |

## Security-relevant open items as of this refresh (analysis)

- The secrets above are still in git history (rotation pending).
- CLOS-S1-17 export range boundaries (audit-evidence scope), CLOS-S4-04 no timeout on the Razorpay payment calls, CLOS-S4-05 UTC posting dates in finance: pending owner decision (`deferred-approval-items.md`).
- Raw ZodError JSON is still returned to users in 7 revenue-service 400 responses (CLOS-S6-02, Run 1; low severity information exposure).
- workflow delegations test hermeticity is not a security defect but hides ownership-scoping regressions on reused DBs.
- Verifier classification: no new security defect was recorded by the verifier beyond the gates listed in `release-readiness.md`; I did not run an independent security scan in this refresh. CI Security Scan (CVE/SCA, dep audit, 3x Trivy, secret scan, ZAP, CodeQL) was success on `9d93535`.

## All PRs merged since 2026-10-22 (from `gh pr list --state merged --search "merged:>=2026-10-22"`, 38 PRs)

The "security-relevant" subset below was selected by a title keyword filter at refresh time (analysis, not a review of each diff); the full list follows it.

### Security-relevant by title (14)

| PR | Merged (UTC) | Title |
|---|---|---|
| #2140 | 2026-10-22 13:57Z | fix(citizen): gate sandbox payment confirmation; default apply flow to gateway |
| #2139 | 2026-10-22 14:51Z | fix(web): make main's web test suite green (41 pre-existing failures) |
| #2143 | 2026-10-22 15:25Z | fix(revenue): guard refund/write-off/waiver/remission decides; gate manual BBPS pay-bill |
| #2145 | 2026-10-22 19:09Z | fix(helpdesk,knowledge): internal-note leak, catalogue request exposure, ungated knowledge publish |
| #2150 | 2026-10-22 19:32Z | fix(hrms): assessment answer-key leak + manager direct-report scope for learning/competency reads |
| #2148 | 2026-10-22 20:15Z | fix(security): report/install/cdp access control (viewer read-only, per-user scoping, maker-checker, PII masking) |
| #2149 | 2026-10-22 20:43Z | fix(security): delegation role scope, AI own-scope, notification campaign read gate |
| #2160 | 2026-10-23 05:12Z | fix(revenue): DCB classification, waiver ledger + list, bill 409, instalment arrears, role gate |
| #2151 | 2026-10-23 05:12Z | fix(field,inspection): agent-scoped field reads; maker-checker on inspection finalize |
| #2174 | 2026-10-23 05:24Z | fix(workflow): delegation revoke/list ownership scoping (DELEG-REVOKE-OWNERSHIP) |
| #2156 | 2026-10-23 05:24Z | fix(audit,analytics,projects): observation shapes, ML hub loader, PM read roles |
| #2152 | 2026-10-23 05:25Z | fix(policy,visitor,plugins): soft-revoke grants, bound visitor config, wire Installed to registry |
| #2175 | 2026-10-23 10:31Z | fix(web): upgrade Next.js to 15.5.28 (CVE-2026-94482, GHSA-p3m5-59mp-jv5r, GHSA-2464-fhr4-w9xw) |
| #2147 | 2026-10-23 17:31Z | fix(documents): dak IDOR scoping + /api/proxy client paths |

### Full list

| PR | Merged (UTC) | Title |
|---|---|---|
| #2128 | 2026-10-22 04:59Z | fix(hr): close the 127 partial/open HR gaps found by the source rescan |
| #2131 | 2026-10-22 09:13Z | fix(w2): batch 16 bundle — #2119 #2129 |
| #2138 | 2026-10-22 12:53Z | fix(w2): batch 17 bundle — #2130 CRM rescan, #2116 |
| #2140 | 2026-10-22 13:57Z | fix(citizen): gate sandbox payment confirmation; default apply flow to gateway |
| #2139 | 2026-10-22 14:51Z | fix(web): make main's web test suite green (41 pre-existing failures) |
| #2144 | 2026-10-22 14:54Z | test(field-service): cover repos/consumers so Coverage Gate passes |
| #2143 | 2026-10-22 15:25Z | fix(revenue): guard refund/write-off/waiver/remission decides; gate manual BBPS pay-bill |
| #2146 | 2026-10-22 17:54Z | fix(legal): case detail cannot load any real case |
| #2145 | 2026-10-22 19:09Z | fix(helpdesk,knowledge): internal-note leak, catalogue request exposure, ungated knowledge publish |
| #2150 | 2026-10-22 19:32Z | fix(hrms): assessment answer-key leak + manager direct-report scope for learning/competency reads |
| #2148 | 2026-10-22 20:15Z | fix(security): report/install/cdp access control (viewer read-only, per-user scoping, maker-checker, PII masking) |
| #2149 | 2026-10-22 20:43Z | fix(security): delegation role scope, AI own-scope, notification campaign read gate |
| #2142 | 2026-10-22 21:19Z | feat(crm): 422 for contacts/activities on a merged or inactive account (F5) |
| #2155 | 2026-10-22 22:18Z | fix(closure): designer low-risk defects (CLOS-S1-01..) |
| #2157 | 2026-10-22 23:36Z | fix(closure): web-modules low-risk defects (CLOS-S1-13..) |
| #2160 | 2026-10-23 05:12Z | fix(revenue): DCB classification, waiver ledger + list, bill 409, instalment arrears, role gate |
| #2151 | 2026-10-23 05:12Z | fix(field,inspection): agent-scoped field reads; maker-checker on inspection finalize |
| #2153 | 2026-10-23 05:13Z | fix(helpdesk): web/service payload-shape mismatches, slaStatus 500, reports period filter |
| #2173 | 2026-10-23 05:23Z | fix(web): add medical_employee_record to HR audit resource types |
| #2174 | 2026-10-23 05:24Z | fix(workflow): delegation revoke/list ownership scoping (DELEG-REVOKE-OWNERSHIP) |
| #2154 | 2026-10-23 05:24Z | fix(closure): citizen-web low-risk defects (CLOS-S1-05..) |
| #2156 | 2026-10-23 05:24Z | fix(audit,analytics,projects): observation shapes, ML hub loader, PM read roles |
| #2170 | 2026-10-23 05:24Z | fix(closure): services-b low-risk defects (CLOS-S6-01..) |
| #2165 | 2026-10-23 05:25Z | fix(closure): web-shared low-risk defects (CLOS-S3-01..) |
| #2169 | 2026-10-23 05:25Z | fix(closure): services-a low-risk defects (CLOS-S4-01..) |
| #2152 | 2026-10-23 05:25Z | fix(policy,visitor,plugins): soft-revoke grants, bound visitor config, wire Installed to registry |
| #2164 | 2026-10-23 05:28Z | fix: citizen/grants/recruitment/notifications/designer correctness batch |
| #2167 | 2026-10-23 05:29Z | test: deflake 9 of 11 CI-flaky tests at the root cause (2 need decision) |
| #2158 | 2026-10-23 05:30Z | bundle: batch 18a — estab, works, HR issues (#1776/#1780) |
| #2166 | 2026-10-23 07:23Z | fix: inventory/assets/learning/workflow rescan findings |
| #2159 | 2026-10-23 07:50Z | bundle: batch 18b — procurement, finance, payroll rescans |
| #2161 | 2026-10-23 08:43Z | fix: install step lifecycle, report detail/schedules, attendance names, minutes rejection, server totals |
| #2163 | 2026-10-23 09:07Z | feat(web): workflow delegation management UI (my delegations + admin legacy report) |
| #2175 | 2026-10-23 10:31Z | fix(web): upgrade Next.js to 15.5.28 (CVE-2026-94482, GHSA-p3m5-59mp-jv5r, GHSA-2464-fhr4-w9xw) |
| #2177 | 2026-10-23 10:58Z | fix(closure2): slice 2 low-risk defects |
| #2176 | 2026-10-23 10:58Z | fix(closure2): slice 5 low-risk defects |
| #2193 | 2026-10-23 16:06Z | release: final bundle — closure run 2, owner-approved release blockers, E2E fixes |
| #2147 | 2026-10-23 17:31Z | fix(documents): dak IDOR scoping + /api/proxy client paths |

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Executed evidence is limited to merged PR metadata and the PR bodies (read from GitHub via `gh pr view` on EC2) plus CI/guard results from `regression-results.md`. Severity is quoted only where a PR body states it.

## Security fixes merged during the run (main)

| PR | Merge commit | Merged (UTC) | What it closed | Severity (per PR body) |
|---|---|---|---|---|
| #2140 `fix/citizen-sandbox-payment-gate` | `1824ec27278aa216d5c281fc8164dbc52737fa4c` | 2026-10-22T13:57 | Any citizen could confirm their own sandbox payment (no env gate), producing a receipt and GL entry; sandbox now gated by `CITIZEN_PAYMENTS_SANDBOX_ENABLED` and non-production, gateway-mode confirm requires officer roles; web defaults to gateway | not stated |
| #2143 `fix/revenue-decide-guards` | `f82d57053f55237ace2515c8b84398923f3df5f7` | 2026-10-22T15:25 | Refund/write-off decide had no status guard (double apply); self-approval returned 202; write-off approvals could exceed outstanding; refund DCB chained to wrong demand; manual BBPS pay-bill booked real receipts from caller-supplied ids (now gated, 403 BBPS_PAYBILL_DISABLED) | not stated |
| #2145 `fix/helpdesk-knowledge-access` | `4aefe3b175cfff3a121a62133369ca0c442f814f` | 2026-10-22T19:09 | Helpdesk internal notes reached citizens (migration 0038 `is_internal`); catalogue requests list/breaches scoping; knowledge publish needed `knowledge_admin`, maker-checker, and audit row | not stated |
| #2146 `fix/legal-case-detail` | `58b773516bc71348e537b586e8cd09b1fd1495b5` | 2026-10-22T17:54 | Primarily a functional fix; also added an app-layer tenant predicate on `findCaseById`, dropped foreign cached rows, and moved the dashboard onto a tenant transaction (bare `db.select()` carried no RLS GUC) | not stated |
| #2148 `fix/reports-install-cdp-access` | `37483bf0e370f8d1fe0546f8b7538ab65a4a85e0` | 2026-10-22T20:15 | report_viewer removed from write roles; per-user report scoping; install_user made read-only; cdp steward maker-checker (409 MAKER_CHECKER); server-side PII masking for non-admin roles | not stated |
| #2149 `fix/workflow-delegation-ai-notif-scope` | `cf4c8e873dd3961ddc970a730354cad2b219a1ec` | 2026-10-22T20:43 | Workflow role-gate bypass via delegation (migration 0046 `roles text[]`, 403 DELEGATION_ROLE_NOT_HELD); ai-agent-service per-user scope; notification campaign read gate | HIGH / MEDIUM / LOW-MED |
| #2150 `fix/hrms-assessment-learning-scope` | `8de4164bdfd72375e5d8ddb527b3f8e209f039f3` | 2026-10-22T19:32 | Assessment answer-key leak (`correct` returned to any role); manager direct-report scope for learning/competency reads; audit of cross-employee reads | HIGH / MEDIUM |

Other merged closure-period PRs touching access paths but not primarily security: #2127 (visitor owner decisions: employee gate access, config.changed audit), #2142 (CRM 422 for merged/inactive accounts). I did not read their bodies for this report; not claimed as security fixes.

Side effect to know: #2150 changed three existing tests that asserted the leaky behaviour, and introduced the red `auditResource.test.ts` (missing `medical_employee_record`) that is still red on main.

## Security-relevant PRs still open (unmerged; not part of main)

#2147 documents dak IDOR scoping; #2151 agent-scoped field reads and maker-checker on inspection finalize; #2152 policy soft-revoke grants / visitor config bounds; #2156 audit/analytics/projects (includes a 15-minute query-string download token); #2160 revenue DCB role gate and fail-closed `/revenue` layout; #2161 report/install (PII-masked row preview, conflicts, excluded from integration); #2164 citizen/grants; #2166 inventory/assets/learning (adds a new citizen route `POST /v1/citizen/documents/verification-lane/batch`). Each is included in the PASS 3 integration except #2161. None is merged by this run.

## Open security items (analysis; none fixed by this run)

| ID | Severity | Item | Status |
|---|---|---|---|
| CLOS-CVE-NEXT | High | CVE-2026-94482 Next.js App Router DoS, fails Trivy (finance, gateway, hrms) and CVE / SCA Gate; PASS 3 also lists next CRITICAL GHSA-2464-fhr4-w9xw and HIGH GHSA-p3m5-59mp-jv5r failing CVE / SCA on main | BLOCKED, upgrade needs owner approval |
| DELEG-REVOKE-OWNERSHIP | High | any workflow_user can revoke any delegation and list all delegations in the tenant | BLOCKED, owner approval (authZ change); touches code from merged #2149 area |
| DELEG-UTC | Medium | delegation activeness decided on UTC date | BLOCKED |
| CLOS-S6-07 | Medium | workflow assignment resolver uses UTC date for substitutes: tasks can go to the wrong person 00:00-05:30 IST | BLOCKED |
| CLOS-S4-04 | Medium | billing Razorpay `createOrder`/`fetchPayment` have no timeout; non-ok upstream bodies are embedded in errors | BLOCKED (payment path) |
| CLOS-S4-05 | High | ~30 finance sites default posting/effective/value dates to the UTC date | BLOCKED (posting periods; statutory/financial rule) |
| CodeQL js/path-injection #930/#931 | High (2 alerts) | `services/audit-service/src/modules/exports/routes.ts` lines ~109/139 on main (lines 110/142 on integration after #2156) | open on main; not addressed |
| CodeQL on #2171 | n/a | 42 alerts reported as new, PASS 3 attributes the high ones to line shifts of #930/#931; the other alerts were not individually triaged in the sources I have | UNRESOLVED |
| secret-scanner | n/a | 71 potential findings at baseline, sampled ones are field names / test strings; not fully triaged | baseline, unchanged |
| sql-injection-guard | n/a | 24 patterns at baseline; moved HIGH 10 to 11 and MEDIUM 14 to 13 on integration (heuristic noise: a tagged-template `set_config` in hrms visiting-cards now HIGH) | baseline, unchanged |
| schema-drift / tenant-index guards | n/a | never evaluated against a bootstrapped DB; RLS/tenant-index drift is therefore unchecked on the integration | NOT VERIFIED |

## Owner questions with a security dimension (full list in `deferred-approval-items.md`)

- #2147: validate `assignedTo` against a tenant user directory? async consumer still trusts the command (small race).
- #2148/#2161: should the persisted PII-masked report preview be readable by all report read roles?
- #2151: tenant-wide sync for field_admin; reviewer role not checked; field task start/complete still accept any agent.
- #2152: protocol_officer removed from guard console instead of added to gate roles; unknown visitor_policy keys not rejected.
- #2156: 15-minute query-string download token acceptable?
- #2160: fail-closed `/revenue` layout denies sessions whose roles cannot be read; waiver larger than balance can drive balance negative.
- #2166: confirm the new citizen batch route is allowed through gateway / `/api/proxy`.

## Process disclosure

A lane agent working #2153 reported using one `pkill -f` pattern limited to its own `timeout 1500 npx vitest` command, contrary to the run rules; it saw no other agent affected on the shared ec2-user account.
