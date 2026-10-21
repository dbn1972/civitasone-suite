# Detailed gap file — module `payroll`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 236, BACKEND-VERIFY 20, CANNOT-VERIFY 3



---
## /hr/payroll  —  `payroll/home.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/page.tsx`
- **Design reference:** `redesign/payroll/home.html`

### GAP-PAYROLL-HOME-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — verified NOT a bug via PR #1752: payroll-service queries.ts already divides minor units by 100 before returning grossAmount/netAmount, matching formatRupees usage. Left unchanged, confirmed correct.
- **First-pass claim:** Run amounts are RUPEES as floats (PayrollRunsTable.tsx:21-22, formatRupees) while register/corrections/off-cycle/F&F return paise (formatMoney on *_minor). Two money conventions in one module against CLAUDE.md §3.11 (bigint minor units); one wrong helper on a shared column shows a 100x error. payroll-service source is not in this repo, so the API contract cannot be verified.
- **Verified evidence:** Real inconsistency, documented as intentional: PayrollRunsTable.tsx:21-27 says grossAmount/netAmount are RUPEES and uses formatRupees; page.tsx:69 sums grossAmount and uses formatRupees; other screens use formatMoney(paise). lib/testUtils/money.ts:15-19 records the payroll-runs API as rupees (fix #312) and warns of 100x risk. Backend cannot be checked, and CLAUDE.md rule 11 (bigint minor units) is violated at the API contract level. The UI is presumably correct today.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/hr/payroll/PayrollRunsTable.tsx`, `apps/web/src/app/(app)/hr/payroll/page.tsx`
- **Fix steps:**
  1. Ask payroll-service owner to return grossAmountMinor/netAmountMinor (paise, string) alongside or instead of rupee floats; version the response.
  2. Add zod field-level schema in PayrollRunDetailListSchema and a mapper in loaders.ts that converts once, so UI only ever handles paise.
  3. Switch PayrollRunsTable and page.tsx to formatMoney on the minor fields; delete the rupee caveat comments.
  4. Add contract test asserting units.
- **Acceptance:**
  - Contract test: mocked API with grossAmountMinor=9000000 renders ₹90,000.00.
  - Grep shows no formatRupees in hr/payroll.
- **Needs:** backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display across payroll; do a coordinated backend+web release to avoid 100x error.
- **Depends on:** GAP-PAYROLL-INCOME-TAX-01

### GAP-PAYROLL-HOME-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1752 (merged): page-level role gate added (PAYROLL_READER_ROLES), matching backend READER_ROLES exactly.
- **First-pass claim:** Every hr/layout.tsx role incl. manager and employee reaches this page and its run totals (layout.tsx HR_ROLES; page.tsx:12-17 only hides the form). Whether GET /payroll/runs 403s non-payroll roles cannot be verified here (payroll-service absent); UI shows headcount and department gross/net to whoever the API allows.
- **Verified evidence:** page.tsx:14-17 computes canAdminister via getSessionRoles but only uses it to hide CreatePayrollRunForm (52) and the empty hint; run list, headcount and gross totals render for any role passing hr/layout.tsx. layout comment claims backend guards protect admin-only screens, but GET /api/v1/payroll/runs enforcement is not verifiable (payroll service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/page.tsx`
- **Fix steps:**
  1. Gate the whole page with PermissionDenied for non-payroll/hr roles (same shared role constant as -GPF-05), before getPayrollRunDetails().
  2. Alternatively render employee-specific self-service (own payslips link) for non-admins.
  3. Verify GET /v1/payroll/runs role list in payroll-service.
- **Acceptance:**
  - Employee/manager role sees PermissionDenied and no runs fetch.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Role list must match backend.
- **Depends on:** GAP-PAYROLL-GPF-05

### GAP-PAYROLL-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** — PR #1752 (merged): stat tiles fixed to total-minus-paid logic instead of summing every paid/completed run ever.
- **First-pass claim:** Employees Paid and Total Gross sum every paid/completed run ever (page.tsx:28-37): headcount is added month after month (the same person counted repeatedly) and gross is an unlabelled all-time total, not the current period.
- **Verified evidence:** page.tsx:28-37 sums employeeCount and grossAmount over all paid/completed runs of all time; StatCard labels are 'Employees Paid' and 'Total Gross' (en.json payroll) with no period qualifier. Headcount double counts employees across months. Theme is misfiled (not I18N).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Relabel: 'Total Gross (all runs)' or restrict to the latest paid run and label with its payPeriod.
  2. Replace 'Employees Paid' with the latest run's employeeCount (or max) and show the period.
  3. Add unit test for the aggregation with two runs.
- **Acceptance:**
  - Two runs of 100 employees show headcount 100 (latest), not 200, with period label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; decide desired KPI definition.

### GAP-PAYROLL-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was I18N)

- [x] **Status** — PR #1752 (merged): Pending/approved visibility fixed via the same total-minus-paid stat-tile logic, no longer conflating completed with paid.
- **First-pass claim:** Pending counts only draft + processing (page.tsx:38). Approved (awaiting disbursement) and failed runs appear in no stat, and "approved" is missing from PAYROLL_RUN_STATUSES so its pill uses the fallback label (statusLabels.ts:38-44) — the run about to release money is the least visible.
- **Verified evidence:** page.tsx:38 pending = draft|processing only. statusLabels.ts PAYROLL_RUN_STATUSES = draft, processing, completed, paid, disbursed, failed (approved absent) so payrollRunStatusLabel returns the raw string 'approved'. StatusPill STATUS_MAP has 'approved' green. No stat for approved/failed. Whether backend emits 'approved' for runs cannot be verified (PayrollRunDetail type file absent; workflow inferred from finding).
- **Files to change:** `apps/web/src/lib/payroll/statusLabels.ts`, `apps/web/src/app/(app)/hr/payroll/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Confirm run status enum with payroll-service; add 'approved' to PAYROLL_RUN_STATUSES and status.approved keys in payrollRunsTable (en/hi).
  2. Add 'Awaiting disbursement' and 'Failed' counts to page.tsx (or rename Pending to 'In progress' and add tiles).
  3. Update key-parity test.
- **Acceptance:**
  - Approved run shows translated pill.
  - Stat counts sum to total runs.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-HOME-07

### GAP-PAYROLL-HOME-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1752 (merged): structures fetch failure no longer silently reads as zero structures configured.
- **First-pass claim:** Structures fetch failure is discarded (page.tsx:19-22 takes only data): an outage shows admins "No pay structures configured — create one first" and hides the create form (page.tsx:53-61).
- **Verified evidence:** page.tsx:19-22 destructures only { data: structures } from getPayrollStructures(); on fetch failure data is the fallback empty array so line 53 shows 'No pay structures configured - create one first' (noStructuresMessage) and hides CreatePayrollRunForm, guarded only by !errored for runs.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/page.tsx`
- **Fix steps:**
  1. Keep the whole structuresResult; compute structuresErrored = toResourceState(result).status==='error'.
  2. When errored show RefreshErrorState (toHumanError('load')) instead of the no-structures card.
  3. Only show noStructuresMessage on a successful empty list.
- **Acceptance:**
  - Mock structures failure -> error state shown, not 'create one first'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-HOME-06  ·  MEDIUM  ·  partly  ·  theme CACHE (was VALIDATION)

- [x] **Status** — PR #1752 (merged): cache-staleness after Create Run fixed.
- **First-pass claim:** Runs list is cached: revalidateSeconds 120 (loaders.ts:2311). After Create Run, router.refresh() (CreatePayrollRunForm.tsx:104) can still show the old list for up to two minutes.
- **Verified evidence:** loaders.ts:2310-2315 uses revalidateSeconds:120 (apiClient.ts:137 next:{revalidate}) so router.refresh() alone does not bypass the data cache. But CreatePayrollRunForm.tsx:99-101 on success with body.id does router.push to the new run (fresh page for the id); router.refresh() (104) runs only in the fallback with no id. The stale list on return to /hr/payroll for up to 120s is still real. No revalidateTag/path is called anywhere in the form flow.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/hr/payroll/CreatePayrollRunForm.tsx`
- **Fix steps:**
  1. Tag the fetch (next.tags: ['payroll-runs']) via apiClient option and add a server action / route handler that calls revalidateTag('payroll-runs') after successful create.
  2. Call it from CreatePayrollRunForm before router.push/refresh.
  3. Or set revalidateSeconds: 0 for this loader.
- **Acceptance:**
  - After creating a run and going back, new run appears immediately.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Cache invalidation across other pages using same loader.

### GAP-PAYROLL-HOME-07  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1824 (merged)
- **First-pass claim:** StatusPill maps completed and paid to the same green and processing/disbursed to the neutral fallback (StatusPill.tsx:6-43): completed-but-unpaid is indistinguishable from paid.
- **Verified evidence:** StatusPill.tsx STATUS_MAP maps completed and paid to 'good'; processing and disbursed are absent so fall to 'info' (default). Not neutral-grey (mut) - fallback is 'info' blue. Caveat: PayrollRunsTable passes a translated label so the words differ (completed vs paid), only colour is identical. 'disbursed' should probably be 'good' too.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add processing: 'warn', disbursed: 'good' (or distinct), completed: 'info' if unpaid semantics needed - confirm with product.
  2. Keep label prop so text differs; add non-colour cue.
- **Acceptance:**
  - Snapshot test for each run status variant.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared app-wide; changing 'completed' colour affects all modules - prefer adding payroll-specific override.
- **Depends on:** GAP-PAYROLL-HOME-04

### GAP-PAYROLL-HOME-08  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1752 (merged): loading-state heading/back-link mismatch fixed.
- **First-pass claim:** loading.tsx titles the page "Payroll Runs" with back "HR" (loading.tsx:9-14) while the page is "Payroll" with no back link, so the heading changes on load; no in-page links to sibling payroll routes.
- **Verified evidence:** payroll/loading.tsx:9-14 titles 'runsCardTitle' (Payroll Runs) with back='/hr' backLabel 'HR'; page.tsx:43-47 uses t('title') with no back prop. Loading->loaded heading changes. No links to sibling payroll routes in page.tsx apart from structures.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loading.tsx`
- **Fix steps:**
  1. Use t('title') in loading.tsx and remove back/backLabel to mirror page.tsx.
  2. Optionally add a quick-links card to sibling routes (register, slips, form16...) in page.tsx.
- **Acceptance:**
  - Loading and loaded headings identical.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/payroll/[id]  —  `payroll/detail.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`
- **Design reference:** `redesign/payroll/detail.html`

### GAP-PAYROLL-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was UUID)

- [x] **Status** — PR #1752 (merged): fabricated EPF/ESI/DA/HRA breakdown and the raw employee UUID both removed; replaced with real slip.gross/deductions/net plus a reconciliation check.
- **First-pass claim:** Preview Slip fabricates the breakdown: estimateComponents() derives Basic 45%, DA 46%, HRA 24%, TA 3,600, EPF 12%, ESI 0.75%, PT 200, TDS 5% from gross alone (SalarySlipsClientTable.tsx:21-35) while net is the API value (:213). Lines do not foot to net, and a government slip shows EPF and ESI (state employees are on GPF/NPS; ESI has a wage ceiling). Only a footer notice says "estimated". The modal also prints the raw employee UUID (:177).
- **Verified evidence:** SalarySlipsClientTable.tsx:21-35 estimateComponents(gross) invents Basic 45%, DA 46% of basic, HRA 24% of basic, TA 3600, Special as remainder, EPF 12% of basic, ESI 0.75% of gross, PT 200, TDS 5%. SalarySlipModal renders these (:184-197) next to slip.gross (:189) and API slip.net (:213); totalDed (c.totalDed) is never reconciled to slip.deductions or gross-net. The header says 'Indicative slip' (en.json indicativeSlipNotice) and the 10px footer says 'Component breakdown is estimated' (slipFooterNotice), so a disclaimer exists but lines still do not foot. Raw employee id printed at :177 via employeeIdPeriodLine. SlipRow already carries an API value slip.deductions that the modal ignores. Money is float rupees (formatRupees), not paise.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/SalarySlipsClientTable.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json (if present)`
- **Fix steps:**
  1. Delete estimateComponents() and the Earnings/Deductions component SlipLine rows that use it.
  2. Interim: render only API-backed figures in SalarySlipModal: Gross (slip.gross), Total Deductions (slip.deductions), Net (slip.net); add a check gross - deductions === net and show a mismatch warning instead of hiding it.
  3. Remove the ESI/EPF/'Ref: 7th CPC' labels and slipFooterNotice keys from en.json; replace with a neutral 'Component-level breakdown is not available in this view' note.
  4. Replace slip.employeeId in employeeIdPeriodLine with the employee name only (already shown above) or a link to /hr/employees/{id}; keep the UUID in the URL.
  5. Backend follow-up: expose per-slip earning/deduction lines (real components incl. GPF/NPS for govt) and bind the modal to that endpoint; render component rows only when returned.
  6. Amounts: when API moves to paise, switch formatRupees to formatMoney.
- **Acceptance:**
  - Component test: modal with gross 100000, deductions 20000, net 80000 shows exactly those three figures and no EPF/ESI/TDS rows.
  - Component test: slip with gross-deductions != net shows the mismatch warning.
  - Manual: open Preview Slip; DOM contains no UUID text and no percentage-derived component lines.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Payslip content is shown to HR/payroll and possibly circulated as an official document; wrong statutory lines (EPF/ESI for govt staff) are a compliance and trust risk. Removing rows is low regression risk.

### GAP-PAYROLL-DETAIL-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1752 (merged): confirmed backend already enforces SELF_APPROVAL_FORBIDDEN server-side; raised client minReasonLength 1 to 10 to match.
- **First-pass claim:** Maker-checker is a free-text box: Approve and Disburse dialogs use requireReason with minReasonLength default 1 (ConfirmDialog.tsx:72,171), and the page never compares the approver with the run creator or with the previous approver. The same payroll_officer can create, approve and disburse. Server-side enforcement cannot be verified (payroll-service source absent).
- **Verified evidence:** Approve and Disburse ConfirmDialogs set requireReason (PayrollRunActions.tsx:135-170) but pass no minReasonLength, so the ConfirmDialog default of 1 applies (ConfirmDialog.tsx:72, gate at :171-174): a single character passes. The page never receives creator/previous approver: PayrollRunActions props are runId,status,counts,amounts,canAdminister (:11-20); canAdminister is only a role check (page.tsx:51 payroll_admin/payroll_officer/super_admin). So no client-side maker!=checker exists. Server enforcement cannot be verified: payroll-service is not in the snapshot (only services/hrms-service). The 'same payroll_officer can create, approve and disburse' claim is therefore true of the UI, unproven for the API.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/messages/en.json`, `payroll-service run routes (not in snapshot)`
- **Fix steps:**
  1. Pass minReasonLength={10} (and maxReasonLength) on the approve, disburse and revert ConfirmDialogs; add hint copy via existing ConfirmDialog hint.
  2. Backend: enforce createdBy != approvedBy and approvedBy != disbursedBy on PATCH /runs/{id}/approve|disburse, return 403 with a code such as MAKER_CHECKER_VIOLATION, and emit an audit event with reason, actor and run id.
  3. Backend: include createdBy, approvedBy (ids and display names) in GET /runs/{id}; extend PayrollRunFullDetail type/schema.
  4. page.tsx: read the session user id (lib/auth/roleGuard) and pass currentUserId, createdBy, approvedBy to PayrollRunActions; disable Approve/Disburse with an explanatory hint when the user is the maker/approver.
  5. Map the server 403 code in useFormError so the dialog shows the maker-checker message.
- **Acceptance:**
  - Unit test: ConfirmDialog with minReasonLength=10 keeps confirm disabled for 'ok' and enables at 10 chars.
  - Component test: when currentUserId === createdBy the Approve button is disabled with the maker-checker hint.
  - API test: same user approving own run gets 403 MAKER_CHECKER_VIOLATION and an audit row is written.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals on salary money; small offices with one payroll user may need a configurable override (business decision) or they get locked out.
- **Depends on:** GAP-PAYROLL-DETAIL-07

### GAP-PAYROLL-DETAIL-03  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1752 (merged): confirmed backend already enforces disbursement reconciliation server-side (DISBURSE_RECONCILIATION_FAILED) before a second payout can occur.
- **First-pass claim:** Revert to Draft is offered for status "failed" and the dialog says "No funds have been disbursed" (en.json payrollRunActions.revertDescription), but a failed disbursement can follow partial bank credits (the Disbursement route tracks credited/failed per employee). Reverting then re-approving and disbursing can pay some employees twice.
- **Verified evidence:** Revert is offered when status === 'failed' (PayrollRunActions.tsx:89, button :116-124) and its dialog copy is static: en.json payrollRunActions.revertDescription ends 'No funds have been disbursed.' The disbursement page does track per-employee outcomes (disbursement/page.tsx:123-124 counts transfers with status credited/failed; DisbursementTransferTable.tsx:16 status pending|processing|credited|failed) so a failed run can coexist with credited transfers. What happens to those transfers on revert/re-disburse is server behaviour that cannot be verified (payroll-service absent), so the double-payment outcome is plausible, not proven. The UI defect (unconditional 'no funds disbursed' claim, no credited count) is real.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/messages/en.json`, `payroll-service revert route (not in snapshot)`
- **Fix steps:**
  1. Backend: GET /runs/{id} should return credited/failed/pending transfer counts and amounts (or reuse /payroll/disbursement/transfers filtered by runId); make revert reject or require explicit override when any transfer is credited.
  2. page.tsx: fetch that summary and pass creditedCount/creditedAmount to PayrollRunActions.
  3. Replace revertDescription with a rich message that states the credited count; when creditedCount > 0 hide 'Revert to Draft' and link to /hr/payroll/disbursement to retry only failed transfers.
  4. Set minReasonLength={10} on the revert dialog and audit the reason server-side.
- **Acceptance:**
  - Component test: failed run with creditedCount=3 shows no Revert button and a link to Disbursement.
  - Component test: failed run with creditedCount=0 shows Revert and the 'no funds' copy.
  - API test: revert on a run with a credited transfer returns 409.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Direct double-payment risk on salaries; wrong copy can lead an approver to reprocess a partly paid run.
- **Depends on:** GAP-PAYROLL-DETAIL-02

### GAP-PAYROLL-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1752 (merged): canApprove no longer allows draft, matching the backend FSM which only allows approving from processing.
- **First-pass claim:** Approve Run is enabled for draft as well as processing (PayrollRunActions.tsx:canApprove), i.e. before Calculate and Review have completed per the stepper; the dialog gives no count of failed slips or exceptions to weigh.
- **Verified evidence:** PayrollRunActions.tsx:87 canApprove = canAdminister && (status === 'processing' || status === 'draft'). The stepper maps draft to step 0 (data-lock) and processing to step 1 (calculate) (PayrollRunStepper.tsx:15-16), i.e. before Review, so Approve is offered pre-review. The approve dialog (:135-151) shows only period, employeeCount and gross (approveDescription); page.tsx computes deriveExceptions(slipRows) (:47) and renders ExceptionPanel but does not pass the exception/failed count to PayrollRunActions. Note 'completed' (the stepper's Review step) offers no action at all, so the UI's intended flow is unclear.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decision: confirm the real state machine with the payroll owner (draft -> processing -> completed -> approved -> paid); then restrict canApprove to the state after calculation/review (likely 'completed').
  2. page.tsx: pass exceptionCount={exceptions.length} and failedSlipCount to PayrollRunActions.
  3. Add exceptionCount to approveDescription (rich text); if exceptionCount > 0, show a warning line and require reason length >= 10, or disable Approve until exceptions are cleared/acknowledged.
  4. Add the net amount alongside gross in the dialog.
- **Acceptance:**
  - Component test: status 'draft' and 'processing' render no Approve button (or per agreed state machine).
  - Component test: exceptionCount=2 shows the warning text in the approve dialog.
  - Manual: run with a failed slip: approve dialog states '2 slips failed'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Changing which statuses can be approved may strand runs if the backend actually approves from draft/processing; verify with backend transitions first.
- **Depends on:** GAP-PAYROLL-DETAIL-02, GAP-PAYROLL-DETAIL-08

### GAP-PAYROLL-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** ExceptionPanel only derives from slip status === "failed" (ExceptionPanel.tsx:95) yet its message tells users to "check bank account, PAN, or salary structure": no PAN or bank checks are surfaced, so missing-PAN and missing-account cases are not flagged before disbursement.
- **Verified evidence:** ExceptionPanel.tsx:89-104 deriveExceptions pushes an exception only when s.status === 'failed' (:95). Its message en.json payrollDetail.exceptionSalaryCalcFailed says 'check bank account, PAN, or salary structure'. Slip rows are typed as only id, employeeId, employeeName, gross, deductions, net, status (page.tsx:13-21), so the web has no PAN or bank data to check; the shared types package (@civitasone/types) is not in the snapshot, so any extra API fields are cannot-verify. Fix link goes to /hr/employees/{id} (ExceptionPanel.tsx:65). Theme PII is wrong: nothing PII is displayed; this is missing pre-disbursement validation.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/ExceptionPanel.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/messages/en.json`, `payroll-service run detail response (not in snapshot)`
- **Fix steps:**
  1. Backend: return per-slip validation issues (codes such as MISSING_PAN, MISSING_BANK_ACCOUNT, INVALID_IFSC, NO_SALARY_STRUCTURE) on GET /runs/{id}, without returning the PAN or account number itself.
  2. Extend SalarySlipRow with issues?: string[] and make deriveExceptions map each code to a translated message (new payrollDetail.exception* keys) in addition to status 'failed'.
  3. Reword exceptionSalaryCalcFailed so it no longer lists causes it cannot detect.
  4. Feed the exception count into the Approve/Disburse gating (see DETAIL-04).
- **Acceptance:**
  - Unit test: deriveExceptions on a slip with issues ['MISSING_PAN'] returns a PAN-specific message.
  - Unit test: a failed slip with no issue codes still yields the generic message.
  - Manual: employee without PAN appears in the amber panel before Approve.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Missing PAN means higher TDS (Section 206AA) and missing bank means failed credits; low regression risk in UI, backend validation must match statutory rules.
- **Depends on:** GAP-PAYROLL-DETAIL-04

### GAP-PAYROLL-DETAIL-06  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Disburse copy says "Funds are released to PFMS" (en.json disburseDescription) but the Disbursement route generates NEFT/NACH/APBS bank files and DSC-signs them — the release channel is unclear at the moment the action becomes irreversible.
- **Verified evidence:** en.json payrollRunActions.disburseDescription: 'Funds are released to PFMS and this action is irreversible.' The bank-file wizard (disbursement/BankFileWizard.tsx:10,73-77) offers NEFT/RTGS csv, NACH and APBS files, and lib/auth/workRoles.ts references a PFMS salary-bill bridge in finance-service, so PFMS may genuinely be a channel for the disburse PATCH. What POST/PATCH /payroll/runs/{id}/disburse actually does (PFMS bill vs bank files) is server-side and cannot be verified; the page copy and the Disbursement route describe different channels without explanation. 'DSC-signs them' is unproven: the wizard only displays certificate metadata.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json (if present)`, `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`
- **Fix steps:**
  1. Confirm with backend what the disburse endpoint does (PFMS bill generation, sponsor-bank file, or status flip only).
  2. Rewrite disburseDescription to name the actual channel(s) and state what happens next, e.g. 'Marks the run as approved for payment; generate the bank file on the Disbursement page' if that is the truth.
  3. Add the disbursement channel (from tenant config) as a rich-text argument so it is not hard-coded.
  4. Keep 'irreversible' only if the backend really blocks reversal.
- **Acceptance:**
  - Manual: the dialog text matches the confirmed backend behaviour, reviewed by payroll owner.
  - i18n: all locales updated; no hard-coded 'PFMS' outside translation strings.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy on an irreversible payment action; misdescribing the channel misleads approvers and auditors.
- **Depends on:** GAP-PAYROLL-DISBURSEMENT-06

### GAP-PAYROLL-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1762 (merged): already done on main (verified in review)
- **First-pass claim:** Run detail is cached: revalidateSeconds 60 (loaders.ts:2320). After approve/disburse, router.refresh() may still render the prior status and buttons for up to a minute, inviting a second click on an irreversible action.
- **Verified evidence:** loaders.ts:2318-2325 getPayrollRunById uses revalidateSeconds: 60; apiClient.ts:137-138 turns that into fetch next:{revalidate:60} (else cache:'no-store'). No revalidatePath/revalidateTag exists anywhere in apps/web/src (grep empty). PayrollRunActions.runAction ends with setPending(null) then router.refresh() (:78-79), which re-renders the server component but still gets the Data Cache copy for up to 60 s, so status and buttons can be stale; busy is reset in finally (:83) and the message pill stays, so the same Approve/Disburse button can be clicked again (a second dialog is required and the server should reject an invalid transition, but this is unverified).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`
- **Fix steps:**
  1. In getPayrollRunById remove revalidateSeconds (falls to cache:'no-store') or add next tags and call revalidateTag from a server action after PATCH.
  2. Same for the previous-period lookup only if it must be fresh (not needed).
  3. In PayrollRunActions add a local 'completed' state after a successful action that hides the action buttons until props.status changes.
  4. Send an Idempotency-Key header on approve/disburse/revert PATCH so a double submit is safe (backend support needed).
- **Acceptance:**
  - Component test: after a successful approve fetch, no Approve button is rendered before the prop status updates.
  - Manual: approve a run; after router.refresh the status pill shows 'approved' immediately, not after 60 s.
  - Grep test: getPayrollRunById has no revalidateSeconds.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Removing caching increases load on one endpoint per detail view; acceptable for a low-traffic finance screen.

### GAP-PAYROLL-DETAIL-08  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1752 (merged): PayrollRunStepper status-to-step mapping fixed to match the real wire enum (approved/disbursed are remapped to completed/paid server-side); added dedicated test coverage.
- **First-pass claim:** Stepper marks the current step with a spinner even at rest (draft, approved, completed) and maps approved to the Approve step, not Disburse; failed shows step 4 as error (PayrollRunStepper.tsx:13-24,66-68). Run Details status is the raw lowercase enum (page.tsx pill) while the table translates it; Fix links to the employee record, not the slip.
- **Verified evidence:** PayrollRunStepper.tsx:13-24 maps draft 0, processing 1, completed 2, approved 3 (Approve step), paid/disbursed 4, failed 3. stateOf marks i===curIdx as 'current' (:61) and current renders <Spinner /> (:100-102), so resting states draft, completed and approved show a spinning indicator; approved stays on the Approve step instead of showing Approve done and Disburse current; failed shows step 4 (Approve) as error (:61). page.tsx:114-116 prints run.status raw lowercase in a pill with a 3-way tone map. ExceptionPanel.tsx:65 'Fix' links to /hr/employees/{employeeId}, not the slip. The claim 'while the table translates it' was not checked in detail; the table imports StatusPill.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunStepper.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/lib/payroll/statusLabels.ts`, `apps/web/src/app/(app)/hr/payroll/[id]/ExceptionPanel.tsx`
- **Fix steps:**
  1. Stepper: show a spinner only when status === 'processing'; for other resting statuses show the step number with a highlighted ring.
  2. Change approved to index 4 with step 3 'done' (so Disburse is the next current step); keep failed on the Disburse step in error state if the failure is at disbursement (confirm which step failed).
  3. page.tsx: replace the hand-written pill with the shared StatusPill or the existing lib/payroll/statusLabels.ts label helper; add tones for completed/approved.
  4. ExceptionPanel: link Fix to the employee's payroll data or the slip (once a slip detail route exists), keep employee link as secondary.
  5. Add aria text for step state (done/current/error) so state is not colour only.
- **Acceptance:**
  - Component test: stepper with status 'approved' renders steps 1-4 done and step 5 current without a spinner.
  - Component test: status 'processing' renders exactly one spinner.
  - Manual: Run Details status shows a translated, toned pill identical to the list page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Cosmetic; low. Confirm status enum from backend so mappings do not miss values like 'disbursed'.


---
## /hr/payroll/arrears  —  `payroll/arrears.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`
- **Design reference:** `redesign/payroll/arrears.html`

### GAP-PAYROLL-ARREARS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Employee column prints the raw employee_id UUID and component_code (arrears/page.tsx:59,91); the file comment itself says no name/label lookup is done (page.tsx:45–52). A payroll clerk cannot tell whose arrears they are reading.
- **Verified evidence:** arrears/page.tsx:91-92 columns employee_id and component_code print raw; mapArrearRow (55-67) passes them through; comment at 48-50 states no lookup is done (observation cites 45-52; correct range 41-54; column lines 91-92 not 59,91). No EntityPicker/name-resolution helper exists in apps/web (grep found none). Bonus page has the same pattern. Backend payroll-service is absent so an employee-name field on the wire is cannot-verify; wire type ArrearApiRow (14-28) has only employee_id.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/app/_data/employeeNames.ts (new)`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a server helper resolveEmployeeNames(ids) that batch-fetches employees from the hrms-service list endpoint already used by hr/employees pages (one call, no N+1) and returns Map<id,{name,code}>.
  2. In mapArrearRow output employee_name/employee_code; change the column key to employee_name and show code as secondary text; fall back to formatInternalRef style short id with a tooltip if not found.
  3. Map component_code to a label via existing component master or humanizeStatus fallback (formatters.ts:44).
  4. Keep the UUID only in a link href to the employee page.
- **Acceptance:**
  - Unit test: rows with known employee ids render names; unknown id renders 'Unknown employee' + short id.
  - Manual: arrears table shows names, not UUIDs.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Depends on an employee lookup endpoint; do not expose extra PII beyond name/code to roles who only see their own rows.
- **Depends on:** shared: employee name resolver / EntityPicker

### GAP-PAYROLL-ARREARS-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY (was I18N)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** “Total Arrears Amount” sums difference_minor over every row regardless of status (page.tsx:100), so rejected and negative (recovery) rows are netted into a figure labelled as owed; Pending/Approved stats count statuses but the money does not.
- **Verified evidence:** arrears/page.tsx:100 totalArrearsMinor = sum Number(i.difference_minor) over all items with no status filter; stat card at :110 labels it 'Total Arrears Amount' (en.json arrears.statTotalArrearsAmount). The other stats count by status (108-109). Whether 'rejected' or negative rows exist is not verifiable (payroll-service absent), but nothing excludes them. Also sums via JS Number (float) rather than bigint; safe below 2^53 paise but violates paise/bigint rule. Theme should be MONEY, not I18N.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Filter items to statuses that represent money owed (e.g. pending/approved) before summing; sum with BigInt(String(x)) and pass bigint to formatMoney.
  2. Split into two stats or relabel: 'Outstanding arrears' (pending+approved) and show paid separately.
  3. Show recoveries (negative) explicitly rather than netting, or label 'Net'.
  4. Confirm the status vocabulary with payroll-service.
- **Acceptance:**
  - Unit test: rows [approved 1000, rejected 500, pending -200] give the agreed outstanding figure.
  - Manual: total changes when a row is rejected.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money figure on a payroll screen; definition of 'owed' must be agreed with finance/payroll before change.

### GAP-PAYROLL-ARREARS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** No action to approve, reject or mark paid although statuses pending/approved/paid are counted (page.tsx:110–112) — the register cannot move an arrear forward; the “appear here automatically” copy (en.json arrears.emptyMessage) is the only workflow hint.
- **Verified evidence:** arrears/page.tsx:106-118 renders StatCards and a read-only DataTable; no approve/reject/mark-paid controls and no client component. Statuses are counted at :108-109. en.json arrears.emptyMessage (line 223) says arrears 'appear here automatically after each payroll run'. Whether payroll-service exposes approve/reject/pay arrears endpoints is cannot-verify. Note hrms-service payroll-client and fnf-route only reference arrears for F&F. Theme should be WIRING/WORKFLOW not I18N.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/app/(app)/hr/payroll/arrears/ArrearActions.tsx (new)`
- **Fix steps:**
  1. Confirm payroll-service endpoints for arrear status transitions (approve/reject/mark-paid) and their role rules.
  2. Add ArrearActions client component per row (canAdminister from getSessionRoles like hr/payroll/page.tsx:17) using ConfirmDialog with mandatory reason on reject.
  3. Enforce maker!=checker: hide Approve when created_by === current user (needs created_by on wire).
  4. POST via browserJson, then router.refresh(); backend emits audit event.
- **Acceptance:**
  - Component test: Approve calls the endpoint, refreshes; button hidden for non-payroll roles.
  - Manual: pending -> approved -> paid path works and counts update.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Moves money to payment; needs maker-checker and audit; endpoints unverified.
- **Depends on:** GAP-PAYROLL-ARREARS-04

### GAP-PAYROLL-ARREARS-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE (was PII)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits manager and employee, and this page renders the whole tenant register (salary differences are DPDP-sensitive). Row scoping depends on a backend that is not in this checkout.
- **Verified evidence:** hr/layout.tsx:32-47: HR_ROLES includes "manager" and "employee" and layout calls requireAnyRole(HR_ROLES) (observation's 26-42 should be 32-46; comment 5-31 explains intent). arrears/page.tsx has no getSessionRoles/canAdminister check (unlike hr/payroll/page.tsx:16-17) and fetches /api/v1/payroll/arrears for everyone; row-level scoping in payroll-service cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/app/(app)/hr/payroll/arrears/../_lib/payrollRoles.ts (new)`
- **Fix steps:**
  1. Extract PAYROLL_ADMIN_ROLES from hr/payroll/page.tsx:12 into hr/payroll/_lib and reuse.
  2. In arrears/page.tsx (or a hr/payroll/layout.tsx covering all payroll children) call requireAnyRole(PAYROLL_ADMIN_ROLES) or render own-rows-only view for employees.
  3. Mask employee names/amounts for non-admin viewers via shared <Masked> if partial access is intended.
  4. Verify backend scopes rows by role.
- **Acceptance:**
  - Layout/page test: role employee is redirected from /hr/payroll/arrears; payroll_officer sees register.
  - Manual: manager cannot see tenant-wide arrears.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Payroll salary data is DPDP-sensitive; a payroll/layout.tsx guard would protect all ~30 payroll sub-routes but may break self-service payslip pages that live under it.
- **Depends on:** GAP-PAYROLL-BONUS-04

### GAP-PAYROLL-ARREARS-05  ·  LOW  ·  confirmed  ·  theme NAV (was LOADING)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Back link goes to /hr (“Back to HR”) from a payroll route (page.tsx:104, error.tsx:12) while every sibling payroll page returns to /hr/payroll.
- **Verified evidence:** arrears/page.tsx:104 PageHeader back="/hr" backLabel="Back to HR"; error.tsx:12 backHref="/hr" with label en.json arrears.errorBackLabel 'Back to HR' (errorArea 'HR page'). Bonus, loans, off-cycle, nps pages use back="/hr/payroll". Even inside the same page the RefreshErrorState uses backHref="/hr/payroll" (line 115), so it is inconsistent internally. Theme is navigation, not LOADING.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/app/(app)/hr/payroll/arrears/error.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Change PageHeader back to "/hr/payroll" backLabel "Back to Payroll" (use an i18n key).
  2. Change error.tsx backHref to "/hr/payroll" and en.json arrears.errorBackLabel to 'Back to Payroll', errorArea to 'Arrears'.
- **Acceptance:**
  - Manual: back link from /hr/payroll/arrears goes to /hr/payroll on page and error states.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.

### GAP-PAYROLL-ARREARS-06  ·  LOW  ·  partly  ·  theme DATEFMT (was LOADING)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Periods print as raw “2026-07” strings (page.tsx:92–93) and the loading.tsx (6 lines) is a single unlabeled-shape block.
- **Verified evidence:** Periods: columns from_period/to_period (page.tsx:93-94) are passed to DataTable without a formatter so '2026-07' prints raw: true. loading.tsx is 5 lines (not 6): a single <div className="skeleton"> that does have an aria-label (arrears.loadingAriaLabel), but no PageHeader/StatGrid/table silhouette. Same shape in bonus/loading.tsx. Line refs 92-93 are actually 93-94.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/arrears/page.tsx`, `apps/web/src/app/(app)/hr/payroll/arrears/loading.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatPeriod(yyyy-mm) -> 'Jul 2026' to lib/formatters.ts (returns '—' on null) and use via a render/cellType on the two period columns.
  2. Rebuild loading.tsx with PageHeader placeholder, 4 skeleton stat cards and table skeleton (reuse ds/Skeleton.tsx) keeping the aria-label.
- **Acceptance:**
  - Unit test formatPeriod('2026-07') === 'Jul 2026', null gives '—'.
  - Manual: loading state resembles page layout.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; sorting on period should still use raw value.


---
## /hr/payroll/bonus  —  `payroll/bonus.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/bonus/page.tsx`
- **Design reference:** `redesign/payroll/bonus.html`

### GAP-PAYROLL-BONUS-01  ·  HIGH  ·  confirmed  ·  theme ENTITYPICKER (was CONFIRM)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Employee is a free-text “Employee ID” (ComputeBonusForm.tsx label employeeIdLabel) and the table prints the raw employee_id (bonus/page.tsx:35): bonus can be computed for a mistyped or foreign UUID and cannot be visually verified before confirming.
- **Verified evidence:** ComputeBonusForm.tsx:216-229 is a plain text input labelled employeeIdLabel 'Employee ID' (en.json computeBonusForm.employeeIdLabel); validation at :157 checks only non-empty (no UUID check). Table column employee_id prints raw (bonus/page.tsx:35). ConfirmDialog (:306-321) shows the same typed employeeId and no name, no reason field, no maker-checker. Whether the API rejects an unknown employee is cannot-verify (payroll-service absent). No EntityPicker exists in the repo. Theme is more PICKER/ID than CONFIRM though ConfirmDialog is present.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/bonus/ComputeBonusForm.tsx`, `apps/web/src/app/(app)/hr/payroll/bonus/page.tsx`, `apps/web/src/app/_components/EmployeePicker.tsx (new)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create shared <EmployeePicker> (search by name/code against hrms employee list, returns id + display name) and use it in place of the text input; also for arrears/reimbursements/salary-revisions forms.
  2. Validate id as uuid with zod before opening ConfirmDialog.
  3. Show employee name + code in the ConfirmDialog description instead of the raw id.
  4. Resolve names in the bonus table (see GAP-PAYROLL-ARREARS-01 helper).
  5. Add reason textarea to the dialog if policy requires; backend audit event must include it.
- **Acceptance:**
  - Component test: submitting a non-uuid/unknown id is blocked with inline error.
  - Manual: pick an employee by name; confirm dialog shows name; table shows names.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Bonus computation writes money records; a wrong employee id is a real payroll error. Server must also validate existence.
- **Depends on:** GAP-PAYROLL-ARREARS-01

### GAP-PAYROLL-BONUS-02  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Basic is typed in rupees per employee; the form does not fetch the employee’s actual basic or cap wages at the Payment of Bonus Act ceiling, so a wrong basic silently yields a wrong statutory bonus (ComputeBonusForm.tsx:42–46,82).
- **Verified evidence:** Basic is entered in rupees as free number (ComputeBonusForm.tsx:247-264, step 0.01) and converted with Math.round(parseFloat(basic)*100) in preview (:146-151) and submit (:187): float multiplication (e.g. 1.005*100) and violates the paise rule though the payload is basicMinor integer. The form does not fetch the employee's basic and applies no Payment of Bonus Act wage ceiling; both true but the ceiling/eligibility logic likely belongs in payroll-service (cannot-verify). Preview also uses Math.round(b*p/100) float. Observation's lines 42-46,82 are off (actual 146-151, 187, 247-264).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/bonus/ComputeBonusForm.tsx`, `apps/web/src/lib/formatters.ts (add rupeesToMinor)`
- **Fix steps:**
  1. Add rupeesToMinor(str) to lib/formatters.ts using string split/BigInt (no float) and use it at :146-151 and :187; reject more than 2 decimals.
  2. Once an employee is picked, fetch their current basic (existing payroll structure/CTC endpoint if any; cannot-verify) and prefill read-only with an override reason.
  3. Ask backend to enforce wage ceiling/eligibility and return a validation error; display the ceiling in help text only if the API returns it.
  4. Send bonus_pct as a decimal string or basis points to avoid float.
- **Acceptance:**
  - Unit test rupeesToMinor('1.005') rejects, ('1234.50') === 123450n.
  - Manual: prefilled basic for selected employee; override requires reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Statutory bonus amounts; wrong ceiling logic is a compliance risk, so keep authoritative calculation on the server.
- **Depends on:** GAP-PAYROLL-BONUS-01

### GAP-PAYROLL-BONUS-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Bonus % bounds (8.33–20) are enforced only by HTML min/max on the input (ComputeBonusForm.tsx:163–166); handleSubmit validates employee, FY and basic only (lines 52–72), so a programmatic or paste-in value passes to the API.
- **Verified evidence:** Bonus % input has min=8.33 max=20 step=0.01 (ComputeBonusForm.tsx:267-276; observation's 163-166 wrong). handleSubmit (153-181) validates employee, FY format and basic only. However the form has no noValidate, so browsers enforce min/max/step natively on a submit-button submit and block typed or pasted out-of-range values; only a cleared field (no `required`) or scripted state bypasses it: parseFloat('') is NaN, previewAmountMinor is null, and JSON.stringify sends bonusPct null (:194). Server-side validation cannot be verified. Also FY regex only checks \d{4}-\d{2}, not consecutive years.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/bonus/ComputeBonusForm.tsx`, `apps/web/src/lib/schemas/bonus.ts (new)`
- **Fix steps:**
  1. Add zod schema {employeeId: uuid, fy: /^\d{4}-\d{2}$/ with consecutive-year refine, basicMinor positive int, bonusPct number 8.33..20} and run safeParse in handleSubmit; map issues to invalidField/message.
  2. Add required to the bonus % input and reject NaN.
  3. Disable submit while busy (already) and while the form is invalid.
  4. Ensure payroll-service validates the same range.
- **Acceptance:**
  - Unit test schema: 8.32, 20.01, NaN fail; 8.33 and 20 pass; 2025-27 fails.
  - Manual: clear bonus % and submit -> inline error, no dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; must not reject valid bonus percentages set by policy (confirm bounds with HR).

### GAP-PAYROLL-BONUS-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 lets manager/employee open the page and see the compute form and all bonus records; the 403 arrives only after ConfirmDialog. Backend role guard not verifiable (payroll-service absent).
- **Verified evidence:** hr/layout.tsx:32-46 admits manager and employee; bonus/page.tsx has no role check and renders <ComputeBonusForm/> (:61) and the whole /api/v1/payroll/bonus list (:20) to any of them; hr/payroll/page.tsx:12-17 shows the existing canAdminister pattern which bonus doesn't use. Failure only surfaces from browserJson after ConfirmDialog (ComputeBonusForm.tsx:186-206, dialogError). Backend guard cannot be verified. (Observation lines 26-42 should be 32-46.)
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/bonus/page.tsx`, `apps/web/src/app/(app)/hr/payroll/_lib/payrollRoles.ts (new)`
- **Fix steps:**
  1. Reuse the shared PAYROLL_ADMIN_ROLES constant (see GAP-PAYROLL-ARREARS-04) and compute canAdminister via getSessionRoles().
  2. Render <ComputeBonusForm/> only if canAdminister; else redirect or show read-only own record.
  3. Guard the list with requireAnyRole for non-admins if tenant-wide list is not meant for them.
- **Acceptance:**
  - Page test: employee role does not render the Compute Bonus form.
  - Manual: manager visiting /hr/payroll/bonus is redirected or sees no form.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Same guard decision as other payroll pages; backend must still enforce.
- **Depends on:** GAP-PAYROLL-ARREARS-04

### GAP-PAYROLL-BONUS-05  ·  LOW  ·  partly  ·  theme I18N (was DEADROUTE)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** loading.tsx renders one bare skeleton with no PageHeader/StatGrid silhouette; error.tsx hard-codes English “Back to Payroll”/“Bonus” instead of next-intl keys (bonus/error.tsx:13–14).
- **Verified evidence:** loading.tsx (5 lines) renders one <div className="skeleton"> with aria-label, no PageHeader/StatGrid silhouette: true. bonus/error.tsx:10-12 hard-codes backLabel="Back to Payroll" and area="Bonus" (observation says lines 13-14; actual 10-12) instead of useTranslations, unlike arrears/error.tsx which uses t(). Nothing here is a dead route (backHref /hr/payroll exists), so theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/bonus/error.tsx`, `apps/web/src/app/(app)/hr/payroll/bonus/loading.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add payrollBonus.errorBackLabel and errorArea keys to en.json and use useTranslations("payrollBonus") in error.tsx.
  2. Rebuild loading.tsx with header + 4 stat skeletons + table skeleton (ds/Skeleton.tsx).
- **Acceptance:**
  - Manual: force error, back link text comes from message file.
  - Visual: loading layout matches page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /hr/payroll/comparison  —  `payroll/comparison.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`
- **Design reference:** `redesign/payroll/comparison.html`

### GAP-PAYROLL-COMPARISON-01  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was FAILMASK)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Period fields are free text validated by PERIOD_RE /^\d{4}-\d{2}$/ (page.tsx:17,48); a typo such as “2026-8” silently falls back to the “Choose two periods” empty state with no field error, and “2026-13” passes the regex.
- **Verified evidence:** comparison/page.tsx:17 PERIOD_RE=/^\d{4}-\d{2}$/, :48 canCompare gates the fetch; inputs at :65-72/:78-85 are plain text (no type=month, no pattern). If a value fails the regex, canCompare=false and the 'Choose two periods' EmptyState (:114-122) shows with no field error/aria-invalid. '2026-13' and '0000-00' pass the regex and are sent to /api/v1/payroll/comparison.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`, `apps/web/src/app/(app)/hr/payroll/comparison/PeriodCompareForm.tsx (new)`
- **Fix steps:**
  1. Replace the PERIOD_RE test with a shared isValidPeriod(s) helper (regex ^\d{4}-(0[1-9]|1[0-2])$) in apps/web/src/lib/period.ts, reusable by costing.
  2. In page.tsx compute per-field errors (missing vs malformed) when either searchParam is present and pass to the form; do not show the generic empty state in that case.
  3. Render the field error under each input with aria-invalid and aria-describedby; keep 44px targets.
  4. Prefer <input type="month"> with text fallback pattern="\d{4}-\d{2}" and update placeholders (see -05).
  5. Optionally extract a client PeriodCompareForm that validates on submit like costing/CostingPeriodForm.tsx.
- **Acceptance:**
  - Unit test isValidPeriod: '2026-8', '2026-13', '2026-00' false; '2026-08' true.
  - Manual: /hr/payroll/comparison?period1=2026-8&period2=2026-09 shows an inline error on Period 1 and no empty-state.
  - ?period1=2026-13&... is rejected client/server-side without calling the API.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only, but a stricter regex must not reject legitimate FY-period formats if backend uses another format (confirm with payroll-service owner).

### GAP-PAYROLL-COMPARISON-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** mapResponse returns null unless BOTH period1 and period2 are present (page.tsx:23–29), so the UI cannot say which period is missing — “one or both of the selected periods” (en.json noDataMessage).
- **Verified evidence:** mapResponse (page.tsx:25-29) returns null when either period is absent. fetchJson (apps/web/src/app/_data/apiClient.ts:162-167) converts a null mapping into source:'error', so the page shows the generic RefreshErrorState (:167-171), NOT the noDataMessage. The 'no comparison data' EmptyState (:173-181, en.json payrollComparison.noDataMessage 'one or both of the selected periods') is effectively unreachable (data null with source!=='error' cannot occur). True part: the UI cannot say which period is missing, and a missing period is mis-presented as a load failure. Backend response shape for a missing period is unverifiable (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Change mapResponse to return a discriminated result {period1: PeriodSummary|null, period2: PeriodSummary|null} instead of null when either side is missing (only return null for a truly malformed body).
  2. In the page, when a side is null render EmptyState naming the missing period(s) using new i18n keys noDataPeriod1/noDataPeriod2 with {period}.
  3. Keep RefreshErrorState only for source==='error' (HTTP/network failure).
  4. Remove the dead noDataMessage branch or make it the both-missing case.
- **Acceptance:**
  - Component test with mocked API returning only period1: page shows 'No data for 2026-09' and not RefreshErrorState.
  - Mocked 500: RefreshErrorState shown.
  - Both present: table renders as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Need to confirm with backend whether it returns 404 or a partial body for missing periods before finalising the mapping.

### GAP-PAYROLL-COMPARISON-03  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits manager/employee; the page then requests whole-department payroll totals. Backend guard not verifiable (payroll-service absent).
- **Verified evidence:** hr/layout.tsx:30-40 HR_ROLES includes 'manager' and 'employee' and the layout applies requireAnyRole(HR_ROLES) (:42-45; line numbers in the finding are off by ~4). comparison/page.tsx has no getSessionRoles/canAdminister check (contrast hr/payroll/page.tsx:12-17 which does). So a plain employee/manager can open the page and request org-wide gross/net/headcount. Whether payroll-service rejects them is unverifiable (only hrms-service in snapshot; no /payroll/comparison route found).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Define PAYROLL_ADMIN_ROLES once (currently duplicated as a const in hr/payroll/page.tsx:12) in a shared module, e.g. apps/web/src/lib/auth/payrollRoles.ts.
  2. At top of PayrollComparisonPage call requireAnyRole(PAYROLL_ADMIN_ROLES) (redirects to /dashboard) or render an access-denied EmptyState.
  3. Apply the same guard to the sibling pages costing, ctc, ddos, corrections (see their ROLEGATE findings); ideally add a hr/payroll/layout.tsx guard so all sub-routes are covered.
  4. Backend: confirm payroll-service guards GET /v1/payroll/comparison with payroll roles and returns 403 otherwise.
- **Acceptance:**
  - Unit/e2e: session with role 'employee' visiting /hr/payroll/comparison is redirected/denied and no fetch is made.
  - Session with payroll_officer sees the page unchanged.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium: role list must match what payroll-service accepts, else legitimate users (e.g. hr_admin) are locked out. Salary totals are sensitive.
- **Depends on:** GAP-PAYROLL-CTC-04, GAP-PAYROLL-COSTING-05, GAP-PAYROLL-DDOS-04, GAP-PAYROLL-CORRECTIONS-05

### GAP-PAYROLL-COMPARISON-04  ·  LOW  ·  partly  ·  theme FORMAT (was MONEY)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Deltas are absolute rupees only — no % change, no colour/sign cue beyond “+” (page.tsx:34–38); negative deltas print as “-₹…” with no “−” typographic sign or text alternative.
- **Verified evidence:** page.tsx:34-38 delta() = formatMoney(b-a) with '+' when positive; used at :108,:144,:150. Deltas are absolute only (no %), and negatives print via formatMoney (src/lib/formatters.ts:135) as ASCII '-₹...'. Not colour-coded. Also Number() of paise strings (:108,:144) loses precision above 2^53 paise (~9e13 rupees, practically unreachable) and violates the bigint rule in spirit. It does use formatMoney so paise handling is right; the finding's fix text ('no float math') is only marginally applicable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Compute delta with BigInt (BigInt(String(x))) then call formatMoney(bigint), avoiding Number().
  2. Add a percentage-change column (Number(delta)/Number(base) with '—' when base is 0) using Intl.NumberFormat('en-IN',{style:'percent',maximumFractionDigits:1}).
  3. Prefix using a real minus sign (U+2212) or add a visually-hidden 'decrease'/'increase' text plus an arrow icon; do not rely on colour alone.
  4. Add a shared formatSignedMoney(minor) helper in formatters.ts and use for the three delta cells.
- **Acceptance:**
  - Unit test formatSignedMoney(-15000n) => '−₹150.00' and (15000n) => '+₹150.00', 0 => '₹0.00'.
  - Page test: base 0 shows '—' for %.
  - Screen reader text reads 'decrease of ₹150.00'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display-only, but keep hyphen-minus in any exported/CSV value.

### GAP-PAYROLL-COMPARISON-05  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Placeholders “2025-05/2025-06” (page.tsx:69,82) are two years stale for a 2026-27 FY tenant and subtitle promises “month-on-month” while any two periods are accepted, including period2 earlier than period1.
- **Verified evidence:** Placeholders '2025-05' and '2025-06' at comparison/page.tsx:69 and :82, and en.json payrollComparison.emptyMessage repeats them. Subtitle 'Month-on-month comparison...' while any two periods are accepted; nothing enforces period2 > period1 or adjacency (delta is simply b-a). These are format examples, not fabricated data, so the FABRICATED tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/comparison/page.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Generate placeholders dynamically from the current month (previous month and current month) or use 'YYYY-MM'.
  2. Update emptyMessage to use ICU placeholders {example1}/{example2}.
  3. Either reword subtitle to 'Compare payroll totals between two periods' or validate/order the periods (swap so period1 <= period2, or show error).
  4. Decide product intent for arbitrary vs consecutive months.
- **Acceptance:**
  - Placeholder shows current year periods.
  - Entering period2 earlier than period1 shows either a validation message or the swapped, labelled result.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-PAYROLL-COMPARISON-01


---
## /hr/payroll/corrections  —  `payroll/corrections.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/corrections/page.tsx`
- **Design reference:** `redesign/payroll/corrections.html`

### GAP-PAYROLL-CORRECTIONS-02  ·  HIGH  ·  confirmed  ·  theme UUID (was CONFIRM)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Employee is entered and shown as a raw UUID (CreateCorrectionForm employeeId field; page.tsx:43-53 renders employee_id). Typing the wrong id corrects another person's salary; the confirm dialog echoes only the same id.
- **Verified evidence:** CreateCorrectionForm.tsx:165-178 is a free-text 'Employee ID' input (en.json employeeIdLabel); page.tsx:46 shows employee_id raw in the history column; the ConfirmDialog (CreateCorrectionForm.tsx:280-296) echoes {employeeId} only and passes no requireReason, though ConfirmDialog supports requireReason/minReasonLength (ds/ConfirmDialog.tsx:31-41). Reason is a separate optional input (:248-257). No name lookup. Maker-checker: the page only lists status; no approve action or maker/checker info exists in this tree, and enforcement is backend (payroll-service absent, cannot-verify). The finding's 'add ConfirmDialog' is partly stale - one exists; what is missing is name resolution and mandatory reason.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/corrections/CreateCorrectionForm.tsx`, `apps/web/src/app/(app)/hr/payroll/corrections/page.tsx`, `apps/web/src/app/_components/SmartCombobox.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Replace the Employee ID input with the existing SmartCombobox (src/app/_components/SmartCombobox.tsx) or a new EmployeePicker wrapping the hrms employees list API; store the id, display 'Name (EMP-code)'.
  2. In ConfirmDialog description show employee name + code, component, old/new amounts, effective date; set requireReason and minReasonLength (e.g. 10) and drop the separate Reason input, sending the dialog's reason as `reason` (onConfirm(reason)).
  3. In page.tsx enrich rows with employee name/code (batch lookup from hrms) and show them in colEmployee instead of employee_id.
  4. Backend: enforce maker != checker on approval and emit an audit event for correction create/approve (CLAUDE.md 3.8) - verify in payroll-service.
  5. Add tests for wrong-id prevention (unknown id not selectable).
- **Acceptance:**
  - Component test: cannot open confirm with a free-typed non-existent employee.
  - Confirm button stays disabled until reason >= min length; POST body includes reason.
  - History table shows employee name and code, no bare UUID.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: retroactive salary/arrears change on the wrong employee is a financial and PII incident; keep server-side authorisation and audit regardless of UI.
- **Depends on:** shared EmployeePicker/SmartCombobox

### GAP-PAYROLL-CORRECTIONS-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Rupee input converted with Math.round(parseFloat(v)*100) (CreateCorrectionForm.tsx:122, 289): parseFloat accepts "1e3" and trailing text, and binary floats misround some values (e.g. 1.005). Server receives paise, so errors are silent and permanent.
- **Verified evidence:** CreateCorrectionForm.tsx:98,106 validate with parseFloat (accepts '12abc'->12, '1e3'->1000, though type=number blocks most text in browsers) and :122-123 compute Math.round(parseFloat(v)*100); the confirm dialog at :289-290 does the same. 1.005*100=100.49999999999999 -> 100 (should be 101 under half-up); values like 8.325 similarly. No upper bound or max-2-decimals check. Server receives paise number; no server verification possible.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/corrections/CreateCorrectionForm.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add rupeesToPaise(input: string): bigint|null in formatters.ts using a strict regex ^\d+(\.\d{1,2})?$ and string/BigInt arithmetic (no floats); return null on invalid.
  2. Use it in handleSubmit validation (reject >2 decimals, exponent, trailing text) and in createCorrection and the dialog preview.
  3. Send oldValueMinor/newValueMinor as returned numbers only if <= Number.MAX_SAFE_INTEGER, else as strings per API contract (confirm).
  4. Reuse the helper in CtcCalculatorForm and other rupee inputs (repo-wide).
- **Acceptance:**
  - Unit: rupeesToPaise('1.005') null (3 decimals), '1.10' => 110n, '1e3' null, '12abc' null, '0.29' => 29n.
  - Form test: entering '1e3' shows oldValueInvalidError.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: money conversion change; add regression tests around existing whole-rupee and 2-dp values.
- **Depends on:** GAP-PAYROLL-CTC-03

### GAP-PAYROLL-CORRECTIONS-04  ·  MEDIUM  ·  partly  ·  theme FORMAT (was WIRING)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Reason is collected but never shown in history (page.tsx:43-53); Effective From is a free-text YYYY-MM-DD box, and dates render dd/mm/yyyy via formatIndianDate.
- **Verified evidence:** corrections/page.tsx:40-54 columns omit `reason` even though Row.reason exists (:18): confirmed. Effective From is a free-text input with placeholder '2025-04-01' validated by regex only (CreateCorrectionForm.tsx:91, 196-211): confirmed (no calendar validity, '2025-13-45' passes). History dates via formatIndianDate render dd/mm/yyyy (formatters.ts:2-7) while the input requires YYYY-MM-DD - a format mismatch but not a bug. 'Wiring' is somewhat mislabelled: it's a missing column plus weak date input.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/corrections/page.tsx`, `apps/web/src/app/(app)/hr/payroll/corrections/CreateCorrectionForm.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Add a `reason` column (colReason) to the columns array in page.tsx, truncated with title tooltip; handle null as '—'.
  2. Change Effective From to <input type="date"> (value stays YYYY-MM-DD) and validate with a real date parse.
  3. Optionally show a row-detail drawer for long reasons.
  4. Update placeholder to a current-FY date.
- **Acceptance:**
  - History table shows the recorded reason.
  - Typing 2026-02-30 is rejected; the native date picker is used.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-CORRECTIONS-05  ·  MEDIUM  ·  partly  ·  theme ROLEGATE (was OTHER)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Form visible to every hr role; retroactive pay changes are sensitive but no canAdminister gate exists here. Server guard not verifiable.
- **Verified evidence:** corrections page and form (page.tsx:80, CreateCorrectionForm.tsx) have no role check; hr/layout.tsx:30-45 admits employee/manager. Only hr/payroll/page.tsx:12-17 defines PAYROLL_ADMIN_ROLES/canAdminister. Server guard is unverifiable (payroll-service absent). The list of all employees' corrections is also fetched for any role.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/corrections/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Reuse shared PAYROLL_ADMIN_ROLES (see COMPARISON-03).
  2. Call requireAnyRole(PAYROLL_ADMIN_ROLES) in CorrectionsPage, or at minimum render CreateCorrectionForm only when canAdminister.
  3. Backend: verify POST/GET /v1/payroll/corrections role guard and audit event.
- **Acceptance:**
  - Employee role: page redirects or shows no form; no fetch.
  - payroll_officer: form visible.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium: retroactive pay changes; UI gate is defence in depth only.
- **Depends on:** GAP-PAYROLL-COMPARISON-03

### GAP-PAYROLL-CORRECTIONS-06  ·  LOW  ·  partly  ·  theme COPY (was LOADING)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** LOP Ledger is a paragraph, not a ledger (page.tsx:104); loading.tsx is a bare skeleton; form stays visible on load error.
- **Verified evidence:** LOP card (page.tsx:102-106) is a description paragraph only: confirmed. loading.tsx is a single .skeleton div with no header/stat shape: confirmed. Form stays visible on load error (CreateCorrectionForm at :80 is outside the errored branch, only history swaps to RefreshErrorState :83-86): true, and arguably desirable so users can still record; stats show null->'—' correctly. error.tsx exists in the folder (not reviewed as broken).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/corrections/page.tsx`, `apps/web/src/app/(app)/hr/payroll/corrections/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Rename the card or replace it with a real read-only LOP adjustments table if an endpoint exists (none in snapshot - decision) else reword title to 'Loss of Pay'.
  2. Rebuild loading.tsx with PageHeader placeholder + StatGrid skeleton + table skeleton using ds/Skeleton.
  3. Decide whether to hide the form when load fails (product call).
- **Acceptance:**
  - Loading state shows header/stat/table skeleton matching the page.
  - LOP card title matches its content.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /hr/payroll/costing  —  `payroll/costing.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`
- **Design reference:** `redesign/payroll/costing.html`

### GAP-PAYROLL-COSTING-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was UUID)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Cost Center column is fabricated: costCenterCode = `CC-${cost_center_id.split("-")[0]}` (costing/page.tsx:33) — the first UUID segment dressed up as a ledger code. It matches no cost-centre master and would be mistaken for a real code in a costing report.
- **Verified evidence:** costing/page.tsx:33 sets costCenterCode = `CC-${r.cost_center_id.split('-')[0]}` and the Cost Center column (:58) displays it. It is derived from the first UUID segment, not a master code; throws if cost_center_id is not a string (mapResponse would crash the page). No cost-centre name/code is fetched (finance/cost-centre master not accessible in this snapshot; cross-service names must come via API).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Do not synthesise a code. Ask the API (payroll-service report endpoint) to return cost_center_code and cost_center_name; map those to the column (cannot-verify whether it already does).
  2. If the API cannot, resolve names via the finance/master-data cost-centre list API in the page loader and join in TS by id (no cross-service SQL).
  3. Fall back to showing the full id in a monospace muted style with a 'Unresolved' label rather than a fake code.
  4. Guard r.cost_center_id typing in mapResponse.
- **Acceptance:**
  - Table shows real cost-centre code + name.
  - Unknown id shows 'Unresolved (id …)' not 'CC-xxxx'.
  - No exception when cost_center_id is null.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: misleading cost-accounting labels; reports may be reconciled to GL.
- **Depends on:** GAP-PAYROLL-COSTING-02

### GAP-PAYROLL-COSTING-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Rules can be created but never listed: the “Costing Rules” card is a hard-coded “not yet available” EmptyState (page.tsx:78–101), the form takes a raw “Cost Center ID (UUID)” (CreateCostingRuleForm.tsx:98) and validates only presence (lines 34–48; max 100 per rule). Nothing checks that a group’s splits sum to 100%, and a wrong rule cannot be found or corrected.
- **Verified evidence:** costing/page.tsx:81-101 Costing Rules card is a hard-coded EmptyState (rulesEmptyTitle 'Rules list not yet available'); comment :82-95 says GET /v1/payroll/costing/rules exists in payroll-service (unverifiable). CreateCostingRuleForm.tsx:96-110 takes a raw text 'Cost Center ID (UUID)' (en.json costCenterIdLabel); validation :35-48 is presence only; split is type=number min0 max100 (:113) with no check that a group's rules sum to 100, no UUID format check, no duplicate check. No edit/delete UI.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`, `apps/web/src/app/(app)/hr/payroll/costing/CreateCostingRuleForm.tsx`, `apps/web/src/app/(app)/hr/payroll/costing/CostingRulesTable.tsx (new)`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. In page.tsx add getRules() via fetchJson('/api/v1/payroll/costing/rules') with its own error state (RefreshErrorState) separate from the report, and render DataTable grouped by employee group with a per-group total split column.
  2. Replace the Cost Center ID input with SmartCombobox backed by the cost-centre list API; store id, display code + name.
  3. Validate in the form: split integer/decimal 0<split<=100 and warn (or block per backend contract) if the group's existing rules + this rule != 100; show running total.
  4. Add edit/deactivate actions gated by canAdminister (needs backend endpoints - confirm).
  5. Backend: enforce sum==100 per group and emit an audit event.
- **Acceptance:**
  - Rules table lists created rule after save (router.refresh).
  - Group with 60% + 30% shows warning 'Total 90% (must be 100%)'.
  - Typing a non-existent cost centre is impossible.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: incorrect split rules misallocate payroll cost; server must be authoritative.
- **Depends on:** GAP-PAYROLL-COSTING-01

### GAP-PAYROLL-COSTING-03  ·  MEDIUM  ·  confirmed  ·  theme EMPTYSTATE (was WIRING)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Before any period is chosen the StatGrid shows real-looking zeros (page.tsx:50 fallback {data:[],source:"api"} → rows.length = 0) instead of “—”.
- **Verified evidence:** costing/page.tsx:50 sets result={data:[],source:'api'} when no period; errored=false so StatCards at :74-76 show rows.length=0, uniqueCostCenters=0, uniqueEmpGroups=0 with labels '(this period)' although no period is selected. StatCard renders null as '—' (used elsewhere), so the fix is trivial. Theme WIRING is roughly right; more a placeholder/empty-state issue.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`
- **Fix steps:**
  1. Introduce `const noPeriod = !period;` and pass value={errored || noPeriod ? null : ...} to the three StatCards.
  2. Optionally hide the StatGrid until a period is chosen.
- **Acceptance:**
  - /hr/payroll/costing with no period: stats show '—'.
  - With ?period=2026-08 and empty result: stats show 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.

### GAP-PAYROLL-COSTING-04  ·  MEDIUM  ·  confirmed  ·  theme ERRORSTATE (was OTHER)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Period form lives inside the branch swapped for RefreshErrorState (page.tsx:114–122); after a failed report fetch the user cannot retype the period.
- **Verified evidence:** costing/page.tsx:104-127: when errored, the whole card body is RefreshErrorState (:104-107) and <CostingPeriodForm> (:110) is only rendered in the else branch (actual lines 108-127, not 114-122). After a failed report fetch the user must edit the URL to try another period; RefreshErrorState may offer refresh of the same period only.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`
- **Fix steps:**
  1. Render <CostingPeriodForm initialPeriod={period} /> above the errored/non-errored conditional so it is always visible.
  2. Keep RefreshErrorState (retry) below it for errored.
- **Acceptance:**
  - Mock report 500: error state and period input both visible; submitting another period navigates and refetches.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.

### GAP-PAYROLL-COSTING-05  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** No page-level role gate (hr/layout.tsx:26–42 admits employee/manager) on a screen that writes cost-accounting rules; role guard on POST cannot be verified — payroll-service absent.
- **Verified evidence:** No role check in costing/page.tsx or CreateCostingRuleForm.tsx; hr/layout.tsx:30-45 admits employee/manager (line numbers in finding are ~4 off). The form POSTs /v1/payroll/costing/rules. Server guard unverifiable (payroll-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Use shared PAYROLL_ADMIN_ROLES; requireAnyRole on the page (or hide form + rules for non-admins).
  2. Backend: confirm role guard + audit emission on POST costing/rules.
- **Acceptance:**
  - Employee session: redirected/denied; no POST form rendered.
  - Admin: unchanged.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium; cost-accounting rules affect GL allocation.
- **Depends on:** GAP-PAYROLL-COMPARISON-03

### GAP-PAYROLL-COSTING-06  ·  LOW  ·  confirmed  ·  theme FORMAT (was OTHER)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Split % column prints the bare number without “%” (page.tsx:46) and periods are typed as free text.
- **Verified evidence:** Split % column (page.tsx:60) has no cellType/format, so the number prints bare (e.g. '60'), and rules-form confirm text does add '%' (en.json confirmDescription). Period input is free text: CostingPeriodForm.tsx:17 regex ^\d{4}-\d{2}$ shows periodFormatError but accepts month 00/13-99 and there is no <input type=month>. Page also passes any ?period= string to the API without validating.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/costing/page.tsx`, `apps/web/src/app/(app)/hr/payroll/costing/CostingPeriodForm.tsx`, `apps/web/src/lib/period.ts (new, shared)`
- **Fix steps:**
  1. Add displayed field splitPctLabel = `${r.split_pct}%` in mapResponse and point the column to it (DataTable render cannot cross RSC boundary, precompute string).
  2. Use <input type="month"> and shared isValidPeriod in CostingPeriodForm and in page.tsx before fetching.
- **Acceptance:**
  - Table shows '60%'.
  - '2026-13' rejected in the form and via URL.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-PAYROLL-COMPARISON-01


---
## /hr/payroll/ctc  —  `payroll/ctc.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/ctc/page.tsx`
- **Design reference:** `redesign/payroll/ctc.html`

### GAP-PAYROLL-CTC-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** “Active Components” counts is_active (page.tsx:69) but the table has no Active column and lists inactive rows alongside active ones (columns page.tsx:55–61), so the KPI cannot be reconciled with the table.
- **Verified evidence:** ctc/page.tsx:69 activeComponents counts is_active and StatCard 'Active Components' (:83) shows it; columns (:60-66) omit is_active and rows include inactive ones, so KPI and table do not reconcile. en.json emptyMessage claims 'No active ... rows', implying the API returns only active rows - unverifiable (payroll-service absent); if so the KPI always equals Configured.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ctc/page.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Add an Active/Inactive status column (map is_active to StatusPill label in precomputed string field) or filter the table to active rows.
  2. If backend only returns active rows, drop the KPI or rename.
  3. Align the emptyMessage wording.
- **Acceptance:**
  - Table with 1 inactive row shows 'Inactive' badge; KPI equals count of Active rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-CTC-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Title says “Configuration” yet there is no add/edit control anywhere in the page tree — the rules are read-only here; the only interactive element is a stateless calculator.
- **Verified evidence:** Folder ctc/ contains only page.tsx, CtcCalculatorForm.tsx, error.tsx, loading.tsx. Title 'CTC Configuration' (en.json payrollCtc.title) but the page only lists rows read-only and offers a calculator; no create/edit/deactivate link. No write endpoint is referenced in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ctc/page.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Product decision: either rename to 'CTC Component Rules' with subtitle stating read-only, or add create/edit forms (needs backend PUT/POST for payroll_ctc_config).
  2. If read-only, add a note on where rules are managed.
- **Acceptance:**
  - Title/subtitle accurately describe capability.
  - If edit added: PUT with confirm dialog + audit.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low if just renamed; edit forms carry statutory-percentage risk.

### GAP-PAYROLL-CTC-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Value formatting assumes fixed/formula amounts are paise (page.tsx:44–50) while the inline comment calls them “minor-unit rupees”; a calc_type “formula” value is a rule, not money, yet is rendered through formatMoney when numeric — unit ambiguity risks a 100x display error.
- **Verified evidence:** ctc/page.tsx:41-49: pct types render `${Number(v)}%`; non-pct render formatMoney(c.value) (treats value as PAISE) when numeric, else String(value). Comment at :44 says 'minor-unit rupees' (self-contradictory). For calc_type 'formula' a numeric value would be formatted as money though it is a rule/coefficient; non-numeric formula strings show raw. Whether fixed 'value' is stored as paise or rupees is unverifiable (payroll-service/schema absent) - 100x error risk is real but unproven.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ctc/page.tsx`
- **Fix steps:**
  1. Confirm unit of payroll_ctc_config.value for 'fixed' with the payroll-service schema and correct the comment.
  2. Only apply formatMoney when calc_type==='fixed'; render 'formula' via String(value) with a Formula label.
  3. Document the unit in the ConfigRow type (value_minor vs value).
- **Acceptance:**
  - Fixed row with value 1500000 shows ₹15,000.00 (if paise).
  - Formula row never shown with ₹.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium: showing statutory/fixed amounts off by 100x.
- **Depends on:** GAP-PAYROLL-CORRECTIONS-03

### GAP-PAYROLL-CTC-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 lets employee/manager open the page; configured statutory percentages (NPS employer, gratuity) become visible to all. Backend guard not verifiable (payroll-service absent).
- **Verified evidence:** ctc/page.tsx has no role check; hr/layout.tsx:30-45 lets employee/manager in; page lists statutory component rules (percentages). These are configuration rather than personal data, so sensitivity is lower than for comparison/corrections. Server guard unverifiable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ctc/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Decide whether CTC rules are visible to all employees (transparency) or payroll only.
  2. If restricted, apply requireAnyRole(PAYROLL_ADMIN_ROLES).
- **Acceptance:**
  - Employee session: redirect if restricted; else page shows read-only.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-COMPARISON-03

### GAP-PAYROLL-CTC-05  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** EmptyState message leaks an internal table name — “No active payroll_ctc_config rows…” (en.json payrollCtc.emptyMessage); the calculator uses a POST for a pure computation (CtcCalculatorForm.tsx:38), so it is unaudited/uncached by design.
- **Verified evidence:** en.json payrollCtc.emptyMessage 'No active payroll_ctc_config rows are configured for this tenant.' leaks a table name: confirmed. CtcCalculatorForm.tsx:38-41 POSTs v1/payroll/ctc/calculate: it is a pure computation on POST; that is acceptable design, not a defect, and 'unaudited' is a non-issue for a read-like calc (CLAUDE.md audits mutations). Also CtcCalculatorForm.tsx:31,38 uses Math.round(parseFloat*100) same as CORRECTIONS-03.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`, `apps/web/src/app/(app)/hr/payroll/ctc/CtcCalculatorForm.tsx`
- **Fix steps:**
  1. Reword emptyMessage: 'No CTC components are configured for this tenant yet.'
  2. Use shared rupeesToPaise in the calculator.
  3. No change for POST.
- **Acceptance:**
  - Empty state shows no table name.
  - Calculator uses strict paise conversion.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.
- **Depends on:** GAP-PAYROLL-CORRECTIONS-03


---
## /hr/payroll/ddos  —  `payroll/ddos.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`
- **Design reference:** `redesign/payroll/ddos.html`

### GAP-PAYROLL-DDOS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Departments are mapped by typing comma-separated UUIDs into a text box (CreateDdoForm.tsx:56, en.json departmentIdsLabel). A mistyped or stale id is accepted, silently mapping payroll to the wrong department; no picker, no validation of existence.
- **Verified evidence:** CreateDdoForm.tsx:55-58 splits departmentIdsRaw on commas with no UUID or existence validation; the field (:112-115) is a single text input labelled 'Department IDs (comma-separated UUIDs)' (en.json). Sent to POST v1/payroll/ddos. Backend validation unverifiable, but nothing in the UI prevents typos, and the save replaces the mapping.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ddos/CreateDdoForm.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`, `apps/web/src/app/_components/SmartCombobox.tsx`, `apps/web/src/app/(app)/hr/payroll/src/messages/en.json`
- **Fix steps:**
  1. Replace the text box with a multi-select department picker (SmartCombobox or new DepartmentMultiPicker) fed by the hrms departments list API (hr/departments/DepartmentsTable exists).
  2. Submit ids only from picker selections; show chips with department names.
  3. Add client zod check that each id is a UUID.
  4. Backend: validate that department ids exist in the tenant (confirm).
- **Acceptance:**
  - Cannot submit a free-typed id; selected departments appear as named chips.
  - Payload departmentIds equals selected ids.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: wrong department mapping misdirects salary disbursement/DDO reporting.
- **Depends on:** shared EntityPicker/SmartCombobox

### GAP-PAYROLL-DDOS-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Save replaces all department mappings for a DDO code (en.json confirmDescription) with no diff and no reason; the table then shows only a count (page.tsx:34), so the user cannot verify what changed. Audit emission cannot be verified (payroll-service source absent; CLAUDE.md §3.8).
- **Verified evidence:** ConfirmDialog exists (CreateDdoForm.tsx:130-143) and its text explicitly warns 'Existing department mappings for this DDO code are replaced' (en.json createDdoForm.confirmDescription), so the user is warned; but no diff of existing vs new mappings and no requireReason. Table shows only departmentCount (ddos/page.tsx:26,34). Audit event emission unverifiable (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ddos/CreateDdoForm.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`
- **Fix steps:**
  1. Before confirm, look up the existing DDO row (from the loaded list passed as prop) and show added/removed departments in the dialog description.
  2. Set requireReason (min length) on ConfirmDialog and send it as `reason` (needs backend field).
  3. Add departments column showing names (see DDOS-03).
  4. Backend: verify audit event includes before/after department sets.
- **Acceptance:**
  - Saving an existing code shows a diff in the dialog.
  - Confirm disabled until reason entered.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: silent replacement of DDO mappings affects payroll disbursement.
- **Depends on:** GAP-PAYROLL-DDOS-01, GAP-PAYROLL-DDOS-03

### GAP-PAYROLL-DDOS-03  ·  MEDIUM  ·  confirmed  ·  theme MISSINGFEATURE (was OTHER)

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** No edit, deactivate or delete: a wrong DDO can only be overwritten by re-saving the same code. The table cannot show which departments a DDO covers.
- **Verified evidence:** ddos/page.tsx columns (:31-35) are ddoCode, name, departmentCount only; there are no row actions, and CreateDdoForm is the only write path (POST v1/payroll/ddos, upsert by code per confirm text). No edit/deactivate/delete controls or endpoints in the web tree.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/CreateDdoForm.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/DdoRowActions.tsx (new)`
- **Fix steps:**
  1. Show department names (chips or tooltip) in the table by resolving departmentIds through the departments API.
  2. Add row action 'Edit' that prefills the form (code readonly) and 'Deactivate' with ConfirmDialog (requires backend PATCH/DELETE - confirm).
  3. Show an 'Active' status column.
- **Acceptance:**
  - Row shows which departments a DDO covers.
  - Edit prefill works; deactivate removes it from active list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: deactivating a DDO in use affects payroll runs; backend must check dependencies.
- **Depends on:** GAP-PAYROLL-DDOS-02

### GAP-PAYROLL-DDOS-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Form is visible to every hr/layout.tsx role (no canAdminister check); non-admins will hit a 403 after filling it.
- **Verified evidence:** No role check in ddos/page.tsx or CreateDdoForm.tsx; hr/layout.tsx admits employee/manager. Claim that non-admins 'will hit a 403 after filling it' is an inference; backend guard is unverifiable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Use shared PAYROLL_ADMIN_ROLES; render CreateDdoForm only for admins or guard the page.
  2. Backend: verify role guard.
- **Acceptance:**
  - Employee session: no form (or redirect).
  - Admin: form visible.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium.
- **Depends on:** GAP-PAYROLL-COMPARISON-03

### GAP-PAYROLL-DDOS-05  ·  LOW  ·  partly  ·  theme VALIDATION (was LOADING)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** DDO code has only maxLength 32 (CreateDdoForm.tsx:89) — no format check; form stays visible on load error; "Avg Depts / DDO" is a toFixed string (page.tsx:29); loading.tsx has no header.
- **Verified evidence:** CreateDdoForm.tsx:89 maxLength 32 and presence-only check (:35-47): confirmed, no format check (DDO codes are usually alphanumeric; format spec not in snapshot). Form outside the errored branch (page.tsx:53) stays visible on load error. avgDepts = (total/len).toFixed(1) string (page.tsx:29): it is display only, fine, and '0' when empty. loading.tsx is just a skeleton with no header (ddos/loading.tsx). Mostly cosmetic.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/ddos/CreateDdoForm.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/ddos/page.tsx`
- **Fix steps:**
  1. Add a zod schema for ddoCode (^[A-Za-z0-9-]{1,32}$ or the government format agreed) and show field error.
  2. Give loading.tsx a PageHeader/StatGrid skeleton (shared component with other payroll loading files).
  3. Show '—' for avg when there are no DDOs.
- **Acceptance:**
  - Code with spaces is rejected inline.
  - Loading shell matches page layout.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; a too-strict code pattern could reject legitimate codes - confirm the format.


---
## /hr/payroll/disbursement  —  `payroll/disbursement.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`
- **Design reference:** `redesign/payroll/disbursement.html`

### GAP-PAYROLL-DISBURSEMENT-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Full bank account numbers are printed for every employee in the transfers table (DisbursementTransferTable.tsx:173 tx.accountNumber, monospace, no mask, no reveal control) to whoever reaches this page — DPDP-sensitive financial identifiers on a screen any hr role can open.
- **Verified evidence:** DisbursementTransferTable.tsx:172-175 renders tx.accountNumber in a .mono div with tx.ifsc beneath, unmasked, with no reveal control; the employee UUID is also printed (:170). page.tsx has no role check (no getSessionRoles call) and hr/layout.tsx:26-42 HR_ROLES includes manager and employee, so any of those roles reaches the page; server-side field masking or role guard on GET /payroll/disbursement/transfers cannot be verified. There is no shared Masked component in apps/web/src (only an unrelated MaskedInput in employees/new/steps/Step4.tsx); SponsorBankConfigForm.tsx:100 already shows only last4 of the sponsor account, a precedent.
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/hr/payroll/disbursement/DisbursementTransferTable.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `payroll-service transfers route (not in snapshot)`
- **Fix steps:**
  1. Backend: return accountNumberMasked (last 4) by default; add an audited reveal endpoint or field gated to payroll_admin, emitting an audit event with actor, employee and purpose.
  2. Create <Masked value/ last4 revealable onReveal> in ds/ with aria-label and a reveal button that calls the audited endpoint and auto-hides after 30 s.
  3. In DisbursementTransferTable replace tx.accountNumber with <Masked>; show the employee name only and drop the raw employeeId line.
  4. page.tsx: read getSessionRoles(); if the role is not payroll_admin/payroll_officer/super_admin render PermissionDenied for the transfers card (and the sponsor/DSC cards, see DISB-04).
  5. Ensure any CSV export of transfers also masks.
- **Acceptance:**
  - Component test: row renders '••••1234' with no full number in the DOM.
  - Component test: Reveal calls the reveal endpoint once and shows the full value; hides after timeout.
  - Manual: an 'employee' role user gets a permission-denied card, not the table.
  - API test: reveal writes an audit row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP-relevant PII exposure; hiding the number may slow payroll officers reconciling with the bank, so reveal must be quick for authorised roles.
- **Depends on:** GAP-PAYROLL-DISBURSEMENT-04

### GAP-PAYROLL-DISBURSEMENT-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1757 (merged)
- **First-pass claim:** Bank-file wizard lists runs with status completed OR paid (page.tsx:91): a file can be generated before approval (bypassing maker-checker on /hr/payroll/{id}) and again for an already-paid run (duplicate payment file). Download is a plain GET with no confirmation, reason or visible audit (BankFileWizard.tsx:84).
- **Verified evidence:** disbursement/page.tsx:91 eligibleRuns = runs with status 'completed' or 'paid'. The run stepper treats 'completed' as the Review step, before Approve (PayrollRunStepper.tsx:17-18), while 'approved' (the state right before Disburse) is excluded, so the eligibility filter looks inverted; whether 'completed' means pre-approval in the backend is not verifiable (payroll-service absent). 'paid' runs are eligible, so a second file for an already-paid run can be generated. BankFileWizard.tsx:84 downloads via browserFetch GET v1/payroll/runs/{id}/bank-file?format=... with no ConfirmDialog, no reason, and no client audit; whether the server audits/blocks a repeat is cannot-verify. Wizard empty copy says 'completed or paid' (en.json emptyMessage) while NachReturn copy says 'approved or disbursed', inconsistent.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileWizard.tsx`, `apps/web/src/messages/en.json`, `payroll-service bank-file route (not in snapshot)`
- **Fix steps:**
  1. Decision/backend: fix the exact eligible statuses (likely 'approved' for first file; 'paid' only for a labelled re-issue).
  2. page.tsx: derive eligibleRuns from that agreed list and pass a per-run flag alreadyGenerated/paid.
  3. BankFileWizard: before the GET, open <ConfirmDialog requireReason minReasonLength=10> stating run, format, net amount and, if paid, 'A file was already generated on <date>'; send the reason as a query/header.
  4. Backend: make bank-file generation write an audit event (run, format, actor, reason) and reject files for unapproved runs; store generation timestamps to show on the wizard.
  5. Align emptyMessage and nachReturnEmptyMessage with the chosen statuses.
- **Acceptance:**
  - Unit test: eligibleRuns excludes draft/processing/failed and, per decision, completed.
  - Component test: clicking Download opens ConfirmDialog; confirm disabled until reason >= 10 chars; GET fires only after confirm.
  - API test: bank-file for an unapproved run returns 409; each successful call writes an audit row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate payment file for crores of salary; tightening eligibility could block a legitimate re-issue after a bank rejection, so keep an audited re-issue path.
- **Depends on:** GAP-PAYROLL-DETAIL-02

### GAP-PAYROLL-DISBURSEMENT-03  ·  HIGH  ·  partly  ·  theme CONFIRM (was I18N)

- [x] **Status** — PR #1830 (merged): signed by default (PGP detached / XML-DSig / PKCS#7) via #1830
- **First-pass claim:** DSC Signing step signs nothing: it only displays certificate metadata, "Next" stays enabled with no DSC, and the copy says "you can still download an unsigned file" (BankFileWizard.tsx:199-243). A payment file for crores can leave unsigned while the stepper shows a signing step as done.
- **Verified evidence:** BankFileWizard.tsx:199-243: step 2 shows certificate metadata (subjectCn, notAfter, first 24 chars of sha256) or the 'No DSC configured' warning; the Next button (:239) has no disabled condition, and en.json dscNotConfiguredMessage says 'You can still download an unsigned file.' StepBar marks the step done once step > 2 (:26). The browser does no signing, but whether the server signs the file with the stored DSC during GET bank-file cannot be verified (payroll-service absent), so 'signs nothing' is overstated; the UI gives no indication in either case (the downloaded step shows no 'signed' status). Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileWizard.tsx`, `apps/web/src/messages/en.json`, `payroll-service bank-file route (not in snapshot)`
- **Fix steps:**
  1. Decision: is an unsigned file ever acceptable? If not, disable 'Next: Download' when dscConfig is null or notAfter is in the past and link to the DSC card.
  2. Backend: return a signed flag/header (e.g. X-Bank-File-Signed) from bank-file GET and include it in the response.
  3. On the download step display 'Signed with <subject CN>' or a prominent 'UNSIGNED' warning, based on that flag.
  4. If unsigned downloads stay allowed, require an extra acknowledge checkbox and record it in the audit reason.
  5. Warn when the certificate expires within 30 days.
- **Acceptance:**
  - Component test: dscConfig=null disables Next on step 2 (if decision is block).
  - Component test: expired notAfter shows an error and blocks.
  - Component test: success screen shows 'Signed' or 'UNSIGNED' from the response header.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Banks reject unsigned files; blocking downloads may stop payroll if DSC is misconfigured, so pair with a clear path to fix the DSC.
- **Depends on:** GAP-PAYROLL-DISBURSEMENT-02

### GAP-PAYROLL-DISBURSEMENT-04  ·  HIGH  ·  confirmed  ·  theme ROLEGATE (was OTHER)

- [x] **Status** — PR #1757 (merged)
- **First-pass claim:** Sponsor bank configuration and DSC upload/remove are visible and enabled for every hr/layout.tsx role (no canAdminister in page.tsx or the forms). DSC upload sends the P12 keystore and passphrase as base64 JSON from the browser (DscConfigForm.tsx:22-31,83). Server role guard and audit not verifiable (payroll-service absent).
- **Verified evidence:** disbursement/page.tsx has no getSessionRoles/canAdminister; SponsorBankConfigForm and DscConfigForm are rendered unconditionally (:185-191) and grep for 'role|canAdminister' in the folder finds only ARIA role attributes. hr/layout.tsx:26-42 HR_ROLES includes hr_officer, manager and employee, so all can see and submit them. DscConfigForm.tsx:22-33 fileToBase64 and :84-87 PUT v1/payroll/dsc-config with JSON {p12Base64, passphrase} from the browser (finding said :83, it is :84-87); DELETE at :104. Delete/upload are confirmed via ConfirmDialog (openConfirm/deleteConfirmOpen) but with no reason. Server role guard and audit are cannot-verify (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/DscConfigForm.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/SponsorBankConfigForm.tsx`, `payroll-service dsc-config and sponsor-bank-config routes (not in snapshot)`
- **Fix steps:**
  1. page.tsx: call getSessionRoles(); define canConfigure = payroll_admin || super_admin (decision on payroll_officer) and render the Sponsor Bank and DSC cards only for those roles; others see read-only status.
  2. Also gate the whole page (transfers, wizard) to payroll roles; show PermissionDenied otherwise.
  3. DscConfigForm/SponsorBankConfigForm: add requireReason to confirm dialogs; backend must audit upload, replace and delete.
  4. Backend: enforce the same role on PUT/DELETE dsc-config and sponsor-bank-config; consider multipart upload or a server-side key store/HSM instead of passing the P12 passphrase in JSON; never log the body.
  5. Clear passphrase state on dialog close/unmount (already cleared after success).
- **Acceptance:**
  - Component test: role 'hr_officer' renders no DSC/Sponsor forms.
  - Manual: role 'employee' opening /hr/payroll/disbursement sees a permission-denied view.
  - API test: PUT dsc-config with a non-admin token returns 403; audit row written for admin upload.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Signing key and bank credentials; wrong gating could lock out the only admin, so keep super_admin bypass.

### GAP-PAYROLL-DISBURSEMENT-05  ·  MEDIUM  ·  partly  ·  theme FABRICATED

- [x] **Status** — PR #1757 (merged)
- **First-pass claim:** Preview step is decorative: Record Count is a literal "—" and the sample row is hard-coded "EMP001 | period | CREDIT | {whole run net} | SALARY" (BankFileWizard.tsx:166-190); the user approves a file preview that shows one fake line carrying the entire run total.
- **Verified evidence:** BankFileWizard.tsx:173-178 preview table shows Pay Period, Format, Net Amount (run total), Run ID and Record Count as literal '—' (:178); :187-190 prints en.json previewSampleHeader '[Sample — header row]' then a hard-coded line 'EMP001 | {payPeriod} | CREDIT | {run net} | SALARY'. It is labelled '[Sample — header row]' so it is disclosed, but the line is fabricated and carries the whole run total as a single employee. No preview endpoint call exists; a real transfer count would come from GET /payroll/disbursement/transfers (already fetched on the page) or the run's employeeCount (available in the runs list, RunRow.employeeCount page.tsx:17 but not passed to the wizard).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileWizard.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. page.tsx: pass employeeCount from RunRow into the wizard runs option.
  2. BankFileWizard: replace the '—' Record Count with selectedRun.employeeCount.
  3. Delete the hard-coded EMP001 line and previewSampleHeader; if a real preview is wanted, add a backend preview endpoint (first N records, masked account numbers) and render that, else show 'Preview not available'.
  4. Show the selected format's field layout description (formatLabels desc) instead of fake data.
- **Acceptance:**
  - Component test: preview shows the run's employee count and no 'EMP001' text.
  - Grep test: no hard-coded 'EMP001' in disbursement/.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only misleading placeholder content is removed.
- **Depends on:** GAP-PAYROLL-DISBURSEMENT-08

### GAP-PAYROLL-DISBURSEMENT-06  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** — PR #1757 (merged)
- **First-pass claim:** Salary credits are offered as "NACH Debit (Text) — NPCI 120-char mandate file" (en.json formatNachLabel); debit mandates collect money, salaries are credits (NACH credit / APBS / NEFT). Default format is that option (BankFileWizard.tsx useState nach).
- **Verified evidence:** en.json bankFileWizard.formatNachLabel = 'NACH Debit (Text)' and formatNachDesc = 'NPCI 120-char mandate file'; BankFileWizard.tsx:61 defaults format to 'nach' and the value maps to the ?format=nach query (:84). Salary payments are credits, so the label is semantically off, but what the server nach file actually contains (NACH credit vs debit) cannot be verified; the disbursement page also has NachMandateForm (debit mandates, for deductions/recoveries). Also csv default label 'NEFT / RTGS (CSV)' and 'apbs' are appropriate for credits.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json (if present)`, `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileWizard.tsx`
- **Fix steps:**
  1. Confirm with backend whether ?format=nach emits an ACH credit file (NACH-Cr) or a debit mandate file.
  2. Rename formatNachLabel to 'NACH Credit (Text)' (or the correct term) and fix formatNachDesc; remove 'mandate'.
  3. Change the default useState to the tenant's configured format (from sponsor config nachEnabled/apbsEnabled) or 'csv', and disable formats whose sponsor flag is off.
- **Acceptance:**
  - Manual: the label reads NACH Credit and matches the generated file's transaction code.
  - Component test: with sponsorConfig.nachEnabled=false the NACH option is disabled.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Mislabelling a debit file as salary could cause a wrong-direction bank instruction if the label is right and the file is debit; verify the file, not just the label.

### GAP-PAYROLL-DISBURSEMENT-07  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Failed transfers fetch renders "No transfers yet" (false empty) because the table gets no error flag (page.tsx:149 vs :132); Retry needs confirmation but no reason and can duplicate a credit if the bank status was only delayed.
- **Verified evidence:** disbursement/page.tsx:107 computes transfersErrored and uses it for the stat cards (:123-124, :137-138) but line 149 renders <DisbursementTransferTable transfers={transfers} /> with the default [] on error, so DisbursementTransferTable.tsx:100-107 shows 'No transfers yet' (a false empty). By contrast the NACH return card handles errors with RefreshErrorState (:170-173). Retry is ConfirmDialog without requireReason (DisbursementTransferTable.tsx:209-230) and POSTs v1/payroll/disbursement/transfers/{id}/retry (:86-89); retry is only offered for status 'failed' (:189) but the failed state could be a delayed bank response; server idempotency/duplicate-credit protection is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/DisbursementTransferTable.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. page.tsx: render RefreshErrorState (toHumanError('load', {area:'bank transfers'})) inside the transfers Card when transfersErrored, as done for runsErrored at :170.
  2. Only mount DisbursementTransferTable when not errored.
  3. Retry dialog: set requireReason, minReasonLength={10}, and show the amount and failure reason (already in description); add an Idempotency-Key header to the retry POST.
  4. Backend: reject retry when the bank has not returned a terminal failure, and audit retries.
- **Acceptance:**
  - Component test: page with transfers fetch error renders RefreshErrorState and not 'No transfers yet'.
  - Component test: retry confirm disabled until reason >= 10 chars.
  - API test: a second retry for the same transfer within N seconds returns the same result/409.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Retrying a payment that actually succeeded duplicates salary; reason plus idempotency reduces but does not remove the risk without backend checks.

### GAP-PAYROLL-DISBURSEMENT-08  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Mixed units in one page: runs in rupees (page.tsx, local Intl formatter), transfers amountRupees, mandates amountMinor via Math.round(Number(v)*100) (NachMandateForm.tsx); BankFileForm.tsx is dead code beside the wizard. NACH mandate form captures no account or IFSC — source of bank details is not visible in code.
- **Verified evidence:** page.tsx:111-117 comment states run amounts are RUPEES and formats them with a local Intl.NumberFormat (inrFormatter, also unused in the sampled lines since the wizard/table build their own: BankFileWizard.tsx:20 inrFmt, DisbursementTransferTable.tsx:23 inrFmt); TransferRow.amountRupees is rupees (DisbursementTransferTable.tsx:15); NachMandateForm.tsx:95 amountMinor = Math.round(Number(amountRupees) * 100) (float math on money). BankFileForm.tsx is not imported anywhere (its own header comment :15-20; grep finds only self and comments). NachMandateForm payload (:96-107) sends employeeRef, amountMinor, frequency, startDate, endDate, accountType only, no account number or IFSC; where bank details come from is not visible (server presumably joins employee record; cannot-verify). lib/money.ts exports rupeesToMinorString and lib/formatters.ts exports formatRupees/formatMoney that should be used.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/NachMandateForm.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileWizard.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/DisbursementTransferTable.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileForm.tsx (delete)`, `apps/web/src/app/(app)/hr/payroll/disbursement/BankFileForm.test.tsx (delete if exists)`
- **Fix steps:**
  1. NachMandateForm: replace Math.round(Number(x)*100) with rupeesToMinorString() from lib/money.ts and send a string (adjust zod/schema and API type accordingly); reject null.
  2. Replace the three local Intl.NumberFormat instances with formatRupees (rupee inputs) and note the unit in each prop name; ask backend to expose paise fields (grossMinor/netMinor/amountMinor) and then switch to formatMoney.
  3. Remove the unused inrFormatter in page.tsx.
  4. Delete BankFileForm.tsx and its test and its bankFileForm i18n block.
  5. NachMandateForm: replace free-text employeeRef with an employee picker (see DETAIL-01/FNF-05) and show the bank account (masked) that the mandate will use, if the API can return it.
- **Acceptance:**
  - Unit test: entering 1234.56 posts amountMinor '123456'; 0.1+0.2 style inputs never yield float drift.
  - Grep test: no Math.round(...*100) in payroll/disbursement.
  - Build passes after deleting BankFileForm (no importers).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money conversion; test edge inputs (commas, 3 decimals, negative) since amountMinor is sent to the bank mandate.
- **Depends on:** GAP-PAYROLL-FNF-03

### GAP-PAYROLL-DISBURSEMENT-09  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1757 (merged)
- **First-pass claim:** Seven cards on one route (transfers, wizard, mandates, return, sponsor, DSC) with no anchors or tabs; loading.tsx is a bare skeleton.
- **Verified evidence:** page.tsx renders six Cards/sections after the stat grid: transfers (:148), bank file wizard (:153), NACH mandates (:160), NACH return (:169), sponsor bank (:185), DSC (:189), so 'seven' is one too many; no anchors, Tabs or Segmented navigation (ds/Tabs.tsx exists). loading.tsx is a single <div className='skeleton'> (6 lines). error.tsx uses the shared RouteError with back link (not a defect).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/disbursement/page.tsx`, `apps/web/src/app/(app)/hr/payroll/disbursement/loading.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Group cards under ds/Tabs (Transfers, Bank file, NACH, Configuration) or add an in-page anchor bar.
  2. Rewrite loading.tsx to mimic the page: header, four StatCard skeletons, then card skeletons (reuse ds/Skeleton).
  3. Put Configuration (sponsor, DSC) last and role-gated per DISB-04.
- **Acceptance:**
  - Manual: loading state shows stat and card placeholders matching the final layout.
  - Manual: keyboard user can jump to a section via tab/anchor.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; layout only.
- **Depends on:** GAP-PAYROLL-DISBURSEMENT-04


---
## /hr/payroll/flex-benefits  —  `payroll/flex-benefits.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/flex-benefits/page.tsx`
- **Design reference:** `redesign/payroll/flex-benefits.html`

### GAP-PAYROLL-FLEX-BENEFITS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was CAP)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Election needs a hand-typed “Plan ID” and free-text component names, yet there is no way to list plans: page.tsx:9–13 records that the service has no GET-all-plans endpoint. An employee cannot discover a plan id, its components or its max amounts, and nothing client-side ties an election line to a plan component or budget (ElectFlexBenefitForm.tsx:121–128).
- **Verified evidence:** flex-benefits/page.tsx:10-12 comment states there is no GET list-all-plans endpoint; the only data is /api/v1/payroll/flex-benefits/my-elections (:23). ElectFlexBenefitForm.tsx:154-163 is a free-text Plan ID input (planId state :19) and each election line's component is a free-text input (:195-200 region, fields component/amount :11); submit posts planId and elections {component, electedMinor} (:121-129) with only client checks that the values are non-empty/non-negative (:88-112). Nothing ties a line to plan components or the plan budget. Whether the service validates against the plan cannot be verified (payroll-service absent). The finding's theme 'CAP' (server-side pagination) is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/flex-benefits/page.tsx`, `apps/web/src/app/(app)/hr/payroll/flex-benefits/ElectFlexBenefitForm.tsx`, `apps/web/src/app/_data/loaders.ts`, `payroll-service flex-benefits routes (not in snapshot)`
- **Fix steps:**
  1. Backend: add GET /v1/payroll/flex-benefits/plans (filter by fy, status active) returning id, name, fy, totalBudgetMinor and components[{name,maxMinor,taxExempt}].
  2. Add getFlexPlans() to loaders.ts with a zod response schema; call it in page.tsx and pass plans to ElectFlexBenefitForm.
  3. Replace the Plan ID input with a <select> of plans; after selection render one row per plan component with a numeric amount input capped at maxMinor and a running total capped at totalBudgetMinor.
  4. Remove free-text component names; send only components that belong to the plan.
  5. Show plan budget and remaining amount in the form and in the elections table.
- **Acceptance:**
  - Component test: choosing a plan lists its components and blocks amounts above maxMinor.
  - Component test: total above plan budget disables submit with a message.
  - Manual: an employee can complete an election without knowing any id.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Employee elections affect taxable pay; wrong plan binding could over-exempt tax.
- **Depends on:** GAP-PAYROLL-FLEX-BENEFITS-03

### GAP-PAYROLL-FLEX-BENEFITS-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Plan creation (an admin action) and election (an employee action) are both rendered for every role that passes hr/layout.tsx:26–42 (page.tsx:63–64); one of the two will 403 for any given user, after the ConfirmDialog. Backend guards not verifiable — payroll-service absent.
- **Verified evidence:** flex-benefits/page.tsx:63-64 renders <CreateFlexPlanForm /> and <ElectFlexBenefitForm /> with no role check (no getSessionRoles in the file); hr/layout.tsx:26-42 HR_ROLES admits payroll/hr roles, manager and employee, so an employee sees the admin plan form and an admin sees the employee election form. Both submit through ConfirmDialog, then the API call (CreateFlexPlanForm.tsx:121, ElectFlexBenefitForm.tsx:121). Backend guards cannot be verified (payroll-service absent); the 403 is inferred.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/flex-benefits/page.tsx`
- **Fix steps:**
  1. page.tsx: call getSessionRoles() (as hr/payroll/[id]/page.tsx:51 does) and derive canManagePlans (payroll_admin, payroll_officer, hr_admin, super_admin) and canElect (employee and other roles that have my-elections).
  2. Render CreateFlexPlanForm only when canManagePlans; render ElectFlexBenefitForm only when canElect.
  3. Change the empty-state message per role (see FLEX-04).
  4. Confirm the backend role lists so UI gating matches the API; keep server enforcement.
- **Acceptance:**
  - Component test: role 'employee' renders the election form and no plan form.
  - Component test: role 'payroll_admin' renders the plan form.
  - Manual: no visible form ends in a 403 for the signed-in role.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Hiding a control the backend would have allowed removes a capability; derive the role list from the service guards.

### GAP-PAYROLL-FLEX-BENEFITS-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Financial Year validated only by /^\d{4}-\d{2}$/ (CreateFlexPlanForm.tsx:89, ElectFlexBenefitForm.tsx:95): “2026-99” passes; the election is not checked against the plan’s Total Budget.
- **Verified evidence:** Both forms validate FY only with /^\d{4}-\d{2}$/ (CreateFlexPlanForm.tsx:89, ElectFlexBenefitForm.tsx:95), so '2026-99' or '2026-05' passes; lib/fiscalYear.ts has helpers (currentFinancialYear :43, fiscalYearLabel) that could validate the end-year. The election is not checked against plan budget in the form (no plan data is loaded, see FLEX-01); the create form does not check that the sum of component max amounts <= totalBudget either (handleSubmit :78-115). Both forms use parseFloat and Math.round(x*100) for money (CreateFlexPlanForm.tsx:126-129, ElectFlexBenefitForm.tsx:128), also outside the paise rule (lib/money.ts rupeesToMinorString exists).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/flex-benefits/CreateFlexPlanForm.tsx`, `apps/web/src/app/(app)/hr/payroll/flex-benefits/ElectFlexBenefitForm.tsx`, `apps/web/src/lib/fiscalYear.ts`, `apps/web/src/lib/__tests__/fiscalYear.test.ts`
- **Fix steps:**
  1. Add isValidFinancialYearLabel(fy) to lib/fiscalYear.ts: match regex and require Number(end) === (Number(start)+1) % 100.
  2. Use it in both forms; replace the free FY input with a select built from the existing FY list helper (last N years) if available.
  3. Create form: reject when sum(component max) > total budget (in paise) or duplicate component names.
  4. Election form: after plans are available (FLEX-01) reject line amounts above component max and totals above plan budget.
  5. Replace parseFloat + Math.round(x*100) with rupeesToMinorString and validate the result is non-null.
  6. Optionally define a zod schema per form and parse the payload before browserJson.
- **Acceptance:**
  - Unit test: isValidFinancialYearLabel('2026-27') true, '2026-99' false, '2026-05' false.
  - Component test: create form with components summing above budget shows an error and does not open the dialog.
  - Unit test: amount '10.005' is rejected or converted deterministically.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; stricter validation could reject historical FY entries, so allow the FY select to include previous years.
- **Depends on:** GAP-PAYROLL-FLEX-BENEFITS-01

### GAP-PAYROLL-FLEX-BENEFITS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Subtitle promises “Flexible-benefit plans and employee component elections” but the table lists only the caller’s own elections (page.tsx:9–13) — plans never appear. Empty copy says “Create a plan and submit an election using the forms above”, sending an employee to an admin form.
- **Verified evidence:** en.json payrollFlexBenefits.subtitle = 'Flexible-benefit plans and employee component elections.' but page.tsx lists only /my-elections rows (:22-30, table columns :37-42, card title 'My Flex Benefit Elections'). emptyMessage = 'Create a plan and submit an election using the forms above.' is shown to every role, including employees who cannot create plans (see FLEX-02). No plan list is rendered anywhere on the page.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json (if present)`, `apps/web/src/app/(app)/hr/payroll/flex-benefits/page.tsx`
- **Fix steps:**
  1. Change subtitle to describe what is shown ('Your flexible-benefit elections'), or add a plans list once the GET plans endpoint exists (FLEX-01).
  2. Split emptyMessage into an employee variant ('You have not made any elections. Choose a plan above.') and an admin variant chosen by canManagePlans.
  3. Pass the role flag into the message selection in page.tsx.
- **Acceptance:**
  - Manual: employee empty state does not mention creating a plan.
  - Grep test: no key text promises a plans list unless the list exists.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Copy only.
- **Depends on:** GAP-PAYROLL-FLEX-BENEFITS-01, GAP-PAYROLL-FLEX-BENEFITS-02

### GAP-PAYROLL-FLEX-BENEFITS-05  ·  LOW  ·  partly  ·  theme STATUS (was LOADING)

- [x] **Status** — PR #1824 (merged)
- **First-pass claim:** Status is a free string (approved counted at page.tsx:34) with no approve/reject path for the employer side in the page tree; loading.tsx is a bare skeleton.
- **Verified evidence:** ElectionRow.status is a plain string (page.tsx:19); approved is counted at :45 (finding said :34). The status column uses cellType 'status' (:41) so it renders through the shared status cell, but the page tree has only CreateFlexPlanForm and ElectFlexBenefitForm (directory listing), so there is no employer-side approve/reject UI for elections; whether the service has an approval endpoint is cannot-verify. loading.tsx is a bare single skeleton div (6 lines). The theme LOADING only covers the last sentence; the main gap is a missing approval workflow.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/flex-benefits/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/flex-benefits/page.tsx`, `payroll-service flex-benefits routes (not in snapshot)`
- **Fix steps:**
  1. Decision: confirm whether elections need HR approval; if yes, backend adds GET all elections (filter status=pending) and PATCH approve/reject with reason and audit.
  2. Add an HR elections queue with approve/reject ConfirmDialogs (requireReason) visible to payroll roles only.
  3. Type status as a union (submitted|approved|rejected) matching API and map to StatusPill tones.
  4. Rewrite loading.tsx with header, four stat skeletons and a table skeleton.
- **Acceptance:**
  - Manual: loading state resembles the page layout.
  - Component test: unknown status renders raw text with a neutral tone rather than crashing.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval of flex elections changes pay and tax exemptions; needs maker-checker if added.
- **Depends on:** GAP-PAYROLL-FLEX-BENEFITS-01


---
## /hr/payroll/fnf  —  `payroll/fnf.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/fnf/page.tsx`
- **Design reference:** `redesign/payroll/fnf.html`

### GAP-PAYROLL-FNF-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1772 (merged): submit/finance-approve/disburse/reject workflow built (three-person release)
- **First-pass claim:** Mark Disbursed is a manual status flip (FnFSettlementCard.tsx:35) not tied to a bank transfer or the Disbursement route: settlement status and actual payment can diverge. Its confirm dialog shows only name, type and date — no net amount and no reason (:195-205).
- **Verified evidence:** FnFSettlementCard.tsx:121-125 NEXT_ACTION_KEYS maps finance_approved to endpoint 'disburse' with label 'Mark Disbursed' (finding cited :35, wrong); executeAction POSTs v1/payroll/fnf/settlements/{id}/disburse with no body (:234). The ConfirmDialog (:278-297) shows name, separation type and date only, no amount, and has no requireReason. en.json confirmMarkDisbursed = 'Mark this settlement as disbursed?'. Whether that endpoint triggers a bank transfer or only flips status, and any link to the Disbursement route, is server-side and cannot be verified (payroll-service absent); the FnF page has no link to Disbursement or transfer status.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/fnf/FnFSettlementCard.tsx`, `apps/web/src/messages/en.json`, `payroll-service fnf routes (not in snapshot)`
- **Fix steps:**
  1. Include netPayable (via formatMoney on the minor amount) and the components summary in the ConfirmDialog description for finance-approve and disburse.
  2. Set requireReason with minReasonLength={10} for finance-approve and disburse; send it in the POST body and audit it server-side.
  3. Decision/backend: make 'disburse' create a bank transfer (visible on /hr/payroll/disbursement) or require a payment reference (UTR/date) instead of a bare status flip; show the reference on the card.
  4. Reword the action to 'Record Payment' if it stays a manual flag.
  5. Idempotency-Key on the POST.
- **Acceptance:**
  - Component test: Mark Disbursed dialog shows the net payable amount and keeps Confirm disabled until reason >= 10 chars.
  - Component test: request body includes reason.
  - API test: repeated disburse call returns 409.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Marks a final settlement paid; a wrong click closes a case without payment or duplicates it.
- **Depends on:** GAP-PAYROLL-FNF-02

### GAP-PAYROLL-FNF-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1772 (merged): maker-checker enforced server+web
- **First-pass claim:** Finance Approve and Mark Disbursed render for every role that reaches the page (no role check anywhere in fnf/*); the same person can Submit, Finance Approve and Disburse. Maker-checker enforcement server-side cannot be verified (payroll-service source absent).
- **Verified evidence:** No role check exists in fnf/page.tsx, FnFSettlementCard.tsx or ComputeFnfForm.tsx (grep for roles/canAdminister in the folder is empty); NEXT_ACTION_KEYS (FnFSettlementCard.tsx:121-125) offers submit (draft), finance-approve (manager_approved) and disburse (finance_approved) to whoever loads the page, and hr/layout.tsx:26-42 lets employee and manager roles in. Manager approval has no UI action in this page (manager_approved is set elsewhere). Server maker-checker enforcement is cannot-verify (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/fnf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/FnFSettlementCard.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/ComputeFnfForm.tsx`, `payroll-service fnf routes (not in snapshot)`
- **Fix steps:**
  1. page.tsx: getSessionRoles(); compute canCompute (payroll_admin/payroll_officer/hr_admin), canFinanceApprove (finance_officer/finance_admin/payroll_admin), canDisburse (payroll_admin/finance_admin); pass to the components.
  2. FnFSettlementCards: filter NEXT_ACTION_KEYS by those flags so buttons appear only for permitted roles; ComputeFnfForm only for canCompute.
  3. Backend: return createdBy, submittedBy, financeApprovedBy on each settlement; reject when the same user performs consecutive steps; audit each step.
  4. Show the acting users' names on the card (Submitted by / Approved by).
- **Acceptance:**
  - Component test: role 'hr_officer' sees Submit only; 'finance_officer' sees Finance Approve only.
  - API test: same user finance-approving their own submitted settlement gets 403 with audit.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Final settlement payout approvals; exact role mapping needs business sign-off to avoid blocking small offices.
- **Depends on:** GAP-PAYROLL-DETAIL-02

### GAP-PAYROLL-FNF-03  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** The form asks the user to type gratuity gross, leave encashment gross, arrears, avg salary and 10 more paise-bound amounts (ComputeFnfForm.tsx:314) although the service computes exemptions and tax: hand-entered inputs decide a final payout with no cross-check against pay records or service length. Converted by Math.round(Number(v)*100) (:50).
- **Verified evidence:** ComputeFnfForm.tsx:15-18 lists 14 MoneyField inputs (noticeBuyout, leaveEncashmentGross, gratuityGross, retrenchmentComp, vrsComp, arrears, lastDrawnWages, avgSalaryLast10Months, priorLeaveEncashExemption, salaryYtd, tdsYtd, deductions80c, deductions80d, otherDeductions); four required (:20 REQUIRED_MONEY_FIELDS) and all rendered as free number inputs (map around :314). compute() posts each via toMinorString (:48-51) = Math.round(Number(v)*100).toString(), and confirm text (en.json computeFnfForm.confirmDescription) says exemptions and tax are computed server-side. Nothing loads pay records, service length or leave balance; completedYears and leaveBalanceDays are also typed (:178-182). Money is sent as minor strings, which is good, but the conversion is float based. lib/money.ts already has rupeesToMinorString.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/fnf/ComputeFnfForm.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/app/_data/loaders.ts`, `payroll-service fnf compute route (not in snapshot)`
- **Fix steps:**
  1. Replace toMinorString with rupeesToMinorString (lib/money.ts) and block submit when it returns null.
  2. Backend: add a GET pre-fill endpoint (or make compute derive) for last drawn wages, average 10-month salary, YTD salary/TDS, completed years and leave balance from payroll and leave records, keyed by employeeId + separationDate.
  3. Form: after an employee is chosen call that endpoint, pre-fill and mark those fields read-only with an 'override' toggle that requires a reason; keep only genuinely manual inputs (notice buyout, arrears, VRS) editable.
  4. Show the system-derived value next to any override and flag differences over a threshold in the confirm dialog.
  5. Add zod schema for the payload.
- **Acceptance:**
  - Unit test: '1234.56' -> '123456', '0.1' -> '10', '1.005' handled without float drift.
  - Component test: choosing an employee pre-fills wages/service fields; overriding requires a reason.
  - API test: compute rejects when overridden values deviate without an override reason.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Settlement can pay lakhs on hand-typed numbers; incorrect gratuity/leave encashment exemption also creates tax misstatement.
- **Depends on:** GAP-PAYROLL-FNF-05

### GAP-PAYROLL-FNF-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Statuses computed, settled and paid have no action and count as pending/settled in the stats (page.tsx:39-41): a computed settlement has no visible way to be submitted. Compute is asynchronous ("queued"), and the list does not refresh until reload.
- **Verified evidence:** fnf/page.tsx:39-40 pending counts pending|computed|draft and settled counts settled|paid|disbursed; manager_approved and finance_approved fall into neither bucket. FnFSettlementCard.tsx:121-125 NEXT_ACTION_KEYS has actions only for draft, manager_approved and finance_approved, so 'computed' (STATUS_LABEL_KEYS has it :132) has no button, 'settled' and 'paid' none. ComputeFnfForm.compute() sets message res.data.message ?? 'F&F compute queued.' then router.refresh() (:196-197) once; there is no polling and the empty-state copy says 'processed asynchronously' (en.json emptyMessage). Which status a computed record takes and how it becomes 'draft' is server behaviour, cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/fnf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/FnFSettlementCard.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/ComputeFnfForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Confirm the settlement state machine with the backend and define one shared FNF_STATUS map (label, tone, bucket, next action).
  2. Add a next action for 'computed' (Submit for Approval) if that is the intended flow, or remove the status.
  3. page.tsx: count manager_approved and finance_approved as 'in approval' with their own stat; drive stats from the shared map.
  4. After a queued compute, show the queued message with a Refresh button and poll (router.refresh every 5 s, max 1 min) or use an SSE hook if available.
  5. Show a 'computing' row/skeleton for queued jobs if the API exposes them.
- **Acceptance:**
  - Unit test: status map covers every status from the API; stats sum to total.
  - Component test: a 'computed' card shows Submit for Approval.
  - Manual: after Compute, the new settlement appears within ~1 minute without manual reload.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong state machine could expose transitions the backend rejects or hide required ones.
- **Depends on:** GAP-PAYROLL-FNF-02

### GAP-PAYROLL-FNF-05  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Employee is a raw UUID in the form and printed beside the name on the card (FnFSettlementCard.tsx:72); raw ISO dates; Death separation has no nominee or legal-heir fields.
- **Verified evidence:** en.json computeFnfForm.employeeIdLabel = 'Employee ID (UUID)' and ComputeFnfForm.tsx renders a plain text input for it (~:130-145, employeeId state trimmed at :175); the confirm dialog also prints the id (confirmDescription {employeeId}). FnFSettlementCard.tsx:159-162 prints employeeName then '{employeeId} · {separationType} · {separationDate}' (finding cited :72, actual :161) with the raw ISO date and underscores replaced by spaces only. The form has fields for separation type including 'death' but no nominee/legal-heir/claimant fields (search in the form finds none), so payee for a death settlement is not captured; whether the service captures it elsewhere is cannot-verify. No EntityPicker exists in the repo (grep empty); SmartCombobox is the closest reusable component; loaders.ts has getEmployees (/api/v1/hrms/employees).
- **Files to change:** `apps/web/src/app/_components/EmployeePicker.tsx (new, wrapping SmartCombobox)`, `apps/web/src/app/(app)/hr/payroll/fnf/ComputeFnfForm.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/FnFSettlementCard.tsx`, `apps/web/src/messages/en.json`, `payroll-service fnf compute route (not in snapshot)`
- **Fix steps:**
  1. Create EmployeePicker (search by name/employee code via /api/proxy/v1/hrms/employees?q=) returning id; replace the UUID input and use the name in the confirm dialog.
  2. Card: show employeeName and employee code (not UUID), and format separationDate with formatIndianDate.
  3. Death separation: add nominee/legal-heir name, relationship, bank account (masked display) and document reference fields when separationType === 'death'; backend must accept and store them.
  4. Humanise separationType with a translation map instead of replace(/_/g,' ').
- **Acceptance:**
  - Component test: typing a name in the picker selects an employee and submits their id; no UUID input visible.
  - Component test: 'death' reveals nominee fields and blocks submit until filled.
  - Manual: card date shows '30 Sep 2026' style.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Death settlements have legal-heir payee implications; the nominee fields need backend validation and privacy handling.

### GAP-PAYROLL-FNF-06  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Breakdown shows a single Deductions line, hides zero components, and money is formatted with a local Intl helper rather than formatMoney (FnFSettlementCard.tsx:24).
- **Verified evidence:** FnFSettlementCard.tsx:141-147 builds components with truthy checks so any zero/undefined component is hidden, and all deductions collapse into one negative 'Deductions' line (:146, -Math.abs(deductionsMinor)); no TDS/PF/recoveries split is available from the row type (:98-111). Money uses a local Intl.NumberFormat (:113) with rupees(minor) = minor/100 (:115) instead of formatMoney (lib/formatters.ts:90, paise-correct for bigint/strings) (finding cited :24, actual :113-115). netPayableMinor is coerced with Number() (:182,:211).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/fnf/FnFSettlementCard.tsx`, `apps/web/src/app/(app)/hr/payroll/fnf/page.tsx`, `payroll-service fnf settlements route (not in snapshot)`
- **Fix steps:**
  1. Import formatMoney from @/lib/formatters and delete inrFmt/rupees(); pass netPayableMinor as-is (string/bigint) rather than Number().
  2. Show every component row including zeros as '₹0.00' (or '—' for missing) so the breakdown is complete.
  3. Backend: return deductions split (TDS, PF/GPF recovery, notice-period, loans) and gratuity tax-exempt amount; render each as its own row.
  4. Add a footing check: sum of rows equals netPayable, else show a warning.
- **Acceptance:**
  - Unit test: row with gratuityMinor=0 renders a '₹0.00' Gratuity line.
  - Unit test: netPayableMinor '123456789012' renders correctly with no float rounding.
  - Grep test: no Intl.NumberFormat in fnf/.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Display only; formatting change is low risk but verify the sign of deductions with real data.


---
## /hr/payroll/form16  —  `payroll/form16.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/form16/page.tsx`
- **Design reference:** `redesign/payroll/form16.html`

### GAP-PAYROLL-FORM16-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1753 (merged): deduction values (80C/80D/etc) removed from the wizard; bulk-generate only ever sent fy/employeeIds, so typed values were silently discarded before.
- **First-pass claim:** Step 2 collects seven deduction figures but generateForm16() posts only { fy, employeeIds? } — deductionVals is never sent (Form16Wizard.tsx:99-101,138-139,197-211). The reviewer types 80C/80D/HRA values that are silently discarded, on a statutory certificate.
- **Verified evidence:** Form16Wizard.tsx:99-101 holds deductionVals; step-1 inputs (197-211) write to it; generateForm16() (134-158) builds body {fy, employeeIds?} only (138-139). deductionVals is never read anywhere else, so typed values are discarded. Backend bulk-generate contract not in snapshot (cannot see whether it accepts deductions).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/Form16Wizard.tsx`
- **Fix steps:**
  1. Decide with backend owner whether the bulk-generate endpoint should accept per-section deductions; Form 16 is computed from payroll/declarations so the safest option is to remove the inputs.
  2. If accepted: convert each deductionVals entry to paise (integer string, no float) and add `deductions` to the POST body in generateForm16(); add zod schema for the body.
  3. If NOT accepted: delete DEDUCTIONS/deductionVals state and the step-1 inputs, keep the read-only TDS reconciliation, and rename step to 'Review'.
  4. Show a read-only summary of what will actually be sent before Generate.
- **Acceptance:**
  - Component test: type 80C=150000, click Generate, assert fetch body contains it (or that the inputs no longer render).
  - Manual: no input on screen is silently dropped.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Statutory certificate; sending wrong/unit-mismatched deductions could produce incorrect Form 16. Backend contract unknown.

### GAP-PAYROLL-FORM16-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1753 (merged): fabricated CHLN-FY-Q challan string removed; table now shows real data or a not-available label.
- **First-pass claim:** TDS reconciliation table fabricates challan references: every row prints CHLN-FY{fy}-Q{n} while Gross Salary and TDS Deducted are hard-coded "—" (Form16Wizard.tsx:73-78). It reads as real 24Q challan data for all four quarters, whatever the backend holds.
- **Verified evidence:** Form16Wizard.tsx:71-79 renders CHLN-FY{fy.replace('-','')}-Q{i+1} in the Challan Ref column for all four quarters while gross/TDS cells are hard-coded '—' (74-75, 83-84). No data is fetched; tdsReconciliationNote (en.json form16Wizard) claims 'Challan references from submitted 24Q returns', which is false.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/Form16Wizard.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Remove the synthesized challan string from TdsReconciliationTable (lines 76-78); render '—' or a 'Not available' label.
  2. Either hide the whole table until a real 24Q/TDS reconciliation endpoint exists, or fetch it server-side in page.tsx and pass rows as props (needs backend endpoint - none visible).
  3. Rewrite tdsReconciliationNote in en.json and hi.json so it no longer claims data comes from submitted returns.
- **Acceptance:**
  - Component test: with no data, no 'CHLN-' text is in the DOM.
  - Manual: step 2 shows no invented reference numbers.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Fabricated statutory reference on a tax screen; low regression risk when removing.

### GAP-PAYROLL-FORM16-03  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1753 (merged): added explicit All/One-employee scope with EntityPicker plus a ConfirmDialog before bulk generation.
- **First-pass claim:** Blank Employee ID means bulk generation for every employee, triggered by one click with no confirmation, count or cost hint (Form16Wizard.tsx:139,182,224). Placeholder "EMP001 — blank = all" is the only warning, and employee is a raw free-text id, not a picker.
- **Verified evidence:** Form16Wizard.tsx:139 omits employeeIds when the field is blank => bulk for all; Generate button (224) calls generateForm16() directly with no dialog; employeeId is a free-text input (182) with placeholder 'EMP001 - blank = all'. Reuse target: ConfirmDialog is already imported from ds in GenerateForm16Form.tsx and used in CreatePayrollRunForm. Whether a maker!=checker/audit event is emitted is backend (cannot verify).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/Form16Wizard.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add a scope choice (radio: 'All employees' / 'One employee') instead of the blank-means-all convention; require an id only for 'One'.
  2. Wrap the Generate click in ds ConfirmDialog stating FY and scope (All employees / the chosen employee); confirm calls generateForm16().
  3. Replace the free-text id with an employee picker if a shared employee lookup component exists; otherwise validate id format with zod.
  4. Keep the audit event server-side (CLAUDE.md rule 8); verify bulk-generate emits one.
- **Acceptance:**
  - Component test: clicking Generate with blank id opens dialog naming 'All employees'; fetch not called until confirmed.
  - Cancel leaves step at 1 and sends nothing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Bulk statutory generation could overwrite/regenerate every certificate; audit must stay server-side.
- **Depends on:** GAP-PAYROLL-FORM16-09

### GAP-PAYROLL-FORM16-04  ·  MEDIUM  ·  confirmed  ·  theme ASYNC-STATE (was I18N)

- [x] **Status** — PR #1753 (merged): added bulk-status polling before showing the download link, so it no longer appears before the job actually completes.
- **First-pass claim:** Step 3 shows "Download Form 16 ZIP" the moment the job is queued, though the copy says generation is asynchronous; the link goes to bulk-download for the FY and will fail until the run completes (Form16Wizard.tsx:236-244). The bulk card below only shows status after a manual reload/"Check run".
- **Verified evidence:** Form16Wizard.tsx:152 sets step 2 right after POST returns; 232-244 shows 'Download Form 16 ZIP' link to bulk-download?fy= together with generationAsyncNote ('Download will be available once complete'). Link is always active, so it fails until the job completes. The status card on the page only updates on reload (page.tsx server-fetched). Theme I18N is wrong; the copy is already i18n (t()).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/Form16Wizard.tsx`
- **Fix steps:**
  1. In step 2, poll GET /api/proxy/v1/payroll/tax/form16/bulk-status?fy= (same endpoint page.tsx uses) every few seconds until status is completed/failed.
  2. Render the download anchor only when status === 'completed' (and storagePrefix set, as page.tsx:135 does); show 'Generating...' with aria-live meanwhile, and a failure message otherwise.
  3. Call router.refresh() on completion so the bulk status card updates.
- **Acceptance:**
  - Component test with mocked fetch: pending -> link absent; completed -> link present.
  - Manual: no dead download link appears right after queueing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; polling adds request load (cap attempts).

### GAP-PAYROLL-FORM16-05  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1753 (merged): error details now parsed defensively (safe list or count-only fallback), raw JSON/employee ids no longer dumped verbatim.
- **First-pass claim:** Failure details dump JSON.stringify(errorDetails) verbatim (page.tsx:145-152): raw employee ids and backend error text, visible to any role that reaches the page — DPDP exposure and no per-employee names/retry.
- **Verified evidence:** page.tsx:145-152 renders JSON.stringify(lookup.job.errorDetails, null, 2) inside <details> when failed>0: raw backend blob, shape unknown. Employee ids/error text in it is plausible but the shape cannot be verified (payroll tax service absent). Page is reachable by all hr layout roles (see -06). 'No retry' is true; no retry endpoint seen.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Define a zod schema for errorDetails (array of {employeeId, message}) and parse it; on parse failure show only the failed count.
  2. Render a table of employee name (via lookup) + short reason instead of raw JSON; do not print employee ids without role gating.
  3. Gate the block to payroll admin roles (see -06).
- **Acceptance:**
  - Unit test: errorDetails with unknown shape does not render raw JSON.
  - Non-admin role does not see failure details.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Depends on backend errorDetails shape; DPDP exposure only if ids/names are returned.
- **Depends on:** GAP-PAYROLL-FORM16-06

### GAP-PAYROLL-FORM16-06  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1753 (merged): bulk wizard role-gated to payroll_admin/super_admin matching backend form16-pdf routes exactly; VerifyForm16Form deliberately left ungated since the backend allows any authenticated user there.
- **First-pass claim:** No role check on the page: hr/layout.tsx admits manager and employee (layout.tsx:32-42) and page.tsx has no canAdminister guard, so those roles see the wizard and bulk controls; whether the backend 403s them cannot be verified (payroll tax routes are not in services/hrms-service in this checkout).
- **Verified evidence:** hr/layout.tsx:41 requireAnyRole(HR_ROLES) with HR_ROLES (layout.tsx:26-36 in this checkout) including manager and employee; form16/page.tsx has no getSessionRoles/PermissionDenied (contrast pensioners/page.tsx which gates). payroll tax routes are not in services/hrms-service and payroll service is absent, so the server-side 403 is cannot-verify. Layout comment says pages needing finer checks own them.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a shared const PAYROLL_TAX_ROLES (payroll_admin, payroll_officer, hr_admin, super_admin) - ideally in a shared payroll roles module reused by gpf/income-tax/form16.
  2. In Form16Page call getSessionRoles(); if none match return <PermissionDenied module="form16" requiredRoles=...> before fetching bulk status.
  3. Confirm with backend that bulk-generate/bulk-status/bulk-download enforce the same roles.
- **Acceptance:**
  - Test: employee role gets PermissionDenied and no fetch of bulk-status.
  - Payroll admin still sees wizard.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low if role list matches backend; too narrow list would lock out legitimate HR.
- **Depends on:** GAP-PAYROLL-GPF-05, GAP-PAYROLL-INCOME-TAX-02, GAP-PAYROLL-HOME-02

### GAP-PAYROLL-FORM16-07  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1753 (merged): wizard FY synced to the URL, same source as the lookup FY.
- **First-pass claim:** Two independent FY inputs: the wizard FY (Form16Wizard.tsx:175) and the lookup FY (FyLookupForm.tsx:37); only the lookup drives the URL. Changing the wizard FY does not refresh the status card, and vice versa.
- **Verified evidence:** Wizard FY is local state (Form16Wizard.tsx:96,175) and lookup FY is a GET form (FyLookupForm.tsx:37-45) which navigates and, via key={fy} in page.tsx:88, remounts the wizard with that FY. So lookup->wizard syncs; wizard->status card does not (wizard FY edits never change URL). Also the step-2 download link uses the wizard fy while the status card shows the URL fy. Wizard FY has no format validation.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/Form16Wizard.tsx`, `apps/web/src/app/(app)/hr/payroll/form16/page.tsx`
- **Fix steps:**
  1. Make the wizard FY input controlled from the URL: on step-0 Next call router.replace(`?fy=${fy}`) after validating /^\d{4}-\d{2}$/ (same FY_RE as page.tsx:35).
  2. Or remove the wizard FY field and show the URL FY read-only with a link to the lookup form.
  3. Disable Next when FY invalid.
- **Acceptance:**
  - Test: entering 2023-24 in wizard and pressing Next updates ?fy= and status card title.
  - Invalid FY blocks Next.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Router replace remounts wizard (key={fy}); ensure step state isn't lost mid-flow.

### GAP-PAYROLL-FORM16-08  ·  LOW  ·  partly  ·  theme I18N (was UUID)

- [x] **Status** — PR #1761 (merged): already done on main (verified in review)
- **First-pass claim:** DataSourceBadge message "Couldn't load — showing nothing" is shown while the wizard and verify card still render (page.tsx:77); job id printed raw (page.tsx:127); back label/labels "Back to Payroll" hard-coded in English (page.tsx:75).
- **Verified evidence:** Confirmed: job id printed raw at page.tsx:127 (class mono); backLabel='Back to Payroll' hard-coded English at page.tsx:75 (also in gpf/page.tsx:76, income-tax:50). Partly wrong: the DataSourceBadge message is i18n (t('loadErrorMessage'), en 'Couldn't load - showing nothing', page.tsx:77) and is accurate - on error the page shows an error EmptyState in the status card while the wizard (independent of data) still renders, which is by design. Theme should be I18N, not UUID.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add form16.backLabel key (en/hi) and use t('backLabel') at page.tsx:75.
  2. Keep jobId but as a secondary, copyable value (or drop it); it is a technical id not needed by HR.
  3. Optionally add a note under the badge that generation still works when the status lookup failed.
- **Acceptance:**
  - Hindi locale shows translated back label.
  - Grep for hard-coded 'Back to Payroll' in payroll pages returns none.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Trivial.

### GAP-PAYROLL-FORM16-09  ·  LOW  ·  confirmed  ·  theme DEADCODE (was DEADROUTE)

- [x] **Status** — PR #1753 (merged): dead GenerateForm16Form.tsx deleted, confirmed unreferenced repo-wide.
- **First-pass claim:** Dead code: GenerateForm16Form.tsx is unreferenced (grep of apps/web/src) and duplicates the wizard, inviting drift.
- **Verified evidence:** GenerateForm16Form.tsx (export at :29) is referenced nowhere: grep of apps/web/src returns only its own definition. Form16Wizard replaces it. It imports ConfirmDialog/browserJson and duplicates generate+status logic.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/form16/GenerateForm16Form.tsx`
- **Fix steps:**
  1. Before deleting, port its ConfirmDialog + status polling into Form16Wizard (see -03, -04).
  2. Delete GenerateForm16Form.tsx and any co-located test/i18n keys that only it uses.
  3. Run tsc and knip/ts-prune to confirm nothing else references it.
- **Acceptance:**
  - pnpm --filter web typecheck passes.
  - grep -r GenerateForm16Form apps/web returns nothing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None after porting features.
- **Depends on:** GAP-PAYROLL-FORM16-03, GAP-PAYROLL-FORM16-04


---
## /hr/payroll/gpf  —  `payroll/gpf.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`
- **Design reference:** `redesign/payroll/gpf.html`

### GAP-PAYROLL-GPF-01  ·  HIGH  ·  partly  ·  theme FABRICATED

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** “Projected Value at Retirement” compounds the SUM of every employee’s contributions in the ledger at a hard-coded 7.1% for a fixed 20 years (gpf/page.tsx:19–22,69): a department-wide total dressed as a corpus projection. The 7.1% is a code constant repeated in copy (en.json gpfStatements.subtitle) though GoI revises the GPF rate quarterly.
- **Verified evidence:** gpf/page.tsx:19-22 hard-codes GPF_INTEREST_RATE=0.071 and projectGpfCorpus compounds totalContrib (sum over ALL employees/periods, :53) at 69 with AVG_YEARS_TO_RETIRE=20; result shown at :148 as 'Projected Value at Retirement'. True as described. Mitigation: projectionNote (en.json) says 'Illustrative only' and the rate is dated 'as of Q1 FY 2026-27' in comment/subtitle. Still meaningless as an aggregate, ignores employer-side and existing balance.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Remove the projected-value card and projectGpfCorpus/GPF_INTEREST_RATE/AVG_YEARS_TO_RETIRE.
  2. If a projection is wanted, move it to a per-employee view (employee detail) using that employee's balance, tenant-configured rate from a config endpoint and DOJ/retirement date.
  3. Drop '@7.1%' from gpfStatements.subtitle (en/hi) or source it from config.
- **Acceptance:**
  - Page renders with no projected-value tile.
  - Grep of gpf/page.tsx finds no 0.071 constant.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; removal of misleading figure. Decision on whether feature is wanted.

### GAP-PAYROLL-GPF-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was PII)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** “Code” column is fabricated: employeeCode = employeeId.slice(0,8).toUpperCase() (gpf/page.tsx:33) — the first UUID chunk, not an employee code or GPF account number; it is also the fallback for a missing name (lines 41–43).
- **Verified evidence:** gpf/page.tsx:33 employeeCode = r.employeeId.slice(0,8).toUpperCase(); used as Code column (178) and as name fallback (:42 employeeName ?? employeeCode). StatutoryRow (loaders.ts:4450) has no code or GPF account field, so this is a UUID prefix presented as a code. Not really PII masking; the theme is fabricated data.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Drop the derived Code column, or add employeeCode/gpfAccountNo to StatutoryRow only once the payroll API returns it (backend).
  2. For missing names show a localised 'Unknown employee' string, not a UUID chunk.
  3. Update filterPlaceholder ('name, code or period') and colCode keys accordingly.
- **Acceptance:**
  - Ledger never shows UUID-derived text.
  - Row with employeeName null shows 'Unknown employee'.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-GPF-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** “Accumulated Corpus” is Σ empContribMinor only (gpf/page.tsx:53) — no opening balance, withdrawals/advances or interest — yet the ledger card is titled “GPF Ledger”; and the column header “Employee GPF (10%)” hard-codes a rate while components/ComponentGrid formulaGpf describes 6%–100% as opted (en.json componentGrid.formulaGpf).
- **Verified evidence:** 'Accumulated Corpus' = totalContrib = sum of empContribMinor only (gpf/page.tsx:53,108); StatutoryRow has empContribMinor/erContribMinor/basicMinor and no balance/interest/withdrawal fields (loaders.ts:4450). en.json colContribution is 'Employee GPF (10%)' hard-coding a rate, while componentGrid.formulaGpf says 'BASIC + DA x 6%-100% (as opted, min Rs 500/mo)'.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Rename the tile to 'Total Contributions (all periods)' or remove it since statTotalContributions already shows the same figure (:83).
  2. Change colContribution to 'Employee GPF' (no percentage).
  3. Only show a corpus once the API returns opening balance, interest and withdrawals.
- **Acceptance:**
  - No duplicate total tiles.
  - Column header has no hard-coded rate.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-GPF-01

### GAP-PAYROLL-GPF-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** A missing empContribMinor is coerced to 0 (gpf/page.tsx:44) so the ledger prints ₹0.00 for “no data” — formatMoney would render “—” for null (lib/formatters.ts UX-006); a zero-contribution month and a missing statement look identical.
- **Verified evidence:** gpf/page.tsx:44 contrib: r.empContribMinor ?? 0. empContribMinor is optional in StatutoryRow (loaders.ts:4450). formatMoney(null) returns '—' (formatters.ts:91) but the coercion prevents it; 0 also flows into sums (53,58).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`
- **Fix steps:**
  1. Keep contrib as number | null (change GpfRow.contrib type at :15); pass r.empContribMinor ?? null.
  2. Sum with (r.contrib ?? 0) only in totals; consider counting rows with missing data and showing a warning.
  3. DataTable amount cell already goes through formatMoney so null renders '—'.
- **Acceptance:**
  - Unit test: row with undefined empContribMinor renders '—'; zero renders ₹0.00.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-GPF-05  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits employee/manager and the page lists every employee’s name, code and contribution with a row link to /hr/employees/{id}. hr/payroll/pensioners/page.tsx:15–22 documents the same exposure and gates it; this page does not. Backend scoping not verifiable (payroll-service absent).
- **Verified evidence:** No getSessionRoles/PermissionDenied in gpf/page.tsx; hr/layout.tsx admits manager/employee; ledger lists employee name, code, contribution and rowLinkPrefix '/hr/employees/' (page.tsx:182-183). pensioners/page.tsx:15-45 gates with PENSIONER_VIEW_ROLES + PermissionDenied. Backend enforcement of /api/v1/payroll/statutory/gpf cannot be verified (payroll service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`
- **Fix steps:**
  1. Add shared PAYROLL_READ_ROLES constant (reuse the pensioners list) and gate GpfStatementsPage with getSessionRoles() -> <PermissionDenied>.
  2. Do the gate before calling getGpfStatements().
  3. Confirm backend GPF statutory route uses same reader roles.
- **Acceptance:**
  - Employee role sees PermissionDenied; payroll_officer sees ledger.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Role list must match backend or legit users lose access.
- **Depends on:** GAP-PAYROLL-FORM16-06

### GAP-PAYROLL-GPF-06  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Trend chart data is Math.round(value/100) — bare rupee integers — and Chart is called with no valueFormatter (_components/Chart.tsx:17–26), so bars read “18330” instead of ₹18,330 with lakh grouping; the card title alone carries the “₹”.
- **Verified evidence:** gpf/page.tsx:63-66 value: Math.round(value/100); :158 <Chart type='line' data height> without valueFormatter. Chart.tsx supports valueFormatter (default String(value)) and its doc says currency callers should pass formatRupees. Title includes '(last 6 periods, Rs)'. Rounding to whole rupees also loses paise.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx`
- **Fix steps:**
  1. Pass paise values unrounded (value) in trendChartData.
  2. Pass valueFormatter={(v) => formatMoney(v)} to Chart (formatMoney takes paise).
  3. Keep the card title but drop the bare '₹' unit hint.
- **Acceptance:**
  - Chart tooltips/labels show ₹18,330.00 style with lakh grouping.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-GPF-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** gpf/error.tsx sends the user to /hr “Back to HR” (error.tsx:12–14) whereas the page header returns to /hr/payroll; loading.tsx is Tailwind slate/min-h-screen markup outside the design system (gpf/loading.tsx:1–16).
- **Verified evidence:** gpf/error.tsx:9 backHref='/hr', label en 'Back to HR' (en.json gpfStatements.errorBackLabel); page header back is /hr/payroll (page.tsx:76). gpf/loading.tsx uses Tailwind classes min-h-screen bg-slate-50 animate-pulse, unlike sibling loading files that use PageHeader/SkeletonTable/.skeleton.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/gpf/error.tsx`, `apps/web/src/app/(app)/hr/payroll/gpf/loading.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Change error.tsx backHref to /hr/payroll and errorBackLabel to 'Back to Payroll' (en/hi).
  2. Rewrite loading.tsx with ds PageHeader + SkeletonTable (as payroll/loading.tsx) or the .skeleton div used in income-tax/loading.tsx.
  3. Remove Tailwind slate markup.
- **Acceptance:**
  - Error boundary back link goes to /hr/payroll.
  - Loading shows design-system skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/payroll/income-tax  —  `payroll/income-tax.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`
- **Design reference:** `redesign/payroll/income-tax.html`

### GAP-PAYROLL-INCOME-TAX-02  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1753 (merged): page-level role gate added (PAYROLL_TAX_READER_ROLES), matching backend READER_ROLES exactly; verified no actual leak existed pre-fix since employee rows were already self-scoped and manager already got a backend 403.
- **First-pass claim:** Tenant-wide list of every employee's gross income, deductions and tax with no page-level role gate (hr/layout.tsx admits manager and employee, layout.tsx:32-42); page.tsx never calls getSessionRoles. Whether the backend restricts it cannot be verified here — DPDP-sensitive salary data.
- **Verified evidence:** income-tax/page.tsx has no getSessionRoles/PermissionDenied; it renders all employees' gross, deductions, tax (columns 36-44). hr/layout.tsx admits manager/employee. Backend restriction cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`
- **Fix steps:**
  1. Gate the page with shared payroll reader roles and PermissionDenied before fetching.
  2. Server must scope /payroll/income-tax by role (verify).
  3. Consider masking amounts for hr_officer via the shared role policy.
- **Acceptance:**
  - Employee role sees PermissionDenied.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Role list must match backend.
- **Depends on:** GAP-PAYROLL-GPF-05

### GAP-PAYROLL-INCOME-TAX-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1753 (merged): added the missing Department column and unified back-links to /hr/payroll.
- **First-pass claim:** "Departments" StatCard counts distinct department (page.tsx:56) but department is not a table column (page.tsx:36-44), and the rows are not linked to an employee or declaration (no rowLinkPrefix) — the reviewer cannot drill in. Row.id is fetched but unused.
- **Verified evidence:** page.tsx:56 counts new Set(items.map(i=>i.department)).size but columns (36-44) have no department; DataTable at 64 has no rowLinkKey/rowLinkPrefix; Row.id and employee (name?) present but unused for links. Unknown whether backend returns employeeId, so linking may need backend field.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`
- **Fix steps:**
  1. Add a department column (Row already has it) or drop the Departments stat.
  2. If API provides employeeId add it to Row and set rowLinkKey='employeeId' rowLinkPrefix='/hr/employees/' plus identifyingColumnKey='employee'.
  3. Otherwise link to /hr/payroll/tax-declaration/{id} if that route takes this id (verify).
- **Acceptance:**
  - Row click opens employee/declaration; Departments tile matches a visible column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-INCOME-TAX-04  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1753 (merged): Finalized/Pending bucketing fixed to match the real backend status vocabulary (always submitted, never finalized/completed) — traced to tax/consumer.ts.
- **First-pass claim:** Status buckets are incomplete: Finalized = finalized|completed, Pending = pending|draft (page.tsx:54-55); any other backend status (e.g. rejected, submitted) counts in Total only, so cards do not sum. Status pill prints the raw enum (cellType status) with no i18n, unlike SalarySlipsTable.
- **Verified evidence:** page.tsx:54-55 Finalized = finalized|completed, Pending = pending|draft; other statuses count only in Total. Column status uses cellType 'status' (StatusPill with raw humanized text, no payrollRunStatusLabel-like i18n as in SalarySlipsTable). Status enum of backend unknown.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`, `apps/web/src/lib/payroll/statusLabels.ts`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Confirm status enum; add incomeTaxStatusLabel like salarySlipStatusLabel and use column render with StatusPill label.
  2. Add an 'Other' count or a bucket per status so tiles sum to total.
  3. Add tests.
- **Acceptance:**
  - Unknown status still counted somewhere; Hindi locale shows translated pills.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PAYROLL-INCOME-TAX-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Regime (old/new) is the largest driver of taxable income but is absent from the row type and table (page.tsx:8-18), so 80C and Other Ded. columns are meaningless for employees on the new regime.
- **Verified evidence:** Row type (page.tsx:8-18) and columns lack regime; true. Whether the API returns a regime field is unknown (cannot verify), and old/new regime as 'largest driver' is domain reasoning, not code.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`
- **Fix steps:**
  1. Confirm the API exposes regime; add to Row and a Regime column.
  2. Show '—' for 80C/Other Ded on new regime rows.
- **Acceptance:**
  - New-regime row shows '—' in 80C.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PAYROLL-INCOME-TAX-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1753 (merged): back-link inconsistency fixed; non-functional {fy} dropped from the subtitle since the endpoint takes no fy param.
- **First-pass claim:** error.tsx back link goes to /hr with area "HR page" while the header back is also /hr but the RefreshErrorState back is /hr/payroll (page.tsx:61 vs :50); subtitle FY comes from currentFinancialYear() but the endpoint takes no fy param, so the FY shown is not a filter on the data (page.tsx:21,46).
- **Verified evidence:** error.tsx:9-11 backHref '/hr' (incomeTax.errorBackLabel/errorArea); PageHeader back '/hr' labelled 'Back to HR' hard-coded (page.tsx:50); RefreshErrorState backHref '/hr/payroll' (page.tsx:61). fetchJson at :21 sends no fy, and fy = currentFinancialYear() (46) is only shown in subtitle, so it looks like a filter but is not.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx`, `apps/web/src/app/(app)/hr/payroll/income-tax/error.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Set all three back targets to /hr/payroll with one i18n label.
  2. Either add an ?fy= param support (needs backend) or remove {fy} from subtitle.
- **Acceptance:**
  - All back links go to /hr/payroll; subtitle FY matches data or is absent.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /hr/payroll/loans  —  `payroll/loans.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`
- **Design reference:** `redesign/payroll/loans.html`

### GAP-PAYROLL-LOANS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Both the search box and the create form require a pasted “Employee ID (UUID)” (LoanSearchForm.tsx fieldLabel; CreateLoanForm.tsx employeeIdLabel); there is no name/ID lookup and the result never names the employee, so a mistyped UUID files or reads a loan for the wrong person with no visual check.
- **Verified evidence:** LoanSearchForm.tsx:31-39 is a bare text input labelled t('fieldLabel') = 'Employee ID (UUID)' (en.json loanSearchForm) that pushes ?empId=<typed> (line 22); CreateLoanForm.tsx:135-144 has the same free-text input (label createLoanForm.employeeIdLabel). page.tsx:24-27 passes empId straight to /api/v1/payroll/loans and LoanRow (LoansTable.tsx:9-18) has no employee name field, so results never name the person; the create ConfirmDialog (CreateLoanForm.tsx:232-239) echoes only the raw id. No EntityPicker/EmployeePicker exists in apps/web (only app/_components/SmartCombobox.tsx, string-only options).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/LoanSearchForm.tsx`, `apps/web/src/app/(app)/hr/payroll/loans/CreateLoanForm.tsx`, `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`, `apps/web/src/app/_components/EmployeePicker.tsx (new)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create shared client <EmployeePicker> (combobox, debounced search) backed by the existing getEmployees loader endpoint GET /api/v1/hrms/employees (loaders.ts:1122) via a BFF/browserJson call; value = employeeId, display = name + employee code.
  2. Replace the text input in LoanSearchForm with <EmployeePicker>; on select router.push(?empId=<uuid>) so the id stays only in the URL.
  3. Replace the input in CreateLoanForm (lines 131-145) with <EmployeePicker>; keep employeeId state, set empIdInvalid when none chosen.
  4. In CreateLoanForm ConfirmDialog description pass the selected employee name+code instead of the raw id (update createLoanForm.confirmDescription).
  5. In page.tsx resolve the searched employee name (getEmployeeDetail loaders.ts:2382) and show it in the Loans card title / StatGrid caption so the result names the employee.
  6. Remove '(UUID)' from both labels in en.json (loanSearchForm.fieldLabel, createLoanForm.employeeIdLabel) and searchEmptyMessage.
- **Acceptance:**
  - Component test: typing a name in the picker lists matches; selecting one pushes ?empId=<uuid>.
  - Loans page for a valid empId shows the employee name and code above the table.
  - Create-loan confirm dialog shows the name, not a UUID.
  - Manual: no field labelled 'UUID' remains on /hr/payroll/loans.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong-employee loan risk drops; picker must respect tenant scoping and page size of the employees endpoint (default limit 50) so large tenants need server-side search.
- **Depends on:** EmployeePicker (shared, also needed by GAP-PAYROLL-OFF-CYCLE-02)

### GAP-PAYROLL-LOANS-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1758 (merged)
- **First-pass claim:** Disburse releases funds and the ConfirmDialog is the only guard (LoansTable.tsx:96–116): the button is rendered for every role that passes hr/layout.tsx:26–42 (page.tsx has no role check), and there is no maker-checker — the user who creates a loan (CreateLoanForm) can disburse it. Server-side role/segregation cannot be verified (payroll-service absent).
- **Verified evidence:** Web side true: LoansTable.tsx:62-74 renders the Disburse button for any row with status==='applied' with no role prop, ConfirmDialog at :100-113 is danger but has no requireReason; loans/page.tsx has no getSessionRoles/PermissionDenied (compare pensioners/new/page.tsx:15-21). hr/layout.tsx HR_ROLES (:32-42, requireAnyRole at :45) includes manager and employee. CreateLoanForm and the disburse PATCH v1/payroll/loans/{id}/disburse are in the same session, LoanRow has no createdBy, so UI cannot block self-disbursal. Server role/maker-checker cannot be verified: payroll-service is absent (only hrms-service /v1/hrms/loans exists, a different endpoint).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`, `apps/web/src/app/(app)/hr/payroll/loans/LoansTable.tsx`, `apps/web/src/app/(app)/hr/payroll/loans/CreateLoanForm.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Create apps/web/src/lib/auth/payrollRoles.ts exporting PAYROLL_ADMIN_ROLES (payroll_admin, payroll_officer, super_admin, as in hr/payroll/page.tsx:12) and reuse it in page.tsx files.
  2. In loans/page.tsx call getSessionRoles(); compute canDisburse/canCreate and pass canDisburse to <LoansTable>; wrap <CreateLoanForm> in canCreate.
  3. In LoansTable render the Disburse button only when canDisburse; otherwise show the em dash.
  4. Add requireReason to the disburse ConfirmDialog (reasonLabel) and send reason in the PATCH body if the API accepts it (verify in payroll-service).
  5. Backend: enforce role and creator != disburser on PATCH /v1/payroll/loans/:id/disburse and emit an audit event; expose createdBy in the loan payload so the UI can disable the button for the creator.
- **Acceptance:**
  - Render LoansTable with canDisburse=false: no Disburse buttons.
  - As a manager-only session, loans page shows PermissionDenied or read-only view.
  - Backend integration: creator calling disburse gets 403/409 and an audit event is written.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money release: UI hiding is only defence in depth; the real control is server-side maker-checker which is unverifiable here.
- **Depends on:** shared payrollRoles helper

### GAP-PAYROLL-LOANS-03  ·  MEDIUM  ·  confirmed  ·  theme STATS (was OTHER)

- [x] **Status** — PR #1758 (merged)
- **First-pass claim:** “Active / Disbursed” counts statuses applied|disbursed|active (page.tsx:28), so an undisbursed “applied” loan is counted as active; “Monthly EMI Total” sums emiMinor over all loans including closed ones (page.tsx:30), overstating the monthly recovery.
- **Verified evidence:** page.tsx:28 counts status in ['applied','disbursed','active'] under label 'Active / Disbursed' so an undisbursed 'applied' loan counts; page.tsx:30 sums emiMinor over all loans with no status filter, so closed/applied loans inflate 'Monthly EMI Total'; totalOutstanding (:29) is unfiltered too. Sums use Number() on possibly string minor units (float, fine at these sizes but not bigint). The full status enum is not visible without payroll-service.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Define ACTIVE_STATUSES = ['disbursed','active'] and use it for activeLoans (line 28) so 'applied' is not counted; optionally add a separate 'Pending disbursement' stat for applied.
  2. Compute totalEmiMinor only over ACTIVE_STATUSES rows (line 30); compute outstanding likewise or document that it includes all.
  3. Use BigInt accumulation (BigInt(l.emiMinor||0)) then formatMoney.
  4. Confirm the closed/settled status names with the payroll-service enum and add them to the exclusion.
- **Acceptance:**
  - Unit test: rows [applied, disbursed, closed] give active=1 and EMI total = disbursed EMI only.
  - Page shows correct stat with a mixed-status fixture.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Understated/overstated recovery figures shown to payroll; low regression risk.

### GAP-PAYROLL-LOANS-04  ·  MEDIUM  ·  confirmed  ·  theme LABEL (was STATUS)

- [x] **Status** — PR #1758 (merged)
- **First-pass claim:** Type column prints the raw loanType code (“house_building”) — LoansTable.tsx:53 has no label mapping although CreateLoanForm has translated option labels.
- **Verified evidence:** LoansTable.tsx:53 declares { key:'loanType', label:t('colType') } with no render, so DataTable prints the raw code (house_building, festival). CreateLoanForm.tsx:149-152 has translated labels for personal/vehicle/house_building/festival under createLoanForm.option*. Status column already uses cellType 'status' (StatusPill), so the observation's fix text about StatusPill is off-topic.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/LoansTable.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add loansTable.type* keys (or reuse createLoanForm.option* keys) in en.json for personal, vehicle, house_building, festival.
  2. Add a render(row) on the loanType column mapping known codes to t(key) and falling back to code with underscores replaced by spaces (same pattern as OffCycleCard.tsx reasonLabelFor).
  3. Note filterable DataTable filters on raw value; add a display field if filtering by label is wanted.
- **Acceptance:**
  - Component test: row loanType='house_building' renders 'House Building'.
  - Unknown code renders humanised fallback, not crash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic only.

### GAP-PAYROLL-LOANS-05  ·  MEDIUM  ·  partly  ·  theme MONEY (was UUID)

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Create is asynchronous (CreateLoanForm submittedMessage “processed asynchronously”) and the new loan only appears if the user searches that employee’s UUID again; loan number is typed by hand (uniqueness unchecked) and validation is presence-only — EMI × tenure vs principal/interest is never checked (CreateLoanForm.tsx requiredError).
- **Verified evidence:** True: CreateLoanForm.tsx:96 shows submittedMessage 'processed asynchronously' (en.json), createLoan resets employeeId (:98) and calls router.refresh() (:103) - the table only shows the new loan if the current ?empId already equals that employee and the async job has finished. Loan number is free text (:119-129, only trim/maxLength 64), validation is presence-only (:50-60) so EMI*tenure vs principal/interest is never checked, and money is Math.round(Number(x)*100) (:88-89) which misrounds e.g. 1.005. Overstated: page.tsx does keep empId in the URL and refresh re-fetches, so it is not 'only if searched again' when the same employee was searched. Uniqueness of loanNo can only be enforced server-side (cannot verify).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/CreateLoanForm.tsx`, `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`, `apps/web/src/lib/money.ts (new: parseRupeesToMinor)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add parseRupeesToMinor(str) -> bigint/number-string in a shared lib using string split on '.', rejecting >2 decimals and exponent forms; use it for principal and EMI (lines 88-89).
  2. Add client validation: principal>0, EMI>0, tenure integer>=1, EMI*tenure >= principal (interest 0) and a warning when EMI*tenure exceeds principal by more than the simple-interest bound; new i18n error keys.
  3. After success, router.push(?empId=<created employee>) so the list refreshes onto the employee and show a 'pending' note; keep the async message.
  4. Consider server-generated loan number: drop loanNo input if payroll-service can allocate it; else surface 409 duplicate error text via toHumanError.
  5. Send Idempotency-Key to avoid double-create on retry (if API supports).
- **Acceptance:**
  - Unit: parseRupeesToMinor('1.005') rejected, '12.50' -> 1250, '1e3' rejected.
  - Submitting EMI 100, tenure 2, principal 1000 shows a validation error.
  - After create the URL becomes ?empId=<id>.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money entry; validation must not block legitimate interest-bearing loans, so the EMI bound needs business sign-off.
- **Depends on:** GAP-PAYROLL-LOANS-01, shared parseRupeesToMinor (also OFF-CYCLE-03, PENSIONERS-NEW-01)

### GAP-PAYROLL-LOANS-06  ·  LOW  ·  partly  ·  theme DEADCARD (was OTHER)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Recovery Schedule is a permanent EmptyState (page.tsx:75–81), so the page ships a card that can never hold data; a scheme-level loan ceiling per pay level (HBA/vehicle/festival) is not surfaced.
- **Verified evidence:** page.tsx:75-81 renders a Recovery Schedule Card containing only an EmptyState; en.json payrollLoans.recoveryEmptyMessage honestly says no per-installment schedule endpoint exists yet, so it is a disclosed placeholder, not fabricated data. The scheme-level ceiling part is a feature gap: nothing in the page or LoanRow carries a ceiling, and no ceiling endpoint is visible (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/loans/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Either remove the Recovery Schedule Card until the endpoint exists, or hide it behind a feature flag.
  2. If keeping it, render only when empId is set (currently shown even before any search).
  3. Decision: ask payroll product whether loan ceilings per pay level (HBA/vehicle/festival) are required; if yes define API first, then show a 'Max eligible' hint under Loan Type in CreateLoanForm.
- **Acceptance:**
  - Page with no recovery data shows no empty card (or a clearly flagged one).
  - Ceiling shown in create form once API exists.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None; removing card loses a visible roadmap hint.


---
## /hr/payroll/nps  —  `payroll/nps.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`
- **Design reference:** `redesign/payroll/nps.html`

### GAP-PAYROLL-NPS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** “Projected Corpus at Retirement” compounds Σ(employee+employer) contributions of ALL employees at a hard-coded 9.5% for 25 years (nps/page.tsx:20–24,71): NPS returns are market-linked and per-PRAN; an aggregate departmental “corpus” with an assumed return is not a valid projection (the note admits “Not a guarantee”).
- **Verified evidence:** nps/page.tsx:19-25 hard-codes ASSUMED_ANNUAL_RETURN=0.095 and projectCorpus() compounds a lump sum; :53 totalCorpus = sum of ALL rows' emp+er (every employee, every period) and :69-71 compounds it 25 years (AVG_YEARS_TO_RETIRE=25) and renders it at :151-153 as 'Projected Corpus at Retirement'. Mitigation present: projectionNote (en.json npsStatements.projectionNote) says 'illustrative ... Not a guarantee'. Still an aggregate departmental figure with an assumed return, treating past contributions as if all invested for 25 more years, which is not a meaningful number.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Remove the projected-corpus tile (lines 139-157), projectCorpus, ASSUMED_ANNUAL_RETURN and AVG_YEARS_TO_RETIRE.
  2. If a projection is required, move it to a per-employee view using PRAN, date of retirement and actual NAV from GET /v1/hrms/employees/:id/nps, and show it as clearly labelled 'Illustration'.
  3. Delete unused i18n keys projectedCorpusLabel/projectionNote.
- **Acceptance:**
  - Page no longer renders any 'Projected' figure.
  - Grep for 0.095 in nps/ returns nothing.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Removes a widely-misleading number; stakeholders may expect the tile, so confirm with product.

### GAP-PAYROLL-NPS-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** “Code” column is fabricated from employeeId.slice(0,8).toUpperCase() (nps/page.tsx:35) — not the PRAN or an employee code; no PRAN is shown anywhere although the statement is per-subscriber.
- **Verified evidence:** nps/page.tsx:35 employeeCode = r.employeeId.slice(0,8).toUpperCase(); :41 employeeName falls back to that code when the API gives no name; column 'Code' (:182) shows it. StatutoryRow (loaders.ts:4450) has no pran/employeeCode fields, so no PRAN appears anywhere. hrms-service nps module stores pran (modules/nps/routes.ts:59) per employee at GET /v1/hrms/employees/:id/nps, but the page reads /api/v1/payroll/statutory/nps (payroll-service, absent), so whether it can return PRAN/employeeCode is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/app/_data/loaders.ts (StatutoryRow type / getNpsStatements)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add optional pran and employeeCode to StatutoryRow (or a new NpsStatementRow) once the endpoint returns them; confirm with payroll-service contract.
  2. Show 'PRAN' column (masked, last 4 digits) instead of the fabricated code; show employeeCode only if the API supplies it, else '-'.
  3. Remove the slice(0,8) fallback; when employeeName is missing show '-' plus a tooltip, not a fake code.
  4. Backend: add pran and employeeCode to the statutory NPS response (join via API, not cross-service SQL).
- **Acceptance:**
  - Row without employeeCode renders '-' not an 8-char hex.
  - PRAN column shows only last 4 digits.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PRAN is PII; must be masked and only shown to authorised roles.
- **Depends on:** GAP-PAYROLL-NPS-05

### GAP-PAYROLL-NPS-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Missing contributions are coerced to 0 (nps/page.tsx:43–44) and print ₹0.00 rather than “—”; headers “Employee (10%)” / “Employer (14%)” and the subtitle hard-code contribution rates (en.json npsStatements.colEmployeeContrib/subtitle); actual rates come from the rows, so a Tier/NPS-vs-UPS or rate change makes the labels wrong.
- **Verified evidence:** nps/page.tsx:43-44 emp: r.empContribMinor ?? 0 and er: ... ?? 0, so missing values become 0 and DataTable amount cells (cellType 'amount') print the zero as currency instead of the formatMoney '—' convention (formatters.ts:90). Headers/subtitle hard-code '10%'/'14%' in en.json npsStatements.subtitle, colEmployeeContrib, colEmployerContrib, statTotalEmployee, statTotalEmployer. StatutoryRow has no rate field so rates cannot be read from rows as the observation suggests; the labels can only be neutralised or driven by config.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Keep emp/er as number|null (drop '?? 0'); sums skip nulls; DataTable/formatMoney show '—' for null.
  2. Rename columns and stat labels to 'Employee contribution' / 'Employer contribution' and drop the fixed percentages from subtitle, or read rates from a config/API field once provided.
  3. Backend/decision: confirm whether UPS/Tier changes require a rate field in the statutory response.
- **Acceptance:**
  - Row with null empContribMinor renders '—'.
  - No '10%'/'14%' literal remains in npsStatements strings.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; sums exclude nulls so totals unchanged for complete data.

### GAP-PAYROLL-NPS-04  ·  MEDIUM  ·  partly  ·  theme MISLABEL (was I18N)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Accumulated Corpus = Σ(emp+er) contributions (nps/page.tsx:51–53, “simplified: total accumulated so far”) with no NAV/returns, so it understates the true corpus while being labelled “Accumulated Corpus”.
- **Verified evidence:** nps/page.tsx:51-53 totalCorpus = totalEmp+totalEr (comment 'simplified: total accumulated so far') rendered at :110 under 'Accumulated Corpus'. True that it ignores NAV/returns and so is a contributions total, not a corpus. Overstated: accumulatedCorpusNote (en.json) already says 'Employee + Employer contributions (all periods)'. Theme tag I18N is wrong: this is a mislabel; also the same total is already shown as Total Employee + Total Employer stats.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Rename accumulatedCorpusLabel to 'Total Contributions' (or remove the tile as redundant with the two stat cards).
  2. If a true corpus is wanted, take balance from GET /v1/hrms/employees/:id/nps (running balances) per employee, not this aggregate.
- **Acceptance:**
  - Tile label reads 'Total Contributions'.
  - No 'corpus' wording remains unless sourced from a balance field.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Copy only.
- **Depends on:** GAP-PAYROLL-NPS-01

### GAP-PAYROLL-NPS-05  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits employee/manager and the page lists every employee’s name, code and contribution with a row link to /hr/employees/{id}. hr/payroll/pensioners/page.tsx:15–22 documents the same exposure and gates it; this page does not. Backend scoping not verifiable (payroll-service absent).
- **Verified evidence:** nps/page.tsx has no getSessionRoles/PermissionDenied and renders every row (name, derived code, contributions) with rowLinkPrefix '/hr/employees/' (:188-189). hr/layout.tsx HR_ROLES (:32-42) includes manager and employee. pensioners/page.tsx:15-38 defines PENSIONER_VIEW_ROLES and returns <PermissionDenied> for others. Server-side scoping of /api/v1/payroll/statutory/nps cannot be verified (payroll-service absent). hrms-service nps routes use HR_ROLES [hr_admin,hr_officer,super_admin,finance_officer,payroll_admin] (modules/nps/routes.ts:25) for the per-employee endpoints, a hint of intended roles.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`, `apps/web/src/app/(app)/hr/payroll/gpf/page.tsx (same pattern, check)`
- **Fix steps:**
  1. Add shared PAYROLL_VIEW_ROLES in apps/web/src/lib/auth/payrollRoles.ts (payroll_admin, payroll_officer, super_admin, hr_admin, finance_officer as in pensioners/page.tsx:26).
  2. In nps/page.tsx call getSessionRoles() before fetching; if not allowed return <PermissionDenied module='nps' requiredRoles=... /> and skip getNpsStatements().
  3. Apply the same gate to gpf/page.tsx and other statutory pages.
  4. Backend: confirm statutory endpoints reject employee/manager.
- **Acceptance:**
  - employee-role session renders PermissionDenied and issues no statutory fetch.
  - payroll_admin session renders the ledger.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Exposes salary-adjacent PII to all staff if the API is permissive; gating could hide the page from finance roles if the list is wrong, so agree list.
- **Depends on:** shared payrollRoles helper

### GAP-PAYROLL-NPS-06  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Trend chart data is Math.round(value/100) — bare rupee integers — and Chart is called with no valueFormatter (_components/Chart.tsx:17–26), so bars read “18330” instead of ₹18,330 with lakh grouping; the card title alone carries the “₹”.
- **Verified evidence:** nps/page.tsx:64-67 builds chart data with Math.round(value/100) (rupees, paise dropped) and :163 renders <Chart type='bar' data height=180> without valueFormatter. Chart.tsx defines the optional valueFormatter prop (:17-30 doc comment) defaulting to plain digits, so bars read 18330. Card title 'Contribution Trend (last 6 periods, ₹)' is the only currency cue.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/page.tsx`, `apps/web/src/app/_components/Chart.tsx (no change)`
- **Fix steps:**
  1. Keep chart values in minor units (value: sum, no /100) and pass valueFormatter={(v)=>formatMoney(v)} on <Chart> (import already present).
  2. Alternatively keep rupees and pass formatRupees from lib/formatters.ts.
  3. Drop the trailing ', ₹' from trendCardTitle.
- **Acceptance:**
  - Chart labels show '₹18,330.00' style with lakh grouping.
  - No Math.round(value/100) in nps/page.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic; ensure Chart height/labels do not overflow with longer strings.

### GAP-PAYROLL-NPS-07  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** nps/error.tsx sends the user to /hr “Back to HR” (error.tsx:12–14) whereas the page header returns to /hr/payroll; loading.tsx is Tailwind slate/min-h-screen markup outside the design system (nps/loading.tsx:1–16).
- **Verified evidence:** nps/error.tsx:12 sets backHref='/hr' with backLabel npsStatements.errorBackLabel 'Back to HR', while the page header back is /hr/payroll (page.tsx:78). nps/loading.tsx (16 lines) uses Tailwind min-h-screen bg-slate-50 markup; the same block is duplicated in gpf/loading.tsx, whereas loans/off-cycle/pensioners-new loading use design-system classes (page-main wrap / skeleton). Error already uses shared RouteError with reset (retry).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/nps/error.tsx`, `apps/web/src/app/(app)/hr/payroll/nps/loading.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Set backHref='/hr/payroll' and errorBackLabel 'Back to Payroll' in nps/error.tsx.
  2. Rewrite loading.tsx as the async server component used in loans/loading.tsx (page-main wrap + Skeleton from ds with aria-label), shaped like StatGrid + card.
  3. Sweep other payroll statutory routes (gpf) for the same slate markup.
- **Acceptance:**
  - Trigger error boundary: Back link goes to /hr/payroll.
  - Loading UI uses ds classes, no bg-slate-* left in nps/.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/payroll/off-cycle  —  `payroll/off-cycle.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/off-cycle/page.tsx`
- **Design reference:** `redesign/payroll/off-cycle.html`

### GAP-PAYROLL-OFF-CYCLE-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Employees are entered as raw UUIDs, one row each (CreateOffCycleForm.tsx:202); no lookup, no duplicate-employee check, and the run card never lists who is paid (only "Employees in Scope"), so a wrong id is invisible until payment.
- **Verified evidence:** CreateOffCycleForm.tsx: item rows are a free-text Employee ID input (label createOffCycleForm.employeeIdLabel, around :203-210; onChange updateItem employeeId) with only trim/non-empty validation (:84-87); no duplicate check. RunCard (OffCycleCard.tsx:81-86) shows only employee_count, no list of employees or names; OffCycleRow type (OffCycleList.tsx:10-20) has no items. Wrong ids are invisible until processing. Server validation of employee existence cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/off-cycle/CreateOffCycleForm.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/OffCycleCard.tsx`, `apps/web/src/app/_components/EmployeePicker.tsx (new, shared)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Use the shared <EmployeePicker> (see LOANS-01) for each item row; store id and display name.
  2. On add/change, block duplicates (Set of employeeId) and show inline error; add i18n key.
  3. Show the resolved name+code list in the ConfirmDialog description before create.
  4. Run card: add expandable items (name, amount) if GET off-cycle/:id returns items (verify in payroll-service); otherwise show count only and add to backend backlog.
- **Acceptance:**
  - Selecting the same employee twice shows a duplicate error.
  - Confirm dialog lists names and amounts.
  - No raw id input remains.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Bulk payment run; picker must handle large employee sets (consider CSV import separately).
- **Depends on:** GAP-PAYROLL-LOANS-01

### GAP-PAYROLL-OFF-CYCLE-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Amounts converted with Math.round(parseFloat(v)*100) (CreateOffCycleForm.tsx:70,115): "1e3" or "12abc" parse, floats misround. Only a positive check exists (itemsValidationError).
- **Verified evidence:** Lines 70 and 115 use parseFloat then Math.round(x*100) (also :85-86 validation and the running total :68-71). Real: floats misround (e.g. 1.005 -> 100), and '1e3' is valid for <input type=number> so parseFloat gives 1000. Overstated: '12abc' cannot reach state because a type=number input reports value '' for non-numeric text (line ~219 type='number' min='0' step='0.01'), so it fails the NaN check. Only >0 and NaN checks exist; no upper bound or 2-decimal check. Total shown in ConfirmDialog is sum of rounded minor ints (fine) but derived from float.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/off-cycle/CreateOffCycleForm.tsx`, `apps/web/src/lib/money.ts (new)`
- **Fix steps:**
  1. Add parseRupeesToMinor(str) in apps/web/src/lib/money.ts: regex /^\d+(\.\d{1,2})?$/, compute via string split to integer paise, return null on failure.
  2. Use it in totalAmountMinor (:68-71), validation (:84-95) and payload (:113-116); sum as bigint and send as number/string per API contract.
  3. Add max amount sanity bound (config) and i18n error for >2 decimals.
- **Acceptance:**
  - Unit: '1.005' -> null, '1e3' -> null, '10.5' -> 1050, '0.1'+'0.2' totals 30 paise.
  - Form shows validation error for 3-decimal input.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money conversion; keep unit tests exhaustive to avoid off-by-paise regressions.
- **Depends on:** shared parseRupeesToMinor

### GAP-PAYROLL-OFF-CYCLE-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Confirm dialog for an irreversible run has no reason field and is not styled danger (OffCycleCard.tsx:146), unlike run approve/disburse on /hr/payroll/{id}. Run type list omits arrear/correction though cards label them (OffCycleCard.tsx:20).
- **Verified evidence:** OffCycleCard.tsx:146-164: ConfirmDialog for processing has no danger and no requireReason/reasonLabel, though its text says 'irreversible' (en.json offCycleCard.confirmDescription); ConfirmDialog supports both props (ConfirmDialog.tsx:29-40). Second claim overstated: form RunType is bonus|incentive|adhoc (CreateOffCycleForm.tsx:10) while cards label arrear/correction (:20-26) for rows the backend may return, but arrears and corrections have their own routes (payroll/arrears, payroll/corrections with CreateCorrectionForm), so the label map is legitimate. Whether /hr/payroll/{id} approve dialogs use danger+reason not re-verified here.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/off-cycle/OffCycleCard.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add danger and requireReason (reasonLabel key, minReasonLength e.g. 10) to the ConfirmDialog at :146.
  2. Pass reason to processRun() and include it in the POST body to /v1/payroll/off-cycle/:id/process if the API accepts it; otherwise backend change.
  3. Backend: enforce approver != creator and write an audit event on process.
  4. Leave REASON_LABEL_KEYS as is; optionally comment that arrear/correction rows originate from other flows.
- **Acceptance:**
  - Confirm button disabled until reason entered; button styled destructive.
  - Backend records reason and actor in audit log.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible payment run; API contract for reason must be confirmed to avoid 400s.
- **Depends on:** GAP-PAYROLL-LOANS-02

### GAP-PAYROLL-OFF-CYCLE-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was OTHER)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Off-cycle payments are not linked to Disbursement: nothing on the card says how or when a processed run reaches bank transfer. Period is free text YYYY-MM with no check against existing runs.
- **Verified evidence:** RunCard (OffCycleCard.tsx:33-93) shows type, period, amounts, employee count, status, and approval status only; nothing mentions disbursement/bank file or links to /hr/payroll disbursement pages. Period is a free text input validated only by /^\d{4}-\d{2}$/ (CreateOffCycleForm.tsx:77), not checked for a valid month (2025-13 passes) or against existing runs (page.tsx already loads all runs but does not pass them to the form). Backend disbursement linkage cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/off-cycle/CreateOffCycleForm.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/OffCycleCard.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Replace period text input with <input type='month'> (value YYYY-MM) and validate month 01-12.
  2. Pass existing runs from page.tsx to CreateOffCycleForm and warn (not block) when same runType+period already exists.
  3. On processed runs add a status line/link to the disbursement page once the API exposes disbursement state (else static hint text explaining next step).
  4. Decision: confirm off-cycle net payable flows through the standard Disbursement/bank file.
- **Acceptance:**
  - Entering 2025-13 is rejected.
  - Existing run for same period shows warning.
  - Processed card shows next-step text/link.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate-payment risk if warning ignored; needs business rule on allowed duplicates.

### GAP-PAYROLL-OFF-CYCLE-06  ·  LOW  ·  partly  ·  theme DEADCODE (was ROLEGATE)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** OffCycleList.tsx (table with its own Process button) is imported only for its type; dead code beside the card view. Form visible to all roles; loading.tsx bare skeleton.
- **Verified evidence:** Dead code confirmed: off-cycle/page.tsx:7 imports OffCycleList but only renders OffCycleCards (:56); OffCycleCard.tsx:9 imports only OffCycleRow type; OffCycleList.tsx:26-34 comment admits it is unused (only its own test). No role check in page.tsx, so CreateOffCycleForm and Process button show for all HR_ROLES incl. employee/manager (hr/layout.tsx:32-42). Overstated: loading.tsx is the standard ds skeleton (page-main wrap + skeleton with aria-label), same as loans, not 'bare' by comparison with siblings. Server enforcement not verifiable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/off-cycle/page.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/OffCycleList.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/OffCycleCard.tsx`, `apps/web/src/app/(app)/hr/payroll/off-cycle/loading.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Move OffCycleRow type to off-cycle/types.ts; import it in page.tsx and OffCycleCard.tsx; delete OffCycleList.tsx, its test and offCycleList i18n keys.
  2. In page.tsx use getSessionRoles + shared PAYROLL_ADMIN_ROLES; render CreateOffCycleForm and pass canProcess to OffCycleCards only for admins, others get PermissionDenied.
  3. Optionally shape loading.tsx like the page (StatGrid + card skeleton).
- **Acceptance:**
  - OffCycleList.tsx removed and build passes.
  - Non-payroll role sees no create form or Process button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Deleting the list also removes its test; low risk.
- **Depends on:** shared payrollRoles helper


---
## /hr/payroll/pay-groups  —  `payroll/pay-groups.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/pay-groups/page.tsx`
- **Design reference:** `redesign/payroll/pay-groups.html`

### GAP-PAYROLL-PAY-GROUPS-01  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was OTHER)

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Pay day is a single day-of-month (1–31, CreatePayGroupForm dayRangeError) even for weekly and bi-weekly groups, and 29–31 has no month-end rule; the card then prints e.g. "5th" for a weekly group (PayGroupCard.tsx pay-day tile).
- **Verified evidence:** CreatePayGroupForm.tsx:29 payDayOfMonth state (default '28'), number input labelled 'Pay Day of Month' for all frequencies (createPayGroupForm.payDayLabel), validated 1-31 (dayRangeError, :52); frequency select monthly|bi_weekly|weekly (:28). PayGroupCard.tsx:144-146 prints payDayOfMonth + hard-coded 'th' regardless of frequency, so a weekly group shows '5th'. No month-end rule for 29-31 in the client; server handling cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pay-groups/CreatePayGroupForm.tsx`, `apps/web/src/app/(app)/hr/payroll/pay-groups/PayGroupCard.tsx`, `apps/web/src/app/(app)/hr/payroll/pay-groups/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In CreatePayGroupForm render the pay-day control by frequency: day-of-month (1-28 plus 'Last day of month') for monthly; weekday select for weekly; weekday+week parity for bi_weekly.
  2. Send the API field(s) agreed with payroll-service (payDayOfMonth today; add payWeekday / lastDay flag) - backend change needed.
  3. PayGroupCard: format pay day by frequency (see GAP-PAYROLL-PAY-GROUPS-02), showing 'Last day' or weekday name.
  4. Update dayRangeError and confirmDescription strings.
- **Acceptance:**
  - Weekly group card shows 'Friday', not '5th'.
  - Monthly with 31 shows 'Last day of month' semantic per API.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Schedule semantics drive salary dates; needs payroll-service contract change and business sign-off.
- **Depends on:** GAP-PAYROLL-PAY-GROUPS-02

### GAP-PAYROLL-PAY-GROUPS-02  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Card hard-codes an English "th" suffix (PayGroupCard.tsx:<sup>th</sup>): "1th", "2th", "22th"; not i18n-safe either.
- **Verified evidence:** PayGroupCard.tsx:144-147 renders {payDayOfMonth}<sup>th</sup> unconditionally: 1th, 2th, 3th, 22nd -> '22th'; the 'th' is a literal outside next-intl.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pay-groups/PayGroupCard.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add payGroupCard.payDayOrdinal ICU message: '{day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}' (with locale variants) or use the non-ordinal 'Day {day}'.
  2. Replace the <sup>th</sup> literal with t('payDayValue', { day }).
  3. Unit test days 1,2,3,4,11,12,13,21,22,23,31.
- **Acceptance:**
  - Component test: day 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', 22 -> '22nd'.
  - No literal 'th' remains in the file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PAYROLL-PAY-GROUPS-03  ·  MEDIUM  ·  confirmed  ·  theme MISSING-FEATURE (was DEADROUTE)

- [x] **Status** — PR #1850 (merged): via #1847 in #1850
- **First-pass claim:** Pay groups are read-only after creation: no edit, deactivate or assign-employees control, yet Inactive is a stat. Employee count and structure come from the API with no link to either.
- **Verified evidence:** pay-groups/page.tsx renders PayGroupCard (no action props, no links, PayGroupCard.tsx has no buttons) and CreatePayGroupForm only; nothing edits, deactivates or assigns employees, yet page.tsx:40 counts inactive groups and the card shows an Inactive pill. employeeCount (card :119-122) and salaryStructureName (:164) are plain text, not links. Whether payroll-service exposes PATCH/assign endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pay-groups/page.tsx`, `apps/web/src/app/(app)/hr/payroll/pay-groups/PayGroupCard.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Confirm with payroll-service which endpoints exist (update, deactivate, assign employees); do not invent them.
  2. If present: add Edit and Deactivate/Reactivate actions to PayGroupCard (role-gated, ConfirmDialog with reason for deactivate) and make employee count link to /hr/employees?payGroup=<id> if that filter exists.
  3. Link structure name to /hr/payroll/structures.
  4. If absent: document as read-only and hide the Inactive stat or explain how groups become inactive.
- **Acceptance:**
  - Deactivate action moves a group to Inactive and the stat updates after refresh.
  - Employee count link opens a filtered list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Deactivating a group used by a payroll run could strand employees; needs server checks.
- **Depends on:** shared payrollRoles helper

### GAP-PAYROLL-PAY-GROUPS-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was ROLEGATE)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Timezone is a free-text input (maxLength 64, CreatePayGroupForm.tsx:151) — an invalid IANA name is accepted client-side; no role gate on the form (server guard unverifiable).
- **Verified evidence:** CreatePayGroupForm.tsx:151-156 timezone is a text input (maxLength 64) with no validation and a fallback to 'Asia/Kolkata' when blank (:81), so an invalid IANA name is accepted client-side. No role gate: pay-groups/page.tsx has no getSessionRoles, and hr/layout.tsx admits employee/manager. Server-side timezone validation and role guard cannot be verified (payroll-service absent). Theme ROLEGATE is only half the finding; the validation half is a separate issue.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pay-groups/CreatePayGroupForm.tsx`, `apps/web/src/app/(app)/hr/payroll/pay-groups/page.tsx`, `apps/web/src/lib/auth/payrollRoles.ts (new)`
- **Fix steps:**
  1. Replace text input with a <select>/datalist from Intl.supportedValuesOf('timeZone') (fallback list incl. Asia/Kolkata); or validate with new Intl.DateTimeFormat('en',{timeZone}) in try/catch and show an i18n error.
  2. In page.tsx gate the create form (and page) by PAYROLL_ADMIN_ROLES via getSessionRoles + PermissionDenied.
  3. Backend: validate IANA zone and role on POST /v1/payroll/pay-groups.
- **Acceptance:**
  - Entering 'Mars/Base' shows an error and blocks submit.
  - employee-role session cannot see the create form.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong timezone shifts pay-day cutoffs; low regression risk.
- **Depends on:** shared payrollRoles helper

### GAP-PAYROLL-PAY-GROUPS-05  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** No DataSourceBadge/cache on this route unlike siblings; revision badge turns amber after 3 months based on the browser clock (PayGroupCard.tsx:39). Status pill prints the raw enum.
- **Verified evidence:** pay-groups/page.tsx does not import DataSourceBadge (loans/page.tsx:3 and off-cycle/page.tsx:3 do); errors are handled via RefreshErrorState only. PayGroupCard.tsx:32-39 RevisionBadge uses new Date() (client clock, also a hydration-mismatch risk in a client component) and turns amber when diffMonths > 3; toLocaleDateString('en-IN') at :43,54 uses the browser timezone and not shared formatIndianDate. Status pill at :179-184 prints the raw {status} enum in a .pill span rather than ds StatusPill (used in OffCycleCard.tsx:54).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pay-groups/PayGroupCard.tsx`, `apps/web/src/app/(app)/hr/payroll/pay-groups/page.tsx`
- **Fix steps:**
  1. Use ds <StatusPill status={status} /> in PayGroupCard instead of the raw span.
  2. Add DataSourceBadge with source from result (page.tsx) as in loans/off-cycle.
  3. Compute revision recency on the server (page.tsx) or drop the amber staleness cue; format dates with formatIndianDate from lib/formatters.ts.
  4. Translate/derive the status label via a status map.
- **Acceptance:**
  - Inactive group shows a styled 'Inactive' pill, not 'inactive'.
  - Dates render in dd Mon yyyy IST regardless of browser tz.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Cosmetic; keep StatusPill tone mapping for unknown statuses.


---
## /hr/payroll/pensioners  —  `payroll/pensioners.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`
- **Design reference:** `redesign/payroll/pensioners.html`

### GAP-PAYROLL-PENSIONERS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Silent all-zero dashboard on failure: stats use total/active/pensionPayableMinor unconditionally (pensioners/page.tsx:77–82) while getPensioners() falls back to [] on error, so a failed load prints 0 / ₹0.00 and the table says “No pensioner records match your filter”; only a small DataSourceBadge signals the outage. Every sibling payroll list gates stats with “—” and shows RefreshErrorState.
- **Verified evidence:** pensioners/page.tsx:42 destructures getPensioners() (loaders.ts:4512, fetchJson fallback []). Lines 44-49 compute total/active/pension from [] and 78-81 pass plain numbers/formatMoney(0) to StatCard, so failure shows 0 / ₹0.00. DataTable (84-94) shows emptyTitle/emptyMessage. `source` only feeds DataSourceBadge (76); RefreshErrorState is not imported. period/register pages do gate with `errored ? null` (StatCard.tsx:21-24 renders null as em dash) and RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState from ../../../../_components/ds and toHumanError from @/lib/messages.
  2. Add `const errored = source === "error"`.
  3. Pass `errored ? null : value` to all four StatCards (lines 78-81); StatCard already renders an em dash for null.
  4. Wrap DataTable in `errored ? <div className="pad"><RefreshErrorState error={toHumanError("load",{area:"pensioners"})} backHref="/hr/payroll"/></div> : <DataTable .../>` as in period/page.tsx:97-103.
- **Acceptance:**
  - Component test: mock getPensioners -> {data:[],source:"error"}; expect no "₹0.00", four em dashes, RefreshErrorState present, empty-state text absent.
  - Mock source "api" with [] -> stats show 0 and the empty state (true empty).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only. Do not hide the true-empty case.

### GAP-PAYROLL-PENSIONERS-02  ·  MEDIUM  ·  confirmed  ·  theme LABEL (was I18N)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** “Pension Payable This Month” is Σ basicPensionMinor of active pensioners (page.tsx:46–48) — no DA/relief, medical allowance or commutation recovery — yet is labelled as the amount payable.
- **Verified evidence:** pensioners/page.tsx:46-48 sums p.basicPensionMinor for status==='active' and StatCard line 80 labels it t('statPensionPayable') = 'Pension Payable This Month' (en.json:3413). Field is basic pension only; no DA/relief/medical/commutation-recovery term exists in this page. Whether PensionerSummary carries those fields cannot be seen (@civitasone/types absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Rename key statPensionPayable label to 'Basic Pension (Active)' in en.json and other locale files, and add a helper caption 'Excludes DA/relief and recoveries'.
  2. If backend exposes a computed monthly payable, read that field instead of summing basicPensionMinor; otherwise keep the sum but keep the honest label.
  3. Sum with BigInt if basicPensionMinor may arrive as string (see MONEY note) and pass to formatMoney.
- **Acceptance:**
  - Snapshot/component test: stat label text contains 'Basic' and not 'Payable This Month'.
  - Manual: active-only pensioners with known basics; card equals their sum.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wording change. Business decision if finance wants a true payable figure (then backend field).

### GAP-PAYROLL-PENSIONERS-03  ·  MEDIUM  ·  confirmed  ·  theme I18N

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Empty copy “No pensioner records match your filter. Try a different search term.” (en.json pensioners.emptyMessage) is shown for a truly empty register, and rows have no rowHref/detail route, so a pensioner cannot be opened, marked deceased or stopped from this UI.
- **Verified evidence:** en.json:3422-3423 emptyMessage='No pensioner records match your filter. Try a different search term.' is passed as DataTable emptyMessage (page.tsx:93) regardless of whether the filter is active. DataTable (84-94) sets no rowHref/rowLinkKey, and the pensioners folder holds only page.tsx and new/ (no [id] route), so rows are not openable and there is no mark-deceased/stop UI. Backend endpoints for stop/deceased cannot be verified (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/hr/payroll/pensioners/[id]/page.tsx (new)`
- **Fix steps:**
  1. Split empty copy: DataTable shows filter message only when a filter is active; add key emptyRegisterMessage ('No pensioners registered yet') for the zero-row case (pass emptyMessage conditionally on rows.length===0).
  2. Add [id]/page.tsx detail route and pass rowLinkKey='id' rowLinkPrefix='/hr/payroll/pensioners/' to DataTable (server-safe props).
  3. In detail page add status-change actions (mark deceased / stop) gated by PENSIONER_CREATE_ROLES with ConfirmDialog, only after backend endpoint is confirmed.
  4. Include id in the row data (already in PensionerSummary if present; verify).
- **Acceptance:**
  - Test: rows=[] shows register-empty copy; typing filter with no match shows filter copy.
  - Click a row -> navigates to detail route.
  - Detail action posts and page refreshes with new status (needs backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Stopping/deceased marking changes pension payout: needs audit event, confirm dialog, backend role check.
- **Depends on:** GAP-PAYROLL-PENSIONERS-05

### GAP-PAYROLL-PENSIONERS-04  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** PII (PPO no., full name, DDO code, basic pension) is listed unmasked; the gate at page.tsx:22 includes hr_admin and finance_officer, who cannot create (page.tsx:33) — reasonable, but no DPDP purpose note or access log cue is shown.
- **Verified evidence:** Page prints ppoNo, fullName, ddoCode, basicPensionDisplay in clear (page.tsx:57-61) with no mask and no DPDP notice. No <Masked> component exists in _components or ds. Overstated: PENSIONER_VIEW_ROLES (page.tsx:22) lists finance_officer, but hr/layout.tsx HR_ROLES omits finance_officer so requireAnyRole redirects it to /dashboard before this page renders; only hr_admin reaches view-without-create. Gating itself is reasonable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`, `apps/web/src/app/_components/Masked.tsx (new)`, `apps/web/src/app/(app)/hr/layout.tsx`
- **Fix steps:**
  1. Create <Masked value kind='ppo' revealRoles> client component that shows last 4 chars and reveals on click for allowed roles, posting an audit event (reuse existing audit/logging client if present; otherwise decision).
  2. Pre-format a masked ppoNo string in the row mapping (page.tsx:54) since render props cannot cross the server boundary, or make the column a client cell.
  3. Add a one-line data-use notice (next-intl key) under PageHeader.
  4. Decide whether finance_officer should be in HR_ROLES; otherwise drop it from PENSIONER_VIEW_ROLES to remove dead intent.
- **Acceptance:**
  - Test: default render shows masked PPO; reveal by permitted role fires audit call.
  - hr_admin sees no Add button and list renders.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Masking can slow payroll staff who need PPO numbers; keep reveal one click. Audit event needs a backend sink.
- **Depends on:** GAP-PAYROLL-RETURNS-05

### GAP-PAYROLL-PENSIONERS-05  ·  LOW  ·  partly  ·  theme CACHE (was VALIDATION)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Role arrays are duplicated across page.tsx and new/page.tsx with long fix-history comments (page.tsx:10–33) instead of a shared constant; getPensioners() caches for 120 s (loaders.ts:4512–4518) so a just-added pensioner may not appear for two minutes.
- **Verified evidence:** Role arrays are duplicated: pensioners/page.tsx:22,33 and new/page.tsx:15 (PENSIONER_CREATE_ROLES); the 10-line fix-history comments exist (page.tsx:14-32). Cache is real: loaders.ts:4514 revalidateSeconds:120 -> apiClient.ts:137 next:{revalidate:120}; CreatePensionerForm.tsx:110 does router.push without revalidatePath/tag, so a new pensioner can be missing up to 120 s. (Theme tag VALIDATION is wrong.)
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/page.tsx`, `apps/web/src/app/(app)/hr/payroll/pensioners/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/hr/payroll/pensioners/new/CreatePensionerForm.tsx`, `apps/web/src/app/(app)/hr/payroll/_lib/roles.ts (new)`
- **Fix steps:**
  1. Create hr/payroll/_lib/roles.ts exporting PENSIONER_VIEW_ROLES and PENSIONER_CREATE_ROLES; import in both pages; trim comments.
  2. Remove revalidateSeconds from getPensioners (payroll money list; use no-store like sibling loaders) or tag the fetch and add a server action calling revalidateTag after create.
  3. Verify CreatePensionerForm calls router.refresh() after success.
- **Acceptance:**
  - Test: after successful create, list page shows the new PPO on next navigation without waiting.
  - Unit: both pages import roles from one module.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Dropping the cache raises load slightly on a small list.


---
## /hr/payroll/pensioners/new  —  `payroll/pensioners-new.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/page.tsx`
- **Design reference:** `redesign/payroll/pensioners-new.html`

### GAP-PAYROLL-PENSIONERS-NEW-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Basic Pension (₹) has no required marker and no validation: handleSubmit checks only PPO, name and DOB (CreatePensionerForm.tsx:64–69) and toMinorUnits() turns a blank/NaN into 0 (lines 57–61), so a pensioner can be created with ₹0.00 basic pension and then counts as “active” in the payable total. DOB and commutation date are not range-checked either.
- **Verified evidence:** CreatePensionerForm.tsx:66 handleSubmit checks only ppoNo, fullName, dateOfBirth (requiredError); basic pension input (:164-174) has no required attribute or asterisk; toMinorUnits (:57-61) returns 0 for blank/NaN and payload sends basicPensionMinor (:89) so a blank yields 0. pensioners/page.tsx:45-48 sums basicPensionMinor for status==='active', and whether a new record is 'active' by default depends on the server (cannot verify). DOB and commutation date are plain type=date with no min/max (:154-160, :195-201). Also uses Math.round(val*100) float conversion.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/CreatePensionerForm.tsx`, `apps/web/src/lib/money.ts (new, shared)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Mark Basic Pension required (asterisk, required attr, aria-required) and add to the submit check with a new i18n message; reject <= 0.
  2. Replace toMinorUnits with shared parseRupeesToMinor (string based, max 2 decimals).
  3. Validate DOB: not future, age >= 50 or configurable range; commutation date not before DOB.
  4. Backend: enforce basicPensionMinor > 0 via zod on POST /v1/payroll/pensioners.
- **Acceptance:**
  - Submitting blank basic pension shows an error and sends no request.
  - DOB in the future is rejected.
  - Unit: '25000.50' -> 2500050.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong pension amount would flow to payable totals; add tests.
- **Depends on:** shared parseRupeesToMinor

### GAP-PAYROLL-PENSIONERS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Creates a PPO record with bank account, IFSC and PAN in one submit and no ConfirmDialog, unlike every other payroll create form (loans, bonus, structures…); bank account/PAN are plain type="text" inputs with no masking or DPDP notice (CreatePensionerForm.tsx:231–262).
- **Verified evidence:** CreatePensionerForm.tsx handleSubmit posts directly (:82-99) with no ConfirmDialog; every other Create*Form under hr/payroll uses ConfirmDialog (grep -L showed only this file lacks it). Bank account (:232-240), IFSC (:244-252), PAN (:256-265) are plain type='text' with no masking, autoComplete=off or DPDP notice; PAN has maxLength 10 and PAN_REGEX (:10,72) but no IFSC/account validation. No shared <Masked> component exists in the repo.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/CreatePensionerForm.tsx`, `apps/web/src/app/(app)/hr/payroll/pensioners/new/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add ConfirmDialog (ds) before POST summarising PPO, name, basic pension and last-4 of account; wire like CreateLoanForm.
  2. Add autoComplete='off', inputMode and IFSC regex ^[A-Z]{4}0[A-Z0-9]{6}$ and account digits 9-18 validation; uppercase IFSC.
  3. Add DPDP purpose notice text under the bank/PAN group (i18n).
  4. Create ds <Masked> for display of PAN/account elsewhere (list/detail) with role-based reveal + audit; use it on read views, not necessarily on entry fields.
- **Acceptance:**
  - Submit shows confirm dialog first; cancel sends nothing.
  - Invalid IFSC blocked client-side.
  - Notice visible near sensitive fields.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** PII entry; server must still validate and never log these fields.
- **Depends on:** shared <Masked>

### GAP-PAYROLL-PENSIONERS-NEW-03  ·  MEDIUM  ·  partly  ·  theme CACHE (was DEADROUTE)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Submits with raw fetch to /api/proxy/v1/payroll/pensioners and res.ok (CreatePensionerForm.tsx:82–105) instead of browserJson used by the sibling forms; no router.refresh() before navigation and the list loader caches 120 s (loaders.ts:4512–4518), so the new pensioner may be missing on arrival.
- **Verified evidence:** Raw fetch confirmed: CreatePensionerForm.tsx:82 fetch('/api/proxy/v1/payroll/pensioners', headers content-type only) instead of browserJson/browserFetch (lib/api/browserClient.ts:20-33 adds device headers x-device-id and trust token and credentials same-origin), so device-trust headers are omitted; error handling uses useFormError.fromResponse (:102), which is acceptable. After success it calls router.push (:110) with no router.refresh. Stale list is plausible: getPensioners (loaders.ts:4512-4517) uses revalidateSeconds:120 (Next data cache), and router.refresh would not bust that server data cache anyway; the real fix is cache invalidation (revalidatePath/tag via server action or route handler) or no-store on this loader. Theme 'DEADROUTE' is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/CreatePensionerForm.tsx`, `apps/web/src/app/_data/loaders.ts (getPensioners)`, `apps/web/src/app/api/proxy (verify route handler, optional revalidate)`
- **Fix steps:**
  1. Replace fetch with browserFetch('v1/payroll/pensioners', {method:'POST', body}) so device headers are sent; keep formError.fromResponse for errors.
  2. Invalidate the cache: add revalidateTag('payroll.pensioners') / revalidatePath('/hr/payroll/pensioners') in a small server action called after success, or set getPensioners to revalidateSeconds 0 / tag it.
  3. Then router.push + router.refresh() so client router cache is bypassed.
- **Acceptance:**
  - After create the pensioners list shows the new PPO on first arrival (no 120 s wait).
  - Request carries x-device-id header.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; cache invalidation must be tenant-safe (tag by tenant if tags are shared).

### GAP-PAYROLL-PENSIONERS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was DATEFMT)

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** Commuted Pension and Commutation Date are independent optional fields; a date without an amount (or vice-versa) is accepted (CreatePensionerForm.tsx:89–92).
- **Verified evidence:** CreatePensionerForm.tsx:90-91 commutedPensionMinor is sent as amount or 0 and commutationDate as date or undefined, independently; commutation date input (:195-201) and commuted amount (:181-190) have no cross-validation, so a date without amount or amount without date is accepted. Theme DATEFMT is wrong: this is a validation gap, no date formatting involved.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/CreatePensionerForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In handleSubmit require both commutedPension>0 and commutationDate, or neither; add i18n error 'commutationPairError'.
  2. Validate commutationDate >= dateOfBirth and not in the future.
  3. Set aria-invalid and focus the offending field.
  4. Backend zod refine for same rule.
- **Acceptance:**
  - Amount without date -> inline error and no POST.
  - Both blank -> submits with 0/undefined.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-PENSIONERS-NEW-05  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1760 (merged)
- **First-pass claim:** loading.tsx (24 lines) draws the list page skeleton (stat tiles + table block) for a form page, and error.tsx/new/page.tsx duplicate the same failure UI.
- **Verified evidence:** loading.tsx (24 lines) renders header plus 'panel + 4 tiles + 240px block' skeleton (loadingHeading/loadingSub) - a generic stat/table skeleton, not the form shape, so partly true. error.tsx uses shared RouteError with retry and back to /hr/payroll/pensioners; new/page.tsx:34-39 also has try/catch rendering RefreshErrorState with the same back link, so failure UI is duplicated, though the try/catch around JSX built after getTranslations is practically unreachable (errors will hit error.tsx).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/pensioners/new/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/pensioners/new/page.tsx`
- **Fix steps:**
  1. Redraw loading.tsx as a single card skeleton with 3-4 labelled input rows matching the form layout (maxWidth 640).
  2. Remove the try/catch and RefreshErrorState fallback from new/page.tsx, letting error.tsx handle failures.
  3. Drop unused imports (RefreshErrorState, toHumanError).
- **Acceptance:**
  - Loading state visually matches form width/rows.
  - Throwing in the page renders RouteError only.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /hr/payroll/period  —  `payroll/period.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`
- **Design reference:** `redesign/payroll/period.html`

### GAP-PAYROLL-PERIOD-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1752 (merged), as part of the same run-lifecycle cluster fix.
- **First-pass claim:** Not a period view: it lists the same runs as /hr/payroll and /hr/payroll/runs (page.tsx header comment). No period open/close or lock, so "Payroll Periods" promises more than it shows, and nothing here links to the run detail.
- **Verified evidence:** period/page.tsx:9-20 comment and :62 show it calls getPayrollRunDetails() (same as /hr/payroll and /runs). No period open/close/lock control exists; DataTable (102) has no rowLinkKey/rowLinkPrefix, so rows do not link to /hr/payroll/{id} (runs/page.tsx:64 does). Title from payrollPeriod.title implies period management.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Decide: either retitle to 'Payroll Runs by Period' (i18n keys title/subtitle) or redirect the route to /hr/payroll/runs and remove page.
  2. If kept, add rowLinkKey='id' rowLinkPrefix='/hr/payroll/' to the DataTable (id is in Row).
  3. Only add period lock/close after a payroll endpoint is confirmed (not visible in snapshot).
- **Acceptance:**
  - Click a row -> /hr/payroll/{id}.
  - Title/subtitle no longer promise open/close.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; dashboard CTAs currently funnel here (comment lines 15-18), so redirect must keep them working.
- **Depends on:** GAP-PAYROLL-PERIOD-05

### GAP-PAYROLL-PERIOD-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1752 (merged): stat tiles fixed to total-minus-paid logic, same fix as the Home page.
- **First-pass claim:** Employees total sums headcount across every run (page.tsx:94), counting each person once per month; "Completed" counts paid runs too and omits approved/failed, as does "Processing" (approved runs vanish from both).
- **Verified evidence:** period/page.tsx:94 sums employeesProcessed over all runs (a person paid monthly is counted once per run). Line 92 Completed = completed|paid; line 93 Processing = processing|draft; approved, failed (and others) fall in neither. Payroll home (page.tsx:31-38) uses the same paid/completed vs draft/processing split, so it is consistent but incomplete.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Replace Employees tile with the latest run's employeesProcessed (max period) or relabel 'Employee-runs (total)'.
  2. Add status buckets: Approved, Failed (or one 'Other' tile) using a shared payrollRunStatusLabel/bucket helper (@/lib/payroll/statusLabels).
  3. Reuse the helper in payroll/page.tsx so both screens agree.
- **Acceptance:**
  - Unit test with runs [paid, approved, failed, draft]: tile counts sum to total.
  - Employees tile equals latest run's count.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; counts only.
- **Depends on:** GAP-PAYROLL-PERIOD-05

### GAP-PAYROLL-PERIOD-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1752 (merged), as part of the same run-lifecycle cluster fix.
- **First-pass claim:** Rows are not links and the Run Date column prints the raw API string (page.tsx:78-84, no formatIndianDate), unlike the detail page. Back goes to /hr while sibling routes go to /hr/payroll.
- **Verified evidence:** period/page.tsx:52 maps runDate: run.runDate and column 78 renders it via String(row[key]) (DataTable.tsx:138) with no formatting, whereas [id]/page.tsx:4 imports formatIndianDate. Rows are not links (no rowLink props). Back is back='/hr' (line 88) vs '/hr/payroll' on siblings. Note formatIndianDate (formatters.ts:2-7) outputs dd/mm/yyyy, not 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add runDateDisplay: formatIndianDate(r.runDate) to DisplayRow (page.tsx:69-74) and use it for the column.
  2. Change back to '/hr/payroll' and backLabel via t().
  3. Add rowLinkKey='id' rowLinkPrefix='/hr/payroll/'.
  4. If house style is dd Mon yyyy, change formatIndianDate in one place.
- **Acceptance:**
  - Render test: runDate '2026-08-31T00:00:00Z' shows 31/08/2026 (or 31 Aug 2026), not ISO.
  - Back link href is /hr/payroll.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; timezone: use IST when formatting timestamps.
- **Depends on:** GAP-PAYROLL-PERIOD-01

### GAP-PAYROLL-PERIOD-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — verified NOT a bug via PR #1752 (same payroll-service minor-unit division as HOME-01/RUNS-01); also switched to DataTable cellType rupees to remove the footgun the comment warned about.
- **First-pass claim:** Rupee amounts pre-formatted with formatRupees (page.tsx:71); the code comments warn cellType "amount" would divide by 100 again — mixed units are one wrong column type away from a 100x error. Not verifiable without payroll-service source.
- **Verified evidence:** period/page.tsx:71-73 formatRupees on run.grossAmount/netAmount/deductions, and the toRow comment (41-47) documents rupees from payroll-service. It is consistent today. But comment is stale: DataTable supports cellType:'rupees' (DataTable.tsx:44,135-137), so pre-formatting is unnecessary. Whether the API really returns rupees (floats from dividing minor totals) cannot be verified: payroll-service absent. Real risk is float rupees violating the paise rule.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Replace the three *Display fields with columns cellType:'rupees' (server-safe) and drop DisplayRow/formatRupees calls.
  2. Update the stale comment.
  3. Backend follow-up: expose *_minor strings on /api/v1/payroll/runs and map to formatMoney; then switch to cellType:'amount'.
- **Acceptance:**
  - Render test: grossAmount 150000 shows ₹1,50,000.00.
  - Unit test that cellType amount is not used with rupee fields.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display: a wrong unit is a 100x error; test against real fixture.

### GAP-PAYROLL-PERIOD-05  ·  LOW  ·  confirmed  ·  theme I18N (was VALIDATION)

- [x] **Status** — PR #1752 (merged), as part of the same run-lifecycle cluster fix.
- **First-pass claim:** Duplicate of runs pages increases maintenance: three routes read the same endpoint with three different status treatments (cellType status here, translated pill on home, plain pill on runs).
- **Verified evidence:** Three views of one endpoint: period/page.tsx:83 uses cellType:'status' (DataTable.tsx:131 raw enum, untranslated); PayrollRunsTable.tsx:33 uses StatusPill with payrollRunStatusLabel (translated); runs/page.tsx:70 uses StatusPill status only (no label). Home stat logic (page.tsx:31-38) differs again.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/period/page.tsx`, `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/app/(app)/hr/payroll/PayrollRunsTable.tsx`
- **Fix steps:**
  1. Use PayrollRunsTable (or a shared renderer with payrollRunStatusLabel) in both /runs and /period, or delete /period (see PERIOD-01).
  2. Move status bucket logic into @/lib/payroll/statusLabels.
- **Acceptance:**
  - Same status text/colour for a 'paid' run on all three routes in en and hi.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-PERIOD-01


---
## /hr/payroll/register  —  `payroll/register.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`
- **Design reference:** `redesign/payroll/register.html`

### GAP-PAYROLL-REGISTER-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Units differ from the other run screens: this route is paise (formatMoney on *_minor, page.tsx:109-110) while /hr/payroll, /runs, /period and /[id] are rupees. Totals summed with Number() over string bigints (page.tsx:65-67) lose precision above 2^53 paise; department rows compare against run pages only if the reader knows the unit switch.
- **Verified evidence:** register/page.tsx:65-67 sums Number(r.total_*_minor) and formatMoney at 109-110 (paise), while period/page.tsx uses formatRupees, so the unit switch is real. Precision claim is technically true (Number sum of string bigints) but 2^53 paise ≈ ₹9e13, so not reachable for a department register; severity overstated. Amounts in table use cellType 'amount' with string values, which formatMoney handles (formatters.ts:90-98). Whether the register API returns minor strings cannot be verified (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`
- **Fix steps:**
  1. Add a sumMinor(rows,key) helper using BigInt(String(v ?? 0)) and pass the bigint to formatMoney (accepts bigint).
  2. Apply to totalGross/totalNet (and any new totals).
  3. Add unit-note comment in Row type: all *_minor are paise.
- **Acceptance:**
  - Unit test: two rows with '9007199254740993' paise sum exactly.
  - Rendered total equals the sum of table amounts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money display; BigInt throws on non-integer strings, so guard with try/catch and show em dash.
- **Depends on:** GAP-PAYROLL-PERIOD-04

### GAP-PAYROLL-REGISTER-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Without filters the API returns all periods and the stats sum them (page.tsx:65-67): "Employees" adds the same staff once per month and Departments counts rows, not departments.
- **Verified evidence:** register/page.tsx:22-27 sends no period/runId when unset, and 65-66 sum employee_count over all returned rows; StatCard line 107 uses items.length, which is rows (department x period, Row has both department_name and period), not distinct departments. Whether the API returns all periods when unfiltered is inferred from the page (backend absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`
- **Fix steps:**
  1. Default period to the latest closed period (or require a filter) when none supplied; or group rows.
  2. Compute Departments as new Set(items.map(r=>r.department_name)).size.
  3. Show Employees only when a single period is selected; otherwise em dash or 'max per period'.
- **Acceptance:**
  - Test: rows [A/2026-06, A/2026-07] -> Departments 1; Employees not double counted.
  - No-filter load shows period-scoped stats.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; headcount figures feed statutory reading.
- **Depends on:** GAP-PAYROLL-REGISTER-03

### GAP-PAYROLL-REGISTER-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Run ID is a free-text UUID box and Period a free-text YYYY-MM (page.tsx:84-96): no run picker, no validation, no link from a run to its register. Filter is a GET form, so it works without JS but shows no active-filter chip.
- **Verified evidence:** register/page.tsx:82-98: period is a plain text input (placeholder 2025-06, no pattern/type=month) and runId a plain text input, no validation; page.tsx:42-43 only trims. The form is method='get' with a Button submit (101). No chip shows active filters. Only inbound link is hr/page.tsx:85; [id]/page.tsx has no link to register.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`
- **Fix steps:**
  1. Change period to <input type='month'> (or pattern \d{4}-\d{2}) and validate in the server page with a regex; ignore invalid with a visible message.
  2. Replace runId text box with a select/combobox fed by getPayrollRunDetails() (loaders) using SmartCombobox.
  3. Render an active-filter chip row with clear-link.
  4. Add 'View register' link on [id]/page.tsx to /hr/payroll/register?runId={id}.
- **Acceptance:**
  - Invalid period '2025-13' shows an error, no query.
  - Choosing a run from picker filters table; chip shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-REGISTER-02

### GAP-PAYROLL-REGISTER-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Statutory columns are PF, ESI, TDS, PT only (page.tsx:15-23); a Govt department deducts GPF/NPS, so those cells read zero and the real deductions sit unsplit in "Deductions".
- **Verified evidence:** Columns are PF/ESI/TDS/PT only (register/page.tsx:58-61) and Row type (12-19) has no GPF/NPS fields; payroll has gpf/ and nps/ routes so those deductions exist in the product. Whether the register API returns GPF/NPS totals or how they are grouped cannot be verified (payroll-service absent), so 'read zero' is unproven.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Confirm register response shape with payroll-service owner.
  2. If fields exist (total_gpf_minor, total_nps_minor) add to Row and columns, showing them by edition/entitlement.
  3. Add an 'Other deductions' column = total_deductions - listed statutory so the split is visible.
- **Acceptance:**
  - Govt-edition fixture: GPF and NPS columns non-zero and sum with others to Deductions.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Statutory register accuracy for Govt edition.

### GAP-PAYROLL-REGISTER-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Department payroll totals reach every hr/layout.tsx role; no canAdminister check. Server enforcement cannot be verified (payroll-service source absent).
- **Verified evidence:** register/page.tsx has no getSessionRoles/PermissionDenied; only hr/layout.tsx:41-53 HR_ROLES (includes employee, manager) guard it. Compare pensioners/page.tsx:38 which gates. Server-side enforcement on /api/v1/payroll/register cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`, `apps/web/src/app/(app)/hr/payroll/_lib/roles.ts (new)`
- **Fix steps:**
  1. Add PAYROLL_REGISTER_VIEW_ROLES (payroll_admin, payroll_officer, hr_admin, super_admin, tenant_admin) in _lib/roles.ts.
  2. At top of page: getSessionRoles(); if none, return <PermissionDenied module='payroll register' requiredRoles=.../>.
  3. Confirm the backend rejects employee/manager (403).
- **Acceptance:**
  - Test: role employee -> PermissionDenied and no fetch.
  - payroll_officer -> table renders.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Reduces exposure of department payroll totals; check nobody legitimately relies on manager access.
- **Depends on:** GAP-PAYROLL-PENSIONERS-05

### GAP-PAYROLL-REGISTER-06  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** department_name can be null (type at page.tsx:9) and prints blank; error shows both DataSourceBadge and RefreshErrorState (page.tsx:76,116); loading.tsx is a bare skeleton with no header; no CSV/print export for a statutory register.
- **Verified evidence:** department_name is string|null (register/page.tsx:10); DataTable.cellValue falls to String(row[key] ?? '') (DataTable.tsx:138) so null is blank. On error both DataSourceBadge (76) and RefreshErrorState (116) render. loading.tsx is a bare skeleton with aria-label, no PageHeader. DataTable is not passed exportable (line 119-130), though the prop exists (DataTable.tsx:86).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/register/page.tsx`, `apps/web/src/app/(app)/hr/payroll/register/loading.tsx`
- **Fix steps:**
  1. Map department_name ?? t('unassigned') before rows.
  2. Show DataSourceBadge only when !errored (or drop it, RefreshErrorState is enough).
  3. Add exportable to DataTable (audit/gate export by role once REGISTER-05 done); add PrintButton if needed.
  4. Add PageHeader skeleton to loading.tsx.
- **Acceptance:**
  - Row with null department shows 'Unassigned'.
  - Error state shows one message.
  - Export button downloads CSV.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Exporting register is PII/financial: gate by role.
- **Depends on:** GAP-PAYROLL-REGISTER-05


---
## /hr/payroll/reimbursements  —  `payroll/reimbursements.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`
- **Design reference:** `redesign/payroll/reimbursements.html`

### GAP-PAYROLL-REIMBURSEMENTS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Claim form has a free-text “Employee ID” (CreateReimbursementForm.tsx:121) and the table prints the raw employee_id (page.tsx:36): a self-service user can file a claim against any UUID, and a reviewer cannot tell whose claim they are reading.
- **Verified evidence:** CreateReimbursementForm.tsx:119-132 is a free-text input for employeeId, validated only non-empty (57), and sent as employeeId (91). Table column employee_id (reimbursements/page.tsx:36) prints the raw value. No role check on the page (layout admits employee). Backend ownership check cannot be verified. Loaders offer getMyProfile (loaders.ts:1151) and getEmployees (1122); SmartCombobox exists in _components; no EntityPicker.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/reimbursements/CreateReimbursementForm.tsx`, `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx compute canAdminister via getSessionRoles(); for non-admins call getMyProfile() and pass employeeId/name to the form as a hidden/read-only value.
  2. For admins replace input with SmartCombobox over getEmployees() (name + employeeNo, value = id).
  3. Resolve names for the table: build a map from getEmployees and add employee_name column (keep id out of view).
  4. Backend must reject employeeId != caller for non-admin.
- **Acceptance:**
  - Employee role: form shows own name, cannot change.
  - Table shows names not UUIDs.
  - POST with other id as employee returns 403 (backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money and approvals: claim on behalf of another person; must be enforced server-side.
- **Depends on:** GAP-PAYROLL-REIMBURSEMENTS-05

### GAP-PAYROLL-REIMBURSEMENTS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** No approve / reject / pay control exists although the stats count submitted and approved (page.tsx:45–46); claims cannot progress from this screen, and “Total Claimed” sums rejected claims too (page.tsx:44).
- **Verified evidence:** reimbursements/page.tsx:44 totalMinor sums all rows incl. rejected; 45-46 count submitted/approved, but columns (35-42) and the page have no action controls; only CreateReimbursementForm. Approve/reject/pay endpoints cannot be verified (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`, `apps/web/src/app/(app)/hr/payroll/reimbursements/ReimbursementActions.tsx (new)`
- **Fix steps:**
  1. Confirm endpoints for approve/reject/pay with backend.
  2. Filter Total Claimed to status not in (rejected, cancelled) and relabel.
  3. Add client ReimbursementActions (Approve/Reject with ConfirmDialog and reason) gated to payroll admin roles; call browserJson then router.refresh().
  4. Show actions via a client cell since render cannot cross server boundary.
- **Acceptance:**
  - Total excludes rejected claim in fixture.
  - Approve moves status to approved and stat counts update.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval/payment path: audit event, role check, maker-checker not to approve own claim.
- **Depends on:** GAP-PAYROLL-REIMBURSEMENTS-05

### GAP-PAYROLL-REIMBURSEMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Only a “Bill Reference” text field — no bill/receipt attachment — for medical, LTA and travel claims that need supporting documents; bill_date is captured but not displayed (page.tsx:35–42).
- **Verified evidence:** CreateReimbursementForm.tsx:191-200 has only a billRef text (maxLength 128) and billDate; no attachment (ds FileUpload exists but unused, grep for attach/FileUpload empty). Row type has bill_date (page.tsx:14) but no column (35-42).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/reimbursements/CreateReimbursementForm.tsx`, `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`
- **Fix steps:**
  1. Add bill_date column (formatIndianDate) to columns.
  2. Add ds FileUpload for receipts after backend upload endpoint is defined; send attachment ids in POST.
  3. Require attachment for medical/LTA/travel categories.
- **Acceptance:**
  - Bill date visible in table.
  - Submitting medical claim without receipt is blocked.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Documents may hold health data (DPDP): storage and access rules needed.

### GAP-PAYROLL-REIMBURSEMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme I18N (was VALIDATION)

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** Category prints the raw code (“lta”, “medical”) in the table (page.tsx:37) although the form has translated labels; period is free text checked by regex only (CreateReimbursementForm.tsx:72).
- **Verified evidence:** reimbursements/page.tsx:37 prints category raw ("lta"); the form has translated labels via categoryX keys (CreateReimbursementForm.tsx:20-23; en.json:5344-5346). Period check is only /^\d{4}-\d{2}$/ (form:72), so 2026-13 passes; amount uses parseFloat and Math.round(x*100) (87).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`, `apps/web/src/app/(app)/hr/payroll/reimbursements/CreateReimbursementForm.tsx`, `apps/web/src/lib/payroll/reimbursementCategories.ts (new)`
- **Fix steps:**
  1. Extract category label lookup to a shared helper and pre-format categoryLabel in page rows.
  2. Use <input type='month'> and a zod schema (month 01-12) for period; parse amount with a decimal-string to paise helper instead of parseFloat*100.
  3. Disable submit while confirm dialog busy (already) and validate via zod in one place.
- **Acceptance:**
  - Table shows 'LTA' / 'Medical' in en and hi.
  - 2026-13 rejected; 10.10 rupees -> 1010 paise.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money entry: avoid float rounding.

### GAP-PAYROLL-REIMBURSEMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1764 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits employee/manager and the whole-tenant claim list (medical claims are DPDP-sensitive health data) is fetched; row scoping cannot be verified — payroll-service absent.
- **Verified evidence:** reimbursements/page.tsx has no role check; fetchJson('/api/v1/payroll/reimbursements') (21) loads the tenant list and hr/layout.tsx:41-53 admits employee/manager. Whether the service scopes rows by caller cannot be verified. Claims include medical category (health data).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/reimbursements/page.tsx`, `apps/web/src/app/(app)/hr/payroll/_lib/roles.ts (new)`
- **Fix steps:**
  1. Compute canAdminister; for non-admins request only own claims (employeeId filter from getMyProfile) if API supports, else backend scope.
  2. Mask/hide medical bill_ref for non-admins.
  3. Add exportable only for admin roles.
- **Acceptance:**
  - Employee sees only own claims.
  - Admin sees all.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP sensitive health data exposure across employees.
- **Depends on:** GAP-PAYROLL-REIMBURSEMENTS-01


---
## /hr/payroll/returns  —  `payroll/returns.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`
- **Design reference:** `redesign/payroll/returns.html`

### GAP-PAYROLL-RETURNS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** 'Filed' is inferred, not recorded: the selected quarter is 'filed' when reconciliation.matched (returns/page.tsx:195) and filingDate / challanRef are hard-coded null (page.tsx:196-197,205-206), so 'Quarters Filed n / 4' (TaxReturnsSummary.tsx:74-77) and the green pill assert a filing that may never have happened; the 'Filed: {date}' and 'Challan:' branches (TaxReturnsSummary.tsx:121-133) are unreachable.
- **Verified evidence:** returns/page.tsx:194-197 sets status 'filed' when reconciliation.matched and hard-codes filingDate:null, challanRef:null (also 205-206). TaxReturnsSummary.tsx:74 counts filed/late_filed, 76 renders '{n} / 4', 121-130 render filed/challan text only if non-null so those branches are unreachable. Reconciled with TRACES (matched) is not the same as filed. Form24Q type (page.tsx:37-45) has no filing fields, so a filing record must come from backend (not visible).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/app/(app)/hr/payroll/returns/TaxReturnsSummary.tsx`, `packages/types (Form24Q filing fields)`
- **Fix steps:**
  1. Do not derive 'filed' from matched: map matched -> status 'reconciled' (new StatusPill label) until backend returns filedAt/challanRef.
  2. Extend Form24Q with optional filedAt, challanRef and populate filingDate/challanRef from them.
  3. In TaxReturnsSummary count only status filed/late_filed with a filingDate.
  4. Add next-intl label for 'reconciled'.
- **Acceptance:**
  - Fixture matched:true without filedAt -> pill 'Reconciled', Quarters Filed 0 / 4.
  - With filedAt and challanRef -> Filed on / Challan text visible.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Compliance: falsely showing TDS as filed could hide missed filing penalties.
- **Depends on:** GAP-PAYROLL-RETURNS-02

### GAP-PAYROLL-RETURNS-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was DEADROUTE)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Annual overview is a one-quarter view labelled as the year: the three non-selected quarters are stubbed pending with 0 deposited and 0 deductees (page.tsx:203-209), and 'Total TDS Deposited' sums those zeros (TaxReturnsSummary.tsx:70-73), so the FY total equals the selected quarter; a quarter that was filed earlier reads 'pending'.
- **Verified evidence:** returns/page.tsx:191-210 stubs the three other quarters {status:'pending', totalTdsDepositedMinor:0, deducteeCount:0}. TaxReturnsSummary.tsx:70-73 sums all four; zeros are numbers so minorToRupeesOrNull returns 0, not null, bypassing the UX-022 unknown-quarter guard, so the FY total equals the selected quarter. Quarter rows with deducteeCount 0 hide their amounts (139-144). Not a dead link, so theme DEADROUTE is wrong (View detail links work, 146-152).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/app/(app)/hr/payroll/returns/TaxReturnsSummary.tsx`
- **Fix steps:**
  1. For non-selected quarters set totalTdsDepositedMinor:null and a status 'unknown' (change QuarterSummaryRow to allow null) so the guard yields em dash for the annual total.
  2. Better: fetch the four quarters (Promise.all of getForm24Q for Q1-Q4) and fill each row, or add a backend annual summary endpoint.
  3. Render 'not loaded' pill (StatusPill label) for unknown quarters.
- **Acceptance:**
  - Selecting Q2 shows annual total '—' (or real sum if all four loaded), not Q2's value.
  - Other quarters do not read 'pending' unless known.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Four parallel form24q calls add load; use the cached read path.
- **Depends on:** GAP-PAYROLL-RETURNS-01

### GAP-PAYROLL-RETURNS-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Failed load reads as fact: when a fetch errors the overview still shows '0 / 4', ₹0.00 and four 'pending' rows (page.tsx:220-226,203-209); the badge is a single small chip, and on 24Q/26Q errors the badge is repeated inside each card (page.tsx:240,297) but the overview above is never blanked.
- **Verified evidence:** returns/page.tsx:166-167 overallSource=error, but quarterSummaries (191-210) fall through to pending/0/0 for every quarter when f24Lookup.state==='error', so TaxReturnsSummary shows '0 / 4' and ₹0.00 (TaxReturnsSummary.tsx:70-76). Only a DataSourceBadge (220) signals it; 24Q/26Q cards repeat a badge (240,297). RefreshErrorState is not imported.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/app/(app)/hr/payroll/returns/TaxReturnsSummary.tsx`
- **Fix steps:**
  1. When overallSource==='error' render a RefreshErrorState (toHumanError('load',{area:'TDS returns'})) in the overview card instead of TaxReturnsSummary.
  2. Alternatively pass totalTdsDepositedMinor:null and status 'unknown' (as in RETURNS-02) so the tiles show em dashes.
  3. Drop duplicate badges in the cards.
- **Acceptance:**
  - Mock 24Q http 500 -> overview shows error state, no '0 / 4' or ₹0.00.
  - 409 reconciliation_blocked still shows the blocked flow.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentation.
- **Depends on:** GAP-PAYROLL-RETURNS-02

### GAP-PAYROLL-RETURNS-05  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** PAN printed in full in both tables (page.tsx:172,184) to every role that reaches the page (DPDP); panFlag (missing/invalid PAN) is fetched (page.tsx:29-30,93) but never shown, so deductees needing higher-rate TDS are invisible.
- **Verified evidence:** cols24 (returns/page.tsx:172) and cols26 (184) print pan raw; there is no role gate in this page (only hr/layout.tsx which admits employee/manager). panFlag is in Deductee24Q (30), mapped at 93, and Deductee26Q (49) but no column uses it. No <Masked> component exists.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/app/_components/Masked.tsx (new)`, `apps/web/src/app/(app)/hr/payroll/_lib/roles.ts (new)`
- **Fix steps:**
  1. Add role gate (payroll_admin, payroll_officer, hr_admin, super_admin) with PermissionDenied at top of ReturnsPage.
  2. Pre-format panMasked (e.g. ABCDE****F) in rows24/rows26 mapping; keep full PAN only in downloadable RPU file.
  3. Add a PAN status column from panFlag with StatusPill (text label, not colour only) and a stat for 'PAN missing/invalid'.
  4. Log reveal/export via audit if a reveal control is added.
- **Acceptance:**
  - Test: employee role -> PermissionDenied.
  - Table shows masked PAN and a flag for invalid PAN rows.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Higher-rate TDS (206AA) visibility matters for compliance; do not drop panFlag.
- **Depends on:** GAP-PAYROLL-PENSIONERS-04

### GAP-PAYROLL-RETURNS-07  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was OTHER)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Invalid FY input silently falls back to the current FY (page.tsx:156, FY_RE line 84) with no message, so '2025/26' shows 2026-27 data under a lookup form still holding the typed value; the quarter query also defaults silently.
- **Verified evidence:** returns/page.tsx:156 falls back to the current FY when FY_RE (84, /^\d{4}-\d{2}$/) fails and 157-159 falls back to the current quarter, silently. Correction: QuarterLookupForm receives defaultFy={fy} (229), the resolved fallback, not the typed value, so the form does not keep '2025/26'; the user just sees a different FY with no message. Also '2025-99' passes the regex.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/app/(app)/hr/payroll/returns/QuarterLookupForm.tsx`
- **Fix steps:**
  1. Validate suffix equals (year+1)%100 in a parseFy helper.
  2. If searchParams.fy/quarter is present but invalid, render an inline role='alert' message (new i18n key) naming the fallback used.
  3. QuarterLookupForm already has pattern=\d{4}-\d{2}; also add a title/error text.
- **Acceptance:**
  - ?fy=2025/26 shows message and current FY.
  - ?fy=2025-99 rejected.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-RETURNS-08  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1762 (merged)
- **First-pass claim:** Back link text 'Back to Payroll' is a literal in the page (page.tsx:217) instead of a next-intl key, unlike the error.tsx keys; the RPU download is a plain GET link even when the quarter carries a reconciliation warning (page.tsx:281-286).
- **Verified evidence:** returns/page.tsx:217 back='/hr/payroll' backLabel="Back to Payroll" literal (same literal pattern in ~27 payroll pages). The RPU download <a> (281-286) is rendered whenever state==='ok', even if reconciliation.warning / matched:false is shown (261-265). Only the 409 blocked state hides it. Whether the server refuses format=file on unreconciled data cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add common key backToPayroll (next-intl) and use t() in returns and sibling pages.
  2. When !reconciliation.matched render download as a button with ConfirmDialog ('Return has a reconciliation warning...') or route through the ForceFileButton flow.
  3. Add dated file name / audit at backend.
- **Acceptance:**
  - Back label translates in hi.
  - Unmatched quarter: download requires confirmation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Filing an unreconciled RPU could lead to TRACES defaults.


---
## /hr/payroll/runs  —  `payroll/runs.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`
- **Design reference:** `redesign/payroll/runs.html`

### GAP-PAYROLL-RUNS-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — verified NOT a bug via PR #1752 (payroll-service divides the minor-unit aggregate), and the mixed-unit risk is now closed at the contract: the runs payload carries exact integer-paise strings (grossMinor/netMinor/deductionsMinor, and per-slip grossMinor/deductionsMinor/netMinor on GET /runs/:id) next to the rupee floats; one web adapter (apps/web/src/lib/payroll/runMoney.ts) prefers the paise strings and converts a legacy rupee float by decimal string only as a fallback; /hr/payroll, /hr/payroll/runs, /hr/payroll/[id] (stat cards, MoM, actions, slips table) and /hr/payroll/period all render run money through it with formatMoney. Tests: adapter unit (90000 legacy == 9000000 paise -> ₹90,000.00; 1,23,456.78 renders identically on the three pages), schema contract (non-integer *Minor rejected), service payload contract + real-DB. formatRupees / DataTable cellType rupees are no longer used for run money and remain only for natively-rupee endpoints (income-tax whole-rupee computation, tax-config slab bounds, typed-rupee form previews). (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** Money is rupee floats via formatRupees (page.tsx:67-68) while sibling routes format paise with formatMoney: a mixed-unit module (CLAUDE.md §3.11). payroll-service is absent from the repo, so the unit cannot be verified.
- **Verified evidence:** runs/page.tsx:67-68 use formatRupees(run.grossAmount/netAmount); that is deliberate and consistent inside the payroll-runs family (PayrollRunsTable.tsx:21-27, [id]/page.tsx:108-110, payroll/page.tsx sums grossAmount as plain JS numbers). formatters.ts:58-68 documents that the runs API returns rupees, while slips/salary-revisions/off-cycle use paise (formatMoney). So the module is mixed-unit across endpoints, but not within the runs pages. Unit and float-ness of the runs API cannot be verified: payroll-service and packages/types (PayrollRunDetail) are absent from the snapshot; violates CLAUDE.md 3.11 if the API really returns rupee floats.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/app/(app)/hr/payroll/PayrollRunsTable.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/[id]/PayrollRunActions.tsx`, `apps/web/src/app/(app)/hr/payroll/page.tsx`, `apps/web/src/app/_data/loaders.ts (PayrollRunDetailListSchema)`, `payroll-service runs response (absent)`
- **Fix steps:**
  1. Confirm with payroll-service owners whether GET /api/v1/payroll/runs grossAmount/netAmount are rupees; if so agree a contract change to grossMinor/netMinor (integer paise, bigint-safe string if >2^53).
  2. Add optional grossMinor/netMinor to PayrollRunDetailListSchema in loaders.ts and a small adapter that prefers *Minor and falls back to amount*100 via integer maths (Math.round on a rupee value only inside the adapter, commented as legacy).
  3. Switch runs/page.tsx:67-68, PayrollRunsTable.tsx:26-27, [id]/page.tsx:108-110, PayrollRunActions.tsx:68,75,146,163 and the reduce() sums in payroll/page.tsx from formatRupees to formatMoney.
  4. Once no caller remains, delete or deprecate formatRupees and the cellType:'rupees' path in DataTable.tsx:135,269.
  5. Add a contract test that fails if the runs payload has non-integer money.
- **Acceptance:**
  - Unit test: adapter maps {grossMinor:'9000000'} to formatMoney -> ₹90,000.00 and legacy {grossAmount:90000} to the same string.
  - Manual: a run with net 1,23,456.78 renders identically on /hr/payroll, /hr/payroll/runs and /hr/payroll/[id].
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display: a wrong-unit switch would show 100x too large/small on payroll totals; ship behind the backend contract change and verify against a known run.

### GAP-PAYROLL-RUNS-02  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1752 (merged), as part of the same run-lifecycle cluster fix.
- **First-pass claim:** Unbounded table: no pagination, sort or filter (page.tsx:50-79), although the same data on /hr/payroll has all three; a multi-year list grows without limit.
- **Verified evidence:** runs/page.tsx:47-78 renders a bare <table> over every row of getPayrollRunDetails() (loaders.ts:2297-2316, called with no limit/month). No pager, sort or filter. The same data on /hr/payroll goes through PayrollRunsTable.tsx:60-72 -> DataTable with sortable, filterable, pageSize={12}. Whether the backend caps the default batch is unknown (payroll-service absent), so the page is either silently truncated or unbounded.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/app/(app)/hr/payroll/runs/loading.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Replace the inline <table> (runs/page.tsx:48-77) with <PayrollRunsTable runs={runs} source={result.source} canAdminister={...}/> so sort/filter/pageSize=12 and the provenance badge come for free.
  2. Drop the now-unused formatRupees/StatusPill/Link imports; keep the errored and empty branches.
  3. Ask payroll-service whether /api/v1/payroll/runs supports limit/offset/year and total; if yes extend getPayrollRunDetails opts (limit, offset, fy) and add a pager, otherwise document the cap and show 'showing latest N'.
  4. Decide whether /hr/payroll/runs should just redirect to /hr/payroll (same loader, same table) to avoid two pages.
- **Acceptance:**
  - Component/RTL test: with 30 runs the page renders 12 rows plus a pager and a filter input.
  - Manual: typing a pay period in the filter narrows the rows; column header click sorts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; table swap only. Note PayrollRunsTable is a client component using useSeededResource (offline cache) so behaviour differs slightly from the server-only page.
- **Depends on:** GAP-PAYROLL-RUNS-05

### GAP-PAYROLL-RUNS-03  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1752 (merged): empty-state CTA now respects the same role gate as the create form.
- **First-pass claim:** Empty-state CTA "Create first run →" is shown to every role (page.tsx:40-45) but the create form on /hr/payroll is admin-only, so managers and employees are sent to a page with no way to create.
- **Verified evidence:** runs/page.tsx:40-46 shows the empty-state Link 'createFirstRun' -> /hr/payroll to every role; the page reads no roles. The create form is rendered only when canAdminister (payroll/page.tsx:9-10,52-66; PAYROLL_ADMIN_ROLES = payroll_admin, payroll_officer, super_admin) and also only if structures exist. hr/layout.tsx:33-43 admits manager and employee, so they reach this CTA. Even admins land on 'no structures' when none exist.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts (export shared PAYROLL_ADMIN_ROLES)`, `apps/web/src/app/(app)/hr/payroll/page.tsx`
- **Fix steps:**
  1. Move PAYROLL_ADMIN_ROLES from payroll/page.tsx:9 into a shared constant (e.g. lib/auth/roles.ts) and import it in both pages.
  2. In runs/page.tsx call getSessionRoles() and compute canAdminister the same way.
  3. In the empty branch render the CTA link only when canAdminister; otherwise show the plain emptyMessage with no link.
  4. Keep server enforcement in payroll-service POST run route (cannot verify, absent).
- **Acceptance:**
  - Component test: roles ['employee'] + runs=[] -> no 'Create first run' link; roles ['payroll_admin'] -> link present.
  - Manual: log in as manager, open /hr/payroll/runs with no runs, no dead-end CTA.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; UI-only, backend remains the authority.
- **Depends on:** GAP-PAYROLL-RUNS-04

### GAP-PAYROLL-RUNS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1752 (merged): page-level role gate added, matching HOME-02/RUNS-03.
- **First-pass claim:** Any hr role reaches run-level gross and net totals; no canAdminister check here. Server enforcement cannot be verified.
- **Verified evidence:** runs/page.tsx has no getSessionRoles/requireAnyRole/PermissionDenied; hr/layout.tsx:33-43 lets hr_admin...employee and manager in, and page.tsx:61-72 prints run-level payPeriod, employeeCount, gross and net for all. /hr/payroll/page.tsx also shows the runs table to everyone (only the create form is gated), and salary-slips pages do use PermissionDenied, so the sibling pattern exists. layout.tsx:26-31 comment asserts the backend rejects non-payroll roles; that cannot be verified (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/app/(app)/hr/payroll/page.tsx`, `apps/web/src/app/_components/PermissionDenied.tsx`
- **Fix steps:**
  1. Add a shared PAYROLL_VIEW_ROLES constant (decide with product whether hr_admin/hr_officer are included; salary-slips uses hr_admin, payroll/page.tsx does not).
  2. In runs/page.tsx compute canView from getSessionRoles() and return <PermissionDenied module='payroll runs' requiredRoles=.../> before fetching.
  3. Also handle result.status===403 from getPayrollRunDetails with PermissionDenied (as slips/[id]/page.tsx:29 does).
  4. Apply the same gate to /hr/payroll/page.tsx table, or confirm with product that org-wide totals are meant to be visible.
- **Acceptance:**
  - Component test: roles ['employee'] renders PermissionDenied and never calls getPayrollRunDetails.
  - API-level (backend): GET /api/v1/payroll/runs as employee returns 403.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Risk of locking out HR roles that legitimately need totals; agree the role list first. Backend enforcement is the real control.
- **Depends on:** GAP-PAYROLL-RUNS-03

### GAP-PAYROLL-RUNS-05  ·  LOW  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1752 (merged), as part of the same run-lifecycle cluster fix.
- **First-pass claim:** StatusPill without translated label (page.tsx:70) while PayrollRunsTable uses payrollRunStatusLabel; approved/disbursed fall to neutral styling. loaders.ts:2311 caches 120s, and loading.tsx skeleton shows stat blocks and a filter bar the page never renders.
- **Verified evidence:** runs/page.tsx:70 renders <StatusPill status={run.status}/> with no label, while PayrollRunsTable.tsx:35 passes payrollRunStatusLabel (statusLabels.ts:30-35). StatusPill.tsx STATUS_MAP has draft/completed/paid/failed but no 'processing' or 'disbursed', so those get the neutral 'info' variant ('approved' is mapped good and is not a run status, contrary to the observation). loaders.ts:2311 revalidateSeconds:120 confirmed. runs/loading.tsx:15-29 draws 4 stat blocks and a filter-bar block that the page never renders (it renders only a card table).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/runs/page.tsx`, `apps/web/src/app/(app)/hr/payroll/runs/loading.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/lib/payroll/statusLabels.ts`
- **Fix steps:**
  1. Preferably resolved by RUNS-02 (reuse PayrollRunsTable which translates the label).
  2. Add 'processing' -> warn and 'disbursed' -> good (also 'finalized' -> good, 'computed' -> warn for slips) to STATUS_MAP; check the ~80 call sites for visual regressions.
  3. Rewrite runs/loading.tsx to match the real layout: header plus one card with a table skeleton (use Skeleton.tsx from ds), remove the stat grid and filter placeholders.
  4. Decide whether 120s stale cache is acceptable right after creating a run (revalidatePath on create form success).
- **Acceptance:**
  - Unit test: StatusPill status='disbursed' -> class 'pill good'; 'processing' -> 'pill warn'.
  - Manual: throttle network, skeleton silhouette matches the loaded page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared by ~80 sites; new mappings change pill colours elsewhere.
- **Depends on:** GAP-PAYROLL-RUNS-02


---
## /hr/payroll/salary-revisions  —  `payroll/salary-revisions.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`
- **Design reference:** `redesign/payroll/salary-revisions.html`

### GAP-PAYROLL-SALARY-REVISIONS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1756 (merged)
- **First-pass claim:** Vocabulary mismatch between form and list: the form can only write annual_increment | promotion | correction | fitment (CreateSalaryRevisionForm.tsx:32) while the list labels annual_increment | promotion | special | pay_commission | market_correction (page.tsx:39–45). “Correction” and “Fitment” print as raw codes, and the “Pay Commission” stat (page.tsx:83) can never count a row created from this screen — 7th CPC fixation would be entered as “fitment”.
- **Verified evidence:** CreateSalaryRevisionForm.tsx:32 REVISION_TYPE_VALUES = annual_increment|promotion|correction|fitment, but page.tsx:39-45 REVISION_TYPE_KEYS only knows annual_increment|promotion|special|pay_commission|market_correction, so correction/fitment fall to the raw code (page.tsx:56 `key ? t(key) : r.revision_type`). Stat 'Pay Commission' (page.tsx:83) filters revision_type==='pay_commission', which the form can never write. Which values the API accepts is unverifiable (payroll-service absent; no zod enum visible).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-revisions/CreateSalaryRevisionForm.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `packages/types (shared enum, absent)`
- **Fix steps:**
  1. Get the canonical revision_type enum from payroll-service (zod schema of POST /v1/payroll/salary-revisions) and define it once as REVISION_TYPES in a shared module (e.g. lib/payroll/revisionTypes.ts).
  2. Drive both the form <select> and page.tsx REVISION_TYPE_KEYS from that constant; add en/hi labels for every member (correction, fitment, etc.).
  3. Add a pay_commission option to the form if fixation is meant to be entered here (see -02) or remove the stat.
  4. Make page.tsx fall back to a humanised label (humanizeStatus) not the raw code.
- **Acceptance:**
  - Unit test: every value in REVISION_TYPES has a message key in en.json and hi.json (extend the i18n coverage test).
  - Manual: create a 'fitment' revision, list shows 'Fitment', not 'fitment'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong revision type on a pay record affects reports/stat counts; do not rename existing stored codes.
- **Depends on:** GAP-PAYROLL-SALARY-REVISIONS-02

### GAP-PAYROLL-SALARY-REVISIONS-02  ·  HIGH  ·  confirmed  ·  theme APPROVAL (was MONEY)

- [~] **Status** — PARTIAL, owner decision open. Done: parseRupeesToMinor (bigint, no float), orderNo mandatory (UI + API), the maker's reason is now required in the ConfirmDialog (min 10 chars) and written to the audit event with the sanctioning order, stale 'recorded upstream in HRMS pay-fixation' empty-state copy replaced, maker-checker approval (pending until a different payroll user approves; salary_revision.created only on approval), page/form role-gated. OPEN (owner questions, not invented): (1) is manual salary entry on this screen allowed at all, or should it be read-only with HRMS pay-fixation authoritative? (2) should the server reject (or require an audited override for) a typed old basic that differs from the employee's current HRMS basic (precedent: bonus compute GAP-PAYROLL-BONUS-02), and fail closed when HRMS is unreachable? (3) which pay-matrix rule (level/cell table or maximum increment) must a new basic satisfy? No pay-matrix table or threshold exists in the repo. Not done: hrms-service consumer test for newBasicMinor <= 0 (services/hrms-service is outside this cluster's boundary; the guard exists at integration/consumer.ts:72). Previous status: PR #1798 (merged)
- **First-pass claim:** en.json salaryRevisions.readOnlyNotice says revisions are “recorded upstream in HRMS pay-fixation … this screen is read-only”, but page.tsx never renders it and instead mounts CreateSalaryRevisionForm (page.tsx:86). A manual, free-text-employee salary change (ID + typed rupees, no Pay Matrix level/cell) bypasses the pay-fixation flow the copy says is authoritative.
- **Verified evidence:** en.json:4098 (and hi.json:4847) salaryRevisions.readOnlyNotice says the screen is read-only and revisions come from HRMS pay-fixation, but no source file references that key, and page.tsx:86 mounts <CreateSalaryRevisionForm/>. The form takes a free-text employee id, typed rupees and no pay-matrix level/cell (CreateSalaryRevisionForm.tsx:170-272) and POSTs v1/payroll/salary-revisions. The publish is real: hrms-service integration/consumer.ts:59-95 consumes payroll.salary_revision.created and overwrites hrmsEmployees.basicMinor with newBasicMinor (audit event emitted, but no bounds check). Amount conversion is `Math.round(parseFloat(v)*100)` (form:123), the float pattern CLAUDE.md warns about. Only a ConfirmDialog guards it; no maker-checker or reason.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-revisions/CreateSalaryRevisionForm.tsx`, `apps/web/src/messages/en.json`, `services/hrms-service/src/modules/integration/consumer.ts`
- **Fix steps:**
  1. Decision first: is manual entry allowed? If not, delete <CreateSalaryRevisionForm/> from page.tsx:86, render the existing readOnlyNotice and remove the component.
  2. If allowed, gate the page and form to payroll_admin/payroll_officer via PermissionDenied and drop the notice key (copy would contradict the screen).
  3. Replace parseFloat*100 with a decimal-string to bigint-paise parser (new lib/money parseRupeesToMinor) and send minor as string.
  4. Require an order number and reason (make orderNo mandatory, ConfirmDialog with reason) and validate new basic against the employee's current basicMinor server-side.
  5. Backend: reject revisions outside pay-matrix rules or route through approval (maker-checker) before emitting salary_revision.created.
- **Acceptance:**
  - Unit test: parseRupeesToMinor('1234.5') === 123450n and rejects '1e3', '-1', 'abc'.
  - Manual: non-payroll role cannot see the form; with form removed the read-only notice renders.
  - Backend: consumer rejects newBasicMinor <= 0.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** High: form writes flow straight into HRMS basic pay (gratuity/exit maths read it). Removing or gating changes an existing workflow.
- **Depends on:** GAP-PAYROLL-SALARY-REVISIONS-01, GAP-PAYROLL-SALARY-REVISIONS-05

### GAP-PAYROLL-SALARY-REVISIONS-03  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Employee is a raw UUID in the table (page.tsx:62) and a free-text field in the form; nothing checks new ≥ old, or that gross ≥ basic (only newBasic/newGross > 0 are validated, CreateSalaryRevisionForm.tsx:100–112).
- **Verified evidence:** Table column employee_id prints the raw UUID (page.tsx:62). Form Employee ID is a bare text input (CreateSalaryRevisionForm.tsx:173-182), validated only non-empty. handleSubmit (lines 85-114) checks only date format and newBasic/newGross > 0: no new >= old, no gross >= basic, and blank old fields are sent as 0 (toMinor, line 123). No EntityPicker or Masked component exists anywhere in the repo, so the suggested fix needs a new component. Employee name lookup would need an existing employees loader (getEmployees, loaders.ts:1122); the revisions API returns no name (Row type page.tsx:14-24).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-revisions/CreateSalaryRevisionForm.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Create ds/EntityPicker (searchable employee combobox over the employees list, returns id + shows name/employee no).
  2. Use it in the form in place of the Employee ID input; prefill old basic/gross from the chosen employee if the API exposes them.
  3. In page.tsx join names client-side/server-side by fetching employees once and mapping employee_id to name; fall back to a short id and link to /hr/employees/{id}.
  4. Add validation in handleSubmit: newBasic >= oldBasic unless type is correction; newGross >= newBasic; oldBasic/oldGross required together; repeat in zod on the backend.
  5. Move validation to a zod schema shared with the submit payload.
- **Acceptance:**
  - Unit test: newGross < newBasic sets invalidField and blocks the dialog.
  - Manual: the history table shows employee names, not UUIDs.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Name join depends on employees list pagination (limit 50 default); large tenants need a by-id lookup.
- **Depends on:** GAP-PAYROLL-SALARY-REVISIONS-02

### GAP-PAYROLL-SALARY-REVISIONS-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** Old Gross is captured and sent but not shown in the history (page.tsx:61–69), so an increment’s gross delta cannot be audited from the list; new rows appear only after the async consumer persists them (page.tsx:8–13 comment).
- **Verified evidence:** Form sends oldGrossMinor (CreateSalaryRevisionForm.tsx:133) and Row includes old_gross_minor (page.tsx:18-20), but columns (page.tsx:61-69) omit it, so only new gross is shown. The write is async: header comment (page.tsx:8-13) and form comment (form:140-142) say the consumer persists it, yet the success message says 'recorded' and router.refresh() (form:156) will usually not show the row yet. Payroll-service consumer not in snapshot.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-revisions/CreateSalaryRevisionForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add columns old_gross_minor (cellType amount) and a computed 'Gross change' (new-old, formatMoney, sign-aware) in page.tsx columns.
  2. Change the success text to 'Submitted - it will appear in history once processed' and poll/refresh once after a few seconds or show a pending row.
  3. Optionally return the accepted id from the POST and link to it.
- **Acceptance:**
  - Manual: create a revision, message says queued; after processing, history shows old gross, new gross and delta.
  - Snapshot test of columns includes old_gross_minor.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-SALARY-REVISIONS-05  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE (was PII)

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** No page-level role gate: hr/layout.tsx:26–42 admits employee/manager, exposing every employee’s basic and gross history (DPDP financial data) and the record form. Backend guard not verifiable — payroll-service absent.
- **Verified evidence:** page.tsx has no getSessionRoles/PermissionDenied. hr/layout.tsx:33-43 HR_ROLES includes manager and employee, so any of them reaches /hr/payroll/salary-revisions and sees every employee's basic and gross history plus the record form. layout.tsx:26-31 admits per-page checks are each page's job. Backend guard cannot be verified (payroll-service absent). The suggested <Masked> fix is not the right control here; access gating is. No <Masked> exists in the repo.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-revisions/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/_components/PermissionDenied.tsx`
- **Fix steps:**
  1. Add PAYROLL_ADMIN_ROLES gate at the top of SalaryRevisionsPage returning <PermissionDenied/>, and pass 403 status through fetchJson to PermissionDenied.
  2. Render the create form only for payroll_admin/payroll_officer/super_admin.
  3. Optionally allow employees to see only their own revisions if the API filters by ownership (verify backend).
  4. Backend: enforce role on GET /v1/payroll/salary-revisions and audit reads of pay history.
- **Acceptance:**
  - Component test: employee role renders PermissionDenied; payroll_admin renders table and form.
  - API: GET as employee returns 403 or own rows only.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** DPDP: leaving it open exposes salary history to all staff; verify server side before relying on the UI gate.
- **Depends on:** GAP-PAYROLL-SALARY-REVISIONS-02


---
## /hr/payroll/salary-slips  —  `payroll/salary-slips.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`
- **Design reference:** `redesign/payroll/salary-slips.html`

### GAP-PAYROLL-SALARY-SLIPS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Failed fetch reads as good news: only DataSourceBadge is shown on source "error" (page.tsx:35); StatCards print real zeros (₹0.00) and the table shows the "No salary slips yet — go to payroll runs" empty state (page.tsx:22-41, SalarySlipsTable.tsx:58-64). Sibling income-tax nulls the stats and renders RefreshErrorState.
- **Verified evidence:** page.tsx:20 destructures only {data, source}; on error data=[] (apiClient.ts fetchJson) so StatCards at :37-40 show 0 and formatMoney(0) = '₹0.00' (a real zero), and SalarySlipsTable.tsx:103-109 renders the 'No salary slips yet' empty state with a link to payroll runs. Only DataSourceBadge (page.tsx:35) signals the error. income-tax/page.tsx:34-58 nulls stats and shows RefreshErrorState. A 403 status is also ignored.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/SalarySlipsTable.tsx`
- **Fix steps:**
  1. Destructure status from getSalarySlips(); if 403 return PermissionDenied.
  2. Compute errored = source==='error'; pass null to StatCards (StatCard renders '—') for errored.
  3. Render <RefreshErrorState error={toHumanError('load',{area:'salary slips'})} backHref='/hr/payroll'/> in place of the table.
  4. Keep the empty state only for a successful empty response.
- **Acceptance:**
  - Component test: source='error' -> no '₹0.00', RefreshErrorState shown, no empty state.
  - Manual: stop payroll-service, page shows error with retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents payroll staff reading an outage as no slips.

### GAP-PAYROLL-SALARY-SLIPS-02  ·  HIGH  ·  confirmed  ·  theme CAP (was DEADROUTE)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Totals are computed client-side from a single page: getSalarySlips(limit=50, offset=0) (loaders.ts:2336) and page.tsx:22-25 sums whatever came back. With more than 50 slips, "Total Slips", "Total Gross" and "Total Net" silently undercount — payroll totals a reviewer may quote — and there is no pager, month filter or "showing first 50" hint. The table's pageSize 20 is client-side paging over that same 50.
- **Verified evidence:** page.tsx:20 calls getSalarySlips() with defaults (loaders.ts:2336: limit=50, offset=0); lines 22-25 sum gross/net and count from that single page, so with over 50 slips the four stat cards undercount with no hint. Table paging is client-side over the same 50 (SalarySlipsTable.tsx:119 pageSize 20); no pager, month filter or truncation notice. Whether the API honours limit, caps it or returns a total is unverifiable. Theme tag DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/SalarySlipsTable.tsx`, `apps/web/src/app/_data/loaders.ts`, `payroll-service GET salary-slips (absent)`
- **Fix steps:**
  1. Ask backend for total count and period-scoped aggregates (totalGrossMinor/totalNetMinor) in the list response.
  2. Extend getSalarySlips to accept payPeriod/status filters and return {items,total}; add a server-driven pager (searchParams page, period).
  3. Until then, when slips.length >= limit show a banner 'Showing first 50 slips' and render totals as '—'.
  4. Sum money as bigint if computed client-side.
- **Acceptance:**
  - Test: with 50 mocked rows the truncation banner appears and totals are dashes.
  - Manual: with 120 slips the Total Slips card shows 120.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Totals are quoted by reviewers; wrong totals are misleading.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-03

### GAP-PAYROLL-SALARY-SLIPS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** No pay-period scoping: rows from different months/runs mix, so summed gross/net across periods has no meaning; payPeriod prints the raw backend string (e.g. "2026-08") (SalarySlipsTable.tsx:32).
- **Verified evidence:** getSalarySlips(limit, offset) (loaders.ts:2336-2343) has no payPeriod/month parameter, so the page mixes slips from all periods and sums them (page.tsx:23-24). payPeriod is printed raw in SalarySlipsTable.tsx:77 (observation said :32; the column is at line 77). Server-side support for a period filter cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/SalarySlipsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add payPeriod (YYYY-MM) searchParam and a month selector to page.tsx; pass to getSalarySlips (confirm backend param name).
  2. Default to the latest period; show totals only for the selected period.
  3. Format payPeriod with the shared formatPayPeriod helper (see DETAIL-06).
  4. Add a 'All periods' option that hides totals.
- **Acceptance:**
  - Manual: selecting 2026-08 lists only that period and totals match the run.
  - Unit test: page passes payPeriod to the loader.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; depends on backend filter.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-02, GAP-PAYROLL-SALARY-SLIPS-DETAIL-06

### GAP-PAYROLL-SALARY-SLIPS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Employees have a route to their own slip (salary-slips/[id] admits role "employee") but this list is admin-only (page.tsx:10-18), so there is no "My payslips" entry point — the detail comment admits "no self-service payslip route" existed.
- **Verified evidence:** salary-slips/page.tsx:10-18 restricts the list to payroll_admin, payroll_officer, super_admin, hr_admin. Detail pages admit employees (salary-slips/[id]/page.tsx:47 and slips/[id]/page.tsx:22, with the comment that no self-service route existed). No 'my payslips' page or link exists elsewhere in the app (grep found none); employees cannot discover their own slip id. Whether the API offers an own-slips list is unverifiable.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`, `apps/web/src/app/(app)/hr/payroll/my-slips/page.tsx (new)`, `apps/web/src/app/_data/loaders.ts`, `navigation config`
- **Fix steps:**
  1. Confirm with backend an ownership-scoped list (e.g. employeeId=me on salary-slips).
  2. Add /hr/payroll/my-slips (or make salary-slips/page.tsx role-aware) listing own slips using SalarySlipsTable without totals.
  3. Link it from the employee dashboard/self-service nav.
  4. Server must scope by token, not a query parameter.
- **Acceptance:**
  - Manual: an employee opens My payslips and sees only own slips; clicking one opens the slip detail.
  - API: employee cannot list others' slips.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: ownership must be enforced server-side.

### GAP-PAYROLL-SALARY-SLIPS-05  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Draft-slip visibility: Pending counts only status "draft" (page.tsx:25); "computed" slips (a status in the label map, SalarySlipsTable status) are not counted, and Print is offered for draft/computed slips as well as finalized ones (SalarySlipsTable.tsx:47), so an unapproved slip can be printed and circulated.
- **Verified evidence:** page.tsx:25 counts status==='draft' under the label statDraft, so the count matches its label; 'computed' is a valid status (statusLabels.ts:38) and is excluded. Print is offered for every row regardless of status: PrintDocumentLink in SalarySlipsTable.tsx:87-93 (observation said :47), plus Download PDF in slips/[id]/page.tsx:81-89 and window.print on the detail page. No status guard or draft watermark. Whether the /pdf endpoint refuses drafts is unverifiable. StatusPill has no 'computed' or 'finalized' mapping (neutral).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/SalarySlipsTable.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`, `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Show the print/PDF link only when status is 'finalized' or 'paid'; otherwise render a disabled 'Not issued' label.
  2. Apply the same guard to Download PDF and PrintButton on both detail pages; add a DRAFT watermark for non-final slips if printing is allowed for review.
  3. Count draft and computed as 'Pending/Unapproved' (rename card key accordingly).
  4. Backend: refuse /pdf for non-final slips.
  5. Add StatusPill mappings for computed and finalized.
- **Acceptance:**
  - Component test: draft row has no print link; finalized row does.
  - API: GET /pdf for a draft slip returns 4xx.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Circulating unapproved payslips is a payroll-control risk; UI guard alone is bypassable.
- **Depends on:** GAP-PAYROLL-SLIPS-DETAIL-05

### GAP-PAYROLL-SALARY-SLIPS-06  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1754 (merged); loading.tsx moved to DS skeletons earlier. Rescan completion: every payroll error.tsx (17 stragglers incl. runs, slips/[id], salary-slips/[id], [id], period, tax-config ...) now passes translated backLabel/area from the new payrollRouteError namespace (en+hi); RouteError localises Try again / Open help / default back label via next-intl (English fallback outside a provider); page-level PageHeader backLabel on runs, run detail, salary-slips, salary-revisions and gpf translated; guard test routeChrome.i18n.guard.test.ts fails on any English-literal backLabel/area in a payroll error.tsx and on slate / min-h-screen / max-w-7xl in any payroll loading.tsx. Remaining out of this item's files: page-level backLabel literals on other payroll pages (disbursement, fnf, loans, nps, pensioners, period, structures). (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** loading.tsx uses Tailwind slate utilities with min-h-screen and a max-w-7xl wrapper, ignoring dark mode and the DS skeleton; error.tsx strings ("Back to HR", "HR page") are hard-coded English (error.tsx:11-12).
- **Verified evidence:** salary-slips/loading.tsx uses Tailwind slate-50/slate-200, min-h-screen and max-w-7xl (lines 3-13), unlike sibling loading files that use DS variables (e.g. salary-slips/[id]/loading.tsx uses var(--panel)); only 4 of 30 payroll loading.tsx files use slate, so it is an outlier. error.tsx:11-12 hard-code backLabel 'Back to HR' and area 'HR page' (same pattern in runs/error.tsx and slips/[id]/error.tsx, and page-level backLabel strings such as runs/page.tsx:33). Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/error.tsx`, `apps/web/src/app/(app)/hr/payroll/runs/error.tsx`, `apps/web/src/app/(app)/hr/payroll/slips/[id]/error.tsx`, `apps/web/src/app/_components/RouteError.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx with page-main wrap, PageHeader-like header, StatGrid skeleton and table skeleton using Skeleton.tsx and var(--panel) tokens.
  2. Make RouteError accept i18n keys (or read backLabel/area from useTranslations) and have callers pass keys, not English.
  3. Grep for the other slate-based loading files and fix in one pass.
- **Acceptance:**
  - Manual: dark mode skeleton uses theme colours, no full-viewport grey flash.
  - Lint/i18n test: no hard-coded backLabel string in error.tsx files.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /hr/payroll/salary-slips/[id]  —  `payroll/salary-slips-detail.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`
- **Design reference:** `redesign/payroll/salary-slips-detail.html`

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-01  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Two pages read the same GET /api/v1/payroll/slips/{id} with different shapes: this page expects grossMinor/totalDeductionsMinor/netMinor/components[].amountMinor (page.tsx:15-31) while slips/[id] uses SalarySlipSummary gross/deductions/net and untyped earnings[].amount (slips/[id]/page.tsx:47-64). At least one is wrong; the backend contract is not in this checkout, so a slip can render ₹0.00 or blank on one view and correct on the other.
- **Verified evidence:** Both pages call GET /api/v1/payroll/slips/{id}. salary-slips/[id]/page.tsx:15-31,34-37 types a Slip with grossMinor/totalDeductionsMinor/netMinor/components[].amountMinor and no response schema; slips/[id]/page.tsx (getSlipById, loaders.ts:4478-4484) reads SalarySlipSummary gross/deductions/net plus earnings[].amount, deductionItems[].amount and statutory (cast at page.tsx:50-60). At most one matches the real payload; the backend contract and @civitasone/types are absent. Overstated: formatMoney(undefined) returns '—' not ₹0.00, and salary-slips/[id]/page.tsx:69-70 `slip.components.filter` would throw (error boundary) if components is missing.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `packages/types (SalarySlipSummary, absent)`, `payroll-service slip response (absent)`
- **Fix steps:**
  1. Obtain the real GET /v1/payroll/slips/:id response and write one zod SalarySlipDetailSchema (minor units as integer/string) in loaders.ts or lib/payroll.
  2. Make getSlipById use it (responseSchema) and have salary-slips/[id]/page.tsx call getSlipById instead of its private getSlip.
  3. Update both pages to the single shape (components[] or earnings/deductionItems, not both); remove the `as typeof slip & {...}` cast.
  4. Guard `components ?? []` and show RefreshErrorState on schema failure.
  5. Add a contract test using a recorded payload fixture.
- **Acceptance:**
  - Unit test: schema parses fixture; both pages render identical gross/net for the same fixture.
  - Manual: same slip id shows same Gross/Deductions/Net on /slips/{id} and /salary-slips/{id}.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Payslip figures are what employees rely on; a wrong mapping shows wrong pay. Verify against real data before release.
- **Depends on:** GAP-PAYROLL-SLIPS-DETAIL-03, GAP-PAYROLL-SALARY-SLIPS-DETAIL-03

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme BRANDING (was FABRICATED)

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Print letterhead is hard-coded by the i18n string "Government of India · HR Management System · Salary Slip" and brand "CivitasOne HRMS" (en.json salarySlipDetail.printMeta/brandName; page.tsx:89-91). A Govt. of Odisha department (or PSU/small office edition) would issue slips headed with the wrong authority; no tenant/DDO name, no signatory.
- **Verified evidence:** Print header renders t('brandName') and t('printMeta') (page.tsx:88-91); en.json:5137-5138 = 'CivitasOne HRMS' / 'Government of India · HR Management System · Salary Slip'. Footer (en.json:5134) is 'system-generated ... No signature required'. No tenant/DDO name, address, TAN or signatory is read: Slip type (lines 15-31) has none and only getSessionTenantId (an id) exists. .print-header is display none on screen and shown in print (globals-print.css:15-23). Violates the edition rule (CLAUDE.md s1: editions via theme/entitlements). Whether the slip endpoint or getTenantSettings (loaders.ts:803) carries an organisation name is unverified.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide the letterhead fields: organisation name, department, DDO name/code, address, signatory title.
  2. Extend the slip response or read getTenantSettings to supply them; pass to the print header as data.
  3. Replace brandName/printMeta strings with interpolated {orgName}; remove 'Government of India' hard-coding.
  4. Make the footer/signatory edition-aware (Govt edition may require DDO signature block).
  5. Fall back to the tenant name only, never a fabricated authority.
- **Acceptance:**
  - Manual: tenants A and B print slips with their own names; print preview shows no 'Government of India' for a small-office tenant.
  - i18n test: printMeta uses a placeholder.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Slips are legal-looking documents; wrong issuing authority is a compliance issue.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Components whose type is neither "earning" nor "deduction" (e.g. employer contributions, reimbursements) are dropped by the filters (page.tsx:69-70), so the printed lines may not add up to the printed Gross/Total Deductions/Net, which come straight from slip totals.
- **Verified evidence:** page.tsx:69-70 keep only c.type==='earning' and 'deduction'; any other type (employer contribution, reimbursement, perquisite) is silently dropped, while Gross, Total Deductions and Net (lines 132,150,160) come from slip totals, so listed rows may not add up. The set of component types the backend emits cannot be seen (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`
- **Fix steps:**
  1. Compute sumEarnings/sumDeductions from the listed components (integer minor units) and compare to slip.grossMinor/totalDeductionsMinor.
  2. Render unrecognised component types in an 'Other / employer contributions' block (excluded from net) rather than dropping.
  3. If sums differ, show a subtle discrepancy note (and log via telemetry) instead of printing an unreconciled slip.
  4. Confirm the type enum with the backend and centralise it in the shared slip schema.
- **Acceptance:**
  - Unit test: components with an 'employer' type appear in the other block; mismatch flag when sums differ.
  - Manual: printed earnings rows sum to Gross.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low code risk; payslip accuracy matters.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme RESPONSIVE (was OTHER)

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Earnings/Deductions use a fixed 1fr 1fr grid and 32px padding (page.tsx:119,87) with no breakpoint; at 390px each column is ~150px and long component names wrap against right-aligned amounts. Header actions row is a hand-built flex outside PageHeader (page.tsx:78-84).
- **Verified evidence:** page.tsx:119 grid gridTemplateColumns '1fr 1fr' gap 24, page.tsx:87 padding 32, container maxWidth 800, all inline with no breakpoint. At 390px width: .wrap padding 16 each side (civitas-ds.css:107), minus 64 padding and 24 gap gives about 135px per column, so names wrap against right-aligned monospace amounts (~150px claim is close). Header actions are a hand-built flex div (lines 78-84) outside PageHeader, which supports an actions prop (used in slips/[id]/page.tsx:72).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/app/civitas-ds.css`, `apps/web/src/app/globals-print.css`
- **Fix steps:**
  1. Move the two-column grid to a class (e.g. .slip-columns) with repeat(auto-fit,minmax(240px,1fr)); force two columns in @media print.
  2. Use padding: clamp(16px, 4vw, 32px) via a class instead of inline 32.
  3. Pass the Dashboard-view link and PrintButton through PageHeader actions.
  4. Set component name td to overflow-wrap:anywhere and amount td white-space:nowrap.
- **Acceptance:**
  - Manual at 390px: columns stack, no horizontal scroll, amounts not wrapped.
  - Print preview still shows two columns.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Print layout regression if the print media rule is not preserved.

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Bank account mask is a fixed prefix + last 4 digits (page.tsx:72-74): correct for DPDP display, but "XXXX-XXXX-" is prepended even for a 9-digit or 16-digit account, and the unmasked number is still fetched to the server render. PAN and PRAN/GPF numbers do not appear at all.
- **Verified evidence:** Mask is `"XXXX-XXXX-" + bankAccount.slice(-4)` (page.tsx:72-74): fixed prefix regardless of length, and accounts of 4 or fewer chars are shown in full. Overstated: the page is a server component, PrintButton takes no props, so the raw account number stays on the server and is not in the HTML/RSC payload; it is only fetched (unavoidably) from the API. PAN and PRAN/GPF are absent from the Slip type and the render: true. No <Masked> component exists in the repo.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`, `payroll-service slip response (absent)`
- **Fix steps:**
  1. Add maskAccount(value) to lib/formatters.ts: keep last 4, replace the rest with bullets preserving length, return '—' for empty and mask fully if length <= 4.
  2. Use it at page.tsx:72.
  3. Ask backend to return bankAccountLast4 (or masked) so the full number is never sent to the web tier.
  4. Decide with HR/compliance whether PAN (masked) and PRAN/GPF number belong on the slip; add them to the schema if yes.
- **Acceptance:**
  - Unit test: maskAccount('123456789') -> '•••••6789'; maskAccount('123') -> '•••'.
  - Manual: printed slip shows length-consistent mask.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII: the change should only reduce disclosure.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme FORMAT (was DEADROUTE)

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** paidDate and payPeriod are printed raw (ISO / "2026-08") instead of formatIndianDate (page.tsx:96,113); "Paid on: —" shows for finalized-but-unpaid slips without saying so; not-found uses the framework 404 (page.tsx:67) with no back link, unlike the sibling page.
- **Verified evidence:** page.tsx:96 prints slip.payPeriod raw, :113 prints slip.paidDate raw (or '—'), formatIndianDate exists in formatters.ts:2. Unpaid slips show 'Paid on: —' with no explanation. `if (!slip) notFound()` (line 67) uses the framework 404 with no back link, while the sibling slips/[id]/page.tsx:33-44 renders PageHeader with a back link and a message. Theme tag DEADROUTE is wrong: this is a formatting/empty-state issue.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Format paidDate with formatIndianDate and payPeriod with a month-year helper (add formatPayPeriod('2026-08') -> 'August 2026' in formatters.ts).
  2. Show a 'Not yet paid' label (i18n key) when paidDate is missing.
  3. Replace notFound() with the sibling's PageHeader plus not-found Card and back link (or add a route not-found.tsx with back link).
- **Acceptance:**
  - Unit test: formatPayPeriod('2026-08') === 'August 2026'.
  - Manual: unknown slip id shows message plus 'Back to Salary Slips'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-SALARY-SLIPS-DETAIL-07  ·  LOW  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Print button label carries an emoji ("🖨️ Print / Save PDF", en.json printButton) and the PDF endpoint /slips/{id}/pdf used by the list is a second, different print path from window.print() here.
- **Verified evidence:** en.json:5117 printButton.printSavePdfBtn = '🖨️ Print / Save PDF' (hi.json:3981 too); en.json:5145 printableSlipLink also has an emoji; PrintDocumentLink.tsx:19 hard-codes 🖨️ in JSX. Strings are already in next-intl, so the I18N tag is only partly right; the issue is emoji in copy (read aloud by screen readers, inconsistent rendering in print). Print paths differ: list uses /api/proxy/v1/payroll/slips/{id}/pdf (SalarySlipsTable.tsx:98), slips/[id] Download PDF the same (page.tsx:82), the detail page uses window.print() (PrintButton.tsx:12). PDF endpoint content is unverifiable (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/PrintButton.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/_components/PrintDocumentLink.tsx`
- **Fix steps:**
  1. Remove emoji from printSavePdfBtn/printableSlipLink in en.json and hi.json; render an aria-hidden icon component beside the label instead.
  2. Same for the 🖨️ in PrintDocumentLink.tsx.
  3. Decide one canonical print path (server PDF is auditable; window.print is client-only) and label the other 'Quick print'.
  4. Add aria-label with slip period to the print controls.
- **Acceptance:**
  - Unit test: no emoji code points in printButton.* keys (extend i18n coverage test).
  - Manual: screen reader reads 'Print / Save PDF' without 'printer'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /hr/payroll/slips/[id]  —  `payroll/slips-detail.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`
- **Design reference:** `redesign/payroll/slips-detail.html`

### GAP-PAYROLL-SLIPS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** A failed fetch is reported as a missing record: when slip is null the page shows "Salary slip not found. It may have been removed or you may not have access." next to the DataSourceBadge (page.tsx:33-44), for both source "error" and a true 404. Payroll staff will believe a slip was deleted when the backend was merely unreachable; the sibling salary-slips/[id] renders RefreshErrorState for the same case.
- **Verified evidence:** page.tsx:27 ignores the `source` returned by getSlipById; `if (!slip)` (lines 33-44) shows notFoundMessage ('may have been removed or you may not have access') for both a network/5xx failure and a genuine 404, only mitigated by DataSourceBadge with loadErrorMessage at line 37. Sibling salary-slips/[id]/page.tsx:56-66 renders RefreshErrorState on source==='error'.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`
- **Fix steps:**
  1. Destructure source; when source==='error' and status!==404 render RefreshErrorState (toHumanError('load',{area:'salary slip'})) with backHref.
  2. Keep the not-found card only for status===404 or a successful null.
  3. Reuse a shared helper across the two slip pages.
- **Acceptance:**
  - Component test: source='error' status=500 -> RefreshErrorState, not 'not found'.
  - Manual: block API, page shows retryable error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SLIPS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was VALIDATION)

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Because the typed summary carries no breakdown, the three detail cards may routinely read "not available" (page.tsx:160-166,194-200,237-241) — the page then adds little beyond the four stat cards and duplicates the printable slip; two slip views of one record should be merged.
- **Verified evidence:** Cards render 'unavailable' whenever earnings/deductionItems/statutory are absent (page.tsx:160-166,194-200,237-241). Those fields are read via a cast (lines 50-60) and are not in SalarySlipSummary, while the sibling page reads components[]; if the API returns components (as the sibling assumes) these cards would always be empty. Cannot verify the actual payload (payroll-service and packages/types absent). Theme VALIDATION is wrong. Merging the two views is a product decision.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Verify the real slip payload; adopt the shared schema from SALARY-SLIPS-DETAIL-01.
  2. Derive earnings/deductions cards from components[] and drop earnings/deductionItems reads if the payload uses components.
  3. Decide whether to keep both views: merge into one page with a print stylesheet, redirecting the other route.
  4. If kept, hide cards whose data is unavailable instead of showing three 'not available' cards.
- **Acceptance:**
  - Manual: a slip with components shows both tables filled.
  - If merged, the old route redirects.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Removing a route breaks bookmarks/links from the list rows (rowLinkPrefix salary-slips/).
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SLIPS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** Status card does slip.status.charAt(0) (page.tsx:105) with no guard; an undefined status (the REL-023 array/empty-body pattern noted in form16/page.tsx:41-47) throws and takes down the whole page. Statutory card shows employer PF/ESI contributions to an employee viewing their own slip with no explanation.
- **Verified evidence:** Line 105 `slip.status.charAt(0)` is unguarded. getSlipById.mapResponse accepts any non-null object (loaders.ts:4482), which in apiMappers.ts:32 includes arrays, and there is no responseSchema, so an empty-body/array payload leaves status undefined and throws; the route error.tsx boundary catches it (page not 'down' beyond error UI), matching the REL-023 pattern documented at form16/page.tsx:41-47. Statutory card (lines 212-229) labels 'PF (Employer)'/'ESI (Employer)' (en.json:5168,5170) but adds no explanation and shows them to the employee viewer; the data is only shown if the backend supplies it (unverified).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a zod responseSchema (shared with DETAIL-01) to getSlipById and reject arrays/missing status.
  2. Use `humanizeStatus(slip.status ?? '')` or StatusPill instead of charAt/slice.
  3. Add a short caption under the statutory card 'Employer contributions are paid by the employer and are not deducted from your pay' (i18n).
  4. Decide whether employer figures should be shown to employees at all.
- **Acceptance:**
  - Unit test: payload [] or {} -> RefreshErrorState, no exception.
  - Manual: employee view of statutory card shows the caption.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-DETAIL-01

### GAP-PAYROLL-SLIPS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme AUDIT (was CONFIRM)

- [x] **Status** — PR #1754 (merged)
- **First-pass claim:** No confirmation or audit hint on "Download PDF" (opens a new tab to the API proxy, page.tsx:81-89): a draft or computed slip can be downloaded while unpaid; no status guard on the action.
- **Verified evidence:** Download PDF is a plain anchor to /api/proxy/v1/payroll/slips/{id}/pdf (page.tsx:81-89) with no status check; it is a read (GET), so a ConfirmDialog with mandatory reason is disproportionate, and maker-checker does not apply. The real gap is no status guard (draft/computed slips downloadable) and audit of downloads, which is unverifiable (payroll-service absent). The printable-slip link (line 74) has the same lack of guard.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/salary-slips/SalarySlipsTable.tsx`
- **Fix steps:**
  1. Hide/disable the Download PDF button unless slip.status is finalized or paid, with a tooltip explaining why.
  2. Backend: reject /pdf for non-final slips and emit an audit event (payroll.slip.downloaded) with actor and slip id.
  3. Do not add ConfirmDialog/reason unless compliance requires it.
- **Acceptance:**
  - Component test: draft slip renders disabled download.
  - API: /pdf for draft returns 4xx; audit event recorded on success.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low for UI; audit needs backend.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-05

### GAP-PAYROLL-SLIPS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme NAV (was ROLEGATE)

- [x] **Status** — PR #1754 (merged). Rescan completion: the employee fallback /hr/payroll (READER_ROLES-only, 'Access restricted' for an employee) is replaced by My payslips (/hr/payroll/my-slips, admits employee + salary admins) in ONE shared slipBackTarget() used by both page.tsx and the now role-aware, translated error.tsx; a null/blank department renders a dash (employee name and pay period already did); tests for both roles, the Hindi boundary and the dash. (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** Back navigation is inconsistent: header back goes to /hr/payroll/salary-slips (page.tsx:71) but error.tsx backHref is /hr/payroll ("Back to Payroll"); employees, who cannot open the list (admin-only), land on a 403 there. Field values show department/payPeriod raw with no "—" fallback (page.tsx:125,129).
- **Verified evidence:** Header back goes to /hr/payroll/salary-slips (page.tsx:71) and the not-found branch too (line 36), but error.tsx:8-14 sets backHref '/hr/payroll' 'Back to Payroll'. That list page is admin-only (salary-slips/page.tsx:15-18) and renders PermissionDenied (not a raw 403) for employees, who are allowed on this detail page (line 22). Department (line 125) and payPeriod (line 129) render raw with no '—' fallback; employeeName link also unguarded (line 119).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/slips/[id]/page.tsx`, `apps/web/src/app/(app)/hr/payroll/slips/[id]/error.tsx`
- **Fix steps:**
  1. Compute backHref by role: admins -> /hr/payroll/salary-slips, employees -> /hr (or the new my-payslips page from SALARY-SLIPS-04).
  2. Use the same backHref in error.tsx via a small client helper or pass through a prop.
  3. Add `?? '—'` for department/employeeName/payPeriod and format payPeriod with formatPayPeriod.
- **Acceptance:**
  - Manual: as employee, Back does not land on Access restricted.
  - Component test: missing department renders '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-SALARY-SLIPS-04


---
## /hr/payroll/statutory  —  `payroll/statutory.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`
- **Design reference:** `redesign/payroll/statutory.html`

### GAP-PAYROLL-STATUTORY-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was MONEY)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Rates, ceilings and due days are code constants shown as live compliance (page.tsx:12-67): PT as 2.5% employee (line 34) though the PT page is a slab table; LWF as 0.5%/1% (lines 43-44) though the LWF page sets fixed rupee amounts; every module 'due 15th' (challanDueDay 15, six times) including PT, LWF and NPS. They can contradict the config pages and go stale after a circular.
- **Verified evidence:** statutory/page.tsx:12-67 STATUTORY_CARD_DEFS are code constants: PT empPct 2.5 (:34), LWF empPct 0.5/erPct 1 (:43-44), and challanDueDay: 15 on all six cards (:19,28,37,46,55,64). The PT page is a slab table (pt/page.tsx) and LwfConfigForm posts fixed rupee amounts (lwfEmployee/lwfEmployer, LwfConfigForm.tsx:56-57), so the hub contradicts both. PF 12/12 @ ₹15,000 and ESI 0.75/3.25 @ ₹21,000 are accurate statutory figures today but equally hard-coded and go stale on a circular; PT/LWF due dates are state-specific, and GPF is not a challan-based levy. The comment 'updated Aug 2026' is unverifiable. Theme MONEY is wrong (no money arithmetic bug).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/StatutoryComplianceCard.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. For PT and LWF cards drop empPct/erPct/challanDue and render a 'State-specific - see configuration' body linking to the PT/LWF pages (make empPct/erPct/challanDueDay optional in StatutoryComplianceCardProps).
  2. For PF/ESI/NPS/GPF keep rates only if labelled 'Statutory reference (as of <date>)' with a source note, or fetch them from a config endpoint once backend provides one (do not invent an endpoint).
  3. Remove challanDueDay from GPF (no challan) and per-state PT/LWF; keep 15th only for PF/ESI (verify PF due date with compliance owner).
- **Acceptance:**
  - Snapshot: hub PT and LWF cards show no percentages and no 'due 15th'.
  - Manual: rates on the hub match the values shown on the respective config pages, or the card states they are reference values with a date.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium: a compliance dashboard showing a wrong rate or due date can lead to late/short statutory payment.

### GAP-PAYROLL-STATUTORY-02  ·  HIGH  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Hub omits the TDS Returns screen (24Q/26Q) and sends GPF/NPS to /hr/payroll/gpf and /nps (page.tsx:56,65,81-82), leaving statutory/gpf and statutory/nps unreachable from navigation (duplicate screens).
- **Verified evidence:** True: the hub's 9 tiles (page.tsx:73-83) omit TDS Returns (24Q/26Q) and the GPF/NPS card and tile hrefs go to /hr/payroll/gpf and /hr/payroll/nps (page.tsx:56,65,81-82). Also true: statutory/gpf/page.tsx and statutory/nps/page.tsx exist and nothing links to them (grep found no reference to /statutory/gpf or /statutory/nps). Overstated: no link is dead, all targets exist; TDS Returns (payroll/returns) is reachable from the HR hub (hr/page.tsx:74) just not from this statutory hub; payroll/gpf and /nps are richer screens using the same /statutory/gpf|nps endpoint. So the issue is duplicate/orphan screens plus a missing hub tile, not dead routes.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/gpf/`, `apps/web/src/app/(app)/hr/payroll/statutory/nps/`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a TDS Returns (24Q/26Q) tile in statutory/page.tsx pointing to /hr/payroll/returns with translated title/description (new statutory.tileTdsReturns* keys).
  2. Decide the canonical GPF/NPS screen (recommend /hr/payroll/gpf|nps, which the hub and HR hub already use) and delete statutory/gpf and statutory/nps or redirect() them there.
  3. Update navRouteManifest/tests if these routes are listed.
- **Acceptance:**
  - Manual: statutory hub has a TDS Returns tile that opens /hr/payroll/returns.
  - Visiting /hr/payroll/statutory/gpf redirects to /hr/payroll/gpf (or the route no longer exists); no orphan pages remain (route-link audit passes).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; deleting the duplicate pages loses nothing as they call the same endpoint.

### GAP-PAYROLL-STATUTORY-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** PT and LWF have wageCeilingMonthly undefined ('State-specific' comment, page.tsx:36,45) which the card renders as 'No ceiling' (StatutoryComplianceCard.tsx:32-34) — a wrong statement.
- **Verified evidence:** statutory/page.tsx:36 and :45 leave wageCeilingMonthly undefined with 'State-specific' comments for PT and LWF; StatutoryComplianceCard.tsx:27-30 formatMinor(undefined) returns t('noCeiling') ('No ceiling', en.json statutoryComplianceCard.noCeiling), rendered at :152. So PT and LWF show 'No ceiling', which is wrong (state-specific rules, some with thresholds). NPS/GPF also render 'No ceiling'. Observation's line 32-34 is actually :27-30.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/StatutoryComplianceCard.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Change the prop to a discriminated value: wageCeilingMonthly?: number | 'state' | 'none'.
  2. In the card render t('ceilingStateSpecific') ('State-specific') for 'state', t('noCeiling') only for 'none', and '-' for unknown.
  3. Set PT and LWF to 'state' and NPS/GPF to 'none' in STATUTORY_CARD_DEFS; add the new message key in en/hi.
- **Acceptance:**
  - Component test: 'state' renders 'State-specific', 'none' renders 'No ceiling', number renders formatted rupees.
  - Manual: hub PT and LWF cards no longer say 'No ceiling'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-STATUTORY-01

### GAP-PAYROLL-STATUTORY-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** No role gate on the hub (hr/layout.tsx:16-38 admits employee and manager); fifteen targets (6 cards + 9 tiles) for nine modules, and every card repeats 'See Challans & Reconciliation for filing status' as non-link text (StatutoryComplianceCard.tsx:80).
- **Verified evidence:** hr/layout.tsx:32-47 (observation says 16-38) defines HR_ROLES including 'manager' and 'employee' and calls requireAnyRole(HR_ROLES); there is no payroll/layout.tsx or statutory/layout.tsx and the hub page has no role check (payroll/page.tsx:12-17 shows the pattern with PAYROLL_ADMIN_ROLES). The hub itself is static (no data), but it links to pages that fetch and mutate statutory data; backend enforcement cannot be verified (payroll service absent). The 15 targets = 6 cards + 9 tiles (page.tsx:103-105,120) for nine modules is correct, and StatutoryComplianceCard.tsx:80 renders t('seeChallansForFilingStatus') as a plain <span> inside the card <a>, not a link, repeated on all six cards.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/layout.tsx (new)`, `apps/web/src/app/(app)/hr/payroll/statutory/StatutoryComplianceCard.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`
- **Fix steps:**
  1. Add statutory/layout.tsx calling requireAnyRole(['payroll_admin','payroll_officer','hr_admin','super_admin', ...as agreed]) - reuse a shared PAYROLL_ADMIN_ROLES constant extracted from payroll/page.tsx:12.
  2. Verify each statutory endpoint enforces the same roles in the payroll service (backend still authoritative).
  3. Remove the repeated non-link span from the card (or turn it into one real <Link> to /hr/payroll/statutory/challans placed once in the card footer/page header).
  4. Drop the duplicate card+tile presentation of the same nine modules (keep cards for rates, tiles for navigation, or merge).
- **Acceptance:**
  - Test: with roles ['employee'] rendering statutory layout redirects to /dashboard; with ['payroll_officer'] it renders.
  - Manual: cards no longer show the 'See Challans...' text six times; one working link to Challans exists.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: tightening roles could lock out HR officers who use these pages today - confirm the role list with the payroll owner.

### GAP-PAYROLL-STATUTORY-05  ·  LOW  ·  partly  ·  theme OTHER (was FABRICATED)

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Card is a plain <a> with JS hover shadow (StatutoryComplianceCard.tsx:33,45-50) — full reload, no focus style; every tile gets the same 💰 icon since hrefs contain 'payroll' (LinkTiles.tsx tileIcon); 'Back to Payroll' is a literal (page.tsx:91).
- **Verified evidence:** Confirmed: StatutoryComplianceCard.tsx:33 renders a plain <a href> (full page reload, not next/link) with hover shadow driven by JS onMouseEnter/onMouseLeave (:45-50); LinkTiles.tsx tileIcon (:53-61) finds no TILE_ICONS key for the nine statutory titles and every href contains 'payroll', so all nine tiles get 💰; 'Back to Payroll' is a literal at page.tsx:92 (also 'Back to Statutory' literals across subpages). Overstated: civitas-ds.css:351 defines a global :focus-visible style, so keyboard focus is visible, though the hover shadow is not applied on focus. Theme FABRICATED does not fit.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/StatutoryComplianceCard.tsx`, `apps/web/src/app/_components/LinkTiles.tsx`, `packages/types (NavTile: optional icon)`, `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Swap <a> for next/link <Link> and move hover/focus shadow to a CSS class (.stat-card:hover, .stat-card:focus-visible) removing the JS handlers.
  2. Add an optional icon to NavTile (or add the nine statutory titles to TILE_ICONS) so tiles get distinct icons; check tileIcon uses tile.icon first.
  3. Translate 'Back to Payroll'/'Back to Statutory' via a t('backToPayroll') key (PageHeader backLabel).
- **Acceptance:**
  - Component test: card renders a link that navigates client-side (no full reload) and shows the shadow on keyboard focus.
  - Snapshot: statutory tiles show at least 5 different icons; hi.json shows Hindi back label.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; LinkTiles is shared, so changing tileIcon affects every module hub - keep the fallback order.


---
## /hr/payroll/statutory/challans  —  `payroll/statutory-challans.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/challans/page.tsx`
- **Design reference:** `redesign/payroll/statutory-challans.html`

### GAP-PAYROLL-STATUTORY-CHALLANS-02  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Money crosses the boundary as float rupees: the POST sends tdsAmount: parseFloat(tdsAmount) (IngestChallanForm.tsx:94) while every read is paise (challans/page.tsx:13-14,26-28). CLAUDE.md rule 11 requires bigint minor units; the LWF/PT forms convert to paise client-side, this one does not.
- **Verified evidence:** challans/IngestChallanForm.tsx:60 parses tdsAmount with parseFloat and :94 POSTs `tdsAmount: parseFloat(tdsAmount)` (float rupees) to v1/payroll/statutory/challans; reads use tdsAmountMinor/totalAmountMinor strings (challans/page.tsx:16-17,83-84). lwf/LwfConfigForm.tsx:56-57 and pt/PtSlabForm.tsx:64-66 send Math.round(x*100). Payroll-service contract is not in the snapshot so what the endpoint accepts (rupees vs paise, field name) cannot be seen; the inconsistency itself is real. Confirm dialog also interpolates raw tdsAmount (line 237).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/challans/IngestChallanForm.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Confirm with payroll-service the POST field name and unit (do not guess; if it still accepts rupees, keep rupees on the wire but document it).
  2. Add helper rupeesStringToMinor(str): string in lib/formatters.ts that parses the input string digit-wise (no float) into integer paise and rejects >2 decimals.
  3. In ingestChallan() send the paise value (as string/integer per contract) instead of parseFloat(tdsAmount).
  4. Validate with a zod schema (regex ^\d+(\.\d{1,2})?$) in handleSubmit instead of parseFloat/NaN check.
  5. Show the confirm-dialog amount via formatMoney(minor) rather than raw tdsAmount.
  6. Reuse the same helper in LwfConfigForm and PtSlabForm to drop Math.round(x*100).
- **Acceptance:**
  - Unit test rupeesStringToMinor: '1234.56'->'123456', '0.1'->'10', '1.005' rejected, '' rejected.
  - Component test: entering 1234.56 posts the agreed paise value and the dialog shows ₹1,234.56.
  - Manual: ingest a challan, list row shows the same amount via formatMoney.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money: a 100x unit mismatch would silently mis-state TDS deposited and reconciliation; verify unit against payroll-service before changing.
- **Depends on:** shared rupees->paise helper

### GAP-PAYROLL-STATUTORY-CHALLANS-03  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged). Rescan completion: the Reconciliation Status tile's text AND icon now come from ONE verdict (top-level matched AND every per-period row matched; otherwise the first non-matched period is named, else 'Not matched'), tests cover matched=false with perPeriod[0].status='matched', a non-matched later period, and no payload. The filing-blocked banner shows translated, form- and period-aware copy; the backend `note` is deliberately NOT echoed (English-only and hard-codes '24Q', pinned by test) -- if the owner wants the raw note shown anyway, say so. (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** The 24Q/26Q gate is half-hidden: the reconcile response carries filingBlocked and note (page.tsx:41-42) but neither is shown; 'Reconciliation Status' shows perPeriod[0].status only (page.tsx:105) while its icon uses the top-level matched (page.tsx:102), so tile text and icon can disagree.
- **Verified evidence:** ReconcileResponse declares filingBlocked and note (challans/page.tsx:41-42) but neither is rendered anywhere in the file (grep finds only the type). StatCard icon/tone use top-level reconciliation.matched (102-103) while value is perPeriod[0].status (105), falling back to t('unknownStatus'); with several perPeriod rows or a period/formType mix these can disagree.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/challans/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add a banner (existing ds Card/pill style) above StatGrid shown when reconciliation.filingBlocked, rendering reconciliation.note and a 'Filing of 24Q/26Q blocked until challans match' label (new i18n keys).
  2. Derive tile value from one source: use reconciliation.matched ? 'Matched' : 'Variance' (translated) or list every perPeriod status, not [0].
  3. Keep icon and text driven by the same variable.
  4. Show per-formType rows if perPeriod has more than one entry.
- **Acceptance:**
  - Component/render test: filingBlocked=true shows banner with note text.
  - Test: matched=false with perPeriod[0].status='matched' no longer renders green text with warning icon.
  - Manual with mocked reconcile payload.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Filing compliance: hiding the block flag lets users file returns that should be held; low regression risk.
- **Depends on:** GAP-PAYROLL-STATUTORY-CHALLANS-04

### GAP-PAYROLL-STATUTORY-CHALLANS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged). Rescan completion: GET /challans rows now carry formType (real-DB test: 24Q default, 26Q filter, tenant-scoped), the table has a translated Form column (older payroll-service rows fall back to the selected form), PeriodSelector form-type navigation is tested, and the 'Challans for Period' tile is tested equal to the rows listed. (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** Form type is chosen at ingest (IngestChallanForm.tsx:18,176-190) but neither query passes it (page.tsx:69,78) and the table has no Form Type column, so 24Q and 26Q challans are indistinguishable in one list and the stat tiles.
- **Verified evidence:** IngestChallanForm.tsx:18,177-186 picks 24Q/26Q and POSTs formType (line 93). page.tsx:51 and :58 call challans and reconcile with only ?period=; ChallanRow (10-19) has no formType field though ChallansResponse has formType at response level (21) only, and columns (77-86) have no Form Type column. Whether the backend filters by formType or returns both is not visible (payroll-service absent), but the UI cannot separate them.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/challans/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add optional searchParams.formType ('24Q'|'26Q'|all) and a select in PeriodSelector.tsx that pushes it into the URL.
  2. Pass &formType= to both getChallans and getReconciliation only if the payroll-service endpoint supports it (verify); otherwise filter client side.
  3. Add formType to ChallanRow and a 'Form' column, if the row payload carries it.
  4. Compute stat tiles per selected form.
- **Acceptance:**
  - Selecting 26Q shows only 26Q challans and reconciliation.
  - Table shows a Form column; tile counts match filtered list.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; risk is assuming a query param the service ignores.

### GAP-PAYROLL-STATUTORY-CHALLANS-05  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Saving a challan for a period other than the one being viewed shows 'Challan ingested for {period}.' and calls router.refresh() (IngestChallanForm.tsx:100-102) — the visible list does not change; no duplicate-CIN check or deposit-date-within-period check on the client (lines 51-80).
- **Verified evidence:** Confirmed: after POST the form shows ingestedMessage with challanPeriod (IngestChallanForm.tsx:100, en.json 'Challan ingested for {period}.') and router.refresh() (102) refreshes the URL period, not challanPeriod, and the form's own period input is independent (14, 119-123). Validation (53-77) checks BSR, amount, serial/date presence only; no duplicate-CIN or deposit-date-in-period check. Duplicate CIN needs backend knowledge; the client could only check against the visible list. The suggested zod/disabled-submit is partly present: Button is disabled={busy} (206) and dialog is busy-guarded.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/challans/IngestChallanForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. If challanPeriod !== period, after success router.push(`/hr/payroll/statutory/challans?period=${challanPeriod}`) instead of refresh, or add a 'View {period}' link in the message.
  2. Add client check that depositDate is on/after the first day of challanPeriod (warn, not block, since deposits are due the following month per TDS rules; confirm with tax owner).
  3. Surface backend duplicate-CIN error code as a field message on serial/BSR (needs contract).
  4. Replace ad hoc checks with one zod schema.
- **Acceptance:**
  - Ingesting for 2026-05 while viewing 2026-06 navigates to 2026-05 and shows the row.
  - Bad BSR/amount/serial cases still focus the right field.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Date rule is a tax-domain decision; do not hard block without sign-off.
- **Depends on:** GAP-PAYROLL-STATUTORY-CHALLANS-02


---
## /hr/payroll/statutory/esi  —  `payroll/statutory-esi.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`
- **Design reference:** `redesign/payroll/statutory-esi.html`

### GAP-PAYROLL-STATUTORY-ESI-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** 'Employee' column prints the raw employeeId (uuid) — DataTable key employeeId, esi/page.tsx:37; a payroll officer cannot tell who a row belongs to.
- **Verified evidence:** esi/page.tsx:37 column key employeeId with no render/cellType, so DataTable.cellValue (ds/DataTable.tsx:141) prints String(uuid). The row type (8-15) has no name. Twin pages already use r.employeeName ?? employeeCode (hr/payroll/gpf/page.tsx:42 comments payroll-service enriches best-effort; loaders.ts StatutoryRow has employeeName?), so the field may exist on the same endpoint but cannot be verified for esi.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`
- **Fix steps:**
  1. Add employeeName?: string|null to EsiRow.
  2. Build display rows like hr/payroll/gpf/page.tsx does: employeeCode = employeeId.slice(0,8).toUpperCase(), employeeName = r.employeeName ?? employeeCode.
  3. Change column to key employeeName; keep employeeId as row id.
  4. Share the mapping as a helper (toStatutoryDisplayRow) used by esi, gpf, nps.
- **Acceptance:**
  - Row with employeeName shows the name; row without shows 8-char code, never full uuid.
  - Filter box matches on name.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Name may be absent if service does not enrich; fallback code still shows.
- **Depends on:** shared employee-name mapping

### GAP-PAYROLL-STATUTORY-ESI-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Stats and 'Total ESI Liability' are summed over the whole ledger with no period filter or server pagination (esi/page.tsx:18,32-34); the figure is all-time contribution, not a payable amount for a month, yet is labelled liability.
- **Verified evidence:** getData fetches /api/v1/payroll/statutory/esi with no period or paging params (esi/page.tsx:18); totals at 32-34 sum every returned row and stat label 'Total ESI Liability' (en.json esi.statTotalEsiLiability). DataTable filters/pages client side (pageSize 15). Whether the endpoint caps results is unknown (service absent). The sum is a cumulative contribution ledger, not a payable for a month.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add searchParams.period (reuse challans/PeriodSelector pattern; generalise it to take a base path) and pass ?period= only if the endpoint supports it, else filter rows by period client side.
  2. Compute tiles for the selected period only; default to current period.
  3. Rename tile to 'Total ESI contribution (period)' in en.json, drop 'Liability'.
  4. Add note when list may be truncated (if service returns a total/next cursor).
- **Acceptance:**
  - Changing period changes tile totals and rows.
  - Label no longer says liability; totals equal sum of visible period rows.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Statutory: mislabelled totals could be paid to ESIC as due amount.

### GAP-PAYROLL-STATUTORY-ESI-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** RefreshErrorState is given the bare token area 'esi' (esi/page.tsx:61), so the error reads "We couldn't load esi." (lib/messages.ts:41).
- **Verified evidence:** esi/page.tsx:61 calls toHumanError('load',{area:'esi'}); messages.ts:41 builds `We couldn't load ${thing}.` giving 'We couldn't load esi.'. Same bare-token pattern in gpf:61, nps:65, lwf:61; challans uses 'TDS challans'.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/lwf/page.tsx`
- **Fix steps:**
  1. Change area to human words: 'ESI contributions', 'GPF ledger', 'NPS contributions', 'LWF configuration' (or a t('errorArea') key).
  2. Do all four in one change.
- **Acceptance:**
  - Force error source: message reads 'We couldn't load ESI contributions.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PAYROLL-STATUTORY-GPF-06, GAP-PAYROLL-STATUTORY-NPS-06, GAP-PAYROLL-STATUTORY-LWF-06

### GAP-PAYROLL-STATUTORY-ESI-05  ·  LOW  ·  partly  ·  theme LOADING (was MONEY)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Loading is one blank .skeleton block with no page frame (esi/loading.tsx:5); no ESI wage-ceiling (₹21,000) or coverage hint shown, although the hub card hard-codes it (statutory/page.tsx:22-30).
- **Verified evidence:** True: esi/loading.tsx:5 renders a single .skeleton with no header/stat frame (identical in pf, challans loading.tsx). The hub hard-codes the ESI ceiling wageCeilingMonthly 2_100_000 paise (=₹21,000) at statutory/page.tsx:27, rendered by StatutoryComplianceCard (formatMinor), but esi/page.tsx shows no ceiling/coverage hint. The tagged money/float theme does not apply: amounts already use formatMoney on paise.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/esi/loading.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`
- **Fix steps:**
  1. Make loading.tsx render PageHeader-shaped skeleton plus 4 stat skeletons (create shared StatutoryListSkeleton and reuse in pf/esi/gpf/nps/lwf/challans).
  2. Move ESI ceiling and rates to a shared constant (e.g. statutory/_lib/rates.ts) used by hub and page; show 'Wage ceiling ₹21,000' in subtitle via formatMoney.
- **Acceptance:**
  - Loading state shows header and 4 tiles placeholders.
  - ESI page shows ceiling text sourced from the same constant as hub.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Constant is a statutory value; keep single source.


---
## /hr/payroll/statutory/gpf  —  `payroll/statutory-gpf.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`
- **Design reference:** `redesign/payroll/statutory-gpf.html`

### GAP-PAYROLL-STATUTORY-GPF-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Two GPF screens read the same payroll endpoint: this route and /hr/payroll/gpf (hr/payroll/gpf/page.tsx uses getGpfStatements(), _data/loaders.ts:4452-4458 → /api/v1/payroll/statutory/gpf). The statutory hub links only to /hr/payroll/gpf (statutory/page.tsx:65,81), so this page is reachable only by URL and can drift from its twin.
- **Verified evidence:** statutory/gpf/page.tsx:18 and hr/payroll/gpf/page.tsx (via getGpfStatements, _data/loaders.ts:4452-4458) both call /api/v1/payroll/statutory/gpf. Hub tile (statutory/page.tsx:81) and card (65) link to /hr/payroll/gpf only; nothing links to /hr/payroll/statutory/gpf. The twin is richer (employee name). Same duplication for NPS.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`, `apps/web/next.config.js`, `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`
- **Fix steps:**
  1. Decide canonical route (recommend /hr/payroll/gpf since it is linked and richer).
  2. Delete statutory/gpf/page.tsx (and loading/error) and add redirect() or next.config redirect /hr/payroll/statutory/gpf -> /hr/payroll/gpf; or repoint hub links and delete the twin.
  3. Grep for hard-coded links to the removed route and update i18n copy.
- **Acceptance:**
  - Visiting /hr/payroll/statutory/gpf lands on canonical page.
  - No orphan route remains; hub links unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; bookmarked URLs keep working via redirect.
- **Depends on:** GAP-PAYROLL-STATUTORY-NPS-01

### GAP-PAYROLL-STATUTORY-GPF-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** 'Rate (%)' column prints the bare number (gpf/page.tsx:40, no cellType) e.g. '10', not '10%'.
- **Verified evidence:** gpf/page.tsx:40 column contribPct has no cellType so cells print bare numbers; header is 'Rate (%)' (en.json gpf.colRatePercent) so the unit is stated in the header. DataTable supports only status|amount|rupees cellTypes (ds/DataTable.tsx:47) and render is client-only, so a percent cell needs a new cellType. formatBps exists in lib/formatters.ts (~162) but values here are percent, unit unconfirmed.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Fix steps:**
  1. Add cellType 'percent' to DataTable Column and cellValue (formatPercent(value) -> '10%', '—' for null).
  2. Use it for contribPct (gpf) and empContribPct/erContribPct (nps).
  3. Drop '(%)' from the headers after.
- **Acceptance:**
  - Row with 10 shows '10%'.
  - null shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm API sends percent not fraction/bps.
- **Depends on:** GAP-PAYROLL-STATUTORY-NPS-06

### GAP-PAYROLL-STATUTORY-GPF-05  ·  MEDIUM  ·  confirmed  ·  theme UUID (was OTHER)

- [x] **Status** — PR #1751 (merged); the Employee column shows name + code and the twin route redirects to /hr/payroll/gpf (earlier PRs). Rescan completion: every tile label states its scope ('... (listed below)', en+hi) and a truncation note appears when a full page (the service default limit, read from listQuerySchema) comes back -- the tiles count only the statements loaded, NOT all history, so 'all time' wording would have been false. (W2 payroll rescan: completed by #PRNUM)
- **First-pass claim:** Employee column prints raw employeeId (gpf/page.tsx:37); 'Unique Employees'/'Periods Covered' tiles are counts over the whole history, not a period.
- **Verified evidence:** gpf/page.tsx:37 column employeeId prints uuid; tiles uniqueEmployees and uniquePeriods (33-34, 55-56) are Set sizes over all rows returned, with no period filter. Confirmed, though 'periods covered' over full history is arguably intended for a ledger.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`
- **Fix steps:**
  1. Apply the employee-name mapping (see ESI-02) and key column employeeName.
  2. Replace 'Periods Covered' tile with latest period or add period filter; label remaining counts 'all time' in en.json.
- **Acceptance:**
  - Column shows name/short code, never full uuid.
  - Tile labels state their scope.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-STATUTORY-ESI-02

### GAP-PAYROLL-STATUTORY-GPF-06  ·  LOW  ·  partly  ·  theme COPY (was LOADING)

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Error area is the bare token 'gpf' (gpf/page.tsx:61); no DataSourceBadge/skeleton frame differences from siblings.
- **Verified evidence:** True: gpf/page.tsx:61 passes bare area 'gpf' -> 'We couldn't load gpf.'. False: the page does render DataSourceBadge (line 51) like siblings, and gpf/loading.tsx follows the same single-skeleton pattern as esi/pf. Theme LOADING is off; this is copy.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`
- **Fix steps:**
  1. Set area to 'GPF ledger' (see ESI-04).
- **Acceptance:**
  - Error state reads 'We couldn't load GPF ledger.'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PAYROLL-STATUTORY-ESI-04


---
## /hr/payroll/statutory/gratuity  —  `payroll/statutory-gratuity.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/gratuity/page.tsx`
- **Design reference:** `redesign/payroll/statutory-gratuity.html`

### GAP-PAYROLL-STATUTORY-GRATUITY-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Rounding: Math.floor(numYears) is used for the formula (GratuityCalculator.tsx:19,110,112) and eligibility is raw numYears >= 5 (line 23); the Act rounds a service period over six months up to the next year, so 9 years 8 months is computed as 9.
- **Verified evidence:** GratuityCalculator.tsx:19 uses Math.floor(numYears) in the formula, 110 and 112 display floor, and eligibility hasResult uses raw numYears>=5 (23). Years field accepts step 0.5 (79), so 9.67 years yields 9. Under the Payment of Gratuity Act s.4(2) a fraction over 6 months counts as a full year; eligibility of 5 years also allows 4y240d rule (not modelled). Calculator only; register amounts come from server.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gratuity/GratuityCalculator.tsx`
- **Fix steps:**
  1. Add helper completedYears(years) = floor(y) + (frac > 0.5 ? 1 : 0) and use it in the formula, trace and count.
  2. Ask for years and months as two inputs (avoids decimal-year ambiguity).
  3. Compute eligibility from the rounded/service-days rule after HR confirms (5 years continuous service; death/disablement exempt).
  4. Show the rounding rule in the description.
- **Acceptance:**
  - 9y8m -> 10 years in formula; 9y6m -> 9 years.
  - Unit tests for boundary 0.5.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Statutory calc; confirm rule with HR/legal (govt employees fall under CCS Pension rules, not the Act).

### GAP-PAYROLL-STATUTORY-GRATUITY-04  ·  MEDIUM  ·  partly  ·  theme CONFIG (was MONEY)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Statutory ceiling is a hard-coded constant GRATUITY_CEILING_PAISE (GratuityCalculator.tsx:6) and 26 working days (line 8); a notified ceiling change needs a redeploy, and the constant is not shown next to the register's amounts.
- **Verified evidence:** GRATUITY_CEILING_PAISE = 2_000_000_00 (₹20 lakh) at GratuityCalculator.tsx:6 and WORKING_DAYS_PER_MONTH = 26 at :8 are hard-coded, correct. The register (gratuity/page.tsx) never displays the ceiling; the calculator prints it only when capped (114). Nothing else is wrong with money handling (constant is in paise), so the money theme is incidental. Making it configurable needs a backend config source, unseen.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gratuity/GratuityCalculator.tsx`, `apps/web/src/app/(app)/hr/payroll/tax-config`
- **Fix steps:**
  1. Move constants to a shared statutory constants module for now (single source with hub).
  2. If tenant tax-config exposes it, read ceiling from there (verify endpoint) and pass as prop.
  3. Show 'Ceiling ₹20,00,000' in calculator description and register subtitle via formatMoney.
- **Acceptance:**
  - Ceiling shown next to the register.
  - Changing the constant changes calculator and label together.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not invent a config endpoint.

### GAP-PAYROLL-STATUTORY-GRATUITY-05  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Calculator works in float rupees (GratuityCalculator.tsx:13-25) while the register is paise (page.tsx:12); it is disconnected from any employee, so its estimate can disagree with the register and nothing tells the user which is authoritative.
- **Verified evidence:** Calculator works in float rupees (GratuityCalculator.tsx:13-25, formatRs with toLocaleString) while register rows are gratuityMinor paise formatted with formatMoney (gratuity/page.tsx:48). It takes free salary and years, no employee link, and no copy says it is illustrative. Rounding to whole rupees via maximumFractionDigits 0 can differ from register by up to ₹1. It is a scratch estimator so float use is display-only, but it should not be presented as authoritative.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/gratuity/GratuityCalculator.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Convert inputs to paise integers (shared rupees->paise helper) and compute with BigInt/integer math, format with formatMoney.
  2. Add visible 'Estimate only; the register is authoritative' note (en.json gratuityCalculator.description).
  3. Optionally allow prefill from a register row (employee salary + years).
- **Acceptance:**
  - Calculator output for 50,000 x 10y = 2,88,461.53 matches formatMoney of the integer result.
  - Disclaimer visible.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; estimate only.
- **Depends on:** GAP-PAYROLL-STATUTORY-CHALLANS-02


---
## /hr/payroll/statutory/lwf  —  `payroll/statutory-lwf.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/lwf/page.tsx`
- **Design reference:** `redesign/payroll/statutory-lwf.html`

### GAP-PAYROLL-STATUTORY-LWF-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** 'Total Emp Contribution' and 'Total Employer Contribution' add different states' per-employee amounts together (lwf/page.tsx:30-31) and 'Unique Frequencies' counts distinct strings (line 32) — none is a meaningful figure.
- **Verified evidence:** lwf/page.tsx:30-31 sum employee_contrib_minor/employer_contrib_minor across all state rows (different states' flat amounts) and :32 counts distinct frequency strings, shown as tiles 50-53. The sums are not a meaningful quantity.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/lwf/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Replace the three tiles with States configured, Monthly-frequency count, and Last updated (if a field exists); remove totals and unique-frequency.
  2. Delete unused keys in en.json (statTotalEmpContribution, statTotalEmployerContribution, statUniqueFrequencies).
- **Acceptance:**
  - Page shows no summed contributions.
  - Tile count equals configured states.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-STATUTORY-LWF-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was MONEY)

- [x] **Status** — PR #1798 (merged)
- **First-pass claim:** Hub card shows LWF as 0.5% employee / 1% employer with a 15th-of-month due day (statutory/page.tsx:40-48) but this page configures fixed rupee amounts per state; two contradictory models on one product.
- **Verified evidence:** statutory/page.tsx:40-48 defines the LWF card with empPct 0.5, erPct 1, challanDueDay 15 and StatutoryComplianceCard renders `{empPct}%` (StatutoryComplianceCard.tsx:112,134). lwf/page.tsx/LwfConfigForm configure fixed rupee amounts per state (lwfEmployee/lwfEmployer, paise). LWF is state-specific fixed amounts, so the hub percentage is misleading; the state-specific wageCeiling comment shows the author knew. Due day also varies by state.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/StatutoryComplianceCard.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. For state-specific schemes (PT, LWF) make empPct/erPct optional and show 'Fixed amount per state' text instead of percentages.
  2. Optionally derive due day from state config (unknown source; else label 'varies by state').
- **Acceptance:**
  - LWF hub card shows no percentage.
  - PT card similarly not misleading.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Hub says PT 2.5% too, same class.

### GAP-PAYROLL-STATUTORY-LWF-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Save semantics unclear ('Add / Update' upsert per state code?); empty contribution inputs are silently sent as 0 (LwfConfigForm.tsx:55-56); state code is free text (maxLength 4, line 87).
- **Verified evidence:** Confirmed: LwfConfigForm.tsx:56-57 use `parseFloat(x) || 0` so empty inputs send 0; state code is free text with maxLength 4 and only a non-empty check (37, 87); title says 'Add / Update LWF Configuration' (en.json lwfConfigForm.formTitle) without telling users a repeat state overwrites. Whether the server upserts cannot be verified (payroll-service absent).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/lwf/LwfConfigForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Require both contribution inputs (error if blank; 0 must be typed).
  2. Replace state code input with a select of state codes (existing state list in lib if any) or validate against ^[A-Z]{2}$.
  3. Reflect existing config: if stateCode already in table, show 'This will overwrite X' in the ConfirmDialog.
  4. Use shared rupees->paise helper.
- **Acceptance:**
  - Blank amount blocks submit with field error.
  - Existing state shows overwrite warning in dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money config: silent zero LWF would stop deductions for a state.
- **Depends on:** GAP-PAYROLL-STATUTORY-CHALLANS-02

### GAP-PAYROLL-STATUTORY-LWF-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Frequency prints the raw backend string (lwf/page.tsx:38); area token 'lwf' reads "We couldn't load lwf." (lwf/page.tsx:61).
- **Verified evidence:** lwf/page.tsx:38 column frequency has no formatter (raw backend string, e.g. 'monthly'/'half_yearly'); :61 area 'lwf' -> 'We couldn't load lwf.'.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/lwf/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Add client-safe label map (or a new DataTable cellType 'enum' with i18n keys) for frequency values, fall back to raw string.
  2. Change area to 'LWF configuration' (see ESI-04).
- **Acceptance:**
  - monthly renders 'Monthly'.
  - Unknown value renders raw.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; unknown enum values from backend unseen.
- **Depends on:** GAP-PAYROLL-STATUTORY-ESI-04


---
## /hr/payroll/statutory/nps  —  `payroll/statutory-nps.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Design reference:** `redesign/payroll/statutory-nps.html`

### GAP-PAYROLL-STATUTORY-NPS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Two NPS screens read the same payroll endpoint: this route and /hr/payroll/nps (getNpsStatements(), _data/loaders.ts:4460-4466). The statutory hub links only to /hr/payroll/nps (statutory/page.tsx:56,82); this page is URL-only and can drift.
- **Verified evidence:** statutory/nps/page.tsx:20 and hr/payroll/nps/page.tsx (getNpsStatements, loaders.ts:4460-4466) call /api/v1/payroll/statutory/nps. Hub links tile and card to /hr/payroll/nps only (statutory/page.tsx:56,82). The twin adds employee name, chart and projection.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`, `apps/web/next.config.js`
- **Fix steps:**
  1. Same resolution as GPF-01: pick /hr/payroll/nps as canonical, remove statutory/nps (page/loading/error) and add a redirect.
- **Acceptance:**
  - Old URL redirects to canonical page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-STATUTORY-GPF-01

### GAP-PAYROLL-STATUTORY-NPS-03  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1753 (merged): role gate added; confirmed backend has zero self-service here (READER_ROLES has no employee role), unlike sibling statutory pages.
- **First-pass claim:** No role gate: employee and manager pass hr/layout.tsx (layout.tsx:16-38) and this page never checks roles, while hrms NPS routes require HR/finance/payroll roles (nps/routes.ts:25,56).
- **Verified evidence:** Layout hr/layout.tsx:32-46 allows manager and employee (HR_ROLES) and statutory/nps/page.tsx has no requireAnyRole/getSessionRoles check, so those roles reach it (hr/payroll/page.tsx uses getSessionRoles for canAdminister). But the cited hrms NPS role check (nps/routes.ts HR_ROLES line 24, requireRole ~56) protects hrms endpoints, not the payroll-service endpoint this page calls; enforcement there is unseen. So exposure depends on payroll-service authorisation, which cannot be verified. Same applies to every statutory page.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/layout.tsx (new)`
- **Fix steps:**
  1. Create statutory/layout.tsx calling requireAnyRole(PAYROLL_ADMIN_ROLES) (reuse the list used in hr/payroll/page.tsx) so all statutory routes are gated, not only NPS.
  2. Redirect others to /dashboard as in hr/layout.
  3. Verify payroll-service enforces the same roles.
- **Acceptance:**
  - employee/manager session hitting /hr/payroll/statutory/nps redirects.
  - payroll_officer still loads.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** PII: employee pension contributions visible to all staff if service does not enforce roles.

### GAP-PAYROLL-STATUTORY-NPS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** — PR #1753 (merged): hard-coded (10%)/(14%) tile labels replaced with the contribution percentage each row already carries.
- **First-pass claim:** Tile labels hard-code '(10%)' and '(14%)' (en.json nps.statTotalEmployeeContribution/EmployerContribution) although each row carries its own empContribPct/erContribPct (nps/page.tsx:12-13); a row with a different rate contradicts the tile.
- **Verified evidence:** en.json nps.statTotalEmployeeContribution = 'Total Employee Contribution (10%)' and statTotalEmployerContribution '(14%)' hard-coded (lines ~3160-3161) while rows carry empContribPct/erContribPct (nps/page.tsx:12-13), shown as columns 42-43. A row at another rate contradicts the tile. It is already an en.json key, so not an i18n problem.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Fix steps:**
  1. Remove '(10%)'/'(14%)' from the labels.
  2. Optionally show 'at standard rates 10%/14%' only in subtitle, or display distinct rates present when uniform.
- **Acceptance:**
  - Tile labels have no percentages.
  - Rows with 14% or 10% no longer conflict.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-STATUTORY-NPS-05  ·  MEDIUM  ·  partly  ·  theme UUID (was OTHER)

- [x] **Status** — PR #1753 (merged): real employee name shown (backend already returned it, frontend just never read it); relabeled Basic Pay to Contribution Base since no daMinor field exists in the API to support a Basic+DA claim.
- **First-pass claim:** Only 'Basic Pay' is shown as the contribution base (nps/page.tsx:41); central-government NPS is computed on Basic + DA, so the row cannot be checked by eye. Raw employeeId in Employee column (nps/page.tsx:39).
- **Verified evidence:** True: only basicMinor is shown (nps/page.tsx:41, header 'Basic Pay') and employeeId printed raw (39). Whether contributions are actually computed on Basic+DA cannot be verified: the payroll-service calculation is absent and the row has no DA field. The 10% of Basic+DA rule for central govt NPS is a domain fact, not visible in code.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Fix steps:**
  1. Ask backend whether row can carry daMinor or a contribution base; if yes add 'Basic + DA' column.
  2. Otherwise relabel 'Basic Pay' as 'Contribution base' if that is what basicMinor holds.
  3. Map employee names as in ESI-02.
- **Acceptance:**
  - Base column matches the value used for the percentage.
  - Employee shows name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PAYROLL-STATUTORY-ESI-02

### GAP-PAYROLL-STATUTORY-NPS-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1753 (merged): bare nps error token fixed.
- **First-pass claim:** Error area is the bare token 'nps' (nps/page.tsx:65); rate columns print bare numbers ('10') without %.
- **Verified evidence:** nps/page.tsx:65 area 'nps' -> 'We couldn't load nps.'; columns 42-43 empContribPct/erContribPct have no cellType so cells print bare numbers (headers already say '(%)').
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Fix steps:**
  1. Set area to 'NPS contributions'.
  2. Use new percent cellType (see GPF-04).
- **Acceptance:**
  - Error copy reads properly; rate shows '10%'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-PAYROLL-STATUTORY-GPF-04, GAP-PAYROLL-STATUTORY-ESI-04


---
## /hr/payroll/statutory/perquisite  —  `payroll/statutory-perquisite.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/page.tsx`
- **Design reference:** `redesign/payroll/statutory-perquisite.html`

### GAP-PAYROLL-STATUTORY-PERQUISITE-01  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1753 (merged): fail-silent EmptyState fixed so an outage no longer reads as no perquisites found.
- **First-pass claim:** A failed lookup reads as 'no data': a null result shows the badge (perquisite/page.tsx:62) but the card renders EmptyState 'No Form 12BA data — No perquisite data found for the given employee and FY' (page.tsx:84-89); there is no RefreshErrorState or retry, so an outage looks like an employee with no perquisites.
- **Verified evidence:** perquisite/page.tsx:62 does render DataSourceBadge with source 'error' (en.json perquisite.loadErrorMessage 'Couldn't load — showing nothing'), so the failure is not fully silent. But the Form 12BA card (page.tsx:84-89) keys only on `!form12ba`; fetchJson returns data=null for both a real empty/404 and any error (apiClient.ts fetchJson returns empty+source:'error'), so on error the card still shows EmptyState 'No Form 12BA data'. RefreshErrorState is not imported in this file (it is used in pt/page.tsx:61). Stat cards are simply hidden on error (page.tsx:64), not shown as 0.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Import RefreshErrorState and toHumanError (as pt/page.tsx does) and capture `result?.status` alongside `source` from getForm12BA.
  2. In the Form 12BA <Card> branch order: !canLookup -> select prompt; source==='error' && status!==404 -> <RefreshErrorState error={toHumanError('load',{area:t('errorArea')})} backHref='/hr/payroll/statutory' />; else !form12ba -> the 'No Form 12BA data' EmptyState.
  3. Keep DataSourceBadge but only for the error case; drop the duplicate empty state text when errored.
  4. Add a perquisite.loadErrorArea key (plain-language, e.g. 'Form 12BA') in en.json and hi.json so the area is not a raw token.
- **Acceptance:**
  - Component/page test: mock fetchJson -> {data:null, source:'error', status:500}; page renders RefreshErrorState with retry and does NOT render 'No Form 12BA data'.
  - Mock {data:null, source:'api'} (or 404) -> EmptyState 'No Form 12BA data' still renders.
  - Manual: stop the gateway, open /hr/payroll/statutory/perquisite?employeeId=X&fy=2026-27 -> retry card, click Retry after restart -> data appears.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Payroll/tax filing page: misreading an outage as 'employee has no perquisites' could lead to an under-reported Form 12BA.

### GAP-PAYROLL-STATUTORY-PERQUISITE-03  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** — verified NOT a bug via PR #1753: payroll-service consumer deliberately expects rupee floats under non-Minor field names and converts server-side (BigInt(Math.round(value*100))); the minor-unit rename the catalog suggested would have broken it. Left unchanged, confirmed correct.
- **First-pass claim:** Perquisite money is posted as float rupees: valueByEmployer: parseFloat(...) and amountRecovered (PerquisiteComponentForm.tsx:100-101) while Form 12BA reads paise (page.tsx:14-15,101); CLAUDE.md rule 11 wants minor units at the boundary (PT/LWF forms convert, this one does not).
- **Verified evidence:** PerquisiteComponentForm.tsx:77 validates parseFloat(valueByEmployer) and :100-101 POSTs valueByEmployer: parseFloat(...) and amountRecovered: parseFloat(...) as raw rupee floats (inputs step 0.01, labelled (₹)) to v1/payroll/statutory/perquisite-components. The read side treats taxableValueMinor/totalPerquisitesMinor as paise and formats with formatMoney (page.tsx:67,103,122). PtSlabForm.tsx:64-66 and LwfConfigForm.tsx:56-57 convert with Math.round(x*100). Server contract (payroll service) is NOT in the snapshot (no 'perquisite' anywhere in services/), so whether the endpoint expects rupees or paise cannot be verified; note LwfConfigForm also sends paise under un-suffixed field names, so the missing 'Minor' suffix is not proof of rupees. Line refs corrected: the observation's 100-101 is right in the file.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/PerquisiteComponentForm.tsx`, `apps/web/src/lib/formatters.ts (add rupeesToMinor helper if absent)`
- **Fix steps:**
  1. Confirm with the payroll service owner the unit for valueByEmployer/amountRecovered on POST perquisite-components (and ideally rename to valueByEmployerMinor/amountRecoveredMinor).
  2. Add a shared parseRupeesToMinor(str): string-based (split on '.', pad to 2 decimals, BigInt) instead of Math.round(parseFloat*100), and use it in this form (and later PtSlabForm/LwfConfigForm).
  3. Send the minor-unit integer (number if < 2^53, else string) in saveComponent(); also validate amountRecovered <= valueByEmployer in handleSubmit.
  4. Show the confirmation dialog amounts through formatMoney(minor) rather than the raw typed string (confirmDescription value/recovered).
- **Acceptance:**
  - Unit test parseRupeesToMinor: '1234.5'->123450, '0.1'->10, '0.29'->29 (no float drift), ''->undefined.
  - Component test: entering value 1500.50 posts body.valueByEmployerMinor (or agreed field) = 150050; recovered > value shows validation error and no POST.
  - Manual: save a component then reload the Form 12BA table: taxable value equals value minus recovered, displayed with correct rupee amount (not 100x off).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High if the server expects paise: perquisite values would be 100x understated in Form 12BA / TDS. Do not change the payload until the contract is confirmed.

### GAP-PAYROLL-STATUTORY-PERQUISITE-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** — PR #1753 (merged): new shared Masked PAN component; confirmed the raw PAN never reaches a Client Component boundary (Server Component only), so masking is real, not cosmetic.
- **First-pass claim:** PAN printed in full (employee.pan || panFlag, page.tsx:99) to every role that reaches the page — a DPDP-sensitive identifier with no mask/reveal.
- **Verified evidence:** perquisite/page.tsx:99 renders `form12ba.employee.pan || form12ba.employee.panFlag` in plain text; the /hr layout (hr/layout.tsx:32-47) admits employee and manager roles, and this page adds no role check. No masking helper for PAN exists in the web app (grep: only bank-account masking in salary-slips/[id]/page.tsx:72; no <Masked> component). Whether the server already returns a masked PAN is unknown (payroll service absent).
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/layout.tsx (new, role gate)`
- **Fix steps:**
  1. Create a shared <Masked value kind='pan'> that shows ABCDE****F by default; reveal only when the caller has a reveal role and click-to-reveal fires an audit call (endpoint to be defined with backend; do not invent one here).
  2. Use it at page.tsx:99 in place of the raw PAN; keep panFlag text when PAN absent.
  3. Add statutory/layout.tsx with requireAnyRole(payroll_admin, payroll_officer, hr_admin, super_admin...) so employee/manager cannot open Form 12BA lookups for arbitrary employeeId.
  4. Ask backend to return masked PAN by default and enforce ownership/role server-side.
- **Acceptance:**
  - Component test: <Masked value='ABCDE1234F' kind='pan'/> renders 'ABCDE****F' and not the full value in the DOM.
  - Manual: as employee role, /hr/payroll/statutory/perquisite redirects to /dashboard; as payroll_officer PAN is masked, reveal writes an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII (DPDP): PAN is fully exposed to any authenticated /hr role today; masking must not break the Form 12BA print/export workflow that may need the full PAN.
- **Depends on:** GAP-PAYROLL-STATUTORY-04

### GAP-PAYROLL-STATUTORY-PERQUISITE-05  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1753 (merged): raw id/FY entry replaced with EntityPicker plus an FY select.
- **First-pass claim:** Employee is a pasted raw ID in both forms (EmployeeFyLookup.tsx:39-50, PerquisiteComponentForm.tsx:121-135), FY is free text checked only for non-empty (EmployeeFyLookup.tsx:24; unlike returns/page.tsx:84 FY_RE): a typo posts a component to the wrong FY or returns 'no data'.
- **Verified evidence:** EmployeeFyLookup.tsx:39-50 is a free-text 'Employee ID' input (no validation beyond non-empty, :24); FY input :56-66 is free text checked only for non-empty; PerquisiteComponentForm.tsx:121-148 (file lines; 199-226 in a concatenated view) repeats both, and its employee/FY fields are editable independently of the lookup. returns/page.tsx:84 defines FY_RE = /^\d{4}-\d{2}$/ and validates. No EntityPicker exists in the repo (only SmartCombobox = recent-values text input); employees list loader is getEmployees() -> /api/v1/hrms/employees in app/_data/loaders.ts:1122.
- **Files to change:** `apps/web/src/app/_components/ds/EmployeePicker.tsx (new)`, `apps/web/src/lib/validators/fy.ts (new, shared FY_RE + isValidFy)`, `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/EmployeeFyLookup.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/PerquisiteComponentForm.tsx`, `apps/web/src/app/(app)/hr/payroll/returns/page.tsx`
- **Fix steps:**
  1. Extract FY_RE from returns/page.tsx into a shared isValidFy(fy) (also check end year = start+1) and use it in EmployeeFyLookup.handleSubmit and PerquisiteComponentForm.handleSubmit with an inline error.
  2. Replace FY text input with a <select> of recent FYs (current and previous few) defaulting to current FY.
  3. Build EmployeePicker (searchable combobox showing name + employee code, value = id) on top of the existing employees endpoint used by getEmployees; use it in both forms.
  4. Drop the second copy of employee/FY in PerquisiteComponentForm: take them from the lookup (props) and show them read-only.
- **Acceptance:**
  - Unit test isValidFy: '2026-27' true, '2026-28','26-27','2026' false.
  - Component test: submitting lookup with FY '2026' shows error and does not router.push.
  - Manual: pick an employee by name; URL contains the id, page header shows name, and a component saved goes to the selected FY.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: posting a perquisite to the wrong employee/FY corrupts Form 12BA and TDS; picker must respect the caller's employee visibility scope.

### GAP-PAYROLL-STATUTORY-PERQUISITE-06  ·  MEDIUM  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Form 12BA header is incomplete: employer{name,tan,pan} and assessmentYear are fetched (page.tsx:21-28) but only employee, PAN and total are shown (page.tsx:93-105). The form collects value and amount recovered but the table shows only taxableValueMinor, so the value−recovery arithmetic is invisible, and there is no edit or delete of a mistaken component.
- **Verified evidence:** Type Form12BAResponse (perquisite/page.tsx:17-27) fetches employer{name,tan,pan}, assessmentYear, note; the rendered block (page.tsx:91-127) shows only employee name, PAN, total, the 4-column table (Sl, Nature, Description, taxableValueMinor) and the note; employer and AY are never displayed. PerquisiteLine also has `value` (unused). The form collects value and recovered but the table shows only taxableValueMinor, so value-recovery is not visible. There is no edit/delete control in the page or in PerquisiteComponentForm (POST only); backend edit/delete endpoints are not visible (service absent). The theme 'PII' and its suggested fix (Masked) do not match this finding; note that displaying employer PAN/TAN would also be an ID-display decision. The stated line refs are correct.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add a header block in the Form 12BA card showing employer name, TAN, assessment year (form12ba.assessmentYear) and FY, using the existing employeeLabel/panLabel styling; employer PAN only via <Masked>.
  2. Confirm with payroll owner what `value` vs `taxableValueMinor` mean (the API also returns `value` in rupees?); if the API exposes value-by-employer and recovered, add columns and render via formatMoney; otherwise mark cannot-show.
  3. Add row actions Edit/Delete only after the backend exposes PATCH/DELETE for perquisite components (otherwise document 'add a negative/correcting component' workflow).
- **Acceptance:**
  - Page test with fixture containing employer{name:'X',tan:'DELX12345A'} and assessmentYear '2027-28' renders both strings.
  - Manual: the Form 12BA table shows value, recovered and taxable value where taxable = value - recovered for a saved component.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: Form 12BA is a statutory document; a header missing employer TAN/AY makes the on-screen record unusable as a filing reference.
- **Depends on:** GAP-PAYROLL-STATUTORY-PERQUISITE-04

### GAP-PAYROLL-STATUTORY-PERQUISITE-07  ·  LOW  ·  confirmed  ·  theme I18N (was OTHER)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Nature dropdown shows lower-case raw words ('gas electricity water', en.json perquisiteComponentForm.natureGasElectricityWater); the saved message interpolates the raw key gas_electricity_water (PerquisiteComponentForm.tsx:104); the taxable table is a hand-rolled <table> without sort/filter or mobile stacking (page.tsx:106-125).
- **Verified evidence:** PerquisiteComponentForm.tsx:21-32 maps each nature to a message key; en.json perquisiteComponentForm.natureGasElectricityWater = 'gas electricity water' (and other lower-case labels at 3469-3478). saveComponent() sets t('savedMessage', { nature, employeeId }) (file line ~107) with the raw key `nature` (e.g. 'gas_electricity_water'); the confirm dialog also interpolates raw `nature` (rich() calls). The comment in the file (lines 14-20) says this was left deliberately. The table is a hand-rolled <table> (page.tsx:106-126), rendering p.nature raw from the API (page.tsx:120), no sort/filter/mobile stacking. Observation's :104 is off (~107).
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/PerquisiteComponentForm.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/perquisite/page.tsx`
- **Fix steps:**
  1. Sentence-case the nature labels in en.json (e.g. 'Gas, electricity and water', 'Club membership') and mirror in hi.json.
  2. In saveComponent and both ConfirmDialog rich() calls pass nature: t(NATURE_LABEL_KEYS[nature]) instead of the raw key.
  3. In perquisite/page.tsx map p.nature through the same label map (extract NATURE_LABEL_KEYS into a shared file, fall back to the raw string for unknown values).
  4. Replace the hand-rolled table with the ds DataTable (columns Sl, Nature, Description, Taxable Value cellType 'amount') for sorting and responsive behaviour.
- **Acceptance:**
  - Component test: after saving nature gas_electricity_water the status message contains 'Gas, electricity and water' and no underscore.
  - Snapshot test of the Form 12BA table: nature column shows the label; at 375px width the table does not overflow horizontally.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; copy and display only. Keep API nature values unchanged.


---
## /hr/payroll/statutory/pf  —  `payroll/statutory-pf.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/pf/page.tsx`
- **Design reference:** `redesign/payroll/statutory-pf.html`

### GAP-PAYROLL-STATUTORY-PF-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Ledger totals sum every period returned (pf/page.tsx:32-34) and are labelled 'Total PF Outflow'; no month filter although PF is filed and paid per month.
- **Verified evidence:** pf/page.tsx:33-35 reduce over all rows returned by GET /api/v1/payroll/statutory/pf (no period parameter, :19) to compute total employee, employer and 'Total PF Outflow' (en.json pf.statTotalPfOutflow, page.tsx:57). The DataTable filter is free text only; there is no month/period selector. Whether the API paginates or returns all history cannot be verified (payroll service absent). The 'Outflow' also omits EPS/EDLIS/admin charges since only emp+er contributions are summed. Theme I18N is wrong; this is an aggregation/correctness issue.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pf/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Accept searchParams.period (YYYY-MM, validated with the shared month regex) in PfStatutoryPage and default it to the latest period present in rows.
  2. Filter rows to the selected period before computing the three totals and pass the filtered rows to DataTable; render a period <select> populated from distinct r.period values.
  3. Relabel stat cards with the period (e.g. 'Total employee contribution — Aug 2026') and rename 'Total PF Outflow' to 'Total EPF contribution (employee + employer)'.
  4. If the API supports a period filter, pass it in getData() instead of filtering client-side (confirm with backend).
- **Acceptance:**
  - Unit test: rows across two periods, period=2026-08 sums only that month's contributions.
  - Manual: with 3 months of data, changing the period selector changes the three stat tiles and the table; default shows latest month only.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: a multi-month total shown as 'PF outflow' could be paid/filed as one month's challan amount.

### GAP-PAYROLL-STATUTORY-PF-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Employee column prints the raw employeeId (pf/page.tsx:38); the shared StatutoryRow type already carries an optional employeeName (_data/loaders.ts:4450) but this page does not use it.
- **Verified evidence:** pf/page.tsx:38 uses { key: 'employeeId', label: t('colEmployee') } so the raw id is shown; PfRow (page.tsx:9-16) has no employeeName. Shared StatutoryRow in apps/web/src/app/_data/loaders.ts:4450 has employeeName?: string | null, and payroll/gpf/page.tsx uses employeeName/employeeCode. Whether /statutory/pf populates employeeName cannot be verified (service absent); the gpf sibling uses the same endpoint family.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/esi/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/gpf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/nps/page.tsx`
- **Fix steps:**
  1. Add employeeName?: string | null and employeeCode?: string to PfRow (or reuse StatutoryRow from loaders.ts).
  2. Change the Employee column to a `render` returning name + code with employeeId as fallback, e.g. row.employeeName ?? row.employeeCode ?? row.employeeId.
  3. If the API does not return names, ask backend to add employeeName/employeeCode to the statutory list response, or join through the employees loader server-side.
  4. Apply the same column fix on esi/gpf/nps statutory pages that share the pattern.
- **Acceptance:**
  - Component test: row {employeeId:'uuid', employeeName:'A Kumar'} renders 'A Kumar' and not the uuid; row without name falls back gracefully.
  - Manual: PF ledger table shows employee names.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Ensure name disclosure stays within the same roles that see the ledger.

### GAP-PAYROLL-STATUTORY-PF-05  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** Rates '(12%)' are hard-coded into column labels (en.json pf.colEmployeePf/colEmployerPf) while rows come from data; and the ECR month input starts empty with no default or 'payroll not yet finalised' check (EcrGeneratorForm.tsx:14).
- **Verified evidence:** en.json pf.colEmployeePf = 'Employee PF (12%)' and colEmployerPf = 'Employer PF (12%)' (lines ~3502-3503) are hard-coded in the label while amounts come from the API (pf/page.tsx:41-42); employer 12% is really split EPF 3.67% + EPS 8.33% so the label is a simplification. EcrGeneratorForm.tsx:12 initialises month with useState('') (observation cites :14); it only checks MONTH_RE (:8,:27) before download; there is no default or 'payroll not finalised' pre-check (server error is shown via generic errorMessageFromResponse). Theme FABRICATED is wrong: nothing is fabricated, rows are real.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/payroll/statutory/pf/EcrGeneratorForm.tsx`
- **Fix steps:**
  1. Remove '(12%)' from colEmployeePf/colEmployerPf (or show the actual contribution rate per row if the API returns one).
  2. Default the month state in EcrGeneratorForm to the previous calendar month (YYYY-MM) since ECR is filed after the month closes.
  3. Add max attribute = current month on the <input type='month'> and surface a specific server rejection (e.g. payroll not finalised) once backend returns a distinguishable error.
- **Acceptance:**
  - Snapshot test: PF table headers read 'Employee PF' and 'Employer PF'.
  - Component test: on first render the month input value equals previous month; choosing a future month is blocked.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-STATUTORY-PF-06  ·  LOW  ·  confirmed  ·  theme I18N (was OTHER)

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** RefreshErrorState area is the bare token 'pf' → "We couldn't load pf." (pf/page.tsx:65).
- **Verified evidence:** pf/page.tsx:65 passes toHumanError('load', { area: 'pf' }), which produces 'We couldn't load pf.' (messages.ts toHumanError 'load' -> `We couldn't load ${thing}.`). Same bare token in pt/page.tsx:61 ('pt'). The area is not translated.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pf/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add pf.loadErrorArea ('PF contributions') and pt.loadErrorArea ('professional tax slabs') keys in en.json/hi.json.
  2. Pass area: t('loadErrorArea') to toHumanError in both pages.
  3. Grep the statutory folder for other bare-token areas (esi, lwf, gpf, nps) and fix in the same change.
- **Acceptance:**
  - Page test with source:'error' renders 'We couldn't load PF contributions.'
  - No area value in the statutory pages is a bare 2-3 letter token.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /hr/payroll/statutory/pt  —  `payroll/statutory-pt.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`
- **Design reference:** `redesign/payroll/statutory-pt.html`

### GAP-PAYROLL-STATUTORY-PT-02  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** 'No upper bound' is stored as the sentinel 999999999999 paise (PtSlabForm.tsx:65) and the read table formats it as money: 'Slab To' renders ₹9,99,99,99,999.99 (pt/page.tsx:37, cellType amount).
- **Verified evidence:** PtSlabForm.tsx:65 sets toMinor = 999999999999 when the 'Slab To' field is blank. pt/page.tsx:37 renders slab_to_minor with cellType 'amount' -> DataTable.cellValue -> formatMoney, so the row shows ₹9,99,99,99,999.99. The confirm dialog does handle the sentinel via slabToDisplay (PtSlabForm.tsx:87), but the history table does not. Whether the server stores/returns the same sentinel (or null) is not verifiable, but the table displays whatever value arrives.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/pt/PtSlabForm.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Export a PT_NO_UPPER_BOUND_MINOR = 999_999_999_999 constant (shared by form and page) and use it at PtSlabForm.tsx:65.
  2. In pt/page.tsx replace the slab_to_minor column's cellType:'amount' by a `render` that returns t('noUpperBound') (form key ptSlabForm.noUpperBound, move/duplicate to the pt namespace) when Number(value) >= PT_NO_UPPER_BOUND_MINOR, else formatMoney(value).
  3. Also treat null/undefined slab_to_minor as 'No upper bound'.
  4. Ask backend to accept null for an open-ended slab so the sentinel can be retired.
- **Acceptance:**
  - Component test: row with slab_to_minor 999999999999 shows 'No upper bound', row with 1500000 shows '₹15,000.00'.
  - Manual: add a slab with blank Slab To -> history table shows 'No upper bound'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only. Do not change the stored sentinel without backend agreement (PT engine may compare against it).

### GAP-PAYROLL-STATUTORY-PT-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1850 (merged): via #1835 in #1850
- **First-pass claim:** No client validation of slab logic: slab-from < slab-to, overlaps and gaps are not checked (PtSlabForm.tsx:41-55); state code is free text capped at 4 chars and upper-cased (PtSlabForm.tsx:68,103) instead of a state list; no effective-from date, so a change cannot be dated.
- **Verified evidence:** PtSlabForm.handleSubmit (lines 37-58) only checks stateCode non-empty and ptAmount numeric >= 0; it never checks slabFrom < slabTo, overlaps against existing rows (the page has them but does not pass them), or gaps. State code is a free text input maxLength={4} (:103) upper-cased at save (:70). Payload {stateCode, ptSlabs:[{fromMinor,toMinor,taxMinor}]} (:67-73) has no effective-from date. Also unknown: whether the endpoint appends or replaces a state's slabs (service absent) - a replace semantic would wipe other slabs on each single-slab POST.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pt/PtSlabForm.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`, `apps/web/src/lib/schemas/ptSlab.ts (new zod schema)`, `apps/web/src/lib/india/states.ts (new state-code list)`
- **Fix steps:**
  1. Create a zod schema ptSlabInput (stateCode enum from an Indian states/UT list, fromMinor, toMinor nullable, taxMinor, effectiveFrom date) and parse in handleSubmit; map issues to invalidField and focus.
  2. Pass existing rows for the state from pt/page.tsx into PtSlabForm and reject from>=to, overlap and (warn on) gaps against them.
  3. Replace the 4-char text input with a <select> of state codes.
  4. Add an Effective from date input (default today) and send it once backend supports the field (needs backend); disable submit while busy (already) and until valid.
  5. Confirm append vs replace semantics with backend and show existing state slabs in the confirm dialog.
- **Acceptance:**
  - Unit tests on the schema: from 100 to 50 rejected; slab 0-25000 then 20000-40000 rejected as overlap; unknown state 'ZZ' rejected.
  - Component test: invalid combination shows inline error, no POST fired; valid one opens the confirm dialog.
  - Manual: adding a second slab for KA does not delete the first.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High business risk: a wrong or overlapping PT slab changes statutory deductions for every employee in the state; undated changes cannot be audited or backdated.
- **Depends on:** GAP-PAYROLL-STATUTORY-PT-02

### GAP-PAYROLL-STATUTORY-PT-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1751 (merged)
- **First-pass claim:** 'Highest PT Amount' and 'Avg PT per Slab' (pt/page.tsx:31-32,131) average across slabs of different states including ₹0 slabs — a number with no compliance meaning. The hub card shows PT as a flat 2.5% employee rate (statutory/page.tsx:33-39), contradicting a slab-based table.
- **Verified evidence:** pt/page.tsx:31-32 compute maxPtMinor and avgPtMinor (mean of pt_amount_minor across ALL slabs of ALL states, including zero-rate slabs); they are shown as StatCards 'Highest PT Amount' and 'Avg PT per Slab' at :52-53 (observation's :131 does not exist; file is 79 lines). The hub statutory/page.tsx:31-39 hard-codes PT as empPct 2.5, erPct 0, no ceiling, while the PT page is a slab table (state-rules ptSlabs). Both claims are true.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Remove the 'Avg PT per Slab' StatCard and the avgPtMinor computation; replace with a meaningful tile such as 'Slabs with nil PT' or leave three tiles.
  2. Scope 'Highest PT Amount' per state (add a state filter) or relabel it 'Highest slab amount (any state)'; use formatMoney on the integer.
  3. On the hub, stop presenting PT as a flat 2.5% (see GAP-PAYROLL-STATUTORY-01): show 'State slabs' with a link to /hr/payroll/statutory/pt.
- **Acceptance:**
  - Snapshot: PT page no longer shows 'Avg PT per Slab'.
  - Hub PT card does not show '2.5%'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; the misleading metric is display only.
- **Depends on:** GAP-PAYROLL-STATUTORY-01

### GAP-PAYROLL-STATUTORY-PT-06  ·  LOW  ·  confirmed  ·  theme OTHER (was FAILMASK)

- [x] **Status** — PR #1828 (merged)
- **First-pass claim:** A failed save shows a generic message regardless of a 400 (e.g. overlapping slab) or 403 (browserClient.ts:57-72); area token 'pt' reads "We couldn't load pt." (pt/page.tsx:61).
- **Verified evidence:** PtSlabForm.saveSlab (:60-85) calls browserJson, which throws new Error(await errorMessageFromResponse(res)) (browserClient.ts:67-70). errorMessageFromResponse (browserClient.ts:57-66) deliberately ignores the response body (UX-020) and returns toHumanError('save' unless 404, {area: undefined}) text: 'We couldn't save your information. Nothing was changed...' for 400, 403, 409 alike. The catch at PtSlabForm.tsx:80-81 shows it as the dialog error. And pt/page.tsx:61 passes area:'pt' -> 'We couldn't load pt.' (same as GAP-PF-06). Note the load path DOES use RefreshErrorState, so the FAILMASK tag is wrong for it.
- **Files to change:** `apps/web/src/lib/api/browserClient.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/app/(app)/hr/payroll/statutory/pt/PtSlabForm.tsx`, `apps/web/src/app/(app)/hr/payroll/statutory/pt/page.tsx`
- **Fix steps:**
  1. Extend errorMessageFromResponse to map status classes to fixed catalogue strings (403 -> 'You don't have permission to change this', 400/422 -> 'Some values were not accepted - check the highlighted fields', 409 -> 'This overlaps an existing record') without echoing backend text.
  2. Pass area: t('saveArea') from PtSlabForm (browserJson second param or optional init argument) so the message reads 'your professional tax slab'.
  3. Set area: t('loadErrorArea') on pt/page.tsx:61 (see PF-06).
- **Acceptance:**
  - Unit test: errorMessageFromResponse(new Response(null,{status:403})) contains 'permission'; status 400 contains 'not accepted'; neither contains backend text.
  - Manual: POST an overlapping slab -> dialog error says it overlaps instead of generic save failure.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; must keep the UX-020 rule of never leaking raw server text.
- **Depends on:** GAP-PAYROLL-STATUTORY-PF-06


---
## /hr/payroll/structures  —  `payroll/structures.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/structures/page.tsx`
- **Design reference:** `redesign/payroll/structures.html`

### GAP-PAYROLL-STRUCTURES-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE (was OTHER)

- [x] **Status** — PR #1755 (merged)
- **First-pass claim:** The “Active” switch in the Component Grid is local React state only: enabled initialises to true for every component regardless of any API flag and toggling calls setEnabled with no request (ComponentGrid.tsx:190–195,317; no fetch/browserJson in the file). It looks like enabling/disabling a payroll component but persists nothing and resets on reload.
- **Verified evidence:** ComponentGrid.tsx:190-194 initialises `enabled` to true for every component id, and the switch's onClick (:317) only calls setEnabled; there is no fetch/browserJson import in the file and ComponentRow (:6-13) has no active/status field from the API. The role='switch' button (:312-317) dims the row (opacity, :281) and reads as a real toggle but nothing persists and it resets on reload (and router.refresh).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/structures/ComponentGrid.tsx`, `apps/web/src/app/(app)/hr/payroll/structures/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Immediately: remove the toggle column (or render a read-only status pill) until a persistence endpoint exists; do not fake it.
  2. With backend: expose isActive on GET /api/v1/payroll/components and a PATCH to change it (audited); add isActive to ComponentRow in page.tsx and drive the switch from it.
  3. When enabled, gate the switch by payroll admin role, call browserJson PATCH inside a ConfirmDialog (impact: affects future payroll runs), and router.refresh() on success with rollback on error.
- **Acceptance:**
  - Test: no switch is rendered (interim), or toggling issues exactly one PATCH and the state survives reload.
  - Manual: disabling a component then reloading shows the persisted state; audit event recorded.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: users may believe a payroll component is disabled when it is not (money/statutory impact on the next run).

### GAP-PAYROLL-STRUCTURES-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was I18N)

- [x] **Status** — PR #1755 (merged)
- **First-pass claim:** Applicable Pay Levels are guessed from the structure NAME by substring (SalaryStructureCard.tsx:24–58) and presented as data; “level 1” (line 26) also matches “Level 10/11/12”, so a “Director — Level 10” structure is labelled MTS / Helper; unmatched names default to all five bands.
- **Verified evidence:** SalaryStructureCard.tsx:24-58 inferPayBands() derives 'Applicable Pay Levels' from substring matches on the structure name and renders them (:186-205) under the label 'Applicable Pay Levels'. The first branch tests lower.includes('level 1') (:26), which also matches 'level 10', 'level 11', 'level 12', so 'Director - Level 10' returns ['MTS','Helper'] before the director branch (:41) is reached; ':41' also includes 'level 10/11' but is unreachable for those. Unmatched names fall to the default five bands (:57). Nothing in the API data (Row has only id,name,isDefault,status) backs this.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/structures/SalaryStructureCard.tsx`, `apps/web/src/app/(app)/hr/payroll/structures/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Remove inferPayBands and the 'Applicable Pay Levels' block, or render it only from an explicit payLevels/applicableLevels field on the structure once the API provides one.
  2. If kept short-term, use a word-boundary regex (/\blevel\s*1\b/) and show 'Not specified' when nothing matches instead of defaulting to five bands, and label it 'Inferred from name'.
  3. Ask backend to add payLevels to the structure response and the create form.
- **Acceptance:**
  - Unit test: name 'Director - Level 10' does not yield MTS/Helper; unmatched name yields 'Not specified', not five bands.
  - Manual: card shows bands only when the structure record carries them.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: mislabelling which staff a pay structure applies to can lead to wrong structure assignment.

### GAP-PAYROLL-STRUCTURES-03  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Taxability is derived from component-code substrings (ComponentGrid.tsx:22–37), overriding the API’s isTaxable except as a fallback: any code containing HRA/LTA/TA/NPS/GPF/PF is hard-labelled Exempt or Partially Exempt, and “TA” substring-matches unrelated codes. Formula text is likewise a code-prefix lookup with hard-coded rates (en.json componentGrid.formulaDa “currently 46%”, formulaHra 27/18/9).
- **Verified evidence:** ComponentGrid.tsx:22-33 getTaxability() ignores the API isTaxable for any code containing HRA, LTA/LTC, MEDICAL, 'TA' (!), TRANSPORT, NPS, GPF, PF, EPF, GRATUITY, DA, DEARNESS, BASIC and uses isTaxable only as the final fallback (:32). includes('TA') matches unrelated codes such as DEPUTATION_ALLOWANCE or DATA_ENTRY; 'DA' matches any code containing 'DA'. The tooltip formula text is a code-substring lookup (COMPONENT_FORMULA_KEYS :39-63) into en.json componentGrid.formula* with hard-coded figures: formulaDa 'currently 46%' (en.json:5479, stale DA), formulaHra 27/18/9 (:5480), TA slab ₹1,350-₹7,200, medical ₹500, etc. These are presented as system facts with no source or date.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/structures/ComponentGrid.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/payroll/structures/page.tsx`
- **Fix steps:**
  1. Make the badge come from the API: Taxable when isTaxable, Exempt when not; drop getTaxability's substring overrides (or move partial-exemption to an explicit API field, e.g. exemptionType).
  2. Remove hard-coded rates from formula strings (no 'currently 46%', no 27/18/9) or show the formula only when the API returns it; otherwise show 'Formula not configured'.
  3. Match component codes exactly against a known code table (equality, not includes) if any static hint is kept, and label it 'General guidance, not the configured rule'.
- **Acceptance:**
  - Unit test: code 'DEPUTATION_ALLOWANCE' with isTaxable=true renders Taxable; 'HRA' with isTaxable=true renders per API.
  - Snapshot: no tooltip contains a percentage or rupee figure unless it came from the API.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High: a wrong tax-exempt label on a component can mislead payroll admins into mis-configuring TDS; DA rate text is out of date.

### GAP-PAYROLL-STRUCTURES-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED (was OTHER)

- [x] **Status** — PR #1755 (merged)
- **First-pass claim:** Donut is headed “% of Gross” (SalaryStructureCard.tsx:150) but its values are component COUNTS by type (buildChartData, lines 60–76) — the chart says nothing about share of gross pay.
- **Verified evidence:** SalaryStructureCard.tsx:150 renders t('pctOfGrossLabel') = '% of Gross' (en.json:5498) above <Chart type='donut' data={chartData}>; buildChartData (:60-76) sets value = number of components per type (earnings/deductions/employer/other) with count labels. Component rows carry no amounts (ComponentRow in structures/page.tsx:17-24), so no share of gross can be computed on this page.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/structures/SalaryStructureCard.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Rename the key pctOfGrossLabel to 'Components by type' (label text and key, e.g. componentsByTypeLabel).
  2. Ensure the donut tooltip/legend shows counts, not percent of gross (chart labels already have '(n)').
  3. Only reintroduce a '% of gross' chart if the structure API supplies amounts/percentages per component.
- **Acceptance:**
  - Snapshot: chart heading reads 'Components by type'.
  - Grep: no '% of Gross' string remains for count-based charts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PAYROLL-STRUCTURES-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Structures and components fetches are independent with no DataSourceBadge (page.tsx:52–55): a components failure shows “—” on one tile and an empty-looking grid (“No components yet”); creating a structure is async (CreateStructureForm submittedWithIdMessage) so it does not appear immediately. No page-level role gate on a screen that defines pay rules (hr/layout.tsx:26–42).
- **Verified evidence:** structures/page.tsx:48-55 fetches structures and components in parallel and tracks source separately. structuresErrored shows RefreshErrorState (:83-88), but componentsErrored only changes the stat tile to '—' (:78); ComponentGrid still receives rawComponents=[] (:121-130) and renders emptyTitle 'No components yet' (ComponentGrid.tsx:204-219) with 'Components are added when...' copy, and each SalaryStructureCard shows 'no components configured yet'. No DataSourceBadge is imported in page.tsx. CreateStructureForm.tsx:52-64 returns an accepted id (async) and shows submittedWithIdMessage, so a new structure may not appear after router.refresh(). Role gate: hr/layout.tsx:32-47 (not 26-42) admits manager/employee and no structures-level gate exists.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/structures/page.tsx`, `apps/web/src/app/(app)/hr/payroll/structures/SalaryStructureCard.tsx`, `apps/web/src/app/(app)/hr/payroll/structures/layout.tsx (new, role gate)`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. In page.tsx wrap the Component Grid card: if componentsErrored render <RefreshErrorState error={toHumanError('load',{area:t('componentsArea')})} backHref='/hr/payroll'/> instead of <ComponentGrid>.
  2. Pass a componentsUnavailable flag to SalaryStructureCard so it shows 'Components unavailable' instead of 'No components configured yet'.
  3. Add <DataSourceBadge> for each source (or one that reflects either error).
  4. Add structures/layout.tsx (or payroll-level layout) with requireAnyRole for payroll admin roles; in CreateStructureForm show a 'processing' hint and poll/refresh once because creation is async.
- **Acceptance:**
  - Page test: components source 'error' -> RefreshErrorState in the grid card, structure cards do not claim 'no components'.
  - Test: role 'employee' is redirected from /hr/payroll/structures.
  - Manual: create a structure -> message says it is being processed; after refresh it appears.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: an outage on components looking like an empty configuration could prompt admins to recreate structures/components.
- **Depends on:** GAP-PAYROLL-STATUTORY-04


---
## /hr/payroll/tax-config  —  `payroll/tax-config.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`
- **Design reference:** `redesign/payroll/tax-config.html`

### GAP-PAYROLL-TAX-CONFIG-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1753 (merged): page reframed as an informational reference; removed the false applied-automatically claim.
- **First-pass claim:** Statutory rates are typed into the page: every slab boundary, rate and limit is a string literal (page.tsx:27-75) and the footer tells admins to change the "slab configuration in the payroll engine" (page.tsx:79, en.json footerNote). Nothing links the sheet to the engine, so the "reference" can drift from what payroll actually deducts, and it cannot be versioned per FY.
- **Verified evidence:** tax-config/page.tsx has no fetch at all; slab rows and limits are string literals (page.tsx:27-32,42-45,55-60,69-71) plus en.json payrollTaxConfig.* strings (3362-3401). The footer (page.tsx:79, en.json footerNote) says 'FY {fy} slabs are active. To update tax slabs ... modify the slab configuration in the payroll engine. The rates above are applied automatically'. Nothing links the sheet to the engine and there is no per-FY versioning. Whether the engine actually matches cannot be verified (payroll engine absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Short term: retitle as 'Income tax reference (informational)', remove the claim that the rates are 'applied automatically' and show a 'Reference as of <date>, FY <fy>' stamp with a named owner/source.
  2. Medium term (needs backend): fetch the active slab set for the FY from the payroll engine's configuration endpoint via fetchJson, render from data, and show DataSourceBadge/RefreshErrorState on failure.
  3. Support a regime x FY selector so multiple financial years can be viewed.
- **Acceptance:**
  - Manual: page no longer claims the shown slabs are what payroll applies unless read from the engine.
  - Test: with a mocked config response for FY 2025-26 the page renders those slabs and, on error, RefreshErrorState instead of stale literals.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High: admins and employees may rely on a hard-coded sheet that differs from the TDS actually deducted.

### GAP-PAYROLL-TAX-CONFIG-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was MONEY)

- [x] **Status** — PR #1753 (merged): removed the date-derived active claim entirely (confirmed zero new Date()/FY-active logic remains in the file), so the stale-FY-figures risk this raised no longer applies.
- **First-pass claim:** Footer asserts "FY {fy} slabs are active" using the current FY (2026-27 today, page.tsx:5-12,79) while the card is titled "Default from FY 2024-25" and the 87A note says rebate up to ₹7L taxable income. These are the FY 2024-25 new-regime figures; the Finance Act 2025 revised the new-regime slabs and rebate limit for FY 2025-26 onward. Needs verification by the payroll/tax owner against the engine — the page can currently show a wrong "active" claim for the FY it names.
- **Verified evidence:** getCurrentFY() (page.tsx:5-12) yields '2026-27' at today's date and feeds footerNote (page.tsx:79): 'FY 2026-27 slabs are active'. The new-regime card is titled 'Default from FY 2024-25' (en.json:3366) and its slabs (0-3L nil, 3-7 5%, 7-10 10%, 10-12 15%, 12-15 20%, >15 30%, page.tsx:27-32) with note 'Rebate u/s 87A up to ₹7L' (en.json:3380) are the FY 2024-25 (Budget July 2024) new-regime figures. To my knowledge the Finance Act 2025 changed the new-regime slabs and the 87A rebate (to 12L taxable) from FY 2025-26; the tax owner must verify against the engine and any Budget 2026 change. The page therefore contradicts itself and probably states a wrong 'active' claim.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Immediately remove the 'FY {fy} slabs are active' assertion; state instead 'Reference slabs shown are for FY 2024-25; confirm current-year rates in the payroll engine'.
  2. Have payroll/tax owner confirm and update the literals per FY (or, better, move to data per GAP-01) with an explicit effective-FY label on each card.
  3. Stop deriving the FY claim from the current date; derive it from the config version being displayed.
- **Acceptance:**
  - Snapshot: footer no longer says 'FY 2026-27 slabs are active' while the card is FY 2024-25.
  - Sign-off from the tax owner that shown slabs equal the engine's for the FY named on the card.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** High: wrong tax slabs on an HR admin reference screen for a Govt payroll can drive incorrect TDS decisions or employee disputes.
- **Depends on:** GAP-PAYROLL-TAX-CONFIG-01

### GAP-PAYROLL-TAX-CONFIG-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED (was MONEY)

- [x] **Status** — PR #1824 (merged)
- **First-pass claim:** Surcharge table is incomplete for a Govt. employee tax sheet: only three rows and a single "Above ₹2Cr 25%" (page.tsx:69-71); it omits the higher old-regime surcharge tiers and does not say the new regime is capped, nor marginal relief. Also no 87A rebate row for the old regime. Verify with tax counsel.
- **Verified evidence:** Surcharge card (page.tsx:65-75) has three rows: ₹50L-₹1Cr 10%, ₹1Cr-₹2Cr 15%, above ₹2Cr 25% (en.json:3397,3391); it omits the >₹5Cr old-regime tier (37%), does not state that the new regime caps surcharge at 25%, and does not mention marginal relief. The old-regime card (page.tsx:38-49) has no 87A rebate row (old regime: rebate up to ₹5L taxable income) - its note en.json:3383 lists only deductions. Accuracy of these tax rules should be confirmed by tax counsel, as the observation says.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add rows/notes to the surcharge card: ₹2Cr-₹5Cr 25% and >₹5Cr 37% (old regime), 'New regime surcharge capped at 25%', and 'Marginal relief applies'.
  2. Add an old-regime 87A rebate line (taxable income up to ₹5,00,000) to oldRegimeNote or a dedicated row.
  3. Have tax counsel/payroll owner review the wording before release.
- **Acceptance:**
  - Snapshot shows five surcharge tiers/notes incl. 37% and new-regime cap.
  - Tax owner sign-off recorded on the PR.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Medium: incomplete surcharge information for senior officers may cause wrong tax expectations.
- **Depends on:** GAP-PAYROLL-TAX-CONFIG-01

### GAP-PAYROLL-TAX-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** — PR #1753 (merged): page reframed as read-only informational reference rather than implying live configurability it does not have; no edit/audit-trail feature was built (none existed to begin with).
- **First-pass claim:** Read-only despite the title "Configuration": no edit, no audit trail, no effective dating (CLAUDE.md: every mutation audited). Any admin change happens outside the product, so the UI cannot show who changed a slab or when.
- **Verified evidence:** The page is read-only (tax-config/page.tsx has no form, fetch or mutation), while titled 'Income Tax Configuration' (en.json:3363) with subtitle 'TDS slabs and deduction limits used by the payroll engine'; the footer tells admins to edit the engine elsewhere. That is true. But the 'no audit trail' point does not apply to this UI: there is no mutation here, so CLAUDE.md's audit-event rule is not violated; audit/effective-dating belongs to whatever service holds the slab configuration (not in the snapshot). Theme DEADROUTE is wrong - there is no dead link.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`
- **Fix steps:**
  1. Decide product intent: if the screen stays informational, rename it (title 'Income Tax Reference', hub tile 'Tax Reference') so it is not read as an editable configuration.
  2. If admin editing is required, specify a backend endpoint with effective-from dating and audit event (tax.slab.changed) first, then build a form using the ConfirmDialog+browserJson pattern used by PtSlabForm.
  3. Show 'Last updated by/at' from the config record once it exists.
- **Acceptance:**
  - Decision recorded (informational vs editable).
  - If informational: no string on the page or hub implies the user can configure slabs here.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for renaming; high for adding an editor (tax slabs are payroll-critical, need dual approval + audit).
- **Depends on:** GAP-PAYROLL-TAX-CONFIG-01

### GAP-PAYROLL-TAX-CONFIG-05  ·  LOW  ·  confirmed  ·  theme OTHER (was MONEY)

- [x] **Status** — PR #1753 (merged): fixed the global .g-2 CSS class for mobile behavior (confirmed safe on ~20 other pages using it, spot-checked 3).
- **First-pass claim:** try { await getTranslations…; return … } catch → RefreshErrorState (page.tsx:15,83-88) can only trigger on an i18n failure; a real fetch failure state does not exist because there is no fetch. ₹ literals bypass formatMoney/formatRupees, and the two-column grid class g-2 has no stated mobile behaviour.
- **Verified evidence:** tax-config/page.tsx:15 opens a try that wraps only getTranslations and JSX; the catch (:83-88) renders RefreshErrorState, which can only fire on an i18n/render failure - there is no fetch so no data-failure state exists. Rupee amounts are string literals (page.tsx:28-31,43-44,55,57-59, en.json) not routed through formatMoney/formatRupees. The layout uses `grid g-2` (page.tsx:22); civitas-ds.css:103 defines .g-2 as repeat(2,1fr) and no media query collapses it (only .g-4 and .g-3/.g-main do, css:106), so at phone width the four tables squeeze into two columns.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Add `.g-2` to the responsive rule: @media(max-width:1080px){... .g-2{grid-template-columns:1fr}} in civitas-ds.css (fixes every page using g-2).
  2. Wrap each <table className='tbl'> in a scroll container (overflow-x:auto).
  3. When slabs move to data (GAP-01), format amounts with formatMoney from lib/formatters; remove the render-only try/catch or replace with a real fetch error state.
- **Acceptance:**
  - Visual check at 375px: cards stack in one column and tables scroll without page-level horizontal scroll.
  - Grep: no other page relies on g-2 staying two-column on mobile without review.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; the .g-2 CSS change is global so spot-check other pages using it.
- **Depends on:** GAP-PAYROLL-TAX-CONFIG-01


---
## /hr/payroll/tax-declaration  —  `payroll/tax-declaration.html`

- **Source:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/page.tsx`
- **Design reference:** `redesign/payroll/tax-declaration.html`

### GAP-PAYROLL-TAX-DECLARATION-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1744 (merged): Submit now disabled while load fails, with Retry; confirmed backend returns 200+null (not 404) for first-time filers, so this does not block new declarations.
- **First-pass claim:** Data-destroying save path: on a failed load the form shows a warning that "blank amounts will overwrite previous values if you save" yet leaves Submit enabled with empty fields (TaxDeclarationForm.tsx:70,133-139,271-275). One click wipes a previously filed declaration; no confirmation and the warning is easy to miss above the form.
- **Verified evidence:** TaxDeclarationForm.tsx:56-72 (load; sets loadFailed on !res.ok or non-abort exception), 133-139 (role=alert banner with hard-coded #f85149; en.json taxDeclarationForm.loadFailedWarning says blank amounts overwrite), 271-275 (Button disabled={busy} only). handleSubmit (83-118) POSTs toPaise('')=0 for section80c/80d/otherDeductions/rentPaidMinor, so a failed load followed by Submit sends zeros for four required fields (optional three go undefined). No confirmation. NOTE the suggested fix (reason, maker!=checker) does not fit: this is an employee self-declaration, not an approval.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. In TaxDeclarationForm extract load() into a useCallback so it can be re-run; add a Retry button inside the loadFailed banner that calls it (setLoading(true), setLoadFailed(false)).
  2. Disable the submit Button while loadFailed is true (disabled={busy || loadFailed}) so a blank form cannot be saved over an unread declaration.
  3. Optionally allow 'Start fresh' via the existing <ConfirmDialog> (ds) with copy 'This replaces your saved declaration for FY {fy}' - only if product wants first-time filers to proceed when GET fails.
  4. Distinguish 'no declaration yet' from 'failed': treat 404/empty body as not-failed (verify the GET contract with payroll owner first).
  5. Replace the inline border colour with var(--bad) / an existing alert class; add i18n keys retryBtn and startFreshConfirm to en.json and hi.json.
- **Acceptance:**
  - Component test: mock fetch to reject/500, render form; submit button is disabled and a Retry button is visible; fetch POST is never called.
  - Component test: Retry with a 200 response prefills fields and re-enables submit.
  - Manual: with API down, filed declaration cannot be overwritten from this screen.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; behaviour change only on failed load. Risk of blocking first-time filers if the GET returns 404 for 'none yet' - confirm contract first.
- **Depends on:** GAP-PAYROLL-TAX-DECLARATION-03

### GAP-PAYROLL-TAX-DECLARATION-02  ·  HIGH  ·  partly  ·  theme COPY (was MONEY)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Copy promises what the form cannot do: page subtitle and metadata say "investment proofs (80C/80D/HRA)" (page.tsx:111-114, en.json taxDeclaration.subtitle) but the form only takes self-declared amounts — no document upload, no HRA landlord PAN (needed for annual rent above ₹1,00,000), no status. Employees may think they have submitted proofs.
- **Verified evidence:** Copy claims are real: page.tsx:8 metadata description 'Submit income tax investment proofs (80C/80D/HRA)' (obs cited page.tsx:111-114, file is 27 lines); en.json taxDeclaration.subtitle 'Submit your income tax investment proofs...', loadingSubtitle '80C/80D investment proofs.', hr nav taxDeclarationDesc 'Employee IT investment proofs'. Form (TaxDeclarationForm.tsx:146-296) only has regime radios plus 7 numeric inputs; no FileUpload, no landlord name/PAN field, no status. Whether the backend supports proofs/landlord PAN cannot be seen (payroll service module absent from snapshot). The MONEY fix text is irrelevant to this finding.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/(app)/hr/payroll/tax-declaration/page.tsx`, `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`
- **Fix steps:**
  1. Reword metadata.description, taxDeclaration.subtitle, loadingSubtitle and the hr menu taxDeclarationDesc to 'self-declared' investments (declaration, not proof).
  2. Add a visible note that supporting documents are submitted separately (or to whom) until proof upload exists.
  3. If proofs are in scope: reuse ds/FileUpload per section and add a landlord name + PAN field (zod-validated PAN regex) shown when rentPaid > 100000 rupees; needs backend fields.
  4. Move metadata strings to next-intl generateMetadata.
- **Acceptance:**
  - Grep of en.json/page.tsx metadata for 'proof' returns no user-facing claim of proofs in the declaration flow.
  - If HRA rent > Rs 1,00,000 is entered, landlord PAN input is required (only if backend supports it).
- **Needs:** decision  ·  **Effort:** XS <1h (copy only); L if proof upload + landlord PAN  ·  **Risk:** Statutory: employees may believe proofs are filed and lose deductions at year-end; copy fix is low risk.
- **Depends on:** GAP-PAYROLL-TAX-DECLARATION-05

### GAP-PAYROLL-TAX-DECLARATION-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — verified NOT a bug via PR #1744: GET /v1/payroll/tax-declarations returns the object unwrapped at root, matching what the form already reads. No code change needed.
- **First-pass claim:** Prefill mapping reads data.section80c/regime from the response root (TaxDeclarationForm.tsx:58-67) while sibling payroll endpoints wrap in { data } (form16/page.tsx:40, income-tax/page.tsx:24). If this endpoint is wrapped, every field prefills blank with no error and the next save overwrites. Field naming is also inconsistent (section80c vs rentPaidMinor).
- **Verified evidence:** Verified: the form reads the GET response root (TaxDeclarationForm.tsx:58-67 in file numbering; `if (data)` then data.regime, data.section80c...) with no unwrap and no schema. Sibling pages do unwrap: form16/page.tsx:40 `{data?: BulkJob}`, income-tax/page.tsx:24 `.data`. The loader getTaxDeclaration (app/_data/loaders.ts:4486) also maps the root but queries ?employeeId= whereas the form queries ?fy=. Field naming inconsistent (section80c/section80d/otherDeductions vs rentPaidMinor/prevEmployerSalaryMinor...). Actual response shape and the declared units cannot be verified: no payroll tax-declarations route exists in services/hrms-service in this snapshot. So 'every field prefills blank' is a latent risk, not a demonstrated bug.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`, `apps/web/src/lib/payroll/taxDeclaration.ts (new)`
- **Fix steps:**
  1. Create lib/payroll/taxDeclaration.ts with a zod schema for the GET body and a helper that accepts either the root object or {data: obj} (mirror getArrayPayload in app/_data/apiMappers.ts).
  2. In load(): parse with the schema; on parse failure set loadFailed (so finding -01 blocks the overwrite) instead of silently leaving blanks.
  3. Confirm with the payroll API owner the canonical names and whether section80c/section80d/otherDeductions are paise; centralise a FIELD_MAP so the UI has one place to adapt.
  4. Add a unit test with fixtures {data:{...}} and root shapes.
- **Acceptance:**
  - Unit test: unwrap helper returns same fields for root and {data} shapes.
  - Component test: malformed body shows the load-failed banner and disables submit.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: wrong assumption about units/names would mis-prefill money fields; confirm contract before merging.
- **Depends on:** GAP-PAYROLL-TAX-DECLARATION-01

### GAP-PAYROLL-TAX-DECLARATION-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Regime does not change the form: 80C, 80D, Other Deductions and Rent stay editable under New Regime although they do not reduce tax there (TaxDeclarationForm.tsx:146-269), and no client validation applies the 80C ₹1,50,000 / 80D limits listed on tax-config; inputs are whole-rupee (step 1) while the payload is paise.
- **Verified evidence:** Regime state (TaxDeclarationForm.tsx:25, radios 146-174) is never used to enable/disable or hide inputs (176-269). No limit validation: inputs only min=0 step=1. Limits exist only as display text on tax-config/page.tsx:55-57 (80C Rs 1,50,000, 80D via t('limit80D')), not as a shared constant. Money handling: toPaise (lines 10-13) is parseFloat + Math.round(n*100), which CLAUDE.md/lib/money.ts forbid (rupeesToMinorString exists, lib/money.ts:28, but rejects zero/empty so optional fields need a wrapper). Extra real bug: toInr (lines 16-19) renders paise like 123456 as '1234.56' but the input has step=1, so the browser blocks submit as invalid for any stored non-whole-rupee value. Payload is JSON numbers not strings.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/lib/payroll/taxLimits.ts (new)`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Replace toPaise with a wrapper over rupeesToMinorString that returns 0 for blank and null for invalid; send paise as Number only if <= MAX_SAFE_INTEGER or agree string transport with backend.
  2. Change toInr to a string-based paise->rupees formatter and set step='0.01' (or keep whole rupees and reject fractional stored values with a clear message).
  3. Create taxLimits.ts (80C 150000, 80D limits, 80CCD(1B)) shared by tax-config/page.tsx and the form; add zod refine/inline error per field and set aria-invalid/aria-describedby.
  4. Under New Regime disable 80C/80D/Other/Rent inputs with a helper text explaining they do not reduce tax there (decide whether 80CCD(2)/standard deduction stay editable); keep values so switching back restores them.
  5. Add i18n keys for limit errors and regime hint.
- **Acceptance:**
  - Unit: toPaise('1.005') is rejected/null and toPaise('100')==10000 with no float path.
  - Component: select New Regime -> 80C input disabled; select Old -> enabled; entering 200000 in 80C shows limit error and blocks submit.
  - Component: prefill from paise 123456 does not make the form invalid.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Money/statutory: wrong limits or disabling fields that are still allowed (e.g. employer NPS) would block legitimate declarations; get HR/tax sign-off on limits.
- **Depends on:** GAP-PAYROLL-TAX-DECLARATION-03

### GAP-PAYROLL-TAX-DECLARATION-05  ·  MEDIUM  ·  confirmed  ·  theme LIFECYCLE (was DEADROUTE)

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** No declaration lifecycle or window: no submitted/verified status, no deadline, no "last updated" — "Submitting updates any existing declaration" (footerNote) replaces silently; whether the mutation is audited (CLAUDE.md) cannot be seen from the UI, and HR reviews results elsewhere (income-tax) with no link back.
- **Verified evidence:** Form has no status, deadline, 'last updated' or version display; after submit it shows only t('savedMessage') (TaxDeclarationForm.tsx:105-108) and footerNote (en.json) says 'Submitting updates any existing declaration'. Only inbound link to the page is hr/page.tsx:72 (menu card); income-tax/page.tsx has no link to /hr/payroll/tax-declaration, and this page has no link to income-tax. Whether the POST is audited (CLAUDE.md rule 8) and whether the API returns status/updatedAt cannot be verified - payroll service is absent from the snapshot. 'DEADROUTE' theme is wrong; nothing is a dead link.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`, `apps/web/src/app/(app)/hr/payroll/tax-declaration/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Confirm with backend which lifecycle fields the GET returns (status, submittedAt/updatedAt, windowOpen/closesOn); do not add UI for fields that do not exist.
  2. If present: render a status StatusPill, 'Last updated' via formatIndianDate, and deadline banner in the form header; disable inputs and submit when window closed or status verified/locked.
  3. Add a ConfirmDialog on re-submit when a declaration already exists ('This replaces your FY declaration submitted on <date>').
  4. Add a link from the income-tax page (HR view) to the declaration and vice versa, using next/link.
  5. Verify backend emits an audit event on POST (services-side check).
- **Acceptance:**
  - Component: existing declaration with status 'verified' renders read-only with the status pill.
  - Manual: after submit, 'Last updated' shows today's date in IST.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: locking rules affect payroll TDS calculation; needs product decision on windows and who can reopen.
- **Depends on:** GAP-PAYROLL-TAX-DECLARATION-03

### GAP-PAYROLL-TAX-DECLARATION-06  ·  LOW  ·  partly  ·  theme HYGIENE (was FABRICATED)

- [x] **Status** — PR #1744 (merged): hardcoded error-color replaced with var(--bad); duplicate host-timezone getCurrentFY() replaced with shared IST-aware currentFinancialYear(); redundant page-level try/catch removed now that error.tsx is the real boundary.
- **First-pass claim:** Hard-coded #f85149 border and inline styles for the warning banner (TaxDeclarationForm.tsx:134); page-level try/catch (page.tsx:117-131) wraps only getTranslations and cannot catch the form's client-side failures; FY computed by currentFinancialYear() while tax-config uses its own getCurrentFY (duplicate logic).
- **Verified evidence:** True: hard-coded border '#f85149' plus inline-styled banner (TaxDeclarationForm.tsx:133-136); duplicate FY logic - form uses lib/fiscalYear currentFinancialYear() (IST-aware) while tax-config/page.tsx:5-12 has a local getCurrentFY() using host-timezone new Date() (so it can show the previous FY for 5.5h on 1 April on a UTC host; tax-config is the buggy copy). Overstated: page.tsx try/catch is at lines 12-26 (obs said 117-131) and only guards getTranslations - client fetch failures are handled inside the form, and error.tsx exists, so this is dead-ish code not a defect. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/hr/payroll/tax-declaration/page.tsx`, `apps/web/src/app/(app)/hr/payroll/tax-declaration/TaxDeclarationForm.tsx`, `apps/web/src/app/(app)/hr/payroll/tax-config/page.tsx`
- **Fix steps:**
  1. Delete local getCurrentFY in tax-config/page.tsx and import currentFinancialYear from @/lib/fiscalYear.
  2. Replace inline banner styles with the existing ds alert/notice class or var(--bad) tokens.
  3. Remove the try/catch in tax-declaration/page.tsx (route error.tsx already handles thrown errors) or make it meaningful.
- **Acceptance:**
  - Unit: tax-config renders FY '2025-26' when clock is 2026-03-31T20:00Z (IST 1 April => '2026-27').
  - Grep for '#f85149' in the tax-declaration folder returns nothing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Very low.


---
## Backend verification items (service code absent from snapshot)

### GAP-PAYROLL-CORRECTIONS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Pending corrections cannot be approved or rejected anywhere on this route: status is only displayed (page.tsx:53), and the dialog says it "creates a pending correction record" (en.json confirmDescription). Approval path is not visible in code, so a maker-checker step for retroactive pay changes is undeterminable and users see "Pending" indefinitely.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/corrections', 'POST v1/payroll/corrections']`
- **Question:** Is there an approve/reject endpoint for corrections requiring a different user from the creator, with audit?
- **How to verify:** Grep payroll-service corrections routes for approve/reject; curl approve as creator expecting 403.
- **Test to add:** Given pending correction by user A, when A approves, then 403; user B approves gives 200 and audit.
- **Impact if wrong:** Retro pay changes without maker-checker.
- **Web change if wrong:** Add Approve/Reject actions to corrections/page.tsx.

### GAP-PAYROLL-OFF-CYCLE-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Process Run is offered whenever status === "draft" (OffCycleCard.tsx:55), ignoring approval_status which the same card displays. The person who creates a bonus run can process it (tax computed, net fixed, irreversible) with no approval step; maker-checker is undeterminable server-side (payroll-service absent).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST v1/payroll/off-cycle', 'POST v1/payroll/off-cycle/:id/process']`
- **Question:** Does process reject when approval_status is not approved or when caller is the creator?
- **How to verify:** Open off-cycle process handler; curl process on a draft/pending run expecting 409/403.
- **Test to add:** Given draft run with approval_status=pending, when POST process, then 409; creator process gives 403.
- **Impact if wrong:** Unapproved bonus payouts.
- **Web change if wrong:** Gate Process button on approval_status in OffCycleCard.tsx:55.

### GAP-PAYROLL-RETURNS-04  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** 'File anyway — bypass reconciliation' is offered to every role that can open the page (page.tsx:236): employee and manager pass hr/layout.tsx:16-38 and the component has no role check. The typed reason and force_file_24q audit (ForceFileButton.tsx:110-125) are good, but the affordance to bypass a TRACES gate should be limited to payroll/finance approvers; server guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/payroll/statutory/form24q/force-file']`
- **Question:** Does force-file require a payroll/finance approver role and mandatory reason and audit?
- **How to verify:** Open force-file handler; curl as employee expecting 403.
- **Test to add:** Given employee token, when POST force-file, then 403; approver with reason gives 200 and audit force_file_24q.
- **Impact if wrong:** TRACES reconciliation gate bypassed by any user.
- **Web change if wrong:** Hide ForceFileButton by role in returns/page.tsx:236.

### GAP-PAYROLL-RETURNS-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Money crosses three ways for one figure: 24Q amounts are numbers of paise, 26Q are strings (page.tsx:38-49,183-187), the annual tile converts through minorToRupeesOrNull + Intl (TaxReturnsSummary.tsx:45,70), and the force-file result treats totalTdsDeducted as rupees ×100 (ForceFileButton.tsx:99) — one payroll-service response family with mixed units (payroll-service not in snapshot).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET statutory/form24q', 'GET statutory/form26q', 'POST statutory/form24q/force-file']`
- **Question:** Do all return endpoints use one money unit (paise integers) with consistent types?
- **How to verify:** Compare DTOs across payroll-service returns handlers; curl each and inspect amount types.
- **Test to add:** Given TDS 35000 rupees, when GET 24Q/26Q/force-file, then all report 3500000 paise as numbers.
- **Impact if wrong:** 100x errors in statutory tax figures.
- **Web change if wrong:** Normalise units in returns/page.tsx:38-49 and ForceFileButton.tsx:99.

### GAP-PAYROLL-SLIPS-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1823 (merged)
- **First-pass claim:** Unit and contract ambiguity: earnings[].amount, deductionItems[].amount and statutory.* are cast onto the summary type and passed to formatMoney (paise) (page.tsx:50-64,150,184,209-233), but the sibling printable page reads the same endpoint as components[].amountMinor. If the API sends rupees or a different array name, these cards show 100x-wrong figures or always fall back to "not available". Backend not in checkout, so undeterminable.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/slips/:id']`
- **Question:** Does slip response give earnings[].amount, deductionItems[].amount, statutory.* in paise, or components[].amountMinor?
- **How to verify:** Open slips DTO in payroll-service; curl one slip and inspect keys and units.
- **Test to add:** Given basic 50000 rupees, when GET slip, then documented key carries 5000000 paise; contract test compares detail and printable page fields.
- **Impact if wrong:** Wrong salary figures on payslips.
- **Web change if wrong:** Align detail page with real keys (slips/[id]/page.tsx:50-64).

### GAP-PAYROLL-STATUTORY-CHALLANS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate on a filing-critical mutation: employee and manager reach the Ingest Challan form via hr/layout.tsx:16-38; challans/page.tsx and IngestChallanForm.tsx never check roles. Ingested challans drive the 24Q reconciliation gate; guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST v1/payroll/statutory/challans']`
- **Question:** Does challan ingest require payroll/finance role and audit, with duplicate CIN/BSR rejection?
- **How to verify:** Open challans ingest handler; curl as employee expecting 403.
- **Test to add:** Given employee token, when POST challan, then 403; duplicate BSR+serial gives 409.
- **Impact if wrong:** Forged challans corrupt 24Q reconciliation.
- **Web change if wrong:** Add role gate to challans/page.tsx and IngestChallanForm.

### GAP-PAYROLL-STATUTORY-CHALLANS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Deposit Date prints raw ISO (page.tsx:77-86, no cellType), typed amount is echoed unformatted in the confirm ('TDS ₹35000', IngestChallanForm.tsx:225-241); any failed save shows the same generic sentence (browserClient.ts:57-72); reconcile status vocabulary is undeterminable (payroll-service not in snapshot).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET statutory/challans', 'GET statutory/reconcile', 'POST statutory/challans']`
- **Question:** What are the reconcile status enum values and error codes returned for failed saves?
- **How to verify:** Open reconcile handler enums and error map; curl invalid POST.
- **Test to add:** Given invalid challan, when POST, then 422 with code and field; reconcile status in documented enum.
- **Impact if wrong:** Generic errors; unmapped status labels.
- **Web change if wrong:** Map error codes and format dates/amounts in challans/page.tsx:77-86, IngestChallanForm.tsx:225-241.

### GAP-PAYROLL-STATUTORY-ESI-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate: hr/layout.tsx admits employee and manager (layout.tsx:16-38) and this page never calls requireAnyRole/getSessionRoles, unlike hr/payroll/page.tsx:12-17 (payroll_admin, payroll_officer, super_admin). Statutory ledgers for every employee render for whoever the backend lets through; the payroll-service guard is not in the snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/esi']`
- **Question:** GET statutory/esi must reject roles employee and manager (allow only payroll_admin, payroll_officer, super_admin) and scope rows to the caller's tenant.
- **How to verify:** Open the payroll-service route file for GET /v1/payroll/statutory/esi and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
- **Test to add:** Given a valid employee-role JWT, when GET /v1/payroll/statutory/esi, then 403 and no ledger rows; given payroll_officer, then 200 with tenant-scoped rows.
- **Impact if wrong:** Any employee/manager can read every employee's ESI wages and IP numbers (personal data breach, DPDP).
- **Web change if wrong:** Add requireAnyRole(['payroll_admin','payroll_officer','super_admin']) to esi/page.tsx (mirror hr/payroll/page.tsx:12-17) or a payroll-only layout.tsx for statutory/.

### GAP-PAYROLL-STATUTORY-ESI-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged): already done on main (verified in review)
- **First-pass claim:** Endpoint and its role guard live in payroll-service, not in the snapshot — cannot verify tenant scoping or maskable fields (undeterminable).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/esi']`
- **Question:** The esi handler must filter by JWT tenantId (never a client param) and mask or omit fields such as ESIC IP number/Aadhaar for roles without the PII permission.
- **How to verify:** Open the esi handler and its repo query in payroll-service; confirm where tenantId comes from and which columns are selected. Then call with tenant A token and confirm no tenant B employee ids appear.
- **Test to add:** Given rows for tenants A and B, when tenant A calls GET esi, then only A rows returned and response omits unmasked identifiers.
- **Impact if wrong:** Cross-tenant leak or unmasked PII in a statutory ledger.
- **Web change if wrong:** Only if unmasked identifiers are returned: stop rendering them in esi/page.tsx columns.

### GAP-PAYROLL-STATUTORY-GPF-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate on the page: hr/layout.tsx lets employee and manager in (layout.tsx:16-38), whereas hrms GPF routes are HR/finance/payroll only (gpf/routes.ts:24,55). Every employee's subscription amounts render for whoever the payroll-service lets through (guard not in snapshot).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/gpf']`
- **Question:** GET statutory/gpf must be limited to HR/finance/payroll roles, matching hrms GPF routes (gpf/routes.ts:24,55), and reject employee/manager.
- **How to verify:** Open the payroll-service route file for GET /v1/payroll/statutory/gpf and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Compare the role list with services/hrms-service/src/modules/gpf/routes.ts:24,55.
- **Test to add:** Given employee JWT, when GET gpf, then 403; given payroll_officer, then 200.
- **Impact if wrong:** Every employee's GPF subscription amounts visible to all staff.
- **Web change if wrong:** Add requireAnyRole with payroll roles to gpf/page.tsx.

### GAP-PAYROLL-STATUTORY-GRATUITY-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** Wrong legal basis for the Govt Department edition: subtitle, formula (15/26 × completed years), 5-year gate and ₹20,00,000 cap are all Payment of Gratuity Act, 1972 (GratuityCalculator.tsx:6-8,19,23; en.json gratuity.subtitle). State-government employees under service pension rules receive DCRG on a different formula and ceiling; CLAUDE.md says editions are entitlements, not code forks, yet one rule set is hard-coded. Which edition rule applies is undeterminable from code.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/gratuity', '(calculator is client-side: GratuityCalculator.tsx)']`
- **Question:** Gratuity/DCRG rule set (formula, 5-year gate, cap) must be selected per edition/entitlement (Payment of Gratuity Act for PSU/Small Office; CCS Pension DCRG for Govt Department) rather than hard-coded.
- **How to verify:** Open payroll-service gratuity computation (and hrms pension/engine.ts for DCRG) and check whether the rule is read from tenant entitlement/config; ask the product owner which rule applies to Govt Department. Compare the register's computed amount vs GratuityCalculator for a sample 22-year employee.
- **Test to add:** Given a Govt Department tenant and 22 completed years, when gratuity is computed, then DCRG uses the pension-rule formula and ceiling, not 15/26 x years capped at 20,00,000.
- **Impact if wrong:** Wrong legal entitlement shown/paid to retiring state employees; audit objection.
- **Web change if wrong:** Move formula/cap out of GratuityCalculator.tsx into a server compute endpoint (or entitlement-driven config) and relabel subtitle per edition.

### GAP-PAYROLL-STATUTORY-GRATUITY-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate: register of separation payouts for every employee is rendered for all hr/layout.tsx roles incl. employee and manager (layout.tsx:16-38); gratuity/page.tsx never checks roles. Backend guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/gratuity']`
- **Question:** GET statutory/gratuity must reject employee and manager and allow only payroll/HR-finance roles.
- **How to verify:** Open the payroll-service route file for GET /v1/payroll/statutory/gratuity and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
- **Test to add:** Given manager JWT, when GET gratuity, then 403.
- **Impact if wrong:** Separation payouts of all employees exposed to all staff.
- **Web change if wrong:** Add requireAnyRole to gratuity/page.tsx.

### GAP-PAYROLL-STATUTORY-GRATUITY-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Failure signalling differs from siblings: no DataSourceBadge (page.tsx:52-70) and the calculator stays live above a failed register; raw employeeId in the Employee column (page.tsx:40); status values ('computed', 'settled', 'paid') depend on StatusPill's map with an info fallback (undeterminable).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/gratuity']`
- **Question:** Register row status must be a closed enum (computed|settled|paid|...) and rows should carry employee display name, not only employeeId.
- **How to verify:** Open the gratuity schema/zod response in payroll-service; list the status enum values and whether employeeName is returned. Compare with StatusPill map in ui-kit.
- **Test to add:** Given a gratuity row of each status, when GET gratuity, then status is in the documented enum and StatusPill renders a non-fallback tone for every value.
- **Impact if wrong:** Unmapped status shows as generic info; users see raw ids.
- **Web change if wrong:** Add DataSourceBadge and an error state above the calculator; map employeeId to name if the API returns it; extend StatusPill map for any server enum value.

### GAP-PAYROLL-STATUTORY-LWF-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** — PARTIAL, owner decision open. Verified: POST /v1/payroll/statutory/state-rules 403s employee/manager/hr_admin/finance_officer/citizen (tests incl. real DB), the LWF web page is role-gated and the form shows only to PAYROLL_ADMIN_ROLES. Done in the rescan: the audit event now carries the exact before/after (oldValue/newValue = paise strings + frequency, null oldValue for a first row) written in the same transaction as the upsert (single statement), tenant-scoped. OPEN owner question: should payroll_officer still be allowed to change LWF rates? The item says payroll_admin/super_admin only (as the PT version writes are); the route has always allowed payroll_officer and narrowing removes that workflow. The role set is now one named constant (STATE_RULE_WRITER_ROLES in gap-routes.ts) and a test pins today's behaviour, so the decision is a one-line change plus that test. Previous status: PR #1761 (merged)
- **First-pass claim:** No role gate on a rule-changing form: employee and manager reach it via hr/layout.tsx:16-38; lwf/page.tsx and LwfConfigForm.tsx never check roles (hr/payroll/page.tsx:12-17 does for runs); payroll-service guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/state-rules', 'POST /api/v1/payroll/statutory/state-rules']`
- **Question:** POST statutory/state-rules (LWF/PT rule change) must be limited to payroll_admin/super_admin and emit an audit event; employee/manager get 403.
- **How to verify:** Open the payroll-service route file for POST /v1/payroll/statutory/state-rules and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Also check the audit emission (CLAUDE.md rule 8).
- **Test to add:** Given manager JWT, when POST state-rules with lwfEmployee, then 403 and no audit event; given payroll_admin, then 200 and one audit event with before/after.
- **Impact if wrong:** Any user could change statutory deduction rates for all employees.
- **Web change if wrong:** Gate lwf/page.tsx and hide LwfConfigForm unless payroll_admin/super_admin.

### GAP-PAYROLL-STATUTORY-LWF-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** The table shows a Frequency column (lwf/page.tsx:38) but the form has no frequency field and never sends one (LwfConfigForm.tsx:53-58). A user cannot set or correct the value they can see; whether the server defaults or preserves it is undeterminable.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST /api/v1/payroll/statutory/state-rules']`
- **Question:** POST state-rules with lwfEmployee/lwfEmployer only must preserve the existing frequency (merge, not overwrite/null) and the GET must return frequency.
- **How to verify:** Open the state-rules upsert in payroll-service; check whether omitted fields are preserved. Test: seed a state with frequency=half-yearly, POST without frequency, GET and compare.
- **Test to add:** Given state MH frequency=half-yearly, when POST {stateCode:'MH',lwfEmployee:2500,lwfEmployer:7500}, then GET shows frequency unchanged.
- **Impact if wrong:** Frequency silently reset, wrong LWF deduction cadence.
- **Web change if wrong:** Add a frequency select to LwfConfigForm.tsx:53-58 and send it; or drop the column.

### GAP-PAYROLL-STATUTORY-PERQUISITE-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1821 (merged)
- **First-pass claim:** No role gate: employee and manager reach the lookup, another employee's PAN and perquisites, and the Add form via hr/layout.tsx:16-38; the page never checks roles (hr/payroll/page.tsx:12-17 does for runs). Backend guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/form12ba?employeeId=&fy=', 'POST /api/v1/payroll/statutory/perquisite-components']`
- **Question:** form12ba lookup and perquisite-components POST must be restricted to payroll/HR roles (an employee may read only their own employeeId), and lookups of others should be audited.
- **How to verify:** Open the payroll-service route file for GET form12ba and POST perquisite-components and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Also call form12ba with employee JWT and another employee's id.
- **Test to add:** Given employee JWT for E1, when GET form12ba?employeeId=E2, then 403; for own id 200; POST perquisite-components as employee, then 403.
- **Impact if wrong:** Exposure of another employee's PAN and perquisites; unauthorised tax-perquisite edits.
- **Web change if wrong:** Gate perquisite/page.tsx with payroll roles (allow own-id lookup only if server permits).

### GAP-PAYROLL-STATUTORY-PF-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate: the ECR download button and full PF ledger render for every hr/layout.tsx role incl. employee and manager (hr/layout.tsx:16-38); pf/page.tsx and EcrGeneratorForm.tsx never check roles (contrast hr/payroll/page.tsx:12-17). The ECR carries every member's wages; the payroll-service guard is not in the snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/pf', 'GET /api/v1/payroll/statutory/ecr?month=']`
- **Question:** GET pf and GET ecr must reject employee/manager; ECR only for payroll_admin/payroll_officer.
- **How to verify:** Open the payroll-service route file for GET /v1/payroll/statutory/pf and /ecr and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
- **Test to add:** Given employee JWT, when GET ecr?month=2026-08, then 403 and no file body.
- **Impact if wrong:** Bulk member wage file downloadable by any user.
- **Web change if wrong:** Gate pf/page.tsx and EcrGeneratorForm behind payroll roles.

### GAP-PAYROLL-STATUTORY-PF-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** ECR is generated by a GET (EcrGeneratorForm.tsx:41) and delivered straight to the browser; a bulk statutory export of personal data with no audit trail visible from the UI (CLAUDE.md rule 8 covers mutations; export logging undeterminable — payroll-service not in snapshot).
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['GET /api/v1/payroll/statutory/ecr?month=']`
- **Question:** Every ECR generation must emit an audit event (actor, month, record count) even though it is a GET; also a GET that generates a file should be idempotent and side-effect free.
- **How to verify:** Open the ecr handler; grep for publishAudit/@civitasone/events. Call ecr twice and check the audit stream.
- **Test to add:** Given payroll_officer, when GET ecr?month=..., then exactly one audit event export.ecr is emitted with actor and row count.
- **Impact if wrong:** Untraceable bulk export of personal data (DPDP/CERT-In).
- **Web change if wrong:** If the API cannot audit a GET, change EcrGeneratorForm to POST /statutory/ecr.

### GAP-PAYROLL-STATUTORY-PT-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** No role gate on a rule-changing form: employee and manager reach it via hr/layout.tsx:16-38; pt/page.tsx and PtSlabForm.tsx never check roles (hr/payroll/page.tsx:12-17 does for runs). A mutation of tax slabs is offered to roles that will (or worse, won't) 403; guard not in snapshot.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST /api/v1/payroll/statutory/state-rules']`
- **Question:** POST state-rules with ptSlabs must be limited to payroll_admin/super_admin.
- **How to verify:** Open the payroll-service route file for POST /v1/payroll/statutory/state-rules and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
- **Test to add:** Given employee JWT, when POST ptSlabs, then 403; given payroll_admin, 200.
- **Impact if wrong:** Unauthorised change of professional-tax slabs.
- **Web change if wrong:** Gate pt/page.tsx and PtSlabForm by role.

### GAP-PAYROLL-STATUTORY-PT-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1761 (merged)
- **First-pass claim:** Save semantics are unclear: the form is titled 'Add / Update' but always POSTs a one-element ptSlabs array (PtSlabForm.tsx:68-72); whether that appends, upserts or replaces every slab of the state is not visible or warned in the ConfirmDialog copy (en.json ptSlabForm.confirmDescription). Replace-all would silently delete a state's other slabs. Backend not in snapshot — undeterminable.
- **Service:** `payroll-service`  ·  **Endpoint(s):** `['POST /api/v1/payroll/statutory/state-rules']`
- **Question:** POSTing ptSlabs with one element must upsert/append that slab and never delete the state's other slabs, and overlapping ranges must be rejected by zod/service validation.
- **How to verify:** Open the state-rules handler/repo; seed 3 slabs for a state, POST one new slab, then GET and count. Also POST an overlapping range.
- **Test to add:** Given state KA with 3 slabs, when POST one non-overlapping slab, then GET returns 4; when overlapping, then 422.
- **Impact if wrong:** Silent deletion of a state's tax slabs and wrong PT deductions.
- **Web change if wrong:** If replace-all: PtSlabForm must send the full merged slab array or a slab-level endpoint, and ConfirmDialog copy must say it replaces all slabs.


---
## Cannot verify from the snapshot

### GAP-PAYROLL-INCOME-TAX-01 · /hr/payroll/income-tax
- [x] **Status** — PR #1845 (merged): REFUTED: tax routes return rupee strings matching cellType rupees
- **First-pass claim:** Money unit split: this table uses cellType "rupees" → formatRupees(rupees) (DataTable.tsx:135-137,269; formatters.ts:67), whereas every other payroll screen stores/prints paise via formatMoney. CLAUDE.md rule 11 mandates minor units; if /api/v1/payroll/income-tax returns paise (as slips do) every figure shows 100x too large, and the Row type declares them as strings (page.tsx:12-16).
- **Why cannot-verify:** Page declares Row money fields as strings (page.tsx:12-16) and uses cellType 'rupees' -> formatRupees (DataTable.tsx:135,269). The unit of /api/v1/payroll/income-tax is not documented in the frontend and the payroll service is absent, so whether it is rupees or paise cannot be checked. Cross-screen unit split is real (see lib/testUtils/money.ts), and CLAUDE.md rule 11 applies.

### GAP-PAYROLL-STATUTORY-GPF-02 · /hr/payroll/statutory/gpf
- [x] **Status** — PR #1845 (merged): FIXED: read-only HRMS account reconciliation column
- **First-pass claim:** Two sources of truth for GPF: this ledger comes from payroll-service (/api/v1/payroll/statutory/gpf) while hrms-service keeps per-employee GPF accounts (POST/GET /v1/hrms/employees/:id/gpf, subscription, advance, withdrawal, interest — gpf/routes.ts:53-137). Nothing on this page reconciles the two.
- **Why cannot-verify:** hrms-service gpf/routes.ts does expose per-employee GPF (POST/GET /v1/hrms/employees/:id/gpf at :53,:76; subscription/advance/withdrawal/refund :131-134; interest :137). The page reads payroll-service /api/v1/payroll/statutory/gpf (statutory/gpf/page.tsx:18); payroll-service is absent from the snapshot so overlap/reconciliation between the two ledgers cannot be verified. The page does no reconciliation itself. Needs a product/architecture decision.

### GAP-PAYROLL-STATUTORY-NPS-02 · /hr/payroll/statutory/nps
- [x] **Status** — PR #1845 (merged): FIXED: read-only HRMS account reconciliation column
- **First-pass claim:** Two sources of truth for NPS: payroll-service ledger here vs per-employee NPS accounts and contributions in hrms-service (POST/GET /v1/hrms/employees/:id/nps, /nps/contribution, /nps/withdrawal — nps/routes.ts:54-150). No reconciliation on the page.
- **Why cannot-verify:** hrms-service nps/routes.ts has per-employee NPS account, contribution and withdrawal routes as described (POST at line ~54 with pran/tier/contrib pct; HR_ROLES at :24). The page reads payroll-service /api/v1/payroll/statutory/nps (statutory/nps/page.tsx:20); payroll-service is not in the snapshot, so overlap/reconciliation cannot be verified. The page performs no reconciliation. Needs an architecture decision on which ledger is authoritative.
