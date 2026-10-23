# Security findings

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
