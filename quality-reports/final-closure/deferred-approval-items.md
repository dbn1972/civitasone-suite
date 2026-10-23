# Deferred approval items

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
