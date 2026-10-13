# Detailed gap file — module `legal`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 42, BACKEND-VERIFY 10



---
## /legal  —  `legal/home.html`

- **Source:** `apps/web/src/app/(app)/legal/page.tsx`
- **Design reference:** `redesign/legal/home.html`

### GAP-LEGAL-HOME-02  ·  LOW  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub has no 'New case' entry and no counts; the only path to New Case is Dashboard or Cases List (page.tsx:8-12).
- **Verified evidence:** apps/web/src/app/(app)/legal/page.tsx:8-14 lists five links, all with static notes; no 'New case' entry and no counts. ModuleHub accepts `children` and `help` props (ModuleHub.tsx:16) so a counts strip is possible. Cases/new is reachable from dashboard and list.
- **Files to change:** `apps/web/src/app/(app)/legal/page.tsx`
- **Fix steps:**
  1. Add a link { href:'/legal/cases/new', label:'New Case', note:'Register a court case' } to the links array.
  2. Optionally pass children with a counts strip from getLegalDashboard(), with error -> '—'.
- **Acceptance:**
  - Hub shows a New Case link that opens /legal/cases/new.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-HOME-03  ·  LOW  ·  partly  ·  theme NAVUX (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** legal/not-found.tsx offers no action or link back to Legal; loading.tsx is a dashboard-shaped skeleton with hard-coded slate colours (loading.tsx:3-15).
- **Verified evidence:** Both sub-claims are true: apps/web/src/app/(app)/legal/not-found.tsx renders EmptyState with no `action` (EmptyState supports an action prop, ds/EmptyState.tsx:8), and apps/web/src/app/(app)/legal/loading.tsx:3-15 uses tailwind slate-50/slate-200, min-h-screen and max-w-7xl rather than the app's .wrap / tokens, giving a dark-mode/layout mismatch. Neither is fabricated data, so the FABRICATED tag is wrong, and it is not tied to /legal home page.tsx.
- **Files to change:** `apps/web/src/app/(app)/legal/not-found.tsx`, `apps/web/src/app/(app)/legal/loading.tsx`
- **Fix steps:**
  1. In not-found.tsx pass action={<Link href='/legal' className='btn primary'>Back to Legal</Link>}.
  2. Rewrite loading.tsx with <div className='wrap'> and the shared Skeleton primitive from ds if present (else token-based .skeleton class), sized like the hub.
- **Acceptance:**
  - 404 inside /legal shows a link back to /legal.
  - Loading skeleton uses theme tokens and looks right in dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-HOME-04  ·  LOW  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No help slug on the hub, unlike locations/page.tsx (help='locations').
- **Verified evidence:** apps/web/src/app/(app)/legal/page.tsx:5-7 passes no `help` prop to ModuleHub, while locations/page.tsx:8 passes help='locations' and ModuleHub forwards it to PageHeader (ModuleHub.tsx:16,25). Whether a 'legal' help topic exists is cannot-verify from this snapshot.
- **Files to change:** `apps/web/src/app/(app)/legal/page.tsx`
- **Fix steps:**
  1. Confirm the help-topic registry has (or add) a 'legal' entry.
  2. Add help='legal' to ModuleHub in page.tsx.
- **Acceptance:**
  - Help affordance appears on /legal and opens the legal topic.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /legal/cases/[id]  —  `legal/cases-detail.html`

- **Source:** `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`
- **Design reference:** `redesign/legal/cases-detail.html`

### GAP-LEGAL-CASES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — button/dialog renamed 'Record affidavit filing' and no longer says upload; but affidavits still render as generic 'Court order' rows in the case Court orders table (page.tsx orderType fallback, no affidavit filter/Filings card) and there is still no file attachment/documents endpoint
- **First-pass claim:** 'Upload Affidavit' uploads nothing: it records the text as a court order with orderType 'affidavit' via POST /cases/:id/orders (CaseActions.tsx:8-19,96-113), so affidavits show up in the Court orders list and compliance data, with no document attached.
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/[id]/CaseActions.tsx:329-348 posts to /api/proxy/v1/legal/cases/{id}/orders with orderType:'affidavit', summary, orderDate; the form (453-473) has no file input and its own amber note says 'no file-upload endpoint in legal-service'; the file header (254-259) admits it is a workaround. The detail page maps every order into 'Court orders' (page.tsx:74-79) and labels it 'Court order' since orderType is not shown. Whether it also enters compliance stats on /legal/court-orders cannot be verified (legal-service absent from snapshot); the list there keys on complianceRequired/status.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/[id]/CaseActions.tsx`, `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`, `legal-service (not in snapshot): new case-documents endpoint`, `apps/web/src/app/_components/ds/FileUpload.tsx`
- **Fix steps:**
  1. Short term: rename button/dialog to 'Record affidavit filing' and stop calling it upload; show orderType in the Court orders table and exclude orderType==='affidavit' from the orders list (or give it its own 'Filings' card).
  2. Long term (backend): add POST /v1/legal/cases/:id/documents (S3/MinIO adapter, virus scan, audit event) and GET list; legal documents module is keyed by matterId today.
  3. Web: use the ds FileUpload in the affidavit dialog, upload the file first, then record the filing referencing documentId.
  4. Keep ConfirmDialog gate.
- **Acceptance:**
  - Recording an affidavit no longer appears as a generic 'Court order' row.
  - With a file attached the document is downloadable from the case page.
  - Court-order compliance counts are unchanged after recording an affidavit (verify in service).
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Legal record integrity: mislabelled filings in a court-order register could mislead compliance tracking; file storage needs PII/retention review.

### GAP-LEGAL-CASES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** getLegalCaseById returns null on any failure and the page calls notFound() (page.tsx:49-51): a service outage is shown as 'Case not found ... removed, transferred, or the ID is invalid'.
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/[id]/page.tsx:47-51: `const { data: caseData, source } = await getLegalCaseById(...)`; `if (!caseData) notFound()`. fetchJson (apps/web/src/app/_data/apiClient.ts:111-172) returns data:null with source:'error' plus status (404, 5xx, 401 or none on network failure), so outage -> not-found.tsx 'may have been removed, transferred, or the ID is invalid'. The later `source === 'error'` badge at :105 is unreachable when data is null.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`, `apps/web/src/app/(app)/legal/cases/[id]/not-found.tsx`
- **Fix steps:**
  1. Destructure status too; if source==='error' && status!==404 render <RefreshErrorState error={toHumanError('load',{area:'case'})} backHref='/legal/list'/> (as learning pages do) inside PageHeader.
  2. Only call notFound() when status===404 or (source==='api' && !caseData).
  3. Remove the dead DataSourceBadge branch.
- **Acceptance:**
  - Mock API 503 -> error state with retry, not 'Case not found'.
  - Mock API 404 -> not-found page.
  - 401 still triggers login flow per fetchJson.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEGAL-CASES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme NAV (was LOADING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** not-found.tsx breadcrumb starts with 'Audit' linking /audit/dashboard (not-found.tsx:11), while the page's own crumbs start with Legal (page.tsx:91).
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/[id]/not-found.tsx:11 breadcrumb first crumb is Link '/audit/dashboard' 'Audit' (copy-paste); page.tsx:91 uses Legal -> /legal. Also page crumb 'Cases' goes to /legal/list in both. loading.tsx exists in the folder; the LOADING tag is not the issue.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/[id]/not-found.tsx`
- **Fix steps:**
  1. Change first crumb to <Link href='/legal'>Legal</Link>.
  2. Keep 'Cases' -> /legal/list and 'Not found' current.
- **Acceptance:**
  - Not-found page breadcrumb reads Legal / Cases / Not found with correct links.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-CASES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Lifecycle is inferred: status maps to a stage index (page.tsx:17-33) and only 'Registered' gets a date; 'Raised date' in Details is filedDate while the timeline calls the first step 'Registered' (page.tsx:130,176).
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/[id]/page.tsx:25-38 stageIndex() maps status to a 4-step index (pending->1, appealed/stayed->2, disposed/settled->3, else 0); date shown only for step 0 (:196) using filedDate, while Details labels the same value 'Raised date' (:130) and the step is 'Registered' (:81). Stage is inferred, not from recorded events (hearings/orders exist and are not used). The StatusPill tone suggestion is not the issue.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`
- **Fix steps:**
  1. Rename Details label to 'Filed date' (or 'Registered date') and use one term in the timeline.
  2. Derive step dates from data: first hearing date for Arguments, latest order date / disposal for Judgment when present; show '—' otherwise.
  3. Add a caption 'Stage inferred from status' or remove the inferred future-state styling until backend exposes lifecycle events.
- **Acceptance:**
  - Same label used in Details and timeline.
  - Case with hearings shows the Arguments step date from the earliest hearing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; legal staff may read the timeline as authoritative.

### GAP-LEGAL-CASES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme A11Y (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — affidavit/brief dialog now uses ds Modal (Tab trap + focus restore); remaining: no 'Counsel briefs' card on the case page (briefs still not listed after briefing counsel)
- **First-pass claim:** Brief counsel / Upload Affidavit use a hand-rolled modal with Escape and initial focus but no focus trap or focus return (CaseActions.tsx:60-68,196-247); counsel briefs are not displayed anywhere on this page after creation.
- **Verified evidence:** True: the hand-rolled overlay in apps/web/src/app/(app)/legal/cases/[id]/CaseActions.tsx:390-477 handles Escape and initial focus (294-302) but has no Tab trap and does not return focus to the trigger; ds ConfirmDialog already implements trap and restore (ds/ConfirmDialog.tsx:7-8, 92-126). Briefs: the page shows only advocateName as 'Counsel ref' (page.tsx:134-136), no brief list. Whether an API to list briefs by case exists cannot be verified (legal-service absent). Observation's line refs 60-68/196-247 are wrong.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/[id]/CaseActions.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx (or new ds/Modal.tsx)`, `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`
- **Fix steps:**
  1. Extract the focus-trap/return logic from ConfirmDialog into a ds Modal (or useFocusTrap hook) and wrap the brief/affidavit panel with it.
  2. Store the opener element and refocus it on close.
  3. Backend check: confirm a GET counsel-briefs?caseId endpoint; if present add getCounselBriefs loader and a 'Counsel briefs' card (counsel, type, status, date).
- **Acceptance:**
  - Tab from last field cycles to first inside the dialog; Shift+Tab reverse.
  - Closing returns focus to the 'Brief counsel' button.
  - After briefing counsel, the brief appears on the page (if endpoint exists).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; a11y only for the modal part.


---
## /legal/cases/new  —  `legal/cases-new.html`

- **Source:** `apps/web/src/app/(app)/legal/cases/new/page.tsx`
- **Design reference:** `redesign/legal/cases-new.html`

### GAP-LEGAL-CASES-NEW-01  ·  HIGH  ·  partly  ·  theme DATA (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1934 — case-type select (caseTypeId) added to the form and mapLegalCaseSummaries prefers the server type with caseNo fallback; list column is now 'Case type'/Writ & Criminal; remaining: the typed subject text is still not mapped or shown in the list ('Subject column shows the typed subject text' unmet)
- **First-pass claim:** The form never sends a case type: the 'Subject' textarea is posted as subject (CreateCaseForm.tsx:40-47) while the list's Subject column and 'Adverse Risk' logic read type (list/LegalCasesTable.tsx:49,73), so cases created here show a blank/default subject and can never count as adverse risk.
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx:45-52 posts caseNo,title,court,subject,petitioner,counselRef - no type, as stated. But the list does not read a server 'type': mapLegalCaseSummaries (apps/web/src/app/_data/apiMappers.ts:667-711) derives type from the caseNo prefix (WP/WRIT -> writ, ARB -> arbitration, else other) and never 'criminal'. So the Subject column (apps/web/src/app/(app)/legal/list/LegalCasesTable.tsx:69) shows 'writ/arbitration/other', not the entered subject, and Adverse risk (:49, list/page.tsx:12) counts only WP/WRIT-numbered cases. A case numbered WP/... created here does count; the claim it 'can never count' is overstated. Detail page reads caseData.type (page.tsx:116) unmapped; API shape cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/legal/list/LegalCasesTable.tsx`, `apps/web/src/app/(app)/legal/list/page.tsx`
- **Fix steps:**
  1. Add a case-type select (writ, civil, criminal, arbitration, service, other) to the form and send it if the create-case schema accepts it (verify in legal-service validators).
  2. In mapLegalCaseSummaries use row.type when present, keeping the caseNo heuristic only as fallback; map row.subject to a new 'subject' field.
  3. Subject column shows subject (fallback type label); Adverse risk uses explicit type, with the rule documented.
- **Acceptance:**
  - Create case with type Criminal -> counted in Adverse risk.
  - Subject column shows the typed subject text.
  - Legacy case without type still classifies by caseNo prefix.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changes what counts as adverse risk on a management stat; agree the rule with Legal.
- **Depends on:** GAP-LEGAL-CASES-NEW-02

### GAP-LEGAL-CASES-NEW-02  ·  MEDIUM  ·  partly  ·  theme FORM (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — Respondent field added (sent via parties); remaining: Court is still a free-text input (no court master/normalisation; Courts/Fora still counts raw strings), no filing-date or department fields on the form
- **First-pass claim:** Court is free text (CreateCaseForm.tsx:82): the 'High Court' filter and the Courts / Fora count depend on identical spelling; no court picker, no case-type, filing date or respondent fields although the detail page shows Respondent, Raised date and Department (cases/[id]/page.tsx:105-124).
- **Verified evidence:** True: court is a free-text input (apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx:79-82 area, id 'court'), and form has no case-type, filing date, respondent or department fields; detail page shows Respondent/Raised date/Department (cases/[id]/page.tsx:120-139). Courts / Fora = new Set of exact court strings (list/page.tsx:10), so spelling variants inflate it. Correction: the 'High Court' filter is a case-insensitive substring match on 'high court' (LegalCasesTable.tsx:47), not identical spelling. Not a date-format issue.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx`, `apps/web/src/app/(app)/legal/list/page.tsx`, `legal-service create-case validators (not in snapshot)`
- **Fix steps:**
  1. Replace court input with a select/combobox of a maintained court master (Supreme Court, High Court of X, tribunals) with 'Other' free text; send a normalised value.
  2. Add Respondent, Filing date (default today), Department fields to the form, only if the create schema accepts them (verify).
  3. Compute Courts / Fora with the normalised value (trim, case-fold).
- **Acceptance:**
  - Selecting 'High Court' variants yields one Courts/Fora entry.
  - Respondent and filed date entered at creation appear on the detail page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Needs master data for courts; backend contract unverified.

### GAP-LEGAL-CASES-NEW-04  ·  LOW  ·  confirmed  ·  theme DARKMODE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline styles force white field backgrounds (background:#fff, CreateCaseForm.tsx:79-100), which will not follow dark mode.
- **Verified evidence:** apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx wraps every field in style={{background:'#fff', padding}} (lines ~75-95); the app has DarkModeToggle (app/_components/DarkModeToggle.tsx) so fields stay white on dark surfaces. Same pattern in court-orders/new/RecordOrderForm.tsx. Also hard-coded #fff banners elsewhere.
- **Files to change:** `apps/web/src/app/(app)/legal/cases/new/CreateCaseForm.tsx`, `apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx`
- **Fix steps:**
  1. Remove inline background:#fff; use the .field/.card token background (var(--panel) or var(--card)).
  2. Move padding to a class; check .field css in globals.
  3. Visual check in dark theme.
- **Acceptance:**
  - Dark mode: form field backgrounds follow theme, text readable.
  - No inline '#fff' left in both files (grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /legal/court-orders  —  `legal/court-orders.html`

- **Source:** `apps/web/src/app/(app)/legal/court-orders/page.tsx`
- **Design reference:** `redesign/legal/court-orders.html`

### GAP-LEGAL-COURT-ORDERS-01  ·  HIGH  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Type' shows 'Issued' when complianceRequired else 'Stay' (CourtOrdersTable.tsx:48): every order without a compliance requirement is called a Stay regardless of what was recorded (judgment, interim, direction).
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx:93 (obs said :48): Type cell is `r.complianceRequired ? 'Issued' : 'Stay'`. The record form offers order/judgment/interim/stay/direction (RecordOrderForm.tsx:226-230) but CourtOrderSummary (from @civitasone/types, not in snapshot) apparently carries no orderType; whether the API exposes it cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx`, `legal-service court-orders list DTO (not in snapshot)`, `packages types CourtOrderSummary`
- **Fix steps:**
  1. Backend/types: include orderType in CourtOrderSummary and its zod schema.
  2. Web: render humanizeStatus(orderType) (Judgment, Interim, Stay, Direction, Order) in the Type column; drop the complianceRequired ternary.
  3. Move compliance-required into its own 'Compliance' column (Yes/No).
- **Acceptance:**
  - Judgment order without compliance shows 'Judgment', not 'Stay'.
  - Stay order shows 'Stay'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Mislabelling a judgment as a stay is a legal-record accuracy issue.

### GAP-LEGAL-COURT-ORDERS-02  ·  HIGH  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Status 'appealed' is rendered as 'Under compliance' (CourtOrdersTable.tsx:22): an order under appeal reads as being complied with.
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx:67 `if (o.status === 'appealed') return <span className='pill info'>Under compliance</span>`. An appealed order is not complied with; label is wrong. Note ordering: 'pending' with deadline passed shows Overdue before this.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx`
- **Fix steps:**
  1. Change label to 'Under appeal' (pill info).
  2. Add 'appealed' to humanizeStatus/StatusPill tone map so the fallback also works.
  3. Confirm with Legal whether compliance is suspended pending appeal and add a tooltip if so.
- **Acceptance:**
  - Order with status appealed shows 'Under appeal'.
  - No status renders 'Under compliance' unless it truly means that.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; wording.

### GAP-LEGAL-COURT-ORDERS-03  ·  MEDIUM  ·  partly  ·  theme DATEFMT (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Contempt Risk' counts pending orders with deadline <= today (page.tsx:17-19) — including a deadline that is today and not yet breached — and uses a UTC date (page.tsx:11); the row pill says 'Overdue' for the same condition.
- **Verified evidence:** page.tsx:11 today = new Date().toISOString().slice(0,10) (UTC date); page.tsx:16-18 counts pending complianceRequired orders with complianceDeadline <= today; CourtOrdersTable.tsx:57-61 uses the same <= for isOverdue and shows 'Overdue' pill (:65) - so page and row agree, but a deadline that is today is called Overdue/contempt risk before the day ends. Between 00:00 and 05:30 IST the UTC date is yesterday, so items due today IST are under-counted (opposite direction to a naive reading). Not a dead link. Also stat cards show 0 on load error (source 'error' only adds a badge).
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/page.tsx`, `apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add todayIST() (Intl.DateTimeFormat en-CA, timeZone 'Asia/Kolkata', like lib/fiscalYear.ts) and use it for `today`.
  2. Use strict < today for Overdue/Contempt Risk; treat deadline === today as 'Due today' (warn pill).
  3. Extract one isOverdue() helper shared by page and table.
  4. When source==='error' show '—' in stat cards.
- **Acceptance:**
  - Deadline = today (IST) counts as Due, not Overdue.
  - Deadline yesterday counts as Contempt Risk at 00:30 IST.
  - Page tile count equals number of rows shown by the 'Risk' filter.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Business semantics of contempt risk; confirm with Legal.

### GAP-LEGAL-COURT-ORDERS-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Contempt watch' is a disabled PlaceholderButton (page.tsx:29, PlaceholderButton.tsx); the banner promises linkage to Establishment files but nothing on the page links to one.
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/page.tsx:30 <PlaceholderButton label='Contempt watch'/> renders a disabled 'coming soon' control (_components/PlaceholderButton.tsx); banner (:22-24) says 'Linked to Establishment files for action' but no link to any estab route exists on the page; row link goes to the legal case only (Table :98). It is an honest placeholder, not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/page.tsx`, `apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx`
- **Fix steps:**
  1. Either implement 'Contempt watch' as a link that opens the table with the Risk filter preselected (?filter=risk) or remove the button.
  2. Reword the banner to what exists, or add a per-row link to the related Establishment file if the API returns a file reference (not verified).
- **Acceptance:**
  - No disabled placeholder shown; 'Contempt watch' opens the Risk filter (if kept).
  - Banner makes no claim about linkage that is not present.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-COURT-ORDERS-05  ·  LOW  ·  confirmed  ·  theme THEMING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Banner uses emoji and inline hex colours (page.tsx:23); this table lacks the provenance/cache behaviour of its siblings (CourtOrdersTable.tsx has no useSeededResource).
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/page.tsx:22-23 banner has emoji 📜 and inline hex colours (#f1f5f9, #cbd5e1, #334155), plus stat-card iconBg hex (:36-39). CourtOrdersTable.tsx takes plain props and does not use useSeededResource, unlike list/LegalCasesTable.tsx:36-41 which gets provenance/offline cache and DataSourceBadge. The page shows a separate DataSourceBadge only for source==='error'. Not fabricated data; theme tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/page.tsx`, `apps/web/src/app/(app)/legal/court-orders/CourtOrdersTable.tsx`
- **Fix steps:**
  1. Replace inline banner with the shared banner component/class using token colours; drop the emoji or use an icon.
  2. Wrap items in useSeededResource('legal.court-orders', items, source, d=>d.length===0) inside CourtOrdersTable and render DataSourceBadge with provenance like LegalCasesTable; remove the page-level badge.
  3. Use var(--...) tokens for StatCard iconBg.
- **Acceptance:**
  - Offline/cached load shows the provenance badge on court orders like on cases.
  - No inline hex remains in page.tsx (grep).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /legal/court-orders/new  —  `legal/court-orders-new.html`

- **Source:** `apps/web/src/app/(app)/legal/court-orders/new/page.tsx`
- **Design reference:** `redesign/legal/court-orders-new.html`

### GAP-LEGAL-COURT-ORDERS-NEW-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed cases fetch is indistinguishable from an empty register: page.tsx:8 ignores source and RecordOrderForm shows 'No cases are available yet. Register a case' (RecordOrderForm.tsx:67-74), steering users to create duplicate cases during an outage.
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/new/page.tsx:5 (obs said :8) `const { data: cases } = await getLegalCases()` discards source; on failure cases=[] so RecordOrderForm.tsx:202-210 renders 'No cases are available yet. Register a case...' with a link to /legal/cases/new.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/new/page.tsx`, `apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx`
- **Fix steps:**
  1. Read source and status from getLegalCases(); if source==='error' render <RefreshErrorState error={toHumanError('load',{area:'cases'})} backHref='/legal/court-orders'/> in place of the form.
  2. Keep the 'register a case' empty message only for source==='api' with zero rows.
- **Acceptance:**
  - API 500 -> error state with retry, no 'Register a case' link.
  - Empty register -> existing empty message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEGAL-COURT-ORDERS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Case select lists every case with a text label and defaults to the first one (RecordOrderForm.tsx:20,83-88): no search, and a hurried submit files the order against an unrelated case; the confirm dialog does not repeat which case is selected.
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx:155 useState(cases[0]?.id) preselects the first case; plain <select> of every case (:217-221, no search, and getLegalCases is unpaginated); ConfirmDialog description (:265-270) is generic and does not name the case, order type or date. Note the dialog is a single-user confirm, not maker-checker.
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx`, `apps/web/src/app/(app)/legal/court-orders/new/page.tsx`
- **Fix steps:**
  1. Initialise caseId to '' with a 'Select a case' placeholder; support ?caseId= preselect from the case detail page.
  2. Replace select with a searchable combobox (case no. + title) when options > ~20.
  3. Build the ConfirmDialog description from state: case label, order type, order date, e.g. 'Record Judgment dated 12 Aug 2026 against WP/1234/2024?'.
- **Acceptance:**
  - Submit without picking a case shows 'Select a case'.
  - Confirm dialog text names the selected case and order type.
  - Opening from a case with ?caseId= preselects it.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; reduces mis-filed orders.

### GAP-LEGAL-COURT-ORDERS-NEW-04  ·  LOW  ·  confirmed  ·  theme ENTITYNAME (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — inline #fff backgrounds removed from RecordOrderForm; remaining: Owning department (deptRef) is still a free-text input, no department picker/loader
- **First-pass claim:** Owning department is free text (deptRef) with no picker, although the banner on the orders page says orders route to the owning department; inline #fff field backgrounds (RecordOrderForm.tsx:82-110).
- **Verified evidence:** apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx:245-248 deptRef is a free-text input; every field wrapper uses inline background:'#fff' (lines 215-245). Banner claim about routing is on court-orders/page.tsx:23. No department picker loader located in the snapshot (verify hr department loader).
- **Files to change:** `apps/web/src/app/(app)/legal/court-orders/new/RecordOrderForm.tsx`, `apps/web/src/app/(app)/legal/court-orders/new/page.tsx`
- **Fix steps:**
  1. Load departments (existing HRMS department loader or new getDepartments()) in page.tsx and pass as options; render a select storing the department id/code that legal-service expects (verify deptRef contract).
  2. Remove inline #fff backgrounds as in CASES-NEW-04.
- **Acceptance:**
  - Department chosen from list is saved and shown on the compliance table Dept column.
  - Dark mode renders correctly.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** deptRef semantics (name vs id) unverified; wrong value breaks routing to owning department.
- **Depends on:** GAP-LEGAL-CASES-NEW-04


---
## /legal/dashboard  —  `legal/dashboard.html`

- **Source:** `apps/web/src/app/(app)/legal/dashboard/page.tsx`
- **Design reference:** `redesign/legal/dashboard.html`

### GAP-LEGAL-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Disposal rate is computed as activeCases / (activeCases + opinionsDue) and labelled 'disposed' (page.tsx:60-62): it is the active share against pending opinions, not a disposal rate, and it falls back to a hard-coded 64% when activeCases is 0.
- **Verified evidence:** apps/web/src/app/(app)/legal/dashboard/page.tsx:60-63 renders Math.round(activeCases/(activeCases+opinionsDue)*100) under the caption 'disposed', and the literal 64 when activeCases is 0. The formula has nothing to do with disposals, and 64 is a hard-coded literal.
- **Files to change:** `apps/web/src/app/(app)/legal/dashboard/page.tsx`
- **Fix steps:**
  1. Delete the ternary at page.tsx:61 and the 'Disposal rate' card unless the /api/v1/legal/dashboard payload carries disposed/total counts (LegalDashboard type lives in @civitasone/types, absent from this snapshot: cannot see fields).
  2. If backend can supply disposedCases and totalCases, compute the percent from them and show '—' when total is 0.
  3. If not, replace the card with a 'Not available' EmptyState or remove it; do not derive a percent from opinionsDue.
  4. Remove the 64 fallback in every branch.
- **Acceptance:**
  - With activeCases=0 the page never shows 64%.
  - With mocked payload {disposed:30,total:120} the card reads 25%.
  - No card computes a ratio from opinionsDue.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low technical risk; a wrong KPI shown to legal officers is a credibility risk until removed.
- **Depends on:** GAP-LEGAL-DASHBOARD-03

### GAP-LEGAL-DASHBOARD-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Upcoming hearings' table is always given rows={[]} (page.tsx:46-53) while the line above says 'N hearings scheduled this week' (page.tsx:43): the dashboard never lists a hearing, and the 'Calendar →' link goes to the same table view.
- **Verified evidence:** apps/web/src/app/(app)/legal/dashboard/page.tsx:45-53 passes rows={[]} to DataTable, so the 'Upcoming hearings' table never has data, while line 43 prints '{n} hearings scheduled this week'. The 'Calendar →' link (line 40) is a plain <a href='/legal/hearings'>, which is the same table view (no calendar exists; HearingsActions.tsx:43 has the same issue). getLegalHearings() exists in loaders.ts:4111 and could feed the table.
- **Files to change:** `apps/web/src/app/(app)/legal/dashboard/page.tsx`
- **Fix steps:**
  1. In page.tsx call getLegalHearings() alongside getLegalDashboard() (Promise.all) and derive the next 5 hearings with date >= today (IST) sorted ascending.
  2. Pass those as rows with columns caseNo, court, purpose, status (reuse the pill mapping from hearings/HearingsTable.tsx, extract to a shared helper).
  3. When the hearings fetch errors show RefreshErrorState or '—', not an empty table.
  4. Change 'Calendar →' to next/link labelled 'View all hearings' (or hide until a calendar view exists).
- **Acceptance:**
  - With 3 hearings this week the table shows 3 rows matching the count text.
  - With 0 hearings the table shows an empty-state, not an empty grid.
  - Link uses client navigation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only. Two fetches add latency; cache is 60s already.
- **Depends on:** GAP-LEGAL-HEARINGS-04

### GAP-LEGAL-DASHBOARD-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as good news: badge only (page.tsx:29); stats fall back to zeros (loaders.ts:4085-4090) and the disposal card shows 64%.
- **Verified evidence:** apps/web/src/app/(app)/legal/dashboard/page.tsx:29 only shows DataSourceBadge when source==='error'; the page still renders. Loader falls back to LEGAL_DASHBOARD_EMPTY zeros (apps/web/src/app/_data/loaders.ts:4085-4090) and fetchJson returns {data: empty, source:'error'} on every failure (apiClient.ts:119-166), so StatCards show 0 and the disposal card shows 64%.
- **Files to change:** `apps/web/src/app/(app)/legal/dashboard/page.tsx`, `apps/web/src/app/(app)/legal/dashboard/CasesOverviewSeg.tsx`
- **Fix steps:**
  1. In page.tsx after the fetch, if source==='error' return <PageHeader/> plus <RefreshErrorState error={toHumanError('load',{area:'legal dashboard'})} backHref='/legal' /> (pattern: metadata/rules/page.tsx:23).
  2. Remove the inline DataSourceBadge branch at line 29 or keep for stale-cache only.
  3. Alternatively pass null to StatCard values (StatCard.displayValue renders '—' for null/NaN) and hide the disposal card.
- **Acceptance:**
  - Mock fetch failure: page shows the retry error state, no zeros and no 64%.
  - Retry button calls router.refresh() and recovers.
  - Healthy payload renders as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Pattern of masking errors as zeros repeats across module pages (see systemic note).
- **Depends on:** GAP-LEGAL-DASHBOARD-01

### GAP-LEGAL-DASHBOARD-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Adverse Risk' is bound to data.opinionsDue (page.tsx:27) — a count of opinions due is presented as litigation risk.
- **Verified evidence:** apps/web/src/app/(app)/legal/dashboard/page.tsx:27 StatCard label 'Adverse Risk' value={data.opinionsDue}. Opinions due is a workload count, not a litigation-risk measure. Same label on list/page.tsx:30 is derived differently (case type), so the two 'Adverse Risk' figures disagree.
- **Files to change:** `apps/web/src/app/(app)/legal/dashboard/page.tsx`
- **Fix steps:**
  1. Relabel the card 'Opinions Due' (icon changed from warning) since the value is opinionsDue.
  2. If a real risk metric is wanted, get a defined field from the backend (e.g. adverseRiskCases) and add it to LegalDashboardSchema before labelling anything 'Adverse Risk'.
  3. Align wording with list page (see GAP-LEGAL-LIST-01).
- **Acceptance:**
  - Card label matches its data source.
  - Dashboard and Cases List do not show two different numbers under the same label.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; naming only unless a new metric is added.
- **Depends on:** GAP-LEGAL-LIST-01

### GAP-LEGAL-DASHBOARD-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Cases overview scope (All / High Court / Tribunals) only changes the bold label; the three numbers do not change (CasesOverviewSeg.tsx:14-23).
- **Verified evidence:** apps/web/src/app/(app)/legal/dashboard/CasesOverviewSeg.tsx:17-27 holds scope in useState and only prints it in the bold span; activeCases, hearingsThisWeek, ordersPending props are the same for all three scopes. The segmented control is decorative. (Theme I18N is wrong; also its i18n suggestion is unrelated.)
- **Files to change:** `apps/web/src/app/(app)/legal/dashboard/CasesOverviewSeg.tsx`, `apps/web/src/app/(app)/legal/dashboard/page.tsx`
- **Fix steps:**
  1. Either remove Segmented and the scope span, or fetch scoped counts: extend /api/v1/legal/dashboard with a court-type query param (backend change; cannot verify it exists) and refetch on change.
  2. If keeping client-side only, compute counts from getLegalCases() rows filtered by court/forum, with an agreed definition of Tribunals.
  3. Show the numbers as StatCard-like tiles instead of a run-on sentence.
- **Acceptance:**
  - Switching to 'High Court' changes at least one number for data where courts differ.
  - No control on the page changes only a label.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; risk is showing wrong scoped totals if court classification is a substring guess.
- **Depends on:** GAP-LEGAL-LIST-03


---
## /legal/hearings  —  `legal/hearings.html`

- **Source:** `apps/web/src/app/(app)/legal/hearings/page.tsx`
- **Design reference:** `redesign/legal/hearings.html`

### GAP-LEGAL-HEARINGS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pill maps 'completed' to a green 'Listed' and every unknown status to 'Listed' (HearingsTable.tsx:31-40): a hearing that has been heard is labelled as upcoming.
- **Verified evidence:** apps/web/src/app/(app)/legal/hearings/HearingsTable.tsx:27-38 maps 'completed' to <span class='pill good'>Listed</span> and the default branch (incl. 'scheduled', unknown) to an info-colour 'Listed'. A heard hearing is therefore labelled Listed in green.
- **Files to change:** `apps/web/src/app/(app)/legal/hearings/HearingsTable.tsx`
- **Fix steps:**
  1. In hearingStatusPill make 'completed' render 'Heard' (pill good), 'scheduled' render 'Listed' (pill info), and default use humanizeStatus(status) via StatusPill (as LegalCasesTable does) instead of 'Listed'.
  2. Keep text labels (they already carry meaning beyond colour).
  3. Move labels to the app's i18n messages if next-intl is adopted; not required for the fix.
- **Acceptance:**
  - Unit test: completed -> 'Heard', scheduled -> 'Listed', 'foo' -> 'Foo' not 'Listed'.
  - Adjourned/cancelled unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEGAL-HEARINGS-02  ·  HIGH  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Only 'This week' and 'Today' filters exist and the default hides everything else (HearingsTable.tsx:34,68-72); past hearings and outcomes are unreachable here even though the hub tile promises 'Upcoming and past court hearings' (legal/page.tsx:10).
- **Verified evidence:** apps/web/src/app/(app)/legal/hearings/HearingsTable.tsx:25 FILTERS=['This week','Today'], default 'This week' (line 101), filtering in useMemo lines 111-117 with date>=today; the unfiltered branch (return sorted) is unreachable. Past hearings/outcomes cannot be seen. legal/page.tsx:11 promises 'Upcoming and past court hearings'. Route /legal/hearings only.
- **Files to change:** `apps/web/src/app/(app)/legal/hearings/HearingsTable.tsx`, `apps/web/src/app/(app)/legal/hearings/page.tsx`
- **Fix steps:**
  1. Add 'All' and 'Past' options to FILTERS ('Past': date < today) and consider defaulting to 'Upcoming'.
  2. Show outcome (r.outcome exists per page.tsx:15) as a column for past hearings.
  3. Make the page stats (page.tsx:13-16) consistent with the visible filter.
  4. Alternatively change the hub note to 'Upcoming hearings' if past view is deliberately out of scope.
- **Acceptance:**
  - Selecting 'Past' lists only hearings before today with outcome.
  - 'All' shows every row including completed.
  - Hub note matches behaviour.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEGAL-HEARINGS-04

### GAP-LEGAL-HEARINGS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — Calendar link removed, Sync renamed Refresh, visible+aria-live result done (HearingsActions.tsx). Step 4 missing: loader still revalidateSeconds:60 (loaders.ts:5488) and router.refresh() does not bust it, no revalidateTag/server action, so 'Hearings refreshed.' can show stale rows
- **First-pass claim:** 'Calendar view' links to /legal/hearings, the current page (HearingsActions.tsx:44); 'Sync cause list' performs a plain GET of the same endpoint and router.refresh(), not a sync, and reports success only in an sr-only region (HearingsActions.tsx:16-50).
- **Verified evidence:** apps/web/src/app/(app)/legal/hearings/HearingsActions.tsx:43 <Link href='/legal/hearings'> is the current route. sync() (lines 22-39) does a GET to /api/proxy/v1/legal/hearings then router.refresh(); success text 'Cause list synced.' goes only to an sr-only role=status span (line 51), so sighted users get no feedback. The file's own comment (lines 11-15) admits there is no sync endpoint. Note the server loader uses revalidate 60s (loaders.ts:4112), so refresh may not show new data.
- **Files to change:** `apps/web/src/app/(app)/legal/hearings/HearingsActions.tsx`
- **Fix steps:**
  1. Remove the 'Calendar view' link until a calendar route exists, or link to a real one.
  2. Rename 'Sync cause list' to 'Refresh' (honest) or disable via PlaceholderButton until a sync command exists in the legal service (backend).
  3. Show the result visibly (toast / inline text, and error text in var(--bad)) while keeping aria-live.
  4. If keeping refresh, invalidate with a revalidateTag/server action so the 60s cache does not serve stale rows.
- **Acceptance:**
  - Clicking the control shows visible 'Refreshed' or an error message.
  - No link points to the page it is on.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; a false 'synced' claim about court data is the main risk.

### GAP-LEGAL-HEARINGS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'today', 'tomorrow' and 'weekEnd' come from new Date().toISOString() (UTC) (page.tsx:9-11, HearingsTable.tsx:74): between 00:00 and 05:30 IST the page treats yesterday as today, shifting 'Today' and the countdown.
- **Verified evidence:** apps/web/src/app/(app)/legal/hearings/page.tsx:9-11 and HearingsTable.tsx:109,113 use new Date().toISOString().slice(0,10) (UTC date). Between 00:00 and 05:30 IST this is yesterday's date, so 'Today' filter, week window and daysRemaining base (line 135) shift. Observation cited HearingsTable.tsx:74; real lines are 109/113. Additionally formatIndianDate (lib/formatters.ts:2-7) has no timeZone option and outputs dd/mm/yyyy, not 'dd Mon yyyy'. On the client `today` is computed in the browser but on the server in server TZ.
- **Files to change:** `apps/web/src/app/(app)/legal/hearings/page.tsx`, `apps/web/src/app/(app)/legal/hearings/HearingsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add todayIST()/addDaysIST(n) helpers to lib/formatters.ts using Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).
  2. Use them in page.tsx:9-11 and HearingsTable.tsx:109,113 (compute in the server page and pass `today` down as a prop to avoid hydration mismatch).
  3. In daysRemaining, parse both as date-only strings at UTC midnight.
  4. Add timeZone:'Asia/Kolkata' to formatIndianDate.
- **Acceptance:**
  - Unit test with system time 2026-09-29T20:00Z (01:30 IST 30 Sep): today = 2026-09-30.
  - Hearing dated 30 Sep shows 'Today' and counts in the 'Today' filter.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; touches a shared formatter used in many modules, so run formatter tests.


---
## /legal/list  —  `legal/list.html`

- **Source:** `apps/web/src/app/(app)/legal/list/page.tsx`
- **Design reference:** `redesign/legal/list.html`

### GAP-LEGAL-LIST-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Adverse Risk' is any case whose type is 'writ' or 'criminal' (page.tsx:12, LegalCasesTable.tsx:49): a case category is presented as a risk assessment, and the same proxy drives the 'Adverse risk' filter.
- **Verified evidence:** apps/web/src/app/(app)/legal/list/page.tsx:12 counts type==='writ'||'criminal' as adverseRisk (stat card line 30) and list/LegalCasesTable.tsx:49 applies the same predicate to the 'Adverse risk' filter. Case type (a category) is presented as a risk assessment.
- **Files to change:** `apps/web/src/app/(app)/legal/list/page.tsx`, `apps/web/src/app/(app)/legal/list/LegalCasesTable.tsx`
- **Fix steps:**
  1. Drop the proxy: rename the stat 'Writ / Criminal' and the filter 'Writ & criminal' (accurate), or add a real riskLevel field via backend and filter on it.
  2. Extract the predicate to one helper so page and table cannot diverge.
  3. Remove or relabel the dashboard equivalent (GAP-LEGAL-DASHBOARD-04).
- **Acceptance:**
  - Card and filter labels describe what they count.
  - Filter count equals card count.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; misreading a category as risk could mis-prioritise litigation.
- **Depends on:** GAP-LEGAL-DASHBOARD-04

### GAP-LEGAL-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme DATA-DEFINITION (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Disposed (FY)' counts every disposed row with no financial-year date test (page.tsx:11); 'Active Cases' counts only status 'pending', so appealed and stayed matters vanish from the active count (page.tsx:9).
- **Verified evidence:** apps/web/src/app/(app)/legal/list/page.tsx:9 active = status==='pending' only, while LegalCasesTable.tsx:20-31 also knows appealed, stayed, settled; appealed/stayed matters are live yet excluded. Line 11 disposed counts all 'disposed' rows although the card is labelled 'Disposed (FY)'; the case summary fields (disposal date) are in @civitasone/types, absent here, so an FY test cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/legal/list/page.tsx`
- **Fix steps:**
  1. Define active = status in {pending, appealed, stayed} in a shared constant.
  2. Compute the FY window in IST (Apr 1 - Mar 31) and filter disposed rows by disposal date if the API exposes one; otherwise rename the card 'Disposed' (all time).
  3. Add tests for the status sets.
- **Acceptance:**
  - Dataset with 1 pending, 1 appealed, 1 stayed shows Active = 3.
  - A case disposed last FY is excluded from 'Disposed (FY)'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: counts are used for management reporting; changing definitions changes reported numbers.

### GAP-LEGAL-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme I18N (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — case-type label map ('Writ Petition' etc.) and column relabelled 'Case type'; remaining: 'High Court' filter is still a free-text substring match on court (no courtType/forum enum), undocumented
- **First-pass claim:** Subject column prints the raw type code (writ, criminal) (LegalCasesTable.tsx:73); 'High Court' filter is a substring match on free-text court names (LegalCasesTable.tsx:47).
- **Verified evidence:** apps/web/src/app/(app)/legal/list/LegalCasesTable.tsx:70 Subject column has key 'type' with no render, so raw codes such as 'writ' print (observation said line 73). Line 48 'High Court' filter is court.toLowerCase().includes('high court'), a substring match on free text, missing e.g. 'HC of Odisha'.
- **Files to change:** `apps/web/src/app/(app)/legal/list/LegalCasesTable.tsx`
- **Fix steps:**
  1. Add a render using humanizeStatus (lib/formatters.ts:44) or a case-type label map (writ -> Writ Petition, etc.).
  2. Ask backend for a courtType/forum enum and filter on it; until then keep the substring but document it.
  3. Relabel column 'Case type' since 'Subject' is misleading.
- **Acceptance:**
  - Row with type 'writ' shows 'Writ'.
  - Filter by enum returns all high-court cases.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-LEGAL-DASHBOARD-05


---
## /legal/opinions  —  `legal/opinions.html`

- **Source:** `apps/web/src/app/(app)/legal/opinions/page.tsx`
- **Design reference:** `redesign/legal/opinions.html`

### GAP-LEGAL-OPINIONS-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Avg TAT '6.2 d' with delta '-1d' is a hard-coded literal (page.tsx:31): a fabricated turnaround KPI is shown to legal officers and stays 6.2 d with zero opinions.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/page.tsx:31 hard-codes value='6.2 d' delta='-1d' up on the 'Avg TAT' StatCard; it is never computed and shows even with zero opinions.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/page.tsx`
- **Fix steps:**
  1. Remove the Avg TAT card, or compute it from issuedAt - requestedAt on issued opinions if the API exposes those (fields cannot be verified: type in @civitasone/types absent).
  2. Show '—' (StatCard renders null as '—') when there are no issued opinions.
  3. Drop the delta unless a prior period is computed.
- **Acceptance:**
  - Empty list shows '—' or no card.
  - With two issued opinions of 4d and 6d, card shows 5 d.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; fabricated KPI removal.

### GAP-LEGAL-OPINIONS-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The table has no row link (OpinionsTable.tsx:60-72, unlike LegalCasesTable's rowLinkPrefix), so /legal/opinions/[id] is unreachable from the list.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/OpinionsTable.tsx:59-72 DataTable passes no rowHref, rowLinkKey or rowLinkPrefix (DataTable.tsx:56-59,211-212 only link when provided), unlike LegalCasesTable.tsx:75-76. Route opinions/[id]/page.tsx exists, so it is reachable only by typing the URL.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/OpinionsTable.tsx`
- **Fix steps:**
  1. Add rowLinkKey='id' and rowLinkPrefix='/legal/opinions/' to the DataTable.
- **Acceptance:**
  - Clicking a row opens /legal/opinions/{id}.
  - Keyboard: the first-column link is focusable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-OPINIONS-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Precedents Tagged' is the count of status 'issued' (page.tsx:32) — there is no tagging in the data; 'Search precedents' is a disabled PlaceholderButton (page.tsx:22).
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/page.tsx:32 'Precedents Tagged' = count of status 'issued'; no tagging field is read anywhere. Line 23 <PlaceholderButton label='Search precedents'/> is a disabled coming-soon button (PlaceholderButton.tsx), which is honest but non-functional. The table filter offers name filtering only.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/page.tsx`
- **Fix steps:**
  1. Relabel card 'Issued' (value already issued count).
  2. Keep PlaceholderButton only if the roadmap is clear, else remove; the DataTable filter already searches text.
  3. If tagging is wanted, add a tags field in backend first.
- **Acceptance:**
  - No card label claims tagging.
  - No dead-looking search action, or it is clearly marked coming soon.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LEGAL-OPINIONS-05  ·  LOW  ·  partly  ·  theme WIRING (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1916 — null advisorName now shows an 'Unassigned' pill; remaining: 'Sought by' (soughtBy) is never sent by the Seek Opinion form so the column shows '—', no person name populated
- **First-pass claim:** Author defaults to 'Law Dept' when advisorName is null (OpinionsTable.tsx:67), presenting an unassigned opinion as assigned; 'Sought by' shows a raw requestedBy value which may be a user id.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/OpinionsTable.tsx:64 renders r.advisorName ?? 'Law Dept', so an unassigned opinion appears assigned (true). Line 63 prints raw requestedBy; whether it is a user id or a name cannot be verified (type in @civitasone/types absent). Theme DATEFMT is wrong; this is an assignment-state/data-mapping issue.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/OpinionsTable.tsx`
- **Fix steps:**
  1. Change the fallback to '—' or a muted 'Unassigned' pill.
  2. If requestedBy is an id, have the API return requestedByName and render that; otherwise leave.
  3. Align field names with the detail page (GAP-LEGAL-OPINIONS-DETAIL-04).
- **Acceptance:**
  - Opinion with null advisorName shows 'Unassigned'.
  - Sought by shows a person name, not a UUID.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LEGAL-OPINIONS-DETAIL-04


---
## /legal/opinions/[id]  —  `legal/opinions-detail.html`

- **Source:** `apps/web/src/app/(app)/legal/opinions/[id]/page.tsx`
- **Design reference:** `redesign/legal/opinions-detail.html`

### GAP-LEGAL-OPINIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1840, verified on main 9c5e9e9e9)
- **First-pass claim:** eOffice card asks the user to type 'Initiating officer ID' and 'Forward to officer ID' as raw employee UUIDs, validated by regex (RaiseEOfficeNote.tsx UUID_RE, submit handler); there is no officer picker, so the action is unusable for a legal officer who does not know UUIDs.
- **Verified evidence:** apps/web/src/app/_components/RaiseEOfficeNote.tsx:25 defines UUID_RE; submit() lines 102-103 reject non-UUID input; inputs at lines 175 and 179 are free text with placeholders 'employee UUID' / 'approver UUID'. No EntityPicker exists in apps/web or packages/ui-kit (grep empty). The component is shared by other modules (grants, hr, finance, procurement, contracts, assets), so all inherit the problem.
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/_components/EntityPicker.tsx`
- **Fix steps:**
  1. Create EntityPicker (searchable combobox returning {id,label}) fed by an employee/user search endpoint (name of endpoint cannot be verified; hrms-service is in the repo, confirm its list/search route).
  2. Replace the two inputs with EntityPicker, sending the id in the payload as now; keep UUID_RE as a server-shape guard only.
  3. Default initiatedBy to the logged-in user's employee id from session/whoami rather than asking.
  4. Show inline field errors instead of one generic error line.
- **Acceptance:**
  - Officer can pick an approver by name and submit; payload contains the UUID.
  - No field asks the user to type a UUID.
  - Empty approver shows 'Select an approver'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: approvals routing; wrong-approver selection must be validated server-side and audit-evented (initiatedBy should be the session user).

### GAP-LEGAL-OPINIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows 'Opinion not found ... removed or the ID is invalid' (page.tsx:19-28) because getLegalOpinionById defaults to null (loaders.ts:4145-4150); an outage reads as deletion.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/[id]/page.tsx:16-28 branches only on !opinion. getLegalOpinionById (apps/web/src/app/_data/loaders.ts:4145-4150) uses empty=null, and fetchJson returns {data:null, source:'error', status} for any failure (apiClient.ts:119-166, including 401, 5xx, network), so an outage renders 'Opinion not found ... removed or the ID is invalid'. LoaderResult carries `status`, so 404 could be told apart.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status too; if source==='error' && status!==404 render <RefreshErrorState error={toHumanError('load',{area:'legal opinion'})} backHref='/legal/opinions' />.
  2. Reserve the 'not found' EmptyState (or notFound()) for status===404 or a successful null.
  3. Reuse for the other legal detail loaders.
- **Acceptance:**
  - Mock 500: retry state shown, not 'not found'.
  - Mock 404: not-found state shown.
  - Network failure: retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-LEGAL-OPINIONS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Detail reads counselName/soughtBy while the list reads advisorName/requestedBy (opinions/OpinionsTable.tsx:11-12), and Status appears three times (header pill, stat card, detail row) (page.tsx:60,71); Question text is legal advice shown without a privilege/confidentiality marker.
- **Verified evidence:** Detail reads counselName/counsel_name and soughtBy/sought_by (page.tsx:34-35) while the list reads advisorName/requestedBy (opinions/OpinionsTable.tsx:11-12); the detail's field() has no fallback to the list's names. Which set the API returns cannot be verified because LegalOpinionSummary lives in @civitasone/types (absent) and the detail loader is an untyped Record. If the API uses the list names, the detail shows '—' for Counsel/Sought By. Status is rendered three times: header pill line 53, stat card line 60, detail row line 71 (true). No privilege/confidentiality marker near the Question field (line 72-77) (true).
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/[id]/page.tsx`
- **Fix steps:**
  1. Check the real API payload for /api/v1/legal/opinions/{id} and add a typed schema; add advisorName/requestedBy as additional keys in field() calls at lines 34-35 as an interim.
  2. Remove the Status stat card (line 60) and detail row (line 71), keep the header pill.
  3. Add a 'Privileged and confidential' badge next to the Question card, and gate visibility by role if required.
  4. Apply the same to OpinionsTable.
- **Acceptance:**
  - Opinion returned with advisorName shows it as Counsel.
  - Status appears once.
  - Question section shows a privilege marker.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: legal advice text; privilege marking is a policy decision.
- **Depends on:** GAP-LEGAL-OPINIONS-05

### GAP-LEGAL-OPINIONS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916 and #1804, verified on main 9c5e9e9e9)
- **First-pass claim:** Breadcrumbs are plain <a> (full page reload) rather than Link (page.tsx:46-48); eFile classification defaults to 'confidential' inside RaiseEOfficeNote without showing it to the user.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/[id]/page.tsx:22-23 and 42-43 use <a href> for breadcrumbs (full reload; no next/link) in both branches. RaiseEOfficeNote.tsx:60 defaults classification to 'confidential' and it is sent in the payload (line 108) with no UI showing or letting the user change it. PageHeader already has back='/legal/opinions'.
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/[id]/page.tsx`, `apps/web/src/app/_components/RaiseEOfficeNote.tsx`
- **Fix steps:**
  1. Replace the <a> breadcrumbs with next/link Link, or drop the manual nav and use a shared Breadcrumbs component if it exists.
  2. In RaiseEOfficeNote add a read-only line or select showing 'Classification: Confidential' before submit.
  3. Make classification a prop passed by each caller (legal detail passes explicitly).
- **Acceptance:**
  - Breadcrumb navigation is client-side (no full reload).
  - Raise form shows the classification that will be sent.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; showing classification may prompt users to change it, which is intended.


---
## /legal/opinions/new  —  `legal/opinions-new.html`

- **Source:** `apps/web/src/app/(app)/legal/opinions/new/page.tsx`
- **Design reference:** `redesign/legal/opinions-new.html`

### GAP-LEGAL-OPINIONS-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The request is stored as an outbound legal notice (direction 'sent') because no opinions create endpoint exists (SeekOpinionForm.tsx:9-13,31-36): it never appears in the Legal Opinions repository, so the requester is redirected to a list that does not contain what was just submitted.
- **Verified evidence:** opinions/new/SeekOpinionForm.tsx:9-13 comment and lines 31-37: POST /api/proxy/v1/legal/notices with direction 'sent'; on success router.push('/legal/opinions'), whose list is from GET /api/v1/legal/opinions (loaders.ts:4136), a different resource. So the submitted request does not appear. Whether the legal-service has or lacks an opinions create endpoint cannot be verified (service not in snapshot; only hrms-service).
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/new/SeekOpinionForm.tsx`, `apps/web/src/app/(app)/legal/opinions/new/page.tsx`
- **Fix steps:**
  1. Backend: add POST /legal/opinions (zod-validated, audit event, server-issued opinionNo) and return the created id.
  2. Web: switch the POST in SeekOpinionForm to it and redirect to /legal/opinions/{id}.
  3. Until then, redirect to the notices view showing the item, or state clearly on success that it was recorded as a notice.
  4. Send collected fields: question text (the form has no separate question field today).
- **Acceptance:**
  - Submit creates a row visible in the Legal Opinions list with status pending.
  - Success redirects to its detail page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: a legal request is silently filed in the wrong register; requester may think it was lost and resubmit.
- **Depends on:** GAP-LEGAL-OPINIONS-NEW-02

### GAP-LEGAL-OPINIONS-NEW-02  ·  MEDIUM  ·  partly  ·  theme ID-GEN (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Reference no is generated client-side as OPN/<year>/<random 100-999> when blank (SeekOpinionForm.tsx:30), not a server sequence: collisions are possible and it does not follow the OPN/2026/NNN series in the repository.
- **Verified evidence:** SeekOpinionForm.tsx:30 does generate OPN/<year>/<100-999> with Math.random when blank, a client-side value sent as noticeNo. Collision and non-series claims are true. The theme CAP (pagination cap) is wrong; and it is a notice number, not an opinion number, since the form posts to notices (uniqueness enforcement in the service cannot be verified).
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/new/SeekOpinionForm.tsx`
- **Fix steps:**
  1. Remove client generation at line 30; send noticeNo/opinionNo only if the user typed it, and let the server allocate the series (OPN/2026/NNN) atomically.
  2. Show the assigned number in the success state/redirect.
  3. Change the placeholder to 'Assigned on submit'.
- **Acceptance:**
  - Blank reference: server returns next number in series; two rapid submits get distinct numbers.
  - No Math.random in the form.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: duplicate references on legal records.
- **Depends on:** GAP-LEGAL-OPINIONS-NEW-01

### GAP-LEGAL-OPINIONS-NEW-04  ·  LOW  ·  partly  ·  theme COPY (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The banner exposes an implementation detail ('legal notice ... closest available command') to end users (page.tsx:16-17); the confirm dialog says the request 'cannot be withdrawn' though no withdraw endpoint was read.
- **Verified evidence:** apps/web/src/app/(app)/legal/opinions/new/page.tsx:16-17 banner does expose 'legal notice ... closest available command' to end users (true). The confirm dialog (SeekOpinionForm.tsx:96) states the request 'cannot be withdrawn'; no withdraw call exists in the web code, but backend cannot be verified. The dialog is a plain confirm and the comment calls it 'maker-checker', which it is not (no reason field, same user).
- **Files to change:** `apps/web/src/app/(app)/legal/opinions/new/page.tsx`, `apps/web/src/app/(app)/legal/opinions/new/SeekOpinionForm.tsx`
- **Fix steps:**
  1. Remove the implementation-detail banner (or show only in non-prod) once GAP-LEGAL-OPINIONS-NEW-01 is fixed; until then reword to 'Your request will be sent to the addressee'.
  2. Confirm with backend whether withdrawal exists; adjust the dialog text accordingly.
  3. Fix the maker-checker comment.
- **Acceptance:**
  - Banner has no reference to notices/commands.
  - Dialog wording matches actual capability.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LEGAL-OPINIONS-NEW-01


---
## Backend verification items (service code absent from snapshot)

### GAP-LEGAL-HOME-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** legal/layout.tsx:6 lets finance_admin into the whole Legal module (cases, opinions, privileged advice text) with no per-page or per-action narrowing; every page below renders its write buttons for all five roles. legal-service is not in the snapshot (only services/hrms-service), so server-side enforcement is undeterminable.
- **Service:** `legal-service`  ·  **Endpoint(s):** `['all /api/v1/legal/* routes']`
- **Question:** Do legal-service routes enforce a per-route role allow-list that excludes finance_admin from cases, opinions and privileged advice, independent of the web layout?
- **How to verify:** Open legal-service route preHandlers; curl GET /v1/legal/opinions/:id and POST /v1/legal/cases with a finance_admin JWT expecting 403.
- **Test to add:** Given finance_admin token, when GET opinion detail or POST case, then 403 FORBIDDEN and no data returned.
- **Impact if wrong:** Privileged legal advice readable by non-legal staff; loss of privilege.
- **Web change if wrong:** Narrow ALLOWED in legal/layout.tsx:6 and hide write buttons per role.

### GAP-LEGAL-CASES-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Petitioner/respondent names (party PII) print unmasked and there is no privilege marker; counsel-briefs endpoint, audit on POSTs and fee handling are undeterminable (legal-service absent from snapshot, referenced only in CaseActions.tsx comments).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['GET /api/v1/legal/cases/:id', 'POST /api/v1/legal/counsel-briefs', 'POST /api/v1/legal/cases/:id/orders']`
- **Question:** Does GET cases/:id return party names only to roles allowed to see them, do the POSTs write an audit row (actor, case id, action), and is fee handling validated server-side?
- **How to verify:** Open services/legal-service/src/modules/cases + counsel routes; check role preHandler and audit insert; curl GET /v1/legal/cases/:id as finance_admin and as legal_officer and diff party fields.
- **Test to add:** Given a finance_admin token, when GET case detail, then partyNames are masked or 403; given legal_officer POST counsel-briefs, then one audit row with actor+caseId exists.
- **Impact if wrong:** DPDP exposure of litigant PII; unaudited counsel fee commitments.
- **Web change if wrong:** If unmasked/unaudited, mask party names client-side by role and add privilege marker field to page.

### GAP-LEGAL-CASES-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** After success the user is sent to the list, not the new case (CreateCaseForm.tsx:56); duplicate case number handling and audit on create are undeterminable (legal-service absent from snapshot).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['POST /api/v1/legal/cases']`
- **Question:** Does create reject a duplicate case number with 409 and a field-level error, return the new id, and write an audit row?
- **How to verify:** Open legal-service cases create handler + unique index on (court, caseNo); curl POST the same body twice as legal_officer expecting 201 then 409; inspect audit table.
- **Test to add:** Given case CN-1 exists, when POST case with CN-1, then 409 DUPLICATE_CASE_NO; on success response contains data.id and audit action legal.case.created.
- **Impact if wrong:** Duplicate case records split hearing/order history; no audit trail of who registered a case.
- **Web change if wrong:** If response has id, redirect to /legal/cases/:id in CreateCaseForm.tsx:56; surface 409 as field error.

### GAP-LEGAL-COURT-ORDERS-NEW-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The form has no compliance deadline or 'compliance required' control (body has only orderType, summary, orderDate, direction, deptRef; RecordOrderForm.tsx:30-36) yet the Court Orders page counts Compliance Due and Contempt Risk from complianceRequired/complianceDeadline (court-orders/page.tsx:15-19): orders recorded through the UI cannot become due or at-risk. Whether the backend defaults these is undeterminable (legal-service absent).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['POST /api/v1/legal/cases/:id/orders', 'GET /api/v1/legal/court-orders']`
- **Question:** When POST orders omits complianceRequired/complianceDeadline, does the service derive them (default false/null or by orderType) so Compliance Due and Contempt Risk counts are meaningful?
- **How to verify:** Open legal-service orders create handler and schema defaults; curl POST body {orderType:'direction',summary,orderDate,direction,deptRef} and GET the order, inspect complianceRequired/complianceDeadline.
- **Test to add:** Given a direction-type order posted with no compliance fields, when listed, then complianceRequired=true and deadline derived from direction (or explicit null documented).
- **Impact if wrong:** Contempt exposure: orders with deadlines never appear as due, so court directions are missed.
- **Web change if wrong:** Add complianceRequired checkbox + complianceDeadline date to RecordOrderForm.tsx:30-36 and send them in body.

### GAP-LEGAL-DASHBOARD-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Description text colour and card copy use hard-coded #667085 rather than tokens (page.tsx:43,58,68); backend legal-service not in snapshot so the counters' definitions are undeterminable.
- **Service:** `legal-service`  ·  **Endpoint(s):** `['GET /api/v1/legal/dashboard (loader in legal/dashboard/page.tsx)']`
- **Question:** How does the service define each dashboard counter (open, hearings this week, overdue) and is the count scoped by user role/department?
- **How to verify:** Open the legal-service dashboard/summary query; compare filters to labels on page.tsx; curl as two roles and compare counts against list endpoints.
- **Test to add:** Given 3 open + 2 disposed cases, when GET dashboard, then openCases=3 and matches GET cases?status=open total.
- **Impact if wrong:** Misleading management counters.
- **Web change if wrong:** Relabel cards to match server definition; replace #667085 with a token (page.tsx:43,58,68) independent of backend.

### GAP-LEGAL-HEARINGS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Countdown colours are hard-coded hex (#b42318, #b54708, #067647) (HearingsTable.tsx:60-79); reminder POST audit and recipient are undeterminable (legal-service absent from the snapshot).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['POST /api/v1/legal/cases/:id/reminder', 'POST /api/v1/legal/hearings']`
- **Question:** Does the reminder POST resolve recipients server-side (assigned counsel/officer), enqueue via notification queue, and write an audit row?
- **How to verify:** Open legal-service reminder handler; curl POST reminder as legal_officer; check queue message recipients and audit row.
- **Test to add:** Given case with assigned officer, when POST reminder, then one notification event to that officer and audit legal.hearing.reminder; a role without access gets 403.
- **Impact if wrong:** Reminders silently go nowhere or to wrong people; missed hearings.
- **Web change if wrong:** If no such route exists, hide reminder action in HearingsTable.tsx:153.

### GAP-LEGAL-LIST-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Counsel is a free-text name with '—' fallback (LegalCasesTable.tsx:74); legal-service is not in the snapshot, so whether advocateName is joined from a counsel master is undeterminable.
- **Service:** `legal-service`  ·  **Endpoint(s):** `['GET /api/v1/legal/cases']`
- **Question:** Is advocateName a free-text column or joined from a counsel master (counsel id -> name) in the list response?
- **How to verify:** Open legal-service cases list query/schema; curl GET cases and inspect advocateName/counselId fields.
- **Test to add:** Given case linked to counsel C1, when GET list, then advocateName equals C1.name and counselId is present.
- **Impact if wrong:** Inconsistent counsel names break counsel-wise reporting.
- **Web change if wrong:** Link counsel to counsel detail using counselId in LegalCasesTable.tsx:74 if provided.

### GAP-LEGAL-OPINIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** List reads advisorName / requestedBy (OpinionsTable.tsx:11-12) while the detail page reads counselName / soughtBy (opinions/[id]/page.tsx:41-42): field names disagree, so one of the two shows blanks; whether the API returns both is undeterminable (legal-service not in snapshot).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['GET /api/v1/legal/opinions', 'GET /api/v1/legal/opinions/:id']`
- **Question:** Do list and detail return the same field names (advisorName/counselName, requestedBy/soughtBy)?
- **How to verify:** Compare response DTOs in legal-service; curl both endpoints for one id and diff keys.
- **Test to add:** Given one opinion, when GET list and detail, then counsel and requester fields resolve to same values under documented names.
- **Impact if wrong:** Blank counsel/requester on one screen.
- **Web change if wrong:** Align field names in OpinionsTable.tsx:11-12 and opinions/[id]/page.tsx:41-42 to the real DTO.

### GAP-LEGAL-OPINIONS-DETAIL-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** After raising the eFile the component silently POSTs /api/proxy/v1/legal/opinions/:id/submit-approval and swallows any error (RaiseEOfficeNote.tsx notifyPath try/catch); SeekOpinionForm.tsx:9-11 says legal-service has no opinions write endpoint, so this route likely does not exist — undeterminable (legal-service absent).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['POST /api/v1/legal/opinions/:id/submit-approval']`
- **Question:** Does this route exist, and if so does it require the eFile reference, restrict roles and write an audit row?
- **How to verify:** Grep legal-service routes for submit-approval; if absent curl POST expecting non-404.
- **Test to add:** Given opinion id, when POST submit-approval with valid role, then 200 and audit row; unknown id gives 404 and web shows the error.
- **Impact if wrong:** Approval notification silently lost while UI shows success.
- **Web change if wrong:** Remove swallow-all try/catch in RaiseEOfficeNote.tsx notifyPath or drop the call if route is absent.

### GAP-LEGAL-OPINIONS-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Addressed to' is free text sent as partyRef (SeekOpinionForm.tsx:39) with no directory or role picker, so routing 'to the addressee' (page.tsx:16) depends on typing an exact reference; how partyRef is resolved is undeterminable (legal-service absent).
- **Service:** `legal-service`  ·  **Endpoint(s):** `['POST /api/v1/legal/notices']`
- **Question:** How is partyRef resolved (employee id, dept code, free text) and is an unresolvable value rejected with 422?
- **How to verify:** Open legal-service notices create handler/validator; curl POST with partyRef 'xyz' expecting 422.
- **Test to add:** Given unknown partyRef, when POST notice, then 422 with field partyRef; valid directory id creates a routed notice.
- **Impact if wrong:** Opinion requests routed to nobody.
- **Web change if wrong:** Replace free text with directory picker in SeekOpinionForm.tsx:39.
