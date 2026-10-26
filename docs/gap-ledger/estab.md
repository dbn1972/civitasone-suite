# Detailed gap file — module `estab`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 159, BACKEND-VERIFY 4, CANNOT-VERIFY 1



---
## /estab  —  `estab/home.html`

- **Source:** `apps/web/src/app/(app)/estab/page.tsx`
- **Design reference:** `redesign/estab/home.html`

### GAP-ESTAB-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Eight built routes have no hub tile: inbox, dfa, approval-matrix, operators, handover, migration, notifications, workspace — they are reachable only from the 10-link sub-nav on /estab/list (list/page.tsx:63-74), except workspace (a header button there). A new clerk starting at the hub cannot find "My Desk".
- **Verified evidence:** estab/page.tsx:9-22 passes exactly 12 links (dashboard, list, dak, dispatch, approvals, files/new, meetings, vehicles, guesthouse, quarters, library, compliance). Route dirs inbox, dfa, approval-matrix, operators, handover, migration, notifications, workspace exist under estab/ but have no tile. list/page.tsx:63-74 <nav className='subnav'> holds 10 links (inbox, dak, dispatch, dfa, approvals, approval-matrix, operators, handover, migration, notifications); workspace is the 'Guided File' button at list/page.tsx:46.
- **Files to change:** `apps/web/src/app/(app)/estab/page.tsx`
- **Fix steps:**
  1. Add ModuleHub links for My Desk (/estab/inbox), Guided File (/estab/workspace), DFA, Approval Matrix, Operators, Charge Handover, Migration, Notifications with notes.
  2. Consider grouping tiles (Daily work / Administration) if ModuleHub supports sections; otherwise keep flat.
  3. Gate admin tiles (operators, approval-matrix, migration) per HOME-04.
- **Acceptance:**
  - Manual: hub shows a My Desk tile that opens /estab/inbox.
  - Test: rendered hub link list includes all 8 hrefs.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-HOME-04

### GAP-ESTAB-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** error.tsx sends "Back to Establishment" to /estab/list (a sub-page), not the hub (error.tsx:9-11).
- **Verified evidence:** estab/error.tsx:10-11 sets backHref='/estab/list' with label 'Back to Establishment'. RouteError (_components/RouteError.tsx) supports backHref, so the fix is a value change.
- **Files to change:** `apps/web/src/app/(app)/estab/error.tsx`
- **Fix steps:**
  1. Set backHref="/estab" (keep label) or relabel to 'Back to File Register' if list is intended.
- **Acceptance:**
  - Manual: trigger an error on /estab/inbox; back link goes to /estab.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-HOME-03  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx paints a stats + table skeleton for a hub that has neither, and is inherited by every estab child without its own loading.tsx (loading.tsx:5-15).
- **Verified evidence:** estab/loading.tsx:5-13 renders a title, 4 stat blocks and a 72-high table block using raw tailwind slate classes (min-h-screen bg-slate-50), unlike the DS. The hub is ModuleHub tiles. Only estab/quarters/loading.tsx exists as a child override, so all other children inherit this.
- **Files to change:** `apps/web/src/app/(app)/estab/loading.tsx`, `apps/web/src/app/(app)/estab/page.tsx`, `apps/web/src/app/_components/ds/Skeleton.tsx`
- **Fix steps:**
  1. Make estab/loading.tsx a generic header + list skeleton using ds/Skeleton, without min-h-screen/bg-slate-50.
  2. Add estab/loading.tsx tile-grid variant colocated with the hub only if hub route gets its own segment; otherwise add loading.tsx to hub-specific loader (page is static so no loading needed).
- **Acceptance:**
  - Manual: throttle network; hub does not flash a stats/table skeleton.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-HOME-04  ·  LOW  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub renders all 12 tiles for every role; no role gating is present anywhere in the estab tree (grep requireAnyRole/canAdminister: none), so approval and approval-matrix routes are only hidden by omission.
- **Verified evidence:** grep of the estab tree finds no requireAnyRole/canAdminister, and the hub renders all 12 tiles unconditionally (page.tsx:9-22). But the example is off: /estab/approvals IS a hub tile (page.tsx:14); only approval-matrix, operators, migration are un-tiled. Whether the server enforces roles cannot be verified (no estab service in snapshot).
- **Files to change:** `apps/web/src/app/(app)/estab/page.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`
- **Fix steps:**
  1. Identify the shared role/permission helper used in other modules (none found in estab) and add an optional `roles` prop per ModuleHub link.
  2. Hide tiles the session lacks roles for; verify the estab service returns 403 for those routes.
- **Acceptance:**
  - Test: user without admin role does not see Approval Matrix tile.
  - API check: direct GET returns 403.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** UI hiding is not security; server enforcement must be confirmed.
- **Depends on:** GAP-ESTAB-HOME-01


---
## /estab/approval-matrix  —  `estab/approval-matrix.html`

- **Source:** `apps/web/src/app/(app)/estab/approval-matrix/page.tsx`
- **Design reference:** `redesign/estab/approval-matrix.html`

### GAP-ESTAB-APPROVAL-MATRIX-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed GET renders only a small red text line while the panel shows "No approval rules yet … modules use their explicitly supplied approval chain" (ApprovalMatrixPanel.tsx:69,166,215). An admin may add a duplicate rule on top of a matrix that exists but did not load.
- **Verified evidence:** apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx:79-96 load() sets error text on !res.ok and leaves rules=[]; loading is false, so :229 grouped.length===0 shows 'No approval rules yet ... modules use their explicitly supplied approval chain' (:215 in file numbering) below a small red <p> (:166). Add-rule form stays enabled, so an admin can add a duplicate for an existing but unloaded band.
- **Files to change:** `apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx`
- **Fix steps:**
  1. Add a loadFailed boolean (set in both error branches of load(), cleared on success).
  2. When loadFailed render <ErrorState error={toHumanError('load',{area:'approval rules'})} onRetry={() => void load()}/> (as dak/page.tsx:160 does) instead of the empty card.
  3. Disable the 'Add rule' Button while loadFailed.
  4. Keep the empty message only when the load succeeded with zero rules.
- **Acceptance:**
  - Test: mock GET 500 -> Retry button shown, empty text absent, Add rule disabled.
  - Mock 200 [] -> empty message shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents duplicate approval-band rules (business control).

### GAP-ESTAB-APPROVAL-MATRIX-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was PII)

- [~] **Status** (W2 estab rescan: partly done. BUILT: the approver-role catalogue is read from deployment configuration (ESTAB_APPROVER_ROLES, services/estab-service/src/modules/approval-rules/roleCatalogue.ts) and served with GET /v1/estab/approval-rules as approverRoles; POST and PATCH refuse a chain naming a role outside it (422 UNKNOWN_APPROVER_ROLE); the matrix shows an ordered picker (Earlier / Later / Remove) limited to those roles and falls back to format-checked text when no list is configured. Tests: approval-rules-role-catalogue.test.ts, ApproverChainPicker.test.tsx, ApprovalMatrixPanel.roles-and-polling.test.tsx. NOT BUILT (OWNER DECISIONS): (1) which role list is authoritative for the tenant: ESTAB_APPROVER_ROLES ships empty, so until it is set an unknown but well-formed role is still accepted; (2) whether overlapping bands must be rejected server-side: approval-rules/resolver.ts deliberately resolves overlaps by precedence, while the web blocks them when a rule is created. For (1), a candidate source is the identity RBAC role list (GET /v1/admin/roles); ESTAB_APPROVER_ROLES is deployment-wide, not per tenant. Validation errors in the matrix form are announced with role=alert.)
- **W2 estab note:** REOPENED in W2 (was an unverified W0 tick). The web part holds (validateBands blocks overlap, gap warns; bands.test.ts) but the acceptance 'an unknown role is not selectable or produces an error' is not met: approver roles are still free text checked only by a lowercase-token regex, and estab-service accepts any role string. NEEDS OWNER DECISION: which list of approver roles is authoritative, and whether overlapping bands should be rejected server-side (approval-rules/resolver.ts deliberately resolves overlaps by precedence).
- **First-pass claim:** Approver roles are free-text CSV, turned into labels by string-casing (panel:105-109); a typo yields a chain that no one can satisfy, and there is no overlap/gap check between amount bands.
- **Verified evidence:** apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx:105-109 (submit) splits rolesCsv by comma and builds label by string casing; role is sent as-typed with no check against a role list. Nothing in the panel compares min/max between existing rules of the same sourceType, so overlaps and gaps are undetected client-side. Server-side validation cannot be verified (estab service absent). Theme 'PII' is wrong.
- **Files to change:** `apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx`
- **Fix steps:**
  1. Replace the free-text CSV with a multi-select/ordered chip picker populated from an existing role list endpoint (find one under /api/proxy/v1; confirm with backend) with drag order = chain order.
  2. Add a pure function validateBands(existing: Rule[], candidate) that flags overlap and gap for the same sourceType among active rules; show inline warning (block on overlap).
  3. Validate the form with a zod schema (label, code, roles>=1, min<=max) before POST.
  4. Backend must also reject unknown roles and overlapping bands.
- **Acceptance:**
  - Unit tests for validateBands: [0,100k],[100k,500k] ok; [0,200k] vs [100k,500k] overlap; [0,100k],[200k,inf] gap warning.
  - Typing an unknown role is not selectable/produces an error.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval routing correctness; a wrong chain can stall or bypass financial sanctions.

### GAP-ESTAB-APPROVAL-MATRIX-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** Source-type labels, group headings and the Module action select were already human-labelled (ApprovalMatrixPanel.test.tsx asserts option text 'Finance: Sanction' with value finance_sanction, and no snake_case heading). This PR heads the Workflow column 'Workflow code' (t(), en+hi) and keeps the code as mono secondary text; the code input itself is an admin-entered identifier.
- **W0 note:** partly fixed by #1916 — Source-type labels humanised; Workflow column and code input still raw
- **First-pass claim:** Group headings and the Module action select show raw codes (finance_sanction, hr_leave_special …) and the Workflow column shows the raw definition code (panel:24-40,176,221-235).
- **Verified evidence:** apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx: SOURCE_TYPES const (:24-30) rendered raw as <option>{s} (:176), group heading <h3>{sourceType} (:219), and Workflow column shows workflowDefinitionCode in mono (:226). Approver labels are casing-derived, not translated. No next-intl usage in the file. The workflow code column is arguably legitimate technical detail for admins, but headings/options are not.
- **Files to change:** `apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx`, `apps/web/messages (locale files; path to confirm)`
- **Fix steps:**
  1. Add a SOURCE_TYPE_LABEL map (or next-intl keys) e.g. finance_sanction -> 'Finance: Sanction' and use it in the select, group h3 and table.
  2. Keep the raw code as a small secondary mono text or title attribute.
  3. Show workflow definition name if the API returns one; otherwise keep code with a header 'Workflow code'.
- **Acceptance:**
  - Render test: option text for finance_sanction is the human label and value remains the code.
  - No underscore strings in group headings.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-APPROVAL-MATRIX-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Amount inputs are whole-rupee numbers converted with Math.round(Number(x)*100) (panel:112-113) — decimals, negatives beyond min=0 and max<min are not validated client-side.
- **Verified evidence:** apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx:112-113 (submit) minMinor=Math.round(Number(form.minRupees||'0')*100), maxMinor likewise; inputs :185/:189 are type=number min=0 but no step, no submit-time checks: negatives typed manually, decimals like 1.005 round wrongly through float (100.499..), max<min is sent. Display helper rupees() (:55-58) uses minor/100 with toLocaleString instead of shared formatINR. Payload uses number minor units (paise) which is per CLAUDE.md, but the conversion violates 'no Math.round(x*100)'.
- **Files to change:** `apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx`
- **Fix steps:**
  1. Add a parseRupeesToPaise(str) helper (string-based split on '.', max 2 decimals, integer paise, reject negative/NaN) in lib/formatters or lib/money and use it for both fields.
  2. Validate min<=max and integer>=0 before POST with a zod schema; show field-level errors.
  3. Use the shared formatINR for rupees() display.
  4. Set step='0.01' on the inputs.
- **Acceptance:**
  - Unit: parseRupeesToPaise('1.005') rejects (3 decimals), '12.34' -> 1234, '-1' rejects.
  - Form: max<min shows error and no POST is sent.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: wrong band boundaries alter who approves what.

### GAP-ESTAB-APPROVAL-MATRIX-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: bounded poll + optimistic Pending row + timers cleared on unmount; ApprovalMatrixPanel.test.tsx 'shows a Pending row immediately and replaces it once the rule appears') — W2 estab rescan evidence: the Pending row now stays across polls (kept apart from the server rows and matched by the id the service accepted), the tables stay on screen during polls (no Loading swap, a failed poll is ignored), poll side effects no longer run inside a state updater, a toggle shows Pending until the new flag lands, and timers are cancelled on unmount; ApprovalMatrixPanel.roles-and-polling.test.tsx covers the 3rd-poll replace and the still-processing message after the limit. (W2 estab rescan: completed by #2132)
- **First-pass claim:** Create and toggle are asynchronous ("queued") with a fixed 800 ms reload (panel:134-136,157): the new rule frequently will not be visible yet, with no pending row.
- **Verified evidence:** apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx:134-136 (submit) sets message 'queued. It will appear once processed.' then setTimeout(load, 800); toggleActive :157 does the same. If the write is asynchronous the row can be absent (or stale active flag) after the fixed delay; there is no pending row/optimistic entry, and the timeout is never cleared on unmount. Whether backend is actually async cannot be verified (service absent); the 'queued' wording implies it.
- **Files to change:** `apps/web/src/app/(app)/estab/approval-matrix/ApprovalMatrixPanel.tsx`
- **Fix steps:**
  1. Replace setTimeout with a bounded poll (e.g. retry load() up to 5x at 1s) until a rule with the submitted label/sourceType appears, or until the PATCH'd rule shows the new active value.
  2. Add an optimistic 'Pending' row with StatusPill status='pending' until confirmed.
  3. Clear timers in useEffect cleanup.
- **Acceptance:**
  - Test with fake timers: rule appears on 3rd poll -> pending row replaced.
  - Never appears -> message 'still processing, refresh later' after limit.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /estab/approvals  —  `estab/approvals.html`

- **Source:** `apps/web/src/app/(app)/estab/approvals/page.tsx`
- **Design reference:** `redesign/estab/approvals.html`

### GAP-ESTAB-APPROVALS-01  ·  HIGH  ·  confirmed  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Queue is fetched with limit=50 across all modules and then filtered client-side to refType "estab_file" (EstabApprovalsPanel.tsx:29,33); if other modules hold 50+ pending tasks the approver sees a false "No approvals pending". No pager or "showing first 50".
- **Verified evidence:** apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:29 fetches /api/proxy/v1/workflow/tasks?status=pending&limit=50 and :33 filters client-side to refType==='estab_file'. Tasks from other modules count against the 50, so estab tasks can be cut off and the EmptyState 'No approvals pending' (:91) shows. No pager or truncation notice. Whether the API supports a refType filter or cursor cannot be verified (workflow service absent). Theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`
- **Fix steps:**
  1. If the workflow API accepts refType (confirm with backend), request status=pending&refType=estab_file&limit=50 so filtering is server-side.
  2. Otherwise page through with the API's cursor/offset until exhausted or use a much larger limit with a truncation flag.
  3. Show 'Showing first N; more exist' when the response returns a full page, and never show the empty state when the raw response length===limit.
- **Acceptance:**
  - Test: mock 50 non-estab tasks then 2 estab on page 2 -> both estab shown.
  - Full page of 50 with zero estab matches -> notice, not empty state.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approver may miss pending noting approvals (SLA / governance risk).

### GAP-ESTAB-APPROVALS-02  ·  HIGH  ·  confirmed  ·  theme COPY (was CONFIRM)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9) — W2 estab rescan evidence: one shared sentence (DSC_NOT_APPLIED_COPY in estab/_shared/signatureCopy.ts) now feeds the Approvals dialog, DfaPanel's Sign dialog (was inline 'arrives in Phase 2') and the file-detail Sign-note dialog (was 'e-signature'); the register banner says 'signed note sheets'; signatureCopy.test.tsx pins the parity and scans estab sources for DSC e-sign / Phase 2 claims. The owner should still confirm the wording (DSC is not applied yet). Rework 2: the file detail's Notes column called a signed note 'e-Signed'; it now reads 'Signed (hash-chained note)' (NOTE_SIGNED_LABEL in estab/_shared/signatureCopy.ts), matching the Sign-note dialog, and the test pins it. The estab-service printed note sheet (files/note-sheet-print/routes.ts) still prints 'e-Signed' for green notes: left for the owner, not changed here. (W2 estab rescan: completed by #2132)
- **First-pass claim:** Approval dialog and success text claim a "DSC e-signature" / "DSC e-Signed" (panel:67,119) while DfaPanel states cryptographic e-Sign/DSC "arrives in Phase 2" (dfa/DfaPanel.tsx:153) — the same product makes contradictory legal claims about what the signature is.
- **Verified evidence:** apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:119 dialog text 'records your DSC e-signature' and :67 'DSC e-Signed', button 'Approve & e-Sign' (:116), page subtitle 'approve yellow notes to green (e-Signed)' (apps/web/src/app/(app)/estab/approvals/page.tsx:9); estab/dfa/DfaPanel.tsx:153 says 'Cryptographic e-Sign/DSC arrives in Phase 2.' Nothing in this panel invokes a DSC/signing step: complete() (:53-76) just POSTs decision+reason to /workflow/tasks/:id/complete. Contradictory legal claim confirmed. (Reason is already required via requireReason.)
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`, `apps/web/src/app/(app)/estab/approvals/page.tsx`, `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`
- **Fix steps:**
  1. DECISION: state the true signature level (recorded approval vs DSC). If DSC not live, reword dialog to 'Records your approval (user, time, remarks) on the noting. DSC signature is not applied.'
  2. Rename button/success text/subtitle to 'Approve' and 'Approved' and remove 'DSC e-Signed'.
  3. Centralise the wording in one constant shared with DfaPanel.
- **Acceptance:**
  - Grep for 'DSC' shows only accurate wording.
  - Dialog text matches DfaPanel.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Legal wording on government file notings; wrong claim could be challenged.

### GAP-ESTAB-APPROVALS-03  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9) — W2 estab rescan evidence: GET /v1/estab/files/:id answers a bare file DTO (not wrapped in { data }), which the old panel and its test got wrong, so File and Subject always fell back to a UUID slice and a dash. The panel now reads fileNo, subject and noteSheets from the real shape, shows the latest note (excerpt, author, date) in the row, quotes it in the Approve dialog, and each row has 'Open note in a new tab'; EstabApprovalsPanel.context.test.tsx uses the real shape. Rework after review: a secret or top-secret file shows its number and '[Classified]' with no subject, note excerpt or author in the row and no quoted note in the Approve dialog (lib/estab/classification.ts, shared with the register; a DTO without a classification is treated as classified); the 'Open note in a new tab' link is named with its file number. Still open for the owner: the per-row GET /v1/estab/files/:id publishes the break-glass read_top_secret audit for every top-secret file each time the queue loads (the fetch was already there); a lighter source for file number and classification would avoid that. Rework 2: the note shown is the one under approval, the newest note with noteStatus submitted, not a later draft or rejected note (latestNoteOf); the dialog labels it 'Note submitted for approval', and only when no note is submitted does the newest note stand in, labelled 'Latest note on this file'. (W2 estab rescan: completed by #2132)
- **First-pass claim:** Approver decides blind: a row shows only task name, an 8-char file id and a raw role (panel:95-108). File number, subject and note text are not shown, yet the action is irreversible ("This cannot be undone").
- **Verified evidence:** apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:95-108 columns: Task name, File (link to /estab/files/{refId} showing first 8 chars, :100-105), Role. So file details are one click away and the link exists, but the row has no file number, subject or note text, so the dialog decision (:118-135 'cannot be undone') is taken without context unless the approver leaves the page. WorkflowTask type (:9-16) has no such fields; whether the API returns them cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`, `apps/web/src/app/(app)/estab/approvals/FilePreview.tsx (new, optional)`
- **Fix steps:**
  1. Check whether workflow task payload carries file metadata; otherwise fetch /api/proxy/v1/estab/files/:id per row (batch or on dialog open).
  2. Add File no., Subject and latest note excerpt columns; render fileRef instead of UUID slice.
  3. Pass confirmDescription containing file no. and subject to ActionButton so the dialog names the item being approved.
  4. Keep requireReason as is.
- **Acceptance:**
  - Test: row shows file number and subject; dialog title/description includes them.
  - Approver can open the note in a new tab from the row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals on irreversible actions made blind; governance risk.

### GAP-ESTAB-APPROVALS-04  ·  MEDIUM  ·  confirmed  ·  theme ACCESS (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Page says "Deputy Secretary and above" but any user can open it and see Approve/Reject buttons (page.tsx:9); the role default "estab_deputy_secretary" is printed raw when roleRef is null (panel:108).
- **Verified evidence:** apps/web/src/app/(app)/estab/approvals/page.tsx:9 subtitle 'Deputy Secretary and above'; estab/layout.tsx applies only ModuleGate (no requireAnyRole, unlike crm/layout.tsx) and the page/panel do not check roles, so every establishment user sees Approve/Reject. apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:108 prints task.roleRef ?? 'estab_deputy_secretary' raw. Server-side enforcement on POST /workflow/tasks/:id/complete cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/page.tsx`, `apps/web/src/app/(app)/estab/approvals/page.tsx`, `apps/web/src/lib/auth/workRoles.ts`, `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`
- **Fix steps:**
  1. In page.tsx call requireAnyRole([...estab approver roles]) from lib/auth/roleGuard (redirect or PermissionDenied) or render buttons only when getSessionRoles() intersects.
  2. Show a friendly role label (map estab_deputy_secretary -> 'Deputy Secretary') and stop displaying a default when roleRef is null; show '—'.
  3. Confirm backend rejects completion by a user lacking the task's role.
- **Acceptance:**
  - Test: user without role is redirected/denied; DS role sees list.
  - API call by wrong role returns 403.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Access control on approvals; UI-only gate is insufficient.

### GAP-ESTAB-APPROVALS-05  ·  MEDIUM  ·  confirmed  ·  theme LOGIC (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9) — W2 estab rescan evidence: no role or task-name matching and no guessed message: after the 202 the panel reads the workflow's own record (GET /v1/workflow/tasks?instanceId= lists every task of the instance, any role) and says 'Final approval' when the approver's task is completed with nothing else pending, 'forwarded to <role>' when another step is pending, and 'not applied yet' after 5 polls; approvalOutcome.ts and EstabApprovalsPanel.context.test.tsx (a renamed role gives the same result). No workflow-service change was needed. (W2 estab rescan: completed by #2132)
- **First-pass claim:** Final-approval wording depends on string matching role/task name for "deputy" (panel:66); a renamed role gives "forwarded to next level" on a final approval.
- **Verified evidence:** apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:66 (in complete()) decides 'final approval' by role.includes('deputy_secretary') || task.name.toLowerCase().includes('deputy'); otherwise message says 'forwarded to next level'. A renamed role/task changes the wording; the message is only UI, not the actual workflow outcome. Theme I18N is wrong (logic).
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`
- **Fix steps:**
  1. Read the outcome from the complete response or reload task/file status (e.g., file noting status 'green') and derive the message from it; if the API cannot say, add an isFinal/nextRole field (backend).
  2. Remove string matching; move message templates to constants/next-intl.
- **Acceptance:**
  - Test: response with final=true shows 'Final approval'; final=false shows 'forwarded'; role rename does not change result.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Misleading confirmation on legal approvals.

### GAP-ESTAB-APPROVALS-06  ·  LOW  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Success/failure messages are set after loadTasks and router.refresh (panel:65-75); a failing action surfaces only through the dialog, and the message region is a plain paragraph with no dismiss.
- **Verified evidence:** Order in apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx:53-76 is: POST, setMessage (:66-73), then await loadTasks() and router.refresh() (:74-75), so the observation's ordering is wrong. Failure is surfaced by ActionButton/useConfirmAction (ds/ActionButton.tsx:48-50) inside the dialog, but the thrown text is raw res.text() (:61) which may be JSON. The success message region (:99) is a plain <p> with no dismiss, and it persists until the next action. After success the row unmounts because loadTasks refreshes.
- **Files to change:** `apps/web/src/app/(app)/estab/approvals/EstabApprovalsPanel.tsx`
- **Fix steps:**
  1. Throw a clerk-safe message from complete(): use useFormError().fromResponse (as ApprovalMatrixPanel does) instead of res.text().
  2. Show success through useToast (ds/Toast) or add a dismiss button and auto-clear timer.
  3. Include the file number in the success message.
- **Acceptance:**
  - Test: 500 response shows readable error in dialog, not JSON.
  - Success message can be dismissed / disappears.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/compliance  —  `estab/compliance.html`

- **Source:** `apps/web/src/app/(app)/estab/compliance/page.tsx`
- **Design reference:** `redesign/estab/compliance.html`

### GAP-ESTAB-COMPLIANCE-01  ·  MEDIUM  ·  confirmed  ·  theme LOGIC (was VALIDATION)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: complianceStats.ts (IST day, >7d overdue) with complianceStats.test.ts and page.test.tsx (1-day vs 10-day overdue))
- **First-pass claim:** "Escalated" is overdue items whose dueDate < today (page.tsx:16); since "overdue" already implies a passed due date, Escalated ≈ Overdue and duplicates it — no escalation level, target or timestamp exists in the code.
- **Verified evidence:** apps/web/src/app/(app)/estab/compliance/page.tsx:15-16: overdue = status==='overdue'; escalated = status==='overdue' && dueDate<today, a subset of overdue that only differs when an item is flagged overdue with a future due date. No escalation level/target/time is used (ComplianceSummary type is in @civitasone/types, absent from snapshot, so an escalation field cannot be ruled out). Also today is computed by toISOString() (UTC), off by up to a day in IST.
- **Files to change:** `apps/web/src/app/(app)/estab/compliance/page.tsx`
- **Fix steps:**
  1. DECISION: define escalation (e.g. overdue > N days, or an explicit escalatedAt/level from the API).
  2. If the API has no field, remove the Escalated tile or replace it with 'Overdue > 7 days' using IST date maths.
  3. Compute today in Asia/Kolkata (lib/formatters helper) and compare using date strings.
- **Acceptance:**
  - Unit test the counting function with items overdue by 1 and 10 days.
  - Tile hidden or labelled per decision.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Misleading KPI to senior management.

### GAP-ESTAB-COMPLIANCE-02  ·  MEDIUM  ·  confirmed  ·  theme EMPTYSTATE (was WIRING)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: complianceRate() returns null on an empty register; compliance/page.test.tsx shows an em dash for [] and 50% for 1 of 2)
- **First-pass claim:** Zero items shows "0%" compliance rate (page.tsx:11-13) instead of "—", unlike the error branch.
- **Verified evidence:** apps/web/src/app/(app)/estab/compliance/page.tsx:11-13 complianceRate is 0 when items.length===0 and :37 renders `${complianceRate}%` (only errored gives '—'). On empty data the page shows 0% Compliance Rate above the 'No compliance items' EmptyState (:53).
- **Files to change:** `apps/web/src/app/(app)/estab/compliance/page.tsx`
- **Fix steps:**
  1. Make complianceRate `number | null` (null when items.length===0) and render value={errored || rate===null ? '—' : `${rate}%`}.
- **Acceptance:**
  - Test: items=[] -> tile shows '—'.
  - items with 1 of 2 complied -> 50%.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-COMPLIANCE-03  ·  MEDIUM  ·  confirmed  ·  theme ACTION (was OTHER)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** 'Mark complied' (requireReason, POST /v1/estab/compliance/:id/comply) already existed; this PR hides the action column from viewers the service refuses (audit_officer reads only), via getSessionRoles + ESTAB_COMMITTEE_WRITE_ROLES (compliance/page.tsx, ComplianceTable.tsx). The 'link the title to the meeting' step does not apply: ComplianceSummary is a statutory register item (complianceCode, frequency, dueDate) with no meeting or action-item id.
- **W0 note:** partly fixed by #1916 — Mark complied ActionButton w/ reason added; title not linked to meeting.
- **First-pass claim:** Rows do not link to the originating meeting or action item and there is no way to mark an item complied from this page (ComplianceTable.tsx:34-40) — a tracker with no next action.
- **Verified evidence:** apps/web/src/app/(app)/estab/compliance/ComplianceTable.tsx:30-36 (DataTable columns) has only Action, Category, Assigned to, Due, Status as plain text, no href and no action column; ComplianceRow (:6-13) carries no meetingId/actionId. Whether the API supplies a meeting/action id and a complete endpoint cannot be verified (@civitasone/types and meeting service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/compliance/ComplianceTable.tsx`, `apps/web/src/app/(app)/estab/compliance/page.tsx`
- **Fix steps:**
  1. Add meetingId/actionItemId to ComplianceRow from the API payload (confirm field names).
  2. Render title as <Link href={`/meeting/${meetingId}`}>.
  3. Add an Actions column with ActionButton 'Mark complied' (requireReason) calling the existing meeting action-item complete endpoint, then router.refresh().
  4. Only show the button when status !== 'complied'.
- **Acceptance:**
  - Test: title links to the meeting.
  - Marking complied moves the row out of Overdue and updates Compliance Rate after refresh.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Writes to meeting action items; needs role check.

### GAP-ESTAB-COMPLIANCE-04  ·  LOW  ·  partly  ·  theme ID_DISPLAY (was OTHER)

- [x] **Status** (W2 estab: closed by #2052)
- **W0 note:** partly fixed by #1916 — null -> em dash done; still shows raw assignedTo, OfficerName not used.
- **First-pass claim:** "Assigned to" prints the raw assignedTo string with "—" fallback (page.tsx:23); unlike files pages it does not resolve officer ids to names via OfficerName.
- **Verified evidence:** apps/web/src/app/(app)/estab/compliance/page.tsx:22 passes c.assignedTo ?? '—' unchanged; ComplianceTable.tsx:31 shows it. OfficerName (estab/files/[id]/OfficerName.tsx:93) resolves employee UUIDs, but whether assignedTo is a UUID or a name here cannot be verified (type absent). True that it does not resolve.
- **Files to change:** `apps/web/src/app/(app)/estab/compliance/page.tsx`, `apps/web/src/app/(app)/estab/compliance/ComplianceTable.tsx`, `apps/web/src/app/(app)/estab/files/[id]/OfficerName.tsx (move to shared _components)`
- **Fix steps:**
  1. Confirm assignedTo semantics with the API owner.
  2. If it is an employeeId, use <OfficerName id={row.assignedTo}/> in the column render (move OfficerName into app/_components so it is not imported across route folders).
  3. Fallback '—' for null.
- **Acceptance:**
  - Row with a known employee id shows the name; unknown id shows short id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-COMPLIANCE-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Segments are only All / Overdue; the "Open Actions" stat (pending) has no matching filter (ComplianceTable.tsx:16).
- **Verified evidence:** apps/web/src/app/(app)/estab/compliance/ComplianceTable.tsx:16 SEGMENTS=['All','Overdue'] and :20 filters only statusRaw==='overdue'; page.tsx:14 shows the 'Open Actions' tile (pending) with no matching segment. Statuses seen in code: complied, pending, overdue.
- **Files to change:** `apps/web/src/app/(app)/estab/compliance/ComplianceTable.tsx`
- **Fix steps:**
  1. Extend SEGMENTS to ['All','Open','Overdue','Complied'] with a status map (Open -> pending).
  2. Show counts in the labels using rows.filter counts.
  3. Sync selected segment to URL (?status=) optionally.
- **Acceptance:**
  - Test: Open segment shows only pending rows; counts equal the stat tiles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/dak  —  `estab/dak.html`

- **Source:** `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Design reference:** `redesign/estab/dak.html`

### GAP-ESTAB-DAK-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM (was PII)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dak/page.test.tsx: open-file dialog forces a classification choice and posts it; no hard-coded 'public')
- **First-pass claim:** Open file creates a file with hard-coded dept "ADMIN" and classification "public" and no confirmation (dak/page.tsx:77-90); a confidential or secret letter is silently turned into a public-classified file, and the action cannot be undone from this page.
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:87-90 openFile POSTs {dept:'ADMIN', classification:'public'} for every letter with no confirmation dialog; the register form (:27,133-152) captures no classification/department and the InwardRow type has no classification, so the file classification is never derived from the dak. The action is one click (:189). Undo is not offered here. Whether the server allows reclassification later cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`, `apps/web/src/app/(app)/estab/dak (new OpenFileDialog.tsx)`
- **Fix steps:**
  1. Add classification (public/restricted/confidential/secret) and dept fields to the register form and store them on the inward record (backend) or collect them in a dialog on 'Open file'.
  2. Replace the direct Button with ActionButton/ConfirmDialog that shows dak no., subject, chosen dept and classification; default classification should be blank (forced choice), not 'public'.
  3. Send the chosen values in the open-file body; never hard-code.
  4. Backend: ensure open-file records an audit event with classification.
- **Acceptance:**
  - Test: Open file requires a classification selection; the POST body contains the selection.
  - No request body ever contains hard-coded 'public'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Security classification downgrade of confidential correspondence (DPDP / official secrets).

### GAP-ESTAB-DAK-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dak/page.test.tsx: a 400 JSON body shows friendly text, not braces)
- **First-pass claim:** Failed register/open shows the raw response body ("throw new Error(await res.text())") in the banner (page.tsx:68-73,94-103), which can be JSON or an internal message rather than clerk-safe copy.
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:68 throws new Error(await res.text()) and :73 sets actionError to e.message, rendered raw in the banner (:126-128); openFile does the same (:94-95,103). A JSON or stack-like body is shown to the clerk. Other panels use useFormError (ApprovalMatrixPanel).
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Fix steps:**
  1. Use useFormError('DAK').fromResponse(res,'save') / fromException for registerDak and openFile, and show its message.
  2. Log the raw body via the app's logger (not console.log) if needed.
- **Acceptance:**
  - Test: server 400 with JSON body shows the friendly text, not braces.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-DAK-03  ·  MEDIUM  ·  partly  ·  theme FORM (was DATEFMT)

- [~] **Status** (W2 estab rescan: partly done. BUILT: the success message now names the DAK number and barcode the service allocates (the row is looked up by the id the 202 returned, searching by the typed DAK number or else the first 100 characters of the subject because the register search refuses a longer term, over the first 50 matches only; bounded poll, cancelled on unmount); dak/page.test.tsx 'DAK-03: the allocated DAK number and barcode reach the success message'. NOT BUILT (OWNER DECISION): a Classification input at registration. registerInwardBody has no such field and classification is chosen, with the department, when the file is opened. Should an inward DAK carry a security classification at registration (new field, column and clearance semantics), or stay chosen at open-file?)
- **W2 estab note:** Form now carries Mode, Received date, Urgency, Addressee officer (EntityPicker -> assignedTo) and Source section, validated with zod (lib/estab/dakForm.ts) before POST, keys identical to registerInwardBody. Not applicable: the barcode is allocated by the async consumer so it cannot be in the 202 (the message says it appears in the register once processed), and registerInwardBody has no classification field.
- **W0 note:** partly fixed by #1916 — Mode/received date/urgency added; no addressee, no zod, barcode not in success msg.
- **First-pass claim:** Register captures only number, sender and subject; there is no received date, mode, addressee section or classification, although the table later shows Barcode and Source columns that this form cannot populate (page.tsx:133-152,166-168).
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:27,133-152 form has dakNo, fromAddress, subject only; table (:166-171) shows Barcode, Source and Received. Received date, barcode and status are plausibly server-set (receivedAt is displayed via formatIndianDate, :171) and Source defaults to 'manual' for hand-entered rows, so only mode, addressee section, classification and a user-editable received date are missing; whether the API accepts them cannot be verified (estab service absent). Theme DATEFMT is wrong (date formatting is already via formatIndianDate).
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Fix steps:**
  1. Confirm the POST /estab/inward schema; add optional Received date, Mode (post/hand/email/courier), Addressee section and Classification inputs bound to accepted fields.
  2. Validate with zod before POST.
  3. Show the assigned barcode in the success message.
- **Acceptance:**
  - Test: form submits the added fields; barcode returned appears in the message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Register completeness for records/RTI audit.
- **Depends on:** GAP-ESTAB-DAK-01

### GAP-ESTAB-DAK-04  ·  MEDIUM  ·  confirmed  ·  theme PAGINATION (was FAILMASK)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** Server-side search and paging: GET /v1/estab/inward takes q (DAK no, barcode, sender, subject; LIKE metacharacters escaped) and offset, and returns pagination.total. Web shows 'Showing X of N', a Load more button and a server search box. Real-DB test: tests/register-search-paging-real-db.test.ts (250 rows, old barcode found, tenant isolation).
- **W0 note:** partly fixed by #1916 — Only Showing latest 100 notice; search still client-side.
- **First-pass claim:** Register is limit=100 then paged client-side at 15 (page.tsx:36,201); older dak beyond 100 is unreachable except via barcode search that also only searches the loaded 100.
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:36 fetches /estab/inward?limit=100 once; DataTable pageSize={15} (:201) and filterable (:199-200) only work over those 100 rows. No server search/cursor and no 'showing latest 100' notice. Theme FAILMASK is wrong (load errors are handled at :159).
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Fix steps:**
  1. Move search and paging to the server: pass q/page/limit query params (confirm API support) and use server-driven DataTable, or implement cursor 'Load more'.
  2. Until then show 'Showing latest 100 entries' when rows.length===100.
  3. Barcode search must call the API (e.g. ?barcode=).
- **Acceptance:**
  - Test: with 250 records, searching an old barcode finds it.
  - Notice appears at 100 rows.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Old dak untraceable in the register.

### GAP-ESTAB-DAK-05  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9) — W2 estab rescan evidence: dak/page.test.tsx 'DAK-05' asserts the humanised 'File Opened' label, an em dash for an empty source section, and a success message that names the typed DAK number and, once processed, the allocated number and barcode. (W2 estab rescan: completed by #2132)
- **First-pass claim:** Status shows raw values with underscores replaced; "Source" defaults to the literal "manual" (page.tsx:167-173); success text "DAK registered." does not say which number.
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:172 StatusPill label={r.status.replace(/_/g,' ')} (lowercase, overriding humanizeStatus), :168 `r.sourceSection ?? 'manual'` invents a literal, :70 message 'DAK registered.' omits the number. Theme FABRICATED is a stretch; 'manual' is a default, not fake data.
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Fix steps:**
  1. Drop the label prop so StatusPill humanises the status.
  2. Show '—' for null sourceSection or map codes to labels.
  3. Use response id/dakNo: setMessage(`DAK ${form.dakNo} registered.`) (capture before clearing form).
- **Acceptance:**
  - Test: status 'file_opened' shows 'File Opened'.
  - Success message contains the number.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-DAK-06  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dak/page.tsx has no hex literal (grep clean); alerts use the alert good/bad classes)
- **First-pass claim:** Two hard-coded banner palettes (#ecfdf3 / #fef2f2) bypass the DS alert component (page.tsx:118-130).
- **Verified evidence:** apps/web/src/app/(app)/estab/dak/page.tsx:119 uses inline #ecfdf3/#6ee7b7 and :126 #fef2f2/#fecaca/#b91c1c instead of tokens. civitas-ds.css defines .alert with .bad and .warn (:147-153) but no React Alert component and no .alert.good, so no DS component to reuse yet. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/estab/dak/page.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Add .alert.good using --goodbg/--goodbd/--good in civitas-ds.css (dark mode variants too).
  2. Replace both inline banners with <div className='alert good'> / <div className='alert bad'> (keep role=status / role=alert wrappers).
  3. Optionally add a small ds/Alert component and adopt it.
- **Acceptance:**
  - Visual check in light and dark; no hex literals in the file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/dashboard  —  `estab/dashboard.html`

- **Source:** `apps/web/src/app/(app)/estab/dashboard/page.tsx`
- **Design reference:** `redesign/estab/dashboard.html`

### GAP-ESTAB-DASHBOARD-01  ·  HIGH  ·  partly  ·  theme OTHER (was CAP)

- [x] **Status** (W2 estab: closed by #2042) — W2 estab rescan evidence: mapEstabFileSummaries keeps the service status (draft and closed were folded into active, so My Desk counted closed past-due files the dashboard excludes) and resolves due and created instants to their IST day; the register's Active Files and Avg Pendency tiles read the dashboard's service counts (one pendency number: all open files); Closed counts closed, archived and disposed; 'Active on desk' counts open files that are not awaiting receipt; real-DB IST-boundary tests added; estabSlaParity.test.ts pushes the real-DB seed through the mapper and gets the same numbers. The owner should confirm the definition (open = not closed / archived / disposed, so a 'transferred' file counts as open). Rework after review: the register's Due highlight and Closed chip (list/FilesTable.tsx) and the My Desk SLA pill (inbox/InboxPanel.tsx) now go through lib/estab/sla.ts (isOverdue, isClosedStatus), so a closed past-due file is neutral in all three places and listed under the Closed chip; FilesTable.test.tsx and InboxPanel.test.tsx. (W2 estab rescan: completed by #2132)
- **W2 estab note:** One definition: open = not closed/archived/disposed, overdue = open and due IST day before today IST, pendency = IST days since creation over open files. estab-service dashboard/queries.ts now uses it (it counted only status='active' and compared the raw timestamp to the server clock), lib/estab/sla.ts treats 'closed' the same, My Desk tile is 'Overdue on my desk' with a hint saying the dashboard counts the whole office. Real-DB test: tests/dashboard-sla-pendency-real-db.test.ts. NOTE: this changes reported numbers (draft/pending open files past due now count; closed files no longer do).
- **W0 note:** partly fixed by #1916 — Shared lib/estab/sla.ts (isOverdue/pendencyDays) used; no On my desk relabel/estabSla.ts.
- **First-pass claim:** Two SLA stories: dashboard shows an "SLA Breached" tile from the API (dashboard/page.tsx:49) while File Register removed its SLA tile because "there is no due-date/SLA field here" (list/page.tsx:89-93) and My Desk computes SLA from dueDate client-side (inbox/page.tsx:8-15). Officers get three different overdue numbers.
- **Verified evidence:** dashboard/page.tsx:49 shows slaBreached straight from GET /estab/dashboard (server-computed, definition not visible; estab-service absent). inbox/page.tsx:8-15,33-39 computes overdue client-side from daysLeft(dueDate) over the whole getEstabFiles() list. list/page.tsx:89-95 has no SLA tile (comment says there is no due-date field) but list/page.tsx:13-25 computes its own Avg Pendency from createdDate of pending files, while dashboard shows server avgPendencyDays (page.tsx:51). The 'no due-date field' comment is stale: mapEstabFileSummaries (_data/apiMappers.ts:745) already maps dueDate from dueBy. So two overdue definitions and two pendency definitions, not three overdue numbers.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/estab/list/page.tsx`, `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/dashboard/page.tsx`, `apps/web/src/lib/estabSla.ts`
- **Fix steps:**
  1. Decide one SLA definition with the business owner: overdue = dueDate < today (IST) and status not archived/disposed; pendency = today - createdDate for open files.
  2. Create lib/estabSla.ts exporting isOverdue(file, now) and pendencyDays(file, now); use it in inbox/page.tsx (replace daysLeft loop) and list/page.tsx (replace inline avg).
  3. Preferred: have the dashboard endpoint be the only source for org-wide counts, and label inbox tiles 'On my desk' (filter by currentHolder === current user) so scope differs visibly.
  4. Relabel the dashboard tile with the definition via title/help text ('Past due date').
  5. Delete the stale comment at list/page.tsx:89-94.
- **Acceptance:**
  - Unit test: isOverdue returns true for dueDate yesterday, false for today, false for archived.
  - Manual: with the same seeded data, dashboard SLA Breached equals the count of overdue rows in the register/inbox scope it claims to cover.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong SLA counts drive escalation decisions; changing definition alters reported numbers.
- **Depends on:** GAP-ESTAB-DASHBOARD-03

### GAP-ESTAB-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W2 estab: closed by #2042) — W2 estab rescan evidence: the register's Active Files tile now shows the dashboard's service count with the same hint (it was a count over the first 50 rows with closed and draft folded into active); the service returns filesActive (filesPending kept as a deprecated alias) and the web reads filesActive; list/page.test.tsx, loaders.estabDashboard.test.ts and the real-DB dashboard test. The register tile's hint is its own text ('same count as Active Files on the Dashboard'), not the dashboard's. Rework 2: EstabDashboardSchema no longer defaults filesActive and filesPending to 0, because that default hid the filesPending fallback (new web against an estab-service not yet redeployed showed 0 Active Files); loaders.estabDashboard.test.ts now runs the real fetchJson, schema included. GET /v1/estab/dashboard is gated to estab_officer, estab_admin, section_officer and super_admin, while the register is also open to the Deputy Secretary and audit_officer, who get a 403 there: their register tiles read 'Active Files (loaded)' and 'Avg Pendency (loaded)' over the loaded rows with a visible notice, and a failed dashboard read for anyone else reads a dash with a notice (list/page.test.tsx). The dashboard role gate was not widened; whether those roles should see the office-wide figures is an owner decision. (W2 estab rescan: completed by #2132)
- **W2 estab note:** The service's filesPending counts status='active' (dashboard/queries.ts), exactly the File Register's 'Active Files' tile, so the tile is now 'Active Files' on both. The W0 test that asserted 'Files Pending' encoded the wrong label and was replaced.
- **W0-10 note:** review found the W0 tick wrong — Dashboard label renamed to "Files Pending" (estab/dashboard/page.tsx:61,112) but backend filesPending counts status='active' (estab-service dashboard/queries.ts:19); register list/page.tsx:29,105,107 shows Active Files=active and Pending=status pending, so same-named tiles still disagree and the label is now wrong; step 3 (rename to filesOpen / keep Active Files) not done
- **First-pass claim:** "Active Files" tile is data.filesPending (page.tsx:48) but File Register counts status "active" and "pending" separately (list/page.tsx:9-10) — label and field disagree.
- **Verified evidence:** dashboard/page.tsx:48 and :99 label data.filesPending as 'Active Files' / 'Active files'. mapEstabDashboard (_data/loaders.ts:3639) reads payload.filesPending. list/page.tsx:9-10 counts status 'active' and 'pending' separately (Active Files vs Pending tiles), so the same label means different sets. What the server's filesPending covers cannot be verified (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm with backend what filesPending counts (pending only vs all open).
  2. If it is pending only, rename both labels (page.tsx:48,99) to 'Files Pending'.
  3. If it is all open files, rename the field/mapper to filesOpen and keep label 'Active Files', and align list/page.tsx tile.
  4. Optionally link the tile to /estab/list.
- **Acceptance:**
  - Dashboard tile label and the register tile with the same label show the same number for the same data.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; label only unless field semantics change.
- **Depends on:** GAP-ESTAB-DASHBOARD-01

### GAP-ESTAB-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Avg Pendency prints String(avgPendencyDays) unrounded (page.tsx:51) so a float such as 6.428571 can appear.
- **Verified evidence:** dashboard/page.tsx:51 renders String(data.avgPendencyDays) and :102 interpolates it raw; mapEstabDashboard (loaders.ts:3645) only checks typeof number, so 6.428571 prints as is. Not money.
- **Files to change:** `apps/web/src/app/(app)/estab/dashboard/page.tsx`
- **Fix steps:**
  1. Add a helper formatDays(n) in apps/web/src/lib/formatters.ts: Number.isFinite ? n.toLocaleString('en-IN',{maximumFractionDigits:1}) : '—'.
  2. Use it at page.tsx:51 and :102 (with ' days' suffix, singular when 1).
- **Acceptance:**
  - Unit test: formatDays(6.428571)==='6.4', formatDays(NaN)==='—'.
  - Manual: tile shows at most one decimal.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-DASHBOARD-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was UUID)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dashboard/page.test.tsx 'lists recent files newest-first by createdDate regardless of API order'; W2 estab rescan evidence: estab-service now orders the register list newest-first before the limit (modules/files/repo.ts listFilesByTenant; real-DB test files-read-only-detail-contract-real-db.test.ts), dashboard page.test.tsx covers the 8-cap, dash-last and same-day order; the 60 s cached register list is dropped by the file create, open-from-DAK, open volume/part, module-raise and close consumers, so a new file is first on the next read: invalidateFileLists in modules/files/queries.ts, same real-DB test) (W2 estab rescan: completed by #2132)
- **First-pass claim:** "Recent files" is the first 8 of the register response with no sort (page.tsx:24); it is only recent if the API happens to order by creation time.
- **Verified evidence:** dashboard/page.tsx:24 takes files.slice(0,8) from getEstabFiles() (loaders.ts:3658, no sort/limit params, GET /api/v1/estab/files). No client sort by createdDate, and EstabFileSummary rows expose createdDate, so ordering is whatever the API returns. DataTable sortable only reorders after render.
- **Files to change:** `apps/web/src/app/(app)/estab/dashboard/page.tsx`
- **Fix steps:**
  1. Sort a copy by createdDate desc (fallback dueDate) before slice: [...files].sort((a,b)=>b.createdDate.localeCompare(a.createdDate)). Note createdDate can be '—' (apiMappers.ts:739); sort those last.
  2. Better: pass ?sort=createdAt:desc&limit=8 to the endpoint if backend supports it (cannot verify) and add params to getEstabFiles.
  3. Rename heading to 'Recent files' only if sorted.
- **Acceptance:**
  - Unit/render test: files with mixed createdDate produce newest 8 in order.
  - Manual: newly created file appears first.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-DASHBOARD-06  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dashboard/page.tsx has no hex literal; tiles are links (test asserts the Active Files tile href /estab/list))
- **First-pass claim:** Tile icon backgrounds are hex literals (page.tsx:48-53) rather than tokens; no per-tile links to the underlying lists.
- **Verified evidence:** dashboard/page.tsx:48-53 pass hex literals to StatCard iconBg (#e6f7f5 etc.); StatCard (_components/ds/StatCard.tsx) also defaults to '#eef2ff' and has no href prop, so tiles are not links. The 'FABRICATED' tag is wrong; nothing is sample data (errored shows '—').
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/civitas-ds.css`, `apps/web/src/app/(app)/estab/dashboard/page.tsx`
- **Fix steps:**
  1. Add tone tokens (e.g. --tint-teal/--tint-red/...) to civitas-ds.css and a StatCard `tone` prop mapping to them; drop raw iconBg usage here.
  2. Add optional `href` prop to StatCard rendering the tile as a Link with focus style.
  3. Link tiles: Active Files -> /estab/list, DAK Pending -> /estab/dak, Compliance Due -> /estab/compliance, Meetings -> /estab/meetings; SLA Breached -> /estab/inbox once filterable.
- **Acceptance:**
  - Tiles are keyboard-focusable links with visible focus ring.
  - No hex literals remain in dashboard/page.tsx (grep).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatCard is shared across modules; keep iconBg backwards compatible.


---
## /estab/dfa  —  `estab/dfa.html`

- **Source:** `apps/web/src/app/(app)/estab/dfa/page.tsx`
- **Design reference:** `redesign/estab/dfa.html`

### GAP-ESTAB-DFA-01  ·  HIGH  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1949, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed load prints a small red line while the card still says "No drafts in this view." (DfaPanel.tsx:57-60,181,227); no retry or ErrorState. An approver arriving during an outage concludes nothing is waiting.
- **Verified evidence:** DfaPanel.tsx load() sets error text on !res.ok (:71-74) and on exception (:83) but never clears rows or exposes retry; render shows the error as a small <p> (:196) and the card independently shows 'No drafts in this view.' when rows is empty (:241-242). Also rows are not reset on error, so after a filter change a failed fetch leaves the previous filter's rows visible under the new tab.
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`
- **Fix steps:**
  1. Split load error state: keep `loadError` (boolean) separate from action `error`.
  2. In the card render: loading -> skeleton; loadError -> <ErrorState error={toHumanError('load',{area:'drafts'})} onRetry={() => void load()} /> (as dispatch/page.tsx:61 does); empty only when !loadError && rows.length===0.
  3. Call setRows([]) at the start of load() (or on error) so stale rows from another filter are never shown.
  4. Keep action errors (approve/return) in the status region.
- **Acceptance:**
  - Component test: mock fetch 500 -> ErrorState with Retry visible, 'No drafts' text absent; clicking Retry refetches.
  - Switch filter with failing fetch -> old rows not shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** shared ErrorState

### GAP-ESTAB-DFA-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W2 PQ: closed by #2037; W2 estab rescan evidence: the approver's remarks reach the service and the dfa.approved audit event (dfa-approve-remarks-real-db.test.ts), consumer-level maker-checker on sign, DfaPanel.test.tsx asserts Confirm stays disabled until remarks are typed and that { reason } is posted) (W2 estab rescan: completed by #2132)
- **W0 note:** partly fixed by #1949 — Approve requireReason added; no createdBy/canApprove from server; maker-checker backend unverified.
- **First-pass claim:** Approve and Sign are offered to whoever opens the page; nothing in the UI separates drafter from approver or signer (DfaPanel.tsx:128-171). Approve has no remarks field, only a confirm. Server enforcement cannot be verified (estab-service absent).
- **Verified evidence:** DfaPanel.tsx actionsFor (:143-181) renders Approve/Return for every viewer when status is pending_approval, Sign for approved, with no role/actor check; Dfa type (:22-31) carries no drafter/approver id so UI cannot compare. Approve uses ActionButton with confirm only (:156-158), no requireReason (Return has it :159). Sign confirm exists (:166-169) already. Server-side maker!=checker cannot be verified (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`, `estab-service DFA approve/sign handlers (not in snapshot)`
- **Fix steps:**
  1. Backend: reject approve/sign where actor == drafter (403 with code) and emit audit events dfa.approved/dfa.signed with actor and reason.
  2. Backend: include createdBy and allowed actions (canApprove, canSign) in GET /estab/dfa rows.
  3. Web: add createdBy to Dfa type; render Approve/Sign only when server says allowed, else disabled with reason tooltip.
  4. Web: add requireReason reasonLabel='Approval remarks' to Approve ActionButton and send reason (act already forwards reason).
- **Acceptance:**
  - Backend test: drafter approving own DFA returns 403 and no state change.
  - Component test: Approve dialog cannot confirm without remarks; button hidden/disabled when canApprove=false.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval flow change; blocking self-approval may stall small offices with one officer, needs policy decision.

### GAP-ESTAB-DFA-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was NAVUX)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1949, verified on main 9c5e9e9e9)
- **First-pass claim:** The "returned" status produced by Return (ACTION_STEP_STATUS) has no filter tab (DfaPanel.tsx:19,26-32); returned drafts are visible only under "all" though they need the drafter's action.
- **Verified evidence:** FILTERS (DfaPanel.tsx:34) = all, draft, pending_approval, approved, signed, dispatched; 'returned' (produced by Return, ACTION_STEP_STATUS :44, handled in actionsFor :146) has no tab. Returned drafts appear only under 'all'. Segmented (_components/ds/Segmented.tsx) renders opt strings raw as labels.
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`, `apps/web/src/app/_components/ds/Segmented.tsx`
- **Fix steps:**
  1. Add 'returned' to FILTERS after 'pending_approval'.
  2. Extend Segmented to accept {value,label}[] options (keep string[] compat) and pass humanizeStatus labels (see DFA-05).
  3. Optionally show counts per tab.
- **Acceptance:**
  - Selecting Returned requests ?status=returned and lists returned drafts with a Submit action.
  - Test for Segmented with object options.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Backend must accept status=returned in the filter (cannot verify).
- **Depends on:** GAP-ESTAB-DFA-05

### GAP-ESTAB-DFA-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 estab: closed by #2052)
- **W2 note:** Drafted-by name, the full body in the approve dialog, a file picker on the create form (existing estab file search; the service checks the file exists in the tenant and is within the drafter's clearance) and a file-number link are in. A dedicated dfa/[id] page is not built (remainder).
- **W0 note:** partly fixed by #1949 — Body preview in Approve/Sign dialog and Updated column; no Drafted by or detail page.
- **First-pass claim:** Drafts are not linked to an eOffice file and the list never shows the body, date or drafter (Dfa type, DfaPanel.tsx:8-17,230-238); approvers approve a subject line.
- **Verified evidence:** Dfa type (DfaPanel.tsx:22-31) and columns (:245-252) show dfaNo, type, subject, recipient, status, action only. updatedAt is fetched but not shown; body, drafter and linked file are not in the type; there is no detail route (dfa/ contains only page.tsx and DfaPanel.tsx) and create payload (:101-107) has no fileId. Whether the API returns body/fileId/createdBy is cannot-verify (estab-service absent). Approve/Sign are therefore done on a subject line only.
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`, `apps/web/src/app/(app)/estab/dfa/[id]/page.tsx`, `estab-service DFA list/detail DTO (not in snapshot)`
- **Fix steps:**
  1. Confirm API fields (body, createdBy, fileId, updatedAt).
  2. Add columns Drafted by and Updated (formatIndianDate); add fileId select (file picker) to the create form if backend supports.
  3. Add expandable row or new dfa/[id] page showing full body, recipient address and history; make DFA No link to it.
  4. Approve/Sign buttons on the detail page so approvers see the body first.
- **Acceptance:**
  - Approver can read full body before Approve.
  - Created DFA linked to a file shows file no link.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals on unseen content is a governance risk; mostly additive UI.
- **Depends on:** GAP-ESTAB-DFA-02

### GAP-ESTAB-DFA-05  ·  LOW  ·  confirmed  ·  theme COPY (was NAVUX)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1949, verified on main 9c5e9e9e9)
- **First-pass claim:** Success copy is "DFA approve done." built from the action verb (DfaPanel.tsx:122); filter tabs show raw snake_case ("pending_approval").
- **Verified evidence:** DfaPanel.tsx:137 setMessage(`DFA ${action} done.`) yields 'DFA approve done.'; thrown errors are prefixed with the raw action (:135). Segmented gets raw FILTERS strings (:187) so tabs read 'pending_approval'.
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`, `apps/web/src/app/_components/ds/Segmented.tsx`
- **Fix steps:**
  1. Add const ACTION_DONE = {submit:'Draft submitted for approval.', approve:'Draft approved.', return:'Draft returned for revision.', sign:'Draft signed.', dispatch:'Draft dispatched.'} and use at :137.
  2. Drop the `${action}: ` prefix at :135.
  3. Use humanizeStatus (lib/formatters.ts:44) for tab labels via Segmented label support.
- **Acceptance:**
  - After Approve the status region reads 'Draft approved.'
  - Tabs read 'Pending approval'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-DFA-03

### GAP-ESTAB-DFA-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1949, verified on main 9c5e9e9e9; W2 estab rescan evidence: bounded, abortable, single-owner poll with a Refreshing indicator that also works inside status tabs; DfaPanel.poll.test.tsx covers a 1.5 s lagging read, the filtered tab, give-up, supersede, unmount and tab switch) (W2 estab rescan: completed by #2132)
- **First-pass claim:** Create then reload uses a fixed 800 ms timeout for an eventually-consistent write (DfaPanel.tsx:103,125); the new draft may not appear.
- **Verified evidence:** DfaPanel.tsx:118 (create) and :140 (act) use setTimeout(() => void load(), 800) after the POST returns; not cleared on unmount, and if the read model lags more than 800 ms the draft/status change is not shown. Whether writes are eventually consistent (CQRS) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/dfa/DfaPanel.tsx`
- **Fix steps:**
  1. Have the POST return the created/updated DFA (or use its response) and merge into rows optimistically.
  2. Otherwise call `await load()` immediately, then a bounded retry (e.g. up to 3 tries at 500 ms) until the id/status appears; clear timers on unmount.
  3. Show 'Refreshing…' while pending.
- **Acceptance:**
  - Create draft: it appears in the list without manual refresh even with a 1.5 s delayed read (mock).
  - No state update after unmount warning.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /estab/dispatch  —  `estab/dispatch.html`

- **Source:** `apps/web/src/app/(app)/estab/dispatch/page.tsx`
- **Design reference:** `redesign/estab/dispatch.html`

### GAP-ESTAB-DISPATCH-01  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dispatch/page.test.tsx: File link to /estab/files/<id> when fileId set, none otherwise)
- **First-pass claim:** fileId is in the row type but not rendered (dispatch/page.tsx:9-18,66-72): the register cannot be traced back to the file it belongs to, contrary to its own subtitle.
- **Verified evidence:** dispatch/page.tsx:15 has fileId in DispatchRow but the columns (:66-73) omit it; subtitle (:53) says 'linked to eOffice files'. The row has no file number, only fileId.
- **Files to change:** `apps/web/src/app/(app)/estab/dispatch/page.tsx`
- **Fix steps:**
  1. Add a 'File' column rendering <Link href={`/estab/files/${r.fileId}`}>View file</Link> when fileId is set, else '—'.
  2. If the API can return fileNo, add it to DispatchRow and show it as link text (cannot verify).
- **Acceptance:**
  - Row with fileId links to the correct file detail; row without shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-DISPATCH-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** Acknowledge (delivery proof / POD in deliveryProof, deliveredAt stamped and audited by the consumer) already existed; this PR adds a 'Log a dispatch' form (POST /v1/estab/dispatch: addressee, subject, mode), shows the delivery date and POD on delivered rows, and hides both write controls from read-only viewers. No separate podNo/PATCH endpoint is needed: deliveryProof + POST /dispatch/delivery cover it.
- **W0 note:** partly fixed by #1916 — Acknowledge action via delivery endpoint added; no manual dispatch entry or podNo field.
- **First-pass claim:** A register with no way to record acknowledgement, POD/speed-post number or a manual dispatch entry; it depends entirely on other screens to create rows (whole file has no mutation).
- **Verified evidence:** dispatch/page.tsx is read-only: a single GET (:28), no POST/PATCH anywhere; DispatchRow (:8-17) has no POD, acknowledgement or receipt field. Rows come from DFA dispatch action (DfaPanel.tsx:173-176). Which endpoints exist for acknowledgement is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/dispatch/page.tsx`, `estab-service dispatch endpoints (not in snapshot)`
- **Fix steps:**
  1. Get product decision on scope: manual dispatch entry, POD/speed-post number, acknowledgement date.
  2. Backend: add fields podNo, acknowledgedAt and PATCH /estab/dispatch/:id/acknowledge with audit event.
  3. Web: add 'Record acknowledgement' ActionButton per row and a 'Log manual dispatch' form; refetch via load().
- **Acceptance:**
  - Recording POD updates row status to acknowledged and writes an audit event.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** New write path in a legal-record register; needs audit trail.

### GAP-ESTAB-DISPATCH-03  ·  LOW  ·  confirmed  ·  theme COPY (was DATEFMT)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dispatch/page.test.tsx: speed_post -> 'Speed Post', pending row -> 'Not yet dispatched')
- **First-pass claim:** Mode is printed raw while Status has underscores replaced (page.tsx:69,72); Date is "—" for undispatched rows with no explanation.
- **Verified evidence:** dispatch/page.tsx:70 prints mode raw (e.g. speed_post) while status is humanized (:72); :71 formatIndianDate(null) returns '—' (lib/formatters.ts:3) for undispatched rows with no explanation. Theme tag DATEFMT is loosely right only for the date part.
- **Files to change:** `apps/web/src/app/(app)/estab/dispatch/page.tsx`
- **Fix steps:**
  1. Render mode with humanizeStatus(r.mode).
  2. Render date cell as r.dispatchedAt ? formatIndianDate(...) : <span className='mut'>Not yet dispatched</span>.
  3. Use humanizeStatus for status label instead of inline replace.
- **Acceptance:**
  - Mode 'speed_post' shows 'Speed Post'; pending row shows 'Not yet dispatched'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-DISPATCH-04  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** Same server-side search and paging as DAK-04 on GET /v1/estab/dispatch (q, offset, pagination.total). Real-DB test in tests/register-search-paging-real-db.test.ts.
- **W0 note:** partly fixed by #1916 — Only Showing latest 100 notice; no server paging.
- **First-pass claim:** limit=100 with client paging at 15 (page.tsx:28,78); nothing indicates when the register is truncated at 100.
- **Verified evidence:** dispatch/page.tsx:28 fetches ?limit=100 and DataTable filterable pageSize={15} (:76-78) filters/pages only the 100 loaded rows; no total or truncation notice. Whether the response returns a total is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/dispatch/page.tsx`
- **Fix steps:**
  1. Read total from response (body.total/meta) and if rows.length < total show a notice 'Showing latest 100 of N'.
  2. Better: server-side page/q params with a paginated DataTable mode; refetch on page/filter change.
  3. Until backend supports it, show the notice when rows.length === 100.
- **Acceptance:**
  - With 100 rows returned the notice is shown; with fewer it is not.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; users may currently miss older dispatches.


---
## /estab/files/[id]  —  `estab/files-detail.html`

- **Source:** `apps/web/src/app/(app)/estab/files/[id]/page.tsx`
- **Design reference:** `redesign/estab/files-detail.html`

### GAP-ESTAB-FILES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme STATE (was OTHER)

- [x] **Status** (W1 SF-06 re-confirmed on this branch (FileDetailActions.tsx no longer guards on the dead 'closed' status; FileDetailActions.test.tsx terminal-state tests pass): closed by #1916, verified on main 9c5e9e9e9; W2 estab rescan evidence: closed (what the service writes on close) is read-only in the UI and the register keeps it distinct; the service answers 409 FILE_READ_ONLY on noting/submit/sign/move for closed/archived files and its consumers refuse them too (files-read-only-detail-contract-real-db.test.ts); FileDetailActions.test.tsx, page.test.tsx) (W2 estab rescan: completed by #2132)
- **First-pass claim:** Write actions are hidden only for status "closed" (FileDetailActions.tsx:183) but the register vocabulary is active/pending/archived/disposed (list/page.tsx:9-11); archived and disposed files still offer Sign, Submit and Refer, and "closed" may never occur.
- **Verified evidence:** FileDetailActions.tsx:183 `if (status === "closed") return null;` but mapEstabFileSummaries (_data/apiMappers.ts:726-731) normalises status to only active|pending|archived|disposed, so 'closed' can never occur and archived/disposed files always render Save note, Submit, Sign and Refer. Server rejection for such files cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/FileDetailActions.tsx`, `apps/web/src/app/(app)/estab/files/[id]/page.tsx`
- **Fix steps:**
  1. Replace the check with `const readOnly = status === 'archived' || status === 'disposed'` (export a shared isFileClosed helper next to EstabFileSummary status).
  2. When readOnly, render a read-only notice card ('This file is archived; no further action') instead of returning null.
  3. Also guard the hooks order: keep the early return after all hooks (already true).
  4. Backend to reject writes on archived/disposed (verify).
- **Acceptance:**
  - Component test: status archived and disposed -> no Submit/Sign/Refer buttons; active/pending -> present.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Fixes a control-exposure gap; pending files still allow actions as before.

### GAP-ESTAB-FILES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Attachments are rendered as plain text (fileName + date) with no link or download (FileAttachments.tsx:80-86); officers can upload but never open an attachment from the file.
- **Verified evidence:** FileAttachments.tsx:80-85 (file lines) renders <li>{a.fileName} + date as text; no anchor. The mapper (_data/apiMappers.ts:~795-803) drops any storageRef/url from attachments, so the page has no handle to download. No download route is visible in the web app; existing note-sheet PDF uses /api/proxy/v1/estab/files/:id/note-sheet/pdf (page.tsx:97). Backend download endpoint is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/FileAttachments.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `estab-service attachments GET (not in snapshot)`
- **Fix steps:**
  1. Backend: expose GET /estab/files/:id/attachments/:attId/download (presigned or streamed, authz + audit event attachment.downloaded).
  2. Web mapper: keep attachment id (already) and add size/fileType.
  3. In FileAttachments render <a href={`/api/proxy/v1/estab/files/${fileId}/attachments/${a.id}/download`} target='_blank' rel='noopener noreferrer'>{fileName}</a> with size (KB) and type.
  4. Show 'Unavailable' on 404 instead of a dead link.
- **Acceptance:**
  - Clicking an attachment downloads/open it; without permission returns 403 page.
  - Component test for anchor href.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Serving classified file content: enforce classification/access check server-side.

### GAP-ESTAB-FILES-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM (was OTHER)

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: the draft Submit/Sign act on is the latest yellow DRAFT by timestamp (page.test.tsx covers several drafts, submitted and green notes); Submit/Sign on a closed or archived file are refused (see FILES-DETAIL-01). Not done: server allowedActions (canSubmit/canSign) and any current-approver/author check on POST /v1/estab/files/:id/notings/:notingId/sign (today any estab role may sign any draft), because who may sign directly is an approval-chain policy decision. OWNER QUESTION: may a yellow draft be signed directly by (a) its author, (b) only the current approver of the SO > US > DS workflow task, or (c) any estab officer as today? And is Submit for the author only? Once answered: add canSubmit/canSign to GET /v1/estab/files/:id and gate the route and the notingSign consumer on the same rule.)
- **W2 note:** W2 estab re-check: still decision-first (who may sign directly vs submit; server allowedActions). Draft selection is already latest-first. Left open. (#2052)
- **W0 note:** partly fixed by #1916 — Helper text clarified, draft chosen explicitly; no server allowedActions.
- **First-pass claim:** Submit for approval and Sign note both act on the first draft yellow note (page.tsx:51-53). "Sign at your level" (FileDetailActions.tsx:209-211) lets one officer create a green note without the workflow task, so it is unclear which path is the approved chain.
- **Verified evidence:** page.tsx:51-54 picks the first note with noteType==='yellow' && noteStatus==='draft' and passes it as draftNotingId; both 'Submit for approval' (FileDetailActions.tsx:100-114, POST submit-for-approval) and 'Sign note (green)' (:122-134, POST notings/:id/sign) act on it. True that both are offered side by side (:206-212) and the sign tooltip says 'at your level'. Whether sign bypasses the workflow task is cannot-verify (server absent). Also .find picks the first, not latest, draft when several exist.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/page.tsx`, `apps/web/src/app/(app)/estab/files/[id]/FileDetailActions.tsx`, `estab-service noting sign handler (not in snapshot)`
- **Fix steps:**
  1. Get policy decision: who may sign directly (only current approver in chain) vs submit (drafter).
  2. Server should return allowedActions (canSubmit, canSign) for the current actor and draft; UI shows only allowed ones.
  3. Update helper text (:189-192) to describe the two paths, and disable with reason otherwise.
  4. Select the draft explicitly (latest by timestamp, or picker when >1).
- **Acceptance:**
  - Drafter sees only Submit; current approver sees Sign; test with two drafts picks the intended one.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval-chain integrity; mistaken direct signing is irreversible.
- **Depends on:** GAP-ESTAB-DFA-02

### GAP-ESTAB-FILES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme PII

- [x] **Status** (W2 estab: closed by #2052)
- **W1 SF-17b note (#2033):** OfficerName already reads only the operator roster (no /hrms/employees pull; failures not cached), and its labels now say "Unknown employee" instead of "Officer <id8>". Left open: names still come from the roster rather than a batched resolve for the ids on screen.
- **W0 note:** partly fixed by #1916 — Uses operator roster names only, cache only on success; no resolve endpoint or TTL.
- **First-pass claim:** OfficerName pulls GET /hrms/employees?limit=200 into every viewer's browser to resolve names (OfficerName.tsx:61-67) — over-fetching PII for a label, silently falling back to "Officer 3f9a1c2e" beyond 200 employees or without HR permission; the module-level cache is never refreshed.
- **Verified evidence:** OfficerName.tsx:59-70 fetches /api/proxy/v1/hrms/employees?limit=200 (and operators limit=500 at :46) in every viewer's browser, keeps only id+name but the full employee payload crosses the wire; failures are swallowed and `cache = {operators,names}` is set even if both fetches failed (:72), so the degraded map is permanent until page reload; no invalidation. Used by page.tsx:118, MovementTimeline and InboxPanel. Beyond 200 employees names fall back to 'Officer 3f9a1c2e' (:81). Whether the proxy strips HR fields is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/OfficerName.tsx`, `apps/web/src/app/(app)/estab/files/[id]/MovementTimeline.tsx`, `apps/web/src/app/(app)/estab/inbox/InboxPanel.tsx`, `services/hrms-service (new resolve endpoint)`
- **Fix steps:**
  1. Backend: add GET /hrms/officers/resolve?ids=a,b,c returning only {id,displayName,designation}, permitted for estab roles, no PII beyond that.
  2. Replace the list fetch in loadMaps with a batched resolve for the ids on screen (collect ids server-side in page.tsx and pass names as props, preferably).
  3. Do not cache failures: only set cache on success; add TTL (e.g. 5 min).
  4. Keep operators roster fetch but limit to needed ids.
- **Acceptance:**
  - Network tab shows no /hrms/employees list request from the file page.
  - Officer beyond first 200 employees resolves to name.
  - Failure on first load recovers on next mount.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII over-exposure (DPDP data minimisation); resolve endpoint must enforce authz and audit.

### GAP-ESTAB-FILES-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9; W2 estab rescan evidence: estab-service now sends each note's signedAt, the When column shows date and time, EstabFileDetailSchema no longer rejects or strips the real payload (loaders.estab.test.ts; service contract test parses the live response with it)) (W2 estab rescan: completed by #2132)
- **First-pass claim:** Note sheet rows show content and officer only — no timestamp, no e-sign hash/time (page.tsx:69-80,143-150); Officer is the raw ns.author.
- **Verified evidence:** page.tsx:70-80 builds NoteRow with idx, content, author, type, status only; mapper already supplies timestamp (apiMappers.ts:769) but it is unused; e-sign is only a ' · e-Signed' suffix (:77) with no signer time/hash (mapper does not carry them). author is ns.author raw (:76) and is not passed through <OfficerName>; whether it is a UUID or name is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Add `when` column = formatIndianDate/date-time of ns.timestamp.
  2. Render author with <OfficerName id={ns.author} /> via a column render (make NoteRow.author an id).
  3. If backend supplies signedAt/signHash, extend mapper and show 'Signed <time> · hash ab12…' for green notes.
  4. Sort by timestamp ascending.
- **Acceptance:**
  - Every note row shows date/time and officer name.
  - Green note shows signature time.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Legal record display; do not show a hash unless server-provided.
- **Depends on:** GAP-ESTAB-FILES-DETAIL-04, GAP-ESTAB-FILES-DETAIL-06

### GAP-ESTAB-FILES-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme TYPES (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9; W2 estab rescan evidence: EstabFileDetailSchema now covers noteType/noteStatus/eSigned/signedAt/dakNo/dueBy/movementHistory and matches the wire shape; mapper unit tests apiMappers.estabFile.test.ts and loader test loaders.estab.test.ts) (W2 estab rescan: completed by #2132)
- **First-pass claim:** Page reads noteType, noteStatus, eSigned, movementHistory, dakNo, dueBy through casts (page.tsx:51-67) because EstabFileDetail lacks them — type drift that hides API-shape changes.
- **Verified evidence:** page.tsx:51-53, 56-68, 71 cast noteSheets and the file to ad-hoc shapes for noteType, noteStatus, eSigned, dakNo, dueBy, movementHistory; the mapper also builds them and returns via an `as` cast (_data/apiMappers.ts:~809-815). EstabFileDetail is imported from @civitasone/types but that package is not in this snapshot (only packages/ui-kit), so the canonical type cannot be inspected.
- **Files to change:** `packages/types (EstabFileDetail, not in snapshot)`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/estab/files/[id]/page.tsx`
- **Fix steps:**
  1. Extend EstabFileDetail/NoteSheet in @civitasone/types with noteType, noteStatus, eSigned, dakNo, dueBy, movementHistory (typed MovementEntry).
  2. Remove the `as` cast in mapEstabFileDetail return and the casts in page.tsx.
  3. Add a zod schema check (EstabFileDetailSchema already used) covering the new fields.
- **Acceptance:**
  - tsc passes with casts removed.
  - Mapper unit test for a payload with movementHistory.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; type-only.

### GAP-ESTAB-FILES-DETAIL-07  ·  LOW  ·  confirmed  ·  theme ERRORS (was CONFIRM)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Action errors print raw response text (FileDetailActions.tsx:89,111,131,155); the refer picker lists "3f9a1c2e ·· Division ·· Role" rather than names (FileDetailActions.tsx:64-65); disabled-state on Sign/Submit gives no reason.
- **Verified evidence:** FileDetailActions.tsx throws new Error(await res.text()) at :89,111,131,155 and prints e.message in the alert (:250) and dialogs, so raw JSON/server text is shown. operatorLabel (:64-65) is employeeId.slice(0,8) + division + role, no name. Submit/Sign are disabled by !draftNotingId (:206,209) without explanation (only Sign has a title tooltip). Note the confirm dialogs themselves are in place, so the CONFIRM tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/estab/files/[id]/FileDetailActions.tsx`, `apps/web/src/app/(app)/estab/files/[id]/OfficerName.tsx`, `apps/web/src/lib/useFormError.ts`
- **Fix steps:**
  1. Use useFormError('note'|'file') like FileAttachments.tsx does: `(await fromResponse(res,'save')).message`; replace all four res.text() throws.
  2. Render operator options with <OfficerName> logic (share resolveLabel from OfficerName.tsx) so options read 'Name · Role'.
  3. When !draftNotingId show helper text 'Save a yellow note first' next to the disabled buttons.
- **Acceptance:**
  - Failed submit shows a humanised message not JSON.
  - Refer dropdown shows names.
  - Disabled Submit shows reason text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-FILES-DETAIL-04


---
## /estab/files/new  —  `estab/files-new.html`

- **Source:** `apps/web/src/app/(app)/estab/files/new/page.tsx`
- **Design reference:** `redesign/estab/files-new.html`

### GAP-ESTAB-FILES-NEW-01  ·  HIGH  ·  confirmed  ·  theme CLASSIFICATION (was CAP)

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: the form posts the selected value unchanged (no CLASS_MAP) and the DAK open-file dialog no longer hard-codes public; files/new/page.test.tsx asserts payload.classification === selected option. Not done: the acceptance "creating a Restricted file stores/returns restricted" - estab-service's classification enum, its DB CHECK (migrations/0001_init.sql) and the clearance ranks (operators/eligibility.ts CLASSIFICATION_RANK public=1 < confidential=2 < secret=3 < top_secret=4, with desk clearance_level 1..4) have no restricted tier, so the form offers only the four server tiers. OWNER QUESTION: is a restricted tier required (the web register labels already name it)? If yes, where does it sit in the clearance ladder (between public and confidential?), who may open restricted files, how are existing desk clearance levels renumbered, and how are files already stored as confidential that were meant as Restricted to be re-marked (not recoverable automatically)? Until decided, nothing is added: a new tier is an access-control change.)
- **First-pass claim:** Classification is remapped client-side: Unclassified→public, Restricted→confidential, Confidential→confidential (CLASS_MAP, files/new/page.tsx:8-14). Restricted and Confidential become indistinguishable in the stored file, and the label "public" for an internal government file is never shown to the officer.
- **Verified evidence:** files/new/page.tsx:8-14 CLASS_MAP sends unclassified->public, restricted->confidential, confidential->confidential (used at :42), so Restricted is lost. On read, mapEstabFileSummaries (apiMappers.ts:719-725) maps public->unclassified and also accepts a stored 'restricted', which suggests the API vocabulary includes restricted; the accepted server enum is cannot-verify (estab-service absent). dak/page.tsx:89 also hard-codes classification 'public'.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`, `apps/web/src/app/(app)/estab/dak/page.tsx`, `estab-service classification enum (not in snapshot)`
- **Fix steps:**
  1. Check the server enum; if it has restricted/unclassified, send the selected value unchanged and delete CLASS_MAP.
  2. If the enum truly lacks them, change the backend enum instead (data loss otherwise).
  3. Update dak/page.tsx:89 to send unclassified rather than public (or let user choose).
  4. Add migration note for files already stored as confidential that were Restricted (cannot be recovered automatically).
- **Acceptance:**
  - Creating a Restricted file stores/returns restricted and detail shows 'restricted'.
  - Unit test that payload.classification === selected option.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Security marking data loss; restricted files handled as confidential (or vice versa) affects access control.

### GAP-ESTAB-FILES-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 estab: closed by #2042; the W0 tick #1916 covered only the web pickers)
- **W2 estab note:** Re-check found the W0 tick incomplete: the form posted a typed dakNo (never the inwardId), so the DAK stayed unlinked, and the service accepted a second file for an already-linked DAK and any parent id. Now: the form offers only unlinked DAK entries and posts inwardId; POST /v1/estab/files and POST /inward/:id/open-file return 409 DAK_ALREADY_LINKED / 404 INWARD_NOT_FOUND, a nonexistent or foreign parent returns 404 PARENT_FILE_NOT_FOUND, and the consumers re-check under a row lock so two simultaneous openings of one DAK produce one file. Real-DB test: tests/dak-one-file-real-db.test.ts (includes the race).
- **First-pass claim:** Parent file is entered as a raw UUID and DAK as a typed number (page.tsx:149-190); no lookup, no validation that they exist, and the DAK can also be linked by "Open file" on the DAK page, allowing two files for one DAK.
- **Verified evidence:** files/new/page.tsx:149-192 are free text inputs: dakNo (placeholder DAK/2026/001) and parentFileId ('UUID of main file'); only trimming, no format check or lookup (:47-48). dak/page.tsx:81 can open a file from an inward DAK independently. Server-side duplicate-DAK-link enforcement is cannot-verify. No EntityPicker exists in _components/ds (grep), it must be created.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`, `apps/web/src/app/(app)/estab/dak/page.tsx`
- **Fix steps:**
  1. Create ds/EntityPicker (typeahead over an endpoint, returns id, shows label).
  2. DAK field: picker over unlinked inward items (GET /estab/inward filtered to unlinked) returning dakNo; send inwardId.
  3. Parent field: picker over GET /estab/files?q= showing fileNo + subject; send id.
  4. Backend: reject linking a DAK already linked (409).
- **Acceptance:**
  - Cannot submit a nonexistent parent file id.
  - Second file for an already-linked DAK returns 409 with humanised message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate files for one DAK is a records-integrity issue.

### GAP-ESTAB-FILES-NEW-03  ·  MEDIUM  ·  partly  ·  theme MASTERDATA (was DEADROUTE)

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: on new-file and DAK open-file the department is a pick-list of the enrolled operator divisions; the typed-in fallback now appears ONLY when no master exists to pick from (no operators enrolled yet, or the role cannot read the directory), never after a network/server failure (a disabled select plus an alert instead). Remaining: (a) which master is authoritative, operator divisions or hrms departments (GET /v1/hrms/departments is HR-role gated, so estab roles cannot read it), and (b) whether estab-service must reject a dept outside the master once operators are adopted (greenfield tenants would stay unrestricted, as for the other operator checks). Typo departments can still be created through the API or in a tenant with no operators.)
- **Previous status:** (change to `[x]` when done, `[~]` if blocked + reason)
- **W2 estab note:** INTERIM, NEEDS OWNER DECISION. The department on new-file and on DAK open-file is now a pick-list of the enrolled operator divisions (useEstabDivisions) with no free-text fallback and no silent 'ADMIN'. Still open: (a) which master is authoritative (operator divisions vs hrms departments) and (b) whether estab-service must reject a dept outside it. Not built because rejecting would block greenfield tenants that have no operators yet.
- **W0-10 note:** review found the W0 tick partly — department select built from operators' divisions (files/new/page.tsx:74) but free-text input fallback remains (:416) so typos possible; dak/page.tsx:316 open-file dept still free text 'e.g. ADMIN'; no master dept endpoint/backend validation; still falls back to 'ADMIN' (:154)
- **First-pass claim:** Department is a free-text input defaulting to "ADMIN" (page.tsx:20,41); the register filters and dak/open-file also hard-code ADMIN, so typos create orphan departments.
- **Verified evidence:** files/new/page.tsx:20 defaults department 'ADMIN', :41 `dept: department || 'ADMIN'`, input is free text (:234-238). dak/page.tsx:88 hard-codes dept 'ADMIN'. Claim that the register filters hard-code ADMIN is not true: list/page.tsx and list/FilesTable.tsx contain no ADMIN. No departments lookup loader found in loaders.ts. Orphan-department creation depends on server validation (cannot-verify). Theme DEADROUTE is wrong.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`, `apps/web/src/app/(app)/estab/dak/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add/locate a departments master endpoint (org units) and loader.
  2. Replace the input with a <select> (or EntityPicker) defaulting to the operator's own department.
  3. Send the same in dak/page.tsx open-file instead of literal 'ADMIN'.
  4. Backend: validate dept against master.
- **Acceptance:**
  - Dropdown lists only master departments.
  - Typo departments cannot be created.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Default ADMIN misroutes files to wrong department.
- **Depends on:** GAP-ESTAB-FILES-NEW-02

### GAP-ESTAB-FILES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: files/new/page.test.tsx: error banner role=alert, focused, not auto-dismissed)
- **First-pass claim:** The error banner auto-clears after 5 s (page.tsx:74) and the form is not scrolled/focused to it; role="alert" is missing on the banner div (page.tsx:93-108), unlike the guest house form.
- **Verified evidence:** files/new/page.tsx:74 setTimeout(() => setToast(null), 5000) in finally clears error and success toasts after 5 s (timer not cleared on unmount); the banner div (:93-108) has no role, no aria-live, no focus/scroll. guesthouse/new/page.tsx:262 uses role="alert".
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`
- **Fix steps:**
  1. Add role={toast.type==='error'?'alert':'status'} to the banner.
  2. Do not auto-dismiss errors; clear on next submit or user dismiss; keep timer only for success and clear it in an effect cleanup.
  3. On error, scrollIntoView/focus the banner via ref (tabIndex=-1).
- **Acceptance:**
  - Error banner stays until next submit and is announced by a screen reader; focus moves to it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-FILES-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme DOUBLESUBMIT (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: files/new/page.test.tsx: double click makes exactly one POST, button latched disabled)
- **First-pass claim:** finally re-enables Create File immediately (page.tsx:72-75) while the redirect waits 800 ms (page.tsx:62); a second click in that window opens a second file (the server allocates a new gapless number each time).
- **Verified evidence:** files/new/page.tsx:72-73 finally setSubmitting(false) runs right after the success branch, while router.push waits 800 ms (:62); the button (:285) is enabled again in that window and Enter/click posts again, creating another file (server allocates a new number per the comment at :36-37). Also if body.id is missing nothing navigates and the form stays filled.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`
- **Fix steps:**
  1. Add `created` state; keep submit disabled (`disabled={submitting || created}`) after success; only reset submitting on failure.
  2. Remove the timeout and call router.push immediately (or after showing number, see NEW-06).
  3. Send an Idempotency-Key header (crypto.randomUUID per form mount) if backend supports it.
  4. If success without id, show link to register and keep button disabled.
- **Acceptance:**
  - Double click Create within 1 s results in exactly one POST (test with mocked fetch).
  - Backend idempotency test if key added.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Duplicate legal file numbers (gapless series) are hard to reverse.
- **Depends on:** GAP-ESTAB-FILES-NEW-06

### GAP-ESTAB-FILES-NEW-06  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: files/new/page.test.tsx: success banner shows the server-allocated file number) (W2 estab rescan: completed by #2132)
- **W2 estab rescan note:** Create now sends the officer straight to the file with ?created=1 and the file page shows 'File {fileNo} has been created' (the 202 ack carries no fileNo: the gapless number is allocated when the command is processed, so none is invented); the detail loader no longer validates the raw DTO against a schema it never matched (public/draft/null holder/createdAt), so the page loads for a fresh file. Tests: files/new/page.test.tsx (real 202 ack), files/[id]/page.test.tsx (banner + being-created), _data/loaders.estabFiles.test.ts (real service DTO).
- **First-pass claim:** Success message omits the allocated file number and redirects after 800 ms (page.tsx:57-62); an officer who is redirected away cannot copy the number from the banner.
- **Verified evidence:** files/new/page.tsx:56-62 reads only body.id and shows a fixed message without the file number, then redirects after 800 ms. The response may carry fileNo but that is cannot-verify. Theme I18N is wrong; it is copy.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`
- **Fix steps:**
  1. Read fileNo from the response body (or fetch the detail) and show 'File {fileNo} created.'
  2. Redirect with router.push immediately and show the number on the detail page via a one-time query flag (?created=1) banner, or keep the banner with an 'Open file' link and no auto-redirect.
  3. Ensure the detail page shows fileNo prominently (it already does in the title).
- **Acceptance:**
  - After create the officer sees the allocated file number before or after navigation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-FILES-NEW-05

### GAP-ESTAB-FILES-NEW-07  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Cancel is a plain anchor to /estab/list (page.tsx:288) discarding a typed note without confirmation.
- **Verified evidence:** files/new/page.tsx:288 Cancel is <a href='/estab/list' className='btn ghost'>, a full-page navigation with no dirty-state check, so a typed subject/initial note is lost silently.
- **Files to change:** `apps/web/src/app/(app)/estab/files/new/page.tsx`
- **Fix steps:**
  1. Compute dirty = subject||initialNote||dakNo||parentFileId non-empty.
  2. If dirty, intercept Cancel with ConfirmDialog ('Discard this file?') via useConfirmAction; else navigate.
  3. Use next/link / router.push instead of anchor; add a beforeunload handler while dirty.
- **Acceptance:**
  - Cancel with empty form navigates immediately; with typed note shows a confirm dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /estab/guesthouse  —  `estab/guesthouse.html`

- **Source:** `apps/web/src/app/(app)/estab/guesthouse/page.tsx`
- **Design reference:** `redesign/estab/guesthouse.html`

### GAP-ESTAB-GUESTHOUSE-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: stale pending-approval copy on the new-booking page replaced (bookings are confirmed once processed); check-out no longer hard-codes chargesMinor 0, the officer states the charges (exact integer paise, blank is not 0, no tariff assumed). Remaining: no approve/reject step or endpoint exists. Owner: is a booking approval step wanted (who approves, maker-checker so the requester cannot approve), and should check-out charges come from a tariff rather than being entered?)
- **Previous status:** (closed by #2104, verified implementation present in codebase)
- **W2 PQ-A note (#2037):** no approval step or endpoint exists for room bookings (estab-service facilities has only book/checkin/checkout); check-in/out are now shown only to estab officer roles and the subtitle no longer claims approvals. Needs owner decision: is a booking approval step wanted (new endpoint plus maker-checker)?
- **W0-10 note:** review found the W0 tick partly — Check-in/check-out with ConfirmDialog added (BookingsTable.tsx:44-113) but no approve/reject, no role/approver gating, subtitle still says 'Room booking and approvals.' (guesthouse/page.tsx:32; fix step 5 unmet), checkout hard-codes chargesMinor:0 (BookingsTable.tsx:~50)
- **First-pass claim:** Page advertises "approvals" and counts "Pending Approval" (page.tsx:33,43) but offers no way to approve, reject, check in or check out — nothing in guesthouse/ mutates a booking; a pending request is a dead end.
- **Verified evidence:** guesthouse/page.tsx:33 subtitle says 'approvals' and :43 shows a 'Pending Approval' stat; BookingsTable.tsx renders plain DataTable rows with no rowLink or actions (only a Pending/In-house filter). Nothing under estab/guesthouse/ issues a PATCH/POST besides new/page.tsx. Whether a backend approve/check-in API exists cannot be verified (no estab service in snapshot); the /estab/approvals tile is for file notes.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/BookingsTable.tsx`, `apps/web/src/app/(app)/estab/guesthouse/page.tsx`, `apps/web/src/app/(app)/estab/guesthouse/[id]/page.tsx (new)`
- **Fix steps:**
  1. Confirm with the estab service which transition endpoints exist (approve, reject, check-in, check-out).
  2. Add a booking detail route or per-row actions using ConfirmDialog (useConfirmAction) with requireReason for reject.
  3. Pass an allowed-actions/role flag so only approvers see Approve/Reject.
  4. Refresh via router.refresh after success; toast result.
  5. Until backend exists, drop 'approvals' from the subtitle and mark stat as read-only.
- **Acceptance:**
  - Test: pending row shows Approve/Reject; approve calls the endpoint and row status updates.
  - Manual: non-approver sees no action buttons.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval action affects room allocation; enforce maker≠checker server-side.
- **Depends on:** GAP-ESTAB-HOME-04

### GAP-ESTAB-GUESTHOUSE-03  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1916, verified on main 9c5e9e9e9) (W2 estab rescan: completed by #2132)
- **W2 estab rescan note:** The service now sends the full check-in/out instants (facilities/queries.ts) instead of YYYY-MM-DD cut from them, so the register shows the booked time (01 Oct 14:00 IST) and an early-morning IST booking lands on the right day; the page never renders a time for a bare date. Tests: estab-cluster03-real-db.test.ts (real DB, IST boundary), guesthouse/page.test.tsx.
- **First-pass claim:** Table omits sponsoring department and timing; Dates show dd/mm/yyyy only although check-in/out are datetime values (page.tsx:19-22, new/page.tsx:205-235).
- **Verified evidence:** page.tsx:23 renders dates via formatIndianDate (lib/formatters.ts:2-8), which is dd/mm/yyyy date-only in the server's locale timezone, so time-of-day is dropped although the form collects datetime (new/page.tsx:206-236). BookingRow (BookingsTable.tsx:6-14) has no sponsor-department column; whether the summary type carries sponsorDept is unverifiable.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/page.tsx`, `apps/web/src/app/(app)/estab/guesthouse/BookingsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime (Asia/Kolkata, dd Mon yyyy hh:mm) to lib/formatters.ts.
  2. Use it for the Dates column in page.tsx:23 (split into Check-in / Check-out columns).
  3. If the API returns sponsorDept, add a Department column to BookingRow and DataTable; otherwise request it from backend.
- **Acceptance:**
  - Unit test for formatIndianDateTime with IST boundary.
  - Manual: booking 01 Oct 14:00 shows the time.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-GUESTHOUSE-NEW-05

### GAP-ESTAB-GUESTHOUSE-04  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Upcoming" uses string comparison checkInDate > today on an ISO string (page.tsx:9-13); a datetime value for today compares greater than the date-only "today" and would be miscounted.
- **Verified evidence:** page.tsx:12 builds today as UTC date (toISOString().split('T')[0]) and :16 compares b.checkInDate > today as strings. If checkInDate is a datetime (the form sends full ISO), '2026-09-29T08:30:00Z' > '2026-09-29' is true so a same-day check-in counts as Upcoming; UTC date also lags IST by 5.5 h. If the API returns date-only values it works. Field format not verifiable.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/page.tsx`
- **Fix steps:**
  1. Normalise both sides: compute today in IST (Intl.DateTimeFormat en-CA, timeZone Asia/Kolkata) and compare against checkInDate.slice(0,10).
  2. Move the counting into a small tested helper (e.g. countGuesthouseStats) used by page.tsx.
- **Acceptance:**
  - Unit test: confirmed booking checking in today at 14:00 IST is not Upcoming; tomorrow's is.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; stat card only.

### GAP-ESTAB-GUESTHOUSE-05  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No back link and no occupancy view (rooms × dates) although the subtitle promises "occupancy management"; EmptyState has no action (page.tsx:31-38,53).
- **Verified evidence:** page.tsx:31-37 PageHeader has no `back` prop (the new-booking page does, new/page.tsx:102); subtitle promises 'occupancy management' but only a booking table exists; EmptyState at :53 has no action although a New Booking link exists at :35.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/page.tsx`
- **Fix steps:**
  1. Add back="/estab" to PageHeader.
  2. Give EmptyState an action linking to /estab/guesthouse/new (check EmptyState props in ds/EmptyState.tsx).
  3. Either reword subtitle to 'Room booking and approvals' or add an occupancy grid later (needs rooms API, see NEW-01).
- **Acceptance:**
  - Manual: back link goes to hub; empty state shows New Booking button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-GUESTHOUSE-NEW-01


---
## /estab/guesthouse/new  —  `estab/guesthouse-new.html`

- **Source:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`
- **Design reference:** `redesign/estab/guesthouse-new.html`

### GAP-ESTAB-GUESTHOUSE-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: the free-text Room ID field is gone; the room is always chosen by name (101 · deluxe (2-bed)) from the directory, with distinct states for loading, directory failed (alert), no rooms registered and none available; tests submit the id chosen from the picker. Remaining: nothing in estab-service or the web creates estab_rooms (only scripts/dev/seed-all.mjs), so a real tenant has no rooms to pick. Owner: who maintains the room directory and how, an in-app add-room screen for an establishment administrator (needs a guesthouse list and an add-room command) or a per-tenant import?)
- **Previous status:** (W1 SF-06 re-confirmed on this branch (guesthouse/new/page.test.tsx NEW-01..05 pass): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Officers must type a room UUID (new/page.tsx:36-40,139-160); the page itself admits the picker is "pending a rooms directory API". A clerk cannot know a room's UUID, so the form is unusable without out-of-band data.
- **Verified evidence:** guesthouse/new/page.tsx:8-9,37-40 require roomId to match UUID_RE; input at :139-151 is a free-text 'Room UUID' field; help text at :152-155 says 'A room picker is pending a rooms directory API'. No rooms list loader exists in _data/loaders.ts and hrms-service has no guesthouse code, so the rooms endpoint is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ds/RoomPicker.tsx (new) or generic EntityPicker`
- **Fix steps:**
  1. Backend: expose a room directory list (roomNo, type, capacity, availability for a date range) under estab; confirm exact path with the service owner (not visible here).
  2. Add a getGuesthouseRooms loader / client fetch via /api/proxy with zod schema at the boundary.
  3. Create a searchable picker (no EntityPicker exists in ds/ or _components; SmartCombobox only handles string options) showing room no + type, value = room id.
  4. Replace the roomId text input and UUID_RE check in new/page.tsx with the picker; require a selection.
  5. Remove the 'picker is pending' help text; keep the UUID only in the payload.
- **Acceptance:**
  - Component test: picker lists rooms by name and submits the selected room's id in the payload.
  - Manual: a clerk with no UUID knowledge creates a booking by choosing 'Room 101'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong room selection books the wrong asset; keep availability check server-side.

### GAP-ESTAB-GUESTHOUSE-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W1 SF-06: closed by #2013, guest employee is now chosen with EmployeePicker; supersedes the W0 PROVISIONAL tick)
- **First-pass claim:** Guest employee ref is also a raw UUID (new/page.tsx:44-49,186-200) instead of a staff search; staff guests (the common case) cannot be linked by name.
- **Verified evidence:** new/page.tsx:45-50 validate guestRef against UUID_RE; input at :186-196 is plain text with placeholder 'Employee UUID, if the guest is staff'. The codebase already reads the HRMS directory via /api/proxy/v1/hrms/employees?limit=200 (files/[id]/OfficerName.tsx), so a name lookup is feasible.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`, `apps/web/src/app/_components/ds/StaffPicker.tsx (new)`
- **Fix steps:**
  1. Build a StaffPicker that queries /api/proxy/v1/hrms/employees (add a server-side search param if the endpoint supports it; unverified, limit=200 cap otherwise) and returns the employee id.
  2. On selection auto-fill guestName from the employee name (keep editable) and send guestRef = id.
  3. Replace the guestRef text input and its UUID validation; keep field optional.
  4. Show a note when the directory fails to load, allowing manual guest name only.
- **Acceptance:**
  - Component test: selecting a staff member fills name and payload guestRef.
  - Manual: leaving the picker empty still submits an external guest.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; optional field. Directory read exposes staff names to the booking clerk (already true elsewhere).
- **Depends on:** GAP-ESTAB-HANDOVER-01

### GAP-ESTAB-GUESTHOUSE-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was CAP)

- [x] **Status** (W1 SF-06 re-confirmed on this branch (guesthouse/new/page.test.tsx NEW-01..05 pass): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Only the first validation error is shown, at the bottom of the form (new/page.tsx:34-58,259-266), with no field highlighting or focus move.
- **Verified evidence:** handleSubmit (new/page.tsx:34-60) returns on the first failing check and sets a single fieldError string rendered once below the fields (:259-268, role=alert). Inputs have no aria-invalid/aria-describedby for the error and no focus move. Native `required` on inputs catches blank fields first, so the gap is mainly UUID/date-order errors.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`
- **Fix steps:**
  1. Replace fieldError string with a Record<field,string> built by a zod schema (safeParse) covering room, guestName, guestRef, checkIn/out ordering.
  2. Render each message under its input with id, aria-describedby and aria-invalid.
  3. On failed submit, focus the first invalid field (ref by field key).
  4. Keep a summary role=alert only for server errors.
- **Acceptance:**
  - Test: submitting with reversed dates and empty name shows both messages beside their fields.
  - Test: focus lands on first invalid input.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-GUESTHOUSE-NEW-04

### GAP-ESTAB-GUESTHOUSE-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W1 SF-06 re-confirmed on this branch (guesthouse/new/page.test.tsx NEW-01..05 pass): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** On success the finally block re-enables the button at once (new/page.tsx:91-93) while the redirect to the register waits 900 ms (new/page.tsx:81); a second click in that window posts a duplicate booking request.
- **Verified evidence:** On success, setTimeout(router.push, 900) is scheduled at new/page.tsx:82, but the finally block (:91-93) runs immediately and calls setSubmitting(false), so the Create button (:277) is re-enabled for ~900 ms and a second click POSTs /api/proxy/v1/estab/room-bookings again. No idempotency key is sent.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`
- **Fix steps:**
  1. Add a `done` state set on success; disable the submit Button when submitting || done.
  2. Only call setSubmitting(false) in the failure/catch paths (not on success).
  3. Navigate immediately with router.push (or router.replace) instead of the 900 ms timeout; keep the toast via query param or skip it.
  4. Optionally send an Idempotency-Key header if the estab service supports one (unverified).
- **Acceptance:**
  - Test: double click on submit results in one fetch call (mock fetch, 202).
  - Manual: button stays disabled until navigation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Duplicate bookings block rooms and confuse approvers.

### GAP-ESTAB-GUESTHOUSE-NEW-05  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W1 SF-06 re-confirmed on this branch (guesthouse/new/page.test.tsx NEW-01..05 pass): closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Check-in/out are datetime-local converted with new Date(...).toISOString() (new/page.tsx:56-57), i.e. browser timezone → UTC; nothing indicates the timezone or standard check-in time.
- **Verified evidence:** new/page.tsx:55-56 do new Date(checkIn).toISOString(); datetime-local values have no zone so they are interpreted in the browser's timezone and sent as UTC. Labels (:206-228) show no timezone or standard check-in/out time. Correct only if every browser is set to IST.
- **Files to change:** `apps/web/src/app/(app)/estab/guesthouse/new/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Build the ISO string explicitly as IST (`${checkIn}:00+05:30`) rather than relying on the browser zone.
  2. Add '(IST)' to both labels and an optional default time (e.g. 12:00 check-in) as a hint; confirm the house rule with the guest house owner.
  3. Add formatIndianDateTime to lib/formatters.ts (dd Mon yyyy, hh:mm, timeZone Asia/Kolkata) for display elsewhere.
- **Acceptance:**
  - Unit test: '2026-10-01T14:00' serialises to 2026-10-01T08:30:00.000Z regardless of TZ env.
  - Manual: change OS timezone; payload unchanged.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong offset shifts booking by hours across day boundary.
- **Depends on:** GAP-ESTAB-GUESTHOUSE-03


---
## /estab/handover  —  `estab/handover.html`

- **Source:** `apps/web/src/app/(app)/estab/handover/page.tsx`
- **Design reference:** `redesign/estab/handover.html`

### GAP-ESTAB-HANDOVER-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Officers are identified by employeeId.slice(0,8)+"…" plus division in both pickers, the confirm text and the history (HandoverPanel.tsx:61-64,121,128,163-164). Two officers in one division are indistinguishable, and a mis-pick moves an entire desk.
- **Verified evidence:** HandoverPanel.tsx:61-64 label() = employeeId.slice(0,8)+'… · division'; selects at :121 and :128 show slice(0,8)… · division · deskRole; history :162-163 and the confirm text :176 use label(). No names. files/[id]/OfficerName.tsx already resolves names via /api/proxy/v1/hrms/employees?limit=200 plus operator roster but is not used here. The confirm dialog is present (ConfirmDialog, danger) but has no requireReason; reason is a form select already.
- **Files to change:** `apps/web/src/app/(app)/estab/handover/HandoverPanel.tsx`, `apps/web/src/app/(app)/estab/files/[id]/OfficerName.tsx`
- **Fix steps:**
  1. Export loadMaps/resolveLabel from OfficerName.tsx (or move to lib/estab/officers.ts) so both share the cache.
  2. In HandoverPanel load the maps once; make label() return `Name · Desk Role (division)` with short id as last resort.
  3. Use it in both <option> lists, DataTable From/To columns and the ConfirmDialog description.
  4. Optionally set requireReason on ConfirmDialog for audit note; audit event emission is backend (unverified).
- **Acceptance:**
  - Test: option text shows the employee name and desk role for two officers of one division.
  - Manual: confirm text names both officers.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Bulk file reassignment; misidentification is the main business risk.
- **Depends on:** GAP-ESTAB-INBOX-01

### GAP-ESTAB-HANDOVER-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9) (W2 estab rescan: completed by #2132)
- **W2 estab rescan note:** held-count now returns count (live files) and movableCount (exactly the files the handover consumer reassigns, one shared predicate HANDOVER_MOVES_STATUS); the dialog and preview state movableCount and say how many other files stay; the handover cannot start while the count is loading, failed or 0 ('Check again' retries). estab_division_admin, whom the handover screen admits, can now read the count. Tests: estab-cluster03-real-db.test.ts (count == files moved), HandoverPanel.test.tsx. Owner question remaining as a note, not a blocker: drafts and closed files are not moved today (see OWNER DECISION in the cluster report).
- **First-pass claim:** The confirm dialog never says how many files will move (HandoverPanel.tsx:173-183); fileCount is only known after the fact in history.
- **Verified evidence:** ConfirmDialog description (HandoverPanel.tsx:173-183) says 'every file' but shows no count; fileCount exists only on history rows (type at :14, column at :165). No count preview endpoint is visible.
- **Files to change:** `apps/web/src/app/(app)/estab/handover/HandoverPanel.tsx`
- **Fix steps:**
  1. Add a preview: count files whose currentHolder equals fromOfficerId (via a backend count endpoint, or the estab files list if uncapped; unverified).
  2. Show the number in the ConfirmDialog description and disable confirm if the count fetch fails or is 0 with a message.
  3. Fetch when fromOfficerId changes.
- **Acceptance:**
  - Test: dialog text includes 'N files'.
  - Manual: officer with 0 files sees a warning.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Client-side count of a capped list could understate; prefer server count.
- **Depends on:** GAP-ESTAB-HANDOVER-01

### GAP-ESTAB-HANDOVER-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "From officer" lists inactive operators (operators.map) which is right for retirement, but nothing marks them as inactive (HandoverPanel.tsx:121).
- **Verified evidence:** 'From officer' select maps all operators (HandoverPanel.tsx:121) including active:false, while 'To' uses activeOps (:101,128); Operator.active exists (:7) but option text never shows it.
- **Files to change:** `apps/web/src/app/(app)/estab/handover/HandoverPanel.tsx`
- **Fix steps:**
  1. Append ' (inactive)' to the option label when !o.active in the From list (and sort active first, or use optgroups).
  2. Show the same tag in the label() used for history.
- **Acceptance:**
  - Test: inactive operator option text contains '(inactive)'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-HANDOVER-05  ·  LOW  ·  partly  ·  theme LOADERROR (was I18N)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9) (W2 estab rescan: completed by #2132)
- **W2 estab rescan note:** load() settles the roster and the history independently: a history-only 500 leaves the officer pickers populated and Hand over reachable, an operators-only 500 blocks the form while the history still loads. Tests: HandoverPanel.test.tsx (history 500 leaves form usable; roster 500 blocks form but history loads; both fail).
- **First-pass claim:** Load-error copy: the specific messages built at :44-45 are discarded and a generic ErrorState is shown (HandoverPanel.tsx:155); the form stays usable with empty pickers.
- **Verified evidence:** load() builds specific messages (:42-43) and stores err.message in loadError (:49), but the render uses toHumanError('load',{area:'handover history'}) (:155), discarding them. However the 'form usable' claim is overstated: pickers are empty so the Hand over button (:143) stays disabled until officers are selected. The error covers both operators and history yet is placed only in the history card; the shared RefreshErrorState is not used.
- **Files to change:** `apps/web/src/app/(app)/estab/handover/HandoverPanel.tsx`
- **Fix steps:**
  1. Show the error state above the form when the operator list fails (block the form), separate from the history card.
  2. Switch to RefreshErrorState / pass loadError-derived message through toHumanError, keeping the retry.
  3. Render distinct operators-failed vs history-failed states.
- **Acceptance:**
  - Test: operators 500 shows an error banner and disabled form; history 500 leaves form usable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-HANDOVER-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Reason" options render raw lowercase; the new row appears after a fixed 900 ms reload (HandoverPanel.tsx:81,131-135).
- **Verified evidence:** REASONS (HandoverPanel.tsx:19) are rendered as raw lowercase values in the select (:134) and the history table (:164); the post-submit refresh is a fixed setTimeout(load, 900) at :81.
- **Files to change:** `apps/web/src/app/(app)/estab/handover/HandoverPanel.tsx`
- **Fix steps:**
  1. Add a REASON_LABEL map (Transfer, Leave, Retirement, Suspension) and use it for select, table and dialog text.
  2. Replace the 900 ms timer with a direct await load() after POST, or optimistic row insert with status queued.
- **Acceptance:**
  - Test: option text is 'Transfer'.
  - Manual: new row appears without arbitrary delay (or shows queued).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /estab/inbox  —  `estab/inbox.html`

- **Source:** `apps/web/src/app/(app)/estab/inbox/page.tsx`
- **Design reference:** `redesign/estab/inbox.html`

### GAP-ESTAB-INBOX-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: inbox/page.test.tsx sources rows from the My-Desk loader; GET /v1/estab/files/mine filters to the actor (files/routes.ts:263)) (W2 estab rescan: completed by #2132)
- **W2 estab rescan note:** GET /v1/estab/files/mine now matches a file held under the officer's login id OR their hrms employee id (resolveActorEmployeeId bridge, fails closed with 503), excludes everyone else's and other tenants' files, and reports { operator: { adopted, enrolled } }; My Desk shows an explanation (not 'Nothing on your desk') for a non-enrolled user. Tests: estab-cluster03-real-db.test.ts (real DB: own + forwarded + others excluded + 503), inbox/page.test.tsx, _data/loaders.estabFiles.test.ts.
- **First-pass claim:** "My Desk" is not filtered to the signed-in officer: it uses getEstabFiles() for every file and counts status "active" as "Active on desk" (inbox/page.tsx:9,30,51). The register page even says this page is "the real per-desk view" (list/FilesTable.tsx:19-21) — but nothing compares currentHolder to the user.
- **Verified evidence:** inbox/page.tsx:18 calls getEstabFiles() (all files, /api/v1/estab/files, loaders.ts:3658); :30 'Active on desk' = every status 'active' file; InboxPanel.tsx:48-55 filters only by status. currentHolder is mapped (apiMappers.ts:740) and shown but never compared to the user. list/FilesTable.tsx:17-19 comment states inbox is the per-desk view. The signed-in identity is available only via /api/auth/session (userId); whether userId equals the operator employeeId is unverified.
- **Files to change:** `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/inbox/InboxPanel.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide the identity key: confirm session userId == currentHolder (employeeId) or add a backend `mine=true`/`currentWith=me` filter on GET /api/v1/estab/files.
  2. Add getEstabDeskFiles() loader using that filter (preferred) or filter server-side in page.tsx by session employeeId.
  3. Compute stats only from the desk subset; rename 'Total files' to 'On my desk'.
  4. Handle users who are not registered operators with an EmptyState explaining it.
- **Acceptance:**
  - Test: files held by others are excluded from rows and counts.
  - Manual: two officers see different lists.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Currently misleading for approvers; also avoid exposing others' files if desk is meant to be private.
- **Depends on:** GAP-ESTAB-INBOX-02

### GAP-ESTAB-INBOX-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: inbox/page.test.tsx: a failed load shows an error state and em-dash stats)
- **First-pass claim:** A failed fetch reads as good news: only DataSourceBadge is added (inbox/page.tsx:43) while stats are 0 and the table says "Nothing on your desk" (InboxPanel.tsx:89-91). An officer with files due would believe the desk is clear.
- **Verified evidence:** page.tsx:43 only renders DataSourceBadge on error; rows are empty and stats render 0 via toLocaleString (:51-54); InboxPanel.tsx:89-91 emptyTitle 'Nothing on your desk'. guesthouse/page.tsx:38-51 already implements the correct pattern (errored ? '—' and RefreshErrorState).
- **Files to change:** `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/inbox/InboxPanel.tsx`
- **Fix steps:**
  1. In page.tsx set errored = source==='error'; show '—' in the four StatCards.
  2. Render <RefreshErrorState error={toHumanError('load',{area:'your desk'})}/> in place of InboxPanel when errored (copy guesthouse/page.tsx).
  3. Keep empty state only for source==='api' with zero rows.
- **Acceptance:**
  - Test: mocked 500 shows error state and '—' stats, not 'Nothing on your desk'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; removes false all-clear.
- **Depends on:** RefreshErrorState

### GAP-ESTAB-INBOX-03  ·  MEDIUM  ·  partly  ·  theme DATEFMT (was CAP)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: lib/estab/sla.test.ts: due today (IST) = 0 days, yesterday = overdue 1 day, via fake system time across the IST/UTC day boundary)
- **First-pass claim:** SLA and overdue are recomputed client-side from dueDate in the browser timezone (InboxPanel.tsx:23-40, page.tsx:9-16) while the dashboard shows an API "SLA Breached" count — the two can disagree; the same date maths is duplicated in two files.
- **Verified evidence:** Date maths is duplicated: daysLeft in page.tsx:8-15 (runs on the server, server timezone) and computeSla in InboxPanel.tsx:23-34 (runs in the browser). Both use local setHours(0,0,0,0) and dueDate slice(0,10) from the mapper, so the same file can differ between server-rendered stats and client pill near midnight or across zones. The dashboard does show an API count (estab/dashboard/page.tsx:49 'SLA Breached' = data.slaBreached), so disagreement is possible. Claim of 'capped fetch' does not apply.
- **Files to change:** `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/inbox/InboxPanel.tsx`, `apps/web/src/lib/estab/sla.ts (new)`
- **Fix steps:**
  1. Create lib/estab/sla.ts exporting daysLeft/computeSla computed in Asia/Kolkata calendar days.
  2. Import it in both files; delete duplicates.
  3. Label the stat as 'Overdue (by due date)' or source from API slaBreached if the backend defines SLA differently.
- **Acceptance:**
  - Unit test: due today (IST) = 0d left; yesterday = overdue 1d, independent of TZ env.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-INBOX-04  ·  MEDIUM  ·  confirmed  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Header action and page links use plain <a href> (inbox/page.tsx:48), forcing full page reloads instead of client navigation.
- **Verified evidence:** inbox/page.tsx:48 uses <a className='btn ghost' href='/estab/list'> (also list/page.tsx:63-74 sub-nav and :46). Plain anchors cause full reload in Next App Router; guesthouse/page.tsx:35 already uses next/link.
- **Files to change:** `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/list/page.tsx`
- **Fix steps:**
  1. Import Link from next/link and replace the anchors in inbox/page.tsx and the list sub-nav.
- **Acceptance:**
  - Manual: navigation does not trigger a full document load (network tab).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-INBOX-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: inbox/page.test.tsx: in-transit 'pending' files counted under Awaiting receipt)
- **First-pass claim:** "Total files" stat counts all files including archived (page.tsx:54), which is not a desk concept; pending files (status "pending", e.g. in transit) are excluded from the default Active segment.
- **Verified evidence:** page.tsx:54 'Total files' = files.length (all statuses incl. archived/disposed); the default 'Active' segment (InboxPanel.tsx:44,53) shows only statusRaw==='active', so 'pending' (mapped from in-transit, apiMappers.ts ~:730; FilesTable 'In transit' = pending) is hidden until 'All'.
- **Files to change:** `apps/web/src/app/(app)/estab/inbox/page.tsx`, `apps/web/src/app/(app)/estab/inbox/InboxPanel.tsx`
- **Fix steps:**
  1. Replace 'Total files' with 'Awaiting receipt' (pending) or 'On my desk' after INBOX-01.
  2. Add a 'Pending' segment or include pending in the default view with a marker.
- **Acceptance:**
  - Test: pending file appears in default view.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-INBOX-01


---
## /estab/library  —  `estab/library.html`

- **Source:** `apps/web/src/app/(app)/estab/library/page.tsx`
- **Design reference:** `redesign/estab/library.html`

### GAP-ESTAB-LIBRARY-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the Catalogue card renders only a second DataSourceBadge (page.tsx:54-55) — no RefreshErrorState or retry, unlike library/[id] and library/issues; the add-book form remains active beside it.
- **Verified evidence:** library/page.tsx:54-55 shows only a DataSourceBadge when errored and books empty; RefreshErrorState is not imported (:3). AddBookForm renders unconditionally at :51. Stats already show '—' (:45-48).
- **Files to change:** `apps/web/src/app/(app)/estab/library/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState and toHumanError; render it in the Catalogue card when errored (backHref='/estab').
  2. Hide or disable <AddBookForm/> while errored to avoid duplicate-accession adds against an unloaded catalogue.
- **Acceptance:**
  - Mock error: Catalogue card shows retry state; add form disabled.
  - Mock empty success: EmptyState remains.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-LIBRARY-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Page reads ?q= and ?status= (page.tsx:9-19) but no control sets them; stats change when the URL is filtered while the header claims the whole catalogue ("Titles", "Total Copies").
- **Verified evidence:** page.tsx:13-18 reads q and status and passes them to getLibraryBooks; the only in-repo link to /estab/library is estab/page.tsx:20 with no params and no control on the page writes them (BooksTable filters client-side, BooksTable.tsx:14-18). Under a filtered URL the stats (:21-24) describe only the filtered subset while labels say Titles/Total Copies.
- **Files to change:** `apps/web/src/app/(app)/estab/library/page.tsx`, `apps/web/src/app/(app)/estab/library/BooksTable.tsx`
- **Fix steps:**
  1. Decide: remove the q/status search params and always load the full catalogue, or wire a search/status form (GET) to set them.
  2. If kept, fetch unfiltered books for stats and filtered for the table, or label stats 'in this view'.
  3. Delete dead parsing if removed.
- **Acceptance:**
  - Visiting /estab/library?status=unavailable shows full-catalogue stats (or a visible filter chip).
  - No unused searchParams remain.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-LIBRARY-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Add-book success text exposes the record id: "Book submitted (id …)" (AddBookForm.tsx:81-84).
- **Verified evidence:** AddBookForm.tsx:82-86 prints `Book submitted (id ${res.id})`.
- **Files to change:** `apps/web/src/app/(app)/estab/library/AddBookForm.tsx`
- **Fix steps:**
  1. Replace with 'Added <title> to the catalogue.' capturing trimmed title before the reset at :87-93.
- **Acceptance:**
  - Message has title and no id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-LIBRARY-ISSUES-06

### GAP-ESTAB-LIBRARY-04  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Status pills use the raw "available"/"unavailable" (BooksTable.tsx:44) while the stat calls the same thing "Out of Stock" and the segment "Out of stock".
- **Verified evidence:** BooksTable.tsx:38 uses cellType 'status' which renders StatusPill with humanizeStatus (DataTable.tsx:127), so the pill reads 'Available'/'Unavailable', not raw lowercase. The naming mismatch is real: segment 'Out of stock' (:9), stat 'Titles Out of Stock' (page.tsx:48) vs pill 'Unavailable', which StatusPill maps to neutral 'info' (StatusPill.tsx STATUS_MAP has no 'unavailable').
- **Files to change:** `apps/web/src/app/(app)/estab/library/BooksTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Pick one term ('Out of stock') and map row status via a display column: status label 'Out of stock' for unavailable.
  2. Add 'unavailable' (bad or mut) to STATUS_MAP or pass label explicitly via a render column.
- **Acceptance:**
  - Row with status unavailable shows 'Out of stock' pill matching segment and stat.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-LIBRARY-05  ·  LOW  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Add a Book is visible to every viewer; no role gate and no duplicate-accession warning before submit (AddBookForm.tsx:35-58).
- **Verified evidence:** AddBookForm is rendered for everyone (library/page.tsx:51); validation at AddBookForm.tsx:47-66 checks only required fields and copies>0; no accession duplicate check against loaded books and no role check. Server enforcement of role and unique accession is not visible (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/library/page.tsx`, `apps/web/src/app/(app)/estab/library/AddBookForm.tsx`
- **Fix steps:**
  1. Wrap AddBookForm in the shared role guard used elsewhere (find existing useCan/permission helper in apps/web/src/lib/auth) and hide for non-librarians.
  2. Pass loaded books to the form and warn on an accession match before submit (client hint only).
  3. Backend: confirm unique constraint and 403/409 responses, and surface 409 as a friendly message.
- **Acceptance:**
  - Non-librarian role does not see Add a Book.
  - Entering an existing accession shows a warning and blocks submit.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Client gate is not security; ensure server enforces.


---
## /estab/library/[id]  —  `estab/library-detail.html`

- **Source:** `apps/web/src/app/(app)/estab/library/[id]/page.tsx`
- **Design reference:** `redesign/estab/library-detail.html`

### GAP-ESTAB-LIBRARY-DETAIL-01  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only: no edit, add-copy or withdraw action on a book (whole [id]/page.tsx), so a typo in title/accession or a lost copy cannot be corrected from the UI even though the same module can create books.
- **Verified evidence:** library/[id]/page.tsx (82 lines) has only display plus an 'Issue this book' link (:71-79). Library has AddBookForm.tsx for creation but no edit/add-copy/withdraw route. Whether PATCH/DELETE endpoints exist on /api/v1/estab/library/books/:id cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/library/[id]/page.tsx`, `apps/web/src/app/(app)/estab/library/[id]/EditBookForm.tsx (new)`
- **Fix steps:**
  1. Confirm backend endpoints (update book, adjust copies, withdraw) with the estab service.
  2. Add EditBookForm (reuse field set of AddBookForm.tsx) with zod validation; copiesTotal must be >= copies out.
  3. Withdraw via ConfirmDialog with reason; block when copies are out.
  4. Show actions only to librarian role.
- **Acceptance:**
  - Test: edit title persists and page refreshes.
  - Test: cannot reduce copiesTotal below copies issued.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing copy counts affects loan integrity; audit event required.

### GAP-ESTAB-LIBRARY-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Copies Out is shown but not who holds them: no borrower/due list on the book (page.tsx:44-48), forcing users to scan the whole Loans table.
- **Verified evidence:** page.tsx:47 shows Copies Out as copiesTotal-copiesAvailable only. getLibraryIssues(status) exists (loaders.ts ~:3742) with status filter, but no bookId filter is visible in its signature, and the detail page does not call it.
- **Files to change:** `apps/web/src/app/(app)/estab/library/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add an 'Currently issued' Card on the detail page listing borrower, issue date and due date for this book.
  2. Use getLibraryIssues('issued') filtered by bookId (add a bookId query param if the API supports it; else filter client-side with a noted cap).
  3. Link each row to the issues page.
- **Acceptance:**
  - Test: book with 2 copies out lists 2 borrowers.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Borrower names are PII; show only to authorised roles.

### GAP-ESTAB-LIBRARY-DETAIL-03  ·  LOW  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Book not found" is a bare paragraph (no EmptyState, no action) while the not-found case is unreachable when the loader collapses 404 into error (page.tsx:23-30).
- **Verified evidence:** Not-found branch is a bare <p className='sub'> (page.tsx:22-27) with only a header back link. The loader does expose the HTTP status (apiClient.ts:144 returns status), but the page ignores it, so real 404s land in the source==='error' branch (:14-20) and the 'Book not found' branch is reached only if source!=='error' with null data, i.e. effectively never. The retry state is correct for transient errors.
- **Files to change:** `apps/web/src/app/(app)/estab/library/[id]/page.tsx`
- **Fix steps:**
  1. Read `status` from getLibraryBookById; if status===404 render EmptyState (title 'Book not found', action back to catalogue).
  2. Keep RefreshErrorState for other errors; delete the unreachable branch.
- **Acceptance:**
  - Test: 404 renders EmptyState; 500 renders retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ESTAB-LIBRARY-DETAIL-04  ·  LOW  ·  partly  ·  theme DS (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Book details use inline-styled <dl> with hard-coded 12px/var(--ink2) instead of the DS Card/DL primitives (page.tsx:50-70); a DataSourceBadge next to a loaded book contradicts the "showing nothing" copy (page.tsx:38).
- **Verified evidence:** Inline-styled <dl> with fontSize 12 and var(--ink2) at page.tsx:51-67 confirmed (inside the DS Card, so only the dl is hand-rolled). The DataSourceBadge at :38 renders only if source==='error' while book is non-null; the loader returns null data on error, so it is effectively unreachable. There is no 'showing nothing' copy on this page. Theme 'FABRICATED' does not fit.
- **Files to change:** `apps/web/src/app/(app)/estab/library/[id]/page.tsx`
- **Fix steps:**
  1. Extract a DetailList/DL primitive (or use existing .fld/.l/.v classes as in estab/files/[id]/page.tsx:118) and replace the inline dl.
  2. Remove the dead DataSourceBadge at :38.
- **Acceptance:**
  - Visual check: details match other estab detail pages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /estab/library/issues  —  `estab/library-issues.html`

- **Source:** `apps/web/src/app/(app)/estab/library/issues/page.tsx`
- **Design reference:** `redesign/estab/library-issues.html`

### GAP-ESTAB-LIBRARY-ISSUES-01  ·  HIGH  ·  confirmed  ·  theme IDENTITY-DISPLAY (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Borrower is a typed employee UUID ("Employee ID (UUID)", IssueBookForm.tsx:161-175) and appears as a raw UUID in Loans and in both confirmations (IssuesTable.tsx:60-66,98-104; IssueBookForm.tsx:228-231). Librarians cannot tell whom they are lending to and a mistyped-but-valid UUID passes.
- **Verified evidence:** IssueBookForm.tsx:161-175 is a free-text 'Employee ID (UUID)' input validated only by UUID_RE (:11,:63); value posted as employeeRef (:99). Confirm dialog shows raw {employeeRef} (:232). IssuesTable.tsx:60 column key borrowerRef, and both the Return aria-label (:77) and dialog (:108) print raw borrowerRef. ConfirmDialog already exists in both, so the stated fix (add ConfirmDialog) is moot; the real gap is identity display/lookup. Whether the API returns a borrower name is not visible (types package and estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/IssueBookForm.tsx`, `apps/web/src/app/(app)/estab/library/issues/IssuesTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Replace the UUID text input in IssueBookForm with an employee combobox/search (reuse any existing HRMS employee picker; if none, add a small EmployeePicker in apps/web/src/app/_components/ds) that submits the selected id as employeeRef.
  2. Show name plus employee code in the confirm dialog description (IssueBookForm :229-233) instead of raw {employeeRef}.
  3. Ask backend to add borrowerName (and code) to the library issues list response; extend LibraryIssueSummary and its zod schema LibraryIssueSummaryListSchema.
  4. In IssuesTable change the 'Borrower' column to render borrowerName ?? '—' with the id only in a title tooltip; update the Return aria-label and dialog (:77,:108).
  5. Keep UUID_RE as a fallback validation on the selected id.
- **Acceptance:**
  - Component test: picking an employee submits that employee's id and the dialog shows their name, not a UUID.
  - Loans table renders borrower name; a row with no name shows '—' not a UUID.
  - Manual: typing a random valid UUID not in the employee list cannot be submitted.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low money risk; PII: employee names now shown to library users, confirm role visibility. Lending to wrong person if picker mis-maps id.
- **Depends on:** GAP-ESTAB-LIBRARY-ISSUES-06

### GAP-ESTAB-LIBRARY-ISSUES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "On Loan" counts only status "issued"; overdue books are also on loan but are counted under "Overdue" (page.tsx:20-22). The header stat understates books out.
- **Verified evidence:** page.tsx:21 activeCount counts only status==='issued'; :22 overdueCount separately, so 'On Loan' (:39) excludes overdue books that are physically out. IssuesTable.tsx:22 the 'On Loan' segment likewise excludes overdue.
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/page.tsx`, `apps/web/src/app/(app)/estab/library/issues/IssuesTable.tsx`
- **Fix steps:**
  1. In page.tsx set activeCount = issued + overdue (or rename card to 'Issued (not yet due)').
  2. Do the same in IssuesTable SEGMENTS filter (:22) so 'On Loan' includes overdue; keep 'Overdue' as subset.
  3. Optionally add a hint on the StatCard: 'incl. N overdue'.
- **Acceptance:**
  - Unit: issues [1 issued, 1 overdue, 1 returned] gives On Loan=2, Overdue=1, Returned=1.
  - Segment 'On Loan' lists both issued and overdue rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Reporting only; low.

### GAP-ESTAB-LIBRARY-ISSUES-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Due Date has no minimum and accepts past dates (IssueBookForm.tsx:189, validation :47-66); it is sent as midnight UTC (IssueBookForm.tsx:95-100), which can read a day early in IST.
- **Verified evidence:** No min on the date input (IssueBookForm.tsx:186-196) and the only rule is non-empty (:64), so past due dates are accepted and posted. But the midnight-UTC claim is overstated: :100 sends `${dueAt}T00:00:00.000Z`, which is 05:30 IST on the same calendar date, so it does not read a day early in IST (it could in zones west of UTC). Manual checks, no zod schema. defaultDueDate (:13-17) uses toISOString so before 05:30 IST it derives from the previous UTC day. Submit is already disabled while busy (:206).
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/IssueBookForm.tsx`
- **Fix steps:**
  1. Add min={today} (local date) to the date input and a check in handleSubmit that dueAt >= today and preferably <= a max loan period (ask policy owner).
  2. Move validation into a zod schema (bookId, employeeRef uuid, dueAt) shared with the submit path.
  3. Build today/default date from local date parts, not toISOString, to avoid the UTC boundary.
  4. Optionally send dueAt as a date-only string if the API accepts it (unverified; check service).
- **Acceptance:**
  - Unit: past date shows 'Due date cannot be in the past' and no POST.
  - Unit at 23:30 IST/00:10 IST: default due date is today+14 in IST.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not change API payload shape without backend check.

### GAP-ESTAB-LIBRARY-ISSUES-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed Loans fetch shows only a DataSourceBadge in the card (issues/page.tsx:55-56) — no retry, no RefreshErrorState — while the catalogue failure gets one.
- **Verified evidence:** page.tsx:55-56 renders only <DataSourceBadge source='error'/> in the Loans card when issuesSource==='error' and issues empty; the catalogue error path uses RefreshErrorState (:44-49). RefreshErrorState is already imported (:3). Stats already show '—' when errored (:39-41).
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/page.tsx`
- **Fix steps:**
  1. In the Loans card branch at :55 replace DataSourceBadge with <RefreshErrorState error={toHumanError('load',{area:'loans'})} backHref='/estab/library'/>.
  2. Split errored into booksErrored/issuesErrored so each card reports its own failure (see -05).
  3. Keep the header badge.
- **Acceptance:**
  - Mock getLibraryIssues error: Loans card shows the error state with a Retry action.
  - Mock success with empty list: still shows 'No loans yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-LIBRARY-ISSUES-05

### GAP-ESTAB-LIBRARY-ISSUES-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by 6e652983e (owner decision #29, 2026-10-26): renewal and return condition built (migration 0055); fines out of UAT scope, the screen says fine rules are not configured
- **W2 note:** W2 estab re-check: the stats-gating step is already on main (loan stats depend on the issues loader only). Renewal, fine and condition-on-return still need a product decision. Left open. (#2052)
- **W0 note:** partly fixed by #1916 — Stats gated per loader fixed; no renewal/fine/condition-on-return capture
- **First-pass claim:** Either loader failing blanks all three stats even if the other loaded (page.tsx:15-17,39-41); no renewal, fine or "condition on return" capture on Return (IssuesTable.tsx:34-46).
- **Verified evidence:** page.tsx:18-19 errored = issues OR books error; all three stats then show '—' (:39-41) even if issues loaded fine (books failure alone hides valid loan counts). Return does a bodyless PATCH (IssuesTable.tsx:41) with no fine, renewal or condition input; no renew action exists. Whether the API supports those fields cannot be verified (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/page.tsx`, `apps/web/src/app/(app)/estab/library/issues/IssuesTable.tsx`
- **Fix steps:**
  1. Derive issuesErrored = issuesSource==='error' and gate the three loan stats on that alone; booksErrored only affects the form card.
  2. Decide with product whether renewal, overdue fine and return condition are in scope; if yes add optional fields to the return ConfirmDialog (condition select, notes) and a Renew action.
  3. If in scope, confirm endpoints with backend before wiring; otherwise record as backlog.
- **Acceptance:**
  - Books fetch fails, issues ok: stats show real counts, form card shows error.
  - Return dialog (if extended) posts condition and shows it in loan row.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Fines touch money (paise rules) if added; keep out of scope until decided.
- **Depends on:** GAP-ESTAB-LIBRARY-ISSUES-04

### GAP-ESTAB-LIBRARY-ISSUES-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Success text exposes record ids: "Issue submitted (id …)" (IssueBookForm.tsx:86-90).
- **Verified evidence:** IssueBookForm.tsx:105-109 success message prints `Issue submitted (id ${res.id})`; same pattern in AddBookForm.tsx:82-86.
- **Files to change:** `apps/web/src/app/(app)/estab/library/issues/IssueBookForm.tsx`
- **Fix steps:**
  1. Change message to 'Issued <book title> to <borrower>. It will appear in the loan list shortly.' using selected.title captured before reset (:110).
  2. Drop the id from user text; log correlationId only if a support reference is needed.
- **Acceptance:**
  - Success text contains title and no UUID.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTAB-LIBRARY-03


---
## /estab/list  —  `estab/list.html`

- **Source:** `apps/web/src/app/(app)/estab/list/page.tsx`
- **Design reference:** `redesign/estab/list.html`

### GAP-ESTAB-LIST-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W2 estab: closed by #2052)
- **W2 note:** Server-side clearance filter on the register and search, plus the existing [Classified] masking; reveal-with-audit and CSV-export gating are not built (remainder).
- **W0 note:** partly fixed by #1916 — secret/top_secret subjects masked; confidential still shown; no Masked/clearance gate
- **First-pass claim:** Confidential/secret/top-secret files appear in the same client-side register for every viewer with their subject line (list/page.tsx:29-37, FilesTable.tsx:34-70); the UI applies no classification gate or redaction (DPDP / official-secrets exposure) and depends on unverifiable server filtering.
- **Verified evidence:** list/page.tsx:27-36 maps every file including subject and classification (lowercased/underscore-stripped) into FilesTable.tsx:47-52 columns with no classification-based masking; apiMappers.ts:718-733 keeps confidential/secret/top_secret. Also createdBy shown. No shared <Masked> component exists in the repo (grep only hits unrelated integrations files). Server-side filtering by clearance cannot be verified (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/list/page.tsx`, `apps/web/src/app/(app)/estab/list/FilesTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Masked.tsx (value, reason-gated reveal, emits audit event through existing audit client).
  2. In list/page.tsx replace subject with a masked placeholder for classification in [confidential, secret, top_secret] unless the user's clearance claim allows it.
  3. Render a classification badge (StatusPill) not free text; never render subject for secret/top_secret in the list.
  4. Backend: confirm list API filters by user clearance and audits reveals; add if missing.
  5. Gate any CSV export of this table (DataTable) for classified rows.
- **Acceptance:**
  - Unit: confidential row subject renders masked for a user without clearance.
  - Reveal action calls audit endpoint and is logged.
  - secret/top_secret rows absent for uncleared user.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: DPDP/official secrets. Must not rely on client masking alone.

### GAP-ESTAB-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "Closed (MTD)" counts all archived and disposed files ever returned (list/page.tsx:11,99) — the label promises month-to-date.
- **Verified evidence:** list/page.tsx:11 counts every archived or disposed file returned; :99 labels it 'Closed (MTD)'. EstabFileSummary mapper (apiMappers.ts:733-745) has no closed date, only createdDate/dueDate, so MTD cannot be computed client-side.
- **Files to change:** `apps/web/src/app/(app)/estab/list/page.tsx`
- **Fix steps:**
  1. Short term: rename label to 'Closed' (drop MTD).
  2. If MTD is wanted, ask backend for closedAt on the file list or a stats endpoint, then filter to current IST month.
- **Acceptance:**
  - Label reads 'Closed' and count matches Closed segment count in FilesTable.
  - With closedAt, only files closed this month counted.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Banner promises "SLA on pendency" (page.tsx:87) while a code comment states there is no due-date/SLA field on this page (page.tsx:89-93) and the dashboard shows an API SLA figure.
- **Verified evidence:** Banner list/page.tsx:87 promises 'SLA on pendency'; comment :89-91 says no due-date/SLA field exists. In fact the mapper does carry dueDate (apiMappers.ts:743, from dueBy) but the page and table never use it. Avg Pendency (:13-25) is days since creation, not SLA. Dashboard SLA figure not verified.
- **Files to change:** `apps/web/src/app/(app)/estab/list/page.tsx`, `apps/web/src/app/(app)/estab/list/FilesTable.tsx`
- **Fix steps:**
  1. Remove 'and SLA on pendency' from the banner, or add a Due column plus overdue highlight using dueDate.
  2. Fix the stale comment at :89-93.
- **Acceptance:**
  - Banner copy matches what page shows.
  - If Due column added, files past due render a bad-tone pill.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-LIST-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Two primary buttons ("Guided File" and "+ Create File") sit side by side with the same weight (page.tsx:44-49), and eight related registers are hidden in a ten-link text sub-nav made of plain anchors (page.tsx:63-74).
- **Verified evidence:** Two `btn primary` anchors side by side at list/page.tsx:46-47 confirmed. The sub-nav is 10 plain <a> (not eight) at :64-73 inside a deliberate <nav class=subnav> (comment :51-62), so hidden-register claim is overstated; plain anchors cause full page loads instead of next/link.
- **Files to change:** `apps/web/src/app/(app)/estab/list/page.tsx`
- **Fix steps:**
  1. Make 'Guided File' `btn ghost`/secondary, keep '+ Create File' primary.
  2. Swap <a> for next/link in the actions and subnav.
- **Acceptance:**
  - Only one primary button in the header.
  - Navigating subnav does not trigger a full reload.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-LIST-05  ·  LOW  ·  partly  ·  theme FORMAT (was LOADING)

- [x] **Status** (W1 SF-17b: closed by #2033)
- **W0 note:** partly fixed by #1916 — Classification label map/pill done; createdBy still printed raw
- **First-pass claim:** "Created By" prints the raw createdBy value and Classification the raw lowercase code (page.tsx:31-33); classification is not null-guarded (.replace on a possibly undefined value would throw into error.tsx).
- **Verified evidence:** Refuted part: classification cannot be undefined; mapEstabFileSummaries (apiMappers.ts:718-728) always defaults to a valid enum, so .replace (list/page.tsx:31) will not throw. True part: createdBy is printed raw (:33; mapper falls back to '—', apiMappers.ts:738) and is likely an id, and classification is lowercase text ('top secret').
- **Files to change:** `apps/web/src/app/(app)/estab/list/page.tsx`, `apps/web/src/app/(app)/estab/list/FilesTable.tsx`
- **Fix steps:**
  1. Render classification via a label map (Top Secret, Confidential, ...) or StatusPill.
  2. Resolve createdBy to a name when the API supplies one; otherwise show '—' rather than an id (needs backend field createdByName).
- **Acceptance:**
  - Row shows 'Top secret' capitalised.
  - createdBy displays name or '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-LIST-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 estab #2052 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** "In transit" segment is just status "pending" (FilesTable.tsx:21-38) — two names for one status across stats ("Pending") and segments.
- **Verified evidence:** FilesTable.tsx:21 segment 'In transit' filters statusRaw==='pending' (:30-31); page stat is 'Pending' (list/page.tsx:98) and pill shows 'pending'. Pending does not necessarily mean in transit; the mapper only knows active/pending/archived/disposed.
- **Files to change:** `apps/web/src/app/(app)/estab/list/FilesTable.tsx`
- **Fix steps:**
  1. Rename segment to 'Pending' to match stat and pill (or add a real in-transit signal from currentHolder).
  2. Keep SEGMENTS and filter case in sync.
- **Acceptance:**
  - Segment count equals Pending stat.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/meetings  —  `estab/meetings.html`

- **Source:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Design reference:** `redesign/estab/meetings.html`

### GAP-ESTAB-MEETINGS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: meetings/page.test.tsx: all four stats show an em dash on error)
- **First-pass claim:** On a failed fetch the badge and RefreshErrorState appear but Upcoming Meetings, MOM Pending and Action Items print real 0 (meetings/page.tsx:71-73); only Compliance is gated. Same pattern that compliance/library pages avoid.
- **Verified evidence:** meetings/page.tsx:71-73 Upcoming, MOM Pending, Action Items print computed counts from [] (=0) even when source==='error'; error UI is shown at :40-42 and :77-89. Compliance (:74) shows '—' only incidentally because completed is 0. Compare list/page.tsx which gates with errored.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Fix steps:**
  1. Add const errored = source==='error' and render '—' for all four stat values.
  2. Do not rely on the completed>0 check for Compliance.
- **Acceptance:**
  - Mock error: all four StatCards show '—'.
  - Success: numbers as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-MEETINGS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: meetings/page.test.tsx: empty state does not instruct an unavailable action; + Schedule links to /meeting/meetings/new)
- **First-pass claim:** The only way to schedule from this module is a disabled "+ Schedule (coming soon)" button whose tooltip points to "a committee" (page.tsx:57-67), yet the empty state tells users to "Schedule a meeting". A different module (meeting/meetings/new/page.tsx) has a working form — two meeting systems with no cross-link.
- **Verified evidence:** meetings/page.tsx:57-67 disabled '+ Schedule (coming soon)'; empty state :95 says 'Schedule a meeting to get started.'. A working form exists at apps/web/src/app/(app)/meeting/meetings/new; no link from estab. Tooltip refers to 'a committee'.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Fix steps:**
  1. Decide whether estab and meeting modules are one system; if so link '+ Schedule' to /meeting/meetings/new.
  2. Otherwise change the empty-state copy to explain where meetings are created.
- **Acceptance:**
  - Empty state does not instruct an unavailable action.
  - Schedule button either works or is absent.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Two data models; linking may create meetings the estab list cannot show.
- **Depends on:** GAP-ESTAB-MEETINGS-DETAIL-04

### GAP-ESTAB-MEETINGS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: meetings/page.test.tsx: 'In Progress' and 'Meetings Held' labels)
- **First-pass claim:** "MOM Pending" is the count of meetings with status "in_progress" (page.tsx:19), not meetings lacking minutes; "Compliance" is completed ÷ all meetings (page.tsx:74) and conflicts with the Compliance page's complied ÷ action items rate.
- **Verified evidence:** meetings/page.tsx:19 momPending = status==='in_progress' count, not lacking minutes; :74 Compliance = completed/meetings.length. estab/compliance/page.tsx:12 uses complied items/all items. The two 'compliance' figures differ.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Fix steps:**
  1. Rename to 'In progress' or compute from meetings completed with no minutes (needs minutes flag in list payload).
  2. Rename Compliance to 'Meetings held' or link to the Compliance rate.
- **Acceptance:**
  - Labels match their formulas.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-MEETINGS-04  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: meetings/page.test.tsx: at 01:00 IST (fake timers, 19:30Z) a meeting dated today counts as upcoming)
- **First-pass claim:** Statuses render raw with underscores replaced; dates are dd/mm/yyyy; Upcoming compares scheduledDate ≥ today as strings (page.tsx:13,17).
- **Verified evidence:** Statuses render via StatusPill (MeetingsTable.tsx:41) after underscore replacement (page.tsx:34), so they are humanized, not raw. Dates are dd/mm/yyyy (formatIndianDate). Upcoming (:17,:35) compares date strings to a UTC today (:16), so between 00:00 and 05:30 IST it uses yesterday.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Fix steps:**
  1. Compute today in Asia/Kolkata (Intl date parts) and share with MeetingsTable.
  2. Switch to shared date format (see DETAIL-03).
- **Acceptance:**
  - At 01:00 IST a meeting dated today counts as upcoming.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-MEETINGS-DETAIL-03

### GAP-ESTAB-MEETINGS-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** The view switch is two links in a labelled nav; the active one carries aria-current="page" (meetings/page.tsx; test in page.test.tsx).
- **W0 note:** partly fixed by #1916 — Still a link toggle with aria-current undefined; not DS Tabs/Segmented
- **First-pass claim:** Calendar toggle is a link that changes ?view= (page.tsx:15,48-55) and a11y of the grid depends on MeetingsCalendar's custom markup, not the DS Tabs/Segmented.
- **Verified evidence:** Calendar/List toggle is a Link with ?view=calendar (meetings/page.tsx:48-56) confirmed; it is a navigation, not a Segmented control. Calendar grid a11y not audited (MeetingsCalendar uses Link at :147 and Buttons for month nav); nothing concretely broken found.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/page.tsx`
- **Fix steps:**
  1. Use ds Segmented with router.push, or keep links and add aria-current on the active one.
  2. Audit MeetingsCalendar grid semantics (role=grid or table) if desired.
- **Acceptance:**
  - Active view has aria-current or selected state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/meetings/[id]  —  `estab/meetings-detail.html`

- **Source:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`
- **Design reference:** `redesign/estab/meetings-detail.html`

### GAP-ESTAB-MEETINGS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: MeetingTimeline.test.tsx and [id]/page.test.tsx: Actions closed is todo for [] and for a scheduled meeting, done only for a completed meeting with every action completed)
- **First-pass claim:** The "Actions closed" step uses meeting.actionPoints.every(status === "completed"), which is true for an empty list, so a meeting with no action points shows "Actions closed" as done even while it is only scheduled (page.tsx:143).
- **Verified evidence:** [id]/page.tsx:143 `meeting.actionPoints.every(a => a.status==='completed')` is true for []; a scheduled meeting shows 'Actions closed' as done. Other steps depend on status (:139-142).
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`
- **Fix steps:**
  1. Change :143 to done only when meeting.status==='completed' && actionPoints.length>0 && every completed; otherwise 'todo' (or 'done' with 'none raised' text only after completion).
  2. Also treat cancelled status (currently marks Agenda circulated done) explicitly.
- **Acceptance:**
  - Scheduled meeting with [] action points shows Actions closed as todo.
  - Completed meeting with all actions completed shows done.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Misleading status on governance record.
- **Depends on:** GAP-ESTAB-MEETINGS-DETAIL-02

### GAP-ESTAB-MEETINGS-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** The timeline is a MeetingTimeline component: no empty date slot renders (only Scheduled has a date), a cancelled meeting does not show the agenda as circulated, and a note says stages are inferred from status because the service records no event dates or officers (relabel path of step 2). Tests in MeetingTimeline.test.tsx and page.test.tsx.
- **W0 note:** partly fixed by #1916 — Cancelled handled; date slots still empty, no actor/time
- **First-pass claim:** Workflow timeline is inferred from status only (page.tsx:136-144): "Agenda circulated" is marked done for any non-scheduled state, every <div className="d"> date slot is empty, and no actor or time is recorded.
- **Verified evidence:** [id]/page.tsx:139-143: timeline derived from status alone; 'Agenda circulated' is 'done' whenever status!=='scheduled' (:140) and every `<div className='d'>` is empty. No actor or timestamp fields are used; availability of them in MeetingDetail is not visible (types package absent).
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`
- **Fix steps:**
  1. Populate the first step's d with formatted scheduledDate; hide empty d nodes.
  2. If backend has event timestamps/actors, add them; otherwise relabel as 'Stage' without implying events happened.
  3. Extract the timeline into a small MeetingTimeline component with tests.
- **Acceptance:**
  - No empty date slots render.
  - Cancelled meeting does not show Agenda circulated done.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-MEETINGS-DETAIL-01

### GAP-ESTAB-MEETINGS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: [id]/page.test.tsx: scheduled date formatted (01 Oct 2026); MeetingDetailTables.tsx formats dueDate with formatIndianDate)
- **First-pass claim:** scheduledDate and dueDate print as raw API strings (page.tsx:119; MeetingDetailTables.tsx:25) while other estab screens format dates as dd Mon yyyy.
- **Verified evidence:** [id]/page.tsx:119 prints raw meeting.scheduledDate; MeetingDetailTables.tsx:25 prints raw r.dueDate. List page uses formatIndianDate (meetings/page.tsx:31). Note formatIndianDate (lib/formatters.ts:2-7) outputs dd/mm/yyyy, not 'dd Mon yyyy'.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`, `apps/web/src/app/(app)/estab/meetings/[id]/MeetingDetailTables.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Wrap both values in formatIndianDate.
  2. Decide app-wide format; if dd Mon yyyy is wanted change formatIndianDate to {day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'} and update snapshots.
- **Acceptance:**
  - Detail page shows formatted date; invalid date falls back to raw/—.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Changing the shared formatter affects every screen.

### GAP-ESTAB-MEETINGS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** Closed by 0a1e91e7c (owner decision #30, 2026-10-26): MOM via meeting-service's minutes workflow (draft -> approve), linked from the estab meeting (migration 0056, governance-link route, Minutes (MOM) panel)
- **W2 estab note:** INTERIM, NEEDS OWNER DECISION. 'Not yet held' / 'Pending' / 'Captured' and the minutes text already render; the misleading tooltip/comment is fixed (Generate MOM stays disabled and says minutes cannot be generated or edited on this screen). Capturing or generating MOM needs a product decision and a backend endpoint that do not exist.
- **W0 note:** partly fixed by #1916 — MOM state improved (Not yet held); Generate MOM still disabled
- **First-pass claim:** MOM reads "Draft" for any meeting without minutes, including future ones (page.tsx:124), and the only route to capture MOM is the disabled Generate MOM button whose comment points to a field that this page does not render.
- **Verified evidence:** [id]/page.tsx:124 shows 'Captured' if meeting.minutes else 'Draft', for any status including future. MeetingActions.tsx:27-36 Generate MOM is disabled, and its comment (:20-25) says MOM is capturable via a MOM field that the page does not render (only Captured/Draft text).
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`, `apps/web/src/app/(app)/estab/meetings/[id]/MeetingActions.tsx`
- **Fix steps:**
  1. Show 'Not yet held' for scheduled and 'Pending' for in_progress/completed without minutes; 'Draft' only if a draft exists.
  2. Render minutes text when present.
  3. Either build MOM capture or fix the misleading comment and tooltip.
- **Acceptance:**
  - Scheduled meeting MOM shows 'Not yet held'.
  - Completed meeting with minutes shows text.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-MEETINGS-02

### GAP-ESTAB-MEETINGS-DETAIL-05  ·  LOW  ·  partly  ·  theme DS-CONSISTENCY (was VALIDATION)

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** The page uses the shared PageHeader (back link, h1 with title and status pill, actions); the header Agenda link is gone so the Agenda tab is the single route (page.test.tsx).
- **W0 note:** partly fixed by #1916 — Duplicate Agenda link removed; legacy ph/tl/tabs classes remain
- **First-pass claim:** The header "Agenda" link duplicates the Agenda tab (MeetingActions.tsx:13-22); tabs and page chrome use legacy classes (ph, tl, fields, tabs .on) rather than the DS Tabs/PageHeader.
- **Verified evidence:** MeetingActions.tsx:13-22 header 'Agenda' link points to ?tab=agenda, duplicating the Agenda tab (page.tsx:64-71). Legacy classes ph/tabs/tl/fields are used (page.tsx:43,55,138). ds/Tabs.tsx is a client onChange switcher (Tabs.tsx:5-11) so it does not directly fit link-based tabs; PageHeader is only used in the error branch. Not a validation issue.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`, `apps/web/src/app/(app)/estab/meetings/[id]/MeetingActions.tsx`
- **Fix steps:**
  1. Remove the header Agenda link.
  2. Use PageHeader for the title/status; keep link tabs but style through DS or extend Tabs with an href mode.
- **Acceptance:**
  - Only one route to Agenda.
  - Header uses PageHeader.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-MEETINGS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Absent attendees render a red "rejected" StatusPill labelled No (MeetingDetailTables.tsx:49), conflating non-attendance with rejection.
- **Verified evidence:** MeetingDetailTables.tsx:49 maps present=false to StatusPill status 'rejected' (bad tone, StatusPill.tsx map) labelled 'No'.
- **Files to change:** `apps/web/src/app/(app)/estab/meetings/[id]/MeetingDetailTables.tsx`
- **Fix steps:**
  1. Use a neutral status (e.g. 'inactive'/mut) with label 'Absent', and 'Present' for present.
- **Acceptance:**
  - Absent attendee renders grey 'Absent' pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/migration  —  `estab/migration.html`

- **Source:** `apps/web/src/app/(app)/estab/migration/page.tsx`
- **Design reference:** `redesign/estab/migration.html`

### GAP-ESTAB-MIGRATION-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed load leaves rows = [] and loading = false, so the register card prints "No legacy files registered yet." beneath a raw red error line — an outage looks like an empty register, and there is no retry (MigrationPanel.tsx:33-36,119-122).
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx:28-44 load() catch sets error and leaves rows=[]; loading=false in finally. Render at :79-84 prints error as raw red <p>, and :121-122 then shows 'No legacy files registered yet.' because rows.length===0. No retry control anywhere in the panel.
- **Files to change:** `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Add a loadError boolean state set in load() catch (skip on AbortError), reset at start of load().
  2. In the register-card render, branch loading -> loadError -> empty -> DataTable; for loadError render <ErrorState error={toHumanError('load',{area:'migration register'})} onRetry={() => void load()} /> (same pattern as NotificationsPanel.tsx:60; RefreshErrorState is server-page-only, do not use it in this client panel).
  3. Stop rendering the load error in the status <p>; keep that region for register success/failure only.
- **Acceptance:**
  - Component test: mock fetch 500 -> ErrorState with Retry shown, 'No legacy files registered yet' absent.
  - Click Retry with fetch now 200 -> table renders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.
- **Depends on:** GAP-ESTAB-MIGRATION-02

### GAP-ESTAB-MIGRATION-02  ·  HIGH  ·  confirmed  ·  theme ERRORLEAK (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Server response bodies are shown verbatim to the clerk: throw new Error(await res.text()) on load and register (MigrationPanel.tsx:32,68) then setError(err.message). Other estab panels route through toHumanError.
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx:32 throws new Error(await res.text()) and :68 throws (await res.text()) || 'Register failed'; catch blocks at :40 and :73 setError(err.message), rendered at :83. OperatorsPanel uses useFormError.fromResponse and NotificationsPanel uses toHumanError, so this panel is the outlier. Suggested 'fix' text in the finding (PageHeader/tabs) is unrelated; PageHeader back already exists (page.tsx:10).
- **Files to change:** `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Import useFormError('migration') and toHumanError.
  2. In load(): on !res.ok throw a static Error('Could not load migration register.') (never res.text()); drive UI from loadError (see -01).
  3. In register(): on !res.ok call setError((await fromResponse(res,'save')).message); in catch use fromException('save').message for non-validation errors, keep client validation strings.
  4. Render fieldErrors inline if the API returns them (see -05).
- **Acceptance:**
  - Unit test: mock POST 500 with body 'SQLSTATE 23505 ...' -> DOM never contains that text.
  - Same for GET 500.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; server text may currently be the only hint of duplicate legacy numbers, so map DUPLICATE codes in useFormError CODE_TO_KIND if needed.
- **Depends on:** GAP-ESTAB-MIGRATION-01

### GAP-ESTAB-MIGRATION-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises to "attach scans, and link them to their new eFile" but the page only accepts a free-text scan reference and offers no control to set efileId; linking must happen elsewhere (page.tsx:9; MigrationPanel.tsx:98-104).
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/page.tsx:9 subtitle says 'attach scans, and link them to their new eFile'. MigrationPanel form (:88-108) has only legacyFileNo, dept, pageCount, scanRef (free text), subject; POST body (:60-66) never sends efileId; efileId is only displayed (:130). No attach-upload (FileUpload ds component not used) and no link action. Whether the estab-service exposes a link/PATCH endpoint is cannot-verify (service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/estab/migration/page.tsx`, `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Product decision: is linking to an eFile done on the eFile page? If yes, reword subtitle to 'Register legacy physical files and record their scan reference.'
  2. If linking is wanted here, confirm a PATCH /v1/estab/migration/:id (efileId/scanRef) endpoint exists, then add a per-row 'Link eFile' ActionButton with an eFile picker.
  3. Replace free-text scanRef with ds FileUpload if the upload API returns a storage key.
- **Acceptance:**
  - Subtitle matches what the page can do (manual check).
  - If linking added: link a row -> efileId column shows the linked file and status changes.
- **Needs:** decision  ·  **Effort:** XS <1h (copy) / M ~1-2d (feature)  ·  **Risk:** Copy change is safe; linking is a data-integrity action needing audit event server-side.

### GAP-ESTAB-MIGRATION-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W2 estab: closed by #2052)
- **W1 SF-17b note (#2033):** the eFile column no longer shows an 8-character id prefix (link text is "Open eFile"). Left open: the register mutates with no confirmation and validation failures still use one combined message.
- **W0 note:** partly fixed by #1916 — Per-field errors+aria done; no ConfirmDialog; eFile link still shows id prefix not efileNo
- **First-pass claim:** Register mutates with no confirmation and validation failures use one combined message; the eFile column shows an 8-character id prefix rather than a file number (MigrationPanel.tsx:55-57,131).
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx:55-57 one combined validation message for three fields (true). Register (:52-77) fires immediately from a plain Button (:111) with no ConfirmDialog (true) - but it is a create of a register row, not an approval or destructive action, so a mandatory-reason/maker-checker requirement from the suggested fix is overstated. eFile column (:130-131) shows efileId.slice(0,8) as link text, not a file number (true; row type has no fileNo field, so a number needs the API to return it). Audit event emission is server-side, cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Split validation into per-field errors (legacyFileNo, dept, subject>=3) and render under each input with aria-describedby (see -05).
  2. Optionally wrap register in ConfirmDialog (no reason) showing the entered legacy no/dept/pages; skip maker-checker.
  3. Ask backend to return efileNo in the migration row; render it as link text, fall back to prefix only if absent.
- **Acceptance:**
  - Submit empty form -> three distinct field messages.
  - Row with efileNo shows the number linking to /estab/files/<id>.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; confirm adds one click for clerks doing bulk data entry, keep optional.
- **Depends on:** GAP-ESTAB-MIGRATION-05

### GAP-ESTAB-MIGRATION-05  ·  LOW  ·  confirmed  ·  theme FORMA11Y (was FAILMASK)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Inputs are unstyled native controls inside plain labels with no error association, no required markers, and Pages accepts negative values on the client (min={0} only).
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx:89-108 bare <label><span/><input/></label> with no required marker, aria-required, aria-invalid or per-field error; error only in top status <p> (:83). Pages input (:99) has min={0} only and register sends Number(form.pageCount||'0') (:64), so '-5', '2.5' or 'abc' are not blocked client-side (NaN if non-numeric). No global input style found in globals.css. Finding's fix text (RefreshErrorState) is unrelated to this observation.
- **Files to change:** `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Define a zod schema {legacyFileNo:min1, dept:min1, subject:min3, pageCount:int>=0, scanRef optional} and run safeParse in register() to get per-field errors.
  2. Add required markers, aria-required, aria-invalid and aria-describedby error ids on each input; focus first invalid field.
  3. Set pageCount input step={1} and inputMode='numeric'; disable submit while saving (already) .
- **Acceptance:**
  - Enter Pages=-1 -> field error, no request sent.
  - Screen reader announces the required state and error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-MIGRATION-06  ·  LOW  ·  partly  ·  theme DESIGNTOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Uses browser fetch to /api/proxy rather than fetchJson/browserJson, so no DataSourceBadge/telemetry and hard-coded colour #4f46e5 on the eFile link (MigrationPanel.tsx:131).
- **Verified evidence:** apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx:31,58 use raw fetch('/api/proxy/...') instead of browserFetch/browserJson (true; browserFetch adds x-device-id/trust headers, which this panel omits). DataSourceBadge/telemetry are fetchJson server-loader features and do not apply to client panels, so that part is overstated. Hard-coded #4f46e5 at :131 confirmed, plain <a> instead of next/link. Note Notifications and Operators panels also use raw fetch.
- **Files to change:** `apps/web/src/app/(app)/estab/migration/MigrationPanel.tsx`
- **Fix steps:**
  1. Replace fetch calls with browserFetch from '@/lib/api/browserClient' so device headers are sent.
  2. Replace style color #4f46e5 with an existing CSS token (e.g. var(--accent)/link class used elsewhere) and use next/link.
  3. Do a shared sweep of estab panels for raw '/api/proxy' fetches.
- **Acceptance:**
  - grep for '#4f46e5' and raw '/api/proxy' in the migration folder returns nothing.
  - Network tab shows x-device-id on requests.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; verify step-up/device-trust headers do not change 401 behaviour.


---
## /estab/notifications  —  `estab/notifications.html`

- **Source:** `apps/web/src/app/(app)/estab/notifications/page.tsx`
- **Design reference:** `redesign/estab/notifications.html`

### GAP-ESTAB-NOTIFICATIONS-01  ·  HIGH  ·  confirmed  ·  theme STALE (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Fetch is done once on mount with no refresh, polling or count in the shell; an officer sees overdue files only when they open this page, and stale data is not marked (NotificationsPanel.tsx:47-51).
- **Verified evidence:** apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:47-51 loads once in useEffect; no interval, focus refetch, SSE or lastUpdated stamp. The only shell bell (apps/web/src/app/_components/NotificationBell.tsx:156) reads /api/notification/stream/unread, not estab notifications; the only in-app entry to this page is a link at estab/list/page.tsx:73. So no count/badge surfaces overdue files (bell content of the notification service cannot be verified).
- **Files to change:** `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`, `apps/web/src/app/(app)/estab/list/page.tsx`
- **Fix steps:**
  1. Add lastLoadedAt state and show 'Updated hh:mm IST' plus a Refresh button calling load().
  2. Refetch on window focus / visibilitychange and every ~60s while visible (clear interval on unmount).
  3. Ask backend/decision whether estab overdue items feed the shell NotificationBell; if a count endpoint exists show it on the estab list link.
- **Acceptance:**
  - Test with fake timers: interval triggers second fetch; unmount aborts.
  - Manual: leave page open, new overdue item appears within a minute.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Polling load on estab-service; keep interval >= 60s and pause when tab hidden.

### GAP-ESTAB-NOTIFICATIONS-02  ·  MEDIUM  ·  partly  ·  theme LINKSAFETY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Each row is an anchor wrapping block content with n.link taken verbatim from the API; a malformed or absolute link would navigate anywhere, and there is no accessible name beyond the concatenated text (NotificationsPanel.tsx:68).
- **Verified evidence:** apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:68 <Link href={n.link}> uses API value verbatim with no validation; next/link with an absolute or javascript:-style href would navigate off-app (real, low likelihood as data is same-tenant service output). Accessible name is the concatenated row text (severity, title, detail, time), which is adequate; severity is given as text at :77 not colour only, so the a11y half is overstated. Invalid n.link (undefined) would throw in Link.
- **Files to change:** `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`
- **Fix steps:**
  1. Add isSafeInternalPath(link) helper (startsWith('/') && !startsWith('//')) in lib and use it; fall back to non-link div when unsafe.
  2. Validate the payload with a zod schema (link string) at fetch boundary.
  3. Add aria-label combining severity, title and formatted date on the Link.
- **Acceptance:**
  - Unit test: link 'https://evil.example' renders no anchor.
  - Unit test: link '/estab/files/123' renders anchor.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-NOTIFICATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme DESIGNTOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Severity colours are hard-coded hex (bg #fef2f2 etc.) and ignore dark mode/tokens (NotificationsPanel.tsx:18-22).
- **Verified evidence:** apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:18-22 SEV_STYLE holds hex bg/border/dot (#fef2f2, #fecaca, #dc2626, ...) and :80 hard-codes #475569; all inline, so they ignore dark theme and tokens. Not a FABRICATED-data issue.
- **Files to change:** `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`
- **Fix steps:**
  1. Replace hex with tokens (var(--bad)/--warn/--info and matching *-bg tokens, or existing pill classes good/warn/bad) in SEV_STYLE.
  2. Use var(--ink2) for detail text.
  3. Check contrast in both themes.
- **Acceptance:**
  - Toggle dark mode: rows keep >=4.5:1 contrast text.
  - grep '#' in NotificationsPanel returns none.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; visual only.

### GAP-ESTAB-NOTIFICATIONS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Date shows only "dd Mon" with no year or time, so an overdue item from last year is indistinguishable (NotificationsPanel.tsx:83).
- **Verified evidence:** apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:83 toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) - no year, no time, no explicit IST timezone. lib/formatters.ts formatIndianDate (:2) yields dd/mm/yyyy without time; no shared DateTime formatter exists in lib/formatters (only apps/web/src/lib/admin/sftpIngestion.ts:280 formatDateTime, admin-specific). Also <time> lacks a dateTime attribute.
- **Files to change:** `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using timeZone 'Asia/Kolkata' (dd Mon yyyy, hh:mm).
  2. Use it at NotificationsPanel:83 and add dateTime={n.at} on <time>.
  3. Add unit test beside formatters tests.
- **Acceptance:**
  - formatIndianDateTime('2025-12-31T20:00:00Z') -> 01 Jan 2026, 01:30 (IST).
  - Item from previous year shows its year.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-NOTIFICATIONS-05  ·  LOW  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Loading state is a bare "Loading…" paragraph, not a Skeleton (NotificationsPanel.tsx:55-56); the list has no cap indicator when 80 items are returned.
- **Verified evidence:** apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx:55-56 loading is a bare 'Loading…' <p> (true; SkeletonCard/SkeletonRow exist in ds/Skeleton). Request uses ?limit=80 (:32) and the UI shows no 'showing 80 of N' note; response total is not read, so whether more exist is cannot-verify. There is no client-side filtering here, so that part of the suggested fix does not apply.
- **Files to change:** `apps/web/src/app/(app)/estab/notifications/NotificationsPanel.tsx`
- **Fix steps:**
  1. Replace loading paragraph with SkeletonCard x3 (aria-busy).
  2. If the API returns a total/hasMore, show 'Showing 80 of N' with a link to load more; otherwise show a note when items.length===80.
  3. Ask backend to return total (or cursor).
- **Acceptance:**
  - Loading shows skeleton rows.
  - With 80 items a cap notice is visible.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/operators  —  `estab/operators.html`

- **Source:** `apps/web/src/app/(app)/estab/operators/page.tsx`
- **Design reference:** `redesign/estab/operators.html`

### GAP-ESTAB-OPERATORS-01  ·  HIGH  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Officer names come from GET /hrms/employees?limit=200 fetched into every viewer's browser (OperatorsPanel.tsx:72); beyond 200 employees or without HR read permission the table shows "3f9a1c2e…" instead of a name, and the enrol picker silently degrades to a raw UUID box.
- **Verified evidence:** apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx:72 fetches /v1/hrms/employees?limit=200 in each viewer's browser (true). empLabel (:89-92) falls back to id.slice(0,8)+'…' when the employee is not in the 200 (true). The enrol picker (:160-169) shows a <select> when employees.length>0 (so with >200 employees it is silently truncated, not a UUID box) and only falls back to a UUID text input when the HRMS call fails/returns empty (:73 returns silently). HR read permission is enforced by hrms-service (not verified here). Operators list itself uses limit=500 (:52).
- **Files to change:** `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. Ask backend (estab-service) to return employeeName/designation on each operator row (as quarter-allotments already does via employeeName) and use it in the Officer column.
  2. Replace the <select>/UUID input with a searchable EntityPicker/SmartCombobox (app/_components/SmartCombobox.tsx) using server-side search on hrms employees.
  3. Remove the UUID free-text fallback; show an inline 'Directory unavailable' message when the lookup fails.
- **Acceptance:**
  - Operator whose employee is beyond the first 200 shows a name.
  - Directory 403 -> picker shows unavailable message, no UUID box.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: names now travel in the operators payload; keep behind estab role.
- **Depends on:** SmartCombobox

### GAP-ESTAB-OPERATORS-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Enrol and Deactivate are rendered for every user with no role gate although the copy says "Division admins enrol…" (page.tsx:9; OperatorsPanel.tsx:155,217-227); non-admins reach a 403 after clicking.
- **Verified evidence:** No role check in page.tsx or estab/layout.tsx (only ModuleGate moduleKey='establishment'). OperatorsPanel renders the Enrol form (:155-195) and Deactivate/Reactivate ActionButton (:217-227) for everyone; copy at page.tsx:9 says division admins enrol. Server-side enforcement and the 403 outcome are cannot-verify (estab-service absent). Server pages can read roles via getSessionRoles/requireAnyRole in apps/web/src/lib/auth/roleGuard.ts (dev-login shows role 'estab_admin').
- **Files to change:** `apps/web/src/app/(app)/estab/operators/page.tsx`, `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. In page.tsx compute canAdminister = getSessionRoles() includes estab_admin (confirm exact role list with backend route guards).
  2. Pass canAdminister prop to OperatorsPanel; hide the Enrol card and Actions column when false, and show a read-only note.
  3. Keep backend guard authoritative; do not rely on UI hiding.
- **Acceptance:**
  - User without estab_admin sees roster only, no Enrol form or Deactivate button.
  - estab_admin sees both.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Wrong role list would lock out admins; verify claim names against the service guards.
- **Depends on:** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04

### GAP-ESTAB-OPERATORS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [~] **Status** (blocked on an owner/backend decision; reason in the W2 note below)
- **W2 note:** INTERIM, needs owner decision: the deactivate dialog warns with the held-file count and a Handover link; block vs warn vs auto-reassign, listing the files, and a server-side audit are not decided. (#2052)
- **W0 note:** partly fixed by #1916 — Deactivate confirm warns about held files; no held-file count/block, server audit not visible
- **First-pass claim:** Deactivate warns that held files "should be handed over first" (OperatorsPanel.tsx:223) but neither checks nor lists the files held; a desk can be deactivated with live files.
- **Verified evidence:** apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx:222-224 Deactivate confirmDescription says 'Files they currently hold should be handed over first', toggle() (:136-146) just PATCHes {active:false}; nothing fetches or lists files held by the operator, and no such endpoint is referenced in the web code. Whether the backend blocks deactivation with live files is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. Decide policy: block, warn with list, or auto-reassign.
  2. If an endpoint for held files exists/added, fetch count when the dialog opens and show 'Holds N files' with links; disable Deactivate (or require reason) if N>0.
  3. Emit audit event server-side on deactivate.
- **Acceptance:**
  - Operator holding files: dialog lists them and blocks/warns per policy.
  - Operator with none: dialog unchanged.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Business: a deactivated desk with live files strands eFiles.

### GAP-ESTAB-OPERATORS-04  ·  MEDIUM  ·  partly  ·  theme FORMA11Y (was VALIDATION)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Validation errors ("Pick an employee or enter a valid employee ID") appear in a red paragraph at the top of the page, away from the field, with no aria-invalid or focus move (OperatorsPanel.tsx:108-109,150-153).
- **Verified evidence:** apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx:108-109 client validation throws, caught at :130 and rendered in the top role=status region (:150-153), not by the field; no aria-invalid/focus move on the inputs (:158-188) (true). However the Enrol button is disabled unless employeeId and division are non-empty (:191), so 'Division is required' is effectively unreachable and only the UUID-regex message can show. Server fieldErrors from useFormError are populated by fromResponse but never rendered.
- **Files to change:** `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. Build a zod schema for the enrol payload (uuid employeeId, division min1, section optional, deskRole enum) and use safeParse to yield per-field errors.
  2. Render errors beside fields with aria-invalid/aria-describedby and focus the first invalid field; also render useFormError().fieldErrors.
  3. Use a required marker instead of silently disabling submit.
- **Acceptance:**
  - Invalid UUID -> error under Employee, field focused, aria-invalid=true.
  - Server VALIDATION_FAILED fieldErrors appear next to fields.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-OPERATORS-01

### GAP-ESTAB-OPERATORS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Success/toggle messages persist until the next action and the roster reloads after a fixed 800 ms timeout rather than on the mutation result (OperatorsPanel.tsx:126,145).
- **Verified evidence:** apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx:126 and :145 use setTimeout(() => void load(), 800) after the mutation resolves rather than awaiting/optimistically updating; timer is not cleared on unmount. message is cleared only at enrol start (:105), so the toggle success text (:144) persists (and can sit beside an older error). The mutation itself is awaited, so 800ms is a guard for async command processing, whose behaviour is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. After successful POST/PATCH call load() directly (await it) or update local state from the response body.
  2. If commands are async, poll load() until the row changes (max ~5 tries) instead of a fixed delay.
  3. Clear message on next action and auto-dismiss after ~5s; clear timers on unmount.
- **Acceptance:**
  - Toggle -> roster shows new status without arbitrary delay.
  - Unmount before timer fires -> no setState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-OPERATORS-06  ·  LOW  ·  partly  ·  theme I18N (was CAP)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Desk-role labels are a client-side map (ROLE_LABEL, :26-33) with a raw-value fallback; "Initiate" column prints Yes/No without a pill.
- **Verified evidence:** apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx:26-33 ROLE_LABEL is a hard-coded English map with raw-value fallback at :210 (true); DESK_ROLES (:21-24) duplicates the same list, so labels/values can drift from the server enum. 'Initiate' column (:212) renders plain Yes/No (true). Neither is a capping issue; low impact.
- **Files to change:** `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx`
- **Fix steps:**
  1. Move labels into next-intl (or a shared estab constants module used by both enrol and other estab screens).
  2. Render canInitiate with StatusPill/pill class plus text.
  3. Humanize unknown deskRole via humanizeStatus() in lib/formatters instead of raw value.
- **Acceptance:**
  - Unknown role 'joint_secretary' shows 'Joint Secretary'.
  - Initiate column shows a pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/quarters  —  `estab/quarters.html`

- **Source:** `apps/web/src/app/(app)/estab/quarters/page.tsx`
- **Design reference:** `redesign/estab/quarters.html`

### GAP-ESTAB-QUARTERS-01  ·  HIGH  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: quarters/page.test.tsx: summary-driven tiles, Other tile reconciles, truncation notice when rows < total)
- **First-pass claim:** Stats and the register are computed from whatever /estab/quarters returns; the request carries no limit or pagination (page.tsx:9), so on a large estate Total/Vacant may under-count, and statuses other than vacant/allotted/occupied are not counted anywhere so the tiles need not add up to Total (page.tsx:22-25).
- **Verified evidence:** quarters/page.tsx:9 fetchJson('/api/v1/estab/quarters') with no limit/page (TRUE); stats :22-25 use quarters.length and three literal statuses (vacant/allotted/occupied), so any other status (not visible; estab-service absent) is in Total only and tiles need not sum (TRUE). The table itself (QuartersTable.tsx:35-38) filters/paginates client-side over whatever arrived. Whether the service actually caps the default list cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/page.tsx`, `apps/web/src/app/(app)/estab/quarters/QuartersTable.tsx`, `estab-service quarters list/summary route (not in snapshot)`
- **Fix steps:**
  1. Ask backend for a summary block (total, byStatus) on GET /v1/estab/quarters or a separate /quarters/summary; use it for the tiles instead of counting the page rows.
  2. Pass limit/page/status/q via searchParams to the loader and render server-side pagination in QuartersTable (or fall back to a 'Showing N of M' notice if backend paging is not available).
  3. Add an 'Other' tile or a sum check: other = total - vacant - allotted - occupied, shown when > 0.
  4. Show '—' when total exceeds rows fetched and no summary is available.
- **Acceptance:**
  - Page test: response with statuses vacant, allotted, occupied, under_repair shows tiles that sum to Total via the Other tile.
  - Page test: total=500 with 100 rows returned shows a truncation notice, not 100 as Total.
  - Manual: filter on page 2 finds a quarter not in the first page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for money; wrong occupancy counts mislead capacity planning.

### GAP-ESTAB-QUARTERS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: quarters/page.test.tsx: one RefreshErrorState and em-dash tiles on error)
- **First-pass claim:** On error the DataSourceBadge is rendered three times in one view (page.tsx:35,44,50) and offers no retry or help link, unlike RefreshErrorState on sibling pages.
- **Verified evidence:** quarters/page.tsx renders DataSourceBadge on error in three places: :35 header actions, :45 above the stat grid, :57 inside the Card when quarters is empty (review cited 35/44/50, actual 35/45/57). DataSourceBadge has no retry/help action. Stat tiles already show '—' when errored (:47-50), which is correct. loading/error.tsx route boundary exists (quarters/error.tsx) but that only catches thrown errors, not source==='error'.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/page.tsx`
- **Fix steps:**
  1. Remove the header badge (:35) and the standalone badge (:45).
  2. Replace the Card body branch at :56-57 with <RefreshErrorState error={toHumanError('load',{area:'quarters'})} backHref='/estab' />; import from '@/app/_components/ds' and '@/lib/messages' like vehicles/page.tsx.
  3. Keep tiles at '—'; when stale rows exist with error keep the table plus one badge.
- **Acceptance:**
  - Page test: source 'error' with empty data renders exactly one error block containing a Retry button and four '—' tiles.
  - Page test: DataSourceBadge count on the page is <= 1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-QUARTERS-04  ·  MEDIUM  ·  partly  ·  theme PICKLIST (was OTHER)

- [x] **Status** Closed by 16b6cfa40 (owner decision #31, 2026-10-26): Category is a closed list (API validator + DB CHECK); legacy values mapped, unmapped -> Other (legacy) (migration 0057)
- **W2 estab note:** INTERIM, NEEDS OWNER DECISION. Org Unit is now a pick-list of the real departments (QuarterCreateForm.tsx), so two quarters of one unit carry the identical value. Category stays a datalist (suggestions plus free text, so legacy DB values are not locked out): enum-or-free-text is the owner's call.
- **W0 note:** partly fixed by #1916 — Category now datalist suggestions (not select); Org Unit still free-text input
- **First-pass claim:** Condition and Org Unit are free-text/raw values with no pick-list, so the filter and statuses depend on operators typing consistently (QuarterCreateForm.tsx; QuartersTable.tsx:26).
- **Verified evidence:** QuarterCreateForm.tsx: Category (:139-146 area) and Org Unit (:187-195) and Locality are free-text inputs; category defaults to 'general' (:20). TRUE for category/org unit. WRONG for condition: the create form has no Condition input at all (only a table column, QuartersTable.tsx:26 and detail page.tsx:102), so condition is not typed by operators here. QuartersTable.tsx:26 is the condition column, not an org-unit one (Org Unit is not a column on the list). Quarter Type is already a <select> (QUARTER_TYPES).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/QuarterCreateForm.tsx`
- **Fix steps:**
  1. Confirm the allowed category values with the domain owner (needs decision: enum vs free text) and replace the Category input with a <select> of that list.
  2. Replace Org Unit input with the org-unit picker used elsewhere in the app (search for an existing org/department selector; create shared OrgUnitPicker if none) so ids/names are consistent.
  3. Drop the claim about Condition from the finding; if a condition value is needed at creation, add a select bound to backend enum.
- **Acceptance:**
  - Component test: Category renders as a select with the agreed options and submits its value.
  - Manual: two quarters in the same org unit get the identical org-unit value and appear under one filter.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Existing free-text categories in the DB may not match a new enum; migrate or allow legacy values.

### GAP-ESTAB-QUARTERS-05  ·  LOW  ·  partly  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: quarters/loading.tsx is page-shaped; QuarterCreateForm.tsx no longer carries the #c0392b fallback (test asserts it); stat tiles use tone tokens)
- **First-pass claim:** Loading is a single bare skeleton block (loading.tsx) with no page-shape outline; form inputs use inline styles and a hard-coded #c0392b fallback rather than tokens.
- **Verified evidence:** quarters/loading.tsx is a single <div className='skeleton'> (TRUE, 3 lines). Form inputs use inline styles throughout QuarterCreateForm.tsx/ApplyAllotmentForm.tsx (TRUE). Colour is written var(--bad, #c0392b): it is a token with a fallback, so 'hard-coded' is overstated. Real hard-coded hex: StatCard iconBg values in quarters/page.tsx:47-50 (#eff6ff, #ecfdf3, #fffaeb, #eef2ff).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/loading.tsx`, `apps/web/src/app/(app)/estab/quarters/page.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to render PageHeader-shaped placeholder + four stat skeletons + SkeletonTable from ds/Skeleton.tsx.
  2. Replace hex iconBg props with existing tint tokens/classes used by StatCard/StatIcon (check StatIcon variants) so dark mode works.
  3. Drop the '#c0392b' fallback only if --bad is guaranteed globally; otherwise leave.
- **Acceptance:**
  - Visual/manual: navigating to /estab/quarters shows header, four tile skeletons and table skeleton before data.
  - Dark-mode check: stat icon backgrounds follow theme.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /estab/quarters/[id]  —  `estab/quarters-detail.html`

- **Source:** `apps/web/src/app/(app)/estab/quarters/[id]/page.tsx`
- **Design reference:** `redesign/estab/quarters-detail.html`

### GAP-ESTAB-QUARTERS-DETAIL-01  ·  HIGH  ·  partly  ·  theme PERF (was CAP)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The history is built by fetching every allotment in the estate (GET /estab/quarter-allotments, no quarterId filter) and filtering client-side (page.tsx:30,56); every quarter page ships all employees' names, designations and pay levels to render one quarter, and a large table truncates silently.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/[id]/page.tsx:29-37 getAllotments() calls fetchJson('/api/v1/estab/quarter-allotments') with no quarterId/limit/page param; :56 filters client-side by a.quarterId === quarter.id. TRUE: unfiltered over-fetch and silent-truncation risk if the service caps the list (estab-service is not in the snapshot, so the default cap cannot be verified). OVERSTATED: the page is an async Server Component, so the full list stays on the server; only allotmentRows (filtered, :68-82) are serialised to the browser. Other employees' names are not shipped to the client.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/[id]/page.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/page.tsx`, `estab-service quarter-allotments list route (not in snapshot)`
- **Fix steps:**
  1. Confirm with the estab-service owner whether GET /v1/estab/quarter-allotments accepts quarterId (and limit/page); if not, add a quarterId filter plus total count to that route and its zod query schema.
  2. Change getAllotments(quarterId) in quarters/[id]/page.tsx to request /api/v1/estab/quarter-allotments?quarterId=<id>&limit=50 and pass params.id.
  3. Keep the defensive a.quarterId === quarter.id filter only as a safety net, not as the mechanism.
  4. Read total from the response and, if total > rows returned, show a 'Showing N of M' note under the DataTable (or server pagination via searchParams).
  5. Apply the same quarterId param on the allotment list page if it shares the loader.
- **Acceptance:**
  - Unit test: getAllotments is called with a URL containing quarterId=<params.id>.
  - Component/page test: with a mocked response of total=120 and 50 rows, the page shows a 'Showing 50 of 120' indicator.
  - Manual: network log of the server fetch shows a filtered request; history for a quarter with 60 applications shows all of them.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only. Risk is only that the backend filter param name differs from the assumed quarterId.

### GAP-ESTAB-QUARTERS-DETAIL-02  ·  HIGH  ·  partly  ·  theme PICKER (was CONFIRM)

- [~] **Status** (blocked on an owner/backend decision; reason in the W2 note below)
- **W2 note:** INTERIM, needs owner decision: the confirmation names the employee and the entered designation and pay level (labelled as per service record); locking them to HRMS needs an HRMS endpoint exposing designation and pay level, and the backend ignoring client values. (#2052)
- **W0 note:** partly fixed by #1916 — EntityPicker replaces UUID input; designation/payLevel still editable, dialog says 'selected employee'
- **First-pass claim:** Apply for allotment asks the clerk to type an employee UUID (ApplyAllotmentForm.tsx) with designation and pay level typed by hand, so an officer can apply on behalf of anyone with unverified pay level; the confirm dialog then shows only the id prefix.
- **Verified evidence:** ApplyAllotmentForm.tsx:98-108 Employee ID is a free text input validated only against UUID_PATTERN (:8,41); designation (:114-120) and payLevel (:125-131) are free text and sent as-is (:69-70); the confirm description shows only employeeRef.slice(0,8)+ellipsis (:174). TRUE. STALE part of the suggested fix: a <ConfirmDialog> already exists (:165-180), the description states a designated allotting officer (not the applicant) must approve, and the approval step lives in quarters/allotments/[id]/AllotmentDetailActions.tsx, so maker!=checker is at approval time. Whether the backend re-derives designation/pay level from HRMS or checks the employee exists cannot be verified (estab-service absent; page.tsx:73-75 comment says the service enriches employeeName from hrms-client).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/[id]/ApplyAllotmentForm.tsx`, `apps/web/src/app/_components/ds/EmployeePicker.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create a shared EmployeePicker (searchable combobox) modelled on estab/operators/OperatorsPanel.tsx which loads /api/proxy/v1/hrms/employees; use a server-side search query rather than limit=200 so large estates work. Returns {id,name,employeeId,designation,payLevel?}.
  2. Replace the Employee ID input in ApplyAllotmentForm with EmployeePicker; keep the UUID check as a fallback guard on the selected id.
  3. Prefill designation from the selected employee and make it read-only; make payLevel read-only if HRMS exposes it, otherwise keep editable but label 'as per service record' (needs decision).
  4. In the ConfirmDialog description show the employee's name, designation and pay level instead of the id prefix.
  5. Ask backend to ignore client-sent designation/payLevel and take them from HRMS (record as a backend follow-up).
- **Acceptance:**
  - Component test: typing a name lists matching employees; selecting one enables submit and the dialog text contains the employee name, not a UUID prefix.
  - Component test: submitting with no selected employee focuses the picker and shows an error.
  - Manual: POST payload carries the selected employee id; designation cannot be edited to a value differing from HRMS.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Allotment eligibility (pay level drives entitlement) is a business decision; wrong pay level on an application affects who gets which quarter. Check the HRMS employee endpoint role access before exposing employee search to estab clerks (PII).

### GAP-ESTAB-QUARTERS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Quarter or allotment-list failures show only a DataSourceBadge with no retry (page.tsx:47-49,114-116); not-found is a bare paragraph.
- **Verified evidence:** quarters/[id]/page.tsx:43-53: when !quarter and quarterSource==='error' only <DataSourceBadge source='error' /> is shown (no retry: DataSourceBadge has no retry/help action); allotment failure shows the same badge twice (:112 Card link and :114-116). Because fetchJson (apps/web/src/app/_data/apiClient.ts) returns source:'error' for ANY non-ok response or a null mapResponse, a real 404 also lands in the error branch; the 'could not be found' paragraph at :50 is effectively unreachable. The loader result carries status (404 vs 5xx) but the page ignores it. RefreshErrorState exists (ds/RefreshErrorState.tsx) and is used on vehicles/page.tsx:63.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/[id]/page.tsx`
- **Fix steps:**
  1. Capture status from getQuarter's LoaderResult; if quarterSource==='error' and status===404 call notFound() (or render EmptyState 'Quarter not found' with back link); other errors render <RefreshErrorState error={toHumanError('load',{area:'quarter'})} backHref='/estab/quarters' />.
  2. For the allotment card, when errored && quarterAllotments.length===0 render <RefreshErrorState error={toHumanError('load',{area:'allotment history'})} /> and drop the duplicate badge in Card link (:112).
  3. Keep the stale-rows-with-error case (comment :57-66): show the rows plus a single small badge.
  4. Import RefreshErrorState and toHumanError as vehicles/page.tsx does.
- **Acceptance:**
  - Page test: quarter fetch 500 renders a Retry button and no 'could not be found' text.
  - Page test: quarter fetch 404 renders the not-found state, not the error state.
  - Page test: allotments error with quarter loaded shows one error block with Retry; clicking calls router.refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Existing page.test.tsx case 'even with stale non-empty rows' must keep passing.

### GAP-ESTAB-QUARTERS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme RAWVALUE (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Version (optimistic-lock counter) is displayed to users as a detail field (page.tsx:104) and Condition prints the raw stored string.
- **Verified evidence:** quarters/[id]/page.tsx:104 renders <dt>Version</dt><dd>{quarter.version}</dd> (optimistic-lock counter, meaningless to users; QuarterRow.version at QuartersTable.tsx:16); :102 prints quarter.condition raw (stored snake_case/free string, e.g. 'needs_repair'), while type is humanised at :88.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Delete the Version <div> from the details <dl> (keep version in QuarterRow for future If-Match use).
  2. Add formatEnumLabel(s) to lib/formatters.ts (replace _ with space, sentence case; '—' for null/empty) and use it for Condition here and for Category if it is a code.
  3. Reuse formatEnumLabel in quarters/QuartersTable.tsx condition column (:26).
- **Acceptance:**
  - Unit test: formatEnumLabel('needs_repair') === 'Needs repair'; formatEnumLabel(null) === '—'.
  - Page test: no 'Version' label in the details card; Condition shows 'Needs repair'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. If version is later needed for edit conflict messages, surface it in the edit form only.

### GAP-ESTAB-QUARTERS-DETAIL-05  ·  LOW  ·  partly  ·  theme NUMFMT (was DATEFMT)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The apply form disappears for non-vacant quarters with no explanation of why; Applied dates use formatIndianDate but Carpet area/other numbers are unformatted.
- **Verified evidence:** page.tsx:108 renders ApplyAllotmentForm only when quarter.status==='vacant' with no else message (TRUE, no explanation for allotted/occupied/other). :101 prints the area as `${quarter.carpetAreaSqft} sq. ft.` with no Indian grouping (TRUE, minor). The date part is wrong: appliedAt already goes through formatIndianDate (:80); theme DATEFMT does not fit.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/[id]/page.tsx`
- **Fix steps:**
  1. Add an else branch after :108: a muted note 'Applications are only accepted for vacant quarters. This quarter is {formatEnumLabel(status)}.' (role=note), linking to the allotment history card.
  2. Format carpet area with Number(...).toLocaleString('en-IN') + ' sq. ft.'.
  3. Leave formatIndianDate usage as-is.
- **Acceptance:**
  - Page test: status 'occupied' renders the explanatory note and no form; status 'vacant' renders the form.
  - Page test: carpetAreaSqft 1250 renders '1,250 sq. ft.'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-QUARTERS-DETAIL-04


---
## /estab/quarters/allotments  —  `estab/quarters-allotments.html`

- **Source:** `apps/web/src/app/(app)/estab/quarters/allotments/page.tsx`
- **Design reference:** `redesign/estab/quarters-allotments.html`

### GAP-ESTAB-QUARTERS-ALLOTMENTS-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The Quarter column prints the first 8 characters of quarterId ("8c21a0b4…") instead of the quarter number, so a reviewer cannot tell which quarter an application is for without opening it (AllotmentsTable.tsx:30,38).
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx:30 quarterShort = quarterId.slice(0,8)+'…' rendered at :38. AllotmentRow (:6-17) carries only quarterId, no quarterNo. The detail page fetches /api/v1/estab/quarters/{id} to get quarterNo (AD:29-37), and the estab quarters list (estab/quarters/page.tsx, QuartersTable) exists, but this list does not use it.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/page.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`
- **Fix steps:**
  1. Preferred: have estab-service include quarterNo in quarter-allotments rows (add to AllotmentRow).
  2. Interim: in allotments/page.tsx also fetchJson('/api/v1/estab/quarters') and pass a Map id->quarterNo to AllotmentsTable; fall back to prefix only when missing.
  3. Make column key 'quarterNo' filterable (placeholder already promises quarter filtering).
- **Acceptance:**
  - List shows quarter numbers such as 'B-204'.
  - Filter by quarter number works.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-ESTAB-QUARTERS-ALLOTMENTS-02  ·  HIGH  ·  partly  ·  theme COPY (was DATEFMT)

- [x] **Status** (W2 estab: closed by #2052)
- **First-pass claim:** Caption claims "current financial year" (AllotmentsTable.tsx:49) but fetchJson("/api/v1/estab/quarter-allotments") sends no date/FY parameter (page.tsx:7), so the caption is unverifiable and may mislead an auditor.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx:49 caption 'Quarter allotments — current financial year' (true) while apps/web/src/app/(app)/estab/quarters/allotments/page.tsx:6-13 requests /api/v1/estab/quarter-allotments with no FY/date parameter; the caption and the stat cards (:38-41) could be wrong if the service returns all years, and whether it defaults to the current FY is cannot-verify. Appearance of a 'DATEFMT' issue is wrong: dates already use formatIndianDate (LT:31).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/page.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`
- **Fix steps:**
  1. Confirm with backend the default scope; if it returns all years, remove 'current financial year' from the caption.
  2. Or add an FY selector using lib/fiscalYear.ts and send fy=<from,to> query params; caption then states the selected FY.
  3. Label stat cards with the same scope.
- **Acceptance:**
  - Caption matches actual data scope (data from two FYs is not labelled 'current').
  - FY selector filters rows and stats.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Misleading caption on an auditable register.

### GAP-ESTAB-QUARTERS-ALLOTMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W1 SF-17b: closed by #2033)
- **First-pass claim:** Employee ref column duplicates the Employee column as a truncated UUID (:37); when employeeName is null the name column shows the same prefix twice.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx:21 employeeShort = employeeRef.slice(0,8)+'…'; :29 employeeDisplay = employeeName ?? employeeShort; columns :36-37 show Employee (employeeDisplay) and Employee ref (employeeShort). When employeeName is null both columns show identical prefix; when set, the second column is an unhelpful truncated id (comment at :25-28 says name is best-effort).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`
- **Fix steps:**
  1. Remove the 'Employee ref' column (keep the full ref in row link / detail).
  2. When name is null show 'Name unavailable' plus prefix in secondary muted text within the single Employee cell.
  3. Add employeeRef to filter keys if search by id is needed.
- **Acceptance:**
  - Row with null name shows one Employee cell with fallback.
  - No duplicate columns.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-QUARTERS-ALLOTMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Error state shows the badge up to three times and no retry (page.tsx:31,36,46); stats correctly print "—" but there is no path to recover except a manual reload.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/page.tsx:31 (PageHeader actions), :36 and :46 each render <DataSourceBadge source='error'/> when errored (allotments is [] then, so all three show). No retry path; stats correctly show '—' (:38-41). RefreshErrorState (ds, uses router.refresh) is designed for exactly this server-page case.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/page.tsx`
- **Fix steps:**
  1. Remove the badge from PageHeader actions (:31) and the standalone one at :36.
  2. When errored, replace the stats and Card with <RefreshErrorState error={toHumanError('load',{area:'quarter allotments'})} backHref='/estab/quarters' />.
  3. Keep DataSourceBadge only where partial data is shown.
- **Acceptance:**
  - Mock fetch failure: a single error card with Retry; clicking Retry re-runs the loader.
  - No duplicate badges.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-QUARTERS-ALLOTMENTS-05  ·  LOW  ·  partly  ·  theme LISTUX (was WIRING)

- [x] **Status** (W2 estab: closed by #2052)
- **W0 note:** partly fixed by #1916 — Eligibility column added; still no status Segmented filter (text filter only)
- **First-pass claim:** eligibilityScore is returned but never shown in the list, so the waitlist order rationale is invisible; status filter is text search only.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx:13 defines eligibilityScore but columns (:35-43) omit it (true), though it is shown on the detail page (AD:95). Claim that waitlist order rationale is invisible is inferential: no rank/position field exists in AllotmentRow. Filtering is DataTable's text filter (:54-55, placeholder mentions status), no status dropdown (true).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/AllotmentsTable.tsx`
- **Fix steps:**
  1. Add an 'Eligibility' column (numeric, sortable) after Pay Level.
  2. Add a status Segmented/select filter above the table using ds Segmented, values applied/waitlisted/allotted/occupied/vacation_notice.
  3. If a waitlist position is wanted, request it from the API rather than inferring.
- **Acceptance:**
  - Sorting by Eligibility works.
  - Selecting 'Waitlisted' shows only those rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /estab/quarters/allotments/[id]  —  `estab/quarters-allotments-detail.html`

- **Source:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`
- **Design reference:** `redesign/estab/quarters-allotments-detail.html`

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [~] **Status** (W2 estab #2052: partly done, the rejection reason is not surfaced)
- **W2 note:** Client-side maker-checker pre-check disables Allot for the applicant with an explanation (en and hi), and the page reports Done / Not applied yet after a command. The consumer swallows the rejection (no stored last-command error), so the reason is not shown; exposing it needs a schema column and migration (db/schema.sql, models, Alembic kept in sync) and is left as the remainder.
- **W0 note:** partly fixed by #1916 — Maker-checker pre-check + 3x refresh poll added; no 'not applied yet' message or rejection reason surfaced
- **First-pass claim:** Commands are fire-and-forget: the UI says "accepted for processing" then router.refresh() (AllotmentDetailActions.tsx); if the server later rejects it (maker-checker: allotting officer = applicant) the status simply does not change and nothing tells the officer why.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx:139-143 copy states commands are 'accepted' asynchronously and the maker-checker check runs later in the background; onSuccess (:159-162, :181-184) sets 'accepted for processing' and router.refresh(). Nothing polls or shows a rejected outcome: if the server drops the command, status just stays. Sync errors do surface because browserJson throws (browserClient.ts). Actions already use ActionButton confirm dialogs; a mandatory reason is not used. Whether estab-service really returns 202 and exposes rejection status is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`
- **Fix steps:**
  1. Check with backend whether a command-status/rejection reason is exposed on the allotment (e.g. lastCommandError); if not, add it.
  2. After success, poll router.refresh() a few times (or re-fetch by id) until status/version changes; if unchanged after ~10s show 'Not applied yet - the server may have rejected it (e.g. you cannot allot your own application)'.
  3. Pre-check maker-checker client-side when session user id equals applicant and disable Allot with an explanation.
  4. Add requireReason to the Vacate ConfirmDialogs (see -04).
- **Acceptance:**
  - Allot as the applicant: UI explains why it was refused within seconds.
  - Normal allot: status flips and notice clears.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Allotting starts a payroll licence-fee deduction later; users must know whether the command applied.
- **Depends on:** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The page fetches the entire allotments list and does allotments.find(id) (page.tsx:51); a valid allotment outside the returned list shows "could not be found", and all employees' allotments are pulled to render one.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx:19-27 getAllotments() hits /api/v1/estab/quarter-allotments with no id/limit param and :50-51 does allotments.find(a=>a.id===params.id). Not found (:53-63) prints 'could not be found' whenever the id is absent from the returned page (server default page size unknown, cannot-verify), and the whole list is transferred per view. The web code only calls /quarter-allotments/:id/<action> (AllotmentDetailActions.tsx:37); a GET-by-id endpoint is not evidenced in the snapshot (estab-service absent).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`
- **Fix steps:**
  1. Confirm/add GET /v1/estab/quarter-allotments/:id in estab-service and reuse the getQuarter-style loader (fetchJson with mapResponse) in a new getAllotment(id).
  2. Replace getAllotments()+find with getAllotment(params.id); distinguish source==='error' (RefreshErrorState) from real 404 (notFound()).
  3. Drop the now-unused list loader.
- **Acceptance:**
  - Allotment beyond the list page loads by direct URL.
  - Unknown id -> not-found; backend down -> error state with retry.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but wrong not-found on outage currently misleads officers.

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-03  ·  HIGH  ·  partly  ·  theme UUID (was PII)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** The full employee UUID is printed in Application details (page.tsx:91) although employeeName exists on the row; the header and dialogs use the 8-character prefix. Names, not identifiers, should identify the applicant (DPDP data-minimisation).
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx:91 prints the full employeeRef with class mono in 'Application details'; header subtitle (:79) and action dialogs (AllotmentDetailActions.tsx:43,152,174) use the 8-char prefix. AllotmentRow has employeeName (AllotmentsTable.tsx:10) but the detail page never uses it. A UUID reference is an internal id, not direct PII, so the DPDP framing and 'high' severity are overstated; the real defect is that the applicant is identified by id instead of name (name is nullable, hrms enrichment fails open).
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`
- **Fix steps:**
  1. In page.tsx show allotment.employeeName ?? formatInternalRef fallback in the Employee dd; keep full ref only as small secondary text (or omit).
  2. Pass employeeName prop to AllotmentDetailActions and use it in dialog descriptions and subtitle.
  3. Show a 'Name unavailable' hint when null.
- **Acceptance:**
  - Detail page shows the applicant's name; UUID not in main text.
  - Null name -> explicit fallback.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; officers confirming allot must see who the applicant is.
- **Depends on:** GAP-ESTAB-QUARTERS-ALLOTMENTS-03

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Lifecycle buttons render for every viewer and irreversible ones (Vacate now, Record vacation) sit beside routine actions; "Vacate now (skip notice)" bypasses the notice period with one confirm.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx:145-238 Allot/Occupy/Issue notice/Vacate buttons render for every viewer (no role prop; page.tsx passes none). 'Vacate now (skip notice)' (:212-219) sits directly under the routine vacation-notice form; its ConfirmDialog (:261-276) is danger-styled but has no requireReason and the same dialog is used for 'Record vacation' after notice. Whether the backend permits skipping notice is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`
- **Fix steps:**
  1. Pass canAct (from getSessionRoles in page.tsx, see OPERATORS-02) and hide/disable lifecycle controls otherwise.
  2. Set requireReason on the vacate ConfirmDialog, with a stronger title when status==='occupied' (notice skipped) and separate visually (danger zone section).
  3. Ensure the PATCH body carries the reason and the backend audits it.
- **Acceptance:**
  - Non-authorised user sees status only.
  - Vacate-now requires a reason before Confirm enables.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Vacating returns the quarter to the pool and stops deductions; wrong click has payroll impact.
- **Depends on:** GAP-ESTAB-OPERATORS-02

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** No way to reject or cancel an application although "cancelled" is treated as a final state (AllotmentDetailActions.tsx); nothing in this route can set it.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx:125 treats 'cancelled' as final, but the only actions in the file are allot (:158), occupy (:180), vacation-notice (:92), vacate (:114); there is no reject/cancel/withdraw control anywhere on this route. Whether a cancel/reject endpoint exists is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`
- **Fix steps:**
  1. Decide with product whether applied/waitlisted/allotted allotments can be rejected or cancelled and by whom (maker-checker).
  2. If an endpoint exists, add ActionButton 'Reject application'/'Cancel allotment' (danger, requireReason) for applied/waitlisted/allotted statuses.
  3. If not, drop 'cancelled' handling or note it is set elsewhere.
- **Acceptance:**
  - Applied allotment can be rejected with a reason and status becomes cancelled.
  - Final-state card shows for cancelled.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Waitlist ordering and quarter availability change on cancel; needs backend rules.
- **Depends on:** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04

### GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Vacation due date is a native date input with no min (past dates accepted) and the dialog prints it as ISO yyyy-mm-dd (AllotmentDetailActions.tsx); Eligibility score and Version are shown without explanation.
- **Verified evidence:** apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx:195-205 date input has no min attribute and continueVacationNotice (:77-86) only regex-checks YYYY-MM-DD, so past dates pass; ConfirmDialog description prints the raw string (:254). apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx:95-96 show 'Eligibility score' and 'Version' without help text. Server-side date validation is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/estab/quarters/allotments/[id]/AllotmentDetailActions.tsx`, `apps/web/src/app/(app)/estab/quarters/allotments/[id]/page.tsx`
- **Fix steps:**
  1. Set min to today (IST) on the input and reject past dates in continueVacationNotice with an inline error.
  2. Format the dialog date with formatIndianDate (lib/formatters).
  3. Add HelpTip/Term text for Eligibility score, and hide Version from non-admins or label it 'Record version'.
- **Acceptance:**
  - Past date -> inline error, dialog not opened.
  - Dialog shows dd/mm/yyyy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; check business rule on backdated notices first.


---
## /estab/vehicles  —  `estab/vehicles.html`

- **Source:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`
- **Design reference:** `redesign/estab/vehicles.html`

### GAP-ESTAB-VEHICLES-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/page.test.tsx: banner links to /assets/fleet/vehicles and /assets/fleet/maintenance)
- **First-pass claim:** Subtitle and banner promise "allocation, log books, fuel and maintenance" but the page offers none: rows are not links (VehiclesTable.tsx:38-51, no rowLinkKey), there is no /estab/vehicles/[id] route, and the banner names the Asset register without linking to it (page.tsx:48).
- **Verified evidence:** vehicles/page.tsx:31 subtitle 'Allocation, log books, fuel and maintenance for the fleet.'; VehiclesTable.tsx:38-51 DataTable has no rowLinkKey/rowLinkPrefix; ls estab/vehicles shows only page.tsx, VehiclesTable.tsx and new/ (no [id] route, no logbook/fuel/maintenance pages under estab). Banner at page.tsx:48 says 'lives in the Asset register' as plain text. Routes that do exist elsewhere: apps/web/src/app/(app)/assets/fleet/{vehicles,devices,maintenance} and (app)/fleet/vehicles, so the capability partly lives under Assets but is not linked from here. The estab hub (estab/page.tsx:17) also promises 'Vehicle management & logbook'.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`, `apps/web/src/app/(app)/estab/page.tsx`
- **Fix steps:**
  1. Decision: either build /estab/vehicles/[id] (allocation, logbook, fuel, maintenance) or link out. Minimal path: change the subtitle to 'Fleet register and allocation' and make the banner text link to /assets/fleet/vehicles and /assets/fleet/maintenance.
  2. Wrap 'Asset register' and 'logbook' in <Link>; hide the claims that no screen supports.
  3. Update the estab hub note to match (estab/page.tsx:17).
  4. If a detail page is built: add rowLinkKey='id' rowLinkPrefix='/estab/vehicles/' to the DataTable and the route with loading/error files.
- **Acceptance:**
  - Page test: banner contains links whose hrefs resolve to existing routes.
  - Manual: every capability named in the subtitle is reachable in <=2 clicks, or the wording no longer promises it.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for the wording fix; building a full vehicle detail feature is L and should be scoped separately.

### GAP-ESTAB-VEHICLES-02  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/page.test.tsx: officer name, Pool, or em dash, never a UUID)
- **First-pass claim:** "Allocated to" prints v.assignedTo verbatim (page.tsx:20); if the API returns an officer id (the add form takes a UUID, vehicles/new/page.tsx:50) the column shows ids rather than names.
- **Verified evidence:** vehicles/page.tsx:20 allocatedTo: v.assignedTo ?? 'Pool', printed verbatim in the 'Allocated to' column (VehiclesTable.tsx:44-45 region). The add form sends allocatedTo as a UUID (new/page.tsx:63), so the API plausibly returns the id. What assignedTo really contains (id vs resolved name) cannot be verified: estab-service and the VehicleSummary type (@civitasone/types) are absent from the snapshot.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`, `estab-service vehicles list route (not in snapshot)`
- **Fix steps:**
  1. Check the API response: if assignedTo is an id, ask the service to add assignedToName (same enrichment as quarter allotments' employeeName) and display it.
  2. Until then resolve names server-side in page.tsx via the hrms employees endpoint for the distinct ids, falling back to '—' (never to the raw id).
  3. Show 'Pool' only when assignedTo is empty.
- **Acceptance:**
  - Page test: vehicle with assignedTo uuid and assignedToName 'A. Kumar' renders 'A. Kumar'.
  - Page test: no cell in the column matches a UUID regex.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; PII display of officer names is normal for estab roles.
- **Depends on:** GAP-ESTAB-VEHICLES-NEW-01

### GAP-ESTAB-VEHICLES-03  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE (was I18N)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/page.test.tsx: exactly one 'Vehicle fleet' heading in loaded, empty and error states)
- **First-pass claim:** Card heading "Vehicle fleet" is rendered twice when data exists: once in the page card header (page.tsx:59-61) and again inside VehiclesTable (VehiclesTable.tsx:34-37).
- **Verified evidence:** vehicles/page.tsx:58-61 always renders a card with <div class='card-h'><h3>Vehicle fleet</h3></div>; when vehicles exist the else branch mounts VehiclesTable, whose own header at VehiclesTable.tsx:34-37 renders another <div class='card-h'><h3>Vehicle fleet</h3> + Segmented> inside the same .card. Two h3s with the same text (double heading, screen reader noise).
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`, `apps/web/src/app/(app)/estab/vehicles/VehiclesTable.tsx`
- **Fix steps:**
  1. Remove the page-level card-h (page.tsx:59-61) and render the h3 only inside VehiclesTable (which also owns the Segmented control), OR pass a 'title' prop to the table and keep the page header only for error/empty states.
  2. For the error/empty states give the card a heading via the same shared markup so headings stay consistent.
- **Acceptance:**
  - Page test: getAllByRole('heading',{name:'Vehicle fleet'}) has length 1 in loaded, empty and error states.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-VEHICLES-04  ·  MEDIUM  ·  confirmed  ·  theme METRICS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/page.test.tsx: an Other tile makes the tiles sum to Fleet)
- **First-pass claim:** Status tiles filter three literal statuses and Fleet is the total (page.tsx:11-14); retired/out-of-service vehicles are counted in Fleet but in no other tile.
- **Verified evidence:** vehicles/page.tsx:11-14: total = vehicles.length; available/in_use/maintenance are exact-string filters; any other status (e.g. retired, out of service; the enum is not visible in the snapshot) is in Fleet only, so the four tiles need not reconcile. Values are real, not fabricated; only the completeness is at issue. Tiles do show '—' when errored (:53-56).
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`
- **Fix steps:**
  1. Compute other = total - available - inUse - maintenance and add an 'Other / Retired' tile when other > 0 (or rename Fleet to 'Total registered' and add the tile permanently).
  2. Once the status enum is confirmed, replace string literals with the shared enum constants.
  3. Consider excluding retired vehicles from 'Fleet' if that is the business definition (decision).
- **Acceptance:**
  - Page test: data with one 'retired' vehicle shows Fleet=N and an Other tile of 1, and tiles sum to Fleet.
  - Existing errored test still shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-VEHICLES-05  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/page.test.tsx: banner uses var(--infobg), no #e6f7f5/#99e6da/#0f766e; vehicles/loading.tsx is page-shaped)
- **First-pass claim:** Info banner uses hard-coded teal hex and an emoji (page.tsx:37-48), ignoring tokens/dark mode; no vehicles/loading.tsx so the generic estab skeleton (tiles + block) is shown.
- **Verified evidence:** vehicles/page.tsx:36-49 banner uses inline hex background #e6f7f5, border #99e6da, color #0f766e and an emoji 🔗 (:48); StatCard iconBg hexes at :53-56. No loading.tsx in estab/vehicles (directory holds page.tsx, VehiclesTable.tsx, new/), so Next falls back to estab/loading.tsx. Also observed: the page returns a bare fragment rather than the 'page-main wrap' container used by sibling pages, and shows a DataSourceBadge (:28) in addition to the RefreshErrorState (:63) when errored.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/page.tsx`, `apps/web/src/app/(app)/estab/vehicles/loading.tsx (new)`
- **Fix steps:**
  1. Replace the inline banner with a token-based banner class (e.g. existing className 'banner info' if defined in global CSS, else add it using var(--info*) tokens) and use an aria-hidden icon component instead of the emoji.
  2. Add vehicles/loading.tsx that renders header + four stat skeletons + SkeletonTable (ds/Skeleton.tsx).
  3. Wrap the page in <div className='page-main wrap'> and remove the duplicate badge at :28.
- **Acceptance:**
  - grep for '#e6f7f5|#99e6da|#0f766e' in the vehicles page returns nothing.
  - Dark-mode check: banner legible; loading skeleton matches page shape.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ESTAB-QUARTERS-05


---
## /estab/vehicles/new  —  `estab/vehicles-new.html`

- **Source:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`
- **Design reference:** `redesign/estab/vehicles-new.html`

### GAP-ESTAB-VEHICLES-NEW-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** The create payload is built and checked against EstabCreateVehicleBodySchema in @civitasone/schemas, which estab-service now validates with too (contract test in vehicle-assets.test.ts, web test vehiclePayload.test.ts). Found and fixed on the way: an electric vehicle ('ev') was listed as Petrol (mapFuelType), and 'Toyota Innova Crysta' lost its model words / one-word entries repeated the make (splitMakeModel). The Fuel column and the missing-odometer guard were already in place.
- **W0 note:** partly fixed by #1916 — Fuel column + odometer guard done; POST payload keys (regNo/makeModel) still unaligned/unverified vs list fields; no contract test
- **First-pass claim:** The form posts a combined makeModel and regNo/allocatedTo (page.tsx:58-64) while the list reads make, model, vehicleNo, assignedTo and odometerKm (vehicles/page.tsx:16-24); without the service the mapping cannot be verified, and fuelType and odometer are never shown back in the fleet list.
- **Verified evidence:** vehicles/new/page.tsx:59-64 posts {regNo, makeModel, fuelType, allocatedTo?}; vehicles/page.tsx:16-24 reads v.vehicleNo, v.make, v.model, v.assignedTo, v.odometerKm from getVehicles (loaders.ts:3693). Names differ, TRUE, but whether estab-service maps regNo->vehicleNo etc. cannot be verified (services/estab-service and @civitasone/schemas/@civitasone/types are absent from the snapshot). Also TRUE: the list has no fuel type column. NOT TRUE as written: the list DOES show odometer (VehiclesTable odometer column); the add form simply has no odometer field so it is never collected. Note v.odometerKm.toLocaleString at vehicles/page.tsx:21 will throw if the API omits it (fleet/vehicles/page.tsx:15 treats it as optional).
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`, `apps/web/src/app/(app)/estab/vehicles/page.tsx`, `apps/web/src/app/(app)/estab/vehicles/VehiclesTable.tsx`
- **Fix steps:**
  1. Obtain the estab-service create-vehicle zod schema and the VehicleSummary type; align payload keys in new/page.tsx:59-64 (split make/model if the API expects two fields).
  2. Add an optional odometer (km) input if the API accepts it; otherwise state on the form that it is captured later.
  3. Add a Fuel column to VehiclesTable/VehicleRow and map v.fuelType in vehicles/page.tsx.
  4. Guard the odometer render: (v.odometerKm ?? null) and show '—' when absent.
  5. Add a contract test (zod parse of the create payload against the shared schema).
- **Acceptance:**
  - Contract test: payload built by the form parses with the shared create-vehicle schema.
  - Component test: a vehicle with missing odometerKm renders '—' instead of throwing.
  - Manual: add a diesel vehicle and see Diesel in the list.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** If the backend actually expects different keys, adds silently fail validation or store blanks; confirm before changing.

### GAP-ESTAB-VEHICLES-NEW-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/new/page.test.tsx: choosing an officer from the picker posts allocatedTo, leaving it empty posts none, no UUID is typed or shown)
- **First-pass claim:** Allocated to requires an officer UUID typed by hand (page.tsx:50-54,205-212); clerks cannot know ids, and a valid-looking but wrong UUID allocates the vehicle to an unrelated person.
- **Verified evidence:** vehicles/new/page.tsx:198-208 'Allocated to (optional)' is a plain text input with placeholder 'Officer ID (UUID)'; :50-55 validates only UUID format; :63 sends it. A well-formed but wrong UUID is accepted client-side. Note the app has no EntityPicker; the closest pattern is estab/operators/OperatorsPanel.tsx:72 which loads /api/proxy/v1/hrms/employees?limit=200 and lists names.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`, `apps/web/src/app/_components/ds/EmployeePicker.tsx (new, shared with QUARTERS-DETAIL-02)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create/reuse the shared EmployeePicker (searchable, shows name + designation, returns id).
  2. Replace the allocatedTo input with EmployeePicker, allow clearing to mean 'Pool'.
  3. Remove UUID_RE and its check; the picker guarantees a real id.
  4. Show the chosen officer's name in a summary before submit.
- **Acceptance:**
  - Component test: choosing an officer submits their id as allocatedTo; clearing submits no allocatedTo.
  - Manual: no field on the page requires typing a UUID.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Employee search exposes HRMS PII; confirm estab roles may read /hrms/employees.
- **Depends on:** GAP-ESTAB-QUARTERS-DETAIL-02

### GAP-ESTAB-VEHICLES-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme FEEDBACK (was OTHER)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/new/page.test.tsx: one POST on double click, error banner persists past 6 s; router.refresh() after success)
- **First-pass claim:** Success is declared on HTTP 202 (page.tsx:70) and the page redirects after 800 ms, but an accepted request may not yet be in the list; the error toast also auto-dismisses after 5 s (page.tsx:86), so a keyboard user can lose the message.
- **Verified evidence:** vehicles/new/page.tsx:70 treats status 202 or res.ok as success; :75 router.push after 800 ms; :86 finally always schedules setToast(null) after 5000 ms, so the error toast (role=alert) is removed after 5 s (WCAG 2.2.1 timing). Extra defects found: finally also runs setSubmitting(false) (:85) so during the 800 ms the Add button is re-enabled and can double-submit and create a duplicate vehicle; the setTimeout redirect is not cleaned up. The list loader getVehicles uses revalidateSeconds: 120 (loaders.ts:3695), so the new vehicle may not appear for up to two minutes even after redirect; router.push does not bust that server data cache.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Keep submitting=true (or a 'done' flag) after a successful response; only reset it on failure.
  2. Do not auto-dismiss error messages: remove the setTimeout(setToast(null)) for type==='error' (clear on next submit or via a dismiss button); auto-dismiss success only if there is no redirect.
  3. Redirect immediately with router.push('/estab/vehicles?added=<regNo>') and show the confirmation on the list via the ToastProvider/useToast in ds/Toast.tsx.
  4. For 202, label it 'submitted' and add revalidatePath/tag (server action or route handler) or lower revalidateSeconds for estab.vehicles so the list refreshes; or optimistic row until the list contains it.
- **Acceptance:**
  - Component test: after success, the submit button stays disabled and only one POST is made on double click.
  - Component test: error message remains visible after 6 s (fake timers).
  - Manual: after adding, the vehicle appears on /estab/vehicles without waiting for cache expiry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Duplicate vehicle registration on double submit is the live business risk today.

### GAP-ESTAB-VEHICLES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme FORMVALID (was CAP)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/new/page.test.tsx: per-field errors, focus on Registration number, aria-invalid and aria-describedby)
- **First-pass claim:** Only the first validation error is shown, above the buttons, away from the offending field, with no aria-invalid or focus move; inputs use the browser's required bubbles as well (page.tsx:140,161).
- **Verified evidence:** vehicles/new/page.tsx:36 holds a single fieldError string; :41-55 returns on the first failure; :211-220 renders it below the fields with role=alert but no aria-invalid/aria-describedby on the inputs (:135-143, :156-164, :201-208) and no focus move. Inputs at :140 and :161 have required and the form has no noValidate, so native browser bubbles fire first and the custom JS messages are reachable only for whitespace-only values. Contrast: quarters/[id]/ApplyAllotmentForm.tsx:39-50,98-109 already does per-field errors, aria-invalid, aria-describedby and focus.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`
- **Fix steps:**
  1. Replace fieldError string with an errors object {regNo?, makeModel?, allocatedTo?}; validate all fields at once.
  2. Add noValidate to the <form>, drop native required (keep aria-required).
  3. Render a <p id role='alert'> under each field and set aria-invalid/aria-describedby on the input.
  4. Focus the first invalid input via refs after validation, as ApplyAllotmentForm does.
  5. Trim and uppercase-normalise regNo before the empty check.
- **Acceptance:**
  - Component test: submitting empty shows two inline errors and focuses Registration number.
  - Component test: inputs have aria-invalid='true' and aria-describedby pointing to the message.
  - axe check on the form reports no violations.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTAB-VEHICLES-NEW-05  ·  LOW  ·  confirmed  ·  theme TOKENS (was FABRICATED)

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: vehicles/new/page.tsx has no hex literal (grep clean))
- **First-pass claim:** Hard-coded colours (#ef4444 asterisk, #ecfdf3/#fef2f2 toast) and a duplicated inline inputStyle instead of DS field components (page.tsx:17-24).
- **Verified evidence:** vehicles/new/page.tsx:133 and :154 use style color '#ef4444' for the required asterisk; :105-107 toast uses #ecfdf3/#6ee7b7/#065f46 and #fef2f2/#fca5a5/#991b1b; :17-23 defines a local inputStyle constant (8px 12px padding, 13px font) that differs from the 10px 12px/44px style repeated in quarters forms. ds/index.ts has no Field/Input/Select component, so 'DS field components' do not yet exist; a Toast (ds/Toast.tsx) and ErrorState do.
- **Files to change:** `apps/web/src/app/(app)/estab/vehicles/new/page.tsx`, `apps/web/src/app/_components/ds/FormField.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/FormField (label, required marker using var(--bad), hint, error id wiring) and ds/TextInput/Select with token-based styles and min-height 44px.
  2. Replace inputStyle and the asterisk spans in new/page.tsx with those components.
  3. Replace the inline banner colours with useToast() or the banner classes (class 'banner good'/'bad' if defined) so dark mode works.
  4. Optionally migrate quarters forms to the same components in a follow-up.
- **Acceptance:**
  - grep for '#ef4444|#ecfdf3|#fef2f2' in vehicles/new returns nothing.
  - Visual check in dark mode: labels, asterisk and toast are legible.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component adoption may touch many forms if rolled out widely.
- **Depends on:** GAP-ESTAB-VEHICLES-NEW-04


---
## /estab/workspace  —  `estab/workspace.html`

- **Source:** `apps/web/src/app/(app)/estab/workspace/page.tsx`
- **Design reference:** `redesign/estab/workspace.html`

### GAP-ESTAB-WORKSPACE-01  ·  HIGH  ·  partly  ·  theme STATE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Steps create real records one at a time (inward at :88, file at :105-112) but the wizard state lives only in React state; a refresh, failed step 3 or "Start another" (window.location.reload, :293) loses fileId and leaves an orphan file with an opening note and no submission or link back.
- **Verified evidence:** The wizard is workspace/GuidedFileWizard.tsx (page.tsx is a 15-line shell); cited line numbers are actual wizard lines. Step 1 posts /estab/inward (line 88), step 2 creates the file (:105-112), ids live only in useState (fileId :52, inwardId :46); 'Start another' calls window.location.reload() (:293), and a browser refresh on steps 3-4 loses fileId, leaving a file with its opening note in draft that was never submitted. TRUE. OVERSTATED: a failed step 3 does not lose fileId (component state persists and the Submit button can be retried, :150,:250); only refresh/reload/navigation does. The orphan is not unreachable: it should be listed under /estab/list, but nothing tells the user that.
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`, `apps/web/src/app/(app)/estab/workspace/page.tsx`
- **Fix steps:**
  1. After open-file succeeds, router.replace('/estab/workspace?fileId=<id>&step=3'); in page.tsx read searchParams and pass initialFileId to the wizard.
  2. On mount with initialFileId, GET /api/proxy/v1/estab/files/<id> to hydrate fileNo/status and start at step 3 (or Done if already submitted).
  3. Replace window.location.reload() (Done step) with a state reset plus router.replace('/estab/workspace').
  4. Add a beforeunload handler while fileId exists and !submitted warning that the file was created but not yet submitted.
  5. Persist step-1 inwardId the same way (query param) so the DAK linkage survives a refresh.
- **Acceptance:**
  - Component test: mounting with ?fileId=X fetches the file and shows step 3 with Submit enabled.
  - Manual: refresh on step 3 keeps the file and lets the user submit; 'Start another' returns to a blank step 1 without a full reload.
  - Manual: leaving during step 3 shows the beforeunload prompt.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Files and noting are approval workflow records; hydrating from URL must re-check the caller's permission on the file (server enforces via GET) and must not allow submit of someone else's file.

### GAP-ESTAB-WORKSPACE-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Submit for approval depends on a race: it polls the file up to four times at 700 ms for a draft note the earlier POST created asynchronously, then fails with "No draft note found yet — add a note on the file, then submit" (:126-136) — but the step offers no link to the file, only the approvals queue (:248-250).
- **Verified evidence:** GuidedFileWizard.tsx doSubmit :120-141: loops attempt<4 fetching /api/proxy/v1/estab/files/<fileId>, looks for a noteSheets entry with noteStatus==='draft', sleeps 700 ms between (and after the last) attempt (~2.8 s), then throws 'No draft note found yet — add a note on the file, then submit.' (:136). Step 3 UI (:242-255) offers only 'Open approvals queue' (href /estab/approvals), not a link to /estab/files/<fileId>, although the Done step already builds that link (:289). Whether the draft note is created asynchronously by the backend cannot be verified (estab-service absent). Errors render as a plain paragraph (:186), not role=alert.
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`
- **Fix steps:**
  1. In step 3 add an anchor <a href={`/estab/files/${fileId}`}> 'Open the file' (opens in new tab) next to the approvals link.
  2. Replace the fixed 4x700 ms poll with exponential backoff up to ~10 s and show 'Waiting for the note to be created…' while polling; distinguish fetch failure from 'no draft yet'.
  3. Ask backend to return the draft notingId in the open-file/create-file response so no polling is needed (backend follow-up).
  4. On final failure show the error with role='alert' plus 'Try again' and the file link.
  5. Do not attempt submit-for-approval unless notingId is found (already the case).
- **Acceptance:**
  - Component test (fake timers): when the file GET never returns a draft note, the error shows and a link to /estab/files/<id> is present.
  - Component test: draft appearing on 3rd attempt leads to a POST to submit-for-approval with that notingId.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approval routing: never submit without the correct draft notingId; keep that guard.
- **Depends on:** GAP-ESTAB-WORKSPACE-05

### GAP-ESTAB-WORKSPACE-03  ·  MEDIUM  ·  confirmed  ·  theme AUTHZ (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Any user can pick classification secret or top secret when opening a file (:18,217-219); there is no role gate or explanation of who may hold such files, and the classification is not shown again in the flow.
- **Verified evidence:** GuidedFileWizard.tsx:18 CLASSIFICATIONS includes 'secret' and 'top_secret'; the select at :217-220 lists all four for every user; state default 'confidential' (:49). There is no role check, help text or later display of the chosen classification (Done step :286-296 shows only fileNo/DFA). Server-side authorisation for high classifications cannot be verified (estab-service absent), so whether the API rejects unauthorised secret files is unknown.
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`, `estab-service file-create/open-file authorisation (not in snapshot)`
- **Fix steps:**
  1. Confirm the policy (needs decision): which roles may create secret/top_secret files; expose the user's allowed classifications (session role claim or a /estab/files/classifications endpoint).
  2. Filter/disable the secret and top secret options for users without the role and add helper text describing each level (aria-describedby).
  3. Show the selected classification in step 3 summary and on the Done step.
  4. Ensure the backend enforces the same rule and emits an audit event on secret file creation (backend check).
- **Acceptance:**
  - Component test: a user without the role does not see 'top secret' as selectable.
  - Component test: the classification label appears on step 3 and Done.
  - Backend/API test: POST files with classification top_secret by an unauthorised role returns 403.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Classified-file handling and audit; client hiding is not a control, backend enforcement is required.

### GAP-ESTAB-WORKSPACE-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13, re-confirmed in W1 SF-17b #2033: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Mark to officer lists "3f9a1c2e… · Administration · section_officer" — a raw id prefix and a raw role value — instead of names (:225); the Operators page resolves names from HRMS but this wizard does not.
- **Verified evidence:** GuidedFileWizard.tsx:225 renders `{o.employeeId.slice(0, 8)}… · {o.division} · {o.deskRole}` for each option; the Operator type (:15) has only id, employeeId, division, deskRole, active (no name), so the wizard shows an id prefix and the raw role value (e.g. section_officer). By contrast estab/operators/OperatorsPanel.tsx:72 fetches /api/proxy/v1/hrms/employees?limit=200 and formats 'name · designation' (:91,:164). When the operators list is empty the fallback is a raw 'officer UUID' text input (:228).
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`, `apps/web/src/app/(app)/estab/operators/OperatorsPanel.tsx (extract shared helper)`
- **Fix steps:**
  1. Extract the employee lookup from OperatorsPanel into a shared hook (useEmployeeDirectory) or ask the service to return employeeName on /estab/operators (backend follow-up, preferred).
  2. Render options as `{name} · {division} · {formatEnumLabel(deskRole)}`, falling back to '—' not the id prefix.
  3. Remove the raw UUID text fallback; if the operators list is empty show a message with a link to /estab/operators to enrol operators.
- **Acceptance:**
  - Component test: option text is 'A. Kumar · Administration · Section officer' and matches no /[0-9a-f]{8}…/.
  - Component test: empty operators list shows a link to /estab/operators, no UUID input.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; wrong officer name would mis-route a file so resolve by id not by name matching.
- **Depends on:** GAP-ESTAB-QUARTERS-DETAIL-04, GAP-ESTAB-WORKSPACE-06

### GAP-ESTAB-WORKSPACE-05  ·  MEDIUM  ·  partly  ·  theme ERRORMSG (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** postJson replaces every server response with one generic sentence and errors render as a plain red paragraph (:26-33,161); the user is not told which step or field failed, and step-3 copy claims "The opening note is on the file" even when file creation returned no id (:247).
- **Verified evidence:** postJson (GuidedFileWizard.tsx:26-33) discards the response and throws toHumanError('save',{area:'step'}) for any !res.ok (TRUE: 400/403/409/500 all read the same, and the message names 'step' not which one). Error paragraph at :186 (review said 161) is a plain <p style color var(--bad)> with no role='alert'. Local validations are specific ('Subject is required.', :85,:87,:101). Step 3 copy at :246 says 'The opening note is on the file' followed by '(open the file first)' only when fileId is null, so it is hedged rather than always claiming; still, step 2 can advance with fileId null when the API returned no id (:114 setFileId(null); next()), which leaves step 3 with a disabled Submit and no way forward except Back to re-create (duplicate file risk).
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`, `apps/web/src/lib/messages.ts`
- **Fix steps:**
  1. Make postJson take a step label and parse the JSON error body ({code,message} from the service HttpError, as apiClient.ts documents); use the server message when present, else toHumanError('save',{area: stepLabel}).
  2. Render the error in a role='alert' element inside the failing step card, with the step name prefix (e.g. 'Open file: ...').
  3. In doOpenFile, if the response has no string id throw an error instead of calling next(); do not advance.
  4. Show the 'opening note is on the file' sentence only when initialNote was actually sent.
- **Acceptance:**
  - Component test: 403 with body {message:'requires section_officer'} displays that message in an alert.
  - Component test: open-file response without id keeps the user on step 2 with an error.
  - Component test: step 3 copy does not mention an opening note when none was entered.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Server messages could leak internals; apiClient docs say HttpError messages are clerk-safe, still cap length and never render stack/body raw.

### GAP-ESTAB-WORKSPACE-06  ·  LOW  ·  confirmed  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Stepper is a row of divs without list or aria-current semantics and uses hard-coded hex (#4f46e5, #e2e8f0) for state (:163-186); the operators fetch failing is silent (:68-74).
- **Verified evidence:** GuidedFileWizard.tsx:164-183 stepper is a flex of <div>s (no <ol>/<li>, no aria-current='step'); state colours use hex: #0f172a (:168), #4f46e5 active bubble (:172), #e2e8f0 idle bubble (:172), #cbd5e1 chevron (:181), #64748b (:246,:261); :83-90 operator fetch has a silent catch and an ignored !res.ok, after which the picker silently degrades to a raw 'officer UUID' input (:228). No error or notice is shown. The theme FABRICATED is wrong; this is accessibility and tokens.
- **Files to change:** `apps/web/src/app/(app)/estab/workspace/GuidedFileWizard.tsx`, `apps/web/src/app/_components/ds/Stepper.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/Stepper rendering <ol aria-label='Progress'> with <li aria-current='step'> for the active item and visually-hidden 'completed' text; check first whether app/_components/Wizard.tsx can be reused.
  2. Replace hex colours with tokens (--ink, --accent, --good, --line, --mut).
  3. Track operatorsError state: on failure/!ok show a role='status' note 'Officer list could not be loaded' with a Retry button, instead of silently switching to a UUID field.
  4. Remove the UUID text fallback (see WORKSPACE-04).
- **Acceptance:**
  - Component test: stepper exposes 5 list items, exactly one with aria-current='step'.
  - Component test: operators fetch rejecting shows the retry message.
  - grep for '#4f46e5|#e2e8f0|#cbd5e1' in the file returns nothing; axe passes in light and dark.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-ESTAB-APPROVAL-MATRIX-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** Rules that decide who signs sanctions/payments/disciplinary actions can be created or toggled from a page with no role gate (page.tsx:7-13, ApprovalMatrixPanel.tsx:167-245); server-side authorization cannot be verified because estab-service is absent from the snapshot.
- **Service:** `estab-service`  ·  **Endpoint(s):** `['GET /v1/estab/approval-rules', 'POST /v1/estab/approval-rules', 'PATCH /v1/estab/approval-rules/:id']`
- **Question:** Do POST and PATCH approval-rules require an admin role (not any authenticated user) and emit audit events?
- **How to verify:** Open the approval-rules routes in estab-service; check requireRole on POST/PATCH. curl POST as an ordinary clerk expecting 403.
- **Test to add:** Given role=clerk when POST approval-rules then 403; given estab_admin then 201 with audit event; PATCH toggle likewise.
- **Impact if wrong:** Anyone can rewrite who signs sanctions, payments and disciplinary actions.
- **Web change if wrong:** Add requireAnyRole layout for estab/approval-matrix and hide create/toggle controls for non-admins (ApprovalMatrixPanel.tsx:167-245).

### GAP-ESTAB-DASHBOARD-05  ·  LOW  ·  partly  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, re-confirmed in W2 estab #2042: closed by #1916; evidence: dashboard/page.test.tsx: vehiclesInUse shown in the snapshot, Avg Pendency not duplicated; W2 estab rescan evidence: the pendency snapshot repeats none of the stat tiles any more: it shows Open files (all stages), Oldest open file (days) and Vehicles in use, the first two new on GET /v1/estab/dashboard; real-DB test dashboard-sla-pendency-real-db.test.ts, page.test.tsx) (W2 estab rescan: completed by #2132)
- **First-pass claim:** Pendency snapshot repeats four of the six tiles (page.tsx:99-102), and vehiclesInUse is loaded but never displayed.
- **Service:** `estab-service`  ·  **Endpoint(s):** `['GET /api/v1/estab/dashboard']`
- **Question:** 
- **How to verify:** Open estab/dashboard/page.tsx:51,96-102.
- **Test to add:** Render test: dashboard with vehiclesInUse=3 shows 3 or the field is dropped.
- **Impact if wrong:** Cosmetic.
- **Web change if wrong:** Show vehiclesInUse tile or drop it; replace repeated pendency fields.
- **Finding:** page.tsx:51 shows Avg Pendency tile and :102 repeats it in the snapshot panel; vehiclesInUse is not referenced anywhere under estab/dashboard (grep). Web-only, service not needed.

### GAP-ESTAB-HANDOVER-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [~] **Status** (W2 estab rescan: PARTIAL, NEEDS OWNER DECISION. Done: POST /v1/estab/handovers stays admin-only (estab_officer 403, covered), the web layout mirrors it (new layout test), from == to is refused (400), the bulk custody move (only the files counted by the preview), one movement per file and one audit event per batch are now covered by a real-DB consumer test. Remaining: any estab_division_admin can still move any officer's files tenant-wide; fromOfficerId is not checked against the caller's authority. Owner: should a division admin be limited to officers of their own division(s) (estab_admin and super_admin staying tenant-wide), taken from the caller's operator desk, and what happens for a division admin who is not enrolled as an operator?)
- **Previous status:** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** A page that bulk-moves custody of every file on a desk has no role gate (page.tsx:6-12, HandoverPanel.tsx:20-186); it depends wholly on server-side authorisation that is not in the snapshot.
- **Service:** `estab-service`  ·  **Endpoint(s):** `['GET /v1/estab/operators', 'GET /v1/estab/handovers', 'POST /v1/estab/handovers']`
- **Question:** Does POST handovers restrict bulk custody transfer to a supervisor/admin role and limit source desk to the caller's authority, with audit?
- **How to verify:** Open the handovers route in estab-service; check requireRole and source-desk ownership check. curl POST as a clerk moving another desk's files, expect 403.
- **Test to add:** Given clerk C not owning desk D when POST handover from D then 403; given admin then 201, all files' custody updated and an audit event per batch.
- **Impact if wrong:** Any user can seize custody of another officer's files.
- **Web change if wrong:** Add role layout and hide HandoverPanel for non-authorised roles.

### GAP-ESTAB-QUARTERS-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 estab: closed by #2042)
- **W2 estab note:** POST /v1/estab/quarters requires ESTAB_ROLES (quarters/routes.ts:28-30) and the form is shown only to ESTAB_QUARTER_ACTION_ROLES (quarters/page.tsx; page.roles.test.tsx). The create is asynchronous (202), so the success text now says the quarter appears in the list once processed. The form also no longer shows a raw e.message.
- **W0 note:** partly fixed by main — POST quarters requires estab roles server-side; form not role-gated and refresh after async 202 not polled
- **First-pass claim:** Create Quarter is not role-gated and the success message says only "submitted to the inventory" (QuarterCreateForm.tsx); whether the quarter appears immediately after router.refresh() is undeterminable.
- **Service:** `estab-service`  ·  **Endpoint(s):** `['POST /v1/estab/quarters', 'GET /v1/estab/quarters']`
- **Question:** Does POST quarters require an estate-officer role and does the following GET list include the new row immediately (no async projection)?
- **How to verify:** Open quarters create handler in estab-service; check requireRole and that GET reads the same table. POST then GET immediately and expect the new row.
- **Test to add:** Given estate_officer POST quarter then 201 and GET returns it in the same second; given clerk then 403.
- **Impact if wrong:** Unauthorised inventory edits or user believes create failed.
- **Web change if wrong:** Gate QuarterCreateForm by role; if async, change success text and poll instead of router.refresh().


---
## Cannot verify from the snapshot

### GAP-ESTAB-GUESTHOUSE-02 · /estab/guesthouse
- **First-pass claim:** List reads /api/v1/estab/guesthouse-bookings while the form posts to /api/proxy/v1/estab/room-bookings (loaders.ts guesthouse loader vs new/page.tsx:72); the naming split suggests two resources, and the "will appear in the register shortly" promise cannot be checked without the service.
- **Why cannot-verify:** Divergence is real: list loader getGuesthouseBookings uses /api/v1/estab/guesthouse-bookings (_data/loaders.ts:3702-3708) while the form POSTs /api/proxy/v1/estab/room-bookings (new/page.tsx:72). Both may be one resource under different names; the service and GuesthouseBookingSummary type/schema are not in the snapshot, so whether a new booking appears in the list (the '...appear in the register shortly' copy at :80) cannot be checked.
