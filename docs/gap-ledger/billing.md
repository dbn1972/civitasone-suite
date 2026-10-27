# Detailed gap file — module `billing`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 53, BACKEND-VERIFY 5



---
## /billing  —  `billing/home.html`

- **Source:** `apps/web/src/app/(app)/billing/page.tsx`
- **Design reference:** `redesign/billing/home.html`

### GAP-BILLING-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Orphan duplicate route /billing/list renders the same getBillingPlans list under the same title 'Billing — Plans' (list/page.tsx:5-13) but is not linked from this hub (page.tsx:8-12).
- **Verified evidence:** billing/list/page.tsx:4-13 calls getBillingPlans() and renders ModuleListPage titled 'Billing — Plans'; billing/page.tsx:8-14 links only plans, subscriptions, invoices, payments, gstn. navRouteManifest.ts:30-31 lists /billing and /billing/plans but not /billing/list; grep finds no other reference to billing/list in apps/ or packages/. Truly orphaned duplicate of plans/page.tsx.
- **Files to change:** `apps/web/src/app/(app)/billing/list/page.tsx`, `apps/web/src/app/(app)/billing/list/loading.tsx`, `apps/web/src/app/_components/navRouteManifest.ts`
- **Fix steps:**
  1. Delete billing/list/page.tsx and billing/list/loading.tsx (no inbound links exist).
  2. Add next.config redirects() entry /billing/list -> /billing/plans (permanent) so old bookmarks keep working.
  3. Confirm navRouteManifest.ts needs no change (it never listed /billing/list); run any manifest-vs-routes test.
- **Acceptance:**
  - GET /billing/list returns 308 to /billing/plans.
  - No file under billing/list remains; typecheck and route manifest test pass.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only risk is an external bookmark, covered by the redirect.
- **Depends on:** GAP-BILLING-LIST-01

### GAP-BILLING-HOME-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile icons: LinkTiles has an emoji only for 'Payments'; Plans, Subscriptions, Invoices and GSTN Console fall through to the generic folder glyph (LinkTiles.tsx:5-58).
- **Verified evidence:** LinkTiles.tsx:10-49 TILE_ICONS has 'Payments' (💳) only. tileIcon() (53-61) falls back on href substrings (dashboard/employees/leave/payroll/procurement/orders) and finally '📁'. '/billing/plans', 'Subscriptions', 'Invoices' and 'GSTN Console' match nothing so all render 📁. Line refs 5-58 in the observation are close (actual 10-61).
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add TILE_ICONS entries: Plans, Subscriptions, Invoices, 'GSTN Console' (e.g. 📋, 🔄, 🧾, 🏛️).
  2. Optionally extend ModuleHub links with an optional icon prop passed through NavTile to avoid title-keyed lookups (NavTile is in @civitasone/types, not visible here).
  3. Check existing LinkTiles test for the fallback glyph.
- **Acceptance:**
  - Render /billing: four tiles show distinct icons, only unknown titles show 📁.
  - LinkTiles unit test: title 'Invoices' maps to 🧾.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; cosmetic. TILE_ICONS is keyed by title and shared by all hubs, so a generic title like 'Plans' would apply elsewhere.

### GAP-BILLING-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx draws four stat-card blocks and a 288px table block (loading.tsx:7-13) although the hub has neither, so content jumps on load.
- **Verified evidence:** billing/loading.tsx:7-12 renders a 4-card grid (h-24) and an h-72 (288px) block; billing/page.tsx renders ModuleHub -> PageHeader + LinkTiles (g-3 tile grid) with no stat cards or table. Also loading uses min-h-screen bg-slate-50 wrapper, unlike the page's page-main.
- **Files to change:** `apps/web/src/app/(app)/billing/loading.tsx`
- **Fix steps:**
  1. Rewrite BillingLoading to: breadcrumb bar, title/subtitle bars, then a grid of 5 tile skeletons (use SkeletonCard from ds/Skeleton) matching LinkTiles 'grid g-3'.
  2. Wrap in className='page-main' like ModuleHub instead of min-h-screen bg-slate-50.
  3. Remove the stat grid and h-72 table block.
- **Acceptance:**
  - Throttle network: skeleton shows 5 tile placeholders and no table block; no layout shift when hub appears.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-BILLING-HOME-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub passes no help slug, unlike the sibling Catalogue hub (catalogue/page.tsx:15), so there is no 'How this works' link for GST e-invoice/GSTN concepts.
- **Verified evidence:** billing/page.tsx:5-15 passes no help prop to ModuleHub (ModuleHub.tsx:13,25 supports it), whereas catalogue/page.tsx:15 passes help='catalogue'. But lib/helpContent.ts HELP_MODULES (slugs at lines 57-324) has finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin: no 'billing' AND no 'catalogue'. So the sibling's link itself 404s via help/[module]/page.tsx notFound(). Simply adding help='billing' would break.
- **Files to change:** `apps/web/src/lib/helpContent.ts`, `apps/web/src/app/(app)/billing/page.tsx`
- **Fix steps:**
  1. Add a HelpModule with slug 'billing' to HELP_MODULES (title, summary, href '/billing', how-to steps, terms: GSTIN, IRN, e-invoice, GSTN) following the existing entries' shape (type at helpContent.ts:~24).
  2. Register terms with defineTerm/glossary (lib/glossary.ts) if not present.
  3. Pass help='billing' in billing/page.tsx ModuleHub.
  4. Separately note catalogue/page.tsx help='catalogue' is a dead slug (add module or drop prop).
- **Acceptance:**
  - Open /billing: '❓ How this works' link visible and /help/billing renders (200) with GST e-invoice explanation.
  - Test that every page-level help slug resolves via getHelpModule.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Content accuracy on GST/IRN wording needs a domain reviewer; no code risk.


---
## /billing/gstn  —  `billing/gstn.html`

- **Source:** `apps/web/src/app/(app)/billing/gstn/page.tsx`
- **Design reference:** `redesign/billing/gstn.html`

### GAP-BILLING-GSTN-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Submit Return posts straight to GSTN on button press — no ConfirmDialog, no summary of what will be filed, no role check (SubmitReturnPanel.tsx:52-99). Invoice IRN actions on the sibling page do use a confirmation (invoices/[id]/InvoiceActions.tsx:140-177).
- **Verified evidence:** SubmitReturnPanel.tsx form onSubmit -> handleSubmit (103-148) validates locally and immediately POSTs v1/billing/gstn/returns via browserJson (130); no ConfirmDialog, no summary. billing/layout.tsx only applies ModuleGate('billing'), no requireAnyRole; gstn/page.tsx has none. InvoiceActions.tsx:140-177 does use ConfirmDialog for IRN generate/cancel. Server-side role check cannot be verified (billing-service absent). Note: line refs in observation (52-99) are off; real 103-148.
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`, `apps/web/src/app/(app)/billing/gstn/page.tsx`, `apps/web/src/app/(app)/billing/gstn/layout.tsx`
- **Fix steps:**
  1. Add a review step: on valid submit open <ConfirmDialog title='File GSTR-x for period?' description=summary table of GSTIN, period, type and each amount via formatMoney, confirmLabel 'File return'/>; only POST in onConfirm.
  2. Consider requireReason or typed-period confirmation for GSTR9/9C.
  3. Add gstn/layout.tsx with requireAnyRole(<billing/finance roles>) (decision on role names).
  4. Send an X-Idempotency-Key (proxy already forwards x-idempotency-key) to prevent double filing.
- **Acceptance:**
  - Click Submit Return: dialog shows summary and nothing is POSTed until confirm.
  - Double-click confirm sends one request.
  - User without billing role is redirected.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Filing to a statutory portal is effectively irreversible; highest-risk action on this page.
- **Depends on:** GAP-BILLING-GSTN-02

### GAP-BILLING-GSTN-02  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Tax totals must be typed as paise digits ('Total Taxable Value (paise)') (SubmitReturnPanel.tsx:34-38,164-171,183); a ₹1.25 crore taxable value is a 10-digit entry and a slip is a 100x filing error. The ₹ helper appears only after typing (SubmitReturnPanel.tsx:199-201).
- **Verified evidence:** Labels 'Total Taxable Value (paise)' etc. (SubmitReturnPanel.tsx:215-218); input filtered to digits (230) and validated /^\d+$/ (111-114); the rupee rendering via formatMoney(f.value) appears only when there is a value (236-238), i.e. after typing. Value is sent as the raw paise string (135-139). A ₹1.25 crore value = 12500000000 (11 digits, observation said 10). Helper lib/money.ts rupeesToMinorString(input) (money.ts:28) already exists for rupee->paise strings.
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Change the four inputs to rupee entry (label 'Total Taxable Value (₹)', allow decimals to 2 places) and convert with rupeesToMinorString on submit; keep the paise string in the payload so the API contract is unchanged.
  2. Show a live formatted preview (formatMoney of converted paise, Indian grouping) and include it in the confirm dialog (GSTN-01).
  3. Reject values with >2 decimals with a field error.
- **Acceptance:**
  - Entering 125000000 (rupees) in the taxable field submits "12500000000" (paise) per rupeesToMinorString.
  - Typing 1.25 yields '125' paise payload.
  - Invalid '1.234' shows error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money entry unit change: verify payload stays paise strings; test with bigint-safe values.
- **Depends on:** GAP-BILLING-GSTN-01

### GAP-BILLING-GSTN-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by 773ae5375 (UAT B4, 2026-10-27): GET /v1/billing/gstn/returns/prepare computes taxable value and CGST/SGST/IGST from the caller's issued invoices for a supplier GSTIN and IST month (tax with no split reported separately); the Submit Return panel gains Prefill from invoices, a typed-vs-invoice variance display and a required acknowledgement before filing a differing return. Tests: services/billing-service/tests/gstn-return-prepare.test.ts, GstnConsole.test.tsx. The filed return remains the officer's responsibility; the computation basis (issued/partially paid/paid/overdue, issue date in IST) is flagged for finance sign-off in the PR.
- **W0 note:** partly fixed by #1873 — only a visible 'not checked against invoices' note was added; no prefill-from-invoices / variance reconciliation (needs backend return-preparation endpoint + finance sign-off).
- **First-pass claim:** Return totals are hand-keyed, not derived from Billing invoices or the ledger, and nothing reconciles them; the filed figure can drift from invoices with no check (SubmitReturnPanel.tsx:32-38,102-114).
- **Verified evidence:** handleSubmit (SubmitReturnPanel.tsx:103-148) posts only hand-typed values from local state (68-74); there is no fetch of invoice/ledger totals and no reconciliation or warning. Whether the backend cross-checks cannot be verified (billing-service absent).
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`
- **Fix steps:**
  1. Backend: expose a return-preparation endpoint returning computed totals for GSTIN+period (from billing invoices), or a reconcile response.
  2. Web: add 'Prefill from invoices' calling it, showing computed vs typed diff and requiring an acknowledgement of variance before filing.
  3. Until then add a visible note 'Totals are not checked against invoices'.
- **Acceptance:**
  - After prefill, fields equal invoice totals; editing shows variance badge.
  - Submitting with variance requires explicit confirmation.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Statutory filing accuracy; needs tax/finance sign-off.
- **Depends on:** GAP-BILLING-GSTN-01

### GAP-BILLING-GSTN-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Panels unmount on tab switch (GstnConsole.tsx:19-21), so a half-typed return is lost, and the referenceId from a successful submit is not carried to the Return Status tab — users must copy the uuid by hand (SubmitReturnPanel.tsx:95-96; ReturnStatusPanel.tsx:40).
- **Verified evidence:** GstnConsole.tsx:37-39 renders only the active panel, so switching tabs unmounts SubmitReturnPanel and loses its useState fields (68-74). On success only local `result` is set (142) showing Reference ID (261); ReturnStatusPanel has its own `ref` state (287) with no prop or shared state. Users must copy the id manually.
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/GstnConsole.tsx`, `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`, `apps/web/src/app/(app)/billing/gstn/ReturnStatusPanel.tsx`
- **Fix steps:**
  1. Render all three panels and hide inactive ones with the `hidden` attribute (keeps state), or lift form state into GstnConsole.
  2. Add lastReferenceId state in GstnConsole; SubmitReturnPanel gets onSubmitted(id); show a 'Check status' button that sets the tab and prefills ReturnStatusPanel via an initialRef prop.
  3. Add a copy-to-clipboard control next to Reference ID.
- **Acceptance:**
  - Type values, switch tabs and back: values retained.
  - After submit click 'Check status': Status tab opens with id prefilled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-BILLING-GSTN-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by ff64a1009 (UAT B4, 2026-10-27): migration 0024 stores every filed return (tenant-scoped, FORCE RLS, paise); GET /v1/billing/gstn/returns lists the filing history (filter gstin/period/returnType); the console has a Filing History tab and the review dialog warns when the same GSTIN, period and type was already filed. Tests: gstn-return-history.test.ts, GstnConsole.test.tsx.
- **W0 note:** partly fixed by #1873 — panel now honestly states it is a single-reference lookup; no filing-history list and no duplicate period/type warning (needs backend gstn_returns persistence).
- **First-pass claim:** No filing history: status is looked up only by a raw reference id, there is no list of returns per GSTIN/period, so an officer cannot see what was already filed for 08/2026 before filing again.
- **Verified evidence:** ReturnStatusPanel.tsx only calls GET v1/billing/gstn/returns/{ref}/status (311) for a typed reference; no list endpoint is used anywhere in gstn/*. A returns-list endpoint's existence cannot be verified (billing-service absent), so do not assume one.
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/ReturnStatusPanel.tsx`, `apps/web/src/app/(app)/billing/gstn/GstnConsole.tsx`
- **Fix steps:**
  1. Backend: add GET v1/billing/gstn/returns?gstin=&period= returning past filings (reference, type, period, status, filedAt).
  2. Web: add a 'Filing history' tab with a DataTable using useSeededResource/loader; link rows to status detail.
  3. In SubmitReturnPanel, after GSTIN+period+type are entered, warn if a filed/processing return already exists.
- **Acceptance:**
  - History tab lists returns for a GSTIN.
  - Submitting duplicate period/type shows a warning.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Reduces duplicate/incorrect filing risk.
- **Depends on:** GAP-BILLING-GSTN-01

### GAP-BILLING-GSTN-06  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** GSTIN validated by regex only, no checksum-digit check (SubmitReturnPanel.tsx:26-28); Submit does not call Verify. Tab state is local, not deep-linkable (GstnConsole.tsx:11-13).
- **Verified evidence:** GSTIN_RE at SubmitReturnPanel.tsx:63 (and VerifyGstinPanel.tsx:18) is structure-only; the last char is accepted as [0-9A-Z] with no mod-36 checksum. handleSubmit does not call the verify endpoint. Tab state is local useState in GstnConsole.tsx:31, not synced to the URL. Line refs in observation (26-28) are off.
- **Files to change:** `apps/web/src/lib/gstin.ts`, `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`, `apps/web/src/app/(app)/billing/gstn/VerifyGstinPanel.tsx`, `apps/web/src/app/(app)/billing/gstn/GstnConsole.tsx`
- **Fix steps:**
  1. Create lib/gstin.ts with isValidGstin(gstin) doing regex + mod-36 checksum; use in both panels.
  2. Optionally call the verify endpoint before submit and show legal name for confirmation in the summary dialog.
  3. Sync active tab to `?tab=` via useSearchParams/router.replace.
- **Acceptance:**
  - Test: valid sample GSTIN passes; same GSTIN with altered last char fails.
  - /billing/gstn?tab=status opens the Status tab.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Checksum bug would block valid GSTINs; use published algorithm and test vectors.
- **Depends on:** GAP-BILLING-GSTN-01

### GAP-BILLING-GSTN-07  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (w2/billing-part-1 2026-10-16: closed — SubmitReturnPanel.tsx gains GSTN_RESULT_TONE override so 'filed' renders 'good' pill without changing the shared STATUS_MAP; GWT test added in GstnConsole.test.tsx)
- **W0 note:** partly fixed by #1873 — Submit result now uses StatusPill and 'filed' is mapped, but 'filed' maps to 'warn' (shared RTI key in StatusPill.tsx) rather than 'good' as the acceptance requires.
- **First-pass claim:** StatusPill maps neither 'filed', 'processing' nor 'suspended' (StatusPill.tsx:5-36), and the Submit result prints status as plain text while the Status tab uses a pill (SubmitReturnPanel.tsx:213 vs ReturnStatusPanel.tsx:97).
- **Verified evidence:** StatusPill STATUS_MAP (StatusPill.tsx:5-39) contains none of filed, processing, suspended (also 'rejected' and 'submitted' exist). ReturnStatusPanel.tsx:363 uses <StatusPill>, so 'filed'/'processing' fall back to blue; SubmitReturnPanel.tsx:262 prints result.status as raw text.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`
- **Fix steps:**
  1. Add filed:'good', processing:'warn', suspended:'bad' (and trial:'warn') to STATUS_MAP.
  2. Use <StatusPill status={result.status}/> at SubmitReturnPanel.tsx:262.
- **Acceptance:**
  - <StatusPill status="filed"/> renders 'pill good'.
  - Submit result shows a pill, matching the Status tab.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component; low.
- **Depends on:** shared StatusPill map

### GAP-BILLING-GSTN-08  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** The subtitle warns GSTN 'may be disabled in this environment' but the UI cannot detect it; the user learns only from a failed call (page.tsx:11).
- **Verified evidence:** billing/gstn/page.tsx:9 subtitle contains 'GSTN may be disabled in this environment'; no code in gstn/* checks feature/environment status before showing the forms; failure shows only after submit (SubmitReturnPanel.tsx:143-144). No status/flag endpoint is referenced, and one cannot be verified as existing.
- **Files to change:** `apps/web/src/app/(app)/billing/gstn/page.tsx`, `apps/web/src/app/(app)/billing/gstn/SubmitReturnPanel.tsx`
- **Fix steps:**
  1. Backend/config: expose GSTN enabled flag (feature-flag or /billing/gstn/status).
  2. Web: read it in page.tsx (server loader) and render a banner + disable submit/verify buttons when disabled; remove the hedge from subtitle.
  3. Until available, map the backend's 'disabled' error code to a clear message.
- **Acceptance:**
  - When flag is off, page shows 'GSTN is disabled in this environment' and buttons are disabled.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /billing/invoices  —  `billing/invoices.html`

- **Source:** `apps/web/src/app/(app)/billing/invoices/page.tsx`
- **Design reference:** `redesign/billing/invoices.html`

### GAP-BILLING-INVOICES-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as an empty ledger: on source 'error' the badge renders but rows stay [] so DataTable shows 'No invoices yet — No invoices have been generated for this tenant.' (page.tsx:39-60).
- **Verified evidence:** invoices/page.tsx:29,38 fetches with fallback [] and on source==='error' renders only <DataSourceBadge source='error'> ('Couldn't load — showing nothing'), then DataTable (40-60) with rows=[] draws EmptyState 'No invoices yet / No invoices have been generated for this tenant' (DataTable.tsx:320). The two messages contradict and there is no retry. Nuance: the amber badge is shown, so it is not silent, but the empty-ledger claim is false.
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/page.tsx`
- **Fix steps:**
  1. Destructure status and errorMessage from getInvoices().
  2. If source==='error' return early with PageHeader plus <LoadErrorState result={{status,errorMessage}} area='invoices' backHref='/billing'/> (retry + 403 handling), no DataTable.
  3. Only render the DataTable and 'No invoices yet' empty state when source==='api'.
- **Acceptance:**
  - Mock 500: retry state, no 'No invoices yet' text.
  - Mock 200 []: empty state shown.
  - Mock 403: access-restricted state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-BILLING-INVOICES-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** The only identifier and link text is the raw invoice UUID (page.tsx:43,53-54); InvoiceRow has no human invoice number, so finance staff cannot quote or search a readable reference.
- **Verified evidence:** invoices/page.tsx:42 column key 'id' labelled 'Invoice ID' and rowLinkKey='id' (51-52) so the link text is the raw uuid; InvoiceRow (5-16) has no invoiceNumber/number field. Backend (billing-service) not in snapshot so cannot confirm whether a number exists.
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/page.tsx`, `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`, `services/billing-service (invoice schema/DTO; not in snapshot)`
- **Fix steps:**
  1. Confirm with billing-service whether an invoice number (GST-compliant sequential, max 16 chars) exists; if not, add invoiceNumber to the invoice DTO (backend).
  2. Add invoiceNumber to InvoiceRow/InvoiceDetail; show it as first column and page title; keep uuid only in URL and a secondary 'Reference' mono field.
  3. Include invoiceNumber in the filter (DataTable filters over displayed columns) and update filterPlaceholder.
  4. Interim: show period + short id ('INV-' + id.slice(0,8)) with tooltip if backend work is delayed.
- **Acceptance:**
  - List shows human numbers; searching 'INV-2026' filters.
  - Row link still goes to /billing/invoices/<uuid>.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** GST rules require unique sequential invoice numbers; do not invent them client-side.

### GAP-BILLING-INVOICES-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** StatusPill has no mapping for 'issued' or 'cancelled', so both fall to the neutral 'info' pill and look identical (StatusPill.tsx:5-36; page.tsx:44).
- **Verified evidence:** invoices/page.tsx:44 cellType 'status' -> DataTable.tsx:127 StatusPill; StatusPill.tsx STATUS_MAP lacks 'issued' and 'cancelled' so both get variant 'info' and identical styling. Full invoice status enum not verifiable (billing-service absent).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Add issued (info or good), cancelled (bad or mut), partially_paid (warn), generated, filed to STATUS_MAP.
  2. Add StatusPill unit tests.
- **Acceptance:**
  - Table: issued and cancelled rows show different pill classes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component; check other modules using 'cancelled'.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-07

### GAP-BILLING-INVOICES-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Every amount is formatted as ₹ by formatMoney although InvoiceRow carries a currency field and plans can be created in USD/EUR/GBP (page.tsx:15; plans/new/NewPlanForm.tsx:10).
- **Verified evidence:** page.tsx:12 InvoiceRow.currency exists but columns 45-47 use cellType 'amount' -> DataTable.tsx:128-133 formatMoney() which always prefixes '₹' (formatters.ts:90-139, no currency arg). NewPlanForm.tsx:9 allows INR/USD/EUR/GBP. Observation's line 15 is the end of the interface. Whether non-INR invoices occur in practice depends on backend.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/billing/invoices/page.tsx`
- **Fix steps:**
  1. Extend formatMoney(minor, currency='INR') (INR path unchanged; others via Intl currency formatting with BigInt-safe scaling).
  2. Add DataTable cellType 'money' with optional column prop currencyKey (server-safe, since page is a Server Component and cannot pass render).
  3. Use it on Total/Paid/Outstanding in invoices/page.tsx with currencyKey:'currency'.
  4. Decide whether totals across mixed currencies are ever summed (none here).
- **Acceptance:**
  - Row with currency 'USD' renders '$', INR rows unchanged with lakh grouping.
  - Existing DataTable amount tests still pass.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money display in a shared table; regression tests for INR formatting are essential.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-08

### GAP-BILLING-INVOICES-05  ·  LOW  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Period and Issued are printed raw (ISO timestamps, blank when null for drafts) — cellValue falls to String(value ?? '') (page.tsx:45,49; DataTable.tsx:127-142).
- **Verified evidence:** invoices/page.tsx:43,48 'Period' (periodMonth) and 'Issued' (issuedAt) have no cellType; DataTable.tsx:125-140 cellValue returns String(row[key] ?? ''), so issuedAt prints as raw ISO and null prints blank (not '—'). periodMonth is probably 'YYYY-MM' rather than a full ISO timestamp (format not verifiable). formatIndianDate exists (formatters.ts:2-7) but has no timeZone and outputs dd/mm/yyyy; no DataTable date cellType.
- **Files to change:** `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/billing/invoices/page.tsx`
- **Fix steps:**
  1. Add DataTable cellType 'date' (formatIndianDate-style, null -> '—') and 'datetime' (IST, dd Mon yyyy hh:mm).
  2. Set timeZone:'Asia/Kolkata' in the formatter so server-render (UTC) does not shift the day.
  3. Add formatPeriodMonth('2026-09') -> 'Sep 2026' and use as a render/cellType for Period.
  4. Update export/sort key mapping at DataTable.tsx:~268 so sort still uses raw value.
- **Acceptance:**
  - issuedAt null -> '—'; '2026-09-01T20:00:00Z' -> '02 Sep 2026' (IST).
  - Sorting by Issued still chronological.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table change; date timezone bugs near midnight.


---
## /billing/invoices/[id]  —  `billing/invoices-detail.html`

- **Source:** `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`
- **Design reference:** `redesign/billing/invoices-detail.html`

### GAP-BILLING-INVOICES-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Cancel dialog says the IRN must be cancelled within 24 hours per NIC rules, but canCancel only checks status === 'generated' and ignores ackDate (InvoiceActions.tsx:23-24,158-161); staff learn the window has closed only after a round-trip.
- **Verified evidence:** InvoiceActions.tsx:24 canCancel = einvoice?.status === 'generated' (no time check); dialog copy at 168-170 says cancel 'must be done within 24 hours per NIC rules'. EInvoiceStatus (page.tsx:109-122) carries ackDate, unused for gating. Note dialog already has requireReason (line 411); ConfirmDialog fix in the theme text is already done. Line numbers in observation (23-24,158-161) are slightly off (actual 23-24, 166-170). Whether the backend also enforces the window cannot be seen (billing-service absent).
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/InvoiceActions.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add helper irnCancelDeadline(ackDate) returning ackDate+24h (Date); compute in InvoiceActions.
  2. Set canCancel = status==='generated' && now < deadline; when past, keep button disabled and show helper text 'IRN cancellation window closed on <IST datetime>; issue a credit note instead' (confirm wording with finance).
  3. When open, show remaining time in dialog description; if ackDate is null treat as unknown and allow, letting server decide.
  4. Keep server error surfacing in cancelError as backstop.
- **Acceptance:**
  - Unit test: ackDate 25h ago -> Cancel IRN disabled with closed-window text; 2h ago -> enabled and dialog shows deadline.
  - Missing ackDate leaves button enabled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Wrong client clock could block or allow; server remains authoritative. Confirm 24h NIC rule with finance before hard-disabling.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-06

### GAP-BILLING-INVOICES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Outage on the invoice request is titled 'Invoice not found' with just the badge (page.tsx:88-96), so a transient failure reads as a deleted invoice and offers no retry.
- **Verified evidence:** invoices/[id]/page.tsx:89-100: when invoice is null it renders PageHeader title 'Invoice not found' and, for invoiceSource==='error', only <DataSourceBadge source='error'> ('Couldn't load — showing nothing'); no retry. Worse, fetchJson marks every non-2xx (incl. a true 404) as source 'error' (apiClient.ts:141-144), so a real 404 also gets the badge instead of the EmptyState. LoaderResult already carries status/errorMessage (apiClient.ts:33-42) and hr/apar/[id]/page.tsx:97-121 shows the working pattern. Lines in observation (88-96) actually 89-100 (after offset).
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status/errorMessage from getInvoiceDetail.
  2. Compute isNotFound = invoiceSource==='error' && status===404.
  3. If invoiceSource==='error' && !isNotFound render PageHeader title 'Invoice' with <LoadErrorState result={{status,errorMessage}} area='invoice' backHref='/billing/invoices'/> (handles 403 and retry via RefreshErrorState); drop the bare badge.
  4. Otherwise (null and not error, or 404) keep the 'Invoice not found' EmptyState.
- **Acceptance:**
  - Mock fetch 500: page shows retryable error state, not 'Invoice not found'.
  - Mock 404: shows Invoice not found EmptyState.
  - Mock 403: shows access restricted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.

### GAP-BILLING-INVOICES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** E-invoice fetch cannot tell 404 from an outage (source deliberately ignored, page.tsx:76-83,98). On an outage einvoice is null, the EmptyState 'No e-invoice generated' shows and Generate stays enabled — risk of a duplicate IRN request while GSTN status is actually unknown.
- **Verified evidence:** page.tsx:76-81 (getEInvoiceStatus) and 102 (`void einvoiceSource`) discard the source; the comment at 68-75 claims fetchJson cannot tell 404 from outage but LoaderResult.status exists (apiClient.ts:33-35). On outage einvoice=null so InvoiceActions.tsx:23 canGenerate=(!einvoice) is true, the 'No e-invoice generated' EmptyState (287-291) shows and Generate stays enabled. Whether the backend generate-irn endpoint is idempotent cannot be verified (billing-service absent). Line refs in observation (76-83,98) approx.
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`, `apps/web/src/app/(app)/billing/invoices/[id]/InvoiceActions.tsx`
- **Fix steps:**
  1. In page.tsx keep status from getEInvoiceStatus; compute einvoiceUnknown = source==='error' && status!==404 (404 = genuinely not generated).
  2. Pass einvoiceUnknown to InvoiceActions; when true render an inline notice with a retry (small client button calling router.refresh(), or RefreshErrorState with what/next copy 'GSTN status unknown') instead of the EmptyState.
  3. In InvoiceActions set canGenerate=false and canCancel=false when einvoiceUnknown; aria-describe why.
  4. Update the stale comment block.
- **Acceptance:**
  - Mock einvoice fetch 503 with invoice OK: shows 'status unknown' + Retry, Generate disabled.
  - Mock 404: EmptyState and Generate enabled.
  - After successful retry, buttons follow real status.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Prevents duplicate IRN requests (statutory/GSTN impact). Backend should still enforce idempotency; not verifiable here.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-03

### GAP-BILLING-INVOICES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** While status is 'pending' both buttons are disabled and the only guidance is a toast saying 'refresh shortly' (InvoiceActions.tsx:44-49); no polling or refresh control, so staff cannot see when the IRN lands.
- **Verified evidence:** InvoiceActions.tsx:23-24: status 'pending' makes canGenerate and canCancel both false. Guidance is the success message set after submit (35-39 / 284-288, 'refresh shortly'), which exists only in that session; on a fresh visit to a pending invoice there is no message at all, and no polling/refresh control (router.refresh() only once after submit, line 289). Observation's line refs 44-49 are off.
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/InvoiceActions.tsx`, `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`
- **Fix steps:**
  1. When einvoice.status==='pending' render a notice 'Awaiting GSTN response' with a 'Refresh status' Button calling router.refresh().
  2. Add a useEffect poll (router.refresh every ~5-10s, stop after N tries or when status leaves pending, pause when document hidden).
  3. Show requested time (einvoice.createdAt formatted) and a hint after long waits to contact support.
  4. Announce completion via role='status'.
- **Acceptance:**
  - Component test with fake timers: pending -> refresh called every interval; stops when props change to generated.
  - Manual: pending invoice shows notice and working refresh button.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Polling load on gateway; cap tries and back off.

### GAP-BILLING-INVOICES-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 re-confirmed in W1 SF-07b #2026: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Approvals table prints raw requestedBy / decidedBy ids and a raw ISO decidedAt (page.tsx:167-172); issuedBy / cancelledBy fields do the same (page.tsx:133,136) — ids instead of names on a maker-checker trail.
- **Verified evidence:** page.tsx:167-174 Approvals DataTable prints requestedBy, decidedBy, decidedAt with no cellType (DataTable cellValue falls to String(), DataTable.tsx:125-140); Details card prints issuedAt/paidAt/cancelledAt raw (134,136,137,138 region: lines 134-138) and issuedBy/cancelledBy ids (135,138). No user-name resolver exists in apps/web (grep). Observation's 133,136 are off by ~2. Backend field content (uuid vs name) cannot be verified.
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) (IST, 'dd Mon yyyy, hh:mm') to lib/formatters.ts and a DataTable cellType 'datetime' (server-safe) using it.
  2. Apply to decidedAt, issuedAt, paidAt, cancelledAt, and einvoice ackDate/cancelledAt.
  3. Resolve actor ids to display names: prefer backend returning requestedByName/decidedByName/issuedByName; else add a server helper batch-resolving ids via the existing user directory API (needs decision on endpoint).
  4. Until names exist, show short id in mono with title tooltip and '—' for null decidedBy.
- **Acceptance:**
  - Approvals row with decidedAt '2026-09-01T09:30:00Z' renders '01 Sep 2026, 03:00 pm IST'.
  - Actor column shows name (or documented fallback), never a full uuid.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Audit trail readability; wrong name mapping on a maker-checker trail would be misleading, so fall back to id when unresolved.
- **Depends on:** GAP-BILLING-INVOICES-05

### GAP-BILLING-INVOICES-DETAIL-07  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** StatusPill maps neither 'generated', 'cancelled', 'issued' nor 'filed', so e-invoice and invoice statuses use the neutral pill (StatusPill.tsx:5-36); the Status StatCard shows the raw lowercase enum string (page.tsx:112).
- **Verified evidence:** ds/StatusPill.tsx:2-30 STATUS_MAP has no 'generated', 'cancelled', 'issued' or 'filed' (it has failed, pending, paid, draft, closed); unmapped falls to variant 'info' (line ~35). InvoiceActions.tsx:324 uses StatusPill for einvoice.status; DataTable items/approvals use cellType status. The Status StatCard is raw: page.tsx:121 value={invoice.status} (observation says 112) and the Status field line 131 is raw too. Invoice status enum itself cannot be verified (billing-service absent).
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`
- **Fix steps:**
  1. Add to STATUS_MAP: generated:'good', issued:'info' (or 'good'), filed:'good', cancelled:'bad' (or 'mut'), partially_paid:'warn' if the enum has it.
  2. Wrap StatCard value and Status field with humanizeStatus(invoice.status) (import from @/lib/formatters) or render <StatusPill>.
  3. Add StatusPill test rows for the new keys.
- **Acceptance:**
  - StatusPill status='generated' has class 'pill good'; 'cancelled' not 'info'.
  - Invoice detail StatCard reads 'Issued', not 'issued'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** StatusPill is shared by 80+ tables; adding keys re-tones other modules that use these words (e.g. 'cancelled' elsewhere). Review call sites.
- **Depends on:** GAP-BILLING-INVOICES-03

### GAP-BILLING-INVOICES-DETAIL-08  ·  LOW  ·  confirmed  ·  theme MONEY

- [x] **Status** (w2/billing-part-1 2026-10-16: closed — removed back= prop from all three PageHeader instances in invoices/[id]/page.tsx; AutoBreadcrumb is now the sole back affordance; GWT test added in page.test.tsx)
- **W0 note:** partly fixed by #1873 — amounts now use formatMoneyIn(currency) and the breadcrumb is AutoBreadcrumb (client nav); breadcrumb AND PageHeader back='/billing/invoices' are both still rendered (two back affordances).
- **First-pass claim:** Page renders its own breadcrumb <nav> with plain <a> tags (full reload) on top of the PageHeader back link (page.tsx:99-104,105-109); all amounts use ₹ regardless of invoice.currency shown in the subtitle.
- **Verified evidence:** page.tsx:106-110 renders its own <nav> breadcrumb with plain <a> (full page loads) and 112-116 PageHeader back='/billing/invoices' (also an <a>-based Link inside PageHeader, but client nav). Amounts use formatMoney (lib/formatters.ts:90-139) which hard-codes '₹' with no currency param, while subtitle (line 114) shows invoice.currency. Observation's 99-109 are off; plans/[id] has same breadcrumb pattern. Whether invoices are ever non-INR cannot be verified in backend, but plans can be created in USD/EUR/GBP (NewPlanForm.tsx:9).
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Remove the hand-rolled <nav> or replace with the shared AutoBreadcrumb (_components/AutoBreadcrumb.tsx) using next/link.
  2. Add formatMoney(minor, currency='INR') option: INR keeps lakh grouping and ₹; other codes use Intl.NumberFormat('en-IN',{style:'currency',currency}) on BigInt-derived major/minor string (no float on large values).
  3. Pass invoice.currency to all StatCard/field amounts; add DataTable cellType 'money' with currencyKey for line items/approvals.
- **Acceptance:**
  - Invoice with currency USD shows '$1,234.00' not '₹1,234.00'.
  - Breadcrumb links use client navigation (no full reload) and only one back affordance shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money display; keep INR path byte-identical to avoid regressions across finance screens.
- **Depends on:** GAP-BILLING-INVOICES-04

### GAP-BILLING-INVOICES-DETAIL-09  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Signed QR payload is dumped as monospace text (InvoiceActions.tsx:88-92) instead of a scannable QR image.
- **Verified evidence:** InvoiceActions.tsx:93-98 (observation 88-92) renders einvoice.signedQrCode as 11px mono wrapped text. The signed QR payload is a long JWT; no QR rendering exists. The web package.json is not in the snapshot so whether a QR library is installed cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/billing/invoices/[id]/InvoiceActions.tsx`
- **Fix steps:**
  1. Decide on a dependency (e.g. qrcode.react, client-side, MIT) and add to apps/web package.json (decision).
  2. Render <QRCodeSVG value={signedQrCode} size={160}/> inside a labelled figure with alt/aria-label 'E-invoice signed QR code'.
  3. Keep the raw payload inside a collapsed <details> 'Show signed payload' with a copy button.
  4. Include QR in the print stylesheet (globals-print.css) if invoices are printed.
- **Acceptance:**
  - Generated invoice shows a scannable QR (verify with phone against IRP verifier).
  - Payload hidden until expanded.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** New dependency needs supply-chain approval; QR must encode exactly the signed payload (no truncation).


---
## /billing/list  —  `billing/list.html`

- **Source:** `apps/web/src/app/(app)/billing/list/page.tsx`
- **Design reference:** `redesign/billing/list.html`

### GAP-BILLING-LIST-01  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Route duplicates /billing/plans (same loader, same 'Billing — Plans' title) and is unreachable from the hub (list/page.tsx:5-13; billing/page.tsx:8-12); two URLs for one list splits bookmarks and analytics.
- **Verified evidence:** list/page.tsx:4-13 identical loader (getBillingPlans) and title to plans/page.tsx:4-19; not linked from billing/page.tsx:8-14, sidebar, or navRouteManifest.ts (only /billing and /billing/plans at 30-31). Same as HOME-02.
- **Files to change:** `apps/web/src/app/(app)/billing/list/page.tsx`, `apps/web/src/app/(app)/billing/list/loading.tsx`
- **Fix steps:**
  1. Delete billing/list route folder.
  2. Add redirect /billing/list -> /billing/plans in next.config.
  3. Check analytics/route tests referencing it.
- **Acceptance:**
  - /billing/list redirects to /billing/plans; no billing/list files.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-HOME-02

### GAP-BILLING-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Description says 'Read-only list' while /billing/plans, the same data, offers '+ New Plan' (plans/page.tsx:11-18) — conflicting statements about the same list.
- **Verified evidence:** list/page.tsx:9 says 'Read-only list loaded from the Billing service API.' while plans/page.tsx:10,14-16 says 'All billing plans. Create new plans or view details.' and adds '+ New Plan'. Both use the same data; note the plans page also has no row link to /billing/plans/[id] because ModuleListTable does not link rows (ModuleListTable.tsx:~48-58), so 'view details' is not actually delivered either.
- **Files to change:** `apps/web/src/app/(app)/billing/list/page.tsx`, `apps/web/src/app/(app)/billing/plans/page.tsx`
- **Fix steps:**
  1. Resolved by removing /billing/list (see LIST-01).
  2. Separately, either add row links to plan detail on /billing/plans (via a dedicated PlansTable using DataTable rowLinkKey) or drop 'or view details' from its description.
- **Acceptance:**
  - Only one plans list remains; its description matches its actions.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-LIST-01

### GAP-BILLING-LIST-03  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** Closed as obsolete (UAT B4, 2026-10-27): apps/web/src/app/(app)/billing/list does not exist on origin/main; next.config.mjs redirects /billing/list to /billing/plans permanently.
- **First-pass claim:** loading.tsx draws four stat blocks and a table (list/loading.tsx:6-13) but the loaded page has no stat cards.
- **Verified evidence:** list/loading.tsx:7-12 draws 4 stat cards (h-24) and h-80 table; list/page.tsx renders only ModuleListPage (PageHeader + Records card), no stat cards.
- **Files to change:** `apps/web/src/app/(app)/billing/list/loading.tsx`
- **Fix steps:**
  1. Moot if route removed (LIST-01). If kept, replace with SkeletonTable under a title bar inside page-main; drop the stat grid.
- **Acceptance:**
  - Skeleton matches loaded shape: header, one table card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-BILLING-LIST-01

### GAP-BILLING-LIST-04  ·  LOW  ·  confirmed  ·  theme LAYOUT (was DEADROUTE)

- [x] **Status** Closed as obsolete (UAT B4, 2026-10-27): billing/list/page.tsx is gone on origin/main and no file under apps/web/src/app/(app)/billing uses ModuleListPage; the billing list pages are bespoke DataTable pages.
- **First-pass claim:** No page-main wrapper: unlike its siblings the list page renders ModuleListPage directly (list/page.tsx:8-13), so spacing differs from /billing/plans.
- **Verified evidence:** list/page.tsx:6-12 returns <ModuleListPage> directly; ModuleListPage.tsx:20-30 returns a fragment (PageHeader + table) with no container, whereas plans/page.tsx:7 and payments/page.tsx:7 wrap in <div className='page-main'>. Not a dead route issue.
- **Files to change:** `apps/web/src/app/(app)/billing/list/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Preferred: delete route (LIST-01).
  2. Better systemic fix: have ModuleListPage wrap its output in <div className='page-main wrap' aria-labelledby='page-heading'> and remove per-page wrappers, so no caller can omit it.
- **Acceptance:**
  - All ModuleListPage callers render inside page-main; visual spacing identical between billing pages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Removing per-page wrappers touches many module pages; do it in one sweep with visual check.
- **Depends on:** GAP-BILLING-LIST-01


---
## /billing/payments  —  `billing/payments.html`

- **Source:** `apps/web/src/app/(app)/billing/payments/page.tsx`
- **Design reference:** `redesign/billing/payments.html`

### GAP-BILLING-PAYMENTS-01  ·  HIGH  ·  confirmed  ·  theme MONEY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** A payments page with no money: rows are reduced to id/label/sublabel/status/meta (loaders.ts:1656-1694; ModuleListTable.tsx:38-58) — no amount, mode, invoice or paid date, and no link to the invoice paid.
- **Verified evidence:** payments/page.tsx:4-12 uses generic ModuleListPage; loaders.ts:1656-1694 mapModuleRows keeps only id, label (name/title/subject/label/code/...), sublabel (dept/category/type/vendor/description), status, meta (code/fileNo/contractNo/channel/month). getBillingPayments = moduleLoader (line ~1710). ModuleListTable.tsx (26-60) renders ID/Name/Detail/Status/Meta only. No amount, mode, invoice ref or paid date is mapped; rows without id or label are dropped (line 1667), so payments lacking name/code disappear silently. Actual payment API fields cannot be verified (billing-service absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/billing/payments/page.tsx`, `new: apps/web/src/app/(app)/billing/payments/PaymentsTable.tsx`
- **Fix steps:**
  1. Confirm payment DTO fields with billing-service (id, invoiceId, amountMinor, currency, mode, referenceNo, status, paidAt).
  2. Add a bespoke getBillingPayments mapper (like mapContractsListRows) with a typed PaymentRow; do not use mapModuleRows.
  3. Render with DataTable (as invoices/page.tsx): Reference, Invoice (link to /billing/invoices/<invoiceId>), Mode, Amount (cellType amount), Status (cellType status), Paid on (date cellType); sortable, filterable, pageSize 15.
  4. Handle source==='error' with LoadErrorState (see INVOICES-01).
- **Acceptance:**
  - Payments row shows amount in ₹ lakh format, mode, paid date, and links to the invoice.
  - Payment without a name still appears.
  - Mock 500 shows retry state.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Finance screen; amounts must come as minor units strings and use formatMoney. Do not guess field names.
- **Depends on:** GAP-BILLING-INVOICES-05, GAP-BILLING-INVOICES-04

### GAP-BILLING-PAYMENTS-03  ·  MEDIUM  ·  partly  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** When the code is used as label it is also emitted as Meta (loaders.ts:1679-1684), so the same reference prints twice per row; ID column shows a truncated raw uuid (ModuleListTable.tsx:44).
- **Verified evidence:** loaders.ts:1670-1684: label = name ?? title ?? subject ?? label ?? code ...; meta = code ?? fileNo ... So code prints twice only when the payment has no name/title/subject/label (then label=code and meta=code); if a name exists meta is the code and no duplicate. ModuleListTable.tsx:50 shows row.id.slice(0,8) as raw uuid prefix in the ID column (obs cites line 44). Payment field shape unverified.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In the bespoke payments mapper (PAYMENTS-01) set label to reference/receipt number and omit meta when equal to label.
  2. Or generically in mapModuleRows: skip meta if meta===label.
  3. Drop the raw ID column for payments (keep uuid only in link).
- **Acceptance:**
  - Unit test in loaders.moduleRows.test.ts: row {id,code:'RCPT-1'} yields no duplicate meta.
  - Payments table has no uuid column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** mapModuleRows is shared by many modules; the dedupe tweak changes their Meta column when equal to label.
- **Depends on:** GAP-BILLING-PAYMENTS-01

### GAP-BILLING-PAYMENTS-04  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** No filter, sort or pagination on the generic table (ModuleListTable.tsx:36-60); failed payments and pending cheques cannot be isolated. Wrapper div has page-main without wrap (payments/page.tsx:9).
- **Verified evidence:** ModuleListTable.tsx:26-60 has no filter, sort or pagination (plain <table>, all rows from useSeededResource); status printed as text (row.status, line 54) not StatusPill. payments/page.tsx:7 wrapper is 'page-main' without 'wrap' (observation says line 9). moduleLoader has no pagination/limit params so large ledgers render fully.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/billing/payments/page.tsx`
- **Fix steps:**
  1. Supersede with the DataTable-based PaymentsTable from PAYMENTS-01 (sortable, filterable, pageSize, StatusPill).
  2. Add a status filter (Segmented: All/Failed/Pending/Paid) and use server-side page/limit if the API supports it (cannot verify).
  3. Use className='page-main wrap' on the page.
- **Acceptance:**
  - Filtering 'failed' shows only failed payments.
  - Table paginates at 15 rows.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Client-side filtering of a capped fetch can hide rows; prefer server filters when the API allows.
- **Depends on:** GAP-BILLING-PAYMENTS-01


---
## /billing/plans  —  `billing/plans.html`

- **Source:** `apps/web/src/app/(app)/billing/plans/page.tsx`
- **Design reference:** `redesign/billing/plans.html`

### GAP-BILLING-PLANS-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises 'view details' but rows are not links: ModuleListTable renders plain <td>s with no href (ModuleListTable.tsx:43-53), so /billing/plans/[id] is unreachable from the list.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:79-86 renders each row as plain <td>s (id slice, label, sublabel, status, meta) with no <a>/Link; apps/web/src/app/(app)/billing/plans/page.tsx:10 subtitle says 'or view details'. Route apps/web/src/app/(app)/billing/plans/[id]/page.tsx exists (getBillingPlanById) so it is reachable only by typing the URL.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/(app)/billing/plans/page.tsx`
- **Fix steps:**
  1. Add optional `rowHref?: (row: ModuleRowSummary) => string` prop to ModuleListTable and ModuleListPage; render the label cell as <Link href={rowHref(row)}>.
  2. Pass rowHref={(r)=>`/billing/plans/${r.id}`} from plans/page.tsx.
  3. Note ModuleListPage is a server component: pass a serialisable base path prop (`rowHrefBase`) instead of a function, since the table is a client component.
  4. Same prop can fix other module lists that promise details.
- **Acceptance:**
  - Component test: rows render anchors with href /billing/plans/<id>.
  - Manual: click a plan name; the detail page opens.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-BILLING-PLANS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** A plans list with no price: mapModuleRows maps only name/description/status/code (loaders.ts:1662-1684); amount, interval and govt-exempt never reach the table, so plans cannot be compared or verified after creation.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:1656-1694 mapModuleRows copies only label(name/title/code), sublabel(description..), status and meta(code); getBillingPlans (:1707) uses it via moduleLoader, so amount/priceMinor, currency, interval, govtExempt never reach the list. The detail page reads plan.amount/currency/interval, and create sends priceMinor: field names between create, list and detail are inconsistent and the billing payload is not verifiable here.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/billing/plans/page.tsx`, `apps/web/src/app/(app)/billing/plans/PlansTable.tsx`
- **Fix steps:**
  1. Confirm plan list payload field names with billing service (priceMinor vs amount, interval, govtExempt, currency).
  2. Add a bespoke mapBillingPlanRows (pattern used by mapContractsListRows) and a PlanSummary type in @civitasone/types with priceMinor: string.
  3. Create billing/plans/PlansTable.tsx (client, useSeededResource) with columns Code, Name, Price (formatMoney), Interval, Govt exempt, Status (StatusPill).
  4. Switch plans/page.tsx from ModuleListPage to PageHeader + PlansTable; keep the +New Plan action.
- **Acceptance:**
  - Unit test on mapper: payload with priceMinor '49900' yields price cell '₹499.00'.
  - Manual: a newly created plan shows price/interval in the list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display: must use paise formatter, not the float `amount` shown on detail page.
- **Depends on:** GAP-BILLING-PLANS-01, GAP-BILLING-PLANS-04, GAP-BILLING-PLANS-06

### GAP-BILLING-PLANS-03  ·  MEDIUM  ·  confirmed  ·  theme SILENT-DROP (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows without id or a name/title/code label are dropped silently (loaders.ts:1662-1671); a payload shape change turns the page into 'No records' rather than an error.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:1671 `if (!id || !label) continue;` silently drops rows lacking id or any of name/title/subject/label/code/contractNo/fileNo. getArrayPayload null returns invalid_payload error (correct), but an array of unexpected shape maps to [] and the table shows 'No records' (ModuleListTable.tsx:65-66). moduleLoader has no responseSchema (:1696-1703).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_data/loaders.test.ts`
- **Fix steps:**
  1. In mapModuleRows return null when rows.length>0 but mapped.length===0 (all rows unparseable) so fetchJson reports source:'error'; log dropped count via telemetry.
  2. Add zod responseSchema for plans/subscriptions in moduleLoader options (accept a schema param) and validate at boundary.
  3. Add unit tests in loaders.moduleRows.test.ts for all-invalid arrays and a partially valid array.
- **Acceptance:**
  - Unit: [{foo:1}] yields null, [] yields [], mixed yields valid rows only.
  - Manual: mock malformed payload; page shows load-error state, not 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep the empty-list fix from PR #813 (empty array stays a valid empty state).

### GAP-BILLING-PLANS-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw uuid shown as the first 8 characters (ModuleListTable.tsx:44) — not a usable plan identifier; the human plan code is buried in the Meta column.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:81 renders `row.id.slice(0, 8)` in mono as the first column; the human code is only in the Meta column (mapModuleRows meta = code, apps/web/src/app/_data/loaders.ts:1680-ish). Accurate.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/billing/plans/PlansTable.tsx`
- **Fix steps:**
  1. In the new PlansTable (see PLANS-02) show Code as the first column and Name second; drop the truncated id column.
  2. For the generic ModuleListTable, make the ID column optional (`showId` prop default false) and prefer meta/code when present.
- **Acceptance:**
  - Component test: the first cell shows the plan code, no 8-char uuid is rendered.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-PLANS-02

### GAP-BILLING-PLANS-05  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** '+ New Plan' is shown to every role (plans/page.tsx:16-18); no role check, so a non-admin finds out from a server error after filling the form.
- **Verified evidence:** apps/web/src/app/(app)/billing/plans/page.tsx:14-16 renders the +New Plan link unconditionally; billing/layout.tsx only applies ModuleGate (entitlement), no role check. A role helper exists for server pages (lib/auth/roleGuard.ts getSessionRoles, used in hr/vigilance/page.tsx:44). Which roles may create plans, and whether the billing service enforces it, is not verifiable (service absent).
- **Files to change:** `apps/web/src/app/(app)/billing/plans/page.tsx`, `apps/web/src/app/(app)/billing/plans/new/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Decide the role set allowed to create plans (e.g. tenant admin / billing admin) and put it in a BILLING_PLAN_ADMIN_ROLES constant.
  2. In plans/page.tsx call getSessionRoles() and render the New Plan button only if allowed.
  3. In plans/new/page.tsx call requireAnyRole(BILLING_PLAN_ADMIN_ROLES, '/billing/plans').
  4. Verify the billing service returns 403 for non-admin POST (backend check).
- **Acceptance:**
  - Manual: non-admin does not see +New Plan and is redirected from /billing/plans/new.
  - Backend test: POST as non-admin returns 403.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Approval/authority: UI hiding is convenience only; server enforcement must be confirmed.

### GAP-BILLING-PLANS-06  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Status printed as the raw lowercase enum, not a StatusPill (ModuleListTable.tsx:47); empty state has no 'Create the first plan' action.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:84 prints `row.status ?? '—'` as raw text; StatusPill exists (ds/StatusPill.tsx, STATUS_MAP has active/inactive/archived/draft). Empty state at :66 is generic 'No records / Nothing to show yet' with no action; the page passes the New Plan button only above the table.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/billing/plans/PlansTable.tsx`
- **Fix steps:**
  1. Render <StatusPill status={row.status}> in the status cell (generic table and PlansTable).
  2. Add optional `emptyAction` prop to ModuleListTable (or handle in PlansTable) to show 'Create the first plan' link when data is empty, respecting the role gate from PLANS-05.
  3. Verify billing plan statuses map to STATUS_MAP tones.
- **Acceptance:**
  - Component test: status 'active' renders a good-tone pill; empty list renders the create link for admins.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-PLANS-02, GAP-BILLING-PLANS-05


---
## /billing/plans/[id]  —  `billing/plans-detail.html`

- **Source:** `apps/web/src/app/(app)/billing/plans/[id]/page.tsx`
- **Design reference:** `redesign/billing/plans-detail.html`

### GAP-BILLING-PLANS-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Money printed raw as 'INR {amount}' with no paise→₹ conversion or lakh grouping (page.tsx:63,80), unlike invoices which use formatMoney; if the API returns paise the plan looks 100x too expensive.
- **Verified evidence:** plans/[id]/page.tsx:45 and 61 print `${currency} ${amount}` where amount = String(plan.amount) (line 22): raw string, no formatMoney, no lakh grouping (observation's 63,80 are wrong). Also a field mismatch: NewPlanForm.tsx:70-77 POSTs priceMinor (paise) and never sends interval, but the detail reads plan.amount/plan.interval; if the API returns priceMinor the page shows '—'. API response shape for GET plan cannot be verified (billing-service absent).
- **Files to change:** `apps/web/src/app/(app)/billing/plans/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Confirm the GET /billing/plans/:id fields (priceMinor vs amount, interval).
  2. Read priceMinor (string/bigint minor units) and format with formatMoney(priceMinor, plan.currency) (see INVOICES-DETAIL-08 for currency support); show '—' when missing.
  3. Type the plan payload (zod schema or interface) instead of Record<string, unknown> casts in getBillingPlanById.
  4. Remove `${currency} ${amount}` in both StatCard and Amount field.
- **Acceptance:**
  - Plan with priceMinor '4999900' renders '₹49,999.00'.
  - Missing price renders '—', never 'INR undefined'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display; 100x error risk if unit assumed wrong, so confirm API unit before change.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-08

### GAP-BILLING-PLANS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed request produces plan=null and the page says 'Plan not found — removed or the ID is invalid' with no badge or retry (page.tsx:9-17); the DataSourceBadge is only reachable on the found path (page.tsx:45).
- **Verified evidence:** plans/[id]/page.tsx:6,8-17: any null plan (fetch error or 404) renders EmptyState 'Plan not found ... removed or the ID is invalid' with no badge or retry; the DataSourceBadge at line 42 sits only on the found path (found path can't be error since data is null on error). getBillingPlanById (loaders.ts ~1712) returns LoaderResult with status, so 404 vs outage is distinguishable.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/[id]/page.tsx`
- **Fix steps:**
  1. Destructure source, status, errorMessage.
  2. If source==='error' && status!==404 render PageHeader + <LoadErrorState result area='plan' backHref='/billing/plans'/>.
  3. Only render 'Plan not found' when status===404 or loader returned null without error.
  4. Remove unreachable badge at line 42.
- **Acceptance:**
  - Mock 500: retry state; mock 404: Plan not found; mock 403: access restricted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-INVOICES-DETAIL-03

### GAP-BILLING-PLANS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Missing fields are papered over: status defaults to 'active' and name to 'Unnamed Plan' (page.tsx:20,26), so an incomplete payload looks like a healthy active plan.
- **Verified evidence:** plans/[id]/page.tsx:20 name defaults to 'Unnamed Plan' and :25 status defaults to 'active'; :23 currency defaults to 'INR'. A payload missing status therefore shows active and an INR amount. Raw status also printed unformatted (lines 47,63).
- **Files to change:** `apps/web/src/app/(app)/billing/plans/[id]/page.tsx`
- **Fix steps:**
  1. Replace defaults with '—' for name/status/currency (no fabricated values) and use <StatusPill status=...> only when status present.
  2. Validate the payload with a zod schema in getBillingPlanById; on parse failure return source 'error' (invalid_payload) so the error state shows.
  3. Humanize status via humanizeStatus.
- **Acceptance:**
  - Payload without status shows '—' not Active.
  - Payload without currency does not display 'INR'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Removing the currency default could show '—' for legacy INR-only plans; confirm backend always returns currency.
- **Depends on:** GAP-BILLING-PLANS-DETAIL-02

### GAP-BILLING-PLANS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme LAYOUT (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only: no edit, deactivate or 'subscriptions on this plan' link; breadcrumb <nav> uses plain <a> tags and duplicates the PageHeader back link (page.tsx:34-41,55-59). Created shows a sliced ISO date (page.tsx:29,66).
- **Verified evidence:** plans/[id]/page.tsx has no actions (no PageHeader actions prop, no links to subscriptions); breadcrumb <nav> with plain <a> at 30-34 (observation 34-41) duplicates PageHeader back at 39; `createdAt.slice(0, 10)` at 48 shows ISO date yyyy-mm-dd (obs 29,66 off). No edit/deactivate endpoints are known from the web code, so 'edit' needs backend confirmation.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/[id]/page.tsx`, `apps/web/src/app/_components/AutoBreadcrumb.tsx`
- **Fix steps:**
  1. Remove hand-rolled breadcrumb (or use AutoBreadcrumb with next/link) and keep PageHeader back.
  2. Format Created with formatIndianDate(createdAt).
  3. Add PageHeader actions: link 'View subscriptions' to /billing/subscriptions (plan filter only if that page supports it; not verified).
  4. Edit/deactivate: decision, only if backend PATCH exists; would require ConfirmDialog and audit event.
- **Acceptance:**
  - Created shows '01/09/2026'-style Indian date.
  - Only one back/breadcrumb affordance; links do client-side navigation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Edit/deactivate would be new mutations (audit, permissions); keep out of this fix.


---
## /billing/plans/new  —  `billing/plans-new.html`

- **Source:** `apps/web/src/app/(app)/billing/plans/new/page.tsx`
- **Design reference:** `redesign/billing/plans-new.html`

### GAP-BILLING-PLANS-NEW-01  ·  HIGH  ·  confirmed  ·  theme MONEY

- [x] **Status** Closed by b03737d61 (UAT B4, 2026-10-27): migration 0023 adds plans.billing_plans.billing_interval (monthly|quarterly|yearly, default monthly); POST /v1/billing/plans accepts interval, GET returns it; NewPlanForm restores the Billing Interval select and sends it; plan detail shows it. Tests: plans-interval.test.ts, NewPlanForm.test.tsx, plans/[id]/page.test.tsx.
- **W0 note:** partly fixed by #1873 — the dead Billing Interval select was removed rather than persisted (billing-service createPlanBody has no interval field); acceptance (interval sent/shown on detail) not met, needs a backend decision.
- **First-pass claim:** Billing Interval is a required-looking field but is never sent: the POST body carries name, code, priceMinor, currency and govtExempt only (NewPlanForm.tsx:83-92). Whatever the user picks is silently discarded.
- **Verified evidence:** apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx:18 holds `interval` state and :180-197 renders the Billing Interval select, but the POST body at :69-79 sends only name, code, priceMinor, currency, govtExempt. The chosen interval is discarded. The plan detail page ([id]/page.tsx) reads plan.interval, so the field is expected to exist server-side. Billing service is not in the snapshot, so whether POST /v1/billing/plans accepts `interval` cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`
- **Fix steps:**
  1. Confirm with the billing service contract that POST /v1/billing/plans accepts `interval` (monthly|quarterly|yearly) and add it to the shared plan type in @civitasone/types.
  2. Add `interval` to the JSON.stringify body in handleSubmit (NewPlanForm.tsx:73-79).
  3. If the backend cannot accept it yet, remove the select rather than leave a dead control.
  4. Use a zod schema (shared with the API type) to build the body so the field cannot silently drift again.
- **Acceptance:**
  - Component test: choose Quarterly, submit; the mocked fetch body contains interval:'quarterly'.
  - Manual: create a plan as Yearly, open /billing/plans/[id]; Interval shows Yearly.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; if the backend rejects unknown keys, sending interval before the contract is confirmed will fail every create.
- **Depends on:** GAP-BILLING-PLANS-NEW-03

### GAP-BILLING-PLANS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Errors are one form-level line; the invalid input gets aria-invalid but no aria-describedby and no focus move (NewPlanForm.tsx:38-64,126,140,158), unlike the GSTN forms that link and focus each error.
- **Verified evidence:** apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx: validation failures set one message (:42-66 handlers) rendered in a single <p role=alert> at the bottom (:224-235); inputs only get aria-invalid (:116,:134,:158) and no aria-describedby/aria-errormessage, and there is no focus() call or ref. The form-level aria-describedby (:100) points at the message, but nothing moves focus. GSTN forms do link and focus errors (billing/gstn/VerifyGstinPanel.tsx:38,73; SubmitReturnPanel.tsx:81,121,143,190). Server fieldErrors from useFormError are ignored (only .message is used at :83). Line numbers in the finding are stale.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`, `apps/web/src/app/_components/ds/FormField.tsx`
- **Fix steps:**
  1. Create a shared ds <FormField> (label, control slot, error id, aria-describedby, aria-invalid) modelled on the GSTN panels' pattern.
  2. Hold a per-field error map instead of invalidField+single message; add refs for name/code/amount and focus the first invalid one in handleSubmit.
  3. Wire aria-describedby={errorId} on each input; render the inline error under the field with text plus icon (not colour only).
  4. Consume useFormError fieldErrors from the response so server-side validation errors land on the right field.
  5. Keep the top-level alert as a summary only.
- **Acceptance:**
  - Component test: submit empty form, the name input has focus and aria-describedby resolves to an element with the error text.
  - Manual with screen reader: error is announced when focus lands on the invalid field.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; UI only. Reusable across other hand-rolled forms.

### GAP-BILLING-PLANS-NEW-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Creating a priced plan has no confirmation and no reason/audit affordance; currency list includes USD/EUR/GBP for a Government-edition tenant while every invoice list amount is formatted ₹ (NewPlanForm.tsx:9-10).
- **Verified evidence:** True: apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx:9 `CURRENCIES = [INR,USD,EUR,GBP]` and the currency select (:161-176) is offered regardless of tenant edition; no ConfirmDialog or reason field; submit goes straight to POST (:69). Also the amount is converted with `Math.round(parseFloat(amount)*100)` (:56,:75), which is float math on money (CLAUDE.md rule 11) and can misround e.g. 1.005. Overstated: a client cannot emit the audit event (rule 8 says the service does it on mutation), so 'no audit affordance' is a server-side check I cannot see; and the claim that every invoice amount is formatted in rupees was not fully checked (invoices list uses totalMinor/currency strings, billing/invoices/page.tsx:8-14). formatMoney is INR-only, and the plan detail page prints raw currency-plus-amount text (plans/[id]/page.tsx).
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`, `apps/web/src/lib/money.ts`, `apps/web/src/lib/money.test.ts`
- **Fix steps:**
  1. Add `parseRupeesToPaise(input: string): bigint|null` in a new lib/money.ts using string split on '.' (max 2 decimals, no parseFloat); use it at NewPlanForm.tsx:56 and send priceMinor as a decimal string (matches invoices' *Minor string convention).
  2. Add a decision: restrict CURRENCIES to the tenant's configured currencies (default INR only for Government edition) via tenant settings or an entitlement; filter the select accordingly.
  3. Wrap submit in the existing ds ConfirmDialog summarising name, code, formatted price and interval before POST.
  4. Show a live preview under the Amount input (formatMoney of the parsed paise) so the unit is explicit.
- **Acceptance:**
  - Unit tests: parseRupeesToPaise('1.005')->null (3dp rejected), ('10.10')->1010n, ('0')->null.
  - Component test: Create Plan opens a confirm dialog and POST fires only after Confirm.
  - Government-edition tenant sees only INR.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Money: changing the priceMinor wire type (number to string) needs backend agreement; wrong currency on a plan changes invoices.
- **Depends on:** GAP-BILLING-PLANS-NEW-01

### GAP-BILLING-PLANS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Government exempt' defaults to checked with no help text (NewPlanForm.tsx:200-205); the tax consequence (GST-exempt billing?) is not stated, and a wrong default silently changes invoicing.
- **Verified evidence:** apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx:20 defaults `govtExempt` to true and :199-210 renders a bare 'Government exempt' checkbox with no help text or HelpTip; it is sent as-is (:77). What exemption does (GST exempt vs price exempt) is not stated anywhere on the page. Business meaning is a backend/product definition I cannot verify.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`
- **Fix steps:**
  1. Get the exact semantics from billing owner (does it zero GST, waive the fee, or mark plan as billable to govt tenants).
  2. Add helper text under the checkbox (aria-describedby) stating that consequence, or use the existing ds HelpTip/Term.
  3. Consider defaulting to unchecked so the exemption is a deliberate choice, and show the effect in the confirm dialog from NEW-03.
- **Acceptance:**
  - Manual: checkbox shows helper text and it is read by a screen reader with the label.
  - Component test: default state matches the agreed default and payload carries govtExempt accordingly.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Invoicing: a wrong default silently changes tax treatment on new plans.
- **Depends on:** GAP-BILLING-PLANS-NEW-03

### GAP-BILLING-PLANS-NEW-05  ·  LOW  ·  partly  ·  theme CONSISTENCY (was FABRICATED)

- [x] **Status** (w2/billing-part-1 2026-10-16: closed — replaced 5 Tailwind className usages in NewPlanForm.tsx with inline style props using var(--bad)/var(--good) CSS tokens; GWT tests added in NewPlanForm.test.tsx)
- **W0-10 note:** review found the W0 tick partly — step 1 done (browserFetch NewPlanForm.tsx:~125), but steps 2-3 not: no ds FormField/TextInput created (ls ds shows none) and tailwind classes remain at NewPlanForm.tsx:207 (grid classes) and :260 (text-red-600)
- **First-pass claim:** Uses fetch('/api/proxy/v1/billing/plans') (NewPlanForm.tsx:83) while sibling billing actions use browserJson('v1/billing/…'); hard-coded inline styles and tailwind classes (NewPlanForm.tsx:107-110) instead of the ds field components.
- **Verified evidence:** True: apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx:69 uses raw fetch('/api/proxy/v1/billing/plans') while sibling billing mutations use browserJson from @/lib/api/browserClient (billing/invoices/[id]/InvoiceActions.tsx:6,30; gstn/SubmitReturnPanel.tsx). This matters: browserFetch adds x-device-id and device trust headers (lib/api/browserClient.ts:20-33) that the raw fetch omits. Inline styles repeated on every control (:96,:113,:131...) and tailwind classes (:145 grid classes, :233 text-red-600) are real. Overstated: ds has no Input/Field/Select component (ls ds/), so 'instead of ds field components' cannot be done without creating one; Button is already the ds Button.
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`, `apps/web/src/app/_components/ds/FormField.tsx`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Replace fetch() at NewPlanForm.tsx:69 with browserJson/browserFetch('v1/billing/plans', {method:'POST', body}) and keep useFormError for failures.
  2. Create ds <FormField>/<TextInput>/<SelectInput> (shared with NEW-02) that encapsulate the repeated inline style block; export via ds/index.ts.
  3. Swap the inline style objects and tailwind colour classes for those components and design tokens.
- **Acceptance:**
  - Test: mocked browserJson is called with 'v1/billing/plans' and the payload; device headers present.
  - Visual: form renders identical in light/dark after refactor.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; header change could affect device-trust policy on this endpoint (should be an improvement).
- **Depends on:** GAP-BILLING-PLANS-NEW-02

### GAP-BILLING-PLANS-NEW-06  ·  LOW  ·  partly  ·  theme VALIDATION (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Plan Code is free text with a lowercase placeholder but a case-insensitive pattern (NewPlanForm.tsx:14,147-153); uniqueness is discovered only from the server error.
- **Verified evidence:** Real: placeholder 'e.g. standard_monthly' (:145), CODE_RE = /^[a-z0-9_-]+$/i (:10) and HTML pattern '[A-Za-z0-9_\-]+' (:152) accept upper case, so codes are case-insensitive on the client; nothing normalises case and uniqueness/case-collision rules are only discoverable from the server error (the response goes through formError.fromResponse which yields a generic message, :83). Mis-tagged: not fabricated data, it is a validation UX issue. Server-side uniqueness/case behaviour cannot be verified (billing service absent).
- **Files to change:** `apps/web/src/app/(app)/billing/plans/new/NewPlanForm.tsx`
- **Fix steps:**
  1. Decide canonical form (lowercase snake_case) and lowercase the code on input/blur; tighten CODE_RE and pattern to /^[a-z0-9_-]{2,64}$/.
  2. Show format hint under the field (aria-describedby): 'Lowercase letters, digits, - and _'.
  3. Read fieldErrors.code from the 409/422 response via useFormError and show it inline on the Plan Code field (depends on NEW-02 FormField).
- **Acceptance:**
  - Unit: 'Standard_Monthly' becomes 'standard_monthly' before submit.
  - Component: duplicate code response shows inline error on Plan Code and focuses it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; must match server-side case sensitivity or duplicates could pass.
- **Depends on:** GAP-BILLING-PLANS-NEW-02


---
## /billing/subscriptions  —  `billing/subscriptions.html`

- **Source:** `apps/web/src/app/(app)/billing/subscriptions/page.tsx`
- **Design reference:** `redesign/billing/subscriptions.html`

### GAP-BILLING-SUBSCRIPTIONS-01  ·  HIGH  ·  confirmed  ·  theme DEADCODE (was DEADROUTE)

- [x] **Status** Closed as obsolete (UAT B4, 2026-10-27): SubscriptionsTable.tsx (churnRisk column) is gone on origin/main; the subscription page is a single-record view and the API carries no churn score (only comments mention it).
- **First-pass claim:** Churn Risk can never render: SubscriptionRow.churnRisk is declared (SubscriptionsTable.tsx:9-18) and read (line 68) but mapModuleRows builds rows from id/label/sublabel/status/meta only (loaders.ts:1685-1691), so every cell is '—' and the PredictionBadge path is dead code.
- **Verified evidence:** apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx:26-33 declares churnRisk, :80-91 renders PredictionBadge when present; but the page feeds rows from getBillingSubscriptions = moduleLoader with mapModuleRows (apps/web/src/app/_data/loaders.ts:1656-1694,1708) which never sets churnRisk, so the cell is always '—'. Whether the billing/prediction service exposes churn data cannot be verified. Line refs in finding are stale.
- **Files to change:** `apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx`, `apps/web/src/app/(app)/billing/subscriptions/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Decide whether churn scoring exists: if yes, add a bespoke mapSubscriptionRows that copies churnRisk {probability, confidence, factors, isFallback} from the payload (or a separate prediction endpoint) and type it in @civitasone/types.
  2. If no, delete the churnRisk type and column and the PredictionBadge import to remove dead code.
  3. Add mapper unit test.
- **Acceptance:**
  - Unit: payload with churnRisk yields a row with churnRisk populated.
  - Manual: rows with a score show a badge; rows without show '—'.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low technical risk; showing an unvalidated ML score about customers is a policy risk (see -05).
- **Depends on:** GAP-BILLING-SUBSCRIPTIONS-02, GAP-BILLING-SUBSCRIPTIONS-05

### GAP-BILLING-SUBSCRIPTIONS-02  ·  MEDIUM  ·  confirmed  ·  theme SILENT-DROP (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** Rows lacking id or a name/title/code label are dropped silently by the mapper (loaders.ts:1662-1671); a subscription keyed only by tenantId/planId would vanish and the page would read 'No subscriptions'.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:1671 drops rows with no id or no name/title/subject/label/code/contractNo/fileNo. Subscriptions likely carry tenantId/planId rather than a name (payload not verifiable), in which case every row is dropped and SubscriptionsTable.tsx:59-60 shows 'No subscriptions' rather than an error.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx`
- **Fix steps:**
  1. Write mapSubscriptionRows: require id only; derive label from plan name/code or tenant name, fall back to plan id; never skip a row.
  2. Return null (error state) when an array is non-empty but no row parses.
  3. Add tests with a tenantId/planId-only payload.
- **Acceptance:**
  - Unit: {id, tenantId, planId, status} produces a row.
  - Manual: page shows the subscription instead of empty state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-PLANS-03, GAP-BILLING-SUBSCRIPTIONS-01

### GAP-BILLING-SUBSCRIPTIONS-03  ·  MEDIUM  ·  partly  ·  theme MISSING-DATA (was DEADROUTE)

- [x] **Status** (UAT B4 2026-10-27, review r1: CLOSED. GET /v1/billing/subscriptions returns planName, startDate, renewalDate and amountMinor and the page shows plan name (link), start, renewal and plan price. New tenant-scoped GET /v1/billing/subscriptions/history lists every subscription of the caller's tenant, newest first; migration 0025 replaces UNIQUE (tenant_id) with a partial unique index (one current subscription per tenant, any number of cancelled past ones). The page now shows a sortable DataTable with an Active / Past / All filter. Tests: services/billing-service/tests/subscription-history.test.ts and the page tests.)
- **W0 note:** partly fixed by #1873 — page now shows the single subscription with plan link, status pill and formatted dates; amount/price still not shown and no status filter (single-record view).
- **First-pass claim:** Subtitle says 'Active and past subscriptions' but there is no filter, sort or grouping and Status is the raw enum text (SubscriptionsTable.tsx:63); no plan, start/renewal date or amount, and no link to the plan or its invoices.
- **Verified evidence:** apps/web/src/app/(app)/billing/subscriptions/page.tsx:9 subtitle 'Active and past subscriptions loaded from the Billing service.'; the table (SubscriptionsTable.tsx:62-96) has generic columns ID/Name/Detail/Status/Churn/Meta, status raw at :79, no plan, dates or amount, no filter/sort, no row links. Real, but 'dead link' tag is wrong (no link promised); the subtitle also leaks implementation wording. Which fields the API returns is not verifiable.
- **Files to change:** `apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx`, `apps/web/src/app/(app)/billing/subscriptions/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm payload fields (planId/planName, startDate, renewalDate, amountMinor).
  2. Switch to ds DataTable with sortable columns: Tenant/Subscriber, Plan (link to /billing/plans/[id]), Status (StatusPill), Start, Renewal (formatIndianDate), Amount (formatMoney).
  3. Add a status Segmented filter (Active / Past / All) and rewrite the subtitle without 'loaded from the Billing service'.
- **Acceptance:**
  - Component test: status filter narrows rows; plan cell links to plan detail.
  - Manual: dates and amount visible.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-SUBSCRIPTIONS-01, GAP-BILLING-PLANS-06

### GAP-BILLING-SUBSCRIPTIONS-04  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1873, verified on main 9c5e9e9e9)
- **First-pass claim:** ID is a truncated raw uuid (SubscriptionsTable.tsx:62); no page-level back link, unlike the invoice pages (page.tsx:11).
- **Verified evidence:** apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx:76 shows row.id.slice(0,8); apps/web/src/app/(app)/billing/subscriptions/page.tsx:9 PageHeader has no back prop, whereas billing/invoices/page.tsx:36 sets back='/billing'. (plans list page has none either.)
- **Files to change:** `apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx`, `apps/web/src/app/(app)/billing/subscriptions/page.tsx`
- **Fix steps:**
  1. Add back='/billing' to the PageHeader.
  2. Replace the truncated id column with a human reference (subscriber/plan) from the new mapper; keep the id only in a link href.
- **Acceptance:**
  - Manual: back link goes to /billing.
  - Component test: no 8-char uuid text in rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-BILLING-SUBSCRIPTIONS-03

### GAP-BILLING-SUBSCRIPTIONS-05  ·  LOW  ·  partly  ·  theme AI-EXPLAINABILITY (was OTHER)

- [x] **Status** Closed as obsolete (UAT B4, 2026-10-27): no PredictionBadge or churn usage remains in apps/web/src/app/(app)/billing on origin/main (only explanatory comments).
- **First-pass claim:** Churn model output would be shown to a Government tenant without an audience note; PredictionBadge explainability factors are optional (SubscriptionsTable.tsx:11-15).
- **Verified evidence:** PredictionBadge factors are optional (app/_components/ds/PredictionBadge.tsx:11-12 and SubscriptionsTable.tsx:27-31), and no audience/purpose note exists. Currently latent because churnRisk is never populated (see -01). Additional finding: the badge colours by model confidence, not risk (PredictionBadge.tsx getColorClasses), so 90%-churn/high-confidence renders green, which misleads. Policy on showing ML output in government tenants is a decision I cannot verify.
- **Files to change:** `apps/web/src/app/(app)/billing/subscriptions/SubscriptionsTable.tsx`, `apps/web/src/app/_components/ds/PredictionBadge.tsx`
- **Fix steps:**
  1. Decide whether churn predictions are enabled for Government edition (entitlement flag); hide the column otherwise.
  2. If shown, require factors (make prop required for this usage) and add a caption 'Model estimate, for planning only' with a HelpTip.
  3. Add a risk-tone variant so colour reflects churn probability, not confidence.
- **Acceptance:**
  - Component test: no churn column when entitlement off.
  - Badge with 90% churn is not green.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Policy/compliance: automated scoring shown to public-sector staff without explainability.
- **Depends on:** GAP-BILLING-SUBSCRIPTIONS-01


---
## Backend verification items (service code absent from snapshot)

### GAP-BILLING-HOME-01  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by b32ba580d (UAT B4, 2026-10-27): verified server-side on origin/main: invoices, IRN and every GSTN route enforce billing roles; a plain tenant user gets 403. Test: services/billing-service/tests/b4-backend-verification.test.ts.
- **First-pass claim:** No role gate anywhere in the billing segment (layout.tsx:4-5, page.tsx:6-15): every tenant user sees links to Invoices (IRN cancel) and the GSTN Console (return filing). Server-side enforcement cannot be checked — billing-service is not in the snapshot.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/invoices', 'POST v1/billing/invoices/{id}/generate-irn', 'POST .../cancel-irn', 'GSTN console endpoints']`
- **Question:** Do billing routes enforce billing/finance roles server-side, so a plain tenant user gets 403 on invoice, IRN and GSTN endpoints?
- **How to verify:** Open billing-service route registration; check preHandler role on invoices, IRN and GSTN return-filing. curl each as role 'viewer' expecting 403.
- **Test to add:** Given role viewer; when GET /billing/invoices, POST generate-irn, POST GSTN file; then 403 for each.
- **Impact if wrong:** Any tenant user can file GST returns or cancel IRNs.
- **Web change if wrong:** Add requireAnyRole in billing/layout.tsx and hide hub links for unauthorised roles.

### GAP-BILLING-INVOICES-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by b32ba580d (UAT B4, 2026-10-27): verified on origin/main: GET /v1/billing/invoices caps at 100 rows and honours ?status= and offset paging (status applied before the cap). Tests: invoices-list-paging.test.ts (cap, status, offset), referenced from b4-backend-verification.test.ts.
- **First-pass claim:** Full list fetched and paged client-side (pageSize 15) with no server pagination or status filter (page.tsx:23-29,57); whether billing-service caps the list is undeterminable.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/invoices']`
- **Question:** Does the invoices list cap results and support page/status query params?
- **How to verify:** Open billing-service invoices list handler; check limit default/max and query schema (status, page). GET with 2000 invoices.
- **Test to add:** Given 2000 invoices; when GET /invoices; then response is capped at default page size with meta.total and honours ?status=.
- **Impact if wrong:** Truncated list appears complete; or heavy payload slows the page.
- **Web change if wrong:** Move to server pagination and status filter in page.tsx:23-57.

### GAP-BILLING-INVOICES-DETAIL-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** Closed by b32ba580d (UAT B4, 2026-10-27): verified on origin/main: generate-irn and cancel-irn are role-gated (403 for a plain tenant user), cancel needs a reason (400), commands return 202; the 24h cancel window, idempotency and audit live in the consumer. Tests: einvoice-irn-authz.test.ts, closure3-s4-01/02 redelivery tests, b4-backend-verification.test.ts.
- **First-pass claim:** Generate IRN and Cancel IRN are irreversible calls to a government system and are rendered for every role — no requireAnyRole / permission check in the page or InvoiceActions (InvoiceActions.tsx:104-125); a 403 only appears after confirming. Server-side role list undeterminable.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['POST v1/billing/invoices/{id}/generate-irn', 'POST v1/billing/invoices/{id}/cancel-irn', 'GET /api/v1/billing/invoices/{id}/einvoice']`
- **Question:** Which roles may generate and cancel IRN, is cancel limited to the GST window (24h) with reason required, and is it idempotent and audited?
- **How to verify:** Open billing-service e-invoice routes; check role guard, 24h window, reason validation, idempotency key, audit insert. POST cancel-irn as viewer, then twice as finance_admin.
- **Test to add:** Given viewer role; when cancel-irn; then 403. Given finance_admin and IRN older than 24h; then 422. Repeated generate-irn returns same IRN/202 with same id.
- **Impact if wrong:** Irreversible GSTN actions by unauthorised users; duplicate IRN attempts; tax penalties.
- **Web change if wrong:** Hide Generate/Cancel IRN buttons in InvoiceActions.tsx (lines 104-125) unless user has billing role; mirror 24h window.

### GAP-BILLING-PAYMENTS-02  ·  HIGH  ·  partly  ·  theme BACKEND

- [x] **Status** Closed by b32ba580d (UAT B4, 2026-10-27): verified on origin/main: each payment row carries id, invoiceId, amountMinor (string), method and status and no name-like field, matching the bespoke web mapper. Test: b4-backend-verification.test.ts.
- **First-pass claim:** mapModuleRows requires id and a name|title|subject|label|code|contractNo|fileNo (loaders.ts:1662-1671); a payment row carrying only invoiceId/amount/method is dropped silently and the page reads 'No records'. Actual payment payload undeterminable.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['GET /api/v1/billing/payments']`
- **Question:** Does each payment row carry id plus one of name/title/subject/label/code/contractNo/fileNo, or only invoiceId/amount/method?
- **How to verify:** Open billing-service payments handler DTO; curl GET /payments and check fields against mapModuleRows (loaders.ts:1662-1671). Web-side: the generic mapper drops rows lacking a name-like field.
- **Test to add:** Given a payment {id, invoiceId, amount, method}; when GET /payments and rendered; then row count in UI equals API count (contract test on mapper).
- **Impact if wrong:** Payments invisible in UI ('No records') though present; reconciliation errors.
- **Web change if wrong:** Write a dedicated payments mapper (id, invoiceId, amount, method, status) instead of moduleLoader.
- **Finding:** loaders.ts:1662-1671 mapModuleRows drops rows without name-like field; loaders.ts:1710 getBillingPayments uses moduleLoader

### GAP-BILLING-PLANS-DETAIL-01  ·  HIGH  ·  partly  ·  theme BACKEND

- [x] **Status** Closed by b32ba580d (UAT B4, 2026-10-27): verified on origin/main: GET /v1/billing/plans/:id returns the same names the create form posts (priceMinor, code, govtExempt, currency, name, active). Test: b4-backend-verification.test.ts.
- **First-pass claim:** Read/write field mismatch: the create form posts priceMinor, code and govtExempt (NewPlanForm.tsx:86-92) but this page reads amount and interval and never shows code or govtExempt (page.tsx:23-26,71-84). Amount will show '—' or a wrong figure unless the API renames fields — undeterminable without billing-service.
- **Service:** `billing-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/billing/plans', 'GET /api/v1/billing/plans/{id}']`
- **Question:** Does GET plan/{id} return the same fields posted on create (priceMinor, code, govtExempt) or rename them to amount/interval?
- **How to verify:** Open billing-service plans handler and DTOs; POST a plan then GET it and diff field names. Web-side: create form posts priceMinor/code/govtExempt (NewPlanForm.tsx:86-92) while detail reads amount/interval (page.tsx:23-26).
- **Test to add:** Given plan created with priceMinor=49900, code='STD', govtExempt=true; when GET /plans/{id}; then response contains the same values under the names the page reads.
- **Impact if wrong:** Plan price displayed wrongly or blank; billing misconfiguration.
- **Web change if wrong:** Read priceMinor (divide by 100), code, govtExempt in plans/[id]/page.tsx and show them.
- **Finding:** NewPlanForm.tsx:86-92 vs plans/[id]/page.tsx:23-26,71-84
