# Detailed gap file — module `assets`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 126, BACKEND-VERIFY 22, CANNOT-VERIFY 3, REFUTED 1



---
## /assets  —  `assets/home.html`

- **Source:** `apps/web/src/app/(app)/assets/page.tsx`
- **Design reference:** `redesign/assets/home.html`

### GAP-ASSETS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme IA (was DEADROUTE)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Flat list of 16 tiles with no grouping or counts; Register Asset, Bulk Import, Barcode Scan and Physical Verification sit beside read-only registers (page.tsx:12-29). Suggest grouping: Register / Operate / Account / Dispose.
- **Verified evidence:** apps/web/src/app/(app)/assets/page.tsx:13-28 passes 16 flat links to ModuleHub (ModuleHub.tsx supports only a flat links array, LinkTiles columns='three'); no groups or counts. All 16 target routes exist under assets/. Not a dead-route issue.
- **Files to change:** `apps/web/src/app/(app)/assets/page.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`
- **Fix steps:**
  1. Add optional groups prop to ModuleHub ({heading, links[]}) rendering one LinkTiles per group; keep flat links for other modules.
  2. In assets/page.tsx group: Register (Register Asset, Bulk Import, Barcode Scan, Physical Verification), Registers (Asset Register, Fixed Assets, Infrastructure, Locations, Leases, Projects), Operate (Maintenance, Fleet, Insurance), Account & Dispose (Depreciation Run, Condemnation & Disposal), Dashboard first.
  3. Optional: counts later.
- **Acceptance:**
  - Hub shows 4-5 headed groups covering all 16 tiles with no duplicates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify nav tests/manifest (navRouteManifest.ts) unaffected.

### GAP-ASSETS-HOME-02  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Hub subtitle and every tile label/note are hard-coded English strings while the title uses next-intl t("title") (page.tsx:10-27).
- **Verified evidence:** apps/web/src/app/(app)/assets/page.tsx:10 uses t('title') but description (apps/web/src/app/(app)/assets/page.tsx:11) and all link labels/notes (apps/web/src/app/(app)/assets/page.tsx:13-28) are literal English. Only 2 files under assets/ use next-intl at all, so this is module-wide.
- **Files to change:** `apps/web/src/app/(app)/assets/page.tsx`, `apps/web/messages/en.json (and hi/or locale files)`
- **Fix steps:**
  1. Add assets.description and assets.links.<key>.label/note keys to each locale file.
  2. Use t() in page.tsx to build the links array.
- **Acceptance:**
  - Switching locale changes hub subtitle and tiles.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Missing keys break rendering; add to all locales.

### GAP-ASSETS-HOME-03  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** loading.tsx renders four stat blocks and a table block, which the static hub never shows (loading.tsx:7-13).
- **Verified evidence:** assets/loading.tsx:7-13 renders header bars, 4 stat blocks (grid-cols-2 md:grid-cols-4) and a 72-height table block; the hub is a static server page with a tile grid. Also uses Tailwind slate classes and min-h-screen wrapper, unlike other loading files (var(--line) skeletons).
- **Files to change:** `apps/web/src/app/(app)/assets/loading.tsx`
- **Fix steps:**
  1. Reshape skeleton to header + 3-column tile grid (or make it a generic header + card skeleton since it also covers child routes lacking their own loading.tsx).
  2. Use var(--line) skeleton style like infra/loading.tsx; remove min-h-screen wrapper.
- **Acceptance:**
  - Navigating to /assets shows tile-shaped skeleton without layout jump.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** RouteError area "Assets page" reads "couldn't open Assets page" (error.tsx:13; RouteError.tsx:60).
- **Verified evidence:** assets/error.tsx:13 passes area='Assets page'; RouteError.tsx:63 renders "We couldn't open {area}." giving 'couldn't open Assets page' (missing article). Same-pattern in fleet error files not checked.
- **Files to change:** `apps/web/src/app/(app)/assets/error.tsx`
- **Fix steps:**
  1. Change area to 'Assets' (or 'the Assets page') so the sentence reads correctly.
- **Acceptance:**
  - Trigger error: message reads 'We couldn't open Assets.' or 'the Assets page'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/[id]  —  `assets/detail.html`

- **Source:** `apps/web/src/app/(app)/assets/[id]/page.tsx`
- **Design reference:** `redesign/assets/detail.html`

### GAP-ASSETS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Depreciation/maintenance sub-fetch failures are invisible: getAssetById returns {...base, data:{…}} so source is the base call only (loaders.ts:3827-3835); the RefreshErrorState in the schedule card and the top badge are unreachable with a non-null asset (page.tsx:49,75-76). A failed /depreciation reads as “No depreciation schedule”.
- **Verified evidence:** loaders.ts:3808-3837: getAssetById returns early if base has no data (l.3814), otherwise spreads `...base` so source is only the base call's; dep and maint results' `.source` are discarded and failures become `[]` (l.3833-3834). page.tsx:75-76 RefreshErrorState fires only on source==='error' which cannot hold with non-null asset (page.tsx:13 returns earlier), and l.49 badge likewise unreachable. A failed /depreciation therefore shows 'No depreciation schedule' (l.77-78); a failed /maintenance hides the history card (l.111).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_data/apiClient.ts (LoaderResult type, optional)`, `apps/web/src/app/(app)/assets/[id]/page.tsx`
- **Fix steps:**
  1. In getAssetById return extra fields `depSource: dep.source` and `maintSource: maint.source` (extend AssetDetail loader result type, e.g. `parts: {depreciation: LoaderSource; maintenance: LoaderSource}`).
  2. In page.tsx use `parts.depreciation === 'error'` for RefreshErrorState (l.75) and add an error branch for the maintenance card instead of hiding it when errored.
  3. Show DataSourceBadge when any part errored.
- **Acceptance:**
  - Unit test getAssetById: mock depreciation 500 -> result.parts.depreciation==='error', data.depreciationSchedule=[].
  - RTL: page with depreciation error shows RefreshErrorState not 'No depreciation schedule'.
  - Base 404 path unchanged.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; loader result shape change - check other callers of getAssetById.

### GAP-ASSETS-DETAIL-02  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Three overlapping disposal routes on one screen: Request disposal (workflow), Direct dispose (explicitly bypasses eOffice and is GFR-irreversible) and the RaiseEOfficeNote “Raise for approval” — with no role gate or reason field on Direct dispose (AssetDetailActions.tsx:257-315, 406-422).
- **Verified evidence:** AssetDetailActions.tsx: 'Request disposal' (l.251-255, dialog l.392-404 requireReason) is the workflow route; 'Direct dispose' (l.257-315) has a ConfirmDialog (l.406-422) that warns of bypass but has NO requireReason (unlike the others) and the notes textarea is optional; page also mounts RaiseEOfficeNote 'Raise for approval' for asset_disposal (page.tsx:128-136). None are role-gated client-side (component receives no roles; comment l.51-54 says gated 'at the gateway'). Server enforcement is cannot-verify (asset-service absent). Direct disposal proceeds go through PATCH .../dispose which per the comment posts to GL.
- **Files to change:** `apps/web/src/app/(app)/assets/[id]/page.tsx`, `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx`
- **Fix steps:**
  1. In page.tsx call getSessionRoles() (lib/auth/roleGuard.ts) and pass `roles` to AssetDetailActions (pattern: works/proposals/[id]/page.tsx -> ProposalActions).
  2. Define ASSET_DISPOSE_DIRECT_ROLES in lib/auth/ (new constant next to workRoles.ts, derive from asset-service guards) and render the Direct dispose block only for those roles.
  3. Add `requireReason` + reasonLabel to the directDisposeAction ConfirmDialog and send reason in the PATCH body (confirm server schema accepts it or map to notes).
  4. Consider hiding 'Request disposal' when an eOffice file already exists (RaiseEOfficeNote knows) or merge the two into one 'Dispose' flow with a route choice.
- **Acceptance:**
  - RTL: role without dispose rights sees no Direct dispose block.
  - Direct dispose dialog Confirm disabled until reason >= min length.
  - Server 403 still surfaces in dialog.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Irreversible GL-posting disposal; client gate is UX only - server must remain authoritative.
- **Depends on:** GAP-ASSETS-DETAIL-05

### GAP-ASSETS-DETAIL-03  ·  HIGH  ·  confirmed  ·  theme XSS (was OTHER)

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Print QR writes the user-typed barcode into a popup via document.write without escaping (AssetDetailActions.tsx:221-227): a barcode such as <img onerror> executes in the popup origin.
- **Verified evidence:** AssetDetailActions.tsx:221-227: printQr builds HTML with `<h2>${code}</h2>` where code = tagCode (free-text input l.239) || barcode || id, and calls w.document.write(...). window.open('') yields an about:blank window inheriting the opener's origin, so an injected `<img src=x onerror=...>` runs with the app origin (cookies/DOM access), not an isolated one. Self-XSS from typing, but barcode/serialNo prop also comes from server data (page.tsx:58), so a stored payload set by another user by PATCH barcode fires for a viewer who clicks Print QR. Also no actual QR is drawn and w.print() is called before load/close.
- **Files to change:** `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx`
- **Fix steps:**
  1. Never document.write user data: build nodes with createElement and textContent (h2.textContent = code).
  2. Alternatively navigate to a dedicated /assets/[id]/tag print page rendered by React (auto-escaped) and call window.print() there.
  3. Render a real QR (existing lib in repo if any; otherwise add one) instead of plain text.
  4. Validate barcode on tag (tagAsset l.79) with a zod pattern such as /^[A-Za-z0-9\-_/.]{1,64}$/ and mirror on server.
  5. Add w.opener = null / noopener.
- **Acceptance:**
  - Unit test: printQr with code '<img src=x onerror=alert(1)>' produces text node, no element injection (spy on popup document).
  - Tagging a barcode with '<' is rejected by the form.
  - Manual: Print QR opens print dialog showing the literal string.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Security fix; no business risk. Server-side validation is cannot-verify.

### GAP-ASSETS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Schedule AMC fires immediately with a hard-coded “annual / +365 days / AMC plan” body and no confirm or audit reason (AssetDetailActions.tsx:99-120), although it creates a maintenance schedule.
- **Verified evidence:** AssetDetailActions.tsx:99-120 scheduleAmc POSTs immediately from the button (l.244) with hard-coded frequency 'annual', nextDue now+365d (l.108, browser clock) and description 'AMC plan'; no ConfirmDialog, no reason, no vendor/cost input. Result: silent creation of a maintenance schedule the user cannot parameterise. Audit emission is a server duty (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx`
- **Fix steps:**
  1. Replace direct click with a small form in a ConfirmDialog: frequency select, first due date (type=date, default +365d in IST), vendor/description.
  2. Use useConfirmAction (as transferAction l.123) with requireReason if policy demands; otherwise plain confirm.
  3. Send the entered values instead of hard-coded ones; prevent double-submit via busy.
  4. Show created schedule in Maintenance history after router.refresh().
- **Acceptance:**
  - Clicking Schedule AMC opens a dialog; no POST until confirmed.
  - POST body carries chosen frequency/date/description.
  - Cancel sends nothing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; creates records only.

### GAP-ASSETS-DETAIL-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Status mismatch between cards: actions card hides for disposed/written_off (AssetDetailActions.tsx:229) but financial actions hide only for disposed/condemned (page.tsx:59), so a written_off asset still offers impairment and revaluation; condemned assets still show disposal actions.
- **Verified evidence:** AssetDetailActions.tsx:229 returns null for 'disposed'|'written_off'; page.tsx:59 hides AssetFinancialActions for 'disposed'|'condemned'. Effects: condemned assets show all disposal/transfer actions; written_off shows impairment/revaluation. Worse: mapAssetSummaries (apiMappers.ts:~832-838) folds any status other than in_use/maintenance/disposed/condemned into 'active', so 'written_off' never reaches the UI and the l.229 check is dead - a written-off asset shows every action card.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `@civitasone/types (AssetSummary.status) - not in snapshot`, `apps/web/src/app/(app)/assets/[id]/page.tsx`, `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx`
- **Fix steps:**
  1. Add 'written_off' (and any other real server statuses) to the status union and to mapAssetSummaries instead of defaulting to 'active'.
  2. Create one helper `isTerminalAsset(status)` = disposed|written_off|condemned (in lib/ or next to mapper) and use it in page.tsx:59 and AssetDetailActions.tsx:229.
  3. Decide whether 'condemned' should still allow the disposal workflow (condemnation leads to disposal); if yes, allow only disposal actions and hide transfer/impairment.
- **Acceptance:**
  - Unit test isTerminalAsset for each status.
  - RTL: written_off and disposed assets render neither card; condemned renders per decision.
  - Mapper test: 'written_off' stays 'written_off'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Changing default-to-active affects list/status pills across assets; confirm server enum first.

### GAP-ASSETS-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Request disposal always sends disposalMethod "sale" and converts proceeds with Number(minorString) (AssetDetailActions.tsx:145-152); proceeds keyed as “0” silently pass.
- **Verified evidence:** AssetDetailActions.tsx:144-152: disposalMethod hard-coded 'sale' (l.150) though the direct form offers 5 methods; proceedsMinor: Number(proceedsMinor) (l.151, and l.172) - converts a paise string to a JS number, precision loss above 2^53 and float in a money field. `proceedsToMinorString(proceeds) ?? '0'` turns an invalid entry (e.g. '12.345', 'abc') into 0 silently, not only a typed '0'; the request-disposal dialog has no proceeds validation (only direct dispose has validateDirectDispose l.201). Zero proceeds are legitimately allowed by design (l.14-25).
- **Files to change:** `apps/web/src/app/(app)/assets/[id]/AssetDetailActions.tsx`
- **Fix steps:**
  1. Add a disposal-method <select> to the Request disposal block (reuse the option list from l.276-280) and send it.
  2. Call a validateRequestDisposal() before disposeAction.trigger(): reject null from proceedsToMinorString with the same inline error as direct dispose.
  3. Send proceedsMinor as the string when the server zod accepts string; otherwise use Number only after asserting Number.isSafeInteger and raise a backend ask for string/bigint support.
  4. Show the proceeds via formatMoney(BigInt(minor)) in the dialog.
- **Acceptance:**
  - Entering '12.345' blocks submit with an error.
  - Selecting 'scrap' sends disposalMethod:'scrap'.
  - Unit test: proceeds '99999999999999999' is rejected or sent as string (never rounded).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money field into GL; verify server schema (asset-service absent) before switching type.

### GAP-ASSETS-DETAIL-07  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** RaiseEOfficeNote asks the clerk to type “Initiating officer ID” and “Forward to officer ID” as raw employee UUIDs (RaiseEOfficeNote.tsx:175-179) instead of an officer picker.
- **Verified evidence:** RaiseEOfficeNote.tsx:174-179 label 'Initiating officer ID' / 'Forward to officer ID' with placeholders 'employee UUID' / 'approver UUID'; submit rejects non-UUID (l.102-103). Component is shared (grants disbursements, hr disciplinary, inspection, finance sanctions, assets), so the problem is systemic. No EntityPicker/EmployeePicker exists in the repo (grep). An employee list loader exists (loaders.ts ~l.1124 /api/v1/hrms/employees).
- **Files to change:** `apps/web/src/app/_components/RaiseEOfficeNote.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Create ds/EntityPicker (combobox, debounced search, returns id, displays name+designation) backed by /api/proxy/v1/hrms/employees?search=... (verify the query param exists in hrms-service).
  2. Default 'Initiating officer' to the signed-in user's employee id (session claims) and make it read-only when known.
  3. Replace both text inputs in RaiseEOfficeNote with EntityPicker; keep UUID validation on the selected value.
  4. Keep ids out of visible copy.
- **Acceptance:**
  - RTL: typing a name lists matching employees; selecting sets the UUID in the POST payload.
  - User can raise without ever seeing a UUID.
  - Empty selection shows validation error.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared component used in 6+ modules - regression-test each call site; PII exposure in search results needs role scoping.
- **Depends on:** EntityPicker (new shared component)

### GAP-ASSETS-DETAIL-08  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Lifecycle marks “Tagged” done for every non-disposed asset regardless of barcode, and “AMC” done from warrantyExpiry (page.tsx:104,106) — the timeline asserts states the data does not prove.
- **Verified evidence:** page.tsx:104 'Tagged' is `done` unless status is condemned/disposed - independent of any barcode (the mapper folds barcode into serialNo, apiMappers.ts:864, and `ext.barcode` is never populated); l.106 'AMC' is `done` when warrantyExpiry exists, but warranty is not an AMC contract (AMC is created by scheduleAmc as a maintenance schedule). Also 'In use' is `cur` only for in_use/active, so a maintenance-status asset has no current step.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/assets/[id]/page.tsx`
- **Fix steps:**
  1. Map `barcode` explicitly in mapAssetDetail and set 'Tagged' done only if truthy.
  2. Set 'AMC' from the maintenance schedules (e.g. any history/schedule row of frequency annual, or an amc flag if the API has one - cannot-verify) and show warranty separately as 'Warranty until <date>'.
  3. Give the 'maintenance' status a cur state.
- **Acceptance:**
  - Asset without barcode: Tagged step is todo.
  - Asset with warranty but no AMC: AMC step todo.
  - Unit test on the lifecycle derivation function (extract it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display logic.


---
## /assets/bulk-import  —  `assets/bulk-import.html`

- **Source:** `apps/web/src/app/(app)/assets/bulk-import/page.tsx`
- **Design reference:** `redesign/assets/bulk-import.html`

### GAP-ASSETS-BULK-IMPORT-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Live register can receive the sample row: the textarea is pre-filled with “Sample Laptop,LAP/001,it,45000,HQ” and the button is enabled, so one click + confirm creates a real asset (page.tsx:7,66,75-83).
- **Verified evidence:** apps/web/src/app/(app)/assets/bulk-import/page.tsx:7 initial csv state is a header plus 'Sample Laptop,LAP/001,it,45000,HQ'; the submit button (66) is disabled only when parsedCount===0, so the sample is importable; ConfirmDialog (75-84) is the only gate (needs two clicks, not one, and has no reason).
- **Files to change:** `apps/web/src/app/(app)/assets/bulk-import/page.tsx`
- **Fix steps:**
  1. Initialise csv to '' and show the format sample as placeholder / a 'Download template' link.
  2. Keep the button disabled until at least one valid parsed row exists (see -02/-03).
  3. Optionally set requireReason on the ConfirmDialog.
- **Acceptance:**
  - Page loads with empty textarea and disabled button.
  - Pasting rows enables Import.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Prevents junk asset records.
- **Depends on:** GAP-ASSETS-BULK-IMPORT-02

### GAP-ASSETS-BULK-IMPORT-02  ·  HIGH  ·  confirmed  ·  theme CSV (was MONEY)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Naive CSV parsing: line.split(",") with no quote handling and Number(cost) (page.tsx:23-28). A name like “Chair, executive” shifts every column; cost “45,000” or “₹45000” gives NaN → JSON null; the first line is dropped unconditionally as a header, so pasting rows without a header loses row 1 (page.tsx:14,21).
- **Verified evidence:** apps/web/src/app/(app)/assets/bulk-import/page.tsx:21-31: lines split by line.split(',') with no quote handling; cost via Math.round(Number(cost||'0')*100) so '45,000' or '₹45000' gives NaN, serialised as null by JSON.stringify; .slice(1) at 14 and 21 always drops line 1 even without a header. This is client-side (layer 'api' label is wrong).
- **Files to change:** `apps/web/src/app/(app)/assets/bulk-import/page.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. Write a parseAssetCsv(text) helper (new lib/csv or use an existing CSV parser) supporting quoted fields; detect header by matching 'name' in row 1 instead of dropping blindly.
  2. Convert cost with rupeesToMinorString (lib/money.ts); strip ₹ and commas explicitly; reject invalid.
  3. Return {rows, errors[]}; show errors per line and block import if any.
  4. Validate rows with zod before send (see -03).
- **Acceptance:**
  - Unit tests: 'Chair, executive' quoted stays one field; '45,000' quoted parses to 4500000; no-header input keeps row 1.
  - Invalid cost shows line-numbered error.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: acquisition cost of assets; wrong parse pollutes register/depreciation.

### GAP-ASSETS-BULK-IMPORT-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** No pre-import validation or per-row result: duplicate codes, blank names, unknown assetType (free text, default "fixed") are all sent as-is; response is treated as all-or-nothing and the success line says “N assets queued” even though nothing confirms creation (page.tsx:32-38).
- **Verified evidence:** apps/web/src/app/(app)/assets/bulk-import/page.tsx:22-38 no validation of blank names, duplicate codes or assetType (defaults to 'fixed', line 27) and response is all-or-nothing. But the success text (38) says 'Bulk import accepted — N assets queued', which does not claim creation; the overstated part is the finding's implication. Backend per-row results / duplicate handling cannot be verified (asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/bulk-import/page.tsx`
- **Fix steps:**
  1. Add zod row schema (name required, code required and unique within the file, assetType enum, cost paise).
  2. Show a preview table with per-row status before the ConfirmDialog; block on errors.
  3. Restrict assetType to the allowed list (get from asset-service types) in preview.
  4. If backend returns per-row results, render them; otherwise word the success as 'submitted for processing'.
- **Acceptance:**
  - Duplicate codes flagged before submit.
  - Unknown assetType flagged.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Register integrity.
- **Depends on:** GAP-ASSETS-BULK-IMPORT-02

### GAP-ASSETS-BULK-IMPORT-05  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Failure text is res.text() shown raw in the dialog and isError is never set to true (page.tsx:9,37,70), so the coloured status path is dead code; success wording has no singular (“1 assets queued”).
- **Verified evidence:** apps/web/src/app/(app)/assets/bulk-import/page.tsx:37 throws new Error(await res.text()); useConfirmAction (ds/ActionButton.tsx:24-50) catches it and shows it as dialog errorMessage (raw body). setIsError(false) at 20 is the only call, so isError never becomes true and the coloured error branch (70) is unreachable. Line 38 always says 'assets' (no singular).
- **Files to change:** `apps/web/src/app/(app)/assets/bulk-import/page.tsx`
- **Fix steps:**
  1. Parse JSON error body (e.g. useFormError like other forms) and show a friendly message instead of raw text.
  2. Remove isError/dead branch or set it in a catch; keep message outside dialog for failures.
  3. Pluralise: `${n} ${n===1?'asset':'assets'}`.
- **Acceptance:**
  - 500 response shows readable message.
  - 1 row shows '1 asset queued'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-BULK-IMPORT-06  ·  LOW  ·  confirmed  ·  theme LABEL (was OTHER)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Fixed Assets “Bulk tag” button links here although this screen imports new assets and cannot tag existing ones (fixed-assets/page.tsx:30).
- **Verified evidence:** apps/web/src/app/(app)/assets/fixed-assets/page.tsx:32 <a href="/assets/bulk-import" className="btn ghost">Bulk tag</a> (not line 30). Target page only creates new assets from CSV; no tagging of existing ones. Also uses <a> not Link.
- **Files to change:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`
- **Fix steps:**
  1. Rename the button to 'Bulk import' (or remove) and use next/link.
  2. If bulk QR tagging is intended, build it as a separate route; otherwise drop the label.
- **Acceptance:**
  - Button label matches destination.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/condemnation  —  `assets/condemnation.html`

- **Source:** `apps/web/src/app/(app)/assets/condemnation/page.tsx`
- **Design reference:** `redesign/assets/condemnation.html`

### GAP-ASSETS-CONDEMNATION-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** The whole workflow runs on hand-typed UUIDs: Asset ID, Survey ID, Recommendation ID, Auction ID (CondemnationWorkflow.tsx:281,341,571,681,901,936). Ids carry forward only in component state, so a refresh loses them and the clerk must copy a 36-char tracking id from a status line.
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx: UUID text inputs for Asset ID (281, 574, 901), Survey ID (341, 571), Recommendation ID (681, 904), Auction ID (936), all validated by UUID_PATTERN. Ids carry forward only via orchestrator useState (1016-1019), so a reload clears them. apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:237 puts the tracking id in a pill message. Fix depends on read endpoints (see -02).
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`, `apps/web/src/app/_components/ds/EntityPicker.tsx (new)`
- **Fix steps:**
  1. Replace Asset ID inputs with EntityPicker over the asset register list (assets/fixed-assets loader).
  2. Keep survey/recommendation/auction ids in the URL query (?surveyId=&recommendationId=&auctionId=) or sessionStorage so refresh keeps them.
  3. Once read endpoints exist, replace the id fields with pickers of open surveys/recommendations/auctions.
  4. Add copy button on tracking-id message.
- **Acceptance:**
  - After creating a survey and refreshing, ids remain.
  - Asset picked by name/code, not UUID.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Wrong id targets the wrong asset for an irreversible disposal.
- **Depends on:** GAP-ASSETS-CONDEMNATION-02, EntityPicker (new shared component)

### GAP-ASSETS-CONDEMNATION-02  ·  HIGH  ·  partly  ·  theme READMODEL (was DATEFMT)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** No read endpoint: the module exposes commands only (CondemnationWorkflow.tsx:3-19), so nobody can see a survey, its recommendation or the auction outcome; “Current version” must be typed by the user (default "1") and a stale value is rejected asynchronously (lines 177,447,780).
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:3-19 and condemnation/page.tsx:5-17 state asset-service exposes only command endpoints (202 accepted) with no GET; the UI confirms typed 'Current version' fields default '1' (apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:177,447,780). I cannot verify the absence of GET endpoints (asset-service not in the snapshot) and the stale-version rejection being async is stated only in comments. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`, `apps/web/src/app/(app)/assets/condemnation/page.tsx`
- **Fix steps:**
  1. Backend: add GET by id and list for surveys/recommendations/auctions (with version).
  2. Web: add a list/detail section per step and take version from the fetched record (remove the manual version inputs).
  3. Meanwhile hide 'Current version' behind advanced or default from the 202 response if it returns one.
- **Acceptance:**
  - Selecting a survey shows its status and version.
  - Version field not user-typed.
- **Needs:** backend  ·  **Effort:** L >2d  ·  **Risk:** Cannot verify backend; version conflicts on irreversible steps.
- **Depends on:** GAP-ASSETS-CONDEMNATION-01

### GAP-ASSETS-CONDEMNATION-03  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Approve dialog prints reserve/floor values from the Create-recommendation form’s local fields, not from the recommendation being approved (CondemnationWorkflow.tsx:740-746): after a reload or when approving someone else’s recommendation it shows “—” or another recommendation’s figures, on an irreversible action.
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:731-750 the approve ConfirmDialog prints reserve/floor from RecommendationPanel's local reserveValue/floorValue state (437-438, populated only in the Create form) and asset id from assetId state; approving a recommendation by pasted id after reload shows no values, or another recommendation's values if the form was reused. Also formatMoney(Number(...)) (743) passes numbers. Dialog is `danger` but has no reason.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`
- **Fix steps:**
  1. Remove reserve/floor from the approve dialog until the recommendation can be read (needs read endpoint, see -02); then render fetched values.
  2. Show explicit text 'Details are not loaded; verify the recommendation id' if none available.
  3. Set requireReason on the approve ConfirmDialog.
  4. Use formatMoney(string) directly rather than Number().
- **Acceptance:**
  - After reload, approve dialog does not display stale/empty figures.
  - Approve requires reason.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Irreversible approval shown with wrong numbers; maker-checker still enforced server-side per comments.
- **Depends on:** GAP-ASSETS-CONDEMNATION-02

### GAP-ASSETS-CONDEMNATION-04  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was DATEFMT)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** No business-rule checks between steps: winning bid and sale proceeds are separate free inputs with no reserve/floor comparison or equality check (CondemnationWorkflow.tsx:942-952), and auction reserve is retyped rather than read from the recommendation (907).
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:942-953 winning bid (highestBid) and sale proceeds are independent inputs; validateComplete (852-868) only checks positivity. Auction reserve (907) is retyped rather than from the recommendation (recommendationId 904 used only as id). No reserve/floor comparison. Server-side rules cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`
- **Fix steps:**
  1. Warn (or block with reason) when winning bid < reserve; require sale proceeds <= winning bid or explain difference.
  2. Prefill/lock auction reserve from the recommendation once readable (-02).
  3. Compare with BigInt on minor strings from rupeesToMinorString.
- **Acceptance:**
  - Bid below reserve shows warning requiring confirmation.
  - Proceeds greater than bid rejected.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Sale proceeds post to the register (money).
- **Depends on:** GAP-ASSETS-CONDEMNATION-02

### GAP-ASSETS-CONDEMNATION-05  ·  MEDIUM  ·  confirmed  ·  theme LAYOUT (was PII)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Committee member rows use a fixed three-column grid "1fr 1fr 1fr" (CondemnationWorkflow.tsx:619) that squeezes to unreadable widths on phones; employeeRef is a raw UUID text field instead of an officer picker.
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:619 members rendered with gridTemplateColumns '1fr 1fr 1fr' (fixed, not responsive; elsewhere grid() uses auto-fit minmax(220px,1fr) at 147). employeeRef is a free text 'UUID, optional' (642). This is a layout/picker issue, not PII masking.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`
- **Fix steps:**
  1. Use repeat(auto-fit,minmax(200px,1fr)) for the member row.
  2. Replace employeeRef with an officer EntityPicker (HRMS employees) once the shared component exists.
- **Acceptance:**
  - At 360px width fields stack.
  - Officer chosen by name.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None.
- **Depends on:** EntityPicker (new shared component)

### GAP-ASSETS-CONDEMNATION-06  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** DPDP: Winner reference is documented as “PAN / contact ref” free text (CondemnationWorkflow.tsx:949) — a PAN is collected with no masking, purpose note or role gate.
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:948-950 'Winner reference' placeholder 'PAN / contact ref (optional)' sent as winnerRef (880). It is a write-only field: the value is never rendered back, but the UI invites PAN entry with no purpose note or consent text. Backend storage/encryption cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`
- **Fix steps:**
  1. Change label/placeholder to 'Bidder registration / contact reference' and add a helper line: do not enter PAN unless required; purpose is auction record.
  2. Send only if it matches a light pattern; confirm with DPO whether PAN is needed.
  3. If PAN is required, backend must store encrypted and any future display must use a shared <Masked> (does not yet exist in ds).
- **Acceptance:**
  - Helper text visible; no PAN prompt.
  - No echo of winnerRef in UI.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** DPDP exposure if PAN entered into free text.

### GAP-ASSETS-CONDEMNATION-07  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Dates are text inputs validated by regex (surveyDate, auctionDate) rather than date pickers (CondemnationWorkflow.tsx:285,911).
- **Verified evidence:** apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx:285 and 911 dates are TextInput with placeholder YYYY-MM-DD validated by DATE_PATTERN (27); regex also accepts 2026-13-45. Default survey date uses new Date().toISOString().slice(0,10) (28), which is UTC and can give yesterday in IST before 05:30.
- **Files to change:** `apps/web/src/app/(app)/assets/condemnation/CondemnationWorkflow.tsx`
- **Fix steps:**
  1. Use <input type="date"> (or ds DatePicker if any) for surveyDate and auctionDate.
  2. Compute today in Asia/Kolkata instead of UTC.
  3. Validate with zod z.string().date() semantics; reject future survey dates if rule applies.
- **Acceptance:**
  - Invalid calendar date rejected.
  - Default date correct at 02:00 IST.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/dashboard  —  `assets/dashboard.html`

- **Source:** `apps/web/src/app/(app)/assets/dashboard/page.tsx`
- **Design reference:** `redesign/assets/dashboard.html`

### GAP-ASSETS-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Failed fetch reads as an empty register: on error the loader returns all-zero AssetDashboard, StatGrid is not null-gated, and only the small badge and the recent card signal failure (page.tsx:10-14,37-44; loaders.ts ASSET_DASHBOARD_EMPTY). Net Book Value shows ₹0.00.
- **Verified evidence:** dashboard/page.tsx:9,22,34-39: getAssetDashboard() returns ASSET_DASHBOARD_EMPTY (all 0, loaders.ts:3754-3763) on error; page only renders DataSourceBadge (l.22) and RefreshErrorState inside the Recent-additions card (l.48-49). All six StatCards get real numbers: totalAssets.toLocaleString, formatMoney(0)=₹0.00, taggedPct=0%. StatCard already renders '—' for null/undefined/NaN (StatCard.tsx:14-19) but the page never passes null.
- **Files to change:** `apps/web/src/app/(app)/assets/dashboard/page.tsx`
- **Fix steps:**
  1. In AssetDashboardPage compute `const failed = source === 'error'`.
  2. Pass `failed ? null : value` to every StatCard (Total, Fixed, Net Book Value via formatMoney only when !failed, Tagged %, Under Maintenance, Due Disposal) so StatCard.displayValue shows '—'.
  3. Compute taggedPct as null when failed.
  4. Optionally replace the whole StatGrid + recent card with one <RefreshErrorState> when failed, keeping header actions; keep DataSourceBadge.
  5. Do not change the loader fallback (other pages rely on it).
- **Acceptance:**
  - Component/RTL test: mock getAssetDashboard -> {source:'error'}; assert no '₹0.00' and no '0%' text, six '—' values, RefreshErrorState present.
  - Manual: stop asset-service, load /assets/dashboard; stat tiles show '—', not zeros.
  - Happy path: real zero counts still render '0'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only. Ensure genuine zero is still shown when source==='api'.
- **Depends on:** StatCard (existing null handling)

### GAP-ASSETS-DASHBOARD-02  ·  MEDIUM  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** infraAssets is mapped by the loader but never rendered; Due Disposal and Under Maintenance are not links to their queues (page.tsx:41-43).
- **Verified evidence:** dashboard/page.tsx:34-39: StatCard has no href/link prop (StatCard.tsx:4-11) so Due Disposal and Under Maintenance tiles cannot be links. infraAssets is mapped (loaders.ts:3771) but no tile uses it. Not a dead route: Quick links (l.71-76) point to existing routes /assets/maintenance, /assets/verification; /assets/infra and /assets/condemnation exist (ls). Missing is drill-down, not a broken link.
- **Files to change:** `apps/web/src/app/(app)/assets/dashboard/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Add optional `href?: string` to StatCardProps; wrap the tile in next/link when set (keep keyboard focus + aria-label).
  2. In dashboard: Under Maintenance -> href='/assets/maintenance'; Due Disposal -> '/assets/condemnation'; Fixed Assets -> '/assets/fixed-assets'.
  3. Add an 'Infrastructure' StatCard using data.infraAssets linking to '/assets/infra' (or drop infraAssets from the mapper).
  4. Add Quick link for /assets/condemnation.
- **Acceptance:**
  - RTL: tiles render <a> with the expected hrefs.
  - Keyboard: Tab reaches each tile; Enter navigates.
  - Infra count tile shows data.infraAssets.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** StatCard is shared by many pages; make href optional so no visual change elsewhere.
- **Depends on:** StatCard

### GAP-ASSETS-DASHBOARD-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** netBlock and acquisitionCost are typed number, not bigint/string: money above 2^53 paise (₹9.0e13) would lose precision, against the paise-bigint rule (loaders.ts mapAssetDashboard).
- **Verified evidence:** loaders.ts:3765-3789 mapAssetDashboard: netBlock and acquisitionCost accepted only when `typeof === 'number'`, otherwise coerced to 0. If the API sends bigint-safe strings (repo convention for paise) the value silently becomes ₹0.00; numbers above 2^53 lose precision (formatMoney(number) uses BigInt(Math.round(n)), formatters.ts:100). Type AssetDashboard lives in @civitasone/types which is absent from the snapshot, and no asset-service is present, so the wire format is cannot-verify. Same pattern in apiMappers.parseMinor (l.63-72) via Number().
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/_data/apiMappers.ts`, `@civitasone/types (AssetDashboard, AssetSummary) - not in snapshot`, `apps/web/src/app/(app)/assets/dashboard/page.tsx`
- **Fix steps:**
  1. Confirm asset-service dashboard response type for netBlock/acquisitionCost (number vs string).
  2. Change AssetDashboard.netBlock and recentGrnAssets[].acquisitionCost to `string` (paise) in @civitasone/types.
  3. In mapAssetDashboard accept number|string via a new parseMinorString() that returns a digit string (reject non-integers) instead of `? : 0`.
  4. Pass strings straight to formatMoney (already accepts bigint|number|string).
  5. Apply same to parseMinor callers for asset summaries.
- **Acceptance:**
  - Unit test: payload netBlock '9000000000000001' renders exact ₹90,000,000,000,000.01.
  - Unit test: netBlock as number 12345 still renders ₹123.45.
  - Malformed value yields null -> '—', not 0.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Touches money display across asset pages; type change ripples through consumers of AssetSummary/AssetDetail.

### GAP-ASSETS-DASHBOARD-04  ·  LOW  ·  confirmed  ·  theme THEME (was OTHER)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Emoji icons and hex iconBg per StatCard (page.tsx:37-44) bypass the token palette and will not follow dark mode.
- **Verified evidence:** dashboard/page.tsx:34-39 pass emoji `icon` and hard-coded hex iconBg (#fdf0e3, #eff6ff, #ecfdf3, #f5f3ff, #fffaeb, #fef2f2). StatCard applies iconBg inline (StatCard.tsx:32) so light pastels persist in dark mode. Note StatCard renders via <StatIcon icon=...> which may map emoji to lucide icons (StatIcon.tsx not inspected), so emoji may not render literally; the hex backgrounds do. Same hex set is copy-pasted in fixed-assets, list, infra pages.
- **Files to change:** `apps/web/src/app/(app)/assets/dashboard/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/infra/page.tsx`
- **Fix steps:**
  1. Add a `tone` prop ('neutral'|'good'|'warn'|'bad'|'info') to StatCard mapping to CSS token backgrounds (e.g. var(--good-bg)) defined for light and dark.
  2. Replace iconBg hex in the four asset pages with tone.
  3. Keep iconBg as deprecated fallback; grep for other users before removing.
- **Acceptance:**
  - Visual check in dark theme: tile icon backgrounds follow theme.
  - grep for `iconBg="#` in assets/ returns nothing.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Cosmetic; StatCard is widely shared.
- **Depends on:** StatCard


---
## /assets/depreciation  —  `assets/depreciation.html`

- **Source:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Design reference:** `redesign/assets/depreciation.html`

### GAP-ASSETS-DEPRECIATION-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Success line claims “GL journals posted via finance.gl.post” on a 202-style accepted response (page.tsx:20); posting happens asynchronously in the consumer (CLAUDE.md §6 CQRS), so the clerk is told the ledger is updated before it is.
- **Verified evidence:** depreciation/page.tsx:22: on res.ok sets `Depreciation run accepted for ${period} — GL journals posted via finance.gl.post.` The wording is past tense ('posted') though the message begins 'accepted'; per CLAUDE.md §6 writes are queued (202) and applied by a consumer. Response body/status is not inspected (only res.ok), so the UI cannot know journals exist. Backend contract cannot-verify (asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Fix steps:**
  1. Change copy to: `Depreciation run for ${period} queued. GL journals will post shortly - check Finance > Journals.`
  2. Read the JSON response (run id / status) if returned and show it; link to the journal or run status if such a route exists (do not invent one).
  3. Keep role=status region.
- **Acceptance:**
  - RTL: after 202 mock, text contains 'queued' and does not contain 'posted'.
  - Snapshot updated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Copy only; avoid overpromising a link that does not exist.

### GAP-ASSETS-DEPRECIATION-02  ·  HIGH  ·  partly  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** No guard against re-running a period: free-text period accepts any YYYY-MM including future and already-posted months, with no last-run indicator, no preview of assets/amount, and no idempotency feedback (page.tsx:6,60-61). The dialog itself says the posting cannot be undone.
- **Verified evidence:** A ConfirmDialog with requireReason and 'cannot be undone' copy already exists (depreciation/page.tsx:12-24,67-78) - so the suggested 'add ConfirmDialog' is already done. What is true: period is free text (l.58) with no future-month check, no last-run/last-posted indicator, no preview of assets/amount, and no idempotency feedback (a second identical POST looks identical to the first). Maker!=checker is not enforceable in UI here (server concern).
- **Files to change:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Fix steps:**
  1. Replace the text input with <input type='month'> or a select of recent periods; block periods later than the current IST month.
  2. If asset-service exposes a last-run/history endpoint (cannot-verify), fetch it server-side and show 'Last run: <period>' and warn/disable when the period is already posted; otherwise raise a backend ask.
  3. Send an Idempotency-Key header (period+book) and surface a 'already posted' response as a distinct message.
  4. Show period and book in the dialog (already done) plus count of assets if a preview endpoint exists.
- **Acceptance:**
  - Selecting a future month disables submit with an inline error.
  - Second submit for same period+book shows 'already run' instead of success (requires backend).
  - Dialog still requires reason >= min length.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Posts to GL; a duplicate run doubles depreciation if server is not idempotent - confirm server behaviour first.

### GAP-ASSETS-DEPRECIATION-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Period is a text input with a pattern attribute only (page.tsx:61); month 13 (“2026-13”) matches \d{4}-\d{2}. Default period uses toISOString (UTC) so the first hours of a month in IST show the previous month (page.tsx:6).
- **Verified evidence:** depreciation/page.tsx:7 `new Date().toISOString().slice(0,7)` is UTC, so between 00:00 and 05:30 IST on the 1st the default is the previous month. l.58 input has only pattern="\d{4}-\d{2}" so '2026-13' and '0000-99' pass (native pattern validation does run on submit since the form has no noValidate). No JS validation before trigger() (l.42-45).
- **Files to change:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Fix steps:**
  1. Derive default via Intl/`toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).slice(0,7)` or a shared IST helper in lib/formatters.ts.
  2. Use type='month' (value YYYY-MM) or validate with /^\d{4}-(0[1-9]|1[0-2])$/ and set an inline error via aria-invalid.
  3. Guard run.trigger() in onSubmit behind the validation.
- **Acceptance:**
  - Unit test: with fake time 2026-03-31T20:00Z (IST 1 Apr) default is 2026-04.
  - Entering 2026-13 shows an error and does not open the dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-DEPRECIATION-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was CONFIRM)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** GL account codes 5100/5101 are hard-coded in option labels and dialog copy (page.tsx:29-32,53-55) and will drift from the chart of accounts.
- **Verified evidence:** depreciation/page.tsx:28-29 (bookLabel) and 52-53 (options) hard-code 'SLM → 5100' and 'WDV → 5101'; the ConfirmDialog description interpolates them (l.70). The suggested fix (ConfirmDialog with reason) is irrelevant - the dialog already exists. No CoA lookup in the page; the GL code mapping lives server-side (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Fix steps:**
  1. Drop account numbers from option labels and bookLabel: 'Company book (SLM)' / 'Statutory book (WDV)'.
  2. If the account codes must be shown, read them from a config/CoA endpoint in a server wrapper and pass as props (no such endpoint verified).
  3. Update dialog description accordingly.
- **Acceptance:**
  - grep '5100|5101' in depreciation/page.tsx returns nothing.
  - Dialog still names the selected book.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only.

### GAP-ASSETS-DEPRECIATION-05  ·  LOW  ·  partly  ·  theme CONFIRM

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Failure surfaces only as raw response text inside the dialog; isError is never set true (page.tsx:9,23).
- **Verified evidence:** setIsError(true) is never called anywhere in depreciation/page.tsx (l.10 declared, l.15 reset, l.62 read) so the status <p> can only ever be green. But failures are not lost: useConfirmAction catches the throw and ConfirmDialog shows it via errorMessage={run.error} (l.75; ActionButton.tsx:48-49). The real defect: the message is the raw res.text() body (l.21), possibly JSON/HTML, not human copy, and the dead isError state.
- **Files to change:** `apps/web/src/app/(app)/assets/depreciation/page.tsx`
- **Fix steps:**
  1. Remove isError state and the ternary colour (or wire it) since errors are shown in the dialog.
  2. Replace `throw new Error(await res.text())` with the shared toHumanError()/error-body parser (lib/messages.ts, used in dashboard page) so users see a friendly message plus correlationId.
  3. Keep dialog open on failure (already the case).
- **Acceptance:**
  - Mock 500 with JSON body: dialog shows human message, not raw JSON.
  - No unused isError state remains (lint clean).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /assets/fixed-assets  —  `assets/fixed-assets.html`

- **Source:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`
- **Design reference:** `redesign/assets/fixed-assets.html`

### GAP-ASSETS-FIXED-ASSETS-01  ·  HIGH  ·  partly  ·  theme DUPLICATE (was VALIDATION)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Duplicate of /assets/list: identical title, subtitle, banner, stats and columns; only the ?type=fixed query and client filter type==="fixed" differ (fixed-assets/page.tsx:9-10 vs list/page.tsx:19-21).
- **Verified evidence:** Copy is identical: fixed-assets/page.tsx:28-29 vs list/page.tsx:20-21 title 'Fixed Asset Register' + same subtitle, banner and four StatCards. Data/rendering differ: list uses getAssets() (all types) with the AssetsTable client component and useSeededResource, while fixed-assets uses getFixedAssets() (`?type=fixed`) with an inline DataTable. So /assets/list mislabels a register of ALL asset types as 'Fixed Asset Register' and the two pages have divergent behaviour (offline cache/badge only on list).
- **Files to change:** `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/list/AssetsTable.tsx`
- **Fix steps:**
  1. Rename /assets/list title to 'Asset Register' with an accurate subtitle and neutral banner; keep 'Fixed Asset Register' on fixed-assets.
  2. Make fixed-assets reuse AssetsTable with a `type='fixed'` prop (single implementation, shared error/cache handling) or redirect to /assets/list?type=fixed.
  3. Remove copy-pasted stats logic into one helper (summariseAssets).
- **Acceptance:**
  - Page titles differ and match content.
  - Both pages show same badge/error behaviour.
  - No duplicated StatGrid code.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Nav/breadcrumb links to titles; check sidebar labels.
- **Depends on:** GAP-ASSETS-FIXED-ASSETS-05

### GAP-ASSETS-FIXED-ASSETS-02  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Filters ?type=fixed server-side and again client-side (page.tsx:9,10): assets whose assetType is it/movable/vehicle are dropped from a “Fixed Asset Register” although they are capitalised assets (apiMappers.ts:828-832).
- **Verified evidence:** fixed-assets/page.tsx:8-9: getFixedAssets requests `/api/v1/asset/assets?type=fixed` (loaders.ts:3839-3845) and then re-filters `a.type === 'fixed'` (l.9). The re-filter is redundant if the server honours the param, and drops it/movable/vehicle types (mapper types in apiMappers.ts:~828-833) either way. There is no visible cap/pagination on the fetch, so the 'capped fetch' concern is cannot-verify (server default page size unknown). Whether IT/vehicle assets belong in a 'Fixed Asset Register' is a business/accounting decision.
- **Files to change:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Remove the client-side `.filter(type==='fixed')` and trust the server filter.
  2. Get a decision on which asset types are capitalised fixed assets; if several, send `type=fixed,movable,it,vehicle` (only if the API supports it) or drop the type param.
  3. Confirm asset-service default limit; if paged, add limit/offset/total and show totals from the server.
- **Acceptance:**
  - With mock API returning a mixed list for ?type=fixed, all returned rows render.
  - Totals equal server totals when list is paged.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Changes gross/net block totals shown to finance users.

### GAP-ASSETS-FIXED-ASSETS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** “Tagged (QR)” = share of active/in_use assets, not barcode coverage (page.tsx:14).
- **Verified evidence:** fixed-assets/page.tsx:10,13: totalActive = count of status active|in_use; tagged = totalActive/assets.length. It measures active status, not barcode coverage; identical formula in list/page.tsx:6. The mapper does not expose barcode on summaries (apiMappers.ts:840-851). The dashboard by contrast uses the API's taggedAssets (dashboard/page.tsx:10), so the three pages disagree.
- **Files to change:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Add `barcode?: string` to AssetSummary and map row.barcode in mapAssetSummaries.
  2. Compute tagged = assets with barcode / total (guard empty -> '—').
  3. Or if list payload lacks barcode, relabel the tile 'Active %' and drop 'Tagged (QR)'.
  4. Share one summariseAssets() helper between the pages.
- **Acceptance:**
  - Unit test: 4 assets, 1 with barcode, 4 active -> 25% not 100%.
  - Empty list shows '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; depends on list payload containing barcode (cannot-verify).

### GAP-ASSETS-FIXED-ASSETS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was PII)

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Bulk tag button links to /assets/bulk-import, which imports new assets from CSV; it does not tag existing ones (bulk-import/page.tsx:22-37).
- **Verified evidence:** fixed-assets/page.tsx:34 (and list/page.tsx:26) 'Bulk tag' -> /assets/bulk-import. That page (bulk-import/page.tsx:9-37) POSTs /api/proxy/v1/asset/bulk/import with name,code,assetType,cost,orgUnit: it creates new assets, not tags. Per-asset tagging exists only via PATCH .../barcode on the detail page. Side finding: bulk-import l.22 uses Math.round(Number(cost)*100), a float money conversion against the paise rule.
- **Files to change:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/bulk-import/page.tsx`
- **Fix steps:**
  1. Rename the button to 'Bulk import' (both pages).
  2. If bulk tagging is required, raise a backend ask (bulk barcode assignment) and build it separately.
  3. In bulk-import replace Math.round(Number(cost)*100) with the string-based rupees->paise helper in lib/money.ts (rupeesToMinorString).
- **Acceptance:**
  - Button label reads 'Bulk import'.
  - bulk-import: cost '0.29' yields 29 paise exactly; invalid cost blocks submit.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; bulk-import money fix affects real imports - test with decimals.

### GAP-ASSETS-FIXED-ASSETS-05  ·  LOW  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Stats are not null-gated on error; zeros display beside the badge (page.tsx:33,51-56).
- **Verified evidence:** fixed-assets/page.tsx:26 shows DataSourceBadge on error and l.62-63 shows RefreshErrorState in the table card, but the StatGrid (l.51-56) computes from the empty array: Fixed Assets '0', Tagged '0%', Gross Block/Net Book Value '₹0.00'. StatCard would show '—' if passed null. The same holds in list/page.tsx (badge is inside AssetsTable).
- **Files to change:** `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/list/page.tsx`
- **Fix steps:**
  1. `const failed = source==='error'`; pass null to each StatCard value when failed (formatMoney only when !failed).
  2. In list/page.tsx the error state is inside AssetsTable; pass source/provenance up or gate the stats similarly.
  3. Optionally render the shared <RefreshErrorState> once above the grid.
- **Acceptance:**
  - RTL: source 'error' -> four '—' values, no '₹0.00'.
  - Success path unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-DASHBOARD-01


---
## /assets/fleet  —  `assets/fleet.html`

- **Source:** `apps/web/src/app/(app)/assets/fleet/page.tsx`
- **Design reference:** `redesign/assets/fleet.html`

### GAP-ASSETS-FLEET-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Hub carries no state: no vehicle count, overdue maintenance or offline-device alert although the three child screens fetch lists (fleet/page.tsx:1-6).
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/page.tsx:1-6 comment states deliberately no data is fetched; hub renders three static cards (apps/web/src/app/(app)/assets/fleet/page.tsx:19-45), no counts or alerts. Child lists are backend stubs (see FLEET-VEHICLES-02), so counts would currently be 0.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/page.tsx`
- **Fix steps:**
  1. Wait for list endpoints; then fetch vehicle count, overdue maintenance, offline devices via fetchJson in FleetOverviewPage.
  2. Show as small badges on each Card; on error show '—' rather than 0.
  3. Prefer a single summary endpoint if backend adds one.
- **Acceptance:**
  - Hub shows counts matching child lists.
  - Fetch failure shows '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Showing 0 from a stub would mislead.
- **Depends on:** GAP-ASSETS-FLEET-VEHICLES-02, GAP-ASSETS-FLEET-MAINTENANCE-01

### GAP-ASSETS-FLEET-02  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Card titled “IoT Devices” opens a page titled “Fleet IoT Devices”, and the Vehicles card “Open Vehicles” — naming differs across hub, page and breadcrumb (page.tsx:30,36).
- **Verified evidence:** Hub card 'IoT Devices' with button 'Open Devices' (apps/web/src/app/(app)/assets/fleet/page.tsx:30-36) vs page title 'Fleet IoT Devices' (fleet/devices/page.tsx:83); 'Vehicles' card / 'Open Vehicles' vs page 'Fleet Vehicles'; 'Fleet Maintenance' matches. Breadcrumb text not checked. Not a wiring bug.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/page.tsx`, `apps/web/src/app/(app)/assets/fleet/devices/page.tsx`, `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Pick one label set (e.g. Vehicles / IoT Devices / Maintenance) and apply to hub card, button, PageHeader title and backLabel.
- **Acceptance:**
  - Card title equals destination page title.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-FLEET-03  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Hub has no error.tsx/loading.tsx of its own; asset-segment fallbacks apply.
- **Verified evidence:** True: fleet/ has only page.tsx plus devices, maintenance, vehicles subfolders; segment assets/loading.tsx and assets/error.tsx apply. But the hub fetches nothing (apps/web/src/app/(app)/assets/fleet/page.tsx:1-6) so it cannot itself suspend or throw; impact is negligible. It becomes relevant only if FLEET-01 adds fetches.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/loading.tsx (new, only with FLEET-01)`
- **Fix steps:**
  1. Skip now; when FLEET-01 adds data fetching, add fleet/loading.tsx (card-grid skeleton) and fleet/error.tsx using RouteError with backHref '/assets'.
- **Acceptance:**
  - After FLEET-01, throwing loader shows fleet-specific RouteError.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ASSETS-FLEET-01


---
## /assets/fleet/devices  —  `assets/fleet-devices.html`

- **Source:** `apps/web/src/app/(app)/assets/fleet/devices/page.tsx`
- **Design reference:** `redesign/assets/fleet-devices.html`

### GAP-ASSETS-FLEET-DEVICES-01  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Log Telemetry needs a Device ID UUID that the table never shows (columns are IMEI, Vehicle ID, Protocol, SIM, Status; id is dropped in mapDevices display — page.tsx:71-79; TelemetryForm.tsx:132). A clerk cannot obtain it without the one-time registration message.
- **Verified evidence:** fleet/devices/page.tsx:72-78 columns omit id (DeviceRow.id exists, l.25); TelemetryForm.tsx:67,130-142 requires a UUID typed by hand (UUID_RE l.28). The only place the id is shown is the registration success message (RegisterDeviceForm.tsx:79-83) which disappears on navigation. Combined with -02 the table is empty anyway.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/devices/TelemetryForm.tsx`, `apps/web/src/app/(app)/assets/fleet/devices/page.tsx`
- **Fix steps:**
  1. Pass `devices` (id, IMEI, vehicle label) from page.tsx into TelemetryForm as a prop.
  2. Replace the Device ID text input with a <select>/EntityPicker listing IMEI - vehicle; submit the UUID.
  3. Alternatively add a per-row 'Log reading' action that pre-fills the id.
  4. Keep the UUID validation as a defensive check.
- **Acceptance:**
  - Form shows a device dropdown; no UUID typing.
  - Selecting a device posts to /devices/<uuid>/telemetry.
  - Empty device list disables the form with an explanation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; blocked in practice by -02 (empty list).
- **Depends on:** GAP-ASSETS-FLEET-DEVICES-02, EntityPicker (new)

### GAP-ASSETS-FLEET-DEVICES-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Vehicle ID column prints the raw vehicle UUID (page.tsx:73-74) rather than the registration number, so a device row cannot be tied to a vehicle by eye.
- **Verified evidence:** fleet/devices/page.tsx:52 maps vehicleId to String(row.vehicleId) and l.74 column 'Vehicle ID' prints it raw; the filter placeholder (l.98) advertises 'vehicle ID'. No vehicle name/registration lookup is done (a vehicles list exists under assets/fleet presumably - not verified).
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/devices/page.tsx`
- **Fix steps:**
  1. Fetch the fleet vehicles list server-side (same loader used by /assets/fleet, locate via grep in assets/fleet) and build a Map id -> registrationNo.
  2. Add `vehicleLabel` to DeviceRow and show registration number (fall back to '—' with tooltip).
  3. Rename column to 'Vehicle' and update filter placeholder.
- **Acceptance:**
  - Row shows 'DL-01-AB-1234' instead of UUID.
  - Unknown vehicle id shows '—', not the raw UUID.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; extra fetch, keep it parallel.
- **Depends on:** GAP-ASSETS-FLEET-DEVICES-02

### GAP-ASSETS-FLEET-DEVICES-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Error state is contradictory: DataSourceBadge “Couldn’t load — showing nothing” in the header while the table shows “No devices registered yet” and invites a first registration (page.tsx:88-107).
- **Verified evidence:** fleet/devices/page.tsx:87 shows DataSourceBadge error in the header, but the DataTable (l.93-103) is always rendered with rows=[] (fetchJson fallback, l.63) and emptyTitle 'No devices registered yet' / 'Register your first...' regardless of source. The page never reads `source` for the table. error.tsx exists only for thrown errors.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/devices/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState and toHumanError; when source==='error' render RefreshErrorState inside <Card title='Devices'> instead of the DataTable.
  2. Keep the badge or drop it (duplicate signal).
  3. Keep the empty state only for source==='api' && devices.length===0.
- **Acceptance:**
  - RTL: source error -> RefreshErrorState, no 'No devices registered yet'.
  - source api + [] -> empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-ASSETS-FLEET-DEVICES-05  ·  MEDIUM  ·  partly  ·  theme CONFIRM (was PII)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Telemetry logging has no confirmation and timestamps the reading with the browser clock (TelemetryForm.tsx:98-108); manual keying of a device’s GPS/speed reading is an operator test tool, not a telematics feed.
- **Verified evidence:** Facts hold: TelemetryForm.tsx:107 `timestamp: new Date().toISOString()` uses the browser clock and l.91-121 submits without any ConfirmDialog. But the file header (l.3-13) documents it as an intentional manual-entry tool for e.g. radio calls; not PII (theme PII is wrong) and the payload is a GPS reading, which is location data of a government vehicle, low sensitivity. Server marks it via event; the reading is not distinguishable as manual (cannot-verify).
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/devices/TelemetryForm.tsx`
- **Fix steps:**
  1. Add an optional 'Reading time' datetime-local field defaulting to now (IST) so a delayed radio report can be back-dated; send ISO.
  2. Add a source flag `source: 'manual'` in the payload if the API allows (raise backend ask otherwise).
  3. Add a lightweight ConfirmDialog ('Log this reading for <IMEI>?') or role-gate the form to fleet supervisors.
- **Acceptance:**
  - Back-dated reading sends the chosen timestamp.
  - Cancel in confirm dialog sends nothing.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; manual data could pollute trip history - an audit flag would help.

### GAP-ASSETS-FLEET-DEVICES-06  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** IMEI validated only for length 15, not digits or Luhn checksum (RegisterDeviceForm.tsx:46-52); SIM ICCID is unvalidated.
- **Verified evidence:** RegisterDeviceForm.tsx:47-49 only checks deviceImei.trim().length !== 15 (message says 'characters'); no digit or Luhn check. simIccid (l.24,75) has no validation beyond trim. Server zod validation unknown (asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/devices/RegisterDeviceForm.tsx`, `apps/web/src/lib/form-validation.ts`
- **Fix steps:**
  1. Add isValidImei(): /^\d{15}$/ plus Luhn checksum helper in lib/form-validation.ts.
  2. Validate ICCID as /^\d{19,20}$/ (optional field; Luhn optional) with inline error and aria-describedby like the other fields.
  3. Update error copy: 'IMEI must be 15 digits and pass the checksum'.
  4. Mirror the rule in the API zod schema.
- **Acceptance:**
  - Unit tests: valid IMEI 490154203237518 passes; 490154203237519 fails; 'abcdefghijklmno' fails.
  - ICCID with letters shows error.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Some vendors use test/non-Luhn IMEIs; confirm before enforcing checksum.


---
## /assets/fleet/maintenance  —  `assets/fleet-maintenance.html`

- **Source:** `apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx`
- **Design reference:** `redesign/assets/fleet-maintenance.html`

### GAP-ASSETS-FLEET-MAINTENANCE-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Vehicle is chosen by typing a UUID and the list echoes the raw UUID back (ScheduleMaintenanceForm.tsx:121; page.tsx:66); no registration number, no picker fed from /fleet/vehicles.
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:58 requires a UUID via UUID_RE; input at apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:122-131 is a free text box labelled 'Vehicle ID'. Table column vehicleId (apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:66) prints the raw id; mapMaintenance keeps only vehicleId (page.tsx:52), no registration lookup. The ConfirmDialog (apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:205) and success message (apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:97) also print the UUID. No vehicle picker exists; getVehicles() lives in vehicles/page.tsx, not shared.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx`, `apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx`, `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`, `apps/web/src/app/(app)/assets/fleet/_data/vehicles.ts (new, shared fetch+map)`, `apps/web/src/app/(app)/assets/fleet/VehiclePicker.tsx (new)`
- **Fix steps:**
  1. Extract getVehicles()/mapVehicles from vehicles/page.tsx into fleet/_data/vehicles.ts and reuse in maintenance/page.tsx.
  2. Create VehiclePicker (select/SmartCombobox from app/_components) showing 'registrationNo - make model', value = id.
  3. Pass vehicles to ScheduleMaintenanceForm as prop; replace the UUID input and UUID_RE check with a required-selection check.
  4. In maintenance/page.tsx build a Map<id,registrationNo> and set the row's vehicle column to registration (fallback 'Unknown vehicle', not UUID).
  5. Show registration in ConfirmDialog description and success message.
- **Acceptance:**
  - Form shows a vehicle dropdown; no UUID typing needed.
  - Table 'Vehicle' column shows registration numbers.
  - With zero vehicles the picker is disabled with link to /assets/fleet/vehicles.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Picker is empty while vehicle list endpoint is a stub, blocking scheduling; keep manual entry fallback until the list is live.
- **Depends on:** GAP-ASSETS-FLEET-VEHICLES-02

### GAP-ASSETS-FLEET-MAINTENANCE-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Error state is contradictory: DataSourceBadge “Couldn’t load — showing nothing” in the header while the table shows “No maintenance scheduled yet” and invites a first registration (page.tsx:80-99).
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:88 shows DataSourceBadge when source==='error' but apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:91-99 always renders the DataTable with emptyTitle 'No maintenance scheduled yet' and 'Schedule your first maintenance job'. Contradictory on failure.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx`
- **Fix steps:**
  1. In FleetMaintenancePage branch on source==='error': render RefreshErrorState(toHumanError('load',{area:'maintenance schedule'})) (ds export, as infra/page.tsx does) inside the Card instead of DataTable.
  2. Drop the header-only DataSourceBadge or keep as secondary.
  3. Keep the schedule form visible.
- **Acceptance:**
  - Mock fetchJson to return source:'error': Card shows error panel with Retry, no 'No maintenance scheduled yet'.
  - source:'api' with [] still shows the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-FLEET-MAINTENANCE-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Scheduled Date prints the raw stored string (ISO timestamp) — mapMaintenance does not format it with formatIndianDate, unlike the other asset lists (page.tsx:56-58).
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:56 sets scheduledDate: String(row.scheduledDate ?? '') and the column apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:67 prints it; no formatIndianDate (lib/formatters.ts:2, used by insurance/claims/page.tsx:117). Form submits new Date(`${d}T00:00:00`).toISOString() (apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:90) so the stored value is a UTC ISO timestamp. Note: formatIndianDate outputs dd/mm/yyyy (not 'dd Mon yyyy') and has no timeZone option, so a server in UTC may show the previous day for IST-midnight values.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In mapMaintenance wrap: scheduledDate: formatIndianDate(row.scheduledDate).
  2. Add timeZone:'Asia/Kolkata' to formatIndianDate's toLocaleDateString (or a date-only variant) to avoid off-by-one.
  3. Optionally send the date as yyyy-MM-dd if backend accepts, avoiding local-tz shifts.
- **Acceptance:**
  - Row with scheduledDate '2026-10-05T00:00:00.000Z' renders 05/10/2026 (IST).
  - Empty date renders '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Changing formatIndianDate is shared; check other callers/snapshots.

### GAP-ASSETS-FLEET-MAINTENANCE-05  ·  MEDIUM  ·  confirmed  ·  theme WORKFLOW (was OTHER)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Schedule-only screen: no way to mark a job done, cancel it or see overdue jobs; statuses are printed but never changed here.
- **Verified evidence:** Page only renders ScheduleMaintenanceForm and a read-only DataTable (apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:80-99); no action column, no overdue computation. Status printed via cellType 'status' only. Whether asset-service exposes complete/cancel endpoints cannot be seen (service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx`, `apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx`, `apps/web/src/app/(app)/assets/fleet/maintenance/MaintenanceActions.tsx (new)`
- **Fix steps:**
  1. Confirm backend endpoints for complete/cancel (not visible in snapshot).
  2. Add a client MaintenanceActions row component (ConfirmDialog like ScheduleMaintenanceForm) calling browserJson.
  3. Add an 'Overdue' derived badge when scheduledDate < today and status is scheduled, plus a status filter.
  4. router.refresh() after action.
- **Acceptance:**
  - Scheduled job past its date shows Overdue.
  - Mark done changes status; cancel asks for confirmation.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Status transitions affect fleet records; needs audit event server-side.
- **Depends on:** GAP-ASSETS-FLEET-MAINTENANCE-01

### GAP-ASSETS-FLEET-MAINTENANCE-06  ·  LOW  ·  confirmed  ·  theme COPY (was DATEFMT)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Odometer Threshold is optional and its relationship to Scheduled Date (whichever first?) is not explained in copy (ScheduleMaintenanceForm.tsx:169-180).
- **Verified evidence:** Label 'Odometer Threshold (km)' at apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:168 has no required mark and no helper text; only validation is integer >= 0 (apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx:61-64). Semantics vs date are not explained anywhere; also not a DATEFMT issue.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx`
- **Fix steps:**
  1. Add helper <p> under the field linked by aria-describedby, e.g. 'Optional. Job is due at whichever comes first: the date or this odometer reading' (confirm actual semantics with backend first).
  2. Mark field '(optional)' in label.
- **Acceptance:**
  - Helper text visible and announced by screen reader.
  - Semantics confirmed by product owner.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Wrong wording would misinform schedulers; confirm rule.


---
## /assets/fleet/vehicles  —  `assets/fleet-vehicles.html`

- **Source:** `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`
- **Design reference:** `redesign/assets/fleet-vehicles.html`

### GAP-ASSETS-FLEET-VEHICLES-01  ·  HIGH  ·  confirmed  ·  theme UUID (was PII)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Record GPS Position needs a Vehicle ID UUID, but the table shows only registration/make/model — the id column is not rendered and rows are not linkable (page.tsx:69-77; RecordGpsForm.tsx:105). The only place the id appears is the one-time success line after registering (RegisterVehicleForm.tsx:92-96).
- **Verified evidence:** Vehicle table columns (apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:69-76) exclude id and DataTable has no rowLink props; RecordGpsForm requires a UUID (apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx:52-54, input apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx:106-115). Id shown only in registration success message (apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx:92-96). Not PII/masking: the theme is a UUID-entry usability issue.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx`, `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`, `apps/web/src/app/(app)/assets/fleet/maintenance/ScheduleMaintenanceForm.tsx`
- **Fix steps:**
  1. Make VehiclePicker (see MAINTENANCE-02) shared; in vehicles/page.tsx pass the vehicles array to RecordGpsForm.
  2. Replace UUID input with the picker; drop UUID_RE.
  3. Add a row action 'Record GPS' in the vehicles table that preselects the vehicle (query param ?vehicleId=).
  4. Success message uses registration number.
- **Acceptance:**
  - Record GPS form lists registered vehicles by registration.
  - Clicking row action preselects the vehicle.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-FLEET-MAINTENANCE-02

### GAP-ASSETS-FLEET-VEHICLES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Error state is contradictory: DataSourceBadge “Couldn’t load — showing nothing” in the header while the table shows “No vehicles registered yet” and invites a first registration (page.tsx:80-104).
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:92 renders DataSourceBadge on error, but apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:95-104 still renders the DataTable with 'No vehicles registered yet / Register your first government vehicle'.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Branch on source==='error' in FleetVehiclesPage: RefreshErrorState(toHumanError('load',{area:'fleet vehicles'})) in the Card.
  2. Keep the forms visible.
- **Acceptance:**
  - source:'error' shows error panel with Retry, not the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-FLEET-VEHICLES-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was STATUS)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Fuel Type options are capitalised from the enum, so CNG renders “Cng” (RegisterVehicleForm.tsx:197).
- **Verified evidence:** apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx:197 renders f.charAt(0).toUpperCase()+f.slice(1) so 'cng' shows 'Cng'; the table also prints the raw lowercase fuelType (apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:66,73). Not a StatusPill issue.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx`, `apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx`
- **Fix steps:**
  1. Add FUEL_LABELS map {petrol:'Petrol',diesel:'Diesel',electric:'Electric',cng:'CNG'} exported from a fleet constants file.
  2. Use it in the <option> text, ConfirmDialog description (RegisterVehicleForm.tsx:225) and mapVehicles/column formatting.
- **Acceptance:**
  - Dropdown shows 'CNG'.
  - Table shows 'CNG', 'Petrol'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-FLEET-VEHICLES-05  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Registration number is free text with only a required check — no Indian registration format and no duplicate check (RegisterVehicleForm.tsx:46-60).
- **Verified evidence:** validate() (apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx:51) only checks non-empty; maxLength 32 (apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx:125). No format or uniqueness check client-side; duplicate handling may exist server-side but cannot be seen (asset-service absent). Validation is hand-written, not zod.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/vehicles/RegisterVehicleForm.tsx`
- **Fix steps:**
  1. Add a zod schema (registrationNo normalised uppercase, strip spaces/hyphens, regex like /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/ plus BH-series /^\d{2}BH\d{4}[A-Z]{1,2}$/) and use it in validate().
  2. Uppercase on blur; show format hint 'e.g. OD02AB1234'.
  3. Surface server duplicate error (409) from browserJson in dialogError.
  4. Confirm with product whether government/temporary series need exceptions.
- **Acceptance:**
  - 'abc' rejected; 'OD02AB1234' accepted.
  - Duplicate registration returns visible error in dialog.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Too-strict regex could block legitimate government/temporary plates; agree formats first.

### GAP-ASSETS-FLEET-VEHICLES-06  ·  LOW  ·  partly  ·  theme DATEFMT (was PII)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** GPS is manually keyed lat/lng with no confirm, timestamp or map; “last recorded position” is echoed as raw ISO text (RecordGpsForm.tsx:78-90,169-170).
- **Verified evidence:** True: lat/lng free text (apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx:78-90 validate ranges), no confirm step, no map, and lastPosition prints updatedAt raw (apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx:169-170). Not PII masking; a vehicle GPS position is operational data. A 'timestamp' input isn't supported by the payload (apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx:82 sends only lat, lng). Map components exist in app/_components/maps but are not used here.
- **Files to change:** `apps/web/src/app/(app)/assets/fleet/vehicles/RecordGpsForm.tsx`
- **Fix steps:**
  1. Format lastPosition.updatedAt with a date-time formatter (IST) and show registration instead of id.
  2. Add a ConfirmDialog with the entered coordinates before POST.
  3. Optionally show a small map preview from app/_components/maps for the entered point.
- **Acceptance:**
  - Success line shows '05/10/2026, 14:32' style time and registration.
  - Confirm dialog shows lat/lng.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-FLEET-VEHICLES-01


---
## /assets/infra  —  `assets/infra.html`

- **Source:** `apps/web/src/app/(app)/assets/infra/page.tsx`
- **Design reference:** `redesign/assets/infra.html`

### GAP-ASSETS-INFRA-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was DEADROUTE)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Condition is dead data: the page reads a.condition for Needs Repair and the Condition column (infra/page.tsx:9-10,23), but mapAssetSummaries never sets condition (apiMappers.ts:840-851). Needs Repair is always 0 and Condition always falls back to the asset status.
- **Verified evidence:** apps/web/src/app/(app)/assets/infra/page.tsx:11 needsRepair = filter(a.condition==='poor'); apps/web/src/app/(app)/assets/infra/page.tsx:20 condition = a.condition ?? status. apiMappers.ts:840-851 (mapAssetSummaries push) sets no condition, so Needs Repair is always 0 and the Condition column shows status text. Whether the API returns a condition field or AssetSummary type has it cannot be checked (type package and asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/infra/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Check the asset-service response for a condition field; if present add condition: normalised(toText(row.condition)) to mapAssetSummaries and to the AssetSummary type.
  2. If absent, remove the Needs Repair StatCard (or show '—') and rename the column to Status.
  3. Never fall back status into a column labelled Condition.
- **Acceptance:**
  - With API condition 'poor' Needs Repair counts it.
  - Without it the card is not shown as 0.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** A permanent 0 for needs repair understates risk to maintenance planning.

### GAP-ASSETS-INFRA-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** “Map view” links to /assets/locations, a flat code/name list with no map or coordinates (infra/page.tsx:32; locations/page.tsx:120-126).
- **Verified evidence:** apps/web/src/app/(app)/assets/infra/page.tsx:31 plain <a href='/assets/locations'> labelled 'Map view'; locations/page.tsx:120-127 renders a bulleted list of code - name (orgUnit) with no map or coordinates.
- **Files to change:** `apps/web/src/app/(app)/assets/infra/page.tsx`
- **Fix steps:**
  1. Relabel to 'Locations' (use next/link) until a real map exists, or remove.
  2. If a map is wanted, reuse app/_components/maps and add lat/lng to locations (backend).
- **Acceptance:**
  - Button label matches the destination content.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-INFRA-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Buildings is a substring match on free-text category ("build") (page.tsx:9); Building, Buildings, Office Building all count but Hall or Annex do not.
- **Verified evidence:** apps/web/src/app/(app)/assets/infra/page.tsx:10 counts a.category?.toLowerCase().includes('build'). Mapper falls back category to categoryId.slice(0,8) or 'General' (apiMappers.ts ~845), so missing categories never match. Hall/Annex are not counted; 'Building' variants are.
- **Files to change:** `apps/web/src/app/(app)/assets/infra/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`
- **Fix steps:**
  1. Agree a category taxonomy/code (e.g. category code BUILDING) with backend.
  2. Match on the code/enum instead of substring; expose subtype from API.
  3. Until then label the tile 'Building-type categories' or hide.
- **Acceptance:**
  - Asset with category 'Hall' counted if its code is BUILDING.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Wrong count misleads planners; low financial risk.

### GAP-ASSETS-INFRA-04  ·  LOW  ·  confirmed  ·  theme FAILMASK (was ROLEGATE)

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Stats not null-gated on error (page.tsx:29,38-43).
- **Verified evidence:** On error the page shows both DataSourceBadge (apps/web/src/app/(app)/assets/infra/page.tsx:25) and RefreshErrorState (apps/web/src/app/(app)/assets/infra/page.tsx:46-47), but StatGrid (apps/web/src/app/(app)/assets/infra/page.tsx:36-41) still renders 0 / 0 / Net Block zero / 0 from the empty fallback. Not a role-gate issue.
- **Files to change:** `apps/web/src/app/(app)/assets/infra/page.tsx`
- **Fix steps:**
  1. When source==='error' skip StatGrid or pass value '—'.
  2. Remove the redundant top DataSourceBadge.
- **Acceptance:**
  - Error state shows '—' in stats and only one error message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-INFRA-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** Register rows link to the generic asset detail, which is built for movable assets (SLM schedule, AMC) — road/drain assets get irrelevant sections (detail page.tsx:74-107).
- **Verified evidence:** apps/web/src/app/(app)/assets/infra/page.tsx:60-61 rowLinkPrefix '/assets/' routes to assets/[id]/page.tsx, which renders 'Depreciation schedule (SLM)' (~line 72-78) and a lifecycle with Tagged/AMC steps (~lines 96-103) regardless of asset type.
- **Files to change:** `apps/web/src/app/(app)/assets/[id]/page.tsx`
- **Fix steps:**
  1. Branch on asset.type==='infra' in [id]/page.tsx to hide movable-only sections (SLM schedule, AMC step) or show infra-relevant ones (condition, length/area if the API provides).
  2. Keep shared header/details.
- **Acceptance:**
  - Infra asset detail shows no AMC/movable sections.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Depreciation of infra may still be valid; confirm with finance before hiding.
- **Depends on:** GAP-ASSETS-INFRA-01


---
## /assets/insurance  —  `assets/insurance.html`

- **Source:** `apps/web/src/app/(app)/assets/insurance/page.tsx`
- **Design reference:** `redesign/assets/insurance.html`

### GAP-ASSETS-INSURANCE-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Create Policy commits sum insured and premium with no ConfirmDialog, while File a Claim on the sibling screen has one (PolicyForm.tsx:304 vs ClaimForm.tsx:258). The success line says “processed asynchronously” and the id is a raw UUID (PolicyForm.tsx:118-121).
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx:69-138 submit() validates then POSTs immediately to v1/assets/insurance/policies; the button at :304 is a plain submit. apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:256-277 wraps its POST in ConfirmDialog (ds/ConfirmDialog, no requireReason there). Success text :118-121 is 'Policy submitted (id <uuid>). It is processed asynchronously and will appear below shortly.' with raw res.id. The claim form has the same raw-id message (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:122-124).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx`
- **Fix steps:**
  1. In PolicyForm add confirmOpen/dialogError state; make submit() validate then setConfirmOpen(true); move the browserJson POST into createPolicy() called from onConfirm.
  2. Render <ConfirmDialog> (from ds) summarising asset label, policy no., insurer, formatMoney(coverageMinor), formatMoney(premiumMinor), start-end dates; pass busy and errorMessage like ClaimForm.
  3. Pass the selected asset label into the description (find in assets prop).
  4. Replace the success copy with 'Policy <policyNo> submitted for <asset label>. It will appear in the list shortly.' and drop the UUID; apply the same to ClaimForm.
  5. requireReason is optional; only add if policy says policy creation needs one (ClaimForm does not).
- **Acceptance:**
  - Component test: clicking Create Policy with valid fields opens dialog and does not call browserJson until Confirm.
  - Cancel closes dialog with no POST; form values are retained.
  - Success message contains policy number and no UUID.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money-bearing create: the dialog must show amounts from the same minor strings that get sent. Async 202: the row may not appear on first refresh.

### GAP-ASSETS-INSURANCE-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Asset picker and asset labels depend on GET /assets?limit=200: beyond 200 assets the dropdown is truncated with no search and Policies rows fall back to the raw asset UUID (page.tsx:78-81,110-112).
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/page.tsx:82 fetches /api/v1/assets/assets?limit=200 and passes the list to PolicyForm's plain <select> (apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx:148-164); no search. Row labels fall back to p.assetId (apps/web/src/app/(app)/assets/insurance/page.tsx:115) when the asset is not in the 200. Policies themselves are also capped (:89 limit=200). Whether the backend caps at 200 or supports a search/q param cannot be verified (asset-service absent). Also mappers read raw.code (:48) while other loaders read assetCode ?? code (apiMappers.ts mapAssetSummaries) so labels may be name-only if the API returns assetCode.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/page.tsx`, `apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx`, `apps/web/src/app/_components/AssetPicker.tsx (new)`
- **Fix steps:**
  1. Create a client AssetPicker (async combobox: debounced query, listbox, returns id+label); SmartCombobox only accepts string[] so it is not reusable as-is.
  2. Back it with the asset list endpoint's search parameter (confirm name with backend) and page size; use it in PolicyForm and maintenance/new.
  3. For row labels, replace the UUID fallback with 'Asset not found in register' plus a link to /assets/<id>; or batch-resolve missing ids.
  4. Read code as raw.assetCode ?? raw.code in mapAssets.
- **Acceptance:**
  - Test with 250 assets: typing part of the 250th asset's name finds it in the picker.
  - Policy row for asset outside first page shows a non-UUID label with a link.
  - No raw UUID appears in the Asset column.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; wrong asset selection on an insurance policy is the business risk, so keep code visible in option labels.
- **Depends on:** GAP-ASSETS-MAINTENANCE-NEW-01

### GAP-ASSETS-INSURANCE-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** “Lapsed” counts only policies still flagged active whose end date has passed (page.tsx:104); policies already status expired never show in any stat.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/page.tsx:108 expired = endDate < today && status==='active'; Active (:102) counts status==='active' only; Expiring (:103-107) also requires active. A policy the backend already marks 'expired' (or any non-active status) appears only in Total Policies, in no other stat. Also the stat labelled Lapsed is really 'active but past end date' (a stale flag).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/page.tsx`
- **Fix steps:**
  1. Define lapsed = endDate < today OR status in ('expired','lapsed'); count each policy in exactly one of Active / Expiring / Lapsed.
  2. Exclude past-end-date policies from Active (currently an overdue 'active' is counted in both Active and Lapsed).
  3. Use a shared date helper with IST 'today' rather than new Date().toISOString() (UTC) to avoid off-by-one near midnight.
  4. Add a unit test file for the derivation (extract to a pure function).
- **Acceptance:**
  - Fixture: one active, one active past end date, one status 'expired' -> Active 1, Lapsed 2, Total 3.
  - Policy ending today counts as Expiring, not Lapsed.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; reporting numbers change for users. Status vocabulary from backend cannot be verified.

### GAP-ASSETS-INSURANCE-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Error state shows the same “Couldn’t load — showing nothing” badge three times and still offers the create form (page.tsx:121-133,141-145,157-159).
- **Verified evidence:** On a policies fetch failure with no rows the page renders DataSourceBadge three times: header (apps/web/src/app/(app)/assets/insurance/page.tsx:129), in place of the stat grid (apps/web/src/app/(app)/assets/insurance/page.tsx:137-140) and inside the Policies card (apps/web/src/app/(app)/assets/insurance/page.tsx:153-155), each 'Couldn't load - showing nothing' (DataSourceBadge.tsx:64-66). PolicyForm is rendered regardless (:150) with possibly an empty asset select.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/page.tsx`
- **Fix steps:**
  1. Keep only one failure indicator: replace the stat/table branches with a single <LoadErrorState result={policiesRes} area='insurance policies' /> (retry via router.refresh, 403 aware).
  2. Capture full loader results (not just data/source) for policies and assets.
  3. Hide or disable PolicyForm when assets failed to load (assets.length===0 && assetsSource==='error') and show the assets error inline.
  4. Remove the header badge when the body already shows the error state.
- **Acceptance:**
  - Mock policies 500: exactly one error region with a Retry button.
  - Mock 403: PermissionDenied shown.
  - Mock assets 500 only: form disabled with explanatory message, table still renders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** shared LoadErrorState

### GAP-ASSETS-INSURANCE-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** renewalReminderDays is shown on the detail page but cannot be set here (PolicyForm.tsx payload has no field); no edit/renew path from the list.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx:106-115 payload has assetId, policyNo, insurer, coverageMinor, premiumMinor, currency, startDate, endDate; no renewalReminderDays. Detail page shows it (apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:149). No edit or renew control exists on list or detail. Whether the backend accepts the field or PATCH/renew endpoints is unknown (service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx`, `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`
- **Fix steps:**
  1. Confirm with backend that POST accepts renewalReminderDays and whether PATCH/renew endpoints exist.
  2. Add an optional 'Renewal reminder (days)' number input (integer 1-365) to PolicyForm and include it in the payload only when entered.
  3. Detail page: add a Renew action only after the backend endpoint is confirmed.
- **Acceptance:**
  - Create policy with 45 sets payload renewalReminderDays:45 and detail shows 45.
  - Leaving it blank omits the field.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-INSURANCE-DETAIL-04

### GAP-ASSETS-INSURANCE-07  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Money sent as Number(minor) (PolicyForm.tsx:112-113); values above 2^53 paise would lose precision.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx:110-111 send coverageMinor: Number(coverageMinor) and premiumMinor: Number(premiumMinor) from BigInt-safe strings (rupeesToMinorString, lib/money.ts:28). Line numbers in the observation (112-113) are off. Precision loss starts above 9,007,199,254,740,991 paise (about Rs 9e13), unreachable for real policies, but it violates the paise-as-bigint rule and apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:113 has the same. Whether the API accepts strings cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx`
- **Fix steps:**
  1. Confirm the policies/claims zod schema accepts string or numeric-string minor units (backend).
  2. If yes, send the minor string as-is; otherwise keep Number() but add a Number.isSafeInteger guard that shows a field error.
  3. Apply the same to ClaimForm claimAmountMinor.
- **Acceptance:**
  - Entering 99999999999999999 shows an amount-too-large error or is sent as an exact string.
  - Normal amounts unchanged in payload.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Very low practical risk; change only with backend agreement to avoid a 400.


---
## /assets/insurance/[id]  —  `assets/insurance-detail.html`

- **Source:** `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`
- **Design reference:** `redesign/assets/insurance-detail.html`

### GAP-ASSETS-INSURANCE-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme NAVUX (was I18N)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** The detail page never names the insured asset: PolicyDetail carries assetId but the card omits it (page.tsx:194-202), so from a policy the clerk cannot reach the asset; the list resolves asset labels, this page does not.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:143-149 renders Policy Number, Insurer, Sum Insured, Premium, dates, Renewal Reminder but never policy.assetId (mapped at :45,:50 and typed at :8). No link to /assets/[id] exists on the page. The list resolves labels via getAssets() (apps/web/src/app/(app)/assets/insurance/page.tsx:96,110-115); detail does not. Line refs 194-202 in the observation are wrong (file is 182 lines). Theme I18N is wrong; this is a navigation/wiring gap.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`
- **Fix steps:**
  1. Add an 'Asset' field to the Policy Details card (after Insurer) rendered as <Link href={`/assets/${policy.assetId}`}>.
  2. Resolve the label server-side: add getAsset(id) in the page using fetchJson on the same asset path the list uses (or reuse getAssetById from app/_data/loaders.ts) and show 'code · name'.
  3. If the lookup fails or returns null, still show the link with the fallback text 'View asset' instead of the raw UUID.
  4. Do not fail the whole page when the asset lookup errors; keep policy card and show no badge for this field.
- **Acceptance:**
  - Component/RSC test: policy with assetId renders a link whose href is /assets/<assetId>.
  - Manual: open a policy from the list, click the asset field, land on the asset detail page.
  - Manual: mock asset fetch 500; policy page still renders, link shows fallback text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Extra server fetch per detail view; keep it non-blocking. Note insurance uses /api/v1/assets/... while loaders use /api/v1/asset/...; confirm the gateway path before reuse.
- **Depends on:** GAP-ASSETS-MAINTENANCE-NEW-05

### GAP-ASSETS-INSURANCE-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Claims table rows are not linkable and there is no settle/reject action; Settled Amount is display only (page.tsx:214-226).
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:164-177 DataTable has no rowLinkKey/rowLinkPrefix, so claim rows are not linkable; columns are date/claim amount/settled amount/status only. No settle or reject control exists here or in apps/web/src/app/(app)/assets/insurance/claims/page.tsx (only 'File a Claim' link at :156), and there is no claims/[id] route under assets/insurance/claims. Whether the backend exposes a settle/reject command cannot be seen: asset-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/[id]/page.tsx (new, if decided)`
- **Fix steps:**
  1. Decision first: confirm whether asset-service has claim settle/reject endpoints and the approver role; if not, this is backend work.
  2. Add a claims/[id] detail page (claim, policy link, asset link, notes, history) and set rowLinkKey='id', rowLinkPrefix='/assets/insurance/claims/' on both claim tables.
  3. On the claim detail add Settle (settled amount in rupees via rupeesToMinorString, capped at claim amount) and Reject (mandatory reason) using ConfirmDialog with requireReason, gated by role.
  4. POST via browserJson, then router.refresh(); ensure the backend emits the audit event.
- **Acceptance:**
  - Click a claim row: navigates to the claim detail page.
  - Settle with an amount above the claim amount is blocked client side; valid settle updates status and Settled Amount after refresh.
  - Reject requires a reason; without it Confirm stays disabled.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Money and approval flow: settled amount posts to Finance possibly; needs maker-checker and audit confirmation before building.

### GAP-ASSETS-INSURANCE-DETAIL-03  ·  MEDIUM  ·  partly  ·  theme I18N

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** “Policy not found” copy suggests it “may have lapsed” though lapsed policies are still returned by the list (page.tsx:170-171 vs list Lapsed stat).
- **Verified evidence:** Copy 'It may have lapsed or the link is incorrect' is at apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:114-118 (not 170-171). It is misleading because lapsed policies are listed (apps/web/src/app/(app)/assets/insurance/page.tsx:108 counts them). But fetchJson (app/_data/apiClient.ts:139-144,161-166) returns source 'error' with status for any non-2xx incl. 404 and for a null mapPolicyDetail, so the EmptyState branch (policySource !== 'error') is effectively unreachable; a real 404 currently shows the 'Couldn't load - showing nothing' badge under the title 'Policy not found' (apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:109-112).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`
- **Fix steps:**
  1. Capture the whole loader result (const policyRes = await getPolicy(...)) and branch on policyRes.status === 404 for not found.
  2. For 404 render EmptyState with copy 'This policy does not exist or the link is incorrect.' (remove 'lapsed').
  3. For other errors render <LoadErrorState result={policyRes} area='insurance policy' backHref='/assets/insurance' /> (ds/LoadErrorState) so 403 and retry work.
  4. Title: 'Policy not found' only for 404, otherwise 'Policy'.
- **Acceptance:**
  - Unit/RSC test: loader status 404 renders not-found copy without the word 'lapsed'.
  - status 500 renders retry error state; status 403 renders PermissionDenied.
  - Lapsed policy id still renders the full detail page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** shared LoadErrorState

### GAP-ASSETS-INSURANCE-DETAIL-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Renewal Reminder prints “30 days before expiry” from a default of 30 when the field is absent (page.tsx:mapPolicyDetail) — a default presented as a saved setting.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/[id]/page.tsx:58 mapPolicyDetail sets renewalReminderDays to 30 when payload value is not a number, and :149 prints '{days} days before expiry' unconditionally, so an absent field looks like a saved setting. Same pattern for missing coverage/premium (:53-54 default 0, shown by formatMoney as a real amount). PolicyForm never sends renewalReminderDays (apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx:106-115), so in practice every policy the UI created shows the fabricated 30.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/[id]/page.tsx`
- **Fix steps:**
  1. Change PolicyDetail.renewalReminderDays to number | null; mapper returns null when not a number.
  2. Render 'Not set' (muted) when null, else '{n} days before expiry'.
  3. Optionally map missing coverageMinor/premiumMinor to null and render '-' rather than 0.
- **Acceptance:**
  - Mapper test: payload without renewalReminderDays yields null; page shows 'Not set'.
  - Payload with 15 shows '15 days before expiry'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only.


---
## /assets/insurance/claims  —  `assets/insurance-claims.html`

- **Source:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`
- **Design reference:** `redesign/assets/insurance-claims.html`

### GAP-ASSETS-INSURANCE-CLAIMS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Failed policies fetch is indistinguishable from no eligible policies: the select is empty and the copy says “No active policies available” (ClaimForm.tsx:35,238) while the page badge reflects only the overall source.
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/claims/page.tsx:103 fetches policies; on failure fallback [] is passed to ClaimForm (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:143). ClaimForm filters status==='active' (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:35) and shows 'No active policies available to file a claim against.' (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:236-239) with the button disabled. The header badge (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:128) does appear when policiesSource is error, but the form message itself is misleading.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx`
- **Fix steps:**
  1. Pass policiesError={policiesSource==='error'} to ClaimForm.
  2. In ClaimForm, when policiesError show 'Couldn't load policies. Retry' (RefreshErrorState or small inline retry) instead of the no-active-policies text.
- **Acceptance:**
  - Policies fetch fails: form says load failed, not 'no active policies'.
  - Empty successful list keeps existing message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-INSURANCE-CLAIMS-02  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION (was DATEFMT)

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Claim date is checked only for calendar validity: it is not compared with the policy’s start/end dates and policies past end date but still flagged active remain eligible (ClaimForm.tsx:35,66-90).
- **Verified evidence:** validateClaimDate (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:16-24) checks format, real date, not future; eligibility is only status==='active' (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:35). PolicyOption (page.tsx:7-14) and mapPolicies (page.tsx:38-58) drop any start/end dates, so no comparison is possible. Extra defect: 'today' is computed from toISOString (UTC), so before 05:30 IST the current IST date is rejected as future. Whether the API returns policy dates cannot be checked (asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx`
- **Fix steps:**
  1. Map startDate/endDate (if API provides) into PolicyOption.
  2. Filter out policies where endDate < today or reject claimDate outside [start,end] with clear error; show dates in policy option label.
  3. Compute 'today' in Asia/Kolkata for the future check.
  4. Keep server authoritative.
- **Acceptance:**
  - Claim date after policy end is rejected with message.
  - Claim dated today at 02:00 IST is accepted.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Blocking valid claims by wrong dates has business impact; server must remain the rule owner.

### GAP-ASSETS-INSURANCE-CLAIMS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** No way to settle, reject or close a claim: Settled Amount and Status are display-only (page.tsx:140-146); the stat “Settled” counts settled|closed (page.tsx:112).
- **Verified evidence:** Claims table (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:150-156) is display-only; no row action. Settled stat counts status settled|closed (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:109; observation's line 112 is off). Settle/reject endpoints cannot be seen (asset-service absent).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`, `apps/web/src/app/(app)/assets/insurance/claims/ClaimActions.tsx (new)`
- **Fix steps:**
  1. Confirm backend endpoints and roles for settle/reject/close (and audit events).
  2. Add client ClaimActions with ConfirmDialog; settled amount entered as rupees via rupeesToMinorString.
  3. Split 'Settled' and 'Closed' stats or rename label.
  4. router.refresh() after action.
- **Acceptance:**
  - Pending claim can be settled with amount; status and Settled Amount update.
  - Amount above claim is rejected.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money and approval path: enforce role check, paise integer math and audit server-side.

### GAP-ASSETS-INSURANCE-CLAIMS-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Policy column falls back to the raw policy UUID when the policy is beyond the 200-row fetch (page.tsx:121-128).
- **Verified evidence:** apps/web/src/app/(app)/assets/insurance/claims/page.tsx:116 policyLabel falls back to c.policyId when the policy is not in the map; policies are fetched with limit=200 (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:83). Also all rows show UUIDs if the policies fetch fails.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`
- **Fix steps:**
  1. Fallback label to 'Policy unavailable' (optionally short id in a title attribute) rather than the UUID.
  2. Better: have the claims API embed policyNo/insurer, or fetch missing policies by id.
  3. Link to /assets/insurance policy detail if a route exists.
- **Acceptance:**
  - Claim whose policy is beyond 200 rows does not show a raw UUID.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-INSURANCE-CLAIMS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Error state repeats the same badge in stat area and table card while still offering the claim form (page.tsx:131-134,143-145).
- **Verified evidence:** When claimsSource==='error' and no rows, DataSourceBadge renders three times: header (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:128), stat Card (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:131-134) and table Card (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:146-147); ClaimForm still renders (apps/web/src/app/(app)/assets/insurance/claims/page.tsx:143) so users can file claims they cannot see the list of.
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/page.tsx`
- **Fix steps:**
  1. Show one RefreshErrorState(toHumanError('load',{area:'insurance claims'})) in the Claims card; hide the stat grid and the header badge when claims failed.
  2. Keep ClaimForm but note list unavailable, or disable it if policies also failed.
- **Acceptance:**
  - Claims fetch error shows a single error panel with Retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-INSURANCE-CLAIMS-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Notes is a single-line input for free-text claim notes (ClaimForm.tsx:223); claim narrative and supporting documents cannot be attached.
- **Verified evidence:** Notes is a single-line <input> (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:223) with no maxLength; no attachment control (app/_components/FileUpload.tsx exists but is unused here). Payload has notes only (apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx:118).
- **Files to change:** `apps/web/src/app/(app)/assets/insurance/claims/ClaimForm.tsx`
- **Fix steps:**
  1. Switch to <textarea> with maxLength (match backend) and counter.
  2. If attachments are required, add FileUpload once backend accepts documents.
  3. Confirm limits with backend.
- **Acceptance:**
  - Multi-line notes can be entered and submitted.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Attachments involve document storage and PII; needs backend.


---
## /assets/leases  —  `assets/leases.html`

- **Source:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Design reference:** `redesign/assets/leases.html`

### GAP-ASSETS-LEASES-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Registering a lease posts an ROU asset and a lease liability but has no ConfirmDialog and no reason, unlike depreciation run and bulk import (page.tsx:112-142); the success line “registered with ROU asset” is the only feedback.
- **Verified evidence:** apps/web/src/app/(app)/assets/leases/page.tsx:56-84 submit() POSTs on form submit; no ConfirmDialog is imported (:4) and no reason field. Feedback is only 'IFRS 16 lease registered with ROU asset.' (:75) in a plain banner. That the backend posts an ROU asset and liability is stated by the message, not verifiable here.
- **Files to change:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Fix steps:**
  1. Add ConfirmDialog (ds) opened from submit after validation; description shows lease no., lessor, formatMoney ROU cost and liability, term.
  2. Move the fetch into registerLease() called on confirm; pass busy/errorMessage.
  3. Optionally requireReason for audit note if backend accepts one (unknown).
  4. Show the created lease id/number and link to the ROU asset in the success message.
- **Acceptance:**
  - Submitting the form opens the dialog; no POST until Confirm.
  - Cancel keeps entered values.
  - Error from server shows inside the dialog.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money and ledger posting: double submit risk; keep busy state and disable confirm while pending.
- **Depends on:** GAP-ASSETS-LEASES-03

### GAP-ASSETS-LEASES-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Liability is captured (form) and typed (Lease.liabilityMinor) but never displayed: the table shows ROU cost only, although the page subtitle promises “lease liability tracking” (page.tsx:14,75-80,151-155). Status is also fetched and hidden.
- **Verified evidence:** Lease type has liabilityMinor and status (apps/web/src/app/(app)/assets/leases/page.tsx:12,17); tableRows (:89-97) and columns (:149-155) show Lease, Lessor, ROU, Term, Asset only; liability and status are never rendered though subtitle (:103) promises 'lease liability tracking'.
- **Files to change:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Fix steps:**
  1. Add liability: formatMoney(r.liabilityMinor) to tableRows and a right-aligned 'Liability' column.
  2. Add a Status column with cellType 'status' (StatusPill).
  3. Consider replacing the hand-built rows with cellType 'amount' on raw minor values for consistent formatting/sorting.
- **Acceptance:**
  - Row with rouCostMinor 100000 and liabilityMinor 90000 shows both formatted amounts.
  - Status pill visible per row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-LEASES-03  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** No date-order check: lease end may precede lease start; only native required attributes apply, and money is Math.round(Number(x)*100) so “1,85,00,000” becomes NaN (page.tsx:60-67).
- **Verified evidence:** Confirmed: no end>start check; only native required attrs (apps/web/src/app/(app)/assets/leases/page.tsx:131,135). Money is Math.round(Number(x||'0')*100) at :68-69, so '1,85,00,000' is NaN and JSON.stringify sends null, and float rounding can misround (e.g. 1.005). Correction: lines are :68-69 not 60-67, and the failure is a server rejection, not a silent NaN store (backend validation not visible). Zero is also accepted for both amounts ('0' fallback).
- **Files to change:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Fix steps:**
  1. Replace Math.round(Number()) with rupeesToMinorString from lib/money.ts; add field-level errors for null result (also strip commas or show a hint 'digits only').
  2. Add end > start validation (string compare of ISO dates) with inline error and aria-invalid, as PolicyForm.validateDate does.
  3. Send minor amounts as strings/numbers per backend schema (confirm).
  4. Add min on lease-end input = leaseStart.
- **Acceptance:**
  - Unit: '185.50' -> 18550; '1,85,00,000' -> field error, no request.
  - End date before start shows error and blocks POST.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: current float path can misround; fix reduces ledger risk.
- **Depends on:** GAP-ASSETS-LEASES-01

### GAP-ASSETS-LEASES-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Loading is an EmptyState titled “Loading leases…” (page.tsx:127-131), not a skeleton, and the whole list is client-fetched with no pagination or sort default.
- **Verified evidence:** apps/web/src/app/(app)/assets/leases/page.tsx:146 uses EmptyState title 'Loading leases...' while loaded is false; no Skeleton. The list is one client fetch of /api/proxy/v1/asset/leases (:31) with no limit/page params; DataTable has sortable but no pageSize/default sort (:148-158). Server-side pagination support is unknown.
- **Files to change:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Fix steps:**
  1. Render ds/Skeleton while !loaded instead of EmptyState.
  2. Add pageSize={15} and filterable to DataTable; set a default sort (lease start desc) if DataTable supports it.
  3. Convert page to a server component with fetchJson loader + client form if consistent with siblings (optional).
- **Acceptance:**
  - Loading state shows skeleton, not empty-state copy.
  - 30 leases paginate at 15.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-LEASES-06  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** Asset “View” is a raw <a> full page load rather than a client link (page.tsx:156-158).
- **Verified evidence:** apps/web/src/app/(app)/assets/leases/page.tsx:154 uses render: <a href={`/assets/${r.assetId}`}>View</a>, a plain anchor causing a full document load (also ignores keyboard/prefetch benefits of next/link). Also tableRows carries an unused 'asset' string (:95).
- **Files to change:** `apps/web/src/app/(app)/assets/leases/page.tsx`
- **Fix steps:**
  1. Import Link from next/link and use <Link href=...>.
  2. Give it an accessible name: aria-label={`View asset for lease ${leaseNo}`}.
  3. Remove the unused asset field.
- **Acceptance:**
  - Clicking View navigates client-side (no full reload).
  - Link has a distinguishing accessible name.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/list  —  `assets/list.html`

- **Source:** `apps/web/src/app/(app)/assets/list/page.tsx`
- **Design reference:** `redesign/assets/list.html`

### GAP-ASSETS-LIST-01  ·  HIGH  ·  partly  ·  theme NAVUX (was WIRING)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Two routes render the same page: /assets/list and /assets/fixed-assets share title, subtitle, banner, stats and columns; list has a Segmented filter and provenance badge, fixed-assets filters type==="fixed" (list/page.tsx:19-21; fixed-assets/page.tsx:26-28). Hub tiles “Asset Register” and “Fixed Assets” look identical to a clerk.
- **Verified evidence:** Both pages use title 'Fixed Asset Register', identical subtitle, banner and four stat cards (apps/web/src/app/(app)/assets/list/page.tsx:19-48 vs apps/web/src/app/(app)/assets/fixed-assets/page.tsx:167-196). Differences: list uses getAssets() with no type filter (all asset types, loaders.ts:3800) plus AssetsTable (Segmented tabs, provenance badge, cache), while fixed-assets calls ?type=fixed and filters type==='fixed' (:149) with a plain table. So the list page mislabels an all-assets register as 'Fixed'. Hub tiles do have different notes (assets/page.tsx:12,21) but the destination screens look the same.
- **Files to change:** `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/(app)/assets/page.tsx`
- **Fix steps:**
  1. Retitle list to 'Asset Register' with subtitle 'All assets with status and valuation'; keep 'Fixed Asset Register' for fixed-assets.
  2. Remove the fixed-only banner (GRN capitalisation) and 'Tagged' stat semantics from the list page or make them type-aware.
  3. Optionally add a type column and type Segmented filter to the list; and reuse AssetsTable in fixed-assets so both share the cache/provenance behaviour.
  4. Update /assets/[id] back label and dashboard link text consistently.
- **Acceptance:**
  - /assets/list heading reads 'Asset Register'; /assets/fixed-assets reads 'Fixed Asset Register'.
  - Fixed count on list >= fixed count on fixed-assets page.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; copy and consistency only.
- **Depends on:** GAP-ASSETS-LIST-03

### GAP-ASSETS-LIST-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Stats and table can disagree: stats are computed from the server prop (page.tsx:7-11) but the table reads useSeededResource which may serve cached rows (AssetsTable.tsx:31-36); on an offline reload the stats show 0 over a full cached table.
- **Verified evidence:** Stats are computed from the server prop `assets` (apps/web/src/app/(app)/assets/list/page.tsx:7-11) while apps/web/src/app/(app)/assets/list/AssetsTable.tsx:81-86 renders `rows` from useSeededResource, which on server error/empty falls back to IndexedDB cache (lib/sync/resource.ts:240-249). On offline reload the loader returns [] so stats show 0 / 0% / zero money above a populated cached table. Note also a genuinely empty-server-but-cached case has the same divergence.
- **Files to change:** `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/list/AssetsTable.tsx`
- **Fix steps:**
  1. Move the StatGrid into the client component (AssetsTable or a new AssetRegisterStats) and compute from the same `rows` returned by useSeededResource.
  2. Keep the server page passing initial assets and source only.
  3. Extract a pure computeAssetStats(rows) helper and unit-test it.
- **Acceptance:**
  - Component test: seed cache with 3 assets, server assets=[] source 'error': stats show 3 assets, and badge says saved data.
  - Live path: stats equal table row count.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money totals (gross/net block) shown from cache: label stale data via the existing provenance badge.
- **Depends on:** GAP-ASSETS-LIST-03, GAP-ASSETS-LIST-01

### GAP-ASSETS-LIST-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** “Tagged (QR)” is computed as share of active/in_use assets, not of assets with a barcode (page.tsx:9); the label promises a tagging metric the code does not measure.
- **Verified evidence:** apps/web/src/app/(app)/assets/list/page.tsx:9 tagged = round(totalActive/assets.length*100), where totalActive counts status active/in_use; nothing looks at a barcode/serial field. The card label 'Tagged (QR)' (:45) and subtitle promise a tagging metric. The asset detail page reads a barcode via ext.barcode ?? serialNo (assets/[id]/page.tsx:57), but AssetSummary from mapAssetSummaries has no barcode field, so a real metric needs the mapper to carry it (and backend to supply it; cannot verify).
- **Files to change:** `apps/web/src/app/(app)/assets/list/page.tsx`, `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`, `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add optional barcode to AssetSummary and map it in mapAssetSummaries (toText(row.barcode)).
  2. Compute tagged = count(a.barcode) / assets.length, guarding zero (both pages).
  3. If the API lacks barcode in list responses, replace the card with 'Active assets' (same formula) and a correct label.
  4. Share the stats helper with LIST-02.
- **Acceptance:**
  - Fixture: 4 assets, 1 with barcode -> 25%.
  - With no barcode data, the card is not labelled Tagged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Reporting accuracy for audit; label change is safest.
- **Depends on:** GAP-ASSETS-LIST-02

### GAP-ASSETS-LIST-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Mapper collapses unknown statuses (written_off, under_maintenance, in_maintenance) to "active" (apiMappers.ts:833-839), so the In maintenance filter regex /maintenance|repair/ (AssetsTable.tsx:59) never matches those rows.
- **Verified evidence:** Mapper (apiMappers.ts:833-839, mapAssetSummaries) maps only in_use, maintenance, disposed, condemned; everything else, including written_off, under_maintenance, in_maintenance, becomes 'active'. The regex /maintenance|repair/ (apps/web/src/app/(app)/assets/list/AssetsTable.tsx:102, not :59) does match the exact 'maintenance' status, so the filter works for that value; it fails for the other variants because they never reach the table. Whether the backend emits those exact strings cannot be verified (asset-service absent); the same collapse also inflates the 'Active' tab and Tagged stat.
- **Files to change:** `apps/web/src/app/_data/apiMappers.ts`, `apps/web/src/app/(app)/assets/list/AssetsTable.tsx`, `apps/web/src/app/_data/types (AssetSummary type)`
- **Fix steps:**
  1. Confirm the backend asset status enum.
  2. Extend AssetSummary['status'] and the mapper switch to include every backend status (written_off, under_maintenance/in_maintenance normalised to 'maintenance'); default unknown to a visible 'unknown' status rather than 'active'.
  3. Make AssetsTable tabs compare the typed status rather than a regex over the display string.
  4. Update StatusPill mapping for new statuses.
- **Acceptance:**
  - Mapper test: 'under_maintenance' -> 'maintenance'; 'written_off' -> 'written_off'; unknown -> 'unknown'.
  - Maintenance tab lists those rows; Active tab does not.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Silently showing written-off assets as active misstates the register and stats.
- **Depends on:** GAP-ASSETS-LIST-03

### GAP-ASSETS-LIST-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Segmented filter is client-side over one page of rows; with a server list cap it silently hides assets (loaders.ts getAssets has no pagination).
- **Verified evidence:** apps/web/src/app/(app)/assets/list/AssetsTable.tsx:98-103 filters tableRows client-side; getAssets() (loaders.ts:3800) calls /api/v1/asset/assets with no limit/page, so whatever the server returns (default page size unknown) is the whole set; DataTable pages 15 at a time client-side. If the API caps or paginates, assets beyond page one are invisible with no indication. Cap value cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/list/AssetsTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm API default limit and response meta (total/next cursor).
  2. Pass status/type/q filters to the API via searchParams and paginate server-side; or read meta.total and show 'Showing N of M' with a load-more.
  3. Keep Segmented as URL-driven (searchParams) so tabs are shareable.
- **Acceptance:**
  - With API total 500, page shows 'Showing 200 of 500' or server pagination controls.
  - Maintenance tab queries server rather than filtering one page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Auditors may believe the register is complete when it is truncated.
- **Depends on:** GAP-ASSETS-LIST-02


---
## /assets/locations  —  `assets/locations.html`

- **Source:** `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Design reference:** `redesign/assets/locations.html`

### GAP-ASSETS-LOCATIONS-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** The screen is titled “Plant maintenance hierarchy” and the card “Location tree”, but Location has no parent, level or path and the list is flat (page.tsx:8,127-131); a hierarchy cannot be created or shown.
- **Verified evidence:** apps/web/src/app/(app)/assets/locations/page.tsx:83 subtitle 'Plant maintenance hierarchy', :110 card 'Location tree', :116 empty-state text 'build the plant-maintenance hierarchy'; but Location = {id, code, name, orgUnit} (:8), the form has no parent (:91-107) and rendering is a flat <ul> (:119-123). Whether the API supports a parent id is not visible.
- **Files to change:** `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Fix steps:**
  1. Short term: rename to 'Functional Locations register' / 'Locations' and remove hierarchy wording.
  2. Long term (needs backend parentId/path): add Parent select to the form, build tree from rows, render nested list with indent and expand/collapse (role='tree').
  3. Reject cycles client side when reparenting.
- **Acceptance:**
  - No 'tree/hierarchy' wording remains while data is flat.
  - With parentId supported: creating child under parent shows nested.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; expectation mismatch only.

### GAP-ASSETS-LOCATIONS-02  ·  MEDIUM  ·  partly  ·  theme CAP

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Add-only: no edit, deactivate or delete, and no duplicate-code check client-side, so a mistyped code is permanent (page.tsx:33-73,99-114).
- **Verified evidence:** Confirmed: the page only POSTs (:51) and lists (:119-123); no edit/deactivate/delete controls and no client duplicate check against rows (:45-74). Server may reject duplicates (formError.fromResponse at :62 handles it) and may offer PATCH/DELETE, but that cannot be verified. 'Permanent' depends on backend.
- **Files to change:** `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Fix steps:**
  1. Add client-side duplicate check: normalise code (trim/upper) and compare with rows before POST; inline field error.
  2. Add Edit (name/orgUnit) and Deactivate actions with ConfirmDialog once endpoints are confirmed.
  3. Render inactive rows muted with status pill.
- **Acceptance:**
  - Entering an existing code shows 'Code already exists' with no request.
  - Edit changes name and list refreshes.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing a code referenced by assets could orphan references; keep code immutable, allow name/orgUnit edits.

### GAP-ASSETS-LOCATIONS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** Locations are not linked to assets: Infra “Map view” and asset Location fields are free text, so this register does not feed them (infra/page.tsx:32; detail page.tsx:66).
- **Verified evidence:** Register form takes location as free text (assets/register/page.tsx:93-94, sent as form.location :39); asset detail prints asset.location string ([id]/page.tsx:66); Infra 'Map view' button links to /assets/locations (infra/page.tsx:32), which is a code/name list, not a map. So the locations register is not referenced by assets.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`, `apps/web/src/app/(app)/assets/[id]/page.tsx`, `apps/web/src/app/(app)/assets/infra/page.tsx`, `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Fix steps:**
  1. Confirm whether asset payload supports locationId (backend).
  2. Replace the register Location text input with a select/picker over /api/proxy/v1/asset/locations, store locationId, and display the linked location on detail with a link.
  3. Rename or repoint the Infra 'Map view' button (label 'Locations' until a real map exists).
- **Acceptance:**
  - Registering an asset with a chosen location persists locationId; detail shows the location name.
  - Infra button text no longer says Map view.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Existing free-text values need migration/matching.
- **Depends on:** GAP-ASSETS-INSURANCE-03

### GAP-ASSETS-LOCATIONS-04  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Loading is an EmptyState “Loading locations…”, no skeleton, no pagination for a growing list (page.tsx:117-123).
- **Verified evidence:** apps/web/src/app/(app)/assets/locations/page.tsx:116 EmptyState title 'Loading locations...' while !loaded; no Skeleton. Fetch (:23) has no limit/page and the list is a plain unbounded <ul> (:119).
- **Files to change:** `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Fix steps:**
  1. Render ds/Skeleton during load.
  2. Use DataTable with pageSize and filterable for the list (columns code, name, org unit).
  3. Pass limit/cursor when the API supports it.
- **Acceptance:**
  - Loading shows skeleton.
  - 100 locations paginate.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-LEASES-05

### GAP-ASSETS-LOCATIONS-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Org unit is a free-text field rather than a picker over the Establishment org tree.
- **Verified evidence:** apps/web/src/app/(app)/assets/locations/page.tsx:101-104 orgUnit is a free <input>. An org-unit source exists: getAdminOrgUnits in app/_data/loaders.ts via /v1/admin/org-hierarchy (tenant-service, see admin/org/page.tsx), but it is the tenant admin org hierarchy, not an 'Establishment' tree (establishment area has no org tree; hr/org-chart is separate). Whether asset-service should store the unit id or name is unknown.
- **Files to change:** `apps/web/src/app/(app)/assets/locations/page.tsx`
- **Fix steps:**
  1. Fetch org units (server loader passed as prop, or client fetch of /api/proxy/v1/admin/org-hierarchy) and render a select; permission failure should fall back to text with a hint.
  2. Store unit id (or name) per backend contract; display name in the list.
  3. Pick one source of truth with HR/Establishment (decision).
- **Acceptance:**
  - Org unit select lists units from the hierarchy.
  - When the org call returns 403, form still works via free text.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Admin endpoint may be role-gated for asset clerks.


---
## /assets/maintenance  —  `assets/maintenance.html`

- **Source:** `apps/web/src/app/(app)/assets/maintenance/page.tsx`
- **Design reference:** `redesign/assets/maintenance.html`

### GAP-ASSETS-MAINTENANCE-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Schedule and + Log Job both link to /assets/maintenance/new (page.tsx:31-32): two buttons, one destination; no way to tell preventive scheduling from breakdown logging.
- **Verified evidence:** maintenance/page.tsx:31-32 both <a> point to /assets/maintenance/new. That form (maintenance/new/page.tsx:59-63) POSTs /api/proxy/v1/asset/work-orders with only {assetId, scheduledDate, notes}; it has no type field (preventive/breakdown), so the two buttons are identical and type cannot be chosen. Also raw <a> (full reload).
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/page.tsx`, `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`
- **Fix steps:**
  1. Change buttons to next/link with query: /assets/maintenance/new?type=preventive (Schedule) and ?type=breakdown (Log Job).
  2. In new/page.tsx read useSearchParams().get('type'), add a Type <select> (preventive/breakdown/corrective) defaulting from the param and set page title accordingly.
  3. Send maintenanceType in the work-orders POST body only if the work-orders endpoint accepts it (asset-service not in snapshot: cannot-verify field name); otherwise drop to one button.
  4. If backend has no type, remove one button and rename to '+ Log Job'.
- **Acceptance:**
  - Clicking Schedule opens form with Type=Preventive preselected; + Log Job preselects Breakdown.
  - Submitted payload contains the chosen type (network tab) or only one button remains.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; work-order create payload change needs asset-service contract check.

### GAP-ASSETS-MAINTENANCE-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** “Job” column shows assetCode and there is no job id, date or SLA column although the subtitle promises “breakdown jobs with SLA” (page.tsx:33,55-58); rows link to the asset, not to the job.
- **Verified evidence:** maintenance/page.tsx:53 column key assetCode is labelled 'Job'; rows built at :14-21 carry no job id, scheduled date or SLA field; rowLinkKey=assetId with prefix /assets/ (:60-61) so click opens the asset, not the job. Subtitle at :28 promises 'breakdown jobs with SLA'. Whether MaintenanceSummary (mapMaintenanceSummaries, loaders.ts:3855) exposes job id/date/SLA cannot be verified (mapper/asset-service not read).
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Check MaintenanceSummary type and mapMaintenanceSummaries for jobId, scheduledDate, dueDate/slaDueAt; add any present to the row mapping.
  2. Rename column 'Job' to 'Asset code' (or show job id/ref if available) and add Scheduled date column using formatIndianDate.
  3. Add SLA/Due column only if backend supplies it; otherwise change subtitle to 'Preventive schedules and breakdown jobs.'
  4. Point rowLinkKey to job id / detail route if one exists; else keep asset link and label it.
- **Acceptance:**
  - Column headers match the data shown; no 'Job' column containing asset codes.
  - Subtitle makes no claim the table cannot back (SLA shown or wording removed).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational, depends on API fields.

### GAP-ASSETS-MAINTENANCE-03  ·  LOW  ·  partly  ·  theme COPY (was STATUS)

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Type column prints raw enum (preventive/breakdown/corrective) unformatted; status underscores are replaced, type is not (page.tsx:23,57).
- **Verified evidence:** Status is humanized at page.tsx:20 (underscores replaced) and then StatusPill humanizes again; maintenanceType is printed as plain text at :18/:55 (lowercase 'preventive'). StatusPill STATUS_MAP has no 'scheduled' key so scheduled falls to neutral info tone. Line refs in the observation (23,57) are off; actual :18 and :55.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Import humanizeStatus from @/lib/formatters and apply to maintenanceType in the rows map.
  2. Optionally give the type column render() a pill (breakdown=bad, preventive=info).
  3. Add 'scheduled' (warn/info) to STATUS_MAP in StatusPill.tsx; drop the redundant .replace at :20.
- **Acceptance:**
  - Row with maintenanceType 'breakdown' shows 'Breakdown'.
  - Scheduled row shows a deliberate tone, unit test on StatusPill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Very low.


---
## /assets/maintenance/new  —  `assets/maintenance-new.html`

- **Source:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`
- **Design reference:** `redesign/assets/maintenance-new.html`

### GAP-ASSETS-MAINTENANCE-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Asset picker is a plain dropdown over the first 200 assets only (?limit=200); a department with more assets can never raise a work order for the rest, and there is no search (page.tsx:34,100-105).
- **Verified evidence:** apps/web/src/app/(app)/assets/maintenance/new/page.tsx:34 fetches /api/proxy/v1/asset/assets?limit=200 and :100-105 renders all as <option>s in a plain <select>; no search or paging. If the register exceeds the cap the rest cannot be chosen. Backend cap behaviour cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`, `apps/web/src/app/_components/AssetPicker.tsx (new, shared)`
- **Fix steps:**
  1. Use the shared async AssetPicker (see INSURANCE-03) with server-side search.
  2. Preselect via ?assetId= query param so asset detail pages can deep-link to 'Log job'.
  3. Keep code+name in option labels.
- **Acceptance:**
  - With 300 assets, typing part of asset 300's name finds it and submits its id.
  - Deep-link with assetId preselects.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-INSURANCE-03

### GAP-ASSETS-MAINTENANCE-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Load failure only shows a text banner; the select stays empty and the button disabled with no retry action, unlike ErrorState elsewhere (page.tsx:35-43,92-94).
- **Verified evidence:** apps/web/src/app/(app)/assets/maintenance/new/page.tsx:35-43 stores loadError string; :92-94 shows it in a banner. The select stays empty and Log job is disabled by !assetId (:116); there is no retry, and the load effect (:30-51) is not reusable. ds/ErrorState with onRetry is used on leases/locations.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`
- **Fix steps:**
  1. Extract loadAssets() as a useCallback and call it from the effect and a retry.
  2. Replace the banner with <ErrorState error={toHumanError('load',{area:'assets'})} onRetry={loadAssets} /> (as in locations/page.tsx:113); on 403 show PermissionDenied using status.
  3. Hide/disable the form while the assets are unavailable.
- **Acceptance:**
  - Mock 500 then 200: Retry loads assets and enables selection.
  - 403 shows access message not a retry loop.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** shared LoadErrorState

### GAP-ASSETS-MAINTENANCE-NEW-03  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Work order is a mutation but has no ConfirmDialog/reason, and scheduledDate accepts past dates with no validation (page.tsx:53-79,108-109).
- **Verified evidence:** Confirmed: submit (apps/web/src/app/(app)/assets/maintenance/new/page.tsx:53-79) POSTs directly with no ConfirmDialog; scheduledDate defaults to today (:23) and input has no min or validation (:109), so past dates are accepted. Not established: that a confirmation/reason is required for raising a work order (low-risk, reversible action); past dates might be legitimate for logging a completed job ('Log Maintenance Job' vs 'Raise a work order' copy conflicts), so that needs a product decision. Backend validation not visible.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`
- **Fix steps:**
  1. Decide: is this scheduling (future only) or logging (past allowed)?
  2. If scheduling: add min={today} and a submit-time check with an inline error (aria-invalid, focus).
  3. Optionally add a light ConfirmDialog summarising asset and date; a reason is not needed unless policy demands.
  4. Align page title and subtitle with the decision.
- **Acceptance:**
  - Past date is blocked with an inline error (if decided).
  - POST fires only after confirm (if added).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; creates maintenance records, no money.

### GAP-ASSETS-MAINTENANCE-NEW-04  ·  LOW  ·  partly  ·  theme A11Y (was I18N)

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Success and error both use an unstyled --panel banner; the error variant is visually identical to success (page.tsx:90,93). Redirect after 700 ms can be missed by screen-reader users.
- **Verified evidence:** Confirmed: success (apps/web/src/app/(app)/assets/maintenance/new/page.tsx:90) and error banners share identical inline style (background var(--panel)); only role/aria-live differ, so sighted users cannot tell them apart. The error banner is announced (role alert), success is role status. Redirect: router.push after 700ms (:72) with the timer not cleared; navigating away unmounts the live region so the success announcement may be cut off. Theme should be accessibility, not I18N.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`
- **Fix steps:**
  1. Use the pill tone classes as PolicyForm does (className={`pill ${isError ? 'bad' : 'good'}`}) plus a leading text/icon ('Error:'/'Done:') so colour is not the only cue.
  2. Replace the timed redirect with a persistent success message plus a 'View maintenance jobs' link, or push after the announcement (>=2s) and clear the timer on unmount.
  3. Consider the ds Toast for the success message.
- **Acceptance:**
  - Error banner is visually distinct and contains the word 'Error'.
  - Success remains announced by screen reader (test with role=status still mounted) before navigation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-MAINTENANCE-NEW-05  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Fallback label shows the raw asset UUID when code and name are both missing (page.tsx:103).
- **Verified evidence:** apps/web/src/app/(app)/assets/maintenance/new/page.tsx:103 label is [a.code, a.name].filter(Boolean).join(' · ') || a.id, so an asset lacking both shows a raw UUID. Also AssetRow reads a.code, while mapAssetSummaries reads assetCode ?? code (apiMappers.ts:~825), so if the API returns assetCode the option shows only the name; verify the payload.
- **Files to change:** `apps/web/src/app/(app)/assets/maintenance/new/page.tsx`, `apps/web/src/app/(app)/assets/insurance/page.tsx`, `apps/web/src/app/(app)/assets/insurance/PolicyForm.tsx`
- **Fix steps:**
  1. Read assetCode ?? code.
  2. Fallback label 'Unnamed asset' with last 6 chars of the id in muted text instead of the full UUID.
  3. Use one shared assetOptionLabel(a) helper for maintenance/new, PolicyForm and the insurance list.
- **Acceptance:**
  - Option for asset with no code/name shows 'Unnamed asset (ref a1b2c3)', not a full UUID.
  - Asset with assetCode only shows the code.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-INSURANCE-03


---
## /assets/projects  —  `assets/projects.html`

- **Source:** `apps/web/src/app/(app)/assets/projects/page.tsx`
- **Design reference:** `redesign/assets/projects.html`

### GAP-ASSETS-PROJECTS-01  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Source error with rows.length === 0 shows only the badge, but the same fetch is also the empty-list path: a failed fetch is indistinguishable from an empty register except by the badge, and the Create form stays live, inviting duplicate project codes while the list is unavailable (page.tsx:59-60,56).
- **Verified evidence:** page.tsx:107 shows the error badge in the header, stat cards already show '—' when source==='error' (:111-117) so the 0-as-count part is refuted. But the register area at :131-132 renders only DataSourceBadge when error and rows empty (no RefreshErrorState/retry), and <AucForm/> (:128) is always rendered so users can create projects while the list failed to load. Server does not fetch-error-map to notFound.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/page.tsx`
- **Fix steps:**
  1. In the Card at :130 render <RefreshErrorState error={toHumanError('load',{area:'AUC projects'})}/> (as in maintenance/page.tsx:47) instead of the bare badge.
  2. Pass a disabled/notice prop to AucForm (or skip rendering) when source==='error', with text that the register could not be checked for duplicate codes.
  3. Keep server-side duplicate-code rejection as the real guard (backend cannot-verify).
- **Acceptance:**
  - With API down the page shows RefreshErrorState with retry and the Create form disabled.
  - Healthy empty list still shows 'No AUC projects yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-ASSETS-PROJECTS-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** This page fetches /api/v1/asset/projects/auc server-side while every sibling client page uses /api/proxy/v1/asset/...; the comment itself admits both /api/v1/asset and /api/v1/assets exist upstream, so the prefix convention is unverified (page.tsx:9-18).
- **Verified evidence:** Loader at page.tsx:15 uses fetchJson('/api/v1/asset/projects/auc'), the same '/api/v1/asset/...' server-side prefix every loader in _data/loaders.ts uses (e.g. :3792,3801,3856). Client components use /api/proxy/v1/asset/... because they run in the browser (browserClient.ts:22), so there is no inconsistency between them. The code comment (:9-13) is honest that both prefixes exist upstream; asset-service is not in the snapshot so route registration cannot be verified here.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/page.tsx`
- **Fix steps:**
  1. No functional change needed. Optionally move getAucProjects into _data/loaders.ts beside other asset loaders and shorten the comment.
  2. Verify in asset-service routes that /v1/asset/projects/auc resolves (cannot-verify here).
- **Acceptance:**
  - Page loads live AUC rows against a running gateway (manual).
  - Loader lives in loaders.ts (optional).
- **Needs:** backend  ·  **Effort:** XS <1h  ·  **Risk:** None; do not change the prefix without checking the gateway.

### GAP-ASSETS-PROJECTS-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Opening cost of exactly 0 is rejected: rupeesToMinorString('0') returns null (lib/money.ts:26) so the user sees 'Enter a valid amount' for 0, while leaving the field blank silently records 0 (AucForm.tsx:38-42).
- **Verified evidence:** AucForm.tsx:47-50 rejects a typed '0' because rupeesToMinorString returns null for minor<=0 (lib/money.ts, 'zero or empty amounts' rejected); a blank field returns '0' at :56 and :72 so opening cost 0 is stored silently. Inconsistent, though 0 is a legitimate opening WIP.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/AucForm.tsx`, `apps/web/src/lib/money.ts`
- **Fix steps:**
  1. In validate(), treat blank as valid 0 and also accept an explicit '0'/'0.00' (add an allowZero option to rupeesToMinorString or a small rupeesToMinorStringAllowZero helper next to it).
  2. Keep rejection for negatives and >2 decimals.
  3. Update previewMinor at :97 and the ConfirmDialog text to show ₹0.00 for zero.
- **Acceptance:**
  - Unit test: allowZero('0') -> '0', ('0.00') -> '0', ('-1') -> null, ('1.005') -> null.
  - Typing 0 no longer shows 'Enter a valid amount'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; other callers of rupeesToMinorString must keep zero-rejection (default).

### GAP-ASSETS-PROJECTS-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Amount posted as Number(amountMinor) although it is a paise string; above 2^53 paise (about ₹9e13) precision is lost, contradicting the paise-bigint rule (AucForm.tsx:83).
- **Verified evidence:** AucForm.tsx:79 sends amountMinor: Number(amountMinor ?? '0'), a JS number; above Number.MAX_SAFE_INTEGER (9.007e15 paise, about Rs 9e13) precision is lost. Impact is practically low for AUC values but violates the paise-as-bigint rule. Whether the endpoint accepts a string amountMinor is cannot-verify (asset-service absent); aucMapper/AucRow accepts number|string on read.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/AucForm.tsx`
- **Fix steps:**
  1. Guard: if BigInt(amountMinor) > BigInt(Number.MAX_SAFE_INTEGER) reject in validate() with a clear message (safe, no backend change).
  2. If asset-service zod accepts numeric strings, send the string directly; confirm in enterprise/routes.ts before changing.
  3. Add a comment stating the unit (paise).
- **Acceptance:**
  - Entering 99999999999999999 shows a validation error instead of posting a rounded value.
  - Normal amounts post identical numbers as before.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong contract type would 400 all creates.

### GAP-ASSETS-PROJECTS-05  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Create dialog does not require a reason although creating WIP is an audited mutation; capitalize does require one (AucForm.tsx:163-176 vs AucTable.tsx:118-119).
- **Verified evidence:** The create flow has a <ConfirmDialog> (AucForm.tsx:185-200) but without requireReason, and POST body (:75-80) has no reason field; AucTable.tsx capitalize dialog uses requireReason with 'Reason / authorisation' (:319-320) and posts reason (:242). Audit-event emission server-side is cannot-verify. The claim that create is 'audited' is an assumption; description says it does not post to the GL.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/AucForm.tsx`
- **Fix steps:**
  1. Add requireReason and reasonLabel='Reason / authorisation' to the ConfirmDialog at :185.
  2. Change onConfirm to (reason) => createAuc(reason) and include reason in the POST body (confirm backend accepts it; else send as a header/note field agreed with asset-service).
  3. Verify asset-service emits an audit event for AUC create.
- **Acceptance:**
  - Confirm button disabled until a reason is entered.
  - Request payload contains reason; audit log row exists for create (manual/backend).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; backend zod may reject unknown 'reason' key.

### GAP-ASSETS-PROJECTS-06  ·  LOW  ·  partly  ·  theme STATUS (was OTHER)

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Status pill text is status.replace('_',' ') lowercase ('under construction'); statuses beyond the two filtered ones fall through unhandled (AucTable.tsx:51, page.tsx:24-25).
- **Verified evidence:** AucTable.tsx:257 statusDisplay = status.replace(/_/g,' ') (global, observation says single replace); it is fed to cellType 'status' -> StatusPill (DataTable.tsx:127) which humanizes to 'Under Construction', so the 'lowercase' claim is refuted. True part: StatusPill STATUS_MAP has neither 'under construction' nor 'capitalized', so both render neutral info. Page.tsx:24-25 filters only two statuses, so any other status still counts in 'Tracked Projects' only.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/assets/projects/AucTable.tsx`
- **Fix steps:**
  1. Add 'under construction': 'warn' and 'capitalized': 'good' to STATUS_MAP in StatusPill.tsx.
  2. Pass the raw r.status to the status column (drop the manual replace) so filter text and pill agree.
  3. Decide whether other statuses (e.g. cancelled) exist upstream (cannot-verify) and add tones.
- **Acceptance:**
  - Under-construction row shows warn pill labelled 'Under Construction'; capitalized shows good pill.
  - StatusPill unit test covers both keys.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatusPill is shared, tone additions only affect these keys.

### GAP-ASSETS-PROJECTS-07  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** 'View asset' is a raw anchor to /assets/{id}, full page load (AucTable.tsx:79).
- **Verified evidence:** AucTable.tsx:288 (in file line numbering ~85) renders <a href={`/assets/${row.assetId}`}> for the View asset action, which is a full page load in the App Router.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/AucTable.tsx`
- **Fix steps:**
  1. import Link from 'next/link' and replace the <a> with <Link href=...> keeping aria-label.
- **Acceptance:**
  - Clicking View asset navigates client-side (no full reload, network shows RSC fetch only).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-PROJECTS-08  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** loading.tsx is a single skeleton block that does not match the page layout (loading.tsx:1-3).
- **Verified evidence:** projects/loading.tsx is a single <div className='skeleton'> inside page-main (1 line). The page shape is header + 4 stat cards + form + table, so it does not match. projects/error.tsx exists, and the parent assets/loading.tsx has a fuller skeleton; low severity.
- **Files to change:** `apps/web/src/app/(app)/assets/projects/loading.tsx`
- **Fix steps:**
  1. Rebuild loading.tsx with skeleton blocks for header, a 4-tile StatGrid, a form card and a table (reuse the pattern in assets/loading.tsx or a shared TableSkeleton if one exists in ds).
- **Acceptance:**
  - Throttled network shows a layout-shaped skeleton without content shift when data arrives.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/register  —  `assets/register.html`

- **Source:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Design reference:** `redesign/assets/register.html`

### GAP-ASSETS-REGISTER-01  ·  HIGH  ·  partly  ·  theme ROLEGATE

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Capitalizing an asset posts to the asset register (and downstream GL) with no ConfirmDialog and no reason/authorisation, unlike depreciation, condemnation and AUC capitalize which all require one (page.tsx:22-52,97).
- **Verified evidence:** register/page.tsx:22-52 submit posts /api/proxy/v1/asset/assets directly with no ConfirmDialog and no reason (button :97 is type=submit). Correct that depreciation/AUC capitalize use requireReason (depreciation/page.tsx:72, AucTable.tsx:319). But this page creates an asset master record ('manual capitalization', :60), not a GL posting from the page; whether the asset-service posts to GL on create is cannot-verify. No role guard is present client-side.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Wrap submit in useConfirmAction/ConfirmDialog (as verification/page.tsx:233) with requireReason, summarising name, code and cost via formatMoney.
  2. Include reason in POST body if backend accepts it; confirm audit event server-side.
  3. Gate the route/button by role with the shared guard if one exists (server must enforce).
- **Acceptance:**
  - Submit opens confirm dialog; confirm disabled until reason entered.
  - Cancel leaves no request in network tab.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; registering assets with wrong cost is hard to reverse, so confirm summary should show amounts in words/format.
- **Depends on:** GAP-ASSETS-REGISTER-05

### GAP-ASSETS-REGISTER-02  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Every asset is created under a hard-coded categoryId 77777777-0001-0000-0000-000000000001, so depreciation class, useful life and GL mapping cannot be chosen; the user is never told (page.tsx:7,35).
- **Verified evidence:** register/page.tsx:7 DEFAULT_CATEGORY = '77777777-0001-0000-0000-000000000001' and :35 sends it as categoryId for every asset; no category field exists in the form (:69-96) and the user is not told. Whether that UUID is a seeded category in asset-service cannot be verified; depreciation class, life and GL mapping derive from category.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Fetch categories from the asset categories endpoint (name/verify path in asset-service; cannot-verify) via /api/proxy/v1/asset/categories.
  2. Add a required Category <select> (or EntityPicker if present) showing name, default life and GL account; drop DEFAULT_CATEGORY.
  3. If no categories endpoint exists, disable the page and show 'Category setup required' rather than posting a magic id.
- **Acceptance:**
  - Form cannot submit without choosing a category; payload categoryId equals the selected id.
  - No hard-coded UUID remains in register/page.tsx.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; misclassified assets get wrong depreciation and GL mapping.

### GAP-ASSETS-REGISTER-03  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Blank asset code is auto-filled client-side as AST/{year}/{Math.random()*9000+1000}: collision-prone, not a sequence, and it is not the 'auto-generated' server numbering the placeholder implies (page.tsx:34,76).
- **Verified evidence:** register/page.tsx:34 sends code = form.code || `AST/${year}/${Math.floor(Math.random()*9000+1000)}`; only 9000 values per year so collisions are likely, and the placeholder 'Auto-generated if blank' (:76) implies server numbering. Whether the backend rejects duplicate codes or can generate one is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Stop generating the code client-side: send code undefined when blank and let asset-service allocate from a sequence (backend change if not supported).
  2. If the backend requires a code, make the field required and remove the placeholder claim.
  3. Surface a duplicate-code error using toHumanError.
- **Acceptance:**
  - Blank code creates asset with server-issued code; two rapid creates never collide.
  - No Math.random in the file.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium; duplicate asset codes corrupt the register.

### GAP-ASSETS-REGISTER-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Failure shows raw response text (JSON, status detail) via Error(await res.text()); isError is set but never styles the banner, so success and failure look alike (page.tsx:43,46-48,64-66).
- **Verified evidence:** register/page.tsx:43 throws Error(await res.text()) and :48 displays e.message, i.e. raw response JSON. isError is set (:47,26) but the banner at :65 ignores it (same neutral panel style), so failure looks like success. (Other pages, e.g. maintenance/new, use formError.fromResponse.)
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Use useFormError().fromResponse(res,'save') as in maintenance/new/page.tsx:64 instead of res.text().
  2. Style the banner by isError (role='alert', bad tone) vs success.
  3. Use res.json() body only for id.
- **Acceptance:**
  - A 400 shows a human message, styled as an error, with no JSON.
  - Success still shows 'Asset registered.' in good tone.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-REGISTER-05  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Cost uses Math.round(Number(x)*100) on a float: 1.005 and very large rupee values round wrongly, and the app already has rupeesToMinorString for exactly this (page.tsx:28; lib/money.ts:28).
- **Verified evidence:** register/page.tsx:28 costMinor = Math.round(Number(form.acquisitionCost||'0')*100) and sent as number (:37); the input is type=number (:90). 1.005 rounds to 100 or 101 depending on float; large values lose precision. lib/money.ts rupeesToMinorString exists and rejects >2 decimals but also rejects zero.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Make the input type=text inputMode=decimal and call rupeesToMinorString(form.acquisitionCost); show field error on null.
  2. Send acquisitionCost as Number only after asserting <= MAX_SAFE_INTEGER (or string if backend accepts; cannot-verify).
  3. Decide whether zero cost is allowed (donated assets) and use allowZero helper from PROJECTS-03 if so.
- **Acceptance:**
  - Unit test: '1.005' rejected, '150.50' -> 15050.
  - Payload for 150.50 has acquisitionCost 15050.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Money; test boundary values.
- **Depends on:** GAP-ASSETS-PROJECTS-03

### GAP-ASSETS-REGISTER-06  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** acquisitionDate is always today; a department capitalizing older assets cannot backdate, and no date field is offered (page.tsx:38).
- **Verified evidence:** register/page.tsx:38 acquisitionDate: new Date().toISOString().slice(0,10) (UTC date; after 18:30 IST it is the previous day) and no date field exists in the form.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Add a required Acquisition date <input type=date> defaulting to today in IST, max=today.
  2. Compute default via an IST helper in lib/formatters (or Intl with Asia/Kolkata) rather than toISOString.
  3. Send the chosen date.
- **Acceptance:**
  - Backdated date is posted as chosen.
  - At 23:00 IST the default is today's IST date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; backdating affects depreciation start, backend should validate.

### GAP-ASSETS-REGISTER-07  ·  LOW  ·  partly  ·  theme VALIDATION

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Double-submit window: busy disables the button but the redirect timer (600 ms) can fire after a manual navigation (page.tsx:45).
- **Verified evidence:** Not quite as stated: setBusy(false) runs in finally (:50) right after success, then the redirect fires after 600ms (:45), so the submit button is re-enabled during that window and a second click creates a duplicate asset (with a fresh random code, defeating any duplicate check). Timer is also never cleared on unmount/manual navigation, but that only causes a redundant push.
- **Files to change:** `apps/web/src/app/(app)/assets/register/page.tsx`
- **Fix steps:**
  1. Add a 'done' state; keep button disabled after success until navigation.
  2. Use router.push immediately (drop setTimeout) or store timer id and clear in useEffect cleanup.
  3. Send an Idempotency-Key header if gateway supports it (cannot-verify).
- **Acceptance:**
  - After success the button stays disabled.
  - Double-click creates one asset.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-REGISTER-03


---
## /assets/scan  —  `assets/scan.html`

- **Source:** `apps/web/src/app/(app)/assets/scan/page.tsx`
- **Design reference:** `redesign/assets/scan.html`

### GAP-ASSETS-SCAN-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Page is titled 'Field verification' yet the lookup is read-only: nothing is recorded against a verification session, so a scan leaves no audit evidence and does not link to /assets/verification (page.tsx:47,33-35).
- **Verified evidence:** scan/page.tsx:135 issues a GET /api/proxy/v1/asset/scan/{barcode} lookup only; subtitle 'Field verification' (:149) but no POST or verification session linkage, and no link to /assets/verification. Backend scan endpoint side effects cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/assets/scan/page.tsx`, `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Rename subtitle to 'Look up an asset by tag' unless verification is wired.
  2. Add a link to /assets/verification in the header actions.
  3. Longer term: allow choosing an open verification session and POST a scan record (needs backend endpoint; cannot-verify).
- **Acceptance:**
  - Scan page links to verification sessions.
  - Subtitle matches actual behaviour.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low for copy; audit-recording scope needs product decision.

### GAP-ASSETS-SCAN-02  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** All failures (401, 403, 500, offline) collapse to 'Asset not found', misleading a field officer into thinking the tag is invalid (page.tsx:34).
- **Verified evidence:** scan/page.tsx:136 throws Error('Asset not found') for every !res.ok (401/403/500 included) and :139 shows it. Network failure (offline) rejects fetch with TypeError, and the catch (:138-139) shows the browser's raw message ('Failed to fetch'), not 'Asset not found'. So the claim about offline is wrong; the HTTP-status collapse is right.
- **Files to change:** `apps/web/src/app/(app)/assets/scan/page.tsx`
- **Fix steps:**
  1. Branch on res.status: 404 -> 'No asset with this tag'; 401/403 -> access message; others -> toHumanError('load',{area:'asset'}).
  2. In catch use toHumanError for network errors.
  3. Style as error (role=alert).
- **Acceptance:**
  - Mocked 500 shows a retryable load error, not 'not found'.
  - 404 shows not found.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ASSETS-SCAN-03  ·  MEDIUM  ·  partly  ·  theme COPY (was PII)

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Camera scanning is unavailable, so 'Barcode Scan' on a phone is a typing field; the copy admits this but the header and hub label promise scanning (page.tsx:47,63-65).
- **Verified evidence:** Title is 'Barcode Scan' (scan/page.tsx:148) and hub label 'Barcode Scan / Mobile field verification' (assets/page.tsx:19), while the input is a text field with copy at :166 stating camera capture is unavailable. So the claim holds as a copy mismatch. Theme PII is wrong; nothing is masked here.
- **Files to change:** `apps/web/src/app/(app)/assets/scan/page.tsx`, `apps/web/src/app/(app)/assets/assets/page.tsx`
- **Fix steps:**
  1. Rename title/hub label to 'Asset Lookup' (or 'Scan or enter tag'), note field-verification wording per SCAN-01.
  2. Optionally implement camera via BarcodeDetector later (separate feature).
- **Acceptance:**
  - Title and hub label no longer promise camera scanning.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ASSETS-SCAN-01

### GAP-ASSETS-SCAN-04  ·  MEDIUM  ·  partly  ·  theme MONEY

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Status printed raw (e.g. 'active') and book value depends on bookValue being paise; ScanResult types it as number with no unit comment, risking a 100x error (page.tsx:12-13,80-81).
- **Verified evidence:** Status is printed raw at scan/page.tsx:182 ('active'), not passed through StatusPill/humanizeStatus. bookValue typed number at :115 with formatMoney(result.bookValue) (:183); formatMoney treats numbers as paise (formatters.ts:90-100) and rounds, so the unit assumption is undocumented and the /scan endpoint's unit is cannot-verify (asset-service absent). Risk is real only if the API returns rupees.
- **Files to change:** `apps/web/src/app/(app)/assets/scan/page.tsx`
- **Fix steps:**
  1. Render status with <StatusPill status={result.status}/>.
  2. Add a comment on ScanResult.bookValue: 'paise' after checking asset-service scan route; if rupees use formatRupees.
- **Acceptance:**
  - Status shows as 'Active' pill.
  - Book value of a known asset matches the asset detail page.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Money display; verify unit against detail page.

### GAP-ASSETS-SCAN-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** 'Open asset' is a raw anchor with full page load, not a client Link (page.tsx:82); error banner has no error styling and the input keeps stale text after a result (page.tsx:72).
- **Verified evidence:** scan/page.tsx:184 (file line 82) uses <a className='btn ghost' href=/assets/{id}> (full reload). Error banner :174 has no error tone/role=alert (parent has role=status though). The barcode input is never cleared after a result (setBarcode not called), which is arguably intended for hardware scanners but forces manual clearing.
- **Files to change:** `apps/web/src/app/(app)/assets/scan/page.tsx`
- **Fix steps:**
  1. Use next/link for Open asset.
  2. Style error banner with bad tone; role=alert.
  3. After successful lookup select input text (onFocus select) or clear barcode and refocus for the next scan.
- **Acceptance:**
  - Open asset navigates client-side.
  - After a scan the field is ready for the next tag.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /assets/verification  —  `assets/verification.html`

- **Source:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Design reference:** `redesign/assets/verification.html`

### GAP-ASSETS-VERIFICATION-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Location is hard-coded to 'HQ Block' in the POST body with no field to change it, so every session for a multi-site department is recorded against HQ (page.tsx:49).
- **Verified evidence:** verification/page.tsx:240 posts location: 'HQ Block' hard-coded; the confirm dialog (:299-309) only asks for notes (reason falls back to 'Annual physical verification' at :241). No location input.
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Add a Location field to the ConfirmDialog (or a small form) sourced from the locations endpoint used by assets/locations (check that page); make it required.
  2. Send the chosen location; remove the literal.
  3. Drop the default-notes fallback because requireReason already forces input.
- **Acceptance:**
  - Session created with the selected location.
  - No 'HQ Block' in the file.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium; wrong site on audit sessions.

### GAP-ASSETS-VERIFICATION-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Sessions are not actionable: the table has no row link, count of assets verified, or way to record results, although the subtitle promises barcode-driven audit and write-off (page.tsx:95-104).
- **Verified evidence:** Table (verification/page.tsx:286-295) has 4 columns, no rowLinkKey, no asset count or results; there is no /assets/verification/[id] route (only page.tsx in dir). Subtitle at :265 promises barcode-driven audit and write-off. Verification result endpoints are cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. If the API has a session detail endpoint, add verification/[id]/page.tsx and rowLinkKey='id' with rowLinkPrefix.
  2. Add verified/total counts columns if returned.
  3. Otherwise reword the subtitle to what exists.
- **Acceptance:**
  - Row click opens a session detail (or subtitle no longer overpromises).
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Scope: new session workflow.
- **Depends on:** GAP-ASSETS-SCAN-01

### GAP-ASSETS-VERIFICATION-03  ·  MEDIUM  ·  partly  ·  theme COPY (was UUID)

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Session column shows the first 8 chars of the raw UUID, and Status is printed as the raw enum (e.g. in_progress) (page.tsx:64,67).
- **Verified evidence:** Session column shows r.id.slice(0,8) (verification/page.tsx:64 actual :255) of a UUID: confirmed. Status is passed raw to cellType 'status' -> StatusPill, which humanizes ('In Progress'); so 'raw enum' is refuted, only the UUID fragment is real.
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Use a session reference/number if API provides one; else label column 'Session ID' and keep short id with title attribute.
  2. Add 'in progress'/'planned' to StatusPill STATUS_MAP if missing (in progress exists).
- **Acceptance:**
  - Session column shows a human reference or clearly labelled short id.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-VERIFICATION-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Verification date is always today (new Date().toISOString() is UTC, so late-evening IST sessions can record the previous day) with no date input (page.tsx:48).
- **Verified evidence:** verification/page.tsx:239 verificationDate: new Date().toISOString().slice(0,10) is the UTC date; between 00:00 and 05:30 IST it records the previous day. No date input.
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Add a date input defaulting to today in Asia/Kolkata (helper shared with REGISTER-06).
  2. Send that value.
- **Acceptance:**
  - At 01:00 IST default date is today IST.
  - User can change date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-ASSETS-REGISTER-06

### GAP-ASSETS-VERIFICATION-05  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Subtitle mentions GFR write-off, but write-off lives in /assets/condemnation; no link between them. Page fetches only the latest 50 sessions with no pagination (page.tsx:20,74).
- **Verified evidence:** Subtitle (verification/page.tsx:265) mentions GFR write-off; write-off lives in assets/condemnation (dir exists with CondemnationWorkflow.tsx) and no link is present. Fetch uses ?limit=50 (:211), no pagination or next-page control though DataTable is used without pageSize.
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Add a link to /assets/condemnation in the subtitle/actions.
  2. Add pageSize to DataTable and a 'Showing latest 50' note or cursor pagination if API supports it.
- **Acceptance:**
  - Link navigates to condemnation.
  - More than 50 sessions are reachable or the limit is stated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-ASSETS-VERIFICATION-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** Loading uses an EmptyState with a clock emoji instead of a skeleton, and there is no loading.tsx (page.tsx:83-84).
- **Verified evidence:** verification/page.tsx:274-275 shows EmptyState with the hourglass emoji while loading; verification/ has no loading.tsx (client page fetching in useEffect, so loading.tsx would not cover it; parent assets/loading.tsx exists).
- **Files to change:** `apps/web/src/app/(app)/assets/verification/page.tsx`
- **Fix steps:**
  1. Replace the loading EmptyState with the shared skeleton/TableSkeleton (or the skeleton class used in projects/loading.tsx).
- **Acceptance:**
  - During load a table skeleton is shown; no emoji.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-ASSETS-DETAIL-10  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** asset-service missing from snapshot: transfer/dispose maker-checker, impairment ceilings and GL posting rules undeterminable; the component header cites services/asset-service/src/modules/enterprise/routes.ts (AssetFinancialActions.tsx:4).
- **Service:** `asset-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/asset/assets/{id}/transfer', 'POST /api/proxy/v1/asset/assets/{id}/request-disposal', 'POST /api/proxy/v1/asset/assets/{id}/dispose', 'POST /api/proxy/v1/asset/assets/{id}/inter-org-transfer', 'POST /api/proxy/v1/assets/disposals/{id}/submit-approval']`
- **Question:** Do transfer and dispose enforce maker-checker (requester cannot approve), impairment ceilings (<= carrying value) and GL posting on disposal?
- **How to verify:** Open services/asset-service/src/modules/enterprise/routes.ts (cited at AssetFinancialActions.tsx:4); check role guards on dispose vs request-disposal, requester!=approver rule, impairment amount validation, and gl.post emit. curl dispose as the same user who requested disposal.
- **Test to add:** Given user U requested disposal of asset A; when U calls POST /dispose on A; then 403 (maker-checker) and no GL event; when impairment > carrying value then 422.
- **Impact if wrong:** Fraudulent single-person disposal of public assets; overstated impairment; missing GL entries.
- **Web change if wrong:** Hide/disable Dispose for requester; note web also mixes /v1/asset and /v1/assets prefixes (page.tsx:135) - align to service prefix.

### GAP-ASSETS-BULK-IMPORT-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** Mass creation in a GL-linked register has no reason field, unlike depreciation run; confirm dialog is plain (page.tsx:75-83). Audit-on-mutation is server-side and undeterminable (asset-service absent).
- **Service:** `asset-service`  ·  **Endpoint(s):** `POST /api/v1/asset/bulk/import`
- **Question:** Does bulk import require a reason/idempotency key, emit one audit event per batch (with row count and actor), and enforce maker-checker or role for GL-linked creation?
- **How to verify:** Open asset-service bulk import route; POST the same file twice with the same Idempotency-Key expecting no duplicates; check audit store and role guard.
- **Test to add:** Given a 50-row CSV, when imported twice with the same key, then 50 assets exist and one audit event {actor,count} is recorded.
- **Impact if wrong:** Duplicate or unaudited asset creation corrupting the asset register and GL.
- **Web change if wrong:** Add a mandatory reason field and Idempotency-Key header in assets/bulk-import/page.tsx.

### GAP-ASSETS-CONDEMNATION-08  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** asset-service condemnation module not in snapshot; the header comment cites services/asset-service/src/modules/condemnation/routes.ts — maker-checker and version rules undeterminable here.
- **Service:** `asset-service`  ·  **Endpoint(s):** `asset-service condemnation module command endpoints (modules/condemnation/routes.ts)`
- **Question:** Do condemnation commands enforce maker-checker (survey vs approve by different users) and optimistic-version checks returning 409 on stale version?
- **How to verify:** Open services/asset-service/src/modules/condemnation/routes.ts; call approve with the creator's JWT expecting 403 and with a stale version expecting 409.
- **Test to add:** Given a survey by user A, when A records approval, then 403; when version is stale, then 409.
- **Impact if wrong:** Asset disposal approved without segregation of duties; lost updates.
- **Web change if wrong:** Send version on each command and handle 409 with a reload prompt in condemnation forms.

### GAP-ASSETS-DASHBOARD-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** asset-service backend not in snapshot (services/ has hrms-service only): dashboard aggregation semantics for taggedAssets/dueForDisposal are undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `GET /api/v1/asset/dashboard`
- **Question:** How are taggedAssets and dueForDisposal computed (status filter, date basis, tenant scope, excluding disposed)?
- **How to verify:** Open the asset-service dashboard handler/query; compare counts against a seeded dataset.
- **Test to add:** Given 10 assets (3 disposed, 2 past useful life), when GET dashboard, then taggedAssets=7 and dueForDisposal=2.
- **Impact if wrong:** Dashboard KPIs misreport register size and disposal backlog.
- **Web change if wrong:** Adjust card labels/tooltips in assets/dashboard/page.tsx to match the definition.

### GAP-ASSETS-DEPRECIATION-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** asset-service and finance.gl.post consumer absent from snapshot: idempotency, book-level locking and reversal rules are undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/asset/depreciation/run (gateway /api/v1/asset/depreciation/run)', 'event finance.gl.post (queue)']`
- **Question:** Is depreciation run idempotent per (book, period), locked against concurrent runs, and is a reversal path defined for a posted run?
- **How to verify:** Open asset-service depreciation module handler for POST /depreciation/run; check unique key (book_id, period), advisory/row lock, and the finance.gl.post outbox emit; in finance-service check consumer dedupes on event id. Call run twice for same period and compare.
- **Test to add:** Given a run posted for book B period 2026-08; when POST /depreciation/run is repeated for the same book/period concurrently; then exactly one journal is posted, second returns 409 or the same run id, and a reversal endpoint produces a contra journal.
- **Impact if wrong:** Double depreciation posted to GL; misstated asset register and financial statements.
- **Web change if wrong:** Surface 409/already-run message on the run button and disable while pending; add reversal action if service exposes one.

### GAP-ASSETS-FIXED-ASSETS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1800 (merged)
- **First-pass claim:** asset-service not in snapshot: list cap and sort order undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/asset/assets?type=fixed']`
- **Question:** Does the list endpoint apply a maximum page size and deterministic default sort, and is the type=fixed filter honoured?
- **How to verify:** Open asset-service assets list handler; check limit default/max, ORDER BY, type filter. curl '/assets?type=fixed' with >500 seeded rows and inspect count and order.
- **Test to add:** Given 600 fixed assets; when GET /assets?type=fixed; then response is capped at documented max with stable order (asset_code asc) and returns pagination meta/next cursor.
- **Impact if wrong:** Silent truncation shows an incomplete register; audit/reporting mismatch.
- **Web change if wrong:** Add server pagination (page/limit) and total count to loader and page; show 'showing N of M'.

### GAP-ASSETS-FLEET-DEVICES-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** asset-service fleet-devices module not in snapshot (header comment cites it): telemetry consumer status undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/fleet/devices']`
- **Question:** Does the fleet-devices module exist under this prefix and expose telemetry-consumer status (last-seen, connected) fields the page infers?
- **How to verify:** Open asset-service src/modules/fleet-devices routes; confirm GET /fleet/devices path, response fields (lastSeenAt, status) and that the telemetry consumer updates them. curl through gateway with fleet role.
- **Test to add:** Given a device with no telemetry for 24h; when GET /fleet/devices; then status = 'offline' and lastSeenAt is populated.
- **Impact if wrong:** Stale or fabricated device status; fleet ops decisions on wrong data.
- **Web change if wrong:** Rename fields in the page mapper to match payload; fix prefix if /asset (singular).

### GAP-ASSETS-FLEET-MAINTENANCE-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** asset-service fleet module not in snapshot; scheduling semantics undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/fleet/maintenance']`
- **Question:** Do fleet maintenance schedules return next-due date/odometer semantics (date OR km, whichever first) as the page infers?
- **How to verify:** Open asset-service fleet maintenance handler and schema; check dueDate, dueOdometer, status enum, and overdue computation. Seed schedule and GET.
- **Test to add:** Given a schedule due 2026-09-01 or 10000 km; when km exceeded before date; then status='due' and row sorted first.
- **Impact if wrong:** Missed vehicle servicing; safety and warranty risk.
- **Web change if wrong:** Adjust columns/status mapping in page.tsx to actual field names.

### GAP-ASSETS-FLEET-VEHICLES-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1803 (merged)
- **First-pass claim:** asset-service fleet module not in snapshot; register/GPS response shapes and RBAC undeterminable (only inferred in component comments).
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/fleet/vehicles', 'GPS/register endpoints (unnamed in page)']`
- **Question:** What are the register and GPS response shapes and which roles may read vehicles and GPS positions?
- **How to verify:** Open asset-service fleet vehicles routes; list preHandler roles, response DTO. curl as reader and as fleet_admin; compare fields to VehicleRow in the page.
- **Test to add:** Given role 'reader'; when GET /fleet/vehicles/{id}/gps; then 403; fleet_officer gets lat/lng/timestamp.
- **Impact if wrong:** Location data of officials' vehicles exposed to all users (privacy/DPDP).
- **Web change if wrong:** Align VehicleRow type with DTO; gate GPS panel by role.

### GAP-ASSETS-INSURANCE-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1785 (merged)
- **First-pass claim:** Route prefix disagrees with the rest of the module: insurance and fleet call /api/v1/assets/… (plural) while dashboard, register, detail, depreciation call /api/v1/asset/… (singular) (page.tsx:80,88 vs loaders.ts assets section). At most one prefix is right; gateway mapping is undeterminable (asset-service absent).
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/insurance/policies', 'GET /api/v1/assets/assets', 'GET /api/v1/assets/fleet/*', 'vs GET /api/v1/asset/*']`
- **Question:** Which gateway prefix routes to asset-service: /api/v1/asset, /api/v1/assets, or both?
- **How to verify:** Open gateway route catalogue / asset-service route registration (fastify prefix); curl both /api/v1/asset/assets and /api/v1/assets/assets with a valid token and compare status.
- **Test to add:** Given a valid token; when GET /api/v1/assets/assets and /api/v1/asset/assets; then both return 200 identical or the wrong one returns 404 (test pins the canonical prefix).
- **Impact if wrong:** Insurance and fleet pages empty in production (404 silently swallowed to empty list).
- **Web change if wrong:** Change all /api/v1/assets/... calls in insurance, claims, insurance/[id], fleet/* to the canonical prefix (likely /api/v1/asset). Note projects/page.tsx:12 asserts both are registered - verify.

### GAP-ASSETS-INSURANCE-DETAIL-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** asset-service insurance module absent from snapshot; claim filtering by policyId is undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/assets/insurance/claims?policyId={id}', 'GET /api/v1/assets/insurance/policies/{id}']`
- **Question:** Does the claims list honour the policyId query filter server-side (and reject unknown policy for tenant)?
- **How to verify:** Open claims list handler in insurance module; confirm policyId in zod query schema and WHERE clause. curl with policyId of policy A and verify no claims of policy B.
- **Test to add:** Given claims for policies A and B; when GET claims?policyId=A; then only A's claims returned; unknown filter param does not return everything.
- **Impact if wrong:** Policy page shows other policies' claims; wrong exposure figures.
- **Web change if wrong:** Add client-side filter fallback by row.policyId; or change query param name.

### GAP-ASSETS-INSURANCE-CLAIMS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1809 (merged)
- **First-pass claim:** asset-service CLAIM_EXCEEDS_COVERAGE rule referenced only in a comment (ClaimForm.tsx:78-79); server behaviour undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['POST /api/v1/assets/insurance/claims', 'GET /api/v1/assets/insurance/claims?limit=200']`
- **Question:** Does POST claims reject with CLAIM_EXCEEDS_COVERAGE when claimed amount exceeds remaining sum insured, using this exact error code and a 422/409 status?
- **How to verify:** Open asset-service insurance module claim create handler; grep CLAIM_EXCEEDS_COVERAGE; verify remaining coverage = sumInsured - approved claims. POST claim above cover.
- **Test to add:** Given policy sumInsured 100000 with 80000 claimed; when POST claim 30000; then 422 {code:'CLAIM_EXCEEDS_COVERAGE'}.
- **Impact if wrong:** Over-claims accepted against a policy; financial leakage.
- **Web change if wrong:** Map error code in ClaimForm.tsx (lines 78-79) to a field message; if code differs update the string.

### GAP-ASSETS-LEASES-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** “IFRS 16” is used in the page title, message and hub tile although a Government of Odisha department follows Ind AS/GFR accounting; wording undeterminable against policy (page.tsx:101,69).
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/asset/leases']`
- **Question:** Which lease accounting standard (Ind AS 116 / GFR) does the leases module implement, and is IFRS 16 wording acceptable to the department's accounting policy?
- **How to verify:** Ask finance/accounting owner for the policy; open asset-service leases module for standard-specific fields (ROU asset, lease liability) and naming.
- **Test to add:** Given department edition=govt; when GET leases UI copy is rendered; then no string contains 'IFRS 16' (snapshot test on page and hub tile).
- **Impact if wrong:** Non-compliant terminology in a government audit; confusion with Ind AS 116/GFR.
- **Web change if wrong:** Replace 'IFRS 16' with 'Ind AS 116' (or policy term) in page.tsx:69,101 and the assets hub tile.

### GAP-ASSETS-LEASES-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** asset-service leases module absent from snapshot; ROU/liability posting and amortisation schedule undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/asset/leases']`
- **Question:** On lease creation does the service post ROU asset and lease liability and generate an amortisation schedule with correct discounting?
- **How to verify:** Open asset-service leases handler; find schedule generation and gl.post emit; POST a 12-month lease and inspect schedule rows and outbox events.
- **Test to add:** Given lease 12 x 10000 at 8% IBR; when created; then liability = PV of payments, 12 schedule rows sum to total interest+principal, one ROU/liability journal emitted.
- **Impact if wrong:** Incorrect lease liabilities in financials.
- **Web change if wrong:** none

### GAP-ASSETS-LIST-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** asset-service not in snapshot: list pagination and default page size are undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/asset/assets']`
- **Question:** What is the default and maximum page size of GET /assets and does it return pagination metadata?
- **How to verify:** Open asset-service assets list handler and query schema; curl with no limit and limit=10000.
- **Test to add:** Given 500 assets; when GET /assets without limit; then response length equals documented default and meta.total=500; limit>max is clamped or 400.
- **Impact if wrong:** Silent truncation of asset list.
- **Web change if wrong:** Send explicit page/limit and render pager from meta.total.

### GAP-ASSETS-LOCATIONS-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** asset-service locations module absent from snapshot; uniqueness and tenant scoping undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/asset/locations']`
- **Question:** Are location codes unique per tenant and are reads/writes scoped by tenant from the JWT?
- **How to verify:** Open locations module repo and migration for unique(tenant_id, code) and tenant filter in queries; POST duplicate code, and GET as another tenant.
- **Test to add:** Given location L1 in tenant T1; when T1 POSTs L1 again then 409; when T2 GETs locations then L1 absent.
- **Impact if wrong:** Cross-tenant data leak or duplicate locations corrupting asset placement.
- **Web change if wrong:** Show 409 duplicate message on create form.

### GAP-ASSETS-MAINTENANCE-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1808 (merged)
- **First-pass claim:** Sibling detail page reads /maintenance history per asset; queue and history use different endpoints (/asset/maintenance vs /asset/assets/{id}/maintenance) — consistency undeterminable without asset-service.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/asset/maintenance', 'GET /api/v1/asset/assets/{id}/maintenance', 'POST /api/proxy/v1/asset/work-orders']`
- **Question:** Do the queue endpoint and per-asset history return the same records/shape (same table, same status enum)?
- **How to verify:** Open asset-service maintenance routes; confirm both handlers query the same repo and share DTO; create a WO and GET both.
- **Test to add:** Given a new work order for asset A; when GET /maintenance and GET /assets/A/maintenance; then the order appears in both with identical status and dates.
- **Impact if wrong:** Queue and asset history disagree; maintenance backlog misreported.
- **Web change if wrong:** Normalise both loaders to a shared mapper (loaders.ts:3822,3856).

### GAP-ASSETS-MAINTENANCE-NEW-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** asset-service work-orders module absent from snapshot; audit logging, 202 handling (page.tsx:64) and duplicate-order rules undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/asset/work-orders']`
- **Question:** Does work-order creation write an audit record, return 202 vs 201 as page.tsx:64 assumes, and reject duplicate open orders for the same asset and type?
- **How to verify:** Open work-orders route; check status code returned, audit insert (audit_log/emit), duplicate guard. POST twice with same payload.
- **Test to add:** Given open WO for asset A type 'repair'; when POST identical WO; then 409 and one audit entry exists for the first.
- **Impact if wrong:** Duplicate work orders, no audit trail on maintenance spend.
- **Web change if wrong:** Handle 202 vs 201 and 409 in page.tsx:64.

### GAP-ASSETS-PROJECTS-09  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** asset-service enterprise routes absent from snapshot; capitalize GL posting, dual-book start date and audit trail undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/v1/asset/projects/auc', 'capitalize action (enterprise routes)']`
- **Question:** Does capitalising an AUC project post the GL entry, honour dual-book start date and write an audit event, and is it maker-checker gated?
- **How to verify:** Open services/asset-service/src/modules/enterprise/routes.ts capitalize handler; check gl.post emit, book start date validation, audit insert, role guard.
- **Test to add:** Given AUC project with 500000 accumulated; when capitalize by non-approver then 403; by approver then one journal and audit row, project status='capitalized', second call 409.
- **Impact if wrong:** Wrong capitalisation date/amount and unaudited capital postings.
- **Web change if wrong:** Disable capitalize for non-approver roles; show 409.

### GAP-ASSETS-REGISTER-08  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** asset-service asset create validation, audit logging and duplicate-code rules undeterminable (services/asset-service absent from snapshot).
- **Service:** `asset-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/asset/assets']`
- **Question:** Does asset create validate required fields and enums, reject duplicate asset codes per tenant, and write an audit record?
- **How to verify:** Open asset create handler and schema; POST missing fields, invalid category enum and duplicate code.
- **Test to add:** Given asset code A-001 exists; when POST same code then 409; invalid category then 422 with field errors; audit row written on success.
- **Impact if wrong:** Duplicate/invalid assets in the register; no trail.
- **Web change if wrong:** Map 409/422 field errors onto the register form.

### GAP-ASSETS-SCAN-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1838 (merged)
- **First-pass claim:** asset-service scan route absent from snapshot; barcode uniqueness, tenancy scoping and scan logging undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET /api/proxy/v1/asset/scan/{barcode}']`
- **Question:** Is barcode unique per tenant, is lookup tenant-scoped, and is each scan logged?
- **How to verify:** Open scan route; check unique(tenant_id, barcode), WHERE tenant, and scan-log insert. Scan barcode of another tenant.
- **Test to add:** Given barcode X in tenant T1; when T2 scans X then 404; when T1 scans then 200 and a scan_log row.
- **Impact if wrong:** Cross-tenant asset disclosure; no physical-verification evidence.
- **Web change if wrong:** none

### GAP-ASSETS-VERIFICATION-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** — PR #1815 (merged)
- **First-pass claim:** asset-service verifications module absent from snapshot; session lifecycle, audit logging and role gating undeterminable.
- **Service:** `asset-service`  ·  **Endpoint(s):** `['GET/POST /api/proxy/v1/asset/verifications']`
- **Question:** Who may open/close verification sessions, is lifecycle (open->closed) enforced and are transitions audited?
- **How to verify:** Open verifications routes; check role guards, status transitions and audit insert. Close a closed session; call as reader.
- **Test to add:** Given a closed session; when POST verification on it then 409; reader role POST then 403.
- **Impact if wrong:** Tampering with completed physical verification records.
- **Web change if wrong:** Hide start/close actions from non-verifier roles.


---
## Cannot verify from the snapshot

### GAP-ASSETS-FLEET-DEVICES-02 · /assets/fleet/devices
- [x] **Status** — PR #1845 (merged): REFUTED: DB-backed endpoint
- **First-pass claim:** The list endpoint is a stub: the page header comment says the route “always returns { data: [] }” (page.tsx:6-11), so a registered record can never appear in the table and the empty state is the permanent live state.
- **Why cannot-verify:** The only evidence is the page's own header comment (fleet/devices/page.tsx:7-14) claiming services/asset-service/src/modules/fleet-devices/routes.ts 'always returns { data: [], meta: { total: 0 } }'. asset-service is not in the snapshot (services/ contains only hrms-service), so the stub cannot be confirmed or refuted. The web side is consistent: getDevices (l.62-67) and mapDevices (l.37-60) would render rows if returned; the comment itself says 'see BACKEND FOLLOW-UPS'.

### GAP-ASSETS-FLEET-MAINTENANCE-01 · /assets/fleet/maintenance
- [x] **Status** — PR #1845 (merged): REFUTED: DB-backed endpoint (costMinor serialised explicitly as hardening)
- **First-pass claim:** The list endpoint is a stub: the page header comment says the route “always returns { data: [] }” (page.tsx:6-11), so a registered record can never appear in the table and the empty state is the permanent live state.
- **Why cannot-verify:** apps/web/src/app/(app)/assets/fleet/maintenance/page.tsx:6-11 header comment does say the route 'currently always returns { data: [] }', and the page fetches GET /api/v1/assets/fleet/maintenance (page.tsx:60-64) with mapMaintenance (page.tsx:35-58) that would render real rows. services/asset-service is not in the snapshot (only services/hrms-service), so whether the route is still a stub cannot be checked. Not a dead link/route on the web side.

### GAP-ASSETS-FLEET-VEHICLES-02 · /assets/fleet/vehicles
- [x] **Status** — PR #1845 (merged): REFUTED: DB-backed endpoint
- **First-pass claim:** The list endpoint is a stub: the page header comment says the route “always returns { data: [] }” (page.tsx:6-11), so a registered record can never appear in the table and the empty state is the permanent live state.
- **Why cannot-verify:** apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:6-11 comment says the route 'currently always returns { data: [] }'. Web mapping (apps/web/src/app/(app)/assets/fleet/vehicles/page.tsx:33-55) is ready for real rows. asset-service source is not in the snapshot so the stub claim cannot be confirmed. Dup of FLEET-MAINTENANCE-01 for vehicles.


---
## Refuted by deep pass — do NOT implement

### GAP-ASSETS-DETAIL-09 · /assets/[id]
- **First-pass claim:** Custodian (assignedTo) prints a person name/id with no DPDP role gate (page.tsx:70).
- **Why refuted:** page.tsx:70 renders asset.assignedTo, but mapAssetDetail (apiMappers.ts:856-869) and mapAssetSummaries never set assignedTo (nor department, used at page.tsx:132), so the Custodian field always shows '—' at present. There is thus no PII exposure today; the real issue is the field is unwired. If it is wired later, an employee name is ordinary internal directory data and DPDP masking is not clearly required for a custodian; policy is a decision.
