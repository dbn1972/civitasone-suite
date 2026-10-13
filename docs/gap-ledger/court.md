# Detailed gap file — module `court`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 35, BACKEND-VERIFY 1



---
## /court  —  `court/home.html`

- **Source:** `apps/web/src/app/(app)/court/page.tsx`
- **Design reference:** `redesign/court/home.html`

### GAP-COURT-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Partial failure is silent: badge shows only when all three loaders return error, so a failed getCases() alone renders 'Total Cases 0' and 'Disposed 0' as facts (court/page.tsx:47-50).
- **Verified evidence:** court/page.tsx:48-52 sets source='error' only when cases, pendency and analytics ALL fail. Loaders return empty defaults on error (loaders.ts:250-290), so if getCases alone fails, Total Cases renders 0 and Disposed 0 (:70,:82) with no badge. Total Cases also equals at most 100 (limit=100, loaders.ts:191), presented as fact.
- **Files to change:** `apps/web/src/app/(app)/court/page.tsx`
- **Fix steps:**
  1. Compute per-tile error: all.source==='error' -> Total Cases and Disposed show '—'; pendency error -> Pending '—'; analytics error -> Clearance '—'
  2. Render DataSourceBadge when ANY source is 'error' (or per tile)
  3. Source Total Cases from analytics.instituted or pendency, not cases list length
  4. Add note/hint when count could be capped
- **Acceptance:**
  - Mock getCases failing only: badge visible, Total Cases and Disposed show '—' not 0
  - All ok: values unchanged
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-HOME-02

### GAP-COURT-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Disposed' is derived from the case list rather than analytics.disposed, so the KPI can disagree with Clearance Rate (court/page.tsx:46 vs types.ts CaseAnalytics).
- **Verified evidence:** court/page.tsx:48 computes disposed from all.data.filter(status==='disposed') over a list capped at limit=100 (loaders.ts:191), while analytics.disposed exists (types.ts:88-92) and drives clearanceRatePct. KPI can therefore disagree with Clearance Rate and undercount.
- **Files to change:** `apps/web/src/app/(app)/court/page.tsx`
- **Fix steps:**
  1. Use analytics.data.disposed for the Disposed tile
  2. Show '—' when analytics.source==='error'
  3. Remove the client-side filter over all.data
- **Acceptance:**
  - Disposed equals analytics.disposed with mocked data where case list has fewer rows
  - Error state shows '—'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; definition of 'disposed' should match backend analytics window (cannot-verify).
- **Depends on:** GAP-COURT-HOME-01

### GAP-COURT-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Pendency summary by status is fetched but only .total is used; the breakdown is never shown (court/page.tsx:41-44).
- **Verified evidence:** getPendency returns summary[] {status,count} and total (types.ts:77-85, loaders.ts:250-270); page.tsx:76 uses only pendency.data.total. The breakdown is never rendered.
- **Files to change:** `apps/web/src/app/(app)/court/page.tsx`
- **Fix steps:**
  1. Under the Pending StatCard or in a Card, render pendency.data.summary rows using humanize(status) and count
  2. Or drop summary from the loader if not wanted
  3. Show empty/error state per HOME-01 rule
- **Acceptance:**
  - With summary [{pending,5},{reserved,2}] two rows shown summing to total
  - Error source shows '—'
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-HOME-01

### GAP-COURT-HOME-05  ·  LOW  ·  confirmed  ·  theme ICONS-ERR (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiles use emoji icons and Hearings/Daily Cause List share the same calendar glyph (court/page.tsx:9-35); the segment has no error.tsx at the root while hearings/orders do.
- **Verified evidence:** court/page.tsx:8-39 CONSOLES use emoji icons; Daily Cause List (:18) and Hearings (:30) both use 📅. court/ has layout.tsx and loading.tsx but no error.tsx at root (hearings/ and orders/ have error.tsx; cases, cause-list, admin do not either). loading.tsx exists and is generic.
- **Files to change:** `apps/web/src/app/(app)/court/page.tsx`, `apps/web/src/app/(app)/court/error.tsx (new)`
- **Fix steps:**
  1. Replace emojis with lucide icons (Gavel, CalendarDays, ScrollText, Settings, FolderOpen) as in Sidebar.tsx
  2. Add court/error.tsx reusing the shared RouteError/ error pattern from hearings/error.tsx with retry and back link
  3. Add error.tsx to cases, cause-list, admin or rely on the root one
- **Acceptance:**
  - Each tile has a distinct icon
  - Throw in page -> court error boundary with Retry
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /court/admin  —  `court/admin.html`

- **Source:** `apps/web/src/app/(app)/court/admin/page.tsx`
- **Design reference:** `redesign/court/admin.html`

### GAP-COURT-ADMIN-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Preset buttons apply immediately with no confirmation: one click upserts case/court/order types for the whole tenant (AdminConfig.tsx:107-122).
- **Verified evidence:** AdminConfig.tsx:113-122 Button onClick={() => void onApplyPreset(p)} calls applyPreset (client.ts:369, POST v1/court/config/presets/{preset}) immediately; no ConfirmDialog. Copy at :109-110 says presets upsert case, court and order types. Whether the endpoint audits or supports a reason is not verifiable (court-service absent).
- **Files to change:** `apps/web/src/app/(app)/court/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/court/_data/client.ts`
- **Fix steps:**
  1. Hold pendingPreset state; clicking a preset opens ds ConfirmDialog (danger, requireReason) naming the preset and the namespaces it overwrites.
  2. On confirm call applyPreset; pass reason only if backend accepts it (backend check), else log to toast text.
  3. Disable all preset buttons while busy (already presetBusy).
  4. Confirm backend emits an audit event for preset apply.
- **Acceptance:**
  - Click preset: dialog appears, no request until Confirm.
  - Cancel sends nothing.
  - Confirm applies and toast shows.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Config change affects the whole tenant; maker-checker not verifiable UI-side.

### GAP-COURT-ADMIN-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Retiring a value is a bare '✕' icon button with no confirm and no impact check; a retired case_type falls back to defaults or hides values in use (AdminConfig.tsx:315-325).
- **Verified evidence:** AdminConfig.tsx:317-327: retire is a ghost Button '✕' with aria-label 'Retire {key}' and title, calling deactivateConfig immediately (:283-294); no confirm, no reason, no impact check: confirmed. When the last active value is retired the UI falls back to built-in defaults (:300-346, policy.ts:8), which is visible. Claim that in-use values are hidden cannot be verified (needs court-service validation behaviour).
- **Files to change:** `apps/web/src/app/(app)/court/admin/AdminConfig.tsx`
- **Fix steps:**
  1. Add ConfirmDialog (danger, requireReason optional) before retire, stating that if this is the last value the module defaults will apply.
  2. Show warning count when retiring the last active value of a namespace.
  3. Replace '✕' text with an icon plus visible 'Retire' tooltip; keep aria-label.
- **Acceptance:**
  - Click ✕: dialog opens; Cancel makes no PATCH.
  - Retiring the last value shows defaults warning in dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Retire is reversible by re-adding the key, so low; expectedVersion already guards concurrency.
- **Depends on:** GAP-COURT-ADMIN-01

### GAP-COURT-ADMIN-03  ·  MEDIUM  ·  partly  ·  theme LABELS (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Config values are shown as raw configKey tokens; labels are optional, so reviewers see snake_case (AdminConfig.tsx:296-345).
- **Verified evidence:** Chips show `e.label ?? e.configKey` and always the mono configKey beside it (AdminConfig.tsx:315-316), so raw keys are shown deliberately as identifiers; label is optional in the add form (:356-362). Default pills use humanized-less raw keys (:340-342, StatusPill label={d}) which are snake_case. No next-intl use in court module.
- **Files to change:** `apps/web/src/app/(app)/court/admin/AdminConfig.tsx`, `apps/web/src/app/(app)/court/_data/policy.ts`
- **Fix steps:**
  1. Render default pills with humanize() (court/_data/format.ts:38).
  2. Make label required for new values or auto-fill with humanize(key) on submit.
  3. Move page strings to next-intl only if the module adopts i18n (decision).
- **Acceptance:**
  - Defaults show 'Part heard' not 'part_heard'.
  - Adding a key without label stores humanized label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-COURT-ADMIN-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Eight sequential-parallel fetches happen on the server for one page; any single failure flips the whole page to source=error although seven succeeded (admin/page.tsx:15-17).
- **Verified evidence:** page.tsx:10-14 runs 8 getConfigNamespace calls with Promise.all (parallel, not sequential; 7 enum + sla_timer per policy.ts) and sets source='error' if any fails (:14). getConfigNamespace returns [] on failure, so entries from failed namespaces are silently empty and AdminConfig shows built-in defaults for them, which is misleading; the badge (:24) does appear though.
- **Files to change:** `apps/web/src/app/(app)/court/admin/page.tsx`, `apps/web/src/app/(app)/court/admin/AdminConfig.tsx`
- **Fix steps:**
  1. Return per-namespace source: build a Record<ns, 'api'|'error'> from results and pass as initialSources.
  2. In EnumEditor/SlaEditor, when its namespace errored show 'Could not load this list' with retry instead of defaults and disable Add/Retire for it.
  3. Keep global badge only when all fail.
- **Acceptance:**
  - Mock one namespace failing: 6 render normally, 1 shows per-card error.
  - Adding disabled on the failed card.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: showing defaults for a failed load and saving over could shadow real config; per-card state prevents that.

### GAP-COURT-ADMIN-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Case-type description says configured values 'fully replace' built-in defaults; there is no preview of the resulting list.
- **Verified evidence:** policy.ts:45 case_type description says configured values fully replace built-in defaults (policy.ts:8 also). EnumEditor add() (AdminConfig.tsx:261-281) adds a single key with no preview of the resulting effective list; adding the first value to an unconfigured namespace silently drops all defaults.
- **Files to change:** `apps/web/src/app/(app)/court/admin/AdminConfig.tsx`
- **Fix steps:**
  1. When !configured and defaults exist, on Add show inline text: 'Adding this makes ONLY your configured values valid; defaults X, Y, Z will stop applying' with an option 'Also keep defaults' that adds them.
  2. Show 'Effective list after change' chips preview.
- **Acceptance:**
  - Unconfigured case_type: entering a key shows the warning and the preview.
  - Choosing keep-defaults adds the defaults via setConfig.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Behavioural: changes which case types staff can register; verify server enforces the same rule.


---
## /court/cases  —  `court/cases.html`

- **Source:** `apps/web/src/app/(app)/court/cases/page.tsx`
- **Design reference:** `redesign/court/cases.html`

### GAP-COURT-CASES-01  ·  HIGH  ·  partly  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Whole registry is rendered from one unpaginated GET with no limit, filter or search — a court with thousands of matters loads every row on each request (court/cases/page.tsx:26, loaders.ts getCases).
- **Verified evidence:** getCases (court/_data/loaders.ts:190-197) sends limit=100 always ('?limit=100'), so the claim of no limit is wrong; but the page (cases/page.tsx:24,37) has no pagination, filter, search or truncation notice, and the header shows data.length (max 100) as if it were the total. Server total/cursor not visible (court-service absent).
- **Files to change:** `apps/web/src/app/(app)/court/_data/loaders.ts`, `apps/web/src/app/(app)/court/cases/page.tsx`, `apps/web/src/app/(app)/court/_data/types.ts`
- **Fix steps:**
  1. Read searchParams (page, status, q) in page.tsx and pass to getCases with limit/offset (confirm the court-service list params and total field).
  2. Return total from mapResponse and show 'Showing 1-25 of N'.
  3. Add status filter and search input (form GET) and Prev/Next links.
  4. Until server supports it, show 'Showing first 100' notice when length===100.
- **Acceptance:**
  - With 250 cases page 2 shows next slice and correct total.
  - Status filter narrows results.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; keep default sort newest first.

### GAP-COURT-CASES-02  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** SLA target is shown as a date only; overdue matters (target < today and not disposed) are not flagged (cases/page.tsx:80-90).
- **Verified evidence:** cases/page.tsx:76 shows fmtDate(c.targetDisposalDate) only; no comparison with today and status !== 'disposed'. fmtDate (court/_data/format.ts:19) is a generic en-IN formatter without timeZone.
- **Files to change:** `apps/web/src/app/(app)/court/cases/page.tsx`, `apps/web/src/app/(app)/court/_data/format.ts`
- **Fix steps:**
  1. Add helper isOverdue(target, status) comparing date-only IST strings.
  2. Render an 'Overdue' StatusPill and bold date when true.
  3. Consider swapping fmtDate for lib/formatters formatIndianDate for consistency.
- **Acceptance:**
  - Case with target yesterday and status pending shows Overdue; disposed does not.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-COURT-CASES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Header count is bracketed 'All cases (0)' even in error state, mixing 'zero' with 'unknown' (cases/page.tsx:39).
- **Verified evidence:** cases/page.tsx:37 title `All cases (${cases.data.length})` is evaluated even when source==='error' (data is [] fallback), so shows (0); error body at :39-43 is an EmptyState without retry (RefreshErrorState not used).
- **Files to change:** `apps/web/src/app/(app)/court/cases/page.tsx`
- **Fix steps:**
  1. Compute count = source==='error' ? '—' : data.length.
  2. Render RefreshErrorState (toHumanError('load',{area:'cases'})) in the error branch instead of EmptyState; drop the separate DataSourceBadge at :35.
- **Acceptance:**
  - Loader error: title shows 'All cases (—)' and a Retry button.
  - Success with zero rows still shows (0) and No cases yet.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-COURT-CASES-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — Actions column header now has sr-only text; remaining: table uses class 'court-stack' which has no CSS rule anywhere (ds stack class is 'tbl--stack'), so rows do not stack at 375px and horizontal scroll remains; not moved to ds DataTable
- **First-pass claim:** Table uses className tbl with inline overflowX scroll, no mobile card transform; final column header is empty (cases/page.tsx:52-59).
- **Verified evidence:** cases/page.tsx:51-52 wraps a className='tbl' table in overflowX:auto; :60 has an empty <th style={labelStyle} /> for the Open case action; no mobile card transform (DataTable in ds has one).
- **Files to change:** `apps/web/src/app/(app)/court/cases/page.tsx`
- **Fix steps:**
  1. Give last th visually-hidden text 'Actions'.
  2. Switch to ds DataTable (with sortable/filterable) or apply the shared mobile stack class used elsewhere.
  3. Keep Open case link as column render.
- **Acceptance:**
  - Column header has accessible name.
  - At 375px width rows stack without horizontal scroll.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-CASES-01

### GAP-COURT-CASES-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Case column shows 'Untitled matter' fallback; there is no party name to help identify matters (cases/page.tsx:65).
- **Verified evidence:** cases/page.tsx:67 shows c.title with 'Untitled matter' fallback and the CNR below (:68-72). CourtCase (types.ts:57-71) has no party fields, so party names are not in the list payload; adding them needs a list-payload change (cannot verify in court-service).
- **Files to change:** `apps/web/src/app/(app)/court/cases/page.tsx`, `apps/web/src/app/(app)/court/_data/types.ts`
- **Fix steps:**
  1. If the list endpoint can return a party summary, add it to mapCase and render under the title.
  2. Otherwise show filingNumber as secondary identifier.
  3. Confirm with backend before adding.
- **Acceptance:**
  - Untitled case still identifiable by CNR and filing number.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Party names are PII; consider masking (see CASEID-04).


---
## /court/cases/[caseId]  —  `court/cases-caseId.html`

- **Source:** `apps/web/src/app/(app)/court/cases/[caseId]/page.tsx`
- **Design reference:** `redesign/court/cases-caseId.html`

### GAP-COURT-CASES-CASEID-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — Adjourn/Outcome and Approve&issue/Send back/Recall in CaseConsole now use ds ConfirmDialog (recall/adjourn require reason); remaining: dialogs are re-implemented inside CaseConsole rather than one shared court/_components used by OrdersConsole/HearingsConsole, and 'Submit for approval' on the case page is still single-click
- **First-pass claim:** Irreversible acts have no confirmation here: Approve & issue (DSC), Recall, Adjourn and Record outcome use inline forms in CaseConsole.tsx while the standalone /court/orders and /court/hearings consoles gate the same actions with ConfirmDialog (danger) — two UX contracts for one action (CaseConsole.tsx:486-854 vs OrdersConsole.tsx:586).
- **Verified evidence:** Not 'no confirmation': CaseConsole uses a two-step inline pattern. Approve & issue opens a DSC panel with 'Confirm approve & issue' (CaseConsole.tsx:736,~756-790), Recall requires reason and 'Confirm recall' (:805-826, button disabled without reason), Adjourn requires reason and 'Confirm adjourn' (:500-525). Outcome (Held/Cancelled) has a Save button with no reason (:527-552). What is true is inconsistency with ConfirmDialog in OrdersConsole.tsx:584,743 and HearingsConsole.tsx:465,558. Lifecycle transition (:233-275) and Submit for approval (:715-728) are single click. Maker!=checker is enforced server-side (error text at ~:771).
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CaseConsole.tsx`, `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`, `apps/web/src/app/(app)/court/hearings/HearingsConsole.tsx`
- **Fix steps:**
  1. Extract shared dialogs from OrdersConsole/HearingsConsole (approve&issue, recall, adjourn, outcome) into court/_components and reuse them in CaseConsole OrderRow/HearingRow.
  2. Replace the inline `mode` panels with those ConfirmDialog-based components (danger, requireReason for recall/adjourn/cancel).
  3. Keep DSC textarea inside the dialog description slot.
  4. Ensure dialog names case and order.
- **Acceptance:**
  - Click Approve&issue on case page: alertdialog opens, focus trapped, Esc cancels.
  - Recall confirm disabled until reason entered.
  - Same dialogs used in /court/orders and case page (single component).
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Irreversible DSC-signed orders: refactor must keep expectedVersion and DSC payload identical.

### GAP-COURT-CASES-CASEID-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Certified-copy receipted amount is typed as raw paise (placeholder is copy.feeMinor) while the fee is displayed in rupees; a clerk entering '150' for ₹150 is rejected or mis-receipted (CertifiedCopiesPanel.tsx:350 vs :298).
- **Verified evidence:** CertifiedCopiesPanel.tsx:346 label says 'Receipted amount (paise)' and placeholder is copy.feeMinor (:350) while fees are displayed in rupees via fmtPaise (:298), so units differ between display and input: confirmed. The unit is labelled, and the panel doc says a mismatch is rejected by the service (lines 10-11, 83), so clerks would get a rejection rather than a silent mis-receipt. Input is not validated as digits client-side (:257).
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CertifiedCopiesPanel.tsx`
- **Fix steps:**
  1. Change the field to rupees ('Receipted amount (₹)'), placeholder formatted fee in plain rupees.
  2. Convert with rupeesToMinorString (lib/money.ts:28) on submit; block null with inline error.
  3. Show preview formatMoney(minor) and the expected fee beside it.
  4. Send receiptMinor as the string.
- **Acceptance:**
  - Enter '150.00' for a ₹150 fee: request has receiptMinor '15000'.
  - 'abc' shows inline error; no request.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money reconciliation: service still verifies amount, keep that.
- **Depends on:** GAP-COURT-CASES-CASEID-03

### GAP-COURT-CASES-CASEID-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Money display uses a private fmtPaise without lakh grouping (₹150000.00 rather than ₹1,50,000.00) (CertifiedCopiesPanel.tsx:37-45).
- **Verified evidence:** Private fmtPaise at CertifiedCopiesPanel.tsx:30-40 builds `₹${rupees}.${paise}` from BigInt with no digit grouping, so 15000000 renders ₹150000.00. Shared formatMoney (lib/formatters.ts:90) does Indian grouping and handles null with '—'.
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CertifiedCopiesPanel.tsx`
- **Fix steps:**
  1. Delete fmtPaise and import formatMoney from '@/lib/formatters'.
  2. Replace usages at :298 and :303.
  3. Add a test on the panel with feeMinor '15000000' expecting ₹1,50,000.00.
- **Acceptance:**
  - Fee 15000000 renders ₹1,50,000.00.
  - null fee renders '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-COURT-CASES-CASEID-04  ·  MEDIUM  ·  partly  ·  theme PII

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — advocateBarId rendered via ds Masked (last4) by default; remaining: no reveal control/audit event or role gate (no onReveal passed), party name still shown in the clear; policy decision pending
- **First-pass claim:** Party names and advocate Bar IDs (DPDP personal data) are rendered in full to every court-module user; no masking or role check (CaseConsole.tsx:284-320, types.ts:CaseParty).
- **Verified evidence:** PartiesPanel (CaseConsole.tsx:282-312) prints name, advocateName and advocateBarId in the clear; no Masked component or role check exists in web (grep). types.ts:45-46 notes PII is server-encrypted and the gateway returns decrypted values 'where permitted', so gating may be enforced server-side (not verifiable; court-service absent). The 'every court-module user' claim is unverified.
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CaseConsole.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Decide policy (decision): which roles may see party name/Bar ID unmasked.
  2. Create ds/Masked with reveal button, role check from session claims and an audit call on reveal.
  3. Use Masked for advocateBarId (and optionally name) in PartiesPanel.
  4. Confirm gateway already omits fields for unauthorised roles.
- **Acceptance:**
  - Bar ID shows masked by default; reveal logs an audit event.
  - Role without permission cannot reveal.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; but over-masking hinders judges/registrars who need the data.
- **Depends on:** Masked (new shared)

### GAP-COURT-CASES-CASEID-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Lifecycle 'Apply transition' to Disposed/Reserved fires immediately; disposal is a terminal-like step (only 'appealed' follows) (CaseConsole.tsx:233-275, types.ts CASE_TRANSITIONS).
- **Verified evidence:** LifecyclePanel (CaseConsole.tsx:199-275) calls transitionCase directly on 'Apply transition'; CASE_TRANSITIONS (types.ts:34-43) allows pending/part_heard/reserved -> disposed, and disposed only -> appealed. Reason is optional (:262 placeholder). Server still checks role and expectedVersion.
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CaseConsole.tsx`
- **Fix steps:**
  1. Wrap move() in ConfirmDialog when toStatus is 'disposed' or 'reserved' (danger for disposed), naming case title/CNR.
  2. requireReason for disposed and appealed transitions and send it as `reason`.
  3. Keep single-click for routine moves.
- **Acceptance:**
  - Selecting Disposed and clicking Apply opens dialog; no PATCH until confirm with reason.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Disposal is a legal-record event; reversal only via appeal.
- **Depends on:** GAP-COURT-CASES-CASEID-01

### GAP-COURT-CASES-CASEID-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Six stacked cards in one 859-line console with no anchor nav or tabs.
- **Verified evidence:** CaseConsole.tsx is 859 lines and renders Summary, Lifecycle, Parties, Hearings, Orders and CertifiedCopiesPanel as stacked Cards (:113-150); ds/Tabs.tsx exists but is not used. No anchor nav.
- **Files to change:** `apps/web/src/app/(app)/court/cases/[caseId]/CaseConsole.tsx`
- **Fix steps:**
  1. Wrap panels in ds Tabs (Overview, Hearings, Orders, Certified copies) keeping counts in tab labels.
  2. Sync selected tab to ?tab= search param.
  3. Split CaseConsole.tsx into per-panel files.
- **Acceptance:**
  - Tab switch shows only that panel; deep link ?tab=orders opens Orders.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-CASES-CASEID-01


---
## /court/cause-list  —  `court/cause-list.html`

- **Source:** `apps/web/src/app/(app)/court/cause-list/page.tsx`
- **Design reference:** `redesign/court/cause-list.html`

### GAP-COURT-CAUSE-LIST-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Courts are inferred from the cases list (unique courtId) and displayed as an 8-char UUID prefix; a court with no registered case cannot get a cause list and users see raw ids (CauseListConsole.tsx courts useMemo + option label).
- **Verified evidence:** CauseListConsole.tsx:52-58 derives courts from distinct cases' courtId (no court master endpoint used); option label (:124-129) is the first 28 chars of a sample CASE title plus courtId.slice(0,8), which is not a court name and can mislead. A court with no case cannot be selected.
- **Files to change:** `apps/web/src/app/(app)/court/cause-list/CauseListConsole.tsx`, `apps/web/src/app/(app)/court/_data/loaders.ts`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Backend: expose a courts list (GET) or reuse the court_type config namespace if it stores courts.
  2. Add getCourts loader and pass to console.
  3. Use EntityPicker with court name/code; never show UUID prefix; fall back to inferred list only if courts fetch fails.
- **Acceptance:**
  - Court with zero cases still selectable.
  - No 8-char UUID appears in option text.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** EntityPicker (new shared)

### GAP-COURT-CAUSE-LIST-02  ·  HIGH  ·  partly  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Page cannot reopen an existing cause list: there is no GET for lists by court/date in client.ts; re-clicking Generate list POSTs again and may create duplicates or a second 202 envelope (CauseListConsole.tsx generate()).
- **Verified evidence:** client.ts:90-95 only has fetchCauseListItems(id); there is no list/lookup by court and date (comment at CauseListConsole.tsx:28-34 says so). generate() (:65-81) posts each click; button disabled only while busy or without court/date (:140), and after success the button stays enabled. Whether the service dedupes is not verifiable (court-service absent), so duplicates are plausible, not proven. State (causeListId) is lost on reload.
- **Files to change:** `apps/web/src/app/(app)/court/cause-list/CauseListConsole.tsx`, `apps/web/src/app/(app)/court/_data/client.ts`
- **Fix steps:**
  1. Backend: add GET /cause-lists?courtId&listDate and make POST idempotent per court+date.
  2. Add fetchCauseListByCourtDate; on court/date change look up and load the existing list before showing Generate.
  3. Change button to 'Open list' when one exists; disable Generate once causeListId set for same court/date.
  4. Persist selection in URL search params.
- **Acceptance:**
  - Reload page after generating: same list reopens.
  - Clicking Generate twice creates one list.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate cause lists in court could misdirect listing; needs backend idempotency.

### GAP-COURT-CAUSE-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — item number validated (integer >=1, duplicates blocked), slot/courtroom trimmed+uppercased and slot shown verbatim; remaining: slot/courtroom are still free-text inputs (no configured slot/courtroom namespaces or selects)
- **First-pass claim:** Slot and courtroom are free text with no validation against config (hearing_purpose etc. have namespaces but slot/courtroom do not), so 'am 1' vs 'AM-1' will diverge (CauseListConsole.tsx AddItemForm).
- **Verified evidence:** AddItemForm (CauseListConsole.tsx:287-300) slot and courtroom are free-text inputs; only non-empty is checked (:236). policy.ts ENUM_NAMESPACES has no slot or courtroom namespace. Table display humanize(it.slot) (:200) would turn 'AM-1' into 'AM 1'. Duplicate itemNumber not checked (:241).
- **Files to change:** `apps/web/src/app/(app)/court/cause-list/CauseListConsole.tsx`, `apps/web/src/app/(app)/court/_data/policy.ts`
- **Fix steps:**
  1. Decide value source: add 'slot' and 'courtroom' config namespaces to policy.ts (ENUM_NAMESPACES) and fetch server-side, or a fixed slot list.
  2. Render selects populated from config; fallback to text with uppercase/trim normalisation.
  3. Zod-validate itemNumber integer >=1 and not already used in items.
  4. Show slot verbatim (no humanize).
- **Acceptance:**
  - Slot select offers configured values only.
  - Duplicate item number blocked with inline error.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-COURT-CAUSE-LIST-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — Type and Stage columns added from the matched case; remaining: cases are still fetched with limit=100 and an item whose case is outside it falls back to 'Case' + id prefix (no getCase(id) resolve), no purpose column
- **First-pass claim:** Listed-items table shows only CNR/id: no case title, purpose or parties for the bench (CauseListConsole.tsx items map).
- **Verified evidence:** Table (CauseListConsole.tsx:187-204) does show case title and CNR via cases.find(x=>x.id===it.caseId), falling back to 'Case' and caseId.slice(0,8) if the case is not in the 100-row fetch (loaders.ts:191). Missing: hearing purpose, parties and stage. Items endpoint fields for purpose unknown (CauseListItem type not extended).
- **Files to change:** `apps/web/src/app/(app)/court/cause-list/CauseListConsole.tsx`, `apps/web/src/app/(app)/court/_data/types.ts`
- **Fix steps:**
  1. Add caseType/stage columns from the matched CourtCase.
  2. If the items API returns purpose, add column; else decision.
  3. Resolve missing cases via getCase(id) instead of showing 'Case'.
- **Acceptance:**
  - Item for a case beyond first 100 still shows title.
  - Stage column visible.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-CASES-01

### GAP-COURT-CAUSE-LIST-05  ·  LOW  ·  confirmed  ·  theme RESPONSIVE (was NAVUX)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Table is an inline-styled table without mobile transform.
- **Verified evidence:** CauseListConsole.tsx:176-207 renders className='tbl' with overflowX:auto and inline th label styles; no mobile card transform. Theme 'NAVUX' is off; it is responsive table styling.
- **Files to change:** `apps/web/src/app/(app)/court/cause-list/CauseListConsole.tsx`
- **Fix steps:**
  1. Move labelStyle into shared CSS class and use ds DataTable (has mobile transform) or the shared stack class.
  2. Test at 375px.
- **Acceptance:**
  - At 375px no horizontal page scroll; rows readable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-CASES-04


---
## /court/hearings  —  `court/hearings.html`

- **Source:** `apps/web/src/app/(app)/court/hearings/page.tsx`
- **Design reference:** `redesign/court/hearings.html`

### GAP-COURT-HEARINGS-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Adjourning a hearing does not create the next one; the dialog copy admits the user must schedule it separately, so the case can be left with no future hearing (HearingsConsole.tsx:472-479).
- **Verified evidence:** HearingsConsole.tsx:465-481 ConfirmDialog already exists and states adjourning does not create the next hearing; adjournHearing (client.ts:136-139) only PATCHes /hearings/:id/adjourn with reason+nextDate. No follow-up schedule call, so the case has an adjourned hearing with a nextDate but no scheduled hearing. Reason is already mandatory (validate). Finding's fix text (add ConfirmDialog/maker-checker) is off: the dialog exists; the gap is missing auto-schedule.
- **Files to change:** `apps/web/src/app/(app)/court/hearings/HearingsConsole.tsx`, `apps/web/src/app/(app)/court/_data/client.ts`
- **Fix steps:**
  1. In AdjournPanel.confirm(), after adjournHearing succeeds, call scheduleHearing(caseId,{scheduledAt: nextDate, purpose: hearing.purpose}) (client.ts) or ask backend to create it atomically
  2. Preferred: confirm with backend whether PATCH /hearings/:id/adjourn can create the successor (single command, no partial state); if not, add an opt-out checkbox 'Also schedule next hearing on <date>' defaulted on in the ConfirmDialog
  3. Pass caseId into HearingRow/AdjournPanel props
  4. Handle partial failure: if adjourn ok but schedule fails, show error with 'Schedule now' retry and do not close
  5. Update dialog description to reflect the new behaviour
- **Acceptance:**
  - Component test: adjourn with checkbox on calls adjournHearing then scheduleHearing with nextDate
  - Manual: adjourn to a future date, list shows adjourned row plus new scheduled row on that date
  - If schedule call rejects, error shown and adjourned row still visible
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Two non-atomic commands can leave case half-updated; prefer single backend command. Legal scheduling impact.

### GAP-COURT-HEARINGS-02  ·  MEDIUM  ·  confirmed  ·  theme SCALE (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — CaseSelector is now a searchable title/CNR/filing combobox with a 'first 100 cases' notice; remaining: still limited to the first 100 cases (no server-side search, case beyond the 100th unreachable from here) and options are mouse-only buttons (no arrow-key listbox navigation)
- **First-pass claim:** Case selector option labels combine title, CNR and status in a single native select for the entire registry — no search on a long list (CaseSelector.tsx:62-78).
- **Verified evidence:** CaseSelector.tsx:60-83 is a plain native <select> listing every case (title · CNR — humanised status). Loader getCases caps at limit=100 (loaders.ts:191), so beyond 100 cases some cannot be picked at all. No search/filter. Strings are hard-coded English (no next-intl). Status is text so not colour-only.
- **Files to change:** `apps/web/src/app/(app)/court/_components/CaseSelector.tsx`, `apps/web/src/app/(app)/court/_data/loaders.ts`
- **Fix steps:**
  1. Replace <select> with a searchable combobox (reuse ds combobox if present, else add ds/Combobox) filtering by title/CNR
  2. Add server-side search: getCases(status,q) passing ?q= if court-service list supports it (cannot-verify: service absent), else a dedicated case-lookup by CNR input
  3. Show truncation notice when result length === 100
  4. Move labels to next-intl keys (court.caseSelector.*)
- **Acceptance:**
  - Typing a CNR fragment narrows options
  - With 150 seeded cases, a case beyond the 100th is still reachable
  - Keyboard: combobox operable with arrows/enter
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; navigation only.

### GAP-COURT-HEARINGS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** No flat hearings endpoint: a listing of 'today's hearings' cannot be built; page depends on ?caseId (CaseSelector.tsx header comment).
- **Verified evidence:** CaseSelector.tsx:4-8 and HearingsConsole.tsx:5-7 state there is no flat 'all hearings' GET (hearing/routes.ts in court-service, not in snapshot); page.tsx:14-19 fetches hearings only when ?caseId is set. A daily hearings list cannot be built without a backend endpoint. Cause-list console partly covers the day view.
- **Files to change:** `services/court-service (hearing routes, new GET /hearings?from&to&status)`, `apps/web/src/app/(app)/court/_data/loaders.ts`, `apps/web/src/app/(app)/court/hearings/page.tsx`
- **Fix steps:**
  1. Backend: add paginated read-model GET /v1/court/hearings with date range, status, benchId filters (CQRS query side)
  2. Add getHearings() loader with zod-validated mapper
  3. In hearings/page.tsx default to today's hearings table when no caseId, keeping the case selector as filter
  4. Link each row to the case-scoped console
- **Acceptance:**
  - Contract test: endpoint returns paginated rows scoped to tenant/court
  - Page with no caseId lists today's hearings
- **Needs:** backend  ·  **Effort:** L >2d  ·  **Risk:** Cannot-verify backend side; must respect court/bench scoping to avoid cross-court leakage.
- **Depends on:** GAP-COURT-HEARINGS-04

### GAP-COURT-HEARINGS-04  ·  LOW  ·  confirmed  ·  theme TABLE (was DATEFMT)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — fmtDate/fmtDateTime now force Asia/Kolkata; remaining: hearings still render as bordered div cards (HearingRow), no ds table, no sort
- **First-pass claim:** Hearing rows are div cards, not a table, so date/status cannot be sorted or scanned (HearingsConsole.tsx:95-125).
- **Verified evidence:** HearingsConsole.tsx:110-122 renders hearings as bordered div cards via HearingRow (:250-295); no table, no sort. Dates already use fmtDate/fmtDateTime (format.ts:4-24, en-IN dd Mon yyyy, browser TZ not forced to IST). Suggested fix 'use formatIndianDate' is partly moot; real gap is layout and no timeZone:'Asia/Kolkata'.
- **Files to change:** `apps/web/src/app/(app)/court/hearings/HearingsConsole.tsx`, `apps/web/src/app/(app)/court/_data/format.ts`
- **Fix steps:**
  1. Render hearings in the ds table (as used by other consoles) with columns Date, Purpose, Status, Next date, Actions
  2. Sort by scheduledDate desc by default; sortable Date/Status headers
  3. Add timeZone:'Asia/Kolkata' to fmtDate/fmtDateTime options
  4. Keep per-row Adjourn/Outcome panels as expandable row content
- **Acceptance:**
  - Rows sorted by date, header click toggles order
  - Dates render identically for a UTC browser and an IST browser
  - Existing aria-labels on Adjourn/Record outcome preserved
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; preserve accessible names used by tests.

### GAP-COURT-HEARINGS-05  ·  LOW  ·  partly  ·  theme COPY (was CAP)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — status uses a fixed label dictionary (hearingStatusLabel); remaining: benchId/bench label is still not shown on the hearing row
- **First-pass claim:** Status vocabulary (scheduled/held/adjourned/cancelled) is humanised client-side; bench id is never shown.
- **Verified evidence:** Status is humanised via humanize() (HearingsConsole.tsx:291, format.ts:27) - true. benchId exists on Hearing (types.ts:160) but is not rendered in HearingRow (:250-295) - true. The 'capped fetch / client filtering' fix text does not apply: no client filtering in this page; the cap is on getCases (limit=100).
- **Files to change:** `apps/web/src/app/(app)/court/hearings/HearingsConsole.tsx`
- **Fix steps:**
  1. Show bench in HearingRow (needs bench name lookup; benchId alone is a UUID - only display if a bench label endpoint exists, else omit)
  2. Map status to fixed label dictionary rather than humanize() to allow i18n
- **Acceptance:**
  - Row shows bench label when benchId present
  - No raw UUID displayed
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-COURT-HEARINGS-04


---
## /court/orders  —  `court/orders.html`

- **Source:** `apps/web/src/app/(app)/court/orders/page.tsx`
- **Design reference:** `redesign/court/orders.html`

### GAP-COURT-ORDERS-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Approve & issue is offered to every user including the order's own maker; self-approval is only rejected by the server after the DSC is pasted and confirmed (OrdersConsole.tsx:392-400, header copy :108).
- **Verified evidence:** OrdersConsole.tsx:391-400 shows 'Approve & issue' for every pending_approval order regardless of viewer. CourtOrder has createdBy (types.ts:110) but page.tsx does not pass current user id, so the UI cannot hide it. Copy at :108-109 and :562-566 states self-approval is rejected; server error is surfaced (:520-530). The ConfirmDialog already exists, so the finding's suggested fix is partly done; the server enforces maker!=checker but only after DSC paste + confirm. Server rejection is source of truth; UI hint is UX only.
- **Files to change:** `apps/web/src/app/(app)/court/orders/page.tsx`, `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. In orders/page.tsx read the session subject (extend roleGuard.ts with getSessionUserId() from JWT sub) and pass currentUserId to OrdersConsole
  2. In OrderRow, if order.createdBy===currentUserId disable Approve & issue with title/aria-describedby 'You drafted this order; another officer must approve'
  3. Keep server-error handling unchanged
  4. Add approve permission gate (role) if a court approver role exists (decision)
- **Acceptance:**
  - Component test: createdBy===currentUserId -> Approve button disabled with reason
  - Different user -> enabled
  - Server still rejects a forged self-approval
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Client check is convenience only; must not replace server maker-checker. createdBy may be null.

### GAP-COURT-ORDERS-02  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1934 — server-side DSC verification (verifyOrderDsc, result shown, issue blocked until it verifies) plus structural blob validation; remaining: signing is still paste-a-PKCS#7-blob (no token/eSign DscSigner integration; integration choice is a pending decision)
- **First-pass claim:** DSC signature is a free-text textarea for a PKCS7 blob; no token/signer integration or verification feedback — a judicial 'irreversible act' hinges on a paste (OrdersConsole.tsx:536-552).
- **Verified evidence:** OrdersConsole.tsx:536-552 DSC is a plain textarea (placeholder '-----BEGIN PKCS7-----'), validated only as non-empty (:264-269); value goes to approveAndIssueOrder as dscSignature. No token/signer integration or client-side parse. Server verification behaviour cannot be verified (court-service absent).
- **Files to change:** `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`, `apps/web/src/app/(app)/court/_data/client.ts`
- **Fix steps:**
  1. Decision: pick the signing integration (emSigner/DSC token local agent or CDAC eSign) and define the contract
  2. Replace textarea with a DscSigner component that requests a signature over the order hash and returns the PKCS7
  3. Keep paste as a labelled fallback behind admin flag
  4. Show verification result (signer CN, validity) returned by server before final confirm
- **Acceptance:**
  - Order can be signed without pasting a blob using the token
  - Invalid signature shows server verification error, order stays pending_approval
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** High: judicial act; wrong signing flow has legal validity impact. Requires backend/PKI decisions.

### GAP-COURT-ORDERS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Order text renders in full inside the row; long judgments make the list unusable, and there is no preview/print of the issued order (OrdersConsole.tsx:355-365).
- **Verified evidence:** OrdersConsole.tsx:355-359 renders order.orderText fully with whiteSpace:'pre-wrap', no clamp. No preview, print or PDF action for an issued order in this console.
- **Files to change:** `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`
- **Fix steps:**
  1. Clamp text to ~4 lines with 'Show full order' toggle (aria-expanded)
  2. Add 'View / Print' for issued orders opening a print-styled dialog or route (court/orders/[id]) with @media print styles
  3. Include DSC signed/issued stamp fields already in the row
- **Acceptance:**
  - A 5,000-character order shows collapsed by default
  - Print view of issued order renders text, dates and signature status
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Printed copies of orders: ensure only issued orders are printable as official.

### GAP-COURT-ORDERS-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Send back has no confirm and Submit for approval fires immediately although it locks the draft (OrdersConsole.tsx:380-410).
- **Verified evidence:** Submit for approval (OrdersConsole.tsx:379-391, doSubmit :338) fires immediately with no confirm - true. Send back is NOT unconfirmed: SendBackPanel (:600-650) is a two-step panel with an explicit 'Confirm send back' button, though remarks are optional and it uses no ConfirmDialog. 'Locks the draft' cannot be verified against the order domain (service absent) but the workflow comment says draft->pending_approval.
- **Files to change:** `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`
- **Fix steps:**
  1. Wrap doSubmit in ConfirmDialog (non-danger) naming rowLabel and stating the draft becomes read-only
  2. Make send-back remarks required (label without '(optional)') so the maker sees why, or decision if optional is intended
  3. Keep server error surfacing
- **Acceptance:**
  - Clicking Submit opens dialog; Cancel makes no request
  - Send back without remarks blocked (if made required)
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-COURT-ORDERS-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Orders not linked to a hearing in the form although CourtOrder has hearingId (OrdersConsole.tsx:236-300, types.ts).
- **Verified evidence:** client.ts:167-177 recordOrder accepts optional hearingId and CourtOrder has hearingId (types.ts:102), but DraftOrderForm (OrdersConsole.tsx ~150-300) has no hearing field and OrdersConsole has no hearingId reference at all; the row does not display it either.
- **Files to change:** `apps/web/src/app/(app)/court/orders/OrdersConsole.tsx`, `apps/web/src/app/(app)/court/orders/page.tsx`
- **Fix steps:**
  1. In orders/page.tsx also fetch getCaseHearings(caseId) and pass hearings to OrdersConsole
  2. Add optional 'Linked hearing' select to DraftOrderForm passing hearingId to recordOrder
  3. Show linked hearing date on OrderRow
- **Acceptance:**
  - Draft with a chosen hearing sends hearingId
  - Row shows 'Hearing: <date>'
  - No hearing chosen -> unchanged behaviour
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-COURT-HOME-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** court-service is absent from the snapshot; role rules and analytics semantics undeterminable.
- **Service:** `court-service`  ·  **Endpoint(s):** `['GET /api/v1/court/cases/analytics', 'GET /api/v1/court/cases/pendency', 'GET /api/v1/court/cases']`
- **Question:** Who may read analytics/pendency and how are instituted, disposed and clearanceRatePct computed (period, null when zero)?
- **How to verify:** Open court analytics handler; compare with seeded data; call as low-role user.
- **Test to add:** Given 10 instituted and 8 disposed, when GET analytics, then clearanceRatePct = 80 and null when instituted=0; unauthorised role gets 403.
- **Impact if wrong:** Wrong judicial statistics; medium.
- **Web change if wrong:** Relabel metric period.
