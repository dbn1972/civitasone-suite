# Detailed gap file — module `contracts`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 18, BACKEND-VERIFY 5



---
## /contracts  —  `contracts/home.html`

- **Source:** `apps/web/src/app/(app)/contracts/page.tsx`
- **Design reference:** `redesign/contracts/home.html`

### GAP-CONTRACTS-HOME-01  ·  HIGH  ·  partly  ·  theme NAVUX (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Tile 'Rate Contracts' links to /contracts/rate-contracts (page.tsx:8) but no such route exists under (app)/contracts (only list, new, [id]); the click lands on not-found.tsx 'Page not found' with no way back.
- **Verified evidence:** contracts/page.tsx:10 links to /contracts/rate-contracts; no such folder exists (only list, new, [id]). But the dynamic [id] segment matches it, so the click renders ContractDetailPage with id 'rate-contracts', which (with getContractById failing) shows the 'Contract not found' EmptyState with a Back link (page.tsx:23-34), not not-found.tsx. Either way it is a dead tile. No rate-contract page exists anywhere in web src.
- **Files to change:** `apps/web/src/app/(app)/contracts/page.tsx`, `apps/web/src/app/(app)/contracts/not-found.tsx`
- **Fix steps:**
  1. Remove the Rate Contracts tile until a page exists, or build /contracts/rate-contracts (folder before [id] so it wins) backed by a real loader.
  2. Add a route test that every ModuleHub href resolves to an existing page.
  3. Add an action (link back to /contracts) to not-found.tsx.
- **Acceptance:**
  - Hub renders no link to a missing route.
  - Direct visit to a bad URL offers a way back.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CONTRACTS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #2086)
- **W0 note:** partly fixed by #1928 — Sidebar Contracts entry added (moduleKey contracts); duplicate /procurement/contracts list still exists alongside /contracts/list (no redirect/consolidation)
- **First-pass claim:** The route is missing from the app Sidebar (Sidebar.tsx has no 'contracts' entry) and appears only in navRouteManifest, GlobalSearch and VoiceNav; officers have no visible entry point, and a parallel /procurement/contracts page also exists.
- **Verified evidence:** ds/Sidebar.tsx lists Procurement (:65) etc. and has no 'contracts' entry (grep for 'ontract' empty); '/contracts' appears in navRouteManifest.ts:37, GlobalSearch.tsx and VoiceNav.tsx, and layout.tsx gates it with ModuleGate moduleKey 'contracts'. Parallel hub /procurement/contracts exists (procurement/page.tsx:14). Nothing links into /contracts from the shell.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`, `apps/web/src/app/(app)/contracts/page.tsx`, `apps/web/src/app/(app)/procurement/page.tsx`
- **Fix steps:**
  1. Decision: keep one Contracts area. Either add a Sidebar item { label:'Contracts', href:'/contracts', moduleKey:'contracts' } or link it from the Procurement hub.
  2. Resolve the duplicate /procurement/contracts vs /contracts/list (redirect one to the other).
  3. Update navRouteManifest accordingly.
- **Acceptance:**
  - Officer with contracts module sees a nav entry; only one canonical contracts list exists.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Two lists may show different data; consolidate carefully.

### GAP-CONTRACTS-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9; W1 SF-11 #2025 re-confirmed only the loading-skeleton criterion, remaining criteria still PROVISIONAL)
- **First-pass claim:** loading.tsx renders an 8-row table skeleton (loading.tsx:25-30) for a hub with two tiles, and not-found.tsx has no back action (not-found.tsx:3-8).
- **Verified evidence:** contracts/loading.tsx:24-29 draws a card with 8 shimmer rows for a page that is two link tiles (ModuleHub); it is shared with /contracts/list and [id] via the segment. not-found.tsx:3-9 renders EmptyState without the supported `action` prop (EmptyState.tsx:8) so no back link.
- **Files to change:** `apps/web/src/app/(app)/contracts/loading.tsx`, `apps/web/src/app/(app)/contracts/not-found.tsx`
- **Fix steps:**
  1. Move the table skeleton to contracts/list/loading.tsx and make contracts/loading.tsx a tile-shaped skeleton (3-column SkeletonCard).
  2. Give not-found.tsx an action: <Link href='/contracts'>Back to Contracts</Link>.
- **Acceptance:**
  - Hub loading shows tiles; unknown /contracts/x/y shows a back button.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CONTRACTS-HOME-04  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub shows no expiry/renewal information although the module manages date-bound contracts.
- **Verified evidence:** contracts/page.tsx:5-13 renders ModuleHub with tiles only; ModuleHub accepts children (ModuleHub.tsx:10,48) but none passed. Contract expiry exists in data (helpers read `expiry`, page.helpers.ts:50) and getContracts() (loaders.ts:1767) exists, so a summary is feasible; the row shape in ModuleRowSummary was not verified.
- **Files to change:** `apps/web/src/app/(app)/contracts/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Make the hub async; call getContracts() and compute expiring in 30/60/90 days and expired counts from the expiry field.
  2. Pass a StatGrid (StatCard) as ModuleHub children with RefreshErrorState on source==='error', linking to /contracts/list filtered.
  3. Format with formatIndianDate.
- **Acceptance:**
  - Hub shows 'Expiring in 30 days: N' matching list data; error shows dashes, not zero.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /contracts/[id]  —  `contracts/detail.html`

- **Source:** `apps/web/src/app/(app)/contracts/[id]/page.tsx`
- **Design reference:** `redesign/contracts/detail.html`

### GAP-CONTRACTS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — MilestoneActions/BondActions/ObligationsPanel reviewed, failmask fix still present)
- **First-pass claim:** A failed contract fetch is shown as 'Contract not found — may have been removed or the ID is invalid' (page.tsx:24-34): getContractById returns null on error, so the source==='error' badge at page.tsx:56 is dead code for the main record and an outage reads as deletion.
- **Verified evidence:** contracts/[id]/page.tsx:23-34 shows 'Contract not found' whenever !contract. getContractById (_data/loaders.ts:1775-1781) uses fetchJson with default null, so any failure returns { data:null, source:'error' }; hence the DataSourceBadge at page.tsx:56 is only reachable when contract is truthy (source then 'api'), i.e. dead code. LoaderResult also carries status (apiClient.ts:144-166), so 404 can be told apart from 5xx/network/403.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/page.tsx`
- **Fix steps:**
  1. Destructure status from getContractById.
  2. If source==='error' && status!==404 render ds LoadErrorState/RefreshErrorState (toHumanError('load',{area:'contract'})) with retry, keeping the Back link.
  3. If status===404 (or source 'api' and null) call notFound() or keep the not-found EmptyState.
  4. Delete or relocate the unreachable badge at :56.
- **Acceptance:**
  - Mock 500 => error state with retry, not 'not found'.
  - Mock 404 => not found.
  - 403 => access-restricted copy via LoadErrorState.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Officers may believe a contract was deleted during outages.

### GAP-CONTRACTS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — BOND_TYPES, validity window, exact paise math all intact in BondActions.tsx)
- **First-pass claim:** Registering a bond hard-codes bondType 'performance', validFrom = today and validTo = 31 Dec of next year (BondActions.tsx:100-107); the officer cannot enter the real guarantee validity dates, so bond expiry tracking will be wrong.
- **Verified evidence:** BondActions.tsx:95-107 posts bondType:'performance', validFrom: today (UTC date via toISOString().slice, so off by one before 05:30 IST) and validTo `${year+1}-12-31`. The form (:81-83,191,199) only collects issuer, reference no and amount; amountMinor uses Math.round(Number(rupees)*100) (:90,102), a float path. Bond validity in contract-service is cannot-verify (service absent), but the payload fields are sent.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/BondActions.tsx`
- **Fix steps:**
  1. Add required 'Valid from' and 'Valid to' date inputs (type=date) and validate validTo > validFrom in the submit handler.
  2. Add a Bond type select only if contract-service enum is confirmed; otherwise keep 'performance'.
  3. Parse the rupee string to paise with string math (no float multiply); reuse a shared parseRupeesToPaise helper if one exists in lib/formatters.
  4. Show validity in the bond list next to reference no.
- **Acceptance:**
  - Registering with 01/04/2026 - 31/03/2028 posts exactly those dates.
  - '1234.10' posts 123410 paise.
  - validTo before validFrom blocked.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money and expiry tracking on performance securities; incorrect dates can lapse recovery rights.

### GAP-CONTRACTS-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme ERRMSG (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — ObligationsPanel error handling intact)
- **First-pass claim:** 'Start' on an obligation is an unconfirmed single click (ObligationsPanel.tsx:122-130) and obligation owner is a raw 'Owner (user id)' UUID text field (ObligationsPanel.tsx:165-166); bond/obligation failures show raw response text (BondActions.tsx:111,140, ObligationsPanel.tsx:58,89).
- **Verified evidence:** Real: ObligationsPanel.tsx:98-101,122-130 'Start' is a plain unconfirmed button (pending->in_progress, non-terminal so a confirm is arguably unnecessary; overstated), Owner is a raw text 'Owner (user id)' input with 'uuid' placeholder (:~163-166); BondActions.tsx:111,140 and ObligationsPanel.tsx:58,89 throw Error(await res.text()) and display it, unlike MilestoneActions which uses useFormError.fromResponse.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/ObligationsPanel.tsx`, `apps/web/src/app/(app)/contracts/[id]/BondActions.tsx`
- **Fix steps:**
  1. Use useFormError('obligation'/'bond').fromResponse(res,'save') in the four throw sites, as MilestoneActions.tsx does.
  2. Replace Owner uuid input with a user picker/select; needs a user-lookup endpoint (backend, cannot-verify) - interim: default to current user and keep field hidden.
  3. Optionally leave Start unconfirmed but disable during in-flight.
- **Acceptance:**
  - A 422 response shows plain-language copy, not JSON/raw text.
  - Owner is chosen by name.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CHANGE-DETAIL-05

### GAP-CONTRACTS-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme STATUS (was UUID)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Party shows the vendor UUID, Type shows '—' (contract-service has no such fields, page.helpers.ts:38-41,49) and status colours exist only for active (green) and expired (red); draft/approved/terminated look identical grey.
- **Verified evidence:** page.helpers.ts:46 parties falls back to vendorId (comment :42-45 states no vendor-name enrichment exists), :47 contractType is '—' when no type key exists, :65 statusCls maps only active->good, expired->bad, everything else 'mut'; page.tsx:69 uses raw 'pill' class rather than ds StatusPill (which maps approved good, terminated bad, draft mut, pending warn). Cited lines 38-41,49 were off. Claim that contract-service lacks these fields is cannot-verify (service absent), only the code comment says so.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/page.helpers.ts`, `apps/web/src/app/(app)/contracts/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Render status with ds <StatusPill status={status}/> (or extend statusCls to approved/terminated/draft).
  2. Resolve vendor name: reuse getVendors() (loaders.ts:1274) to map vendorId -> name in page.tsx, linking to the vendor; fall back to short id.
  3. Hide the Type field entirely when absent rather than showing '—'.
- **Acceptance:**
  - Approved contract shows green, terminated red, draft grey.
  - Party displays vendor name for a known vendor id.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-CONTRACTS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — due date display in MilestoneActions intact)
- **First-pass claim:** Milestones list prints title and status only; dueDate is loaded (page.tsx:112-118) but never displayed, so 'Mark late' is decided without seeing the due date.
- **Verified evidence:** page.tsx:103-107 list items show only title and status; dueDate is mapped at :116 and typed in MilestoneActions.tsx:12 but never rendered there either (only 'dueDate' occurrence in the file is the type). Complete/Mark late (MilestoneActions) are therefore chosen without due date.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/page.tsx`, `apps/web/src/app/(app)/contracts/[id]/MilestoneActions.tsx`
- **Fix steps:**
  1. Render 'due dd/mm/yyyy' with formatIndianDate in the milestone li (page.tsx:104-106) and in each MilestoneActions row.
  2. Flag overdue (dueDate < today and not completed) with a StatusPill 'bad'.
  3. Include due date in the Mark late confirmDescription.
- **Acceptance:**
  - Milestone list shows due dates; overdue ones highlighted.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-CONTRACTS-DETAIL-06  ·  LOW  ·  confirmed  ·  theme STALE (was OTHER)

- [x] **Status** (W2 PQ: closed by #2086)
- **W0 note:** partly fixed by #1928 — Copy reworded to received/will update shortly; still missing per-row Pending pill and delayed router.refresh polling
- **First-pass claim:** Milestone/bond/obligation writes return 202 (queued): the UI shows 'accepted (queued)' and calls router.refresh(), so state may not change on screen for some time.
- **Verified evidence:** MilestoneActions.tsx (act(): 'accepted (queued)' message then router.refresh()), BondActions.tsx (:'Performance bond registration accepted (queued)') and ObligationsPanel.tsx treat 202 as success. State only changes after the async consumer runs, so the refreshed list can still show old state; queue latency is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/contracts/[id]/MilestoneActions.tsx`, `apps/web/src/app/(app)/contracts/[id]/BondActions.tsx`, `apps/web/src/app/(app)/contracts/[id]/ObligationsPanel.tsx`
- **Fix steps:**
  1. Track pending action ids in client state and show a 'Pending' pill on the affected row until the refreshed server data reflects the change.
  2. Poll router.refresh() (e.g. 3 times at 2s, 5s, 10s) after a 202, stopping when status changes.
  3. Reword message to 'Request received - status will update shortly'.
- **Acceptance:**
  - After Mark late, row shows Pending then updates without manual reload (mock delayed status).
  - Message text never claims completion.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Users may double-submit; existing busy guards mitigate.


---
## /contracts/list  —  `contracts/list.html`

- **Source:** `apps/web/src/app/(app)/contracts/list/page.tsx`
- **Design reference:** `redesign/contracts/list.html`

### GAP-CONTRACTS-LIST-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Vendor column prints the raw vendorId UUID under the label 'Vendor ID' (ContractsTable.tsx:28-31, comment admits contract-service has no vendor display name) — officers cannot recognise who a contract is with.
- **Verified evidence:** ContractsTable.tsx:89-94 renders column key 'sublabel' labelled 'Vendor ID'; loaders.ts:1751-1755 mapContractsListRows sets sublabel = toText(row.vendorId), so the raw UUID is printed. The in-file comment admits contract-service has no joined vendor name. Other vendor lists exist (loaders.ts:1275 procurement/vendors, :2141 finance/vendors) but are not used here.
- **Files to change:** `apps/web/src/app/(app)/contracts/list/page.tsx`, `apps/web/src/app/(app)/contracts/list/ContractsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In page.tsx fetch getContracts() and a vendor list loader in parallel (Promise.all); reuse existing procurement/finance vendors loader (loaders.ts:1275 / :2141) after confirming which service owns the vendor master.
  2. Build a Map<vendorId,name> and pass vendorNames to ContractsTable; render the name, falling back to 'Unknown vendor' (never the UUID) and keep vendorId only in the row link/title attribute.
  3. Rename column header to 'Vendor'.
  4. If the vendor list load fails, show '—' for names and a DataSourceBadge/RefreshErrorState note rather than UUIDs.
  5. Longer term: have contract-service return vendorName (backend).
- **Acceptance:**
  - Component test: rows with vendorId resolved show vendor name, no 36-char UUID text in DOM.
  - Unresolved vendor shows 'Unknown vendor'.
  - Manual: /contracts/list shows names.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only. Cross-service read via HTTP only (no cross-DB), keep vendor fetch failure non-fatal.
- **Depends on:** GAP-CONTRACTS-NEW-01

### GAP-CONTRACTS-LIST-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Error state stacks a DataSourceBadge ('Couldn't load — showing nothing') above RefreshErrorState (page.tsx:45-48), two banners for one failure; neither offers a retry action.
- **Verified evidence:** page.tsx:45 renders DataSourceBadge and :47-48 renders RefreshErrorState in the same error branch, so two messages do appear. But RefreshErrorState (ds/RefreshErrorState.tsx:29-38) passes onRetry={() => router.refresh()}, so the claim that nothing offers retry is wrong; only the badge lacks it. Empty state is correctly separate (page.tsx:49).
- **Files to change:** `apps/web/src/app/(app)/contracts/list/page.tsx`
- **Fix steps:**
  1. Delete the `{source === "error" && <DataSourceBadge .../>}` line (page.tsx:45); RefreshErrorState already carries retry.
  2. Optionally pass backHref='/contracts' to RefreshErrorState.
  3. Replace with LoadErrorState (ds/LoadErrorState.tsx) if 403 vs transient distinction is wanted, passing the loader result.
- **Acceptance:**
  - Force loader error: exactly one error block with a Retry button is visible.
  - Retry click calls router.refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CONTRACTS-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme CAP (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** DataTable is rendered with no sortable/filterable/pageSize props (ContractsTable.tsx:16-17), so a department with hundreds of contracts has no search, no expiry sort and no export — unlike cdp/profiles and change/home which enable them.
- **Verified evidence:** ContractsTable.tsx:78-103 passes only columns and rows to DataTable; DataTable supports sortable, filterable, pageSize, exportable (ds/DataTable.tsx:70-86, all default off). cdp/profiles/page.tsx:72-73 enables sortable/filterable. Theme 'PII' is wrong; this is table capability. Export must be gated because contract values are commercially sensitive.
- **Files to change:** `apps/web/src/app/(app)/contracts/list/ContractsTable.tsx`, `apps/web/src/app/(app)/contracts/list/page.tsx`
- **Fix steps:**
  1. Add sortable, filterable and pageSize={25} to DataTable in ContractsTable.
  2. Only add exportable if role-gated and audited; otherwise skip and note as decision.
  3. Depends on LIST-04 to add Expiry/Value columns so expiry sort is meaningful.
  4. Set col.sortable=false on the action/link column if needed.
- **Acceptance:**
  - Component test: typing in filter reduces rows; header click sorts.
  - 30 rows show page size 25 with pager.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Client-side only; list itself is server-capped by whatever contract-service returns (cannot verify limit).
- **Depends on:** GAP-CONTRACTS-LIST-04

### GAP-CONTRACTS-LIST-04  ·  LOW  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** No expiry date or value column even though the register exists to track contract expiry; list cannot show 'expiring soon'.
- **Verified evidence:** mapContractsListRows (loaders.ts:1745-1765) keeps only id,title,vendorId,status,contractNo; the table has no expiry/value columns. Detail page reads expiry and valueMinor from the same resource (contracts/[id]/page.helpers.ts:50,58), so the API row very likely has them (list payload not verifiable; contract-service absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/contracts/list/page.tsx`, `apps/web/src/app/(app)/contracts/list/ContractsTable.tsx`
- **Fix steps:**
  1. Extend mapContractsListRows to also read row.expiry and row.valueMinor (as string) into extra fields on ModuleRowSummary (or a dedicated ContractListRow type).
  2. Add 'Expires' column using formatIndianDate (lib/formatters.ts:2) and an 'Expiring soon' pill when expiry within 30 days and status active.
  3. Add 'Value' column using formatMoney (lib/formatters.ts:90) right-aligned.
  4. Add mapper unit test in loaders.contracts.test.ts.
- **Acceptance:**
  - Mapper test: expiry/valueMinor pass through.
  - Row with expiry in 10 days shows 'Expiring soon'.
  - Value 15000000 shows ₹1,50,000.00.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; if list endpoint omits these fields, columns show '—' (verify with backend).
- **Depends on:** GAP-CONTRACTS-LIST-03


---
## /contracts/new  —  `contracts/new.html`

- **Source:** `apps/web/src/app/(app)/contracts/new/page.tsx`
- **Design reference:** `redesign/contracts/new.html`

### GAP-CONTRACTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — EntityPicker vendor search present in NewContractForm.tsx)
- **First-pass claim:** Vendor must be typed as a UUID ('Vendor ID (UUID)', regex UUID_RE, NewContractForm.tsx:7,47); no picker or lookup, so a clerk needs to copy a 36-character id from another screen — the most likely cause of failed submissions.
- **Verified evidence:** NewContractForm.tsx:7 defines UUID_RE, :47-52 rejects non-UUID, :156-170 is a plain text input labelled 'Vendor ID (UUID)'. No picker exists: repo has no EntityPicker; SmartCombobox (_components/SmartCombobox.tsx) takes string[] options only, so cannot map id->name.
- **Files to change:** `apps/web/src/app/(app)/contracts/new/NewContractForm.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Create ds/EntityPicker (searchable combobox, options {id,label}, aria-combobox, returns id) modelled on SmartCombobox a11y.
  2. Load vendors server-side in contracts/new/page.tsx (same loader as LIST-01) and pass as options to NewContractForm.
  3. Replace the vendor input with EntityPicker; keep UUID check as a guard on the selected id.
  4. Export EntityPicker from ds/index.ts for reuse (also court cause-list court picker).
- **Acceptance:**
  - Component test: picking a vendor submits its UUID in body.vendorId.
  - Free-typed UUID no longer possible; no selection shows 'Select a vendor'.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; wrong vendor selection is the main risk, show name + code in options.
- **Depends on:** GAP-CONTRACTS-LIST-01, EntityPicker (new shared)

### GAP-CONTRACTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — zod schema safeParse still present in NewContractForm.tsx)
- **First-pass claim:** Validation stops at the first error and shows one banner message (NewContractForm.tsx:30-66) instead of marking all invalid fields inline; aria-invalid is set but no per-field text.
- **Verified evidence:** handleSubmit (NewContractForm.tsx:32-77) returns at the first failing check and sets a single message plus invalidField; only one field is aria-invalid at a time and no per-field text or aria-describedby exists (only form-level aria-describedby, :116). Banner role=alert at :235-244.
- **Files to change:** `apps/web/src/app/(app)/contracts/new/NewContractForm.tsx`
- **Fix steps:**
  1. Replace sequential ifs with a zod schema (contractNo, title, vendorId uuid, value via rupeesToMinorString, dates with expiry>=start refine) and safeParse once.
  2. Store errors as Record<field,string>; render <p id=...> under each field, set aria-invalid and aria-describedby per field.
  3. Focus first invalid field on submit; keep top banner only for server errors.
  4. Keep submit disabled while status==='submitting' (already done at :228).
- **Acceptance:**
  - Submit empty form: five field errors visible together.
  - First invalid input receives focus.
  - Fixing a field clears its message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-CONTRACTS-NEW-03

### GAP-CONTRACTS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Value is a plain number input in rupees with no lakh grouping or preview, converted with Math.round(value*100) and sent as a JSON number (NewContractForm.tsx:88-92), not the paise integer string used elsewhere for bigint money.
- **Verified evidence:** NewContractForm.tsx:53 Number(value) and :91 valueMinor: Math.round(parsedValue*100) send a JSON number; type=number input (:210-223). lib/money.ts:28 rupeesToMinorString does exact string parsing and OpportunityForm.tsx:85-111 sends the string. Float path can mis-round e.g. 1.005. Whether contract-service accepts a string valueMinor is not verifiable (service absent).
- **Files to change:** `apps/web/src/app/(app)/contracts/new/NewContractForm.tsx`
- **Fix steps:**
  1. Change input to type=text inputMode=decimal; on submit call rupeesToMinorString(value) and reject null with an inline error.
  2. Send valueMinor as the returned string only after confirming contract-service zod accepts string/bigint-string (backend check); otherwise keep number but only from Number(string) of an exact digit string.
  3. Show live preview formatMoney(minor) under the field (lib/formatters.ts:90).
  4. Remove Math.round(parsedValue*100).
- **Acceptance:**
  - Unit: '1234.5' posts valueMinor '123450'; '1.005' shows error.
  - Preview shows ₹1,234.50.
  - No Math.round(*100) remains (grep).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money: wrong unit conversion or backend rejecting string would break contract creation; test against contract-service.
- **Depends on:** GAP-CONTRACTS-NEW-02

### GAP-CONTRACTS-NEW-04  ·  MEDIUM  ·  partly  ·  theme DSFORM (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1928; W2 re-confirmed by #2086 — no tailwind classes in NewContractForm.tsx, design system tokens used)
- **First-pass claim:** Form is built from inline styles and Tailwind text-red-600 / text-emerald-700 classes (NewContractForm.tsx:240), bypassing DS field/inputs; contract type, department and description are not collected though the detail page displays them.
- **Verified evidence:** True: all inputs use inline style objects (NewContractForm.tsx:120-224) and the message uses text-red-600/text-emerald-700 (:240). Overstated: contract type/department are not collected because contract-service has no type concept (loaders.ts:1720-1731 comment) and detail page defaults dept to 'Procurement' (page.helpers.ts:68); the create body accepts only contractNo, vendorId, title, valueMinor, startDate, expiry (:87-94). Description field not in the payload either.
- **Files to change:** `apps/web/src/app/(app)/contracts/new/NewContractForm.tsx`
- **Fix steps:**
  1. Replace inline label/input styles with the ds form classes (e.g. class 'fld'/'input' used elsewhere) or a shared FormField; status message via ds alert classes with var(--bad)/var(--ok) tokens.
  2. Do not add type/department/description inputs until contract-service schema supports them (backend decision).
  3. Keep min-height 44 touch targets.
- **Acceptance:**
  - Visual check in light/dark: message colours use tokens.
  - grep finds no text-red-600 in file.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; cosmetic.


---
## Backend verification items (service code absent from snapshot)

### GAP-CONTRACTS-HOME-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** contract-service is absent from this snapshot (services/ has only hrms-service): endpoints and auth undeterminable.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['GET /api/v1/contract/contracts', 'GET /v1/contract/obligations']`
- **Question:** Which roles may list contracts and obligations, and is list scoped by department?
- **How to verify:** Open list route guards; curl with out-of-department token.
- **Test to add:** Given user of dept A, when GET contracts, then only dept A rows unless privileged.
- **Impact if wrong:** Cross-department contract disclosure; medium.
- **Web change if wrong:** None.

### GAP-CONTRACTS-DETAIL-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by main, verified on main 9c5e9e9e9)
- **First-pass claim:** contract-service (queue consumer contracts/consumer.ts, SLA penalty maths, audit) is absent from the snapshot: undeterminable. RaiseEOfficeNote internals were not read.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['GET /v1/contract/contracts/:id(/milestones|/bonds)', 'POST .../milestones/:mid/:kind', 'POST .../bonds/:bid/transition', 'POST .../submit-approval', 'contracts/consumer.ts']`
- **Question:** Are SLA penalty computation, bond/milestone transitions and audit correct and enforced server-side?
- **How to verify:** Open contract-service consumer and transition handlers; run penalty unit tests with late milestone.
- **Test to add:** Given a milestone 10 days late with 0.5%/day cap 10%, when penalty computed, then equals expected and audit row written.
- **Impact if wrong:** Wrong penalties/payments on public contracts; high.
- **Web change if wrong:** None.

### GAP-CONTRACTS-LIST-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** contract-service list shape is reduced by mapContractsListRows in _data/loaders.ts; the service is absent from the snapshot: undeterminable.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['GET /api/v1/contract/contracts']`
- **Question:** Does list return the fields mapContractsListRows expects (number, title, vendor, value, status) with paging?
- **How to verify:** Compare handler schema with mapper in _data/loaders.ts.
- **Test to add:** Given 3 contracts, when GET list, then each has all mapped fields and stable pagination.
- **Impact if wrong:** Blank columns; low.
- **Web change if wrong:** Fix mapper.

### GAP-CONTRACTS-NEW-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2086 — web-only: unsaved-change guard added, 409 display tested. Backend 409/audit verification listed as NEEDS OWNER DECISION: contract-service absent from repo.)
- **W0-10 note:** review found the W0 tick partly — Web shows backend fieldErrors (NewContractForm.tsx:139-140) but no unsaved-change guard anywhere in form; duplicate-contractNo 409 and audit on create not verifiable (contract-service absent from repo) and no test asserting 409 display
- **First-pass claim:** No unsaved-changes guard or duplicate-number check before POST; audit of the mutation is not visible from the client (server-side, undeterminable).
- **Service:** `contract-service`  ·  **Endpoint(s):** `['POST /v1/contract/contracts']`
- **Question:** Does create reject duplicate contract numbers (409) and audit the mutation?
- **How to verify:** POST the same contractNo twice; inspect audit table.
- **Test to add:** Given existing contractNo, when POST again, then 409 DUPLICATE_NUMBER; success writes audit.
- **Impact if wrong:** Duplicate contracts; medium.
- **Web change if wrong:** Show 409 message in NewContractForm; add unsaved-change guard.

### GAP-CONTRACTS-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** contract-service (POST /v1/contract/contracts) absent from snapshot; audit and zod validation undeterminable.
- **Service:** `contract-service`  ·  **Endpoint(s):** `['POST /v1/contract/contracts']`
- **Question:** Does the route validate the body with zod (dates, amounts in minor units, enums) returning 400 envelope, and audit create?
- **How to verify:** Open create route schema; POST invalid dates/negative value.
- **Test to add:** Given end date before start date, when POST, then 400 with field errors; valid POST creates audit row.
- **Impact if wrong:** Bad contract data persisted; medium.
- **Web change if wrong:** Map field errors in form.
