# Detailed gap file — module `grants`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 85, BACKEND-VERIFY 1



---
## /grants  —  `grants/home.html`

- **Source:** `apps/web/src/app/(app)/grants/page.tsx`
- **Design reference:** `redesign/grants/home.html`

### GAP-GRANTS-HOME-01  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W2 PQ: closed by #PRNUM)
- **W0 note:** partly fixed by #1865 — tile labels Schemes/Installments/Releases still differ from page H1s (Grant Schemes/Grant Installments/Grant Releases) and grants/[id]/page.tsx:103 card still says 'Utilization Certificates' vs 'Utilisation' elsewhere
- **First-pass claim:** Tile labels do not match destination titles: "Grants" → page titled "Grants" (list/page.tsx:18) but the hub also is "Grants"; "UC Management" → "Utilization Certificates" (utilization/page.tsx:19); "Dashboard" → "Grants & Fund Management" (dashboard/page.tsx:42). Same module also mixes "utilisation" (page.tsx:17) and "Utilization" (utilization/page.tsx:19).
- **Verified evidence:** Hub labels (page.tsx:10-17): 'Grants' matches list page title 'Grants' (list/page.tsx:18) - that part of the finding is wrong. Real mismatches: 'Dashboard' vs 'Grants & Fund Management' (dashboard/page.tsx:42), 'UC Management' vs 'Utilization Certificates' (utilization/page.tsx:19-ish), 'Applications' vs 'Grant Applications'. Spelling mixes 'utilisation' (hub lines 12,17; dashboard subtitle) and 'Utilization' (page titles, cards). Strings are hard-coded; next-intl use not verified in this module.
- **Files to change:** `apps/web/src/app/(app)/grants/page.tsx`, `apps/web/src/app/(app)/grants/utilization/page.tsx`, `apps/web/src/app/(app)/grants/dashboard/page.tsx`
- **Fix steps:**
  1. Pick one spelling (en-IN 'utilisation' per GFR docs, or product choice) and apply to all grants strings.
  2. Align hub labels with page titles or vice versa.
  3. Move to message catalogue only if the app already uses next-intl elsewhere.
- **Acceptance:**
  - Grep for 'tilization' vs 'tilisation' in grants returns one spelling.
  - Each hub tile label equals destination H1.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.

### GAP-GRANTS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1865; re-confirmed W2 grants part 1 — getGrantApplications uses /api/v1/grants/applications, distinct from getGrants)
- **First-pass claim:** The "Applications" tile leads to a list that is actually fed by GET /api/v1/grants/grants (_data.ts:161-166), i.e. sanctioned grants, not applications — see grants/applications.html.
- **Verified evidence:** getGrantApplications fetches /api/v1/grants/grants (_data.ts:161-167), the same endpoint as getGrants (loaders.ts ~3550); mapGrantApplicationSummaries maps sanctioned grants into 'applications'. Hub tile says 'All grant applications with approval status'. Application-stage records are not what is listed.
- **Files to change:** `apps/web/src/app/(app)/grants/_data.ts`, `apps/web/src/app/(app)/grants/page.tsx`
- **Fix steps:**
  1. Confirm with grant-service whether an applications endpoint exists; if so point getGrantApplications at it.
  2. If not, rename tile/page to what it is or hide until backend ships.
- **Acceptance:**
  - Manual: Applications list count differs from Grants list when pending applications exist.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: applications detail page and next-steps CTA depend on this mapping.

### GAP-GRANTS-HOME-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1865; re-confirmed W2 grants part 1 — tiles are in lifecycle order: Grant Schemes → Grant Applications → Grants → Grant Installments → Grant Releases → Utilisation Certificates → Grantees → Grants Dashboard)
- **First-pass claim:** Eight equal tiles with no lifecycle order or counts (page.tsx:10-17); a first-time clerk cannot tell whether to start at Schemes or Applications.
- **Verified evidence:** page.tsx:9-18 passes 8 flat links to ModuleHub with a one-line note each; no order by lifecycle, no counts. It is a design opinion; ordering is partly lifecycle already (Schemes, Applications, ...).
- **Files to change:** `apps/web/src/app/(app)/grants/page.tsx`
- **Fix steps:**
  1. Order tiles Schemes -> Applications -> Grants -> Installments -> Releases -> UC -> Grantees -> Dashboard, or group under headings.
  2. Optionally add counts if ModuleHub supports them.
- **Acceptance:**
  - Manual: order follows lifecycle.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.

### GAP-GRANTS-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W2 PQ: already fixed on main — all grants/*/loading.tsx use RouteSkeleton; closed by #PRNUM)
- **W0 note:** partly fixed by #1865 — only grants/loading.tsx moved to themed SkeletonTable; list, installments, releases, utilization, grantees, [id] and applications/[id] loading.tsx still hard-code min-h-screen bg-slate-50/bg-slate-200
- **First-pass claim:** loading.tsx (and every grants skeleton) hard-codes bg-slate-50 / bg-slate-200 / min-h-screen, so it ignores dark mode and double-pads inside the app shell (loading.tsx:3-13).
- **Verified evidence:** grants/loading.tsx:3-13 uses min-h-screen bg-slate-50 p-6 md:p-8 and bg-slate-200 blocks; same pattern in 119 loading.tsx files (count via grep). No dark: variants; wrapper adds own padding and full-height inside the app shell.
- **Files to change:** `apps/web/src/app/(app)/grants/loading.tsx`, `apps/web/src/app/_components/ds (new PageSkeleton)`
- **Fix steps:**
  1. Create a shared PageSkeleton in ds using theme tokens (var(--surface) etc.) with props for stat count and table.
  2. Replace grants/*/loading.tsx bodies with it (drop min-h-screen and outer padding).
  3. Codemod the remaining loading.tsx files separately.
- **Acceptance:**
  - Visual: dark theme skeleton is not light slate.
  - No double padding vs loaded page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /grants/[id]  —  `grants/detail.html`

- **Source:** `apps/web/src/app/(app)/grants/[id]/page.tsx`
- **Design reference:** `redesign/grants/detail.html`

### GAP-GRANTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** grants/layout.tsx:5 only wraps <ModuleGate moduleKey="grants">; a repo-wide check shows no grants file imports requireAnyRole, whereas crm/layout.tsx:2-9 does (helper is apps/web/src/lib/auth/roleGuard.ts). Release/Verify/Reject ActionButtons in GrantDetailTables.tsx:63,109,130 render for everyone who reaches the route. Backend enforcement not verifiable: only hrms-service exists in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/[id]/page.tsx`, `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`, `apps/web/src/lib/auth/grantsRoles.ts`
- **Fix steps:**
  1. Decide role sets with product owner (e.g. GRANTS_VIEW_ROLES, GRANTS_MAKER_ROLES, GRANTS_CHECKER_ROLES, plus platform_admin/super_admin) and put them in a shared constant such as apps/web/src/lib/auth/grantsRoles.ts.
  2. In grants/layout.tsx call requireAnyRole(GRANTS_VIEW_ROLES) from @/lib/auth/roleGuard before <ModuleGate>, mirroring crm/layout.tsx.
  3. Read the session roles on the server in the page and pass a canRelease/canVerify boolean prop to the client tables; render the ActionButton only when true (else render nothing, not an aria-hidden dash).
  4. Confirm the grant-service enforces the same roles on /disburse, /validate, /approve; UI gating is convenience only.
- **Acceptance:**
  - Unit test: a session without a maker role renders the table with no Release/Verify/Reject/Approve buttons.
  - Manual: a user with only a viewer role opening the route sees read-only data; a user with no grants role is redirected/forbidden by layout.
  - Manual: maker role still sees the buttons and can complete an action.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money and approval actions currently open to all module users; wrong role list could lock legitimate officers out - confirm roles with grants owner first.

### GAP-GRANTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch is presented as "We couldn't find that grant… may have been removed": getGrantById falls back to null on error (loaders.ts:3558-3564) and page.tsx:11-13 calls notFound(); the source==="error" badge at page.tsx:28 is unreachable with a null grant.
- **Verified evidence:** getGrantById (loaders.ts ~3557-3564) passes null as the fetchJson fallback; apiClient.ts returns {data: empty, source:"error"} for missing base URL, 401, any non-ok status (incl. 404) and parse failure. page.tsx:11-13 calls notFound() when grant is null, so the not-found page shows for a failed fetch and the source==="error" badge at page.tsx:28 can only fire with a non-null grant (effectively never).
- **Files to change:** `apps/web/src/app/(app)/grants/[id]/page.tsx`
- **Fix steps:**
  1. In page.tsx, before the !grant check, branch: if (!grant && source==="error") return PageHeader(back=/grants/list) + <RefreshErrorState error={toHumanError("load",{area:"grant"})} backHref="/grants/list" /> (pattern used in metadata/records/page.tsx:23).
  2. Only call notFound() when source==="api" and grant is null.
  3. If apiClient exposes result.status, map 404 to notFound() and everything else to the error state.
- **Acceptance:**
  - Test: mock getGrantById -> {data:null,source:'error'} renders the retry state, not notFound.
  - Test: {data:null,source:'api'} still calls notFound().
  - Manual: stop gateway, load /grants/<id>, see Retry which calls router.refresh().
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; make sure a genuine 404 is not turned into a retry loop.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2035)
- **W0-10 note:** review found the W0 tick partly — Reason no longer sent as beneficiaryBankRef: GrantDetailTables.tsx:137-140 and InstallmentsTable.tsx:141 send {mode,reason}; backend disbursement/validators.ts + consumer.ts:241,260 audit the reason. But comment GrantDetailTables.tsx:135-137 claims bank ref is resolved server-side from grantee master - no such resolution exists (disbursement/consumer.ts:194 requires p.beneficiaryBankRef for live PFMS, row stored with null at :228), so acceptance "PFMS bankRef is grantee's account ref" unmet; no shared postDisburse helper (payload duplicated in both tables)
- **First-pass claim:** Release sends the clerk's free-text "Reason / approval reference" as beneficiaryBankRef (GrantDetailTables.tsx:77-80). Either the audit reason is lost or a non-bank string becomes the payee bank reference on a PFMS payment; there is no separate bank-ref input.
- **Verified evidence:** GrantDetailTables.tsx:77-80 POSTs {mode:"PFMS", beneficiaryBankRef: reason} where reason is the ActionButton's required free-text "Reason / approval reference" (line 75). Same payload in installments/InstallmentsTable.tsx:85-88. There is no bank-ref input and no separate reason field, so the audit reason is either lost or written into the payee bank reference.
- **Files to change:** `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`, `apps/web/src/app/(app)/grants/installments/InstallmentsTable.tsx`, `services/grant-service (disburse route, not in snapshot)`
- **Fix steps:**
  1. Confirm with grant-service the DisburseInstallment schema (fields for reason/approvalRef vs beneficiaryBankRef) - cannot be seen here.
  2. Stop sending the reason as beneficiaryBankRef; send it as a reason/approvalRef field (backend must add if absent and emit the audit event with it).
  3. If the payee bank ref is required, resolve it from the grantee master server-side, or add a separate validated input in the confirm dialog.
  4. Extract one shared postDisburse helper used by both tables so the payload lives in one place.
- **Acceptance:**
  - Test: onConfirm posts body without the reason in beneficiaryBankRef.
  - Backend contract test: audit event for disburse contains the reason.
  - Manual: release with reason 'Sanction 12/2026' and confirm PFMS payload bankRef is the grantee's account ref.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: PFMS payment payload; a wrong field mapping may misdirect or reject real disbursements - test in sandbox.
- **Depends on:** GAP-GRANTS-INSTALLMENTS-02

### GAP-GRANTS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM (was MONEY)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-B #2035: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Release is offered for any pending installment regardless of grant status (suspended/cancelled), installment order, or outstanding UC (GrantDetailTables.tsx:62); the dialog shows amount but not payee or masked account before an irreversible ₹ crore transfer.
- **Verified evidence:** Release is shown when row.status==="pending" only (GrantDetailTables.tsx:62); no check of grant.status (suspended/cancelled), installmentNo order, or outstanding UCs on the client. Dialog text (67-71) shows amount and mode but not grantee/payee or masked account (unlike InstallmentsTable.tsx:76-77 which names the grantee). Amounts go through formatMoney (paise) - no float math found, so the MONEY tag is wrong; this is a CONFIRM/guard issue. Server-side guards not verifiable.
- **Files to change:** `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`, `apps/web/src/app/(app)/grants/[id]/page.tsx`
- **Fix steps:**
  1. Pass grantStatus (and grantee name) from page.tsx into GrantInstallmentsTable.
  2. Show Release only when grantStatus is active and this is the lowest-numbered pending installment; otherwise render a disabled button with a title explaining why.
  3. Add payee name and masked account (if GrantDetail exposes it; else backend) to the confirmDescription.
  4. Warn (or block per policy) when the grant has UCs not verified.
- **Acceptance:**
  - Test: suspended grant -> Release disabled with reason text.
  - Test: installment #3 pending while #2 pending -> only #2 has enabled Release.
  - Manual: confirm dialog shows grantee name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: wrong sequencing rule could block valid out-of-order releases; get rule from grants policy owner.
- **Depends on:** GAP-GRANTS-DETAIL-01, GAP-GRANTS-DETAIL-03

### GAP-GRANTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Verify posts status "validated" (GrantDetailTables.tsx:123-126) while summary screens count "verified" (utilization/page.tsx:9); the two vocabularies coexist (line 106 tests both).
- **Verified evidence:** Verify posts status:"validated" to /utilization-certs/{id}/validate (GrantDetailTables.tsx:122-126) while utilization/page.tsx:9 counts status==="verified"; line 106 treats both as done. Whether the backend really returns 'validated' vs 'verified' cannot be checked (grant-service absent), so the summary count on /grants/utilization may undercount.
- **Files to change:** `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`, `apps/web/src/app/(app)/grants/utilization/page.tsx`, `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`
- **Fix steps:**
  1. Get the canonical UC status enum from grant-service/@civitasone/types and define one constant set (e.g. UC_VERIFIED_STATUSES).
  2. Use it in GrantUCsTable verifiable check and in utilization/page.tsx counts.
  3. Confirm what the validate endpoint expects for the approve case and post that.
- **Acceptance:**
  - Unit test: UC with status validated and one with verified both count as Verified on the utilization page.
  - Manual: verify a UC on the grant page, Verified stat on /grants/utilization increments.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; only display counts unless the endpoint enum is wrong.

### GAP-GRANTS-DETAIL-06  ·  LOW  ·  partly  ·  theme A11Y (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty action cells render aria-hidden "—" (GrantDetailTables.tsx:85,154), leaving the Action column unlabeled for screen readers; UC Period is a raw string and dates print dd/mm/yyyy (formatters.ts:2-7).
- **Verified evidence:** True: the empty-state cell is <span aria-hidden="true">—</span> (GrantDetailTables.tsx:85,154), so the Action cell has no accessible content; UC 'Period' column (line 99) prints the raw string. Overstated: formatIndianDate deliberately outputs dd/mm/yyyy (formatters.ts:1-7, comment cites GFR/PFMS mandate), so the date-format part is by design and the suggested 'dd Mon yyyy' would contradict it.
- **Files to change:** `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`
- **Fix steps:**
  1. Replace aria-hidden dash with <span className="sr-only">No action available</span> plus visible dash.
  2. Format UC period with a small helper if it is an ISO range; otherwise leave.
  3. Do not change date format unless the GFR rule is revised.
- **Acceptance:**
  - Screen-reader check: empty action cell announced as 'No action available'.
  - Snapshot test of UC period.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /grants/applications  —  `grants/applications.html`

- **Source:** `apps/web/src/app/(app)/grants/applications/page.tsx`
- **Design reference:** `redesign/grants/applications.html`

### GAP-GRANTS-APPLICATIONS-01  ·  HIGH  ·  partly  ·  theme WIRING (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** The "Applications" list is fed by GET /api/v1/grants/grants (_data.ts:161-167) and statuses active|completed|suspended|cancelled — i.e. sanctioned grants — yet every row links to /grants/applications/{id}, whose loader calls GET /api/v1/grants/applications/{id} (_data.ts:256-266) with statuses submitted|under_review|approved|rejected. A grant id is not an application id, so rows likely open "Page not found"; submitted applications awaiting review never appear in this list at all. Confirming needs grant-service (absent).
- **Verified evidence:** Confirmed structurally: apps/web/src/app/(app)/grants/_data.ts:161-167 getGrantApplications calls GET /api/v1/grants/grants (mapper keeps grantNo, totalAmount, statuses active|completed|suspended|cancelled) while ApplicationsTable.tsx rowLinkPrefix='/grants/applications/' + id opens page.tsx whose loader (_data.ts:256-266) calls /api/v1/grants/applications/<built-in function id>. Nothing in the web app loads a list of applications (grep). Whether a grant row id equals its application id, or the detail 404s, cannot be verified: grant-service absent. Note /grants/list already lists the same grants and links to /grants/<built-in function id>.
- **Files to change:** `apps/web/src/app/(app)/grants/_data.ts`, `apps/web/src/app/(app)/grants/applications/page.tsx`, `apps/web/src/app/(app)/grants/applications/ApplicationsTable.tsx`
- **Fix steps:**
  1. Ask grant-service for a list endpoint for applications (e.g. GET /v1/grants/applications) with statuses submitted|under_review|approved|rejected; do not assume it exists.
  2. If it exists: add getApplications loader + GrantApplicationRow mapper and use it here, with stat cards by application status (Submitted, Under review, Approved, Rejected).
  3. If not: rename page to 'Sanctioned Grants' or remove it and point the hub link to /grants/list; make rows link to /grants/{id} (grant detail).
  4. Update dashboard/RoleCommandCenter.tsx:70 'Pending applications' link accordingly.
- **Acceptance:**
  - Clicking any row opens a page that loads (no 'Page not found').
  - A submitted application appears in the list and can be approved from it.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Core review workflow is unreachable if wrong; verify against real data.
- **Depends on:** GAP-GRANTS-APPLICATIONS-03

### GAP-GRANTS-APPLICATIONS-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** The Filter ▾ button pushes ?status=active|completed|pending (FilterButton.tsx:48-53) but page.tsx never reads searchParams and "pending" is not a value of GrantApplicationSummary.status (_data.ts:48): choosing a filter changes the URL and nothing else, and there is no way to clear it.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/FilterButton.tsx builds ?status=active|completed|pending via router.push; applications/page.tsx takes no searchParams and ApplicationsTable does not read the URL. 'pending' is not in GrantApplicationSummary.status (_data.ts:48). No 'clear' item and the button does not show the active selection.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/FilterButton.tsx`, `apps/web/src/app/(app)/grants/applications/page.tsx`, `apps/web/src/app/(app)/grants/applications/ApplicationsTable.tsx`
- **Fix steps:**
  1. Make page.tsx accept searchParams.status, validate with zod enum matching the summary statuses, and filter before stats/table (or pass initial filter to ApplicationsTable).
  2. Change FilterButton options to the real statuses plus 'All' (deletes the param) and mark the active one (aria-checked).
  3. Or remove FilterButton since DataTable has filterable text search (status column searchable).
- **Acceptance:**
  - /grants/applications?status=completed lists only completed rows.
  - Choosing All removes the param; 'pending' no longer offered.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-APPLICATIONS-04

### GAP-GRANTS-APPLICATIONS-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch renders four zeros and the first-run "No grant applications yet — Applications will appear here once a grantee applies" (ApplicationsTable.tsx:71-76); the badge above is the only failure signal.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/page.tsx:7-13 on error data=[] so Total 0, Active 0, Completed 0 and formatMoney(0)='₹0.00' (StatCard shows real zeros, not '—'). ApplicationsTable.tsx:70-76 renders the first-run EmptyState when rows.length===0 regardless of error; only DataSourceBadge signals failure (if useSeededResource has cached rows it may show those with a stale badge). Compare grants/dashboard/page.tsx which handles this correctly.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/page.tsx`, `apps/web/src/app/(app)/grants/applications/ApplicationsTable.tsx`
- **Fix steps:**
  1. In page.tsx compute stats as null when source==='error' and pass '—' to StatCards (pattern in grants/dashboard/page.tsx:34-49).
  2. In ApplicationsTable, when source==='error' and rows are empty render <RefreshErrorState error={toHumanError('load',{area:'grant applications'})} /> instead of EmptyState (or LoadErrorState if status is passed).
  3. Pass status/errorMessage from loader result to support 403.
- **Acceptance:**
  - Gateway down: cards show '—' and table shows retry state, not 'No grant applications yet'.
  - Healthy empty list still shows first-run message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-02

### GAP-GRANTS-APPLICATIONS-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Filter menu is a hand-rolled div with hard-coded #fff / #e5e7eb (FilterButton.tsx:25-39): unreadable in dark mode, no arrow-key or Escape handling despite role="menu".
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/FilterButton.tsx menu div uses inline background '#fff', border '#e5e7eb' and a fixed shadow (dark mode leaves a white panel; items use ghost Button so text follows theme, giving light-on-white). It has role='menu'/menuitem but no Escape, arrow-key, outside-click or focus management. Theme FABRICATED is wrong (a11y/theming).
- **Files to change:** `apps/web/src/app/(app)/grants/applications/FilterButton.tsx`
- **Fix steps:**
  1. Replace hard-coded colours with tokens (var(--surface), var(--line)) or a shared ds/Menu/Select.
  2. Add onKeyDown for Escape (close, focus trigger), ArrowUp/Down roving focus, and outside-click close.
  3. Or replace with ds/Segmented / a <select> for status filter, which is natively accessible.
- **Acceptance:**
  - Dark mode: menu background follows theme with readable text.
  - Escape closes menu and returns focus; arrows move between items.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-APPLICATIONS-02

### GAP-GRANTS-APPLICATIONS-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Grantee "—" fallback and dates dd/mm/yyyy (ApplicationsTable.tsx:23,40; formatters.ts:2-7); "Purpose / Title" column heading covers the title only.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/ApplicationsTable.tsx:23 grantee '—' fallback and :40 formatIndianDate (dd/mm/yyyy) are accurate; the dd/mm/yyyy output is the documented GFR format (see GAP-GRANTS-APPLICATIONS-DETAIL-08). 'Purpose / Title' column shows only title (mapper takes title ?? purpose), a trivial label issue.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/grants/applications/ApplicationsTable.tsx`
- **Fix steps:**
  1. Follow the outcome of the DETAIL-08 date decision; no per-page change.
  2. Rename column label to 'Title'.
- **Acceptance:**
  - Column heading reads 'Title'.
  - Dates follow the global format.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-GRANTS-APPLICATIONS-DETAIL-08


---
## /grants/applications/[id]  —  `grants/applications-detail.html`

- **Source:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`
- **Design reference:** `redesign/grants/applications-detail.html`

### GAP-GRANTS-APPLICATIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** apps/web/src/app/(app)/grants/layout.tsx wraps only ModuleGate moduleKey='grants' (tenant enablement); no page under grants calls requireAnyRole/getSessionRoles (grep) and workRoles.ts has no grants role list. ApplicationActions.tsx shows Approve/Reject/Score based only on status (page.tsx:8-15, 28, 132). grant-service is absent so server enforcement cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/lib/auth/workRoles.ts`, `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`
- **Fix steps:**
  1. Define GRANTS_ROLES and GRANT_APPROVER_ROLES in workRoles.ts derived from grant-service route guards (verify in service).
  2. Add a role check in grants/layout.tsx following finance/layout.tsx (PermissionDenied, fail-open on empty roles).
  3. Pass canApprove/canReview booleans from page.tsx (getSessionRoles) to ApplicationActions and hide the buttons the caller lacks.
  4. Confirm grant-service returns 403 for other roles.
- **Acceptance:**
  - Role without grants permission opening /grants/applications/x sees PermissionDenied.
  - Reviewer without approver role sees no Approve/Reject button; API still 403s when called directly.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** UI-only gating is advisory; do not treat as the security boundary.

### GAP-GRANTS-APPLICATIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W2 PQ: closed by #2037)
- **W0 note:** partly fixed by #1865 — own-application maker block + explanatory text done, but Approve reason is still optional (ApproveApplicationDialog) so 'approve without a reason is blocked' is unmet
- **First-pass claim:** No maker-checker: the Approve/Reject buttons depend on status only (page.tsx:28-29,130-134). Nothing compares the viewer with submittedBy or reviewerRef, so a user can submit, score (as any reviewer string) and approve the same application.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/[id]/page.tsx:8-15,28 STATUS_ACTIONS depends only on status; :132 renders ApplicationActions unconditionally. No viewer identity is available (lib/auth/roleGuard.ts exposes roles/tenant/name, no user id) and reviewerRef is free text (ScoreApplicationDialog.tsx), so nothing compares viewer with submittedBy/reviewer. Approve (ApproveApplicationDialog.tsx) has no reason field, unlike Reject (ApplicationActions.tsx, minReasonLength 10). Server enforcement not verifiable.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/grants/applications/[id]/ApplicationActions.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/ApproveApplicationDialog.tsx`
- **Fix steps:**
  1. Add getSessionUserId() to roleGuard.ts (JWT sub) and pass viewerId to ApplicationActions.
  2. Hide/disable Approve, Reject and Score when viewerId equals application.submittedBy (or recorded reviewer) with an explanatory hint.
  3. Require a reason in the approve flow (reuse ConfirmDialog requireReason pattern) and add optional reason to ApproveApplicationRequest.
  4. Enforce maker!=checker in grant-service and return 403; ensure audit events.
- **Acceptance:**
  - Submitter opening own application sees Approve/Reject disabled with reason.
  - Direct PATCH /approve by submitter returns 403.
  - Approve without a reason is blocked.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval integrity for public money; server side is the real control.
- **Depends on:** GAP-GRANTS-APPLICATIONS-DETAIL-01

### GAP-GRANTS-APPLICATIONS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 closed by #1865; re-confirmed W2 grants part 1 — page uses LoadErrorState for non-404 errors, notFound() only for genuine 404)
- **First-pass claim:** Failed fetch shows "Page not found": getApplicationById returns null on error (_data.ts:256-266) and page.tsx:24-26 calls notFound(); the source==="error" badge (page.tsx:45) can never render with a record.
- **Verified evidence:** apps/web/src/app/(app)/grants/_data.ts:256-266 getApplicationById uses fetchJson with empty=null, so any failure returns data=null,source='error'; page.tsx:24-26 then calls notFound(). The badge at page.tsx:45 (`source==='error'`) is unreachable because application is non-null whenever it is evaluated.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`
- **Fix steps:**
  1. Keep the full result (data, source, status, errorMessage).
  2. If source==='error' && status!==404 render <LoadErrorState result={...} area='application' backHref='/grants/applications'/> (ds/LoadErrorState).
  3. Call notFound() only for 404 or a successful null.
  4. Delete the unreachable badge at :45.
- **Acceptance:**
  - Loader error 500 shows retry state; 403 shows PermissionDenied; 404 shows not-found page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-FINANCE-VENDORS-DETAIL-02

### GAP-GRANTS-APPLICATIONS-DETAIL-04  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 closed by #1865; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: requested amount and scheme range shown, range-checked in bigint, optional reason; the dialog is now ds/Modal)
- **First-pass claim:** Approve asks only for a free rupee amount with no context (ApproveApplicationDialog.tsx:47-77): requested amount and the scheme min/max are not shown or checked client-side, and there is no reason/remarks field. A sanction above the request or the scheme cap is one click.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/[id]/ApproveApplicationDialog.tsx:34-74 asks only for a rupee amount (converted via rupeesToMinorString, then Number(minor)); it shows no requested amount, no scheme min/max and no reason field, so the amount is unchecked client-side. The dialog does use rupeesToMinorString (no float multiplication), so the 'money' theme is only about context. GrantApplicationDetail has schemeId and GrantSchemeDetail (_data.ts) has min/maxAmountMinor, so data exists via getSchemeById, but the server may still validate (not verifiable).
- **Files to change:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/ApplicationActions.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/ApproveApplicationDialog.tsx`
- **Fix steps:**
  1. In page.tsx also call getSchemeById(application.schemeId) and pass requestedMinor, minMinor, maxMinor to ApplicationActions -> ApproveApplicationDialog.
  2. Show 'Requested ₹X; scheme range ₹min-₹max' with formatMoney and prefill amount with the requested value.
  3. Block or warn (require explicit second confirmation + reason) when amount > requested or outside min/max; compare in bigint/minor strings.
  4. Add reason field and send it if the API accepts it (confirm with grant-service validators).
- **Acceptance:**
  - Entering an amount above scheme max shows an inline error and blocks submit.
  - Dialog displays requested amount and scheme limits.
  - Valid amount submits amountApprovedMinor exactly in paise.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Sanction amounts; must also be validated server-side.
- **Depends on:** GAP-GRANTS-APPLICATIONS-DETAIL-02

### GAP-GRANTS-APPLICATIONS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme WIRING (was CONFIRM)

- [~] **Status** (NEEDS OWNER DECISION: reviewer picker requires a user-search endpoint from grant-service; safe interim is free-text ref with the existing hint label)
- **W0 note:** partly fixed by #1865 — scores/recommendation now shown, but reviewer is still a free-text ref in Assign and Score dialogs (no picker) and the page shows the raw ref, not the reviewer's name
- **First-pass claim:** Reviewer is a free-text "reference/ID" typed twice — on assign and again on score (ApplicationActions.tsx:100-110; ScoreApplicationDialog.tsx:75-82) — instead of a picker; scores are submitted but the page never displays technical/financial scores or the recommendation afterwards (page.tsx:77-127).
- **Verified evidence:** Reviewer ref is a free-text field in both ApplicationActions.tsx (assign ConfirmDialog with reasonLabel 'Reviewer reference') and ScoreApplicationDialog.tsx (reviewerRef input) - confirmed. Detail page (page.tsx:77-127) does not display scores, reviewer or recommendation - confirmed, though GrantApplicationDetail (_data.ts) has no such fields so the API/loader would need extending (cannot verify the payload). Theme CONFIRM is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/_data.ts`, `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/ApplicationActions.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/ScoreApplicationDialog.tsx`
- **Fix steps:**
  1. Confirm with grant-service whether GET /applications/:id returns reviewerRef, technicalScore, financialScore, recommendation; extend mapApplicationDetail and GrantApplicationDetail.
  2. Replace the assign free-text with an EntityPicker/user lookup and store reviewerRef; in ScoreApplicationDialog, prefill/lock reviewer to the assigned one or the session user.
  3. Add an 'Evaluation' Card in page.tsx showing scores and recommendation.
- **Acceptance:**
  - Assign dialog uses a picker and sends a valid user ref.
  - After scoring, page shows technical/financial scores and the reviewer's name.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-GRANTS-APPLICATIONS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 PQ: closed by #PRNUM)
- **W0 note:** partly fixed by #1865 — scheme and grantee names now resolved and application uuid removed, but submitter/approver are no longer shown at all (no names)
- **First-pass claim:** Raw ids in the UI: Application ID uuid (page.tsx:81) and Submitted By / Approved By print whatever the API returns (page.tsx:109,118), likely user uuids, not names.
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/[id]/page.tsx:81 prints application.id (monospace uuid), :109 submittedBy and :118 approvedBy verbatim from mapApplicationDetail (_data.ts) which only text-normalises them. Whether these are uuids or names depends on grant-service (not verifiable); the type comment says user refs. beneficiaryId and schemeId are fetched but not shown at all.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`, `apps/web/src/app/(app)/grants/_data.ts`
- **Fix steps:**
  1. Show Grant No/Scheme name (resolve via getSchemeById) and grantee name (via beneficiary lookup) instead of the uuid; keep application id as a small copyable field only if support needs it.
  2. Resolve submittedBy/approvedBy to display names via a user lookup helper (or have backend return names).
  3. Fall back to '—' when unresolved, never the raw uuid.
- **Acceptance:**
  - Detail page shows names for submitter/approver and the scheme.
  - No uuid visible in main fields.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-GRANTS-APPLICATIONS-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** STATUS_ACTIONS covers six statuses (page.tsx:8-15); any other status (e.g. withdrawn, routing_failed) silently yields no actions and no explanation, and a draft can only be withdrawn, never submitted. "View / Schedule Installments" links ?appId= which /grants/installments ignores (page.tsx:141-146).
- **Verified evidence:** apps/web/src/app/(app)/grants/applications/[id]/page.tsx:8-15 STATUS_ACTIONS has six keys; `STATUS_ACTIONS[status] ?? []` (:28) gives no actions and no message for any other status (mapApplicationDetail maps unknown to raw text). Draft only has 'withdraw' - no submit action exists in lib/grants/application.ts. :142 links /grants/installments?appId=... and installments/page.tsx does not read searchParams (grep: no appId). Whether withdrawn/routing_failed exist as statuses is not verifiable.
- **Files to change:** `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`, `apps/web/src/app/(app)/grants/installments/page.tsx`, `apps/web/src/lib/grants/application.ts`
- **Fix steps:**
  1. Show a muted note 'No actions available for status X' when actions is empty and status is not terminal.
  2. Add a submit action if grant-service exposes PATCH /submit (verify), else say drafts are submitted by the grantee.
  3. Make installments/page.tsx read searchParams.appId and filter installments (or remove the query string and link plainly).
  4. Use next/link instead of <a> at :141.
- **Acceptance:**
  - Unknown status shows explanatory text.
  - /grants/installments?appId=X lists only that application's installments.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-GRANTS-APPLICATIONS-DETAIL-08  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1653, verified on main 9c5e9e9e9)
- **First-pass claim:** formatIndianDate prints dd/mm/yyyy via toLocaleDateString("en-IN", {day:"2-digit", month:"2-digit", year:"numeric"}) (lib/formatters.ts:2-7); the design convention is "28 Sep 2026" so a 03/10/2026 style date is ambiguous in a mixed-locale office.
- **Verified evidence:** lib/formatters.ts:2-7 formatIndianDate does output dd/mm/yyyy via toLocaleDateString('en-IN'), and its docblock says this is the GFR 2017/PFMS mandated format, so the code follows a documented rule; the 'dd Mon yyyy' convention is a design choice that conflicts with it (decision needed). Real defects: no timeZone option (uses server/browser tz, not IST) and new Date on date-only strings can shift a day.
- **Files to change:** `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Decide with design/compliance between dd/mm/yyyy and dd Mon yyyy.
  2. If changed, edit formatIndianDate once (e.g. {day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}) so all pages follow; update snapshot tests.
  3. Add timeZone:'Asia/Kolkata' regardless, and parse date-only strings as UTC.
- **Acceptance:**
  - formatIndianDate('2026-09-28T20:00:00Z') renders 29 Sep / 29/09/2026 consistently on server and client.
  - Existing callers unchanged apart from format.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Global change touches every page and tests.


---
## /grants/dashboard  —  `grants/dashboard.html`

- **Source:** `apps/web/src/app/(app)/grants/dashboard/page.tsx`
- **Design reference:** `redesign/grants/dashboard.html`

### GAP-GRANTS-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme MONEY (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "Sanctioned (FY)" is the sum of totalAmount over every grant ever returned (page.tsx:37) — there is no financial-year filter, so the label misstates the figure; "Disbursed" comes from a different endpoint (page.tsx:49), so the two cards can disagree with the table beneath them.
- **Verified evidence:** apps/web/src/app/(app)/grants/dashboard/page.tsx:37 sanctionedTotal = sum of totalAmount across all rows of getGrants() (GET /api/v1/grants/grants), no FY filter, but the card at :48 says 'Sanctioned (FY)'. 'Disbursed' at :49 uses data.disbursedAmount from getGrantsDashboard() (/api/v1/grants/dashboard) - a different endpoint, while the table shows per-row disbursedAmount from /grants/grants, so totals can disagree. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/dashboard/page.tsx`
- **Fix steps:**
  1. Relabel the card 'Total Sanctioned' unless a fiscal-year field is available; if the API has sanctionDate, filter by the current FY (Apr-Mar IST) and keep the label.
  2. Compute Disbursed from the same grants rows (sum disbursedAmount) or label it as 'Disbursed (dashboard)' and document the source; ask backend whether the two must reconcile.
  3. Add a test comparing card totals with table rows.
- **Acceptance:**
  - With grants [₹10, ₹20 sanctioned], card shows ₹30.00 and label matches basis.
  - Disbursed card equals the sum of the table's Disbursed column.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Finance-facing totals; confirm definition with product.

### GAP-GRANTS-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** The hub promises "KPIs and fund utilisation" (grants/page.tsx:12) but the page has no utilisation measure or chart — only four counts/totals; totalGrants and totalGrantees are fetched (loaders.ts:3533-3538) yet never rendered (page.tsx:32-51).
- **Verified evidence:** apps/web/src/app/(app)/grants/page.tsx:12 hub note says 'Grants overview — KPIs and fund utilisation'; apps/web/src/app/(app)/grants/dashboard/page.tsx:46-51 shows only Active Grants, Sanctioned, Disbursed, UC Pending, with no utilisation measure or chart. getGrantsDashboard (loaders.ts:3533-3538) returns totalGrants and totalGrantees (GRANTS_DASHBOARD_EMPTY) that are never rendered. Tagged DEADROUTE is wrong (copy/feature gap).
- **Files to change:** `apps/web/src/app/(app)/grants/dashboard/page.tsx`, `apps/web/src/app/(app)/grants/page.tsx`
- **Fix steps:**
  1. Add StatCards for Total Grants and Grantees from data.totalGrants/totalGrantees.
  2. Add a utilisation measure (disbursed/sanctioned via formatPercent, showing '—' when sanctioned is 0) with a ProgressBar, or reword the hub note to what exists.
  3. Link UC Pending to /grants/utilization.
- **Acceptance:**
  - Dashboard shows Total Grants and Grantees values from the API.
  - Hub description matches dashboard contents.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-DASHBOARD-04

### GAP-GRANTS-DASHBOARD-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was FABRICATED)

- [x] **Status** (W2 PQ: already fixed on main — DashboardGrantsTable.tsx uses useSeededResource; closed by #PRNUM)
- **W0 note:** partly fixed by #1865 — table now uses useSeededResource but dashboard/page.tsx renders RefreshErrorState instead of DashboardGrantsTable whenever either loader errors, so an offline reload never shows the cached rows/badge
- **First-pass claim:** Unlike its siblings, the table is a server-rendered DataTable with no useSeededResource (page.tsx:62-71), so offline/cached fallback and the provenance badge behave differently on this one screen.
- **Verified evidence:** apps/web/src/app/(app)/grants/dashboard/page.tsx:62-71 renders a server DataTable directly, whereas every sibling (list/GrantsTable.tsx, schemes, releases, installments, applications) uses useSeededResource in a client table. So offline/cached fallback and provenance badge differ - true. But this is inconsistency, not fabricated data; and on error the page shows RefreshErrorState with DataSourceBadge, which is better than most siblings. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/dashboard/page.tsx`, `apps/web/src/app/(app)/grants/dashboard/DashboardGrantsTable.tsx (new)`
- **Fix steps:**
  1. Extract a client DashboardGrantsTable.tsx mirroring list/GrantsTable.tsx (useSeededResource key 'grants.list' + DataSourceBadge).
  2. Keep the error branch (RefreshErrorState) for no-cache failures; show stale badge when cached rows are used.
  3. Alternatively reuse GrantsTable from list/ with a pageSize prop.
- **Acceptance:**
  - Offline reload shows cached grants with a 'cached' badge, matching /grants/list.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-GRANTS-DASHBOARD-04  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No back link or breadcrumb (PageHeader without back, page.tsx:41-44) and StatCards are not links (UC Pending does not lead to /grants/utilization).
- **Verified evidence:** apps/web/src/app/(app)/grants/dashboard/page.tsx:41-44 PageHeader has no back/backLabel (other grants pages pass back='/grants'), and StatCard (ds/StatCard.tsx props: icon, iconBg, label, value, delta, up) has no href prop, so UC Pending cannot link to /grants/utilization.
- **Files to change:** `apps/web/src/app/(app)/grants/dashboard/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Add back='/grants' backLabel='Grants' to PageHeader.
  2. Add optional href to StatCard (wrap in next/link with focus ring) and set UC Pending -> /grants/utilization, Active Grants -> /grants/list.
  3. Keep the title as is (JSX decodes &amp; in attributes).
- **Acceptance:**
  - Back link visible and works.
  - Clicking UC Pending card navigates to /grants/utilization; keyboard focusable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; StatCard change is shared across the app, keep prop optional.
- **Depends on:** GAP-GRANTS-DASHBOARD-02


---
## /grants/disbursements/[id]  —  `grants/disbursements-detail.html`

- **Source:** `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`
- **Design reference:** `redesign/grants/disbursements-detail.html`

### GAP-GRANTS-DISBURSEMENTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** grants/layout.tsx:5 only wraps <ModuleGate moduleKey="grants">; a repo-wide check shows no grants file imports requireAnyRole, whereas crm/layout.tsx:2-9 does (helper is apps/web/src/lib/auth/roleGuard.ts). Route also exposes RaiseEOfficeNote (disbursement approval raise) to any module user. Backend enforcement not verifiable: only hrms-service exists in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`, `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/lib/auth/grantsRoles.ts`
- **Fix steps:**
  1. Apply layout-level requireAnyRole as in GAP-GRANTS-DETAIL-01.
  2. In disbursements/[id]/page.tsx render <RaiseEOfficeNote> only for GRANTS_MAKER_ROLES.
  3. Verify eOffice /estab/files/from-module enforces caller roles.
- **Acceptance:**
  - Unit test: a session without a maker role renders the table with no Release/Verify/Reject/Approve buttons.
  - Manual: a user with only a viewer role opening the route sees read-only data; a user with no grants role is redirected/forbidden by layout.
  - Manual: maker role still sees the buttons and can complete an action.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Approval workflow initiation; wrong role list blocks officers.
- **Depends on:** GAP-GRANTS-DETAIL-01

### GAP-GRANTS-DISBURSEMENTS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 PQ: closed by #2035)
- **W0 note:** partly fixed by #1840 — UUID text inputs replaced by EmployeePicker name search (initiator defaults to signed-in employee), but initiatedBy is still user-selectable and not derived from the session, so a file can still be raised in another officer's name
- **First-pass claim:** RaiseEOfficeNote asks the clerk to type "Initiating officer ID" and "Forward to officer ID" as employee UUIDs (RaiseEOfficeNote.tsx: UUID_RE checks, placeholders "employee UUID"/"approver UUID"). Clerks cannot know UUIDs, and the initiator is not the signed-in user, so a file can be raised in someone else's name.
- **Verified evidence:** RaiseEOfficeNote.tsx:71-72,102-103,175,179: two free-text inputs 'Initiating officer ID' and 'Forward to officer ID' with placeholders 'employee UUID'/'approver UUID', validated only by UUID_RE (line 25). initiatedBy is user-typed, never derived from the session, so a file can be raised in another officer's name. Component is shared (used by other modules too).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`
- **Fix steps:**
  1. Drop the initiatedBy input; have the server (from-module route/BFF) take the initiator from the authenticated session, or prefill it read-only from the session employee id.
  2. Replace 'Forward to' input with an employee/approver picker (an EntityPicker over the employees search endpoint - create one if none exists), storing the id but showing name + designation.
  3. Optionally omit currentWith and let the approval-matrix route it, as the helper text already claims.
  4. Keep zod validation of the payload at the estab route.
- **Acceptance:**
  - Component test: no UUID text inputs rendered; submit sends initiatedBy from session.
  - Manual: cannot raise an eFile with a different initiator; approver chosen by name.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: shared by many modules and affects approval attribution/audit; regression-test every caller.

### GAP-GRANTS-DISBURSEMENTS-DETAIL-04  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads "Disbursement not found … ID is invalid": getGrantDisbursementById scans the releases list which is [] on error (loaders.ts:3591-3596), so page.tsx:10-20 shows not-found; the error badge exists only in the found branch (page.tsx:39).
- **Verified evidence:** getGrantDisbursementById (loaders.ts ~3590-3596) calls getGrantReleases, whose fallback is [] on error, then find() -> null with source "error". page.tsx:10-20 renders EmptyState 'Disbursement not found ... ID is invalid' for that; the error badge at page.tsx:39 is only in the found branch.
- **Files to change:** `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`
- **Fix steps:**
  1. In the !disbursement branch, if source==="error" render <RefreshErrorState error={toHumanError("load",{area:"disbursement"})} backHref="/grants/releases" />.
  2. Keep the EmptyState only for source==="api".
  3. Note also the list may be paginated/truncated - a valid id absent from page 1 shows as not-found; use a by-id endpoint when backend adds one.
- **Acceptance:**
  - Test: {data:null,source:'error'} shows retry state.
  - Test: {data:null,source:'api'} shows not found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-DISBURSEMENTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-B #2035: closed by #1804, verified on main 9c5e9e9e9)
- **First-pass claim:** Closing the loop is best-effort: the POST to …/disbursements/{id}/submit-approval is wrapped in try/catch and swallowed (RaiseEOfficeNote.tsx notifyPath block), so the eFile can exist while the disbursement never moves to "pending approval"; the loader comment says grant-service exposes no by-id read, so this route is unverified.
- **Verified evidence:** RaiseEOfficeNote.tsx:123-129 awaits fetch(notifyPath) inside try/catch that ignores errors and does not even check res.ok, then shows success (line 130). If submit-approval fails the eFile exists but the disbursement never goes pending-approval. loaders.ts comment confirms grant-service has no by-id read; existence of the submit-approval route cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`
- **Fix steps:**
  1. Check res.ok on the notify call; on failure show a warning message ('eFile raised, but status update failed - retry') with a Retry button.
  2. Prefer moving the state change to the eOffice decision callback / server-side saga so it is not client best-effort.
  3. Confirm route existence with grant-service owner.
- **Acceptance:**
  - Test: notify returns 500 -> UI shows warning, not plain success.
  - Manual: file raised and disbursement status changes to pending approval.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: inconsistent state between eOffice and grants; approvals may be missed.

### GAP-GRANTS-DISBURSEMENTS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1804, verified on main 9c5e9e9e9)
- **First-pass claim:** Raise errors print the raw response body: throw new Error(await res.text()) (RaiseEOfficeNote.tsx) is shown verbatim, bypassing the toHumanError policy used elsewhere in the module.
- **Verified evidence:** RaiseEOfficeNote.tsx:119 throws new Error((await res.text()) || ...) and line 135 sets it into error state rendered at line 163 - raw gateway body (possibly JSON/stack) shown. Line 81 (status load) does the same but is swallowed. Other grants tables use toHumanError (e.g. InstallmentsTable.tsx:27-30).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`
- **Fix steps:**
  1. Use toHumanError("save",{area:"eOffice file"}) (or useFormError) and show what+next.
  2. Log the raw body via the existing telemetry helper, not to the UI.
  3. Map 403/409 to specific catalogued messages if present.
- **Acceptance:**
  - Test: 500 with body '{"stack":...}' shows catalogued message only.
  - Manual: forced error shows plain-language text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component, check other module tests that assert on raw text.

### GAP-GRANTS-DISBURSEMENTS-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Unreachable from the UI: releases rows have no link (ReleasesTable.tsx:105), so this detail page and its approval note can only be reached by typing a URL.
- **Verified evidence:** ReleasesTable.tsx:105 renders <DataTable ... /> without rowLinkPrefix (DataTable supports it, ds/DataTable.tsx:57-59); grep for 'grants/disbursements' outside the route's own folder finds no link. Only /grants/releases back link points the other way.
- **Files to change:** `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Add rowLinkPrefix="/grants/disbursements/" and rowLinkKey="id" to the DataTable in ReleasesTable (first column releaseNo becomes the link).
  2. Confirm the release id equals the disbursement id (loader comment says so).
- **Acceptance:**
  - Manual: click a release number, land on the disbursement detail.
  - Test: first column renders an anchor with the right href.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-GRANTS-DISBURSEMENTS-DETAIL-08  ·  LOW  ·  partly  ·  theme MONEY (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Amount, Grantee, Release Date and Status appear twice (stat cards and details card, page.tsx:44-62); subtitle logic compares against a magic "—" string (page.tsx:34); dates dd/mm/yyyy.
- **Verified evidence:** Confirmed: Amount/Grantee/Release Date/Status shown in stat cards (page.tsx:45-48) and again in details card (54-58); magic string compare `granteeName !== "—"` at line 34. Dates use the GFR dd/mm/yyyy formatter by design. Additional real issue: line 24 does Math.round(disbursement.amount*100) treating amount as rupees, but ReleasesTable.tsx:55 formats the same field with formatMoney directly (as paise) - the two screens show different amounts for one release, and float multiply violates the paise rule.
- **Files to change:** `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`, `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Establish the unit of GrantRelease.amount from grant-service (paise per CLAUDE.md) and normalise it once in the loader mapper; remove Math.round(x*100).
  2. Remove the duplicated fields from either the stat cards or the details card.
  3. Make granteeName nullable in the type and test `!= null` instead of the '—' sentinel.
- **Acceptance:**
  - Test: same release shows identical amount on /grants/releases and detail.
  - No 'x*100' left in page.tsx (grep).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: money display unit; confirm with backend before changing.


---
## /grants/grantees  —  `grants/grantees.html`

- **Source:** `apps/web/src/app/(app)/grants/grantees/page.tsx`
- **Design reference:** `redesign/grants/grantees.html`

### GAP-GRANTS-GRANTEES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch is indistinguishable from an empty registry: loader returns [] (loaders.ts:3567-3573), so stats read 0 / 0 / 0 / 0.0% (page.tsx:11-16) and the table says "No records found"; only a small badge inside the table warns.
- **Verified evidence:** getGrantees (loaders.ts ~3566-3573) falls back to [] with source "error"; page.tsx:11-16 computes 0/0/0/0.0% and StatCards render them (30-33); source is passed only to GranteesTable (36) where a DataSourceBadge appears (GranteesTable.tsx:42); DataTable shows its empty state.
- **Files to change:** `apps/web/src/app/(app)/grants/grantees/page.tsx`, `apps/web/src/app/(app)/grants/grantees/GranteesTable.tsx`
- **Fix steps:**
  1. In page.tsx if source==="error" && grantees.length===0 render <RefreshErrorState error={toHumanError("load",{area:"grantees"})} backHref="/grants" /> instead of stats+table.
  2. When data present but source error, show "—" in StatCards.
  3. Only compute avgCompliance when rows exist.
- **Acceptance:**
  - Test: error+empty shows retry state, no stat cards.
  - Test: api+empty shows zero stats and empty table.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; interplay with useSeededResource offline cache - keep cached rows when available.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-GRANTEES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "UC Compliance" headline is an unweighted mean of ucCompliancePct over all rows, including grantees with nothing yet due (a new individual at 0.0%) and an empty registry that reads 0.0% (page.tsx:13-16,33) — it misleads more than it informs.
- **Verified evidence:** page.tsx:13-16: unweighted mean of g.ucCompliancePct over all rows, 0 when empty, printed with toFixed(1) (line 33). Includes grantees with no UCs due. Whether ucCompliancePct is null/0 for 'nothing due' cannot be seen (types package absent).
- **Files to change:** `apps/web/src/app/(app)/grants/grantees/page.tsx`
- **Fix steps:**
  1. Ask backend for a portfolio-level compliance (UCs verified on time / UCs due) or exclude grantees with no UC due.
  2. Show '—' when no grantee has UCs due or registry is empty.
  3. Rename the card to 'Avg UC compliance' if unweighted stays.
- **Acceptance:**
  - Test: empty registry shows '—'.
  - Test: grantee with nothing due excluded from mean.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; KPI semantics change - confirm with grants owner.

### GAP-GRANTS-GRANTEES-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "NGOs" counts type "society" or "mission" (page.tsx:11) — a "mission" (e.g. a government Smart City Mission) is not an NGO/Trust; the comment at page.tsx:9-10 admits the mapping is a workaround (DOM-022).
- **Verified evidence:** page.tsx:9-11 counts type society||mission as NGOs; comment cites DOM-022 constraint allowing individual/institution/society/mission only. A mission is not an NGO, so the card mislabels.
- **Files to change:** `apps/web/src/app/(app)/grants/grantees/page.tsx`
- **Fix steps:**
  1. Rename card to 'Societies & missions' (or split by type) using a type->label map.
  2. Longer term: add ngo/trust type in backend constraint (DOM-022).
- **Acceptance:**
  - Manual: card label matches counted types.
  - Test: one mission + one society -> count 2 under the renamed label.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-GRANTS-GRANTEES-04  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 re-confirmed W1 SF-02/03 (#2010): closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Grantee rows are not links (GranteesTable.tsx:43 has no rowLinkPrefix) and there is no grantee detail route, so the compliance figure cannot be traced to the UCs behind it; individual beneficiaries appear by name with no masking or role gate (DPDP).
- **Verified evidence:** True: GranteesTable.tsx:43 passes no rowLinkPrefix and no grantee detail route exists under grants/ (directory listing). Individuals appear by name/code/registrationNo with no masking; role gating absent (see ROLEGATE). Unverifiable: which fields the API returns and whether registrationNo is PAN/Aadhaar-like.
- **Files to change:** `apps/web/src/app/(app)/grants/grantees/GranteesTable.tsx`, `apps/web/src/app/(app)/grants/grantees/[id]/page.tsx (new)`, `apps/web/src/app/(app)/grants/layout.tsx`
- **Fix steps:**
  1. Decide DPDP treatment with security owner: mask registrationNo/individual names by type via shared <Masked> with role-based reveal + audit event.
  2. Restrict page to grants roles (layout guard, see GAP-GRANTS-DETAIL-01).
  3. Add grantee detail route listing grants and UCs, then set rowLinkPrefix="/grants/grantees/" on the DataTable (needs backend by-id read).
- **Acceptance:**
  - Manual: non-privileged role sees masked registration number.
  - Test: rows link to detail once route exists.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Medium: PII exposure; new route needs backend endpoint.
- **Depends on:** GAP-GRANTS-DETAIL-01

### GAP-GRANTS-GRANTEES-05  ·  LOW  ·  confirmed  ·  theme LOADING (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** loading.tsx draws no stat blocks (loading.tsx:4-9) although four StatCards render; the type pill prints the raw enum uppercased (GranteesTable.tsx:20).
- **Verified evidence:** grantees/loading.tsx:4-9 has title bar and one 80-high block, no stat grid, while page renders four StatCards. GranteesTable.tsx:20 shows StatusPill label=row.type.toUpperCase() (raw enum e.g. SOCIETY).
- **Files to change:** `apps/web/src/app/(app)/grants/grantees/loading.tsx`, `apps/web/src/app/(app)/grants/grantees/GranteesTable.tsx`
- **Fix steps:**
  1. Add the 4-tile grid skeleton as in installments/loading.tsx.
  2. Replace toUpperCase with a GRANTEE_TYPE_LABELS map ('Individual','Institution','Society','Mission') and ensure StatusPill has tones for those.
- **Acceptance:**
  - Visual: skeleton matches page layout.
  - Test: type cell shows 'Society'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Negligible.


---
## /grants/installments  —  `grants/installments.html`

- **Source:** `apps/web/src/app/(app)/grants/installments/page.tsx`
- **Design reference:** `redesign/grants/installments.html`

### GAP-GRANTS-INSTALLMENTS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-B #2035: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** grants/layout.tsx:5 only wraps <ModuleGate moduleKey="grants">; a repo-wide check shows no grants file imports requireAnyRole, whereas crm/layout.tsx:2-9 does (helper is apps/web/src/lib/auth/roleGuard.ts). Release button at InstallmentsTable.tsx:70 appears for every viewer. Backend enforcement not verifiable: only hrms-service exists in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/installments/page.tsx`, `apps/web/src/app/(app)/grants/installments/InstallmentsTable.tsx`, `apps/web/src/lib/auth/grantsRoles.ts`
- **Fix steps:**
  1. Decide role sets with product owner (e.g. GRANTS_VIEW_ROLES, GRANTS_MAKER_ROLES, GRANTS_CHECKER_ROLES, plus platform_admin/super_admin) and put them in a shared constant such as apps/web/src/lib/auth/grantsRoles.ts.
  2. In grants/layout.tsx call requireAnyRole(GRANTS_VIEW_ROLES) from @/lib/auth/roleGuard before <ModuleGate>, mirroring crm/layout.tsx.
  3. Read the session roles on the server in the page and pass a canRelease/canVerify boolean prop to the client tables; render the ActionButton only when true (else render nothing, not an aria-hidden dash).
  4. Confirm the grant-service enforces the same roles on /disburse, /validate, /approve; UI gating is convenience only.
- **Acceptance:**
  - Unit test: a session without a maker role renders the table with no Release/Verify/Reject/Approve buttons.
  - Manual: a user with only a viewer role opening the route sees read-only data; a user with no grants role is redirected/forbidden by layout.
  - Manual: maker role still sees the buttons and can complete an action.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible PFMS transfer available to all module users in UI.
- **Depends on:** GAP-GRANTS-DETAIL-01

### GAP-GRANTS-INSTALLMENTS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Release posts the required free-text "Reason / approval reference" as beneficiaryBankRef (InstallmentsTable.tsx:85-88): the approval reason is not stored as a reason and an arbitrary sentence lands in a bank-reference field on a PFMS payment.
- **Verified evidence:** InstallmentsTable.tsx:85-88 posts {mode:"PFMS", beneficiaryBankRef: reason}; reason is the required free-text at line 83. Same defect as GAP-GRANTS-DETAIL-03.
- **Files to change:** `apps/web/src/app/(app)/grants/installments/InstallmentsTable.tsx`, `apps/web/src/app/(app)/grants/[id]/GrantDetailTables.tsx`, `services/grant-service (not in snapshot)`
- **Fix steps:**
  1. Share the fix with GAP-GRANTS-DETAIL-03: send reason as a reason/approvalRef field, not beneficiaryBankRef.
  2. Extract a shared disburseInstallment client helper.
  3. Add backend field + audit event if missing.
- **Acceptance:**
  - Test: request body has no beneficiaryBankRef equal to the reason.
  - Backend contract test for reason in audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: PFMS payment payload.
- **Depends on:** GAP-GRANTS-DETAIL-03

### GAP-GRANTS-INSTALLMENTS-03  ·  HIGH  ·  partly  ·  theme CONFIRM

- [~] **Status** (NEEDS OWNER DECISION: grantStatus field absent from GrantInstallmentSummary type; sequence check done (GAP-GRANTS-INSTALLMENTS-01/02), suspended-grant guard needs backend to add grantStatus to the installments list endpoint)
- **W0 note:** partly fixed by #1865 — out-of-sequence block and grantee name in dialog done, but no client check of grant status (suspended grant row still releasable) and dialog does not show the masked payee account
- **First-pass claim:** Release is offered for every row with status "pending" (InstallmentsTable.tsx:69) irrespective of grant status (suspended/cancelled), installment sequence (#3 can be released before #2) or outstanding UC, and the dialog does not show the payee account; the irreversible transfer is one reason-string away.
- **Verified evidence:** Confirmed: Release shown for every status==="pending" row (InstallmentsTable.tsx:69) with no client check of grant status, sequence, or UC. Correction: the dialog does name the payee (grantee name, lines 76-77) but not the account; reason is mandatory (requireReason, line 82) and a ConfirmDialog already exists via ActionButton. Maker!=checker is not applicable client-side (single-step release); server-side rules not verifiable. Whether GrantInstallmentSummary carries grant status cannot be seen (types package absent).
- **Files to change:** `apps/web/src/app/(app)/grants/installments/InstallmentsTable.tsx`, `apps/web/src/app/(app)/grants/installments/page.tsx`, `services/grant-service (guards)`
- **Fix steps:**
  1. Have the loader/API include grantStatus and pending-UC count per installment (backend if absent).
  2. Show Release only for the lowest pending installment of an active grant; otherwise disabled with reason tooltip.
  3. Add masked account/IFSC last-4 to the confirm text.
  4. Backend must reject out-of-order or suspended-grant releases and emit audit event.
- **Acceptance:**
  - Test: suspended grant row has no enabled Release.
  - Test: #3 not releasable while #2 pending.
  - Manual: dialog shows grantee + masked account.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: business rule on fund release; confirm policy first.
- **Depends on:** GAP-GRANTS-INSTALLMENTS-01, GAP-GRANTS-INSTALLMENTS-02

### GAP-GRANTS-INSTALLMENTS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Applications detail links "View / Schedule Installments" to /grants/installments?appId=… (applications/[id]/page.tsx:141-146) but this page never reads searchParams (page.tsx:7-8) and has no scheduling control — the CTA lands on the unfiltered global list.
- **Verified evidence:** applications/[id]/page.tsx:141-146 links to /grants/installments?appId=<id> under a 'Schedule Installments' label; installments/page.tsx:7 takes no props/searchParams and calls getGrantInstallments() unfiltered; the page has no scheduling control. Since the applications list is fed by /grants/grants, appId is effectively a grant id; whether GrantInstallmentSummary exposes a grant id for filtering cannot be seen.
- **Files to change:** `apps/web/src/app/(app)/grants/installments/page.tsx`, `apps/web/src/app/(app)/grants/applications/[id]/page.tsx`
- **Fix steps:**
  1. Accept searchParams.appId in installments/page.tsx and filter rows by grant/application id (or pass to API query if supported).
  2. Show a 'Filtered to X - clear' chip.
  3. Rename CTA to 'View installments' unless a schedule creation form is built.
- **Acceptance:**
  - Test: /grants/installments?appId=X lists only that grant's installments.
  - Manual: CTA lands on filtered list.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-HOME-02

### GAP-GRANTS-INSTALLMENTS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch renders Total 0 / Released 0 / Pending 0 / ₹0.00 and "No records found" (loaders.ts:3606-3612, page.tsx:9-12); only the in-table badge hints at failure.
- **Verified evidence:** getGrantInstallments (loaders.ts ~3606-3612) returns [] with source "error"; page.tsx:9-12 yields 0/0/0 and formatMoney(0) -> "₹0.00"; only DataSourceBadge inside InstallmentsTable (line 105) signals it.
- **Files to change:** `apps/web/src/app/(app)/grants/installments/page.tsx`
- **Fix steps:**
  1. If source==="error" && empty render <RefreshErrorState error={toHumanError("load",{area:"installments"})} backHref="/grants" />.
  2. Otherwise show '—' in stat values when source is error.
- **Acceptance:**
  - Test: error source shows retry state.
  - Test: api empty shows zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-INSTALLMENTS-06  ·  LOW  ·  partly  ·  theme STATUS (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "Released" stat merges released and utilized (page.tsx:9) and the status filter is free-text only; dates print dd/mm/yyyy (formatters.ts:2-7).
- **Verified evidence:** Confirmed: 'Released' merges released and utilized (page.tsx:9); DataTable filter is free-text (filterable prop, InstallmentsTable.tsx:106). The dd/mm/yyyy point is by design (formatters.ts:1-7 GFR mandate) so the date part and the DATEFMT tag are wrong. Also totalAmount uses plain number reduce on paise (page.tsx:11), which risks exceeding safe-integer for large sums.
- **Files to change:** `apps/web/src/app/(app)/grants/installments/page.tsx`, `apps/web/src/app/(app)/grants/installments/InstallmentsTable.tsx`
- **Fix steps:**
  1. Split Released and Utilized stats or label 'Released / utilised'.
  2. Add a status select filter (pending/released/utilized/cancelled).
  3. Sum amounts as BigInt in page.tsx and pass the string to formatMoney.
- **Acceptance:**
  - Test: released stat matches label.
  - Test: sum of two 9e15 paise amounts formats correctly.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /grants/list  —  `grants/list.html`

- **Source:** `apps/web/src/app/(app)/grants/list/page.tsx`
- **Design reference:** `redesign/grants/list.html`

### GAP-GRANTS-LIST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch looks like "no grants": loader returns [] (loaders.ts:3549-3555) so page.tsx:9-11 renders Total 0 / Active 0 / ₹0.00 / ₹0.00 and the table empty; the only signal is a small amber badge inside the table (GrantsTable.tsx:44), and the stats are computed on the server from the un-cached rows while the table may show cached rows — the two can disagree.
- **Verified evidence:** loaders.ts:3549-3555 getGrants passes fallback [] to fetchJson; list/page.tsx:8-11 computes Total/Active/Sanctioned/Disbursed from that array and never reads `source` for anything but the prop, so a failure renders 0 / 0 / ₹0.00 / ₹0.00 (StatCard at page.tsx:25-28). GrantsTable.tsx:30-35,44 uses useSeededResource, which on error falls back to a cached copy (resource.ts:236-247) while the stat cards stay at zero, so cards and table can disagree. The only failure signal is DataSourceBadge (amber pill) inside the table.
- **Files to change:** `apps/web/src/app/(app)/grants/list/page.tsx`, `apps/web/src/app/(app)/grants/list/GrantsTable.tsx`
- **Fix steps:**
  1. In page.tsx, when source==='error' render <RefreshErrorState error={toHumanError('load',{area:'grants'})} backHref='/grants'/> (pattern: metadata/records/page.tsx:23) instead of StatGrid, or at minimum render stat values as '—'.
  2. Move the four stat cards into GrantsTable (client) so they derive from the same useSeededResource `rows` and `provenance` as the table; show '—' when provenance==='error-no-data'.
  3. Keep the DataSourceBadge for the 'cached' provenance case.
  4. Add a component test for both provenances.
- **Acceptance:**
  - Unit: GrantsTable with source='error' and empty cache shows '—' in all four stats and an error/retry state, not 0.
  - Unit: with a cached copy, stat counts equal the table row count.
  - Manual: block /api/v1/grants/grants; page shows retry, not 'Total 0'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentation only. Do not turn a legitimately empty tenant into an error state.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-LIST-02  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat cards aggregate over the whole array on the server (page.tsx:9-11) but the table paginates 15 per page from a possibly cached copy (GrantsTable.tsx:30-36); no "as of" time on either.
- **Verified evidence:** Stats (page.tsx:9-11) and the table both derive from the same single fetch of /api/v1/grants/grants (loaders.ts:3549); the table paginates client-side at pageSize 15 with client filter (GrantsTable.tsx:45-54), so totals are over the full fetched array, not over one page. They only diverge when the table falls back to cached rows (see LIST-01). No 'as of' timestamp exists on the stat cards or the fresh table. Whether the server caps the list cannot be seen (grant-service and @civitasone/types absent), and the request sends no limit/offset.
- **Files to change:** `apps/web/src/app/(app)/grants/list/page.tsx`, `apps/web/src/app/(app)/grants/list/GrantsTable.tsx`
- **Fix steps:**
  1. Show 'As of <time>' (from cachedAt, or render time when live) next to the stat cards, reusing formatIndianDate/DateTime.
  2. Compute stats from the same `rows` as the table (see LIST-01) so they cannot disagree.
  3. If backend supports it, add page/limit/q params to getGrants and totals in the response; otherwise record as backend dependency.
- **Acceptance:**
  - Cached state: stats and table row count match.
  - 'As of' timestamp visible on cards.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Server-side pagination changes DataTable contract; keep client filtering until API supports q.
- **Depends on:** GAP-GRANTS-LIST-01

### GAP-GRANTS-LIST-03  ·  MEDIUM  ·  partly  ·  theme PII

- [~] **Status** (NEEDS OWNER DECISION: static masking done for non-privileged roles; audited reveal button needs a /grants/pii/reveal endpoint and DPO decision — MaskedReveal component exists but the grants reveal path is not wired)
- **W0 note:** partly fixed by #1865 — non-privileged roles see a masked grantee name, but privileged reveal writes no audit event
- **First-pass claim:** Individual (natural-person) grantees are listed by name to every module user with no role gate (GrantsTable.tsx:21); DPDP purpose limitation not shown.
- **Verified evidence:** GrantsTable.tsx:21 renders granteeName for every row with no role check; the grants tree only has ModuleGate in layout.tsx (tenant enablement). Whether a grantee is a natural person cannot be seen (GrantSummary type absent) and no purpose-limitation notice exists. No shared <Masked> component exists in app/_components/ds (Masked only appears as local usage in admin/integrations and hr/employees/new Step4). There is no CSV export on this page, so the export-gating part of the fix does not apply here.
- **Files to change:** `apps/web/src/app/(app)/grants/list/GrantsTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx`
- **Fix steps:**
  1. Decide with DPO whether grantee names are PII to be masked for read-only roles; document the purpose in the page subtitle if not.
  2. If masking: create a shared ds <Masked value reveal> with role-based reveal that emits an audit event on reveal.
  3. Apply to the Grantee column here and in releases and grantees tables.
  4. Gate route via grants role guard (see GAP-GRANTS-RELEASES-01).
- **Acceptance:**
  - Non-privileged role sees masked name; privileged reveal writes an audit event.
  - Grantee filter still works on unmasked data server-side only if permitted.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII policy decision needed first; over-masking hurts clerks doing lookups.
- **Depends on:** GAP-GRANTS-RELEASES-01

### GAP-GRANTS-LIST-04  ·  LOW  ·  confirmed  ·  theme COPY (was MONEY)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Column heading "Total (₹)" while Disbursed/Pending have no unit (GrantsTable.tsx:23-25) although every cell already prints ₹; back link is hand-built with a lucide icon (page.tsx:15-17) where sibling pages use PageHeader back.
- **Verified evidence:** GrantsTable.tsx:23 heading 'Total (₹)' while :24-25 'Disbursed'/'Pending' have no unit; the amounts are rendered via cellType 'amount' and the page stats use formatMoney (paise-correct, formatters.ts:90). list/page.tsx:15-17 builds a hand-made <nav class=back> with lucide ArrowLeft and a raw <a href> (full reload), whereas siblings (applications/page.tsx:22-25, schemes/[id]/page.tsx:31) use PageHeader back/backLabel. The money-handling half of the fix text does not apply to this finding; only the label consistency does.
- **Files to change:** `apps/web/src/app/(app)/grants/list/page.tsx`, `apps/web/src/app/(app)/grants/list/GrantsTable.tsx`
- **Fix steps:**
  1. Rename columns consistently: 'Total', 'Disbursed', 'Pending' with the ₹ unit either on all or (preferred) none since cells print ₹.
  2. Delete the manual <nav> and lucide import in page.tsx; pass back='/grants' backLabel='Grants' to PageHeader.
- **Acceptance:**
  - Only one breadcrumb renders; navigating back is a client transition.
  - Column headings show consistent unit treatment.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-GRANTS-LIST-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1653, verified on main 9c5e9e9e9)
- **First-pass claim:** formatIndianDate prints dd/mm/yyyy via toLocaleDateString("en-IN", {day:"2-digit", month:"2-digit", year:"numeric"}) (lib/formatters.ts:2-7); the design convention is "28 Sep 2026" so a 03/10/2026 style date is ambiguous in a mixed-locale office.
- **Verified evidence:** lib/formatters.ts:1-7: formatIndianDate uses toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) => dd/mm/yyyy, with no timeZone option (uses runtime tz, so SSR vs browser can differ near midnight). The file's own doc comment cites a GFR 2017 / PFMS mandate for dd/MM/yyyy, so the 'design convention dd Mon yyyy' claim conflicts with a stated compliance requirement; ambiguity concern is opinion. Used at GrantsTable.tsx:22.
- **Files to change:** `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Get a decision: keep dd/MM/yyyy (GFR/PFMS) or move to 'dd MMM yyyy'.
  2. Either way, add timeZone:'Asia/Kolkata' to the toLocaleDateString options so server and client render identically.
  3. If format changes, update formatters unit tests and any snapshots.
- **Acceptance:**
  - formatIndianDate('2026-09-28T20:00:00Z') returns the IST date.
  - Chosen format used on grants list, releases, scheme detail.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Global helper; change affects every module's dates and snapshots.


---
## /grants/releases  —  `grants/releases.html`

- **Source:** `apps/web/src/app/(app)/grants/releases/page.tsx`
- **Design reference:** `redesign/grants/releases.html`

### GAP-GRANTS-RELEASES-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** grants/layout.tsx:1-5 only wraps ModuleGate moduleKey='grants' (checks tenant enablement, ModuleGate.tsx:21-25). grep for requireAnyRole/getSessionRoles/hasRole under app/(app)/grants returns nothing. Releases Approve button (ReleasesTable.tsx:63-90), Close Scheme, Apply and New Scheme are therefore visible to any user of the module. requireAnyRole exists (lib/auth/roleGuard.ts) and is used by crm layouts. grant-service is not in the snapshot (services/ has only hrms-service): server enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Decide the role names with the grants owner (only 'grant_admin' appears anywhere in the repo; no maker/checker/viewer role names are defined) and put them in a shared constant, e.g. apps/web/src/app/(app)/grants/roles.ts.
  2. Follow the crm/document-types/layout.tsx pattern: call requireAnyRole(ALLOWED_ROLES, '/grants') from '@/lib/auth/roleGuard' in a route-group layout or the route layout.
  3. Read roles with getSessionRoles() in the server page and pass a canApprove boolean into ReleasesTable so the Approve column is omitted for non-approvers.
  4. Keep grants/layout.tsx ModuleGate as the outer wrapper; do not replace tenant enablement with role checks.
  5. Confirm grant-service enforces the same roles server-side (service absent from snapshot) and file a backend ticket if not.
- **Acceptance:**
  - Unit: user without an approver role does not see the Approve action on /grants/releases.
  - Direct navigation to /grants/schemes/new as a viewer redirects to /grants.
  - Backend returns 403 to the same user on POST.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong role list would lock out legitimate officers; confirm names with IAM before merge. Web hiding is not a security control.

### GAP-GRANTS-RELEASES-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** The Approve button posts to /api/proxy/v1/grants/releases/{id}/approve, which the code itself says does not exist ("no release-approve write endpoint yet … will surface 404/405", ReleasesTable.tsx:80-85). A checker confirms a "cannot be undone" dialog, enters a reason and gets a generic failure; the button should be hidden until the endpoint exists.
- **Verified evidence:** ReleasesTable.tsx:63-90 renders ActionButton 'Approve' with confirm dialog, requireReason and audit copy, but onConfirm posts /api/proxy/v1/grants/releases/${row.id}/approve; the in-code NOTE at :80-84 states grant-service has no approve endpoint (read-only GET /v1/grants/releases) and the call will 404/405. postAction (:31-40) turns any failure into a generic message. So the dialog and reason exist (ConfirmDialog part of the fix is already done) but the action cannot succeed. Maker!=checker and audit emission cannot be checked (service absent).
- **Files to change:** `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Hide the Approve column (render '—') behind a flag such as NEXT_PUBLIC_GRANTS_RELEASE_APPROVE until backend ships the endpoint.
  2. Backend: add POST /v1/grants/releases/:id/approve with zod body {reason}, maker!=checker check and audit event.
  3. Once live, remove flag and keep the existing ActionButton; show the server's human error for 403 maker=checker.
- **Acceptance:**
  - With flag off no Approve button is shown on pending rows.
  - With backend: approve succeeds, row status updates after router.refresh(), audit event recorded.
  - Same user who created the release gets a clear refusal.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money-release approval; never fake success. Hiding is the safe interim.

### GAP-GRANTS-RELEASES-03  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Amount units disagree between list and detail: this table prints formatMoney(row.amount) treating amount as paise (ReleasesTable.tsx:55), while disbursements/[id]/page.tsx:23-24 says GrantRelease.amount is rupees and multiplies by 100. The same release shows a figure 100x apart on the two screens; which is right cannot be determined (grant-service and @civitasone/types absent).
- **Verified evidence:** releases/ReleasesTable.tsx:55 and page.tsx:14,31 treat GrantRelease.amount as paise (formatMoney), while disbursements/[id]/page.tsx:23-24 says amount is rupees and does Math.round(amount*100) before formatMoney. The same release therefore renders 100x apart between /grants/releases and /grants/disbursements/{id}. Correct unit cannot be determined (grant-service and @civitasone/types absent; loader GrantReleaseListSchema is imported from a package not in snapshot). CLAUDE.md rule 11 says money is bigint minor units, which favours the list's assumption and suggests the detail page is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/disbursements/[id]/page.tsx`, `apps/web/src/app/(app)/grants/releases/page.tsx`, `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Confirm the unit on the wire from grant-service /v1/grants/releases (backend owner or a sample response).
  2. If paise: remove the *100 in disbursements/[id]/page.tsx:24 and pass disbursement.amount straight to formatMoney and RaiseEOfficeNote amountMinor.
  3. If rupees: use formatRupees in the list and page stats, and convert once in the loader mapper (getGrantReleases) so components only see paise.
  4. Rename the field or document the unit in the type.
- **Acceptance:**
  - Component test: a release with amount 150000 shows the same figure on list and detail.
  - RaiseEOfficeNote amountMinor equals the displayed amount in paise.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money display and the e-office note amount; a wrong choice mis-states disbursements by 100x.

### GAP-GRANTS-RELEASES-04  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows are not links (ReleasesTable.tsx:105 has no rowLinkPrefix), so the disbursement detail /grants/disbursements/{id} and its "raise eFile" note are unreachable from the UI list.
- **Verified evidence:** ReleasesTable.tsx:105 DataTable has no rowLinkPrefix/rowLinkKey (contrast list/GrantsTable.tsx:48-49). Route disbursements/[id]/page.tsx exists and getGrantDisbursementById resolves by release id (loaders.ts:3591-3595), and it hosts RaiseEOfficeNote, but nothing in the grants tree links to /grants/disbursements/ (only its own back link). Reachable only by typed URL.
- **Files to change:** `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Add rowLinkPrefix='/grants/disbursements/' rowLinkKey='id' to the DataTable at ReleasesTable.tsx:105 (links the first column, Release No).
  2. Optionally use rowHref if a different prefix is wanted.
  3. Check the Approve button click does not trigger row navigation.
- **Acceptance:**
  - Clicking Release No opens /grants/disbursements/{id} with the correct release.
  - Approve button still works without navigating.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; detail page shows amount (see RELEASES-03), fix unit first.

### GAP-GRANTS-RELEASES-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch renders Total 0 / Processed 0 / Pending 0 / ₹0.00 and an empty table (loaders.ts:3576-3582); only the in-table badge hints at failure.
- **Verified evidence:** loaders.ts:3576-3582 getGrantReleases falls back to []; releases/page.tsx:10-14,28-31 computes Total/Processed/Pending/Total Released from it, rendering 0 / 0 / 0 / ₹0.00 on failure. ReleasesTable.tsx:44-48,104 shows the DataSourceBadge only and may show cached rows while the cards remain 0 (same mechanism as LIST-01).
- **Files to change:** `apps/web/src/app/(app)/grants/releases/page.tsx`, `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Apply the same fix as GAP-GRANTS-LIST-01: RefreshErrorState when source==='error', or move stat cards into ReleasesTable using the shared useSeededResource rows and '—' on error-no-data.
- **Acceptance:**
  - With source='error' no '0' or '₹0.00' stat is shown; retry is offered.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-LIST-01, RefreshErrorState

### GAP-GRANTS-RELEASES-06  ·  LOW  ·  partly  ·  theme COPY (was DATEFMT)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Bank Ref prints "—" for pending rows with no explanation; Total Released excludes pending but the label does not say so; dates dd/mm/yyyy (formatters.ts:2-7).
- **Verified evidence:** ReleasesTable.tsx:57 prints '—' for null bankRef, with no reason; that is real but minor (status column already says pending). page.tsx:12-14 sums only processed/credited into the card labelled 'Total Released', which is accurate wording for released funds, so the 'label does not say so' claim is weak. Dates use formatIndianDate dd/mm/yyyy (formatters.ts:2-7) — see LIST-05 for the compliance note.
- **Files to change:** `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`, `apps/web/src/app/(app)/grants/releases/page.tsx`
- **Fix steps:**
  1. Render 'Awaiting bank ref' (muted) when status is pending and bankRef is null; keep '—' otherwise.
  2. Add a subtitle on the Total Released card, e.g. 'processed + credited only'.
  3. Date format: follow the decision on GAP-GRANTS-LIST-05.
- **Acceptance:**
  - Pending row shows 'Awaiting bank ref'.
  - Card shows its inclusion rule.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-GRANTS-LIST-05


---
## /grants/schemes  —  `grants/schemes.html`

- **Source:** `apps/web/src/app/(app)/grants/schemes/page.tsx`
- **Design reference:** `redesign/grants/schemes.html`

### GAP-GRANTS-SCHEMES-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** grants/layout.tsx:5 only returns <ModuleGate moduleKey="grants">; no requireAnyRole/getSessionRoles in grants/**. schemes/page.tsx:29-31 renders '+ New Scheme' to every user. Helper exists at lib/auth/roleGuard.ts:26,49 and is used by crm/layout.tsx:5 and tenant-admin/layout.tsx. Server-side grant-service guard is cannot-verify (only hrms-service present).
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/schemes/page.tsx`, `apps/web/src/app/(app)/grants/schemes/new/page.tsx`
- **Fix steps:**
  1. Decision: agree grants role names with the grant-service JWT claims (no grants role constant exists in apps/web; CRM uses crm_user/crm_admin in crm/layout.tsx:5).
  2. Add const GRANTS_ROLES and call requireAnyRole(GRANTS_ROLES) from '@/lib/auth/roleGuard' in grants/layout.tsx before <ModuleGate>, mirroring crm/layout.tsx.
  3. In the server page compute canMaintain = getSessionRoles().some(r => MAKER_ROLES.includes(r)) and pass it to the client table / PageHeader actions.
  4. Render '+ New Scheme' / Verify / Reject only when canMaintain; also requireAnyRole(MAKER_ROLES) in grants/schemes/new/page.tsx.
  5. Confirm grant-service enforces the same roles on POST schemes and utilization-certs/:id/validate (backend, not in snapshot).
- **Acceptance:**
  - Component/e2e: session with no grants role visiting /grants/schemes is redirected to /dashboard.
  - Session with read-only role sees the list but no '+ New Scheme' button.
  - Direct GET /grants/schemes/new as read-only role redirects.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong role list locks legitimate officers out of grants; backend must remain the authority.
- **Depends on:** roleGuard.requireAnyRole, GAP-GRANTS-UTILIZATION-01

### GAP-GRANTS-SCHEMES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch renders the first-run empty state "No grant schemes yet — Create your first scheme" with a "+ New Scheme" button (SchemesTable.tsx:68-74, loader falls back to [] in _data.ts:153-158); during an outage a clerk is nudged to create duplicate schemes. Only a small badge above says "Couldn't load — showing nothing".
- **Verified evidence:** _data.ts:153-158 fetchJson falls back to [] with source 'error' (apiClient.ts:152,166,172). SchemesTable.tsx:53-58 uses useSeededResource; with no cache provenance='error-no-data', rows=[] so lines 68-74 render EmptyState 'No grant schemes yet' with '+ New Scheme'; only DataSourceBadge (line 67) says 'Couldn't load — showing nothing'. page.tsx:40-53 stat cards also show 0 from raw schemes.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/SchemesTable.tsx`, `apps/web/src/app/(app)/grants/schemes/page.tsx`
- **Fix steps:**
  1. In SchemesTable, when provenance==='error-no-data' && rows.length===0 render <RefreshErrorState error={toHumanError('load',{area:'grant schemes'})} backHref='/grants'/> from '@/app/_components/ds' instead of EmptyState; keep the first-run EmptyState only for provenance==='live'.
  2. Hide/disable the '+ New Scheme' EmptyState action in the error branch.
  3. In page.tsx pass value '—' to StatCards (Total, Open, Total Budget, Applications) when source==='error'.
  4. Optionally drop the DataSourceBadge for the error-no-data case since the error state replaces it.
- **Acceptance:**
  - Test: mock fetch failure -> RefreshErrorState with Retry visible, no 'No grant schemes yet' text, no New Scheme CTA.
  - Stat cards show '—' not 0 on failure.
  - Retry calls router.refresh and recovers.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify cached-provenance path still shows saved data.
- **Depends on:** RefreshErrorState, ModuleListTable (same pattern)

### GAP-GRANTS-SCHEMES-03  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** totalDisbursed is computed (page.tsx:12) but never shown, so the page has budget without utilisation; "Total Budget" sums draft, closed and completed schemes together (page.tsx:11).
- **Verified evidence:** page.tsx:12 computes totalDisbursed and never uses it (dead variable); page.tsx:11 sums budgetMinor over all schemes regardless of status (draft/closed/cancelled included). Overstated: SchemesTable.tsx:27-32 does show a per-row 'Disbursed (₹)' column, so utilisation is visible per scheme, just not in the stat cards.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/page.tsx`
- **Fix steps:**
  1. Decision: define 'Total Budget' as open+completed (sanctioned) schemes, or label it 'Total Budget (all schemes)'.
  2. Sum only agreed statuses (exclude draft, cancelled) in page.tsx:11.
  3. Add a StatCard 'Disbursed' using totalDisbursed with formatMoney, or delete the unused variable.
  4. Keep amounts in paise (budgetMinor) until formatMoney.
- **Acceptance:**
  - Unit test: schemes [open 100, cancelled 50] -> Total Budget shows only 100 (per decision).
  - Disbursed card equals sum of table Disbursed column.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Finance officers may read stat as sanctioned funds; wrong denominator misreports.

### GAP-GRANTS-SCHEMES-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "Applications" falls back to projectCount when applicationCount is absent and to 0 otherwise (_data.ts:109, comment at _data.ts:29-30 admits the API "may or may not return this") — silent, possibly wrong counts.
- **Verified evidence:** _data.ts:109: applicationCount = toNumber(row.applicationCount ?? row.application_count ?? row.projectCount); toNumber (70-75) returns 0 for undefined. Type comment _data.ts:29-30 says 'API may or may not return this. Default 0.' So absent count renders 0 and projectCount is silently used as applications. Grant-service contract cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/_data.ts`, `apps/web/src/app/(app)/grants/schemes/SchemesTable.tsx`, `apps/web/src/app/(app)/grants/schemes/page.tsx`
- **Fix steps:**
  1. Make applicationCount number|null in GrantSchemeSummary; map to null when none of the three keys is a finite number.
  2. Remove the projectCount fallback unless backend confirms the meaning.
  3. Render '—' in SchemesTable column and exclude nulls from page.tsx:13 total (show '—' if all null).
  4. Confirm field name with grant-service owner.
- **Acceptance:**
  - Mapper test: row without count -> null, table shows '—'.
  - Row with applicationCount 0 -> shows 0.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Count semantics unverified; do not show a wrong number as fact.

### GAP-GRANTS-SCHEMES-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Mapper silently drops schemes lacking id/code/name and rewrites unknown statuses to "draft" (_data.ts:92-97) — a malformed scheme disappears or is mislabelled with no indicator.
- **Verified evidence:** _data.ts:88-92 skips rows missing id/code/name with `continue`; lines 91,94-97 map unknown/missing status to 'draft'. No counter or error flag; line 112 `out.length>0 ? out : []` is a no-op. If all rows are malformed the UI shows the first-run empty state as source 'api'.
- **Files to change:** `apps/web/src/app/(app)/grants/_data.ts`
- **Fix steps:**
  1. Define a zod GrantSchemeSchema (CLAUDE.md rule 9 spirit) and use responseSchema in fetchJson like getGrantUtilization does.
  2. Count dropped rows; return mapper null (=> source 'error') when rows were received but all invalid, and expose droppedCount to show a warning badge.
  3. Keep unknown status as-is (StatusPill falls back to 'info') or map to a visible 'unknown' instead of 'draft'.
  4. Remove the redundant ternary at line 112.
- **Acceptance:**
  - Test: payload with one bad row of three -> 2 rows plus dropped=1 warning.
  - Test: unknown status 'suspended' does not display as Draft.
  - All-invalid payload -> error state, not empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; may surface previously hidden backend data issues.
- **Depends on:** GAP-GRANTS-SCHEMES-02

### GAP-GRANTS-SCHEMES-06  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Only "Opens" is shown, not "Closes" (SchemesTable.tsx:34-38), though closeAt is mapped; dates dd/mm/yyyy (formatters.ts:2-7).
- **Verified evidence:** SchemesTable.tsx:34-38 has only an 'Opens' column; closeAt is mapped in _data.ts:108 but unused in the table. Date format dd/mm/yyyy via formatIndianDate (lib/formatters.ts:2-7) is the intended GFR/PFMS format, so that part is not a defect.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/SchemesTable.tsx`
- **Fix steps:**
  1. Add column {key:'closeAt',label:'Closes',render: row => row.closeAt ? formatIndianDate(row.closeAt) : '—'} after 'Opens'.
  2. Optionally flag schemes closing within 7 days.
- **Acceptance:**
  - Row with closeAt 2026-10-15 shows 15/10/2026.
  - Row without closeAt shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /grants/schemes/[id]  —  `grants/schemes-detail.html`

- **Source:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`
- **Design reference:** `redesign/grants/schemes-detail.html`

### GAP-GRANTS-SCHEMES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** Same as RELEASES-01: no role gate anywhere in grants tree (layout.tsx ModuleGate only). On this page, '+ New Application' (:39-43,139-143) and 'Close Scheme' (:144-150) are shown to every module user. Server enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`
- **Fix steps:**
  1. Decide the role names with the grants owner (only 'grant_admin' appears anywhere in the repo; no maker/checker/viewer role names are defined) and put them in a shared constant, e.g. apps/web/src/app/(app)/grants/roles.ts.
  2. Follow the crm/document-types/layout.tsx pattern: call requireAnyRole(ALLOWED_ROLES, '/grants') from '@/lib/auth/roleGuard' in a route-group layout or the route layout.
  3. Read roles server-side in this page and render the Management Actions card only for permitted roles.
  4. Keep grants/layout.tsx ModuleGate as the outer wrapper; do not replace tenant enablement with role checks.
  5. Confirm grant-service enforces the same roles server-side (service absent from snapshot) and file a backend ticket if not.
- **Acceptance:**
  - Viewer role sees scheme detail without Close/Apply.
  - Direct POST as viewer is rejected by backend.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Role list must be agreed; web hiding is not enforcement.
- **Depends on:** GAP-GRANTS-RELEASES-01

### GAP-GRANTS-SCHEMES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "Close Scheme" is a native <form action="/api/proxy/v1/grants/schemes/{id}/close" method="POST"> with one button (page.tsx:144-150): no confirmation, no reason, no visible audit reason, and the browser navigates to the proxy's raw response instead of returning to the page. An irreversible state change on one click, offered for draft schemes too.
- **Verified evidence:** page.tsx:144-150: <form action='/api/proxy/v1/grants/schemes/{id}/close' method='POST'> with <Button type='submit' variant='danger'>. No confirmation, no reason, and a native form post navigates the browser to the proxy's raw response. Shown for status 'draft' or 'open'. Audit/irreversibility server-side cannot-verify. A reusable ActionButton with confirmTitle/requireReason exists (used in ReleasesTable.tsx:65-78).
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`, `apps/web/src/app/(app)/grants/schemes/[id]/CloseSchemeButton.tsx`
- **Fix steps:**
  1. Create client CloseSchemeButton using ds ActionButton with confirmTitle, confirmDescription (scheme name, 'no new applications accepted'), requireReason.
  2. onConfirm: fetch POST to the proxy with {reason}, throw a humanised error on !res.ok, then router.refresh().
  3. Replace the <form> in page.tsx with it; show it for open schemes, and decide whether draft schemes should be 'Discard' instead.
  4. Backend: accept and audit reason.
- **Acceptance:**
  - Click shows a confirm dialog requiring a reason; cancel makes no request.
  - After confirm the page refreshes in place and shows status Closed.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** State change on a live scheme; today a mis-click closes it irreversibly.
- **Depends on:** GAP-GRANTS-SCHEMES-DETAIL-01

### GAP-GRANTS-SCHEMES-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows "Page not found": getSchemeById returns null on error (_data.ts:269-278) and page.tsx:16-18 calls notFound(); the DataSourceBadge at page.tsx:38 can never render with a null scheme.
- **Verified evidence:** _data.ts:269-278 getSchemeById uses fallback null; detail page.tsx:14-18 calls notFound() when data is null regardless of `source`, so a network/5xx error shows 'Page not found'. The DataSourceBadge at :38 sits after the null guard and can only render if scheme exists, so effectively dead for the error case.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`
- **Fix steps:**
  1. After the fetch: if (source==='error') return <RefreshErrorState error={toHumanError('load',{area:'scheme'})} backHref='/grants/schemes'/> inside PageHeader shell.
  2. Only call notFound() when source==='api' and scheme is null.
  3. Drop the unreachable badge at :38 or keep it for stale data only.
- **Acceptance:**
  - API 500 shows retry state, not 404.
  - Unknown id with 404 from API shows not-found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm fetchJson distinguishes 404 (source api? or error) — cannot see apiClient behaviour on 404 from here.
- **Depends on:** RefreshErrorState

### GAP-GRANTS-SCHEMES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme DEADCODE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead utilisation code: const utilizationPct = scheme.budgetMinor > 0 ? 0 : 0 with comment "disbursed not in this view yet" (page.tsx:20) — the list already carries disbursedMinor but the detail shows no budget-vs-disbursed measure; SECTOR_LABELS (page.tsx:8-11) is defined and never used, and sector/description captured by the create form are not mapped or shown anywhere (_data.ts:230-249).
- **Verified evidence:** page.tsx:20 `const utilizationPct = scheme.budgetMinor > 0 ? 0 : 0` is dead (always 0, unused). SECTOR_LABELS (:8-11) is unused. The scheme list model carries disbursedMinor (_data.ts:23,104) but GrantSchemeDetail (:189-203) and mapSchemeDetail (:230-249) do not, so no budget-vs-disbursed is shown. Sector/description: not mapped anywhere in _data.ts. 'Dead link' theme is wrong; this is dead code plus a missing feature.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`, `apps/web/src/app/(app)/grants/_data.ts`
- **Fix steps:**
  1. Delete utilizationPct and SECTOR_LABELS, or wire them.
  2. If the API returns disbursedMinor on GET /schemes/:id, add it to GrantSchemeDetail/mapSchemeDetail and show a utilisation bar (budget, disbursed, remaining).
  3. Otherwise derive from getGrantSchemes() row for that id (already has disbursedMinor).
- **Acceptance:**
  - No unused variables; lint clean.
  - Detail shows Disbursed and % of budget matching the list row.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-GRANTS-SCHEMES-NEW-03

### GAP-GRANTS-SCHEMES-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "+ New Application" depends on status === "open" only (page.tsx:21,39-43,139-143); it stays visible after closeAt has passed and before openAt, so the window fields are decorative.
- **Verified evidence:** page.tsx:21 isOpen = status==='open' only; '+ New Application' (:39-43,139-143) ignores openAt/closeAt, which are displayed (:65-71,122-133). Server-side enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`
- **Fix steps:**
  1. Compute acceptingApplications = isOpen && (!openAt || now>=openAt) && (!closeAt || now<=closeAt) using a shared helper.
  2. When not accepting but open, show a disabled button with 'Opens on ...' / 'Closed on ...'.
  3. Reuse the helper in the apply page (APPLY-03).
- **Acceptance:**
  - Scheme with closeAt in the past hides/disables New Application.
  - Scheme with future openAt shows opening date.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Should match backend rule; agree the timezone (IST) for window edges.
- **Depends on:** GAP-GRANTS-SCHEMES-DETAIL-APPLY-03

### GAP-GRANTS-SCHEMES-DETAIL-06  ·  LOW  ·  confirmed  ·  theme RENDERBUG (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** {scheme.reportingFrequencyDays && (…)} renders a literal "0" when the value is 0 (page.tsx:105); Budget, Max, Opens, Closes appear in both stat cards and details card; "+ New Application" appears twice (page.tsx:39-43 and 139-143); dates dd/mm/yyyy.
- **Verified evidence:** page.tsx:105 `{scheme.reportingFrequencyDays && (...)}`: value 0 renders a literal '0' in the DOM (mapSchemeDetail :245 maps non-null to a number). Budget/Max/Opens/Closes appear in StatGrid (:48-73) and again in the details card (:93-133); '+ New Application' appears in the header (:39-43) and in Management Actions (:139-143); dates via formatIndianDate dd/mm/yyyy.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`
- **Fix steps:**
  1. Change to `scheme.reportingFrequencyDays != null && scheme.reportingFrequencyDays > 0 && (...)`.
  2. Remove the duplicated Total Budget/Max Amount/Opens/Closes rows from the details card or the stat cards.
  3. Keep a single '+ New Application' (header).
- **Acceptance:**
  - Scheme with reportingFrequencyDays 0 shows no stray '0'.
  - Only one New Application button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /grants/schemes/[id]/apply  —  `grants/schemes-detail-apply.html`

- **Source:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`
- **Design reference:** `redesign/grants/schemes-detail-apply.html`

### GAP-GRANTS-SCHEMES-DETAIL-APPLY-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** "Beneficiary ID" must be typed as a UUID (page.tsx:31-36,115-145). The hint sends the clerk to "Browse grantees" but that table shows codes (GR-…), has no row link and no copy control (grantees/GranteesTable.tsx:17-43), so the UUID cannot be obtained from the UI.
- **Verified evidence:** Apply page.tsx:115-145 asks for a free-typed UUID (validated only as non-empty, :31-37) and links to /grants/grantees. grantees/GranteesTable.tsx:17-25 lists granteeCode (GR-...), name, type etc.; the DataTable has no rowLinkPrefix (:43), no id column and no copy control, and there is no grantees/[id] route. So a clerk cannot obtain the beneficiary UUID from the UI.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx`, `apps/web/src/app/(app)/grants/grantees/GranteesTable.tsx`
- **Fix steps:**
  1. Replace the UUID input with a picker that lists getGrantees() (name + granteeCode) and submits the selected row's id as beneficiaryId. Reuse ds EntityPicker if it exists, else create a small combobox fed by /api/v1/grants/grantees.
  2. Load grantees server-side in a wrapper server page and pass to the client form (also solves APPLY-03).
  3. Validate beneficiaryId as UUID with zod before POST.
  4. Ensure GranteeSummary exposes id (type absent from snapshot; verify).
- **Acceptance:**
  - Clerk selects a grantee by name/code and the POST body carries its UUID.
  - Invalid or empty selection blocks submit with a field error.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low. Confirm GranteeSummary.id is the same id the applications endpoint expects.

### GAP-GRANTS-SCHEMES-DETAIL-APPLY-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** After success the page redirects to /grants/applications after 2 s (page.tsx:77), but that list is fed by GET /grants/grants and shows sanctioned grants, not applications (_data.ts:161-167) — the application just filed is not visible, and no application id/reference is shown on the success message.
- **Verified evidence:** apply/page.tsx:75-77 sets success then router.push('/grants/applications') after 2s; the message shows no application id/reference (response body never read). _data.ts:161-167 getGrantApplications fetches /api/v1/grants/grants, i.e. the sanctioned-grants list, so a newly filed application (which has no grantNo yet, cf. _data.ts:175) will not appear there. applications/[id] detail uses /applications/:id (_data.ts:256-258), so a proper per-application endpoint exists.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`, `apps/web/src/app/(app)/grants/_data.ts`
- **Fix steps:**
  1. Parse the POST response (res.json()) and, if it returns the application id, redirect to /grants/applications/{id} and show the reference in the success message.
  2. Backend/decision: confirm a GET /v1/grants/applications list endpoint exists; if so point getGrantApplications at it, otherwise add it.
  3. Replace the 2s setTimeout with an immediate redirect or a persistent success panel with a 'View application' link.
- **Acceptance:**
  - After submit, the user lands on the new application (or a list containing it) and sees its reference.
  - Applications list contains applications not yet sanctioned.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Users may re-submit duplicates today because nothing confirms the filing.

### GAP-GRANTS-SCHEMES-DETAIL-APPLY-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** The page never loads the scheme (client component with only params.id): the breadcrumb prints schemeId.slice(0,8)… (page.tsx:89), the amount is not checked against the scheme min/max, and a closed or draft scheme accepts the form by URL. The counter says "/ 2000" but the textarea has no maxLength (page.tsx:167-187).
- **Verified evidence:** apply/page.tsx is a 'use client' page that only reads params.id (:16-17); breadcrumb prints schemeId.slice(0,8)… (:89) and is hand-built with raw <a> tags (:86-91); amount only checked > 0 (:43-48) with no scheme min/max; no scheme status check so a closed/draft scheme accepts a form via URL (server behaviour cannot-verify). Purpose counter shows '/ 2000' (:187) but the textarea (:167-177) has no maxLength and validation only enforces min 10.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`, `apps/web/src/app/(app)/grants/schemes/[id]/apply/ApplyForm.tsx`
- **Fix steps:**
  1. Make page.tsx a server component: call getSchemeById(params.id) (_data.ts:269), notFound()/error state on failure, block with EmptyState if scheme.status!=='open' or outside openAt/closeAt.
  2. Move the form into ApplyForm.tsx (client) taking scheme {name,minAmountMinor,maxAmountMinor} as props.
  3. Use PageHeader back='/grants/schemes/{id}' with the scheme name; delete manual <nav>.
  4. Validate amount against min/max in minor units and add maxLength={2000} (or drop the counter).
- **Acceptance:**
  - Visiting /apply for a closed scheme shows a 'not accepting applications' state.
  - Amount below min or above max shows a field error.
  - Breadcrumb shows scheme name.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Client checks are advisory; server must enforce window and caps.
- **Depends on:** GAP-GRANTS-SCHEMES-DETAIL-05

### GAP-GRANTS-SCHEMES-DETAIL-APPLY-04  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate: any module user can file for any beneficiary UUID, and nothing records that the applicant is staff acting on a grantee's behalf (submittedBy is set server-side, unverifiable).
- **Verified evidence:** No role check in apply/page.tsx or the grants layout (see RELEASES-01). Form takes an arbitrary beneficiaryId and POSTs to /api/proxy/v1/grants/schemes/${id}/applications (:57-68); nothing in the payload or UI states that staff file on the grantee's behalf. submittedBy assignment happens server-side and is not verifiable (grant-service absent).
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`, `apps/web/src/app/(app)/grants/schemes/[id]/apply/layout.tsx`
- **Fix steps:**
  1. Decide the role names with the grants owner (only 'grant_admin' appears anywhere in the repo; no maker/checker/viewer role names are defined) and put them in a shared constant, e.g. apps/web/src/app/(app)/grants/roles.ts.
  2. Follow the crm/document-types/layout.tsx pattern: call requireAnyRole(ALLOWED_ROLES, '/grants') from '@/lib/auth/roleGuard' in a route-group layout or the route layout.
  3. Add requireAnyRole in a schemes/[id]/apply/layout.tsx and hide '+ New Application' on scheme detail for other roles.
  4. Add a notice 'Filing on behalf of the selected grantee; recorded as submitted by you'.
  5. Backend: verify submittedBy is taken from the JWT and audited.
- **Acceptance:**
  - Non-applicant role is redirected from /apply.
  - Application record shows the staff submitter.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong role list blocks intake staff.
- **Depends on:** GAP-GRANTS-RELEASES-01

### GAP-GRANTS-SCHEMES-DETAIL-APPLY-05  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Amount converted with Math.round(rupees * 100) (page.tsx:54) whereas the approve dialog uses rupeesToMinorString (ApproveApplicationDialog.tsx:38); Currency is a single-option select (page.tsx:245-253); unused `use` import; setTimeout redirect has no cleanup (page.tsx:5,77).
- **Verified evidence:** apply/page.tsx:54 Math.round(parseFloat(x)*100) while lib/money.ts rupeesToMinorString (used in ApproveApplicationDialog.tsx:38) parses without float and rejects >2 decimals. Currency select has one option (:245-253); `use` imported but unused (:5); setTimeout at :77 has no cleanup, so a navigate-away before 2s still pushes.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/apply/page.tsx`
- **Fix steps:**
  1. Replace parseFloat/Math.round with rupeesToMinorString(amountRupees); if null show 'Enter a valid amount up to 2 decimals'.
  2. Send Number(minor) as today (or string if API accepts) - within safe integer range.
  3. Remove the `use` import; remove the redirect timer (see APPLY-02).
  4. Make currency read-only text 'INR' unless multi-currency is real.
- **Acceptance:**
  - Unit: '1.005' is rejected; '150.50' posts 15050.
  - Lint shows no unused import.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money entry; rejection of >2dp input is a behaviour change users may notice.
- **Depends on:** GAP-GRANTS-SCHEMES-DETAIL-APPLY-02


---
## /grants/schemes/new  —  `grants/schemes-new.html`

- **Source:** `apps/web/src/app/(app)/grants/schemes/new/page.tsx`
- **Design reference:** `redesign/grants/schemes-new.html`

### GAP-GRANTS-SCHEMES-NEW-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** No role check on schemes/new/page.tsx (16 lines, renders form) or in the grants layout; any module user can open Create Scheme and POST /api/proxy/v1/grants/schemes. Server guard cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/new/layout.tsx`, `apps/web/src/app/(app)/grants/layout.tsx`
- **Fix steps:**
  1. Decide the role names with the grants owner (only 'grant_admin' appears anywhere in the repo; no maker/checker/viewer role names are defined) and put them in a shared constant, e.g. apps/web/src/app/(app)/grants/roles.ts.
  2. Follow the crm/document-types/layout.tsx pattern: call requireAnyRole(ALLOWED_ROLES, '/grants') from '@/lib/auth/roleGuard' in a route-group layout or the route layout.
  3. Add schemes/new/layout.tsx with requireAnyRole for scheme-maker roles and hide 'New Scheme' entry on schemes/page.tsx for others.
  4. Keep grants/layout.tsx ModuleGate as the outer wrapper; do not replace tenant enablement with role checks.
  5. Confirm grant-service enforces the same roles server-side (service absent from snapshot) and file a backend ticket if not.
- **Acceptance:**
  - Non-maker is redirected from /grants/schemes/new.
  - Backend rejects POST for the same user.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Role list needs agreement.
- **Depends on:** GAP-GRANTS-RELEASES-01

### GAP-GRANTS-SCHEMES-NEW-02  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** maxAmountMinor is silently set to the full budget (CreateSchemeForm.tsx:67): every scheme accepts a single grant equal to its whole budget, and minAmountMinor, openAt, closeAt, reportingFrequencyDays and sanctionRef — all displayed on the scheme detail (schemes/[id]/page.tsx:98-133) — cannot be entered here. A new scheme is born with no window or cap the clerk chose.
- **Verified evidence:** CreateSchemeForm.tsx:62-69 body has name, code, sector, budgetMinor, maxAmountMinor: budgetMinor (:67), description. No inputs exist for min amount, open/close dates, reporting frequency or sanction reference, all of which the detail page displays (schemes/[id]/page.tsx:97-133) and GrantSchemeDetail models (_data.ts:189-203). So every new scheme allows a single grant equal to the whole budget with no window. Which of these the create endpoint accepts cannot be verified (service absent). The 'CAP' fix text (server pagination) does not apply.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/new/CreateSchemeForm.tsx`
- **Fix steps:**
  1. Add fields: Min grant, Max grant per application (default empty, must be <= budget), Opens on, Closes on (>= opens), Reporting cycle select (90/180/365/custom), Sanction order ref.
  2. Convert money with rupeesToMinorString; validate min<=max<=budget and closeAt>=openAt in a zod schema.
  3. Send only fields the API accepts; confirm the schema with grant-service owner.
  4. Do not default max to budget; require an explicit value.
- **Acceptance:**
  - Unit: max>budget rejected; close<open rejected.
  - Created scheme shows the entered cap and window on the detail page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Business risk: an uncapped scheme lets one application consume the budget.
- **Depends on:** GAP-GRANTS-SCHEMES-NEW-04

### GAP-GRANTS-SCHEMES-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** Closed by d9f3f7afe (UAT B4, 2026-10-27)
- **W0 note:** partly fixed by #1865 — sector/description inputs were removed from the create form rather than being persisted and shown on the scheme detail page
- **First-pass claim:** Sector and Description are collected and posted (CreateSchemeForm.tsx:65,68) but never read back: the scheme mapper and detail page ignore them (_data.ts:230-249; schemes/[id]/page.tsx:8-11 SECTOR_LABELS unused).
- **Verified evidence:** CreateSchemeForm.tsx:65,68 send sector and description. mapSchemeSummaries and mapSchemeDetail (_data.ts:81-110, 230-249) contain no sector/description (grep finds none), and SECTOR_LABELS in schemes/[id]/page.tsx:8-11 is unused. Whether the API persists them cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/[id]/page.tsx`, `apps/web/src/app/(app)/grants/_data.ts`, `apps/web/src/app/(app)/grants/schemes/new/CreateSchemeForm.tsx`
- **Fix steps:**
  1. Confirm with grant-service whether sector/description are stored and returned.
  2. If yes: add sector/description to GrantSchemeDetail and mapSchemeDetail and display them (use SECTOR_LABELS) on the detail page and as a list column.
  3. If no: remove the two fields from the form and delete SECTOR_LABELS.
- **Acceptance:**
  - Entered sector and description appear on the scheme detail page.
  - No unused constants remain.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Data-loss perception: users enter text that silently vanishes.
- **Depends on:** GAP-GRANTS-SCHEMES-DETAIL-04

### GAP-GRANTS-SCHEMES-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Budget is parsed with parseFloat and Math.round(x * 100) (CreateSchemeForm.tsx:48,60) where the approve dialog uses rupeesToMinorString to avoid float error; there is no confirmation of the amount in words, and the budget is the main figure of a sanctioned scheme.
- **Verified evidence:** CreateSchemeForm.tsx:48,60: parseFloat then Math.round(budgetRupees*100); ApproveApplicationDialog.tsx:38 uses rupeesToMinorString (lib/money.ts:33), which rejects >2 decimals and avoids float error. No amount-in-words or formatted echo (only hint 'Enter in rupees', :174-176). Also budgetMinor is sent as a JS number.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/new/CreateSchemeForm.tsx`
- **Fix steps:**
  1. Use rupeesToMinorString(totalBudgetRupees) and show validation error when null.
  2. Under the input show a live echo using formatMoney(minor) (e.g. '₹5,00,000.00'), optionally in words.
  3. Add a confirm step (ActionButton or summary) for the budget on submit.
- **Acceptance:**
  - Unit: '500000.555' rejected; '500000' sends 50000000.
  - Echo updates as user types.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money entry on a sanctioned budget.

### GAP-GRANTS-SCHEMES-NEW-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Scheme code is free text uppercased on submit (CreateSchemeForm.tsx:64) with no format hint beyond a placeholder; duplicate-code feedback depends on formError.fieldError("code") from the server.
- **Verified evidence:** CreateSchemeForm.tsx:64 code.trim().toUpperCase() on submit only; the input (:121-130) shows the uppercase-looking value as typed (lowercase) and only a placeholder 'e.g. PM-KISAN-2024'; client validation is non-empty (:43-47). Duplicate handling relies on formError.fieldError('code') (:131). Theme 'FABRICATED' is wrong; this is input validation.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/new/CreateSchemeForm.tsx`
- **Fix steps:**
  1. Add a code pattern (e.g. /^[A-Z0-9][A-Z0-9-]{2,30}$/) in a zod schema, apply text-transform uppercase/onChange uppercase so the user sees the final value.
  2. Add a visible hint beneath the field stating the format and that it must be unique.
  3. Keep server duplicate error display.
- **Acceptance:**
  - Typing 'pm kisan' shows an inline format error.
  - Duplicate code from server appears under the field.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Match backend code constraints once known.

### GAP-GRANTS-SCHEMES-NEW-06  ·  LOW  ·  confirmed  ·  theme THEME (was VALIDATION)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Inline hex colours (#fff, #b91c1c, #64748b) on fields and errors (CreateSchemeForm.tsx:98,113,174-176) ignore dark mode; the validation message region mixes a local message and formError.message.
- **Verified evidence:** CreateSchemeForm.tsx:98,117,136,156,184 use background '#fff'; error text '#b91c1c' (:113,132,178,206,214) and hint '#64748b' (:174); success '#047857' (:206). Hard-coded light colours ignore dark mode (apply/page.tsx uses var(--panel), var(--bad), var(--ink2)). Two message channels: local `message` (:201-212) and formError.message (:213-217), which can both show. Submit is disabled while submitting (:225), so that part is fine.
- **Files to change:** `apps/web/src/app/(app)/grants/schemes/new/CreateSchemeForm.tsx`
- **Fix steps:**
  1. Replace #fff with var(--panel), #b91c1c with var(--bad), #64748b with var(--ink2), #047857 with var(--good).
  2. Merge to a single message area: clear local `message` when formError has a message, or route all client validation through formError.
  3. Add zod schema validation at submit (see NEW-02/04).
- **Acceptance:**
  - Dark mode: fields and errors readable.
  - Only one error message displays at a time.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /grants/utilization  —  `grants/utilization.html`

- **Source:** `apps/web/src/app/(app)/grants/utilization/page.tsx`
- **Design reference:** `redesign/grants/utilization.html`

### GAP-GRANTS-UTILIZATION-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate anywhere in the grants tree: layout.tsx:5 only wraps ModuleGate moduleKey="grants" (tenant enablement), and no page calls requireAnyRole / getSessionRoles. Every signed-in user who can open the module sees the maker actions on these routes; the grant-service guard is not verifiable (services/ contains only hrms-service).
- **Verified evidence:** Same as SCHEMES-01: grants/layout.tsx:5 has no role check. UtilizationTable.tsx:70-118 renders Verify/Reject (POST /api/proxy/v1/grants/utilization-certs/:id/validate, lines 86,108) for every user who reaches the page; certifying UCs is a checker duty under GFR. Backend authorisation cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/grants/layout.tsx`, `apps/web/src/app/(app)/grants/utilization/page.tsx`, `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`
- **Fix steps:**
  1. Reuse GRANTS_ROLES layout guard from GAP-GRANTS-SCHEMES-01.
  2. Decision: name the checker role(s) (e.g. grants checker) distinct from the maker.
  3. In utilization/page.tsx compute canVerify via getSessionRoles() and pass to UtilizationTable as prop.
  4. In UtilizationTable render the Action column only when canVerify, else '—'.
  5. Backend must reject validate calls without the checker role.
- **Acceptance:**
  - Non-checker session sees UC list, no Verify/Reject buttons.
  - Checker session sees both.
  - Direct POST as non-checker returns 403 (backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval workflow: wrong gating blocks legitimate verification or leaves maker-checker unenforced.
- **Depends on:** GAP-GRANTS-SCHEMES-01

### GAP-GRANTS-UTILIZATION-02  ·  HIGH  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Status vocabulary mismatch: Verify posts status "validated" (UtilizationTable.tsx:86-89) but the Verified stat counts only "verified" (page.tsx:9) and the Action test is submitted|pending (UtilizationTable.tsx:70). Unless the backend rewrites the value, verified UCs vanish from the Verified count and, per grants/[id]/GrantDetailTables.tsx:106, are recognised there only because that file tests both.
- **Verified evidence:** UtilizationTable.tsx:86-89 posts status 'validated' (and 'rejected' at 108-111). page.tsx:9 counts u.status==='verified' only; UtilizationTable.tsx:70 shows actions for submitted|pending. GrantDetailTables.tsx:106 tests both 'verified' and 'validated', proving both values are expected. StatusPill (ds/StatusPill.tsx STATUS_MAP) has neither key so both render as neutral 'info'. Whether backend rewrites validated->verified is cannot-verify (GrantUtilization type in @civitasone/types absent; no grant-service).
- **Files to change:** `apps/web/src/app/(app)/grants/utilization/page.tsx`, `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add a shared helper isVerifiedUc(status) => status==='verified'||status==='validated' (e.g. in grants/_data.ts) and use it in page.tsx:9, UtilizationTable.tsx:70 and GrantDetailTables.tsx:106.
  2. Add verified/validated to STATUS_MAP as 'good'.
  3. Confirm canonical status value with grant-service and normalise in the loader mapper.
  4. Add 'Rejected' stat or keep rejected out of Action test explicitly.
- **Acceptance:**
  - Row status 'validated' counts under Verified and shows no action buttons.
  - StatusPill for validated/verified renders green 'Verified'.
  - Unit test for isVerifiedUc.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong Verified count on a compliance dashboard; low code risk.
- **Depends on:** GAP-GRANTS-UTILIZATION-03

### GAP-GRANTS-UTILIZATION-03  ·  MEDIUM  ·  partly  ·  theme APPROVAL (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** A "pending" UC (nothing submitted, Submitted Date "—") can be Verified (UtilizationTable.tsx:70-84): a checker can certify utilisation the grantee has not yet filed.
- **Verified evidence:** UtilizationTable.tsx:70 shows Verify for status 'submitted' OR 'pending', so a 'pending' UC can be verified from the UI. Whether 'pending' means not-yet-filed (submittedDate '—', line 62) or awaiting verification is not defined in the snapshot (type absent), so the claim that a grantee has not filed is plausible but unproven. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`
- **Fix steps:**
  1. Decision/backend: confirm meaning of 'pending' vs 'submitted' for UCs.
  2. If pending = not filed, change the condition at line 70 to row.status==='submitted' only.
  3. Also require row.submittedDate to be present before showing Verify.
  4. Backend should reject validate on non-submitted UCs.
- **Acceptance:**
  - Pending UC with no submittedDate shows no Verify button.
  - Submitted UC shows Verify/Reject.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Certifying unfiled utilisation is a financial-control lapse; confirm semantics first.
- **Depends on:** GAP-GRANTS-UTILIZATION-02

### GAP-GRANTS-UTILIZATION-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Reject requires a reason of any length (no minLength, UtilizationTable.tsx:105-106) whereas application rejection needs 10 characters (applications/[id]/ApplicationActions.tsx:121); the rejection is what the grantee will read.
- **Verified evidence:** UtilizationTable.tsx:105-106 uses requireReason without minReasonLength (ConfirmDialog default minReasonLength=1, ConfirmDialog.tsx:72); ActionButton supports the prop (ActionButton.tsx:77,122). Application rejection sets minReasonLength={10} maxReasonLength={1000} (applications/[id]/ApplicationActions.tsx:121-123). Verify remarks (line 83) also has no minimum.
- **Files to change:** `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`
- **Fix steps:**
  1. Add minReasonLength={10} and maxReasonLength={1000} to the Reject ActionButton (lines 93-114).
  2. Add minReasonLength={10} to Verify remarks too if policy requires.
  3. Extract shared REASON_MIN constant with ApplicationActions to keep parity.
- **Acceptance:**
  - Typing 'no' in Reject dialog keeps Reject UC disabled and shows min-length hint.
  - 10+ chars enables confirm.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-GRANTS-UTILIZATION-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch renders four zeros and an empty table (loaders.ts:3615-3621); only the in-table badge hints at failure.
- **Verified evidence:** loaders.ts:3615-3621 getGrantUtilization falls back to [] on error; page.tsx:28-31 then shows Total/Verified/Submitted/Pending = 0 and UtilizationTable.tsx:129-130 renders an empty DataTable with just the DataSourceBadge. No retry (contrast RefreshErrorState).
- **Files to change:** `apps/web/src/app/(app)/grants/utilization/page.tsx`, `apps/web/src/app/(app)/grants/utilization/UtilizationTable.tsx`
- **Fix steps:**
  1. In UtilizationTable render <RefreshErrorState> when provenance==='error-no-data' && rows.length===0 instead of the DataTable.
  2. In page.tsx show '—' in the four StatCards when source==='error'.
  3. Prefer computing stats from the same seeded rows (move stat cards into the client component) so cache and stats agree.
- **Acceptance:**
  - Failed fetch shows error state with Retry and '—' stats, not zeros.
  - Cached fallback still shows saved rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState, GAP-GRANTS-SCHEMES-02

### GAP-GRANTS-UTILIZATION-06  ·  LOW  ·  partly  ·  theme I18N (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1865, verified on main 9c5e9e9e9)
- **First-pass claim:** Title uses American "Utilization" while hub/help copy uses "Utilisation" (grants/page.tsx:17, helpContent.ts:257); verify dialog cites "GFR 2017" in body text only.
- **Verified evidence:** page.tsx:19 title/card 'Utilization Certificates' vs 'utilisation' in grants/page.tsx:17 and helpContent.ts:84,257, so spelling is inconsistent (route slug 'utilization' is fine). The GFR 2017 citation is in the Verify dialog description (UtilizationTable.tsx:79), not just body text; trivial. Theme CONFIRM is wrong.
- **Files to change:** `apps/web/src/app/(app)/grants/utilization/page.tsx`
- **Fix steps:**
  1. Change title, Card title and aria-label to 'Utilisation Certificates' (en-IN spelling).
  2. Optionally use back/backLabel PageHeader props instead of the manual <a href="/grants"> nav at lines 15-17 (full page reload).
- **Acceptance:**
  - Page title and hub label use the same spelling.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-GRANTS-DISBURSEMENTS-DETAIL-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: already fixed — grant-service returns amountMinor (paise), GrantRelease.amount typed as paise, web page uses formatMoney without x100 multiplication; closed by #PRNUM)
- **First-pass claim:** Amount unit conflict: the page comment says GrantRelease.amount is rupees and multiplies by 100 (page.tsx:23-24,45,56) while releases/ReleasesTable.tsx:55 feeds the same field to formatMoney as paise. One of the two screens is off by 100x, and the eOffice file carries amountMinor derived here, driving approval-chain routing by amount. Undeterminable which is right (grant-service absent).
- **Service:** `grants-service`  ·  **Endpoint(s):** `['GET /api/v1/grants/releases', 'POST /api/proxy/v1/grants/disbursements/:id/submit-approval']`
- **Question:** Is GrantRelease.amount stored in rupees or paise (minor units per CLAUDE.md rule 11)?
- **How to verify:** Open the releases schema/handler in grants-service and check the column type and unit; create a release of Rs 1,000 and read back amount.
- **Test to add:** Given release of Rs 1000 when GET releases then amount=100000 (paise) if minor; contract test pins the unit.
- **Impact if wrong:** 100x misstatement of grant amounts and wrong approval-chain routing by amount.
- **Web change if wrong:** Remove the x100 in disbursements/[id]/page.tsx:23-24,45,56 if paise, or convert in ReleasesTable.tsx:55 if rupees.
