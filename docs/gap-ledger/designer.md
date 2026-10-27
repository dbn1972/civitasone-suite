# Detailed gap file — module `designer`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 68, BACKEND-VERIFY 2, REFUTED 2



---
## /designer  —  `designer/home.html`

- **Source:** `apps/web/src/app/(app)/designer/page.tsx`
- **Design reference:** `redesign/designer/home.html`

### GAP-DESIGNER-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Loader failure is invisible: page.tsx keeps only `data` from LoaderResult and drops `source`, so an API outage renders zero counts and 'No services yet' — the maker may start duplicate services (designer/page.tsx:5-9).
- **Verified evidence:** designer/page.tsx:5-8 destructures only { data } from both LoaderResult (apps/web/src/app/_data/apiClient.ts:32 has source, status). fetchJson returns empty + source 'error' on missing gateway/401/failure (apiClient.ts:113-125). DesignerHomeClient then shows StatCards 0 (:65-68) and EmptyState 'No services yet' (:85).
- **Files to change:** `apps/web/src/app/(app)/designer/page.tsx`, `apps/web/src/app/(app)/designer/DesignerHomeClient.tsx`
- **Fix steps:**
  1. Keep source/status from both loaders in page.tsx; pass loadError prop.
  2. In DesignerHomeClient render shared RefreshErrorState when source==='error' instead of stats/empty state.
  3. Show '-' in StatCards when errored.
- **Acceptance:**
  - Component: loadError true renders retry state, no 'No services yet'.
  - Manual: stop gateway, page shows error not zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-DESIGNER-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Row link goes to /designer/${id}, which is a redirect-only route to /b1 (designer/[id]/page.tsx) — a published service is opened in the draft wizard with no read-only state (DesignerHomeClient.tsx:115, [id]/page.tsx:16).
- **Verified evidence:** DesignerHomeClient.tsx:~92-95 DataTable rowLinkPrefix='/designer/' rowLinkKey='id' -> /designer/{id} -> redirect to /b1 (designer/[id]/page.tsx:15). Published rows therefore open in the draft wizard. Not a dead link; a status-blind one.
- **Files to change:** `apps/web/src/app/(app)/designer/DesignerHomeClient.tsx`, `apps/web/src/app/(app)/designer/[id]/page.tsx`
- **Fix steps:**
  1. Fix in [id]/page.tsx per GAP-DESIGNER-DETAIL-01 (status-aware redirect).
  2. Optionally compute per-row href by status in tableRows.
- **Acceptance:**
  - Manual: published row opens read-only view; draft opens b1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-DESIGNER-DETAIL-01

### GAP-DESIGNER-HOME-03  ·  MEDIUM  ·  partly  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Pattern and status are shown as raw tokens ('certificate', 'in_review'); Pattern column uses StatusPill on a non-status (DesignerHomeClient.tsx:39-46, PatternLabel).
- **Verified evidence:** Status column uses cellType 'status' -> StatusPill, which calls humanizeStatus (StatusPill.tsx:61), so 'in_review' shows 'In review' - not raw. Pattern column (:~78) is a plain string of servicePattern ('certificate' lowercase raw). PatternLabel (DesignerHomeClient.tsx:140) wraps StatusPill on a pattern but is exported and unused, so the 'StatusPill on non-status' claim is not live. Also status 'in_review' vs 'submitted' both counted at :30.
- **Files to change:** `apps/web/src/app/(app)/designer/DesignerHomeClient.tsx`, `apps/web/src/app/(app)/designer/_data/designerConstants.ts`
- **Fix steps:**
  1. Map servicePattern to SERVICE_PATTERN_OPTIONS title in tableRows.
  2. Delete unused PatternLabel.
- **Acceptance:**
  - Component: row pattern shows 'Certificate' title-case label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** 'Needs Attention' counts only rejected; drafts with incomplete blocks or failed sandbox test are not flagged (DesignerHomeClient.tsx:37).
- **Verified evidence:** DesignerHomeClient.tsx:30 attention = services.filter(status==='rejected'). No signal for incomplete drafts or failed sandbox test; list API rows (DesignerServiceRow) carry no completeness or test fields, so this needs backend data.
- **Files to change:** `apps/web/src/app/(app)/designer/DesignerHomeClient.tsx`, `apps/web/src/app/(app)/designer/_data/designerLoader.ts`
- **Fix steps:**
  1. Decide definition of Needs Attention (rejected, stale draft, failed latest test).
  2. Extend catalogue list response with latestTestStatus / completeness (backend) and map in getDesignerServices.
  3. Update stat and add a filter chip.
- **Acceptance:**
  - Unit: draft with latestTestStatus 'fail' counted in attention.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Card definition change; backend list contract change.

### GAP-DESIGNER-HOME-05  ·  LOW  ·  confirmed  ·  theme ENTITLEMENT (was ROLEGATE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Page uses ModuleGate moduleKey 'citizen' while the nav lists Service Designer separately, so disabling Citizen hides the designer (layout.tsx).
- **Verified evidence:** designer/layout.tsx wraps with ModuleGate moduleKey='citizen'; Sidebar.tsx:97 lists 'Service Designer' with moduleKey 'citizen' too. So both are tied to the Citizen module; disabling Citizen hides the designer. Observation's 'nav lists separately' is only true as a separate entry, same key. Whether a distinct 'designer' entitlement exists cannot be verified here.
- **Files to change:** `apps/web/src/app/(app)/designer/layout.tsx`, `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Decide whether a 'designer' module key exists in entitlements; if so switch both to it.
  2. If not, leave and document that designer requires Citizen.
- **Acceptance:**
  - Manual: tenant with designer entitlement but no citizen still sees the page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Entitlement change affects edition packaging.


---
## /designer/[id]  —  `designer/detail.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/page.tsx`
- **Design reference:** `redesign/designer/detail.html`

### GAP-DESIGNER-DETAIL-01  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Every definition opens at B1 in edit mode regardless of status; a submitted definition should land on /review and a published one on a read-only view (designer/[id]/page.tsx:15).
- **Verified evidence:** designer/[id]/page.tsx is a synchronous redirect to /designer/${id}/b1 (line 15-16); it does not fetch the definition, so status (submitted/published/rejected) is ignored. Edit-mode b1 opens for all.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/page.tsx`, `apps/web/src/app/(app)/designer/_data/designerApi.ts`
- **Fix steps:**
  1. Make page async; fetch definition server-side (fetchServiceDefinition equivalent for server).
  2. Redirect: draft/rejected -> b1, submitted/in_review -> review, published -> review (read-only) or a new read-only view.
  3. On fetch failure fall back to b1 rather than 404.
  4. Enforce read-only in b1-b8 when status is not draft (decision).
- **Acceptance:**
  - Unit: status 'submitted' redirects to /review; 'draft' to /b1.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Server fetch needs auth headers; wrong redirect could hide edit path for rejected drafts.
- **Depends on:** GAP-DESIGNER-HOME-02

### GAP-DESIGNER-DETAIL-02  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Multi-value query params (?a=1&a=2) are silently dropped by the forwarder (page.tsx:9-12).
- **Verified evidence:** [id]/page.tsx:10-12 copies only `typeof value === 'string'`; array values (?a=1&a=2) are skipped. Impact is minor since wizard pages use few params.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/page.tsx`
- **Fix steps:**
  1. Iterate arrays: for each v of value call qs.append(key, v).
- **Acceptance:**
  - Unit: ?a=1&a=2 redirects to ...b1?a=1&a=2.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /designer/[id]/b1  —  `designer/detail-b1.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b1/page.tsx`
- **Design reference:** `redesign/designer/detail-b1.html`

### GAP-DESIGNER-DETAIL-B1-01  ·  HIGH  ·  confirmed  ·  theme CONSISTENCY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Rail status is static — b1 always 'in-progress', all other blocks 'empty' — so the maker gets no signal of what is complete; sibling pages compute status from different fields (b1/page.tsx:81 vs b5/page.tsx:46).
- **Verified evidence:** b1/page.tsx:81 status is 'in-progress' for b1, 'empty' for all others. b2 (:63) sets b1 complete, b3 (:83) sets b1,b2 complete, b5 (:103) sets b1-b4 'complete' unconditionally and computes b5 from feeModel/hoaCode. So the rail is inconsistent between pages and only b5 uses data; none reflects real completion.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b1/page.tsx`, `apps/web/src/app/(app)/designer/[id]/b2/page.tsx`, `apps/web/src/app/(app)/designer/[id]/b3/page.tsx`, `apps/web/src/app/(app)/designer/[id]/b4/page.tsx`, `apps/web/src/app/(app)/designer/[id]/b5/page.tsx`, `apps/web/src/app/(app)/designer/[id]/b6/page.tsx`, `apps/web/src/app/(app)/designer/_data/designerConstants.ts`
- **Fix steps:**
  1. Add blockStatuses(def, phase3Config) in designerConstants.ts deriving status per block from the ServiceDefinition fields (b1: name, serviceKey, ownerDepartment, slaDays, channels)
  2. Have every [id]/bN/page.tsx call it instead of inline ternaries
  3. Include validation from the review page checks if a shared validator exists
  4. Recompute after save so the rail updates
- **Acceptance:**
  - Unit test: def with all b1 fields -> b1 complete else in-progress
  - Rail identical across b1..b8 for same definition
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; users may rely on false 'complete' before publish - do not use as publish gate without backend validation.

### GAP-DESIGNER-DETAIL-B1-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** DPDP: the profile attribute registry lets a service bind Aadhaar (last 4) and PAN as applicant attributes with no purpose statement, masking note or role gate for the designer (ApplicantTypesForm.tsx attribute list).
- **Verified evidence:** ApplicantTypesForm.tsx:22-23 REGISTRY offers aadhaarLast4 and pan; toggleBinding (:112-119) adds {required:true}. UI (:191-215) gives only 'Bind identity attributes collected for each allowed type' - no purpose statement, DPDP/Aadhaar Act note or consent hint. But this is design-time metadata: no PII values are shown, so masking (<Masked>) does not apply. Role gate: designer layout uses ModuleGate moduleKey='citizen' (layout.tsx:2-5), not a specific designer-role check.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/ApplicantTypesForm.tsx`
- **Fix steps:**
  1. Add 'purpose' (required text) to ProfileAttributeBindingDto for sensitive keys (aadhaarLast4, pan, dateOfBirth) - needs backend field
  2. Show inline DPDP notice on sensitive attributes: collect only if required by law; Aadhaar last-4 only
  3. Default required:false for sensitive attributes
  4. Audit event on binding change (backend)
- **Acceptance:**
  - Binding Aadhaar without purpose is blocked
  - Notice visible next to sensitive attributes
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP compliance; do not store full Aadhaar.

### GAP-DESIGNER-DETAIL-B1-03  ·  MEDIUM  ·  partly  ·  theme AUTOSAVE (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Autosave with a 2s debounce and 'Saved just now' label; no unsaved-changes guard on Next or pattern switch, and service key is editable after creation (CatalogueB1Form.tsx:63, :195).
- **Verified evidence:** CatalogueB1Form.tsx:62 2s debounce persist, save state passed to WizardShell (saved/saving/offline); no flush on unmount (:65 clears timer, dropping pending save) and WizardShell Next (WizardShell.tsx:230) navigates without flush, so edits in the last 2s are lost on Next/block switch/pattern change. Pattern switch does have a confirm (pendingPattern/patternChangeImpact :120). Service key input (:195-200) is editable, help text says 'Locked after first publish', so 'editable after creation' is only true for drafts. 'Saved just now' string not found in this form. Also persist failure sets only 'offline' state.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/CatalogueB1Form.tsx`, `apps/web/src/app/(app)/designer/[id]/b1/page.tsx`, `apps/web/src/app/_components/ds/designer/WizardShell.tsx`
- **Fix steps:**
  1. On unmount and before onNext/onBlockSelect flush pending save immediately (expose flush() via ref or make the unmount effect call persist(latest.current))
  2. Add beforeunload handler when saveState==='saving' or a timer is pending
  3. Disable serviceKey input if def.status !== 'draft' (backend enforces lock; cannot-verify)
  4. Surface save failure with a retry button, not only 'offline'
- **Acceptance:**
  - Type in name and click Next immediately: value persisted (network call before navigation)
  - Published service: key input read-only
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Data loss on service definitions; ensure flush not duplicating PATCH.

### GAP-DESIGNER-DETAIL-B1-04  ·  MEDIUM  ·  confirmed  ·  theme REFDATA (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Designation fields for appeal/RTI take free-text snake_case tokens (placeholder 'additional_commissioner') rather than a positions picker used elsewhere in B4 (GovernanceLinkageBuilder.tsx:68-135 vs ApprovalChainBuilder.tsx:44).
- **Verified evidence:** GovernanceLinkageBuilder.tsx appellateDesignationId (~:68-80) and pioDesignationId (~:125-135) are free-text inputs with placeholders 'additional_commissioner' / 'deputy_commissioner', while ApprovalChainBuilder.tsx:44 uses fetchTenantPositions() and <select> (:348, :377). Free text allows values that match no position. Publish blocking for empty is mentioned in hints, validity of value is unverified.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/GovernanceLinkageBuilder.tsx`, `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/workflowBuilderApi.ts`
- **Fix steps:**
  1. Extract a PositionSelect component from ApprovalChainBuilder using fetchTenantPositions
  2. Use it for appellateDesignationId and pioDesignationId
  3. Show empty-state link to position admin when none exist
  4. Backend validate the id exists on publish (cannot-verify)
- **Acceptance:**
  - Selecting a position stores its id
  - Unknown/free text impossible
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Existing drafts with free-text values need migration/display fallback.

### GAP-DESIGNER-DETAIL-B1-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Three separate cards and a governance panel stack in one column with no anchors; long page with a sticky footer.
- **Verified evidence:** b1/page.tsx:116-142 stacks CatalogueB1Form, ApplicantTypesForm and GovernanceLinkageBuilder (with two more cards inside) in one column within WizardShell; no in-page anchors or section nav. Sticky footer is in WizardShell (not verified in detail).
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b1/page.tsx`
- **Fix steps:**
  1. Add section ids and a small in-page nav (Identity, Applicants, Appeal, RTI, Languages) or collapse cards with <details>
  2. Show per-section completeness
- **Acceptance:**
  - Section nav jumps to each card
  - Keyboard operable
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-DESIGNER-DETAIL-B1-01


---
## /designer/[id]/b2  —  `designer/detail-b2.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b2/page.tsx`
- **Design reference:** `redesign/designer/detail-b2.html`

### GAP-DESIGNER-DETAIL-B2-01  ·  HIGH  ·  confirmed  ·  theme SAVE-RELIABILITY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Each edit fans out into several metadata-service calls (entity, fields, layout, form-version) from the browser via autosave; partial failure leaves a half-created form with only a save-state label to show it (formBuilderApi.ts:147-297, FormBuilder onSaveState).
- **Verified evidence:** formBuilderApi.ts:157-300 persistFormDesign runs from the browser as a sequential chain of fetches through /api/proxy/v1/metadata: GET entities (POST if missing, :138-150), GET fields, then one PATCH or POST per field (:186-215), then layout PATCH/POST (:226-240), then form-version PATCH/POST (:253-270). Nothing is transactional. FormBuilder.tsx:75-90 wraps it in a 2s debounce; any throw only calls onSaveState('offline'), which b2/page.tsx:17 passes to WizardShell as a label. There is no retry, no message saying which step failed, and no beforeunload guard. A failure mid-loop leaves some fields created and no layout or version. The next edit re-runs the whole chain, which is mostly idempotent because it looks fields up by apiName (:180). By code reading, replace(saved) at FormBuilder.tsx:82 creates a new design object, which re-triggers the [design] effect at :91, so autosave appears to re-fire every ~2s while the page is open (not run). The theme tag I18N is wrong. The finding is about atomicity and error surfacing.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/formBuilderApi.ts`, `apps/web/src/app/(app)/designer/_components/FormBuilder.tsx`, `apps/web/src/app/(app)/designer/[id]/b2/page.tsx`
- **Fix steps:**
  1. Make persistFormDesign return a result with the failed step name and the partial design (entity, fields, layout, version) instead of throwing, so the caller can keep the ids it already got.
  2. In FormBuilder.schedulePersist, call replace() only when the saved design differs from the current one. Do it via a deep-equal or a 'dirty' ref, so the save does not re-trigger the [design] effect.
  3. Add a retry with backoff (e.g. 3 attempts) and a persistent inline error banner ('Form not fully saved: layout step failed. Retry') using the existing ErrorState/RefreshErrorState; keep the 'offline' label as a secondary cue.
  4. Add a window 'beforeunload' guard while saveState is 'saving' or 'offline'.
  5. Longer term, ask backend for one 'save form design' endpoint that takes entity, fields, layout and visibility rules in a single transaction; then reduce persistFormDesign to one call.
- **Acceptance:**
  - Unit test: mock fetch to fail on the layout PATCH. persistFormDesign reports the failed step, and the returned partial design keeps entityId and metadataFieldId values.
  - Component test: after a failed save, a visible alert with a Retry button renders; clicking Retry succeeds and the label returns to 'saved'.
  - Network log: after a successful save, no further metadata requests fire within 10s without an edit.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing the autosave loop can drop unsaved edits if the dirty check is wrong. The single-transaction endpoint is a backend contract change (metadata-service is not in this snapshot).

### GAP-DESIGNER-DETAIL-B2-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Field type icons are emoji glyphs (📅, 📍, 🗺, 📎) in the palette (formTypes.ts:73-110).
- **Verified evidence:** formTypes.ts:80-109 FIELD_PALETTE_GROUPS uses emoji or Unicode glyphs for icons. Real emoji are 📅 (:82), 📎 (:95), 📍 (:100), 🗺 (:101), 👤 (:107) and 📱 (:108). Others are plain glyphs (Aa, #, ☑, ◉, ☰, ✉). FormBuilder.tsx:227 renders them in an aria-hidden span, and typeIcon() (:544) reuses them in field rows; :411 also uses 👁 for conditional fields. Emoji render differently per OS and clash with the design system. They are aria-hidden, so there is no screen-reader harm.
- **Files to change:** `apps/web/src/app/_components/ds/designer/formTypes.ts`, `apps/web/src/app/(app)/designer/_components/FormBuilder.tsx`
- **Fix steps:**
  1. Change the palette item shape from icon:string to iconName (or a ReactNode) mapped to the ui-kit/ds icon set (SVG).
  2. Replace the emoji entries in FIELD_PALETTE_GROUPS with icon names.
  3. Update the palette render (FormBuilder.tsx:227) and typeIcon() (:544) to render the SVG icon component, still aria-hidden.
  4. Replace the 👁 conditional marker at FormBuilder.tsx:411 with an icon plus the existing aria-label.
- **Acceptance:**
  - grep of formTypes.ts and FormBuilder.tsx finds no emoji characters.
  - Palette and field rows render an SVG per field type in light and dark themes.
  - Existing FormBuilder tests still pass (buttons keep aria-label 'Add <label> field').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic only. Check that any snapshot tests referencing the icon strings are updated.

### GAP-DESIGNER-DETAIL-B2-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: help text correct), `[~]` if blocked + reason)
- **First-pass claim:** Help text says 'Changes autosave to metadata-service' — an internal service name shown to a government form designer (b2/page.tsx:107).
- **Verified evidence:** b2/page.tsx:107 HelpTip text reads 'Changes autosave to metadata-service.' This is an internal service name shown to a designer. The string is hard-coded English with no i18n; no useTranslations is used anywhere under (app)/designer.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b2/page.tsx`
- **Fix steps:**
  1. Reword to 'Changes save automatically. Watch the save status at the bottom of the page.' (or the tenant's approved phrasing).
  2. If designer copy is being moved to next-intl, put the string in the designer message namespace and read it with useTranslations.
- **Acceptance:**
  - grep for 'metadata-service' in apps/web/src/app/(app)/designer/**/*.tsx returns no user-visible strings.
  - The B2 help tooltip shows the new copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-DESIGNER-DETAIL-B2-05  ·  LOW  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Delete field is immediate with a transient Undo toast, no confirm — undo lost on navigation.
- **Verified evidence:** FormBuilder.tsx:534 'Delete field' calls deleteField() (:140-156) immediately. It removes the field and its id from the section, then sets undoToast for 8s via an un-cleared setTimeout (:154). The toast is component state, so it disappears on navigation. The whole-form Ctrl/Cmd+Z in useUndoRedo.ts:38-51 is in-memory and also lost on navigation. Two extra points: deleteField does not clean other fields' visibility conditions that reference the deleted field, and persistFormDesign (formBuilderApi.ts:157-300) never deletes the metadata field, so it remains orphaned server-side. The suggested generic fix (mandatory reason, maker!=checker, audit event) is over-scoped for a draft field. The service-level maker-checker already exists at publish.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/FormBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/formBuilderModel.ts`
- **Fix steps:**
  1. In deleteField, count references to the field (other fields' visibility conditions, plus eligibility or fee exemptions if reachable). If any exist, open the ds ConfirmDialog listing them. If none, keep the fast delete with Undo.
  2. Clear the 8s timer on unmount and on a second delete (store the timeout id in a ref).
  3. Remove or rewrite visibility conditions that point at the deleted field, so the saved rule set is not left dangling.
  4. Optionally show the toast text 'Field "<label>" deleted' plus an Undo button, and mention Ctrl+Z.
- **Acceptance:**
  - Test: deleting a field referenced by another field's visibility rule opens ConfirmDialog; cancel keeps the field.
  - Test: deleting an unreferenced field shows the toast; Undo restores it at the same index.
  - Test: two quick deletes never hide the second toast early (timer is cleared).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. The edit touches draft data only. Removing dangling visibility rules must not delete rules for other fields.


---
## /designer/[id]/b3  —  `designer/detail-b3.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b3/page.tsx`
- **Design reference:** `redesign/designer/detail-b3.html`

### GAP-DESIGNER-DETAIL-B3-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** DPDP: 'Below poverty line' and 'Income band' are sensitive socio-economic attributes offered as plain eligibility inputs, with no note on lawful basis, source of truth or who can read the decision trail (eligibilityTypes.ts:53-58).
- **Verified evidence:** eligibilityTypes.ts:53-60 PROFILE_ATTRIBUTES includes 'bpl' (Below poverty line, boolean) and 'income_band' (Income band, text) as ordinary attributes. EligibilityConditionBuilder.tsx renders them in the 'Applicant profile' optgroup with no sensitivity marker, and EligibilityBuilder.tsx:105-108 has no lawful-basis text. Nothing in b3/page.tsx or the builder records the source of truth or who can read the decision trail. Who can read decision results at runtime is cannot-verify (citizen-service and its eligibility store are absent from the snapshot). The proposed fix, shared <Masked> with role reveal, does not fit here. These are rule inputs, not displayed values. The real need is a sensitivity flag, a lawful-basis or source note, and an audit trail.
- **Files to change:** `apps/web/src/app/_components/ds/designer/eligibilityTypes.ts`, `apps/web/src/app/_components/ds/designer/EligibilityConditionBuilder.tsx`, `apps/web/src/app/(app)/designer/_components/EligibilityBuilder.tsx`
- **Fix steps:**
  1. Add `sensitivity?: 'sensitive'` and `sourceOfTruth?: string` to EligibilityAttributeOption and set them for bpl and income_band in PROFILE_ATTRIBUTES.
  2. In EligibilityConditionBuilder, when the chosen attribute is sensitive, show an inline notice with the lawful basis and source (e.g. 'Verified from the income certificate / BPL register only') and require the designer to tick an acknowledgement before the rule can be saved.
  3. Include the acknowledgement and the sensitive attribute ids in the payload sent by persistEligibilityDesign so the backend can audit them (contract needs agreement).
  4. Get DPO sign-off on the notice wording and the list of attributes classed as sensitive.
  5. Make the sample-applicant panel in EligibilityBuilder label these fields as sensitive.
- **Acceptance:**
  - Selecting 'Below poverty line' shows the sensitive-data notice; saving without acknowledgement is blocked.
  - Test: PROFILE_ATTRIBUTES entries for bpl and income_band carry sensitivity metadata.
  - Backend receives and audits the acknowledgement (verify when the citizen-service contract is available).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure. Wrong wording or an incomplete attribute list could give false assurance. Eligibility rules directly gate benefits, so changing rule semantics must not alter existing saved rules.

### GAP-DESIGNER-DETAIL-B3-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [~] **Status** NEEDS OWNER DECISION: citizen-service team must confirm if evaluator supports document-present/payment-status attributes before adding new optgroups
- **First-pass claim:** Profile field list is a fixed six-item array; form-answer fields come through formFields but there is no way to reference a document or payment status (eligibilityTypes.ts, b3/page.tsx formFields).
- **Verified evidence:** eligibilityTypes.ts:53-60 defines exactly six profile attributes (age, ward, resident, bpl, income_band, mobile_verified). b3/page.tsx:45-52 builds formFields from loadFormDesign(...).fields. EligibilityConditionBuilder.tsx:25-32 maps only form fields to options (text, number or boolean). There is no attribute for document presence or verification, or for payment status, so rules cannot reference them. Whether the runtime evaluator supports such attributes is cannot-verify (citizen-service absent).
- **Files to change:** `apps/web/src/app/_components/ds/designer/eligibilityTypes.ts`, `apps/web/src/app/_components/ds/designer/EligibilityConditionBuilder.tsx`, `apps/web/src/app/(app)/designer/[id]/b3/page.tsx`
- **Fix steps:**
  1. Confirm with the citizen-service team whether the eligibility evaluator can resolve 'document present' or 'payment status' attributes. If not, log a backend dependency.
  2. If supported, load the service's required documents (documentBuilderApi) and add a third optgroup 'Documents' with boolean 'has <doc>' attributes; add a payment-status option.
  3. Extend EligibilityAttributeOption.group to 'document' | 'payment' and pass the new groups into EligibilityConditionBuilder via props.
- **Acceptance:**
  - Once the backend supports it, the attribute dropdown lists a 'Documents' group derived from B6.
  - Saved rules round-trip through rulesUiToApi and rulesApiToUi with the new attribute ids.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Adding attributes the evaluator does not resolve would make rules silently pass or fail at runtime.
- **Depends on:** GAP-DESIGNER-DETAIL-B6-01

### GAP-DESIGNER-DETAIL-B3-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** 'Block application' takes effect for every applicant with no override path or appeal wording preview shown to the designer.
- **Verified evidence:** Partly true. ELIGIBILITY_EFFECTS_UI (eligibilityTypes.ts:97-101) offers 'Block application', and effectUiToApi maps it to 'disqualify'. The builder has a free-text 'Rule message' (EligibilityConditionBuilder.tsx:180-186) but shows no preview of the applicant-facing wording and no reference to an appeal or override path. Whether a runtime override exists is cannot-verify (citizen-service absent). There is a bigger verified defect: effectUiToApi collapses both 'warn' and 'flag' to 'refer' (eligibilityTypes.ts:34-36), and effectApiToUi maps 'refer' back to 'flag' (:38-40). So 'Warn applicant' silently becomes 'Flag for review' after the first save and reload. The I18N theme tag is wrong.
- **Files to change:** `apps/web/src/app/_components/ds/designer/eligibilityTypes.ts`, `apps/web/src/app/_components/ds/designer/EligibilityConditionBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/eligibilityBuilderApi.ts`
- **Fix steps:**
  1. Agree with backend on an API representation that keeps warn and flag distinct (a new effect value, or an extra `uiEffect` field on the rule). Update ApiRule.effect, effectUiToApi and effectApiToUi to round-trip.
  2. In EligibilityConditionBuilder, show an 'Applicant will see:' preview under the message input, and a helper line when effect is 'block' saying what the applicant can do next (appeal or contact office), copy to be confirmed.
  3. Default the message to a required, non-empty string when effect is 'block'.
  4. If an override or appeal path exists at runtime, expose it as a per-rule checkbox; otherwise record this as a product decision.
- **Acceptance:**
  - Test: a rule saved with effect 'warn' reloads as 'warn' (round-trip in eligibilityBuilderApi tests).
  - Choosing 'Block application' with an empty message shows a validation error.
  - The preview shows the entered message.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing the effect encoding touches eligibility decisions that gate citizen applications. Migrate stored 'refer' rules with care (they currently reload as 'flag').

### GAP-DESIGNER-DETAIL-B3-04  ·  LOW  ·  confirmed  ·  theme FORMS (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Operator labels are natural language but 'Value' has no type-aware input (date vs number) shown in the copy read.
- **Verified evidence:** EligibilityConditionBuilder.tsx:155-162 renders the value as a plain text input (placeholder 'Expected value') regardless of attribute type. Each EligibilityAttributeOption carries valueType (text, number or boolean), but it is not used in this component. formFieldOptions (:24-33) reduces date fields to 'text', so an age or date comparison is typed as free text. parseRuleValue (eligibilityBuilderApi.ts:47-53) then guesses the type: 'true' or 'false' becomes a boolean and numeric strings become numbers. Operator labels ('is at least', etc.) are plain-language, so that half of the observation is fine. The DATEFMT theme tag is wrong.
- **Files to change:** `apps/web/src/app/_components/ds/designer/EligibilityConditionBuilder.tsx`, `apps/web/src/app/_components/ds/designer/eligibilityTypes.ts`
- **Fix steps:**
  1. Add 'date' to EligibilityAttributeOption.valueType, and have formFieldOptions map field type 'date' to it.
  2. Render the value control by valueType: number input, Yes/No select for boolean, `type="date"` input for date, text otherwise. Reuse the same pattern as renderSampleField in EligibilityBuilder.tsx.
  3. Show dates with formatIndianDate (dd Mon yyyy) in summaries and store ISO in the payload; update parseRuleValue to leave ISO date strings alone.
  4. Drop the op 'is at least/at most' choices for boolean attributes.
- **Acceptance:**
  - Test: selecting a number attribute renders type=number; boolean renders a select; date renders a date input.
  - Round-trip test: date value '2026-03-31' is saved and reloaded unchanged (not coerced to a number).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Existing rules with free-text values must still load. Keep a text fallback for unknown types.

### GAP-DESIGNER-DETAIL-B3-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Test panel results stay local; nothing is recorded for the sandbox run (EligibilityBuilder.tsx:139).
- **Verified evidence:** True in fact: the sample-applicant panel (EligibilityBuilder.tsx:139-215) calls evaluateEligibilityLocal in a useMemo (:57-61). It is entirely client-side, keeps sample values in React state, and records nothing. This is a design choice rather than a defect. It performs no mutation, so the CLAUDE.md rule 8 (audit events on mutations) does not apply. The only thing missing is the ability to keep test cases with the rule set. Consider severity 'low, enhancement'.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/EligibilityBuilder.tsx`
- **Fix steps:**
  1. If reviewers need evidence, add a 'Save this test case' button that stores the sample values and the outcome with the draft (needs a backend field or the sandboxTestApi).
  2. Otherwise add helper text stating that sample runs are local and not recorded, and close as accepted behaviour.
- **Acceptance:**
  - Either helper text is visible under the panel heading, or a saved test case appears in the review page for the checker.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Storing sample data must not include real applicant data.


---
## /designer/[id]/b4  —  `designer/detail-b4.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b4/page.tsx`
- **Design reference:** `redesign/designer/detail-b4.html`

### GAP-DESIGNER-DETAIL-B4-01  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Maker-checker is shown only later: the chain builder never states that the submitting designer cannot approve their own service (that rule lives in review/page.tsx), so designers can build a one-person chain (ApprovalChainBuilder.tsx vs review/page.tsx:41-44).
- **Verified evidence:** The maker!=checker rule is in review/page.tsx:41-44 (isSubmitter / isChecker from session.userId vs wizard.meta.submittedBy) and hides Approve and Reject for the submitter (:152). It governs who may publish the service definition, not who staffs approval lanes. It is computed in the client, and server enforcement is cannot-verify (citizen-service absent). The observation blurs the two. What is true in ApprovalChainBuilder.tsx: each LaneCard picks a designation (:348-361) and no validation checks that consecutive lanes have different designations, or that any designation is set (defaultLanes gives designationId '' , workflowConstants.ts:56). narrateWorkflow then falls back to 'the assigned officer' (:106). So a chain where the same designation inspects and decides, or where nobody is assigned, can be built and autosaved without any hint. Whether that violates policy depends on a product rule.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/workflowConstants.ts`, `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`
- **Fix steps:**
  1. Add `validateChain(lanes)` in workflowConstants.ts returning warnings: lane enabled with empty designationId, and the same designationId in two enabled action lanes (e.g. inspection and decision).
  2. Render the warnings in ApprovalChainBuilder under the narration paragraph (role=status), and show a permanent note 'The person who submits a service for publication cannot approve it (checked at review)'.
  3. Ask product whether a same-designation chain is a hard block. If yes, also return the check from the b4 page so the Next button can be disabled.
  4. Have backend re-validate at submit for publish.
- **Acceptance:**
  - Test: validateChain flags an empty designation on an enabled lane and a duplicate designation across inspection and decision.
  - Component test: the warning list renders for a chain with two identical designations.
  - Backend rejects submit of a chain with an unassigned enabled lane (once contract is available).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** A hard block could stop legitimate small offices where one officer holds both roles. Treat as a warning unless product says otherwise.

### GAP-DESIGNER-DETAIL-B4-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 p2: closed by #2105 — per-lane inline warning added to LaneCard under the Escalate select with aria-describedby; validateChain already detected missing_escalation; GWT tests in ApprovalChainBuilder.test.tsx)
- **First-pass claim:** Escalate-to starts at 'Select superior designation'; a lane without one has an SLA that escalates nowhere and nothing warns the designer (ApprovalChainBuilder.tsx:376-395).
- **Verified evidence:** ApprovalChainBuilder.tsx:375-396 (line 376 label 'Escalate to (on breach)'): the select starts at value '' with '<option>Select superior designation</option>'. lanesToBindings (workflowConstants.ts:64-75) sends escalationDesignationId as undefined when empty. Nothing warns when a lane has an SLA and no escalation target. The SLA input (:365-373) accepts 0 (min 0), and slaDaysToMinutes returns null for 0, so a lane can have no SLA at all with no notice. Neither the B4 page nor the builder shows an escalation warning.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/workflowConstants.ts`, `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`
- **Fix steps:**
  1. Extend the new validateChain helper (see GAP-DESIGNER-DETAIL-B4-01) with 'slaDays > 0 but no escalationDesignationId' and 'enabled action lane with slaDays 0'.
  2. Show a per-lane inline warning in LaneCard (aria-describedby on the select) and a count in the narration area.
  3. Optionally block Next only after product decides.
- **Acceptance:**
  - Test: a lane with slaDays 5 and no escalation designation yields a warning; setting the designation clears it.
  - Manual: LaneCard shows the warning text under the Escalate select.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Warning only.
- **Depends on:** GAP-DESIGNER-DETAIL-B4-01

### GAP-DESIGNER-DETAIL-B4-03  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Switching to the advanced editor moves the service to custom-workflow mode and locks the guided chain; reverting discards visual-editor changes, which the dialog says only at revert time (ApprovalChainBuilder.tsx:134,:260-270).
- **Verified evidence:** Behaviour confirmed and worse than described. openAdvanced (ApprovalChainBuilder.tsx:103-109) immediately sets mode 'custom' and shows a warning banner (:134-135: 'changes here switch this service to custom-workflow mode; the guided chain below is locked until you revert'). The banner does not say that reverting discards the visual edits. That is said only in RevertDiffDialog (:268-270) with a before/after diff. No confirm is used to enter advanced mode. However, schedulePersist returns early when advanced or custom (:69), and the embedded DesignerCanvas has no fetch or save code (grep of DesignerCanvas.tsx finds none). So from B4 the visual-editor changes look unsaved altogether, unless persistence is wired somewhere I could not find. That question is not answerable from this snapshot. Also the page-level mode is local state only, so 'custom' is not persisted by B4 either (persistWorkflowDesign is never called in custom mode).
- **Files to change:** `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`, `apps/web/src/app/(app)/designer/_data/workflowBuilderApi.ts`
- **Fix steps:**
  1. Confirm with the workflow-service owner whether the embedded canvas should save; if yes, add an onSave/onChange prop to DesignerCanvas (embedded) that calls a new persistCustomWorkflow() in workflowBuilderApi.ts and reports through onSaveState.
  2. Before openAdvanced, show the ds ConfirmDialog: 'Open the visual editor? The guided chain will be locked. Reverting later discards visual-editor changes.'
  3. Repeat the discard warning in the advanced-mode banner (:134).
  4. Persist mode 'custom' with the definition so a reload reopens in custom mode (loadWorkflowDesign currently infers it from lanesFromBpmn, workflowBuilderApi.ts:53).
- **Acceptance:**
  - Clicking 'Open visual editor (Advanced)' shows a ConfirmDialog; cancelling leaves mode 'template'.
  - The advanced banner says that reverting discards visual changes.
  - Editing a node in the canvas, reloading the page, and reopening B4 shows the edit (once persistence is wired).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval workflow definitions are business-critical. Losing custom routing silently, or overwriting it with the guided projection, changes who approves applications.

### GAP-DESIGNER-DETAIL-B4-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Position picker lists designation labels only — no holder, vacancy or delegation info (ApprovalChainBuilder.tsx:357-359).
- **Verified evidence:** ApprovalChainBuilder.tsx:357-359 (also 392-394 for escalation) lists positions as <option>{p.label}</option>. fetchTenantPositions (workflowBuilderApi.ts:90-99) maps only id and a label (row.name / title / label / code) from /api/proxy/v1/tenant/positions. It drops any other field. Whether that endpoint returns holder, vacancy or delegation data is cannot-verify (tenant service absent). On fetch failure the component sets positions to [] silently (:44-47), leaving empty dropdowns with no message. The I18N theme tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/workflowBuilderApi.ts`, `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`
- **Fix steps:**
  1. Check the /v1/tenant/positions response for holder, vacancy and delegation fields. If absent, request them from the backend.
  2. Extend the TenantPosition type with optional holderName, vacant and delegatedTo, and map them in fetchTenantPositions.
  3. Suffix the option label with ' (vacant)' or ' - <holder>' and warn under the select when the selected position is vacant.
  4. Show an inline error with a retry when the positions request fails, instead of silently showing an empty list.
- **Acceptance:**
  - Test: positions with vacant=true render '(vacant)' in the option and a warning when selected.
  - Test: a failed positions fetch renders an error message with a retry.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Showing named holders exposes staff names to designers; confirm access rules. Holder data may be stale.

### GAP-DESIGNER-DETAIL-B4-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The visual editor is dynamically imported with a plain 'Loading visual editor…' paragraph as fallback (ApprovalChainBuilder.tsx:17).
- **Verified evidence:** ApprovalChainBuilder.tsx:15-18 uses next/dynamic with loading: () => <p style={{color:'var(--mut)'}}>Loading visual editor…</p>. The ds library has a Skeleton component (apps/web/src/app/_components/ds/Skeleton.tsx) that could replace it. Impact is low. The paragraph has no role=status and does not reserve the canvas's 420px embedded height (DesignerCanvas.tsx:258), so the page jumps when it loads.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx`
- **Fix steps:**
  1. Replace the fallback with a Skeleton block of height 420 and role='status' aria-label 'Loading visual editor'.
  2. Handle dynamic-import failure with an error state (ErrorState) so a chunk failure is visible.
- **Acceptance:**
  - Throttled load shows a 420px skeleton with no layout shift.
  - Simulated import failure shows an error message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /designer/[id]/b5  —  `designer/detail-b5.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b5/page.tsx`
- **Design reference:** `redesign/designer/detail-b5.html`

### GAP-DESIGNER-DETAIL-B5-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Engine fee model is permanently unavailable in this wizard: FeeBuilder receives engineAvailable={false}, so selecting 'Engine' can never proceed even though /designer/[id]/engines exists and is reachable only by URL (b5/page.tsx:~176, feeBuilderModel.ts:114-116).
- **Verified evidence:** b5/page.tsx:179 hard-codes engineAvailable={false} on FeeBuilder. modelCardDisabled (feeBuilderModel.ts:113-119) returns true for 'engine' when false, and FeeBuilder.tsx:209-232 renders that card as a disabled radio with the text 'No assessment engine is bound to this service yet.' So the Engine option cannot be selected at all (the finding's 'selecting can never proceed' is slightly off; it is not selectable). The 'Engine parameters' card (FeeBuilder.tsx:332) is dead code. /designer/[id]/engines/page.tsx exists (EngineBindingBuilder, adjacentBlocks 'b5'), and a grep of apps/web/src finds no link or router push to it from B5 or the wizard, so it is reachable only by URL. persistFeeDesign has a branch for feeModel 'engine' (feeBuilderApi.ts:250), and the preview says 'live preview unavailable in designer'.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b5/page.tsx`, `apps/web/src/app/(app)/designer/_components/FeeBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/engineBindingApi.ts`
- **Fix steps:**
  1. In b5/page.tsx, derive engineAvailable from the definition's engineBindings (def.engineBindings, normalizeBindingsFromApi) instead of hard-coding false.
  2. In FeeBuilder, when the Engine card is disabled, replace the message with a Link to `/designer/${serviceId}/engines` ('Bind an assessment engine').
  3. Add an entry point to the engines page from the wizard (link in the B5 header area or block rail).
  4. Make sure the Engine branch of isHoaBlocking / persist still works once the card is enabled.
- **Acceptance:**
  - Service with an engine binding: Engine card is enabled and selectable; selecting it shows the parameters card.
  - Service without a binding: Engine card is disabled and shows a link to the engines page.
  - The engines page is reachable from B5 without typing the URL.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Enabling engine fees routes money computation to an external engine. Verify engine outputs are integer paise before enabling, and keep the designer preview clearly labelled as unavailable.

### GAP-DESIGNER-DETAIL-B5-02  ·  HIGH  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Money rule: the ₹ input is parsed with Number() then Math.round(rupees*100) into a JS number (not bigint paise) and any invalid or negative entry silently becomes 0, so a typo yields a ₹0 fee that still passes isFeeDesignReadyToAdvance for non-flat models (feeBuilderApi.ts:403-412; CLAUDE.md money rule).
- **Verified evidence:** Core money defect confirmed. rupeesInputToPaise (feeBuilderApi.ts:403-407) does Number(input), returns 0 for NaN or negative, and returns Math.round(rupees*100) as a JS number. FeeBuilder.tsx:163 assigns it to baseAmountPaise, and persistFeeDesign sends it as `baseAmount` (feeBuilderApi.ts:349). CLAUDE.md rule 11 wants bigint minor units, and float parsing is used. A typo becomes 0 silently, and float rounding is off for inputs with more than 2 decimals (e.g. 1.005 gives 100). Mis-described part: it only applies to the flat model (the only user of the Amount input). isFeeDesignReadyToAdvance (feeBuilderModel.ts:65-71) is never called anywhere in apps/web/src, so the real Next gate is only the HOA check (b5/page.tsx:93,150). A flat model with a 0 amount therefore does advance, and only the 'Configure' step badge (FeeBuilder.tsx:178) stays unticked. Backend validation of baseAmount is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/feeBuilderApi.ts`, `apps/web/src/app/(app)/designer/_components/FeeBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/feeBuilderModel.ts`, `apps/web/src/app/(app)/designer/[id]/b5/page.tsx`
- **Fix steps:**
  1. Replace rupeesInputToPaise with a string-based parser returning `{ok:true, paise}` or `{ok:false, error}`: accept only /^\d+(\.\d{1,2})?$/, build paise from integer and fraction parts without floats (BigInt or safe integer arithmetic).
  2. In FeeBuilder.updateAmountRupees, keep the raw string, show an inline aria-invalid error for invalid input, and do not overwrite baseAmountPaise with 0.
  3. Use the shared formatINR for any rupee display and keep paise as string or bigint in FeeDesignState.baseAmountPaise and the API body if the fee-schedule contract allows.
  4. Wire isFeeDesignReadyToAdvance into b5/page.tsx together with the HOA gate so Next is disabled for flat models with no valid amount (decide whether ₹0 is allowed).
  5. Apply the same parser to slab rate inputs if they use similar code.
- **Acceptance:**
  - Unit tests: '10' gives 1000; '10.5' gives 1050; '1.005', '-5', 'abc' and '' return errors (no zero).
  - Component test: typing 'abc' shows an error and Next stays disabled for flat.
  - Manual: typing 99999999999.99 does not lose precision in the saved baseAmount.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money path. Fee schedules drive citizen payment demands, so test against existing saved fees (paiseToRupeesInput round-trip). Changing baseAmount to a string is a contract change with the revenue service.

### GAP-DESIGNER-DETAIL-B5-03  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W2 PQ: closed by #N -- office overrides added to versionDiffModel.ts; 3 tests) and waiver reason hold, but office overrides are still absent from versionDiffModel.ts, so a checker's diff does not show an office fee waiver (fix step 3))
- **First-pass claim:** Office variant 'Fee (₹)' of 0 is allowed ('A free zone is legitimate') with no approval or audit prompt for a fee waiver, though it is a revenue decision (OfficeOverridesBuilder.tsx:93).
- **Verified evidence:** OfficeOverridesBuilder.tsx:77-94: 'Fee (₹)' is a number input (min 0, step 0.01). onChange stores feeFromMinor = Math.round(Number(value)*100) (float, same weakness as B5-02), and displays feeFromMinor/100. The hint at :93 says 'A free zone is legitimate — enter 0 to charge nothing here.' No confirmation, reason or audit prompt appears. b5/page.tsx:195-199 persists via phase3.patch({officeOverrides}) to updateServiceDefinition. Publish-time review exists at service level (review/page.tsx), but versionDiffModel.ts only compares the top-level feeFromMinor (:31-41), not officeOverrides, so a checker's diff would not show a fee waiver for an office. Whether the backend audits the definition PATCH is cannot-verify (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/designer/_components/OfficeOverridesBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/versionDiffModel.ts`, `apps/web/src/app/(app)/designer/_data/feeBuilderApi.ts`
- **Fix steps:**
  1. Reuse the new string-based rupees-to-paise parser from B5-02 in OfficeOverridesBuilder instead of Math.round(Number*100).
  2. When the entered fee is 0, show a warning notice 'This office will charge nothing; the checker will see this waiver at review' and require a short reason (new `feeWaiverReason` on the override row).
  3. Add office overrides (fee and reason) to the versionDiffModel so VersionDiff lists them at review.
  4. Confirm the definition PATCH emits an audit event including office id, old and new fee (backend).
- **Acceptance:**
  - Entering 0 in an office row shows the waiver warning and a required reason field.
  - The review page's VersionDiff lists 'Office X fee: ₹500 to ₹0' with the reason.
  - Audit event with the same payload is emitted on save (verify in service).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Revenue leakage if waivers slip through unreviewed; a wrong diff could hide changes from the checker.
- **Depends on:** GAP-DESIGNER-DETAIL-B5-02

### GAP-DESIGNER-DETAIL-B5-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was ROLEGATE)

- [x] **Status** Closed by f6f6baa92 (UAT B4, 2026-10-27). Confirmation line, review/publish description and load-failure retry built; the per-draft confirm checkbox and a head category were not built (finance major-heads carries no category field, and a stored confirmation would need a new definition column) -- acceptance criteria met without them.
- **First-pass claim:** HOA search lists finance major-heads only by code/description; wrong-head risk is unmitigated with no tariff cross-check (FeeBuilder.tsx:393-470, finance/major-heads).
- **Verified evidence:** FeeBuilder.tsx:389-470 implements the HOA combobox. Options come from fetchHoaOptions (feeBuilderApi.ts:325-333), which maps /api/proxy/v1/finance/major-heads rows to `${code} — ${description}`. filterHoaOptions matches code or label text only. Once chosen it shows 'Attached: <code>' in green (:463-466). Nothing checks the head against the fee type (no tariff cross-check), and no confirmation is shown. The finding's ROLEGATE tag is wrong (this is wrong-selection risk, not access control). Whether finance restricts which heads a designer may attach is cannot-verify (finance service absent).
- **Files to change:** `apps/web/src/app/(app)/designer/_components/FeeBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/feeBuilderApi.ts`
- **Fix steps:**
  1. Ask finance whether major-head rows carry a category or receipt type; if so map it into the HOA option (e.g. `category`) and hint mismatches with the service pattern.
  2. After selection, show a summary line 'Fees will post to <code — description>' and require the designer to confirm it once (checkbox), stored with the draft.
  3. Show the selected head in the review page's fee summary (feeSummaryForPublish) so the checker sees code and description.
  4. Handle an empty or failed HOA list with a retry.
- **Acceptance:**
  - Selecting a head shows code and description in a confirmation line.
  - The review page fee summary shows the head's description alongside the code.
  - Empty list state offers a retry button.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** A wrong Head of Account misposts revenue. Do not silently auto-suggest heads.

### GAP-DESIGNER-DETAIL-B5-05  ·  LOW  ·  partly  ·  theme OTHER

- [~] **Status** NEEDS OWNER DECISION: product must define hard-block vs advisory boundary for wizard, `[~]` if blocked + reason)
- **First-pass claim:** Two block-progress semantics: Next is disabled for HOA while B6-B8 only warn (b6 help text) — inconsistent gating.
- **Verified evidence:** Facts verified. B5 disables Next when the HOA is missing (b5/page.tsx:150,186-190; feeBuilderModel.ts:56-58 has the comment 'block submit/next here, not at publish'). B6's help text (b6/page.tsx:136-139) says mandatory documents without a verifying lane 'warn but do not block Next', and B7/B8 have no gate at all (onNext always navigates, b7/page.tsx:135). This is a deliberate hard-versus-soft split rather than a bug: payments cannot post without an HOA, while a missing verifying lane is advisory. The inconsistency is that the wizard has no visible rule for which checks block and which warn (block rail statuses are hard-coded 'empty' or 'complete', e.g. b6/page.tsx:71-79).
- **Files to change:** `apps/web/src/app/(app)/designer/_data/designerConstants.ts`, `apps/web/src/app/_components/ds/designer/WizardShell.tsx`
- **Fix steps:**
  1. Decide the product rule: which validations are 'blocking' and which are 'advisory'; document it in one place.
  2. Add a `blockingIssues` / `warnings` count to each DesignerBlock and show it on the block rail, using the same wording ('Blocks Next' vs 'Warning') in every block help text.
  3. Make the pre-submit check on the review page list all warnings so they cannot be ignored unseen.
- **Acceptance:**
  - Block rail shows a warning badge for B6 when a mandatory document has no verifying lane, and a blocking badge for B5 without an HOA.
  - Help texts on B5 and B6 use the same terms for blocking versus warning.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low. Tightening the gates could block designers who legitimately defer work.
- **Depends on:** GAP-DESIGNER-DETAIL-B6-01


---
## /designer/[id]/b6  —  `designer/detail-b6.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b6/page.tsx`
- **Design reference:** `redesign/designer/detail-b6.html`

### GAP-DESIGNER-DETAIL-B6-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** A mandatory document with no verifying lane only warns; the service can be submitted with a document nobody checks (DocumentsBuilder.tsx:283, b6/page.tsx help text).
- **Verified evidence:** documentBuilderModel.ts:60-92 assessDocumentWarnings sets warning kind 'missing_lane' for a mandatory document with no verifiedAtLane; its type comment says 'warning, not a hard block' (:10). DocumentsBuilder.tsx:270-286 shows the banner 'Verification lane warning', and per-row text at :343-350. b6/page.tsx:136-139 help text says these 'warn but do not block Next'. The onNext handler (b6/page.tsx:118) navigates unconditionally. No submit-time check is visible in the designer code (grep for a submit call in apps/web/src/app/(app)/designer found none other than review actions), and backend enforcement at submit or publish is cannot-verify (citizen-service absent).
- **Files to change:** `apps/web/src/app/(app)/designer/_data/documentBuilderModel.ts`, `apps/web/src/app/(app)/designer/[id]/b6/page.tsx`, `apps/web/src/app/(app)/designer/[id]/review/page.tsx`
- **Fix steps:**
  1. Product decision: block or warn. If block, export `hasBlockingDocumentIssues(assessments)` from documentBuilderModel.ts.
  2. In b6/page.tsx, disable Next (like b5's hoaBlocked pattern) while a mandatory document has kind 'missing_lane' or 'stale_lane', and explain why beside the button.
  3. Show the outstanding document warnings as a list on the review page above the Approve action, so the checker sees them.
  4. Ask backend to reject submit or publish for a mandatory document without a verifying lane.
- **Acceptance:**
  - Test: hasBlockingDocumentIssues is true for a mandatory doc with empty verifiedAtLane and false once linked.
  - b6 page: Next is disabled with an explanation while a mandatory document has no lane.
  - Review page lists the unverified mandatory documents.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Submission gating; a hard block may stop services whose documents are verified outside the workflow. Confirm with product.

### GAP-DESIGNER-DETAIL-B6-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by 489cf84c6 (UAT B4, 2026-10-27).
- **First-pass claim:** Preview language toggle offers fixed languages while B1 stores tenant locales (en, or); Odia is not previewable if the toggle is English/Hindi only (DocumentsBuilder.tsx:81 vs GovernanceLinkageBuilder.tsx:156-168).
- **Verified evidence:** DocumentsBuilder.tsx:82 hard-codes the preview toggle as ['en','hi']. LocaleKey is 'en' | 'hi' only (LocaleTabs.tsx:5), documents store labels as {en, hi} (documentTypes.ts:3-6), and documentBuilderApi.ts:13-38 persists only those two. B1's locale list is free text (GovernanceLinkageBuilder.tsx:152-171, placeholder 'en, or', hint 'e.g. en, or'), so a tenant that publishes in Odia ('or') cannot author or preview Odia document names. The two places are not connected. The locale completeness meter (documentsLocaleCompleteness) is also en/hi only.
- **Files to change:** `apps/web/src/app/_components/ds/designer/documentTypes.ts`, `apps/web/src/app/_components/ds/designer/LocaleTabs.tsx`, `apps/web/src/app/(app)/designer/_components/DocumentsBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/documentBuilderApi.ts`, `apps/web/src/app/(app)/designer/_data/documentBuilderModel.ts`, `apps/web/src/app/(app)/designer/[id]/b6/page.tsx`
- **Fix steps:**
  1. Change LocaleLabels to Record<string,string> and LocaleKey to string. Load the service's locales from usePhase3Config in b6/page.tsx and pass them as a `locales` prop to DocumentsBuilder.
  2. Make LocaleTabs and the preview toggle render one tab per configured locale, with the native script label from a small locale-name map (en, hi, or, etc.).
  3. Update buildCitizenUploadPreview, documentsLocaleCompleteness and the meter to work over the configured locales.
  4. Extend documentsUiToApi and documentsApiToUi to persist all locale labels (confirm the requiredDocuments API accepts extra keys).
- **Acceptance:**
  - With locales ['en','or'], the editor shows English and Odia tabs and the preview toggle includes Odia.
  - Locale completeness meter shows 'EN 2/2 · OR 1/2'.
  - Round-trip test: an Odia label is saved and reloaded unchanged.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Existing saved documents only have en and hi; loading must default missing locales to empty. A backend contract change may be needed to store more locales.

### GAP-DESIGNER-DETAIL-B6-03  ·  MEDIUM  ·  confirmed  ·  theme DPDP-CLASSIFICATION (was PII)

- [~] **Status** NEEDS OWNER DECISION: DPO must supply classified document catalogue, `[~]` if blocked + reason)
- **First-pass claim:** Document types are free labels; no link to a DPDP-classified document category (Aadhaar copy, income certificate) and no retention hint (documentBuilderModel.ts).
- **Verified evidence:** documentTypes.ts:10-18 RequiredDocumentUi has docType (a slug generated from the typed name by slugifyDocType, :33-40), labels, formats, maxSizeMb, mandatory and verifiedAtLane. There is no category, sensitivity or retention field, and no link to a shared document-type catalogue. DocumentsBuilder.tsx:373-385 sets docType from the free-text name. documentBuilderModel.ts has no classification logic. Two designers can therefore create 'Aadhaar copy' documents with different docType slugs, and no retention hint is shown. Whether the platform has a document-category catalogue or retention policy is cannot-verify. Masking (<Masked>) is not the right fix here, since the builder shows no personal data. The need is a classified catalogue.
- **Files to change:** `apps/web/src/app/_components/ds/designer/documentTypes.ts`, `apps/web/src/app/(app)/designer/_components/DocumentsBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/documentBuilderApi.ts`
- **Fix steps:**
  1. Get from the DPO / records team a catalogue of document categories (id, label, sensitivity, retention period). Expose it through an endpoint or a shared constant.
  2. Add `categoryId` to RequiredDocumentUi and a 'Document category' select in the document editor. Prefill docType from the category and keep free-text as a labelled 'Other' option.
  3. Show the sensitivity badge and the retention hint under the select, and add a note for sensitive categories (e.g. Aadhaar).
  4. Persist categoryId in documentsUiToApi and show it in the review summary.
- **Acceptance:**
  - Editor shows a category select; choosing 'Aadhaar copy' shows a sensitive badge and the retention hint.
  - The saved requiredDocuments payload contains categoryId.
  - Two documents with the same category share one docType value.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP compliance. Wrong retention hints could mislead. Existing services with free-text docTypes need a migration or an 'Other' fallback.

### GAP-DESIGNER-DETAIL-B6-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: responsive grid already in place), `[~]` if blocked + reason)
- **First-pass claim:** Master/detail with a 'Select a document from the list to edit it.' empty right pane collapses poorly on mobile (DocumentsBuilder.tsx:498).
- **Verified evidence:** DocumentsBuilder.tsx:306 uses `display:'grid', gridTemplateColumns:'1fr 1fr'` inline with no breakpoint, so the list and editor stay side by side at phone width. The empty right pane text is at :498 ('Select a document from the list to edit it.') with the card title 'Select a document' (:362). On a small screen both columns become very narrow. The same fixed-column pattern exists in FeeBuilder.tsx:170 (`1fr minmax(240px,300px)`).
- **Files to change:** `apps/web/src/app/(app)/designer/_components/DocumentsBuilder.tsx`
- **Fix steps:**
  1. Change the grid to `gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'` (or a CSS class with a media query) so it stacks below ~640px.
  2. On narrow screens, hide the empty 'Select a document' pane until a document is selected, and add a 'Back to list' button in the editor.
  3. Apply the same treatment to FeeBuilder's two-column layout.
- **Acceptance:**
  - At 375px width the list and editor stack with no horizontal scroll.
  - With no document selected on mobile, no empty pane takes vertical space.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Visual only.

### GAP-DESIGNER-DETAIL-B6-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Formats are shown as file-extension tokens (pdf/jpg/png), no size-in-bytes helper for citizens.
- **Verified evidence:** Formats are shown as uppercase tokens PDF/JPG/PNG (documentTypes.ts:23-27; toggle buttons DocumentsBuilder.tsx:391-400; preview formatsLabel in documentBuilderModel.ts:155). But size is shown: the editor has 'Max size (MB)' (:404-411, min 1 max 50), and the citizen preview shows 'Max 5 MB' (maxSizeLabel, documentBuilderModel.ts:163, rendered :152). A bytes helper would not help citizens, since MB is the right unit. Small real issues: 0, blank or non-numeric size silently falls back to 5 (`Number(...)||5`, :410), and the format toggle silently resets to ['pdf'] when the last format is deselected (:260). Overall a copy nit.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/DocumentsBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/documentBuilderModel.ts`
- **Fix steps:**
  1. Add plain-language format labels in the citizen preview: 'PDF, JPG or PNG' instead of 'PDF, JPG, PNG' tokens, and a hint 'Photos taken on a phone are usually JPG'.
  2. Show inline validation for the size field (1 to 50) rather than silently resetting to 5.
  3. Tell the designer when the last format cannot be removed.
- **Acceptance:**
  - Preview shows readable format text and size (e.g. 'PDF or JPG, up to 5 MB').
  - Entering 0 in max size shows an error instead of quietly becoming 5.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /designer/[id]/b7  —  `designer/detail-b7.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b7/page.tsx`
- **Design reference:** `redesign/designer/detail-b7.html`

### GAP-DESIGNER-DETAIL-B7-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** Closed by 14fbd950e (UAT B4, 2026-10-27). Canonical path: the Output tab edits validity; renewalPolicy is derived from it in the same PATCH, no backend schema change needed.
- **W0-10 note:** review found the W0 tick wrong — Both Validity & renewal editors still rendered and editable on B7: b7/page.tsx:172-175 RenewalPolicyBuilder still persists via phase3.patch (only a warning note added :150-171, not read-only/derived); onDesignPersisted (:98-109) swallows errors and OutputIssuanceBuilder.tsx:80 does not await so offline state never fires; acceptance (one editor, one PATCH path, failure -> offline) all unmet.
- **First-pass claim:** Two separate 'Validity & renewal' editors on one page (OutputIssuanceBuilder Card and RenewalPolicyBuilder) with different field sets and different persistence paths (service design vs phase3 config) can disagree (OutputIssuanceBuilder.tsx:272-338 vs RenewalPolicyBuilder.tsx:46-111, b7/page.tsx).
- **Verified evidence:** Two validity and renewal editors. (1) OutputIssuanceBuilder.tsx:271-356 'Validity & renewal' tab edits design.validityMode (duration / fixed_date / none), validityYears, validityFixedDate, renewable and renewalWindowDays (min 1, default 30). It is saved via issuanceBuilderApi (fields at :17-21,36-40) into updateServiceDefinition({issuanceType, outputs}) (b7/page.tsx:98-105). (2) RenewalPolicyBuilder.tsx:46-111 edits a separate renewalPolicy (validityMode 'none' | 'duration' | 'fixed_date', validityYears, validityFixedDate, renewable, renewalWindowDays min 0), saved via phase3.patch({renewalPolicy}) (b7/page.tsx:151-154). The labels and defaults differ. The issuance default is 'duration' for non-closure outputs (issuanceTypes.ts:123), while renewalPolicy defaults to 'none' / never expires. No code syncs them. Related: OutputIssuanceBuilder.schedulePersist (:75-86) calls onDesignPersisted without awaiting it, and the page's onDesignPersisted swallows errors (b7/page.tsx:106), so the footer says 'saved' even if the PATCH failed.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b7/page.tsx`, `apps/web/src/app/(app)/designer/_components/OutputIssuanceBuilder.tsx`, `apps/web/src/app/(app)/designer/_components/RenewalPolicyBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/issuanceBuilderApi.ts`
- **Fix steps:**
  1. Product/backend decision: which is the source of truth (output validity in `outputs` versus `renewalPolicy`). Keep one storage path.
  2. Remove the duplicate editor: drop the 'Validity' tab from OutputIssuanceBuilder (keep its summary via validitySummary as read-only) or drop RenewalPolicyBuilder, and feed the surviving editor from the chosen field.
  3. Until unified, derive one from the other in b7/page.tsx (a single onChange updates both) and show a warning when they disagree.
  4. Make OutputIssuanceBuilder.schedulePersist await onDesignPersisted, and rethrow from b7/page.tsx so onSaveState('offline') actually fires.
- **Acceptance:**
  - Only one 'Validity & renewal' editor is visible on B7.
  - Changing validity in the editor updates the saved definition exactly once (one PATCH path), verified in a test.
  - Simulated PATCH failure makes the footer show 'offline'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Validity and renewal drive licence expiry for citizens. Migrating stored values from both places must not change existing licences' expiry.

### GAP-DESIGNER-DETAIL-B7-02  ·  MEDIUM  ·  partly  ·  theme OTHER (was I18N)

- [~] **Status** NEEDS OWNER DECISION: legal/product must confirm supported signature methods, `[~]` if blocked + reason)
- **First-pass claim:** Signatory is a designation plus a free label; no eSign/DSC or seal option appears in OutputIssuanceBuilder or issuanceBuilderModel (grep for dsc/esign/seal finds none), while Court orders in the same suite require a DSC (OutputIssuanceBuilder.tsx:217-251).
- **Verified evidence:** The claim that no DSC or eSign option exists is wrong. OutputIssuanceBuilder.tsx:255-262 has a checkbox 'Require digital signature at issue time' bound to design.digitalSignature. signatoryWarning (issuanceBuilderModel.ts:139-152) says 'Digital signature will be required at issue time (DSC / eSign when the tenant has it configured)'. The signatory is a designation select (:220-237) plus a free label (:244-254). What is really missing: choosing the signature method (DSC token vs Aadhaar eSign), binding to a specific signer certificate, and any seal or stamp option; nothing in the builder or issuanceBuilderModel mentions a seal. Whether the issuance pipeline enforces DSC for Court orders is cannot-verify (court module absent). The I18N theme tag is wrong.
- **Files to change:** `apps/web/src/app/_components/ds/designer/issuanceTypes.ts`, `apps/web/src/app/(app)/designer/_components/OutputIssuanceBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/issuanceBuilderModel.ts`, `apps/web/src/app/(app)/designer/_data/issuanceBuilderApi.ts`
- **Fix steps:**
  1. Product/legal decision: which signature methods and seal types the platform supports (DSC, Aadhaar eSign, e-seal).
  2. Replace the boolean `digitalSignature` with `signatureMethod: 'none' | 'dsc' | 'esign' | 'eseal'` (keep the old boolean mapped for stored data) and render a select under the Signatory tab.
  3. Update signatoryWarning to explain the chosen method and warn when the tenant has not configured it.
  4. Persist signatureMethod in issuanceUiToOutput and read it back in the API mapper.
- **Acceptance:**
  - Signatory tab offers a method select; the warning text changes with the method.
  - Old drafts with digitalSignature=true load as method 'dsc' (or the agreed default).
  - Round-trip test for signatureMethod.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Legal validity of issued documents. Do not mark documents as signed unless the pipeline actually applies the signature.

### GAP-DESIGNER-DETAIL-B7-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** Closed by a97cee585 (UAT B4, 2026-10-27). Reset policy is stored in the output design (outputs is schemaless JSON, no migration); the numbering is never applied retroactively. Gap/reuse handling is not modelled because no issuance numbering service exists in the repo to define it.
- **First-pass claim:** Numbering format is free-form; collision/gap policy across financial years is not surfaced (NumberingFormatBuilder).
- **Verified evidence:** The numbering is not free-form text. NumberingFormatBuilder.tsx offers a token composer (Prefix, Ward, Year, Office, Sequence with a width of 3-10) and a preview (formatNumberingPreview, issuanceTypes.ts:133-154). numberingWarning (issuanceBuilderModel.ts:97-103) only checks that at least one segment exists and that a Sequence is included. What is true: the Year token is the calendar year (`new Date().getFullYear()`, issuanceTypes.ts:134), not a financial year, and nothing is offered for sequence reset (per year, per office, per FY), gap handling, or collision. Nothing prevents two Sequence tokens or a numbering scheme without an Office or Year token, which can collide across offices. Whether the backend numbering service enforces uniqueness is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/ds/designer/issuanceTypes.ts`, `apps/web/src/app/_components/ds/designer/NumberingFormatBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/issuanceBuilderModel.ts`
- **Fix steps:**
  1. Ask backend/product for the numbering service's reset and uniqueness rules (scope of the sequence).
  2. Add `resetPolicy: 'never' | 'calendar_year' | 'financial_year'` to the numbering config and a select in NumberingFormatBuilder; add an 'FY' token (e.g. 2026-27) beside 'Year'.
  3. Extend numberingWarning: more than one Sequence token; multi-office service without an Office token; policy 'never' with a Year token.
  4. Show a helper text 'Sequence restarts each <policy>; gaps are/aren't reused' once the rule is confirmed.
- **Acceptance:**
  - Adding two Sequence tokens shows a warning.
  - A reset-policy select is present and its value is saved and reloaded.
  - Preview shows an FY token as '2026-27'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Duplicate or non-sequential certificate numbers create audit problems. Changing the scheme on a live service must not renumber issued documents.

### GAP-DESIGNER-DETAIL-B7-04  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: b7 help text lists all four output types), `[~]` if blocked + reason)
- **First-pass claim:** Section headings 'Output' vs help text 'certificate or closure note' vs page title 'Output & Issuance' use three names for the same thing.
- **Verified evidence:** Not three names for one thing, but inconsistent naming. Block label is 'Output & Issuance' (designerConstants.ts:39), also used as the HelpTip term (b7/page.tsx:137). The help text says 'Design the certificate or closure note, numbering format, signatory, and validity period.' (:138), listing only two of the four output types. OUTPUT_TYPE_OPTIONS (issuanceTypes.ts:31-36) are Certificate, Licence, Closure note and Receipt. The first tab is renamed dynamically by tabLabelForOutputType (issuanceBuilderModel.ts:255-266), so it reads 'Certificate', 'Licence', etc. and the card title is `${primaryTab} template`. That dynamic tab is intentional. The plain word 'Output' appears only in the RenewalPolicyBuilder ('how long the output stays valid') and a 'Valid for' label. The I18N theme tag is wrong (no next-intl in these files, but that is a separate matter).
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b7/page.tsx`, `apps/web/src/app/(app)/designer/_components/RenewalPolicyBuilder.tsx`
- **Fix steps:**
  1. Reword the B7 help text to 'Design what citizens receive (certificate, licence, closure note or receipt): template, numbering, signatory and validity.'
  2. Replace 'output' in RenewalPolicyBuilder copy with 'document' (or the term agreed with UX copy).
  3. Add the agreed terms to the designer glossary/copy guide.
- **Acceptance:**
  - B7 help text lists all four output types.
  - grep for the word 'output' in user-visible strings under the B7 components returns only agreed usages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-DESIGNER-DETAIL-B7-05  ·  LOW  ·  partly  ·  theme OTHER (was I18N)

- [~] **Status** NEEDS OWNER DECISION: PDF service must confirm supported paper sizes, `[~]` if blocked + reason)
- **First-pass claim:** Certificate layout is edited on a TemplateCanvas component (OutputIssuanceBuilder.tsx:177) with a merge-field picker; no print-size/paper setting was found in the copy.
- **Verified evidence:** OutputIssuanceBuilder.tsx:177-189 renders TemplateCanvas with a MergeFieldPicker (TemplateCanvas.tsx:78) and a portrait/landscape toggle (:80-95), and orientation is persisted (issuanceBuilderApi.ts:22,41,72). The canvas preview size is hard-coded to A4 (210x297 mm, TemplateCanvas.tsx:72-73). There is no paper-size selection (A4, A3, Legal) or margin setting, and no indication of A4 to the designer. Whether the PDF renderer supports other sizes is cannot-verify. The I18N theme tag does not fit.
- **Files to change:** `apps/web/src/app/_components/ds/designer/TemplateCanvas.tsx`, `apps/web/src/app/_components/ds/designer/issuanceTypes.ts`, `apps/web/src/app/(app)/designer/_data/issuanceBuilderApi.ts`
- **Fix steps:**
  1. Confirm supported paper sizes in the issuance/PDF service.
  2. Add `paperSize: 'A4' | 'A3' | 'Legal'` to IssuanceDesignState (default 'A4') and a select next to the orientation toggle.
  3. Drive mmWidth/mmHeight in TemplateCanvas from paperSize and orientation, and label the preview ('A4 - portrait, 210 x 297 mm').
  4. Persist paperSize in issuanceUiToOutput and map it back.
- **Acceptance:**
  - The canvas shows the paper size label; changing size changes the preview aspect ratio.
  - Round-trip test for paperSize; existing drafts default to A4.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low, if the PDF service ignores paperSize it would mislead designers; ship only when the renderer supports it.


---
## /designer/[id]/b8  —  `designer/detail-b8.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/b8/page.tsx`
- **Design reference:** `redesign/designer/detail-b8.html`

### GAP-DESIGNER-DETAIL-B8-01  ·  HIGH  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1934, verified on main 101076c1a)
- **First-pass claim:** Locale tabs and the completeness warning are hard-coded to Hindi and English while B1 defines tenant locales such as 'en, or' (Odia); an Odia-only service cannot satisfy the check (NotificationsBuilder.tsx summary vs GovernanceLinkageBuilder.tsx:156-168).
- **Verified evidence:** NotificationsBuilder.tsx:91-99 renders the completeness note 'missing Hindi or English - fill both locale tabs before submit'; templates are typed with fixed en/hi bodies (ds/designer/notificationTypes.ts:14, cellChipLabel reads body.en/body.hi). B1 GovernanceLinkageBuilder.tsx:156-168 lets the tenant enter locales such as 'en, or'. So en/hi is hard-coded and Odia cannot be authored. However the note is only advisory text (not wired to canSubmit in useDesignerWizard.ts:98), so an Odia-only service is not blocked, just mis-warned and unable to author Odia templates.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/NotificationsBuilder.tsx`, `apps/web/src/app/_components/ds/designer/notificationTypes.ts`, `apps/web/src/app/(app)/designer/_data/notificationBuilderModel.ts`, `apps/web/src/app/(app)/designer/_data/notificationBuilderApi.ts`
- **Fix steps:**
  1. Load service locales (B1 governance config, same source as GovernanceLinkageBuilder) into NotificationsBuilder as a prop.
  2. Change LocaleTemplateBody to Record<string,string> keyed by locale code; migrate en/hi seeds.
  3. Render locale tabs from the locales list; compute localesComplete over that list in notificationBuilderModel.
  4. Replace hard-coded 'Hindi or English' copy with names of the missing locales.
  5. Update notificationsConfigToUi/UiToConfig to round-trip arbitrary locale keys.
- **Acceptance:**
  - Unit: service with locales ['en','or'] shows tabs En and Odia, no Hindi tab.
  - Unit: enabled cell with en+or filled gives localesComplete true.
  - Manual: existing en/hi services still load and save unchanged.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing body shape affects persisted outputs config; needs backward-compatible reader for en/hi.
- **Depends on:** GAP-DESIGNER-DETAIL-B8-04

### GAP-DESIGNER-DETAIL-B8-02  ·  MEDIUM  ·  partly  ·  theme COPY (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Webhook subscriptions default to events ['application.issued'] and label events by stripping the 'application.' prefix, so users see raw tokens (issued, …); the signing secret is write-only and shown as password input, which is right, but there is no test-delivery button (WebhookSubscriptionsBuilder.tsx:66,125).
- **Verified evidence:** WebhookSubscriptionsBuilder.tsx:66 add() defaults events to ['application.issued']; :125 labels events with event.replace('application.','') so raw tokens appear. Signing secret is type=password, autoComplete=new-password, placeholder 'Set - type to replace' (write-only, fine). No test/ping delivery control exists in the file. Theme is not PII: the payload note says case metadata only; no masking issue.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/WebhookSubscriptionsBuilder.tsx`
- **Fix steps:**
  1. Add EVENT_LABELS map (e.g. application.issued -> 'Certificate issued') and render it instead of the stripped token.
  2. Optionally default events to [] with the existing 'select at least one' hint, or keep default but show label.
  3. Test-delivery button requires a backend endpoint; raise as decision/backend before building.
- **Acceptance:**
  - Component test: checkbox label reads 'Certificate issued' not 'issued'.
  - Secret input remains type=password and value never rendered in DOM text.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; test-delivery would need SSRF guard server side.

### GAP-DESIGNER-DETAIL-B8-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [~] **Status** NEEDS OWNER DECISION: product must declare required vs optional blocks, `[~]` if blocked + reason)
- **First-pass claim:** canRunTest treats 'in-progress' blocks as complete enough, so Run Test enables almost immediately; Submit still requires a passing test (useDesignerWizard.ts:37-39,97-98).
- **Verified evidence:** useDesignerWizard.ts:37-39 blocksCompleteEnough accepts 'complete' or 'in-progress' for every non-hidden block; :31 forces b8 to always 'in-progress'; b5 is in-progress as soon as feeModel exists (:24-ish). :97 canRunTest = that; :98 canSubmit additionally needs testPassed and draft/unsubmitted. Note also empty blocks fail the check (b2..b7 'empty'), so it is not 'immediately' but as soon as each block has any content.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/useDesignerWizard.ts`
- **Fix steps:**
  1. Split completeness: canRunTest requires 'complete' for required blocks (b1-b7 per pattern), allow in-progress only for b8.
  2. Give blockStatusForDef real b8 status from def.outputs/notifications rather than constant.
  3. Show which blocks block the Run Test button (tooltip via WizardShell).
- **Acceptance:**
  - Unit: def with feeModel but no hoaCode gives canRunTest false.
  - Unit: all required blocks complete gives canRunTest true.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Stricter gating may block makers on optional blocks; confirm which are required per pattern.
- **Depends on:** GAP-DESIGNER-DETAIL-REVIEW-05

### GAP-DESIGNER-DETAIL-B8-04  ·  MEDIUM  ·  confirmed  ·  theme COMPLIANCE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** SMS length hint says 'under 160 characters' but Odia/Hindi SMS are Unicode (70-char segments); no DLT template id field for Indian SMS compliance (notificationTypes.ts:45).
- **Verified evidence:** ds/designer/notificationTypes.ts:45 hint 'keep under 160 characters'; :258-260 smsSegmentCount uses 160/153 thresholds on text.length and smsStats warns only above 160. Hindi/Odia bodies (UCS-2) segment at 70/67, so counts are wrong. Grep found no DLT / template-id field in designer UI code.
- **Files to change:** `apps/web/src/app/_components/ds/designer/notificationTypes.ts`, `apps/web/src/app/(app)/designer/_components/NotificationsBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/notificationBuilderApi.ts`
- **Fix steps:**
  1. In smsSegmentCount detect any non-GSM-7 char and use 70/67 limits; update smsStats warning and the SMS hint text.
  2. Add optional dltTemplateId (and dltEntityId if required) to the SMS cell binding and its UI/config mapping.
  3. Show error when SMS enabled without DLT id if tenant compliance flag requires it (decision).
- **Acceptance:**
  - Unit: smsSegmentCount of 71 Devanagari chars = 2.
  - Unit: 160 ASCII chars = 1, 161 = 2.
  - Manual: DLT id persists after reload.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DLT id needs backend storage and SMS gateway use; segment count only affects warnings.

### GAP-DESIGNER-DETAIL-B8-05  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Save label in the wizard shell is static in hooks that use useDesignerWizard (saveState never changes).
- **Verified evidence:** b8/page.tsx:125 passes its own useState saveState, updated by NotificationsBuilder onSaveState, so the label does change for notifications. The hook's saveState (useDesignerWizard.ts:45, no setter) is a constant 'saved', consumed only by test/page.tsx:75 (a page that saves nothing). Real gap: webhook edits on b8 go through phase3.patch (b8/page.tsx ~150) and never drive saveState, and the hook exposes a dead constant.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b8/page.tsx`, `apps/web/src/app/(app)/designer/_data/useDesignerWizard.ts`, `apps/web/src/app/(app)/designer/_data/usePhase3Config.ts`
- **Fix steps:**
  1. Have usePhase3Config expose a saving/error status and merge it with notifications saveState on b8.
  2. Remove the constant saveState from useDesignerWizard or make it real; test page can pass 'saved' explicitly.
- **Acceptance:**
  - Manual: toggle a webhook, label shows Saving then Saved; offline shows 'Offline - retrying'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /designer/[id]/engines  —  `designer/detail-engines.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/engines/page.tsx`
- **Design reference:** `redesign/designer/detail-engines.html`

### GAP-DESIGNER-DETAIL-ENGINES-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Page is orphaned: B5's Engine model is disabled (engineAvailable={false}) and no link points at /designer/[id]/engines, so the only way in is a typed URL (b5/page.tsx vs engines/page.tsx).
- **Verified evidence:** b5/page.tsx:179 passes engineAvailable={false} to FeeBuilder; FeeBuilder.tsx:332 only renders engine UI when design.feeModel==='engine' && engineAvailable and modelCardDisabled (:157,:209) blocks selecting it. Repo-wide grep finds no href/router.push to /designer/{id}/engines (only engineBindingApi calling /api/proxy/v1/citizen/engines). The engines page (engines/page.tsx) is reachable only by typed URL. Route itself works and is a full implementation.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/b5/page.tsx`, `apps/web/src/app/(app)/designer/_components/FeeBuilder.tsx`
- **Fix steps:**
  1. Decide: enable (engineAvailable from engine registry probe via engineBindingApi list) or remove the page.
  2. If enabling: in b5, set engineAvailable from fetch of citizen/engines and add a Link to /designer/${id}/engines under the Engine model card.
  3. Otherwise delete engines/page.tsx and EngineBindingBuilder or hide behind feature flag.
- **Acceptance:**
  - Manual: with engines available, B5 Engine card is selectable and links to /engines.
  - Test: no orphan route (nav manifest test).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Engine bindings feed tax computation; enabling exposes unfinished feature, confirm readiness.

### GAP-DESIGNER-DETAIL-ENGINES-02  ·  HIGH  ·  partly  ·  theme VALIDATION

- [x] **Status** (W2 PQ: closed by #N -- parsePercentToBps/parseDays wired; inline errors; validateEngineConfig gates save)/parsePercentToBps exist in engineBindingTypes.ts but are never called; EngineBindingBuilder still uses the silently clamping percentInputToBps (fix steps 2-3))
- **First-pass claim:** Rebate/penalty percentages and exemption percentages are free numeric inputs feeding a tax computation with no range validation surfaced in the UI (EngineBindingBuilder.tsx:333-451).
- **Verified evidence:** Inputs are not free: EngineBindingBuilder.tsx:369-374,420-425,442-446 have type=number min=0 max=100 and percentInputToBps (engineBindingTypes.ts:99-103) clamps to 0..10000 bps and coerces invalid to 0. So range is enforced silently, with no message, and days fields (:432,:454,:487) only have min=0 (Number(x)||0, no max, no integer check). No zod schema and no cross-field checks (e.g. rebate window vs penalty start, exemption total > 100). Amounts are handled as bps/integers, not float money.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/EngineBindingBuilder.tsx`, `apps/web/src/app/_components/ds/designer/engineBindingTypes.ts`
- **Fix steps:**
  1. Add zod schema engineConfigSchema (percent 0-100 with <=2 dp, days int 0-365, sum of exemptions <=100%).
  2. Run safeParse on change/save; show inline error per field instead of silently clamping to 0.
  3. Disable Save/preview while schema invalid.
- **Acceptance:**
  - Unit: percentInputToBps('150') is reported as error, not clamped silently.
  - Component: negative days shows message and blocks save.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Silent coercion of invalid input to 0 could zero a penalty; fix reduces that risk.

### GAP-DESIGNER-DETAIL-ENGINES-03  ·  MEDIUM  ·  partly  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Engine key is a raw dotted identifier ('revenue.assessment') in the empty-state copy and selector (EngineBindingBuilder.tsx:268).
- **Verified evidence:** EngineBindingBuilder.tsx:268 empty-state message contains 'bind revenue.assessment' (raw key); :293 shows `{b.block} · {b.engineKey}` raw; selector (:227-231) keys by engineKey. Registry entries may carry a display name; not checked in the snapshot. Strings are also hard-coded English (no next-intl in this file).
- **Files to change:** `apps/web/src/app/(app)/designer/_components/EngineBindingBuilder.tsx`, `apps/web/src/app/(app)/designer/_data/engineBindingApi.ts`
- **Fix steps:**
  1. Use registry entry display name (fallback humanized key) in the list, chips and empty-state copy.
  2. Keep engineKey in a small monospace secondary line for support.
  3. Extract strings to messages catalogue.
- **Acceptance:**
  - Component: bound engine chip shows display name, not 'revenue.assessment'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-DETAIL-ENGINES-04  ·  MEDIUM  ·  confirmed  ·  theme MONEY

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Designer code carries three separate paise formatters (formatMoney in lib/formatters, formatPaise in sandboxTestModel.ts:72, formatPaiseInr in versionDiffModel.ts:22) with different fraction rules (whole rupees drop decimals in the diff view only), so the same fee reads differently on B5, test and review (EngineBindingBuilder/FeeBuilder use formatMoney).
- **Verified evidence:** Three formatters: lib/formatters.ts:90 formatMoney (always 2dp); sandboxTestModel.ts:72 formatPaise (own toLocaleString, always 2dp, via minorToRupeesOrNull); versionDiffModel.ts:22 formatPaiseInr (amountMinor/100 float, drops decimals when whole rupees - '₹500' vs '₹500.00'). formatPaiseInr is used in the diff and in feeSummaryForPublish (:209) on the publish dialog. EngineBindingBuilder.tsx:547,553 and FeeBuilder.tsx:682,697 use formatMoney. Values are JS numbers, not bigint.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/sandboxTestModel.ts`, `apps/web/src/app/(app)/designer/_data/versionDiffModel.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace formatPaise and formatPaiseInr bodies with formatMoney (keep exports as thin wrappers or delete and update callers).
  2. Keep the currency!=INR branch only if a caller needs it.
  3. Update snapshot tests in versionDiffModel/sandboxTestModel tests.
- **Acceptance:**
  - Unit: formatPaiseInr(50000) === formatMoney(50000).
  - Manual: same fee reads identically on B5, test, review dialog.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Text-only, but golden tests expecting '₹500' must change.

### GAP-DESIGNER-DETAIL-ENGINES-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: no FN-21 in visible text), `[~]` if blocked + reason)
- **First-pass claim:** Internal ticket code 'FN-21' is shown in the UI header.
- **Verified evidence:** engines/page.tsx:113 renders 'Engine binding (FN-21)' in the visible breadcrumb line; :16 FN-21 is only in a code comment (fine). Also similar ticket tags in other builders (e.g. 'FN-18 / FN-32' are comments).
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/engines/page.tsx`
- **Fix steps:**
  1. Change the span text to 'Engine binding'.
- **Acceptance:**
  - Manual: no 'FN-' string in rendered page (grep DOM).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /designer/[id]/review  —  `designer/detail-review.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/review/page.tsx`
- **Design reference:** `redesign/designer/detail-review.html`

### GAP-DESIGNER-DETAIL-REVIEW-02  ·  HIGH  ·  partly  ·  theme GATING (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Accessibility panel says 'Must fix before publishing' but the Approve & Publish button is only disabled while busy; errors do not gate publish (AccessibilityPreview.tsx:87 vs review/page.tsx:158).
- **Verified evidence:** AccessibilityPreview.tsx:87 heading 'Must fix before publishing' for severity==='error' issues. review/page.tsx:158-160 Approve & Publish is disabled only by `busy`; page never receives preview.passed/errorCount (component fetches internally via fetchA11yPreview). Publish endpoint enforcement is server-side in a service absent from this snapshot (citizen-service), so cannot tell if the API also blocks. UI copy therefore promises a gate the UI does not apply. Theme is publish-gating, not I18N.
- **Files to change:** `apps/web/src/app/(app)/designer/_components/AccessibilityPreview.tsx`, `apps/web/src/app/(app)/designer/[id]/review/page.tsx`
- **Fix steps:**
  1. Lift fetchA11yPreview into review page (or add onResult callback prop) exposing errorCount.
  2. Disable Approve & Publish and show reason when errorCount>0.
  3. Confirm server publish also rejects; if not, add backend check.
- **Acceptance:**
  - Component: preview with 1 error disables Approve & Publish.
  - Component: warnings only leaves it enabled.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Blocks publish on a11y errors; agree policy with GIGW owners.

### GAP-DESIGNER-DETAIL-REVIEW-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Read-only summary shows a raw id fragment ('Form linked (3f9a12c0…)') and 'Approval chain configured' without content, so the approver cannot inspect what they publish (review/page.tsx blockSummary).
- **Verified evidence:** review/page.tsx blockSummary: b2 `Form linked (${def.formId.slice(0,8)}…)`; b4 'Approval chain configured' if workflowDefinitionId; b3 'Eligibility rules configured'; b8 constant 'Notification matrix configured'; b5 does show model+HOA; b6 shows count. Approver sees ids/booleans not contents.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/review/page.tsx`
- **Fix steps:**
  1. Fetch names/summaries: form title & field count (loadFormDesign), eligibility rule count, approval lane names, notification channel counts.
  2. Replace id fragment with the name; link 'View' to the block page read-only.
  3. Fall back to 'Configured' only if the fetch fails.
- **Acceptance:**
  - Component: b2 row shows form title, no hex id.
  - Component: b4 row lists lane names.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Extra fetches on review; failures must not block review.
- **Depends on:** GAP-DESIGNER-DETAIL-REVIEW-04

### GAP-DESIGNER-DETAIL-REVIEW-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Publish dialog copy shows the fee but not the HOA, SLA or approval lanes that will go live (feeSummaryForPublish only).
- **Verified evidence:** review/page.tsx:183-192 ConfirmDialog description = name, version, feeSummaryForPublish (versionDiffModel.ts:205: fee model, from-amount, HOA if present) and 'Citizens will see this service once published'. So HOA is included when set; SLA and approval lanes are not. Approve has no reason field (reject uses requireReason). Maker!=checker is UI-derived (isChecker at :49) - server enforcement cannot be verified here; audit event emission is backend.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/review/page.tsx`, `apps/web/src/app/(app)/designer/_data/versionDiffModel.ts`
- **Fix steps:**
  1. Extend feeSummaryForPublish (or new publishSummary) to include SLA days, channels and approval lane count/names.
  2. Render as a small list in the dialog.
  3. Confirm backend rejects publish by the submitter and emits audit event (verify in service).
- **Acceptance:**
  - Component: dialog lists SLA and lanes.
  - Manual: submitter cannot publish via direct API call (backend test).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Publish is an approval action; dialog content only, low regression risk.
- **Depends on:** GAP-DESIGNER-DETAIL-REVIEW-03

### GAP-DESIGNER-DETAIL-REVIEW-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: block status override removed), `[~]` if blocked + reason)
- **First-pass claim:** Review shell passes saveState='saved' and forces every block status to 'complete' regardless of real state (review/page.tsx WizardShell props).
- **Verified evidence:** review/page.tsx:117 saveState="saved" literal; :118 blocks={wizard.blocks.map(b=>({...b,status:'complete'}))} overrides real statuses, so an incomplete draft looks complete to the approver.
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/review/page.tsx`
- **Fix steps:**
  1. Pass wizard.blocks unchanged (or only override the 'review' entry).
  2. Use wizard.saveState or omit save label in read-only review.
- **Acceptance:**
  - Component: draft with empty b6 shows 'Not started' in rail on review page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; may reveal incomplete blocks on submitted definitions.
- **Depends on:** GAP-DESIGNER-DETAIL-B8-03


---
## /designer/[id]/test  —  `designer/detail-test.html`

- **Source:** `apps/web/src/app/(app)/designer/[id]/test/page.tsx`
- **Design reference:** `redesign/designer/detail-test.html`

### GAP-DESIGNER-DETAIL-TEST-02  ·  MEDIUM  ·  partly  ·  theme STALE (was VALIDATION)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Test passes are keyed to a run, not to the current design version; editing a block after a pass does not visibly invalidate it in the UI, so canSubmit can stay true on stale results (useDesignerWizard.ts:98, TestRunPanel history).
- **Verified evidence:** useDesignerWizard.ts:98 canSubmit uses testPassed from fetchLatestSandboxTest (reload at :51-52) which returns the latest run status only; no run/version/updatedAt comparison client-side. Whether the backend invalidates 'latest' on definition change cannot be verified (citizen-service absent). Client also has createdAt on the run and def.updatedAt could be compared if present in ServiceDefinitionDto.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/useDesignerWizard.ts`, `apps/web/src/app/(app)/designer/_data/sandboxTestApi.ts`
- **Fix steps:**
  1. Compare latest.createdAt with def.updatedAt (or a definition revision field if API has one) and set testPassed false when stale.
  2. Show 'Test out of date - re-run' on test page and disable Submit.
  3. Confirm/add server check on submit.
- **Acceptance:**
  - Unit: pass at T1, def.updatedAt T2>T1 gives canSubmit false.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Wrong staleness rule could block valid submits; needs server confirmation.

### GAP-DESIGNER-DETAIL-TEST-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1916, verified on main 3c4fb6e5f; W1 SF-12 re-confirmed on #2003)
- **First-pass claim:** Rail block status is not updated with the failing step, although BlockRail supports 'error' with error count (WizardShell.tsx BlockStatus).
- **Verified evidence:** test/page.tsx passes wizard.blocks (from blockStatusForDef, never 'error'); steps state is local and never mapped to blocks. WizardShell BlockRail (ds/designer/WizardShell.tsx:13,29,71-90) supports status 'error' with errorCount, but nothing sets it. Failing steps do carry a link to block (TestRunPanel href).
- **Files to change:** `apps/web/src/app/(app)/designer/[id]/test/page.tsx`, `apps/web/src/app/(app)/designer/_data/sandboxTestModel.ts`
- **Fix steps:**
  1. Add STEP_TO_BLOCK map (form->b2, eligibility->b3, workflow->b4, demand/payment/gl->b5, certificate->b7).
  2. In test page derive blocks with status 'error' and errorCount for blocks owning failed steps.
  3. Pass derived blocks to WizardShell.
- **Acceptance:**
  - Component: failed 'workflow' step marks B4 with error and count 1.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-DETAIL-TEST-04  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W2 PQ: closed by #N -- ALREADY-FIXED: jargon labels renamed), `[~]` if blocked + reason)
- **First-pass claim:** 'GL journal entry' and 'Sandbox payment' are accounting jargon for a service designer.
- **Verified evidence:** sandboxTestModel.ts:13-14 labels 'Sandbox payment' and 'GL journal entry'; TestRunPanel.tsx:99 also prints 'Sandbox payment'.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/sandboxTestModel.ts`, `apps/web/src/app/_components/ds/designer/TestRunPanel.tsx`
- **Fix steps:**
  1. Rename to 'Test payment' and 'Accounts posting (ledger entry)'; keep ids unchanged.
- **Acceptance:**
  - Manual: labels updated on test page and in failure details.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; check tests matching label text.


---
## /designer/library  —  `designer/library.html`

- **Source:** `apps/web/src/app/(app)/designer/library/page.tsx`
- **Design reference:** `redesign/designer/library.html`

### GAP-DESIGNER-LIBRARY-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** fetchServicePacks swallows every non-OK response as an empty list, so outages and 403s show 'No packs match the current filters.' (packLibraryApi.ts:38-39, PackLibraryClient.tsx:174-176).
- **Verified evidence:** packLibraryApi.ts:38-39 fetchServicePacks returns [] when !res.ok (also 401/403/500), and network throw is uncaught in PackLibraryClient useEffect (:46-55, would leave loading stuck). PackLibraryClient.tsx shows 'No packs match the current filters.' for empty (~:174-176). Server loader getDomainPacks source is also dropped in library/page.tsx:5.
- **Files to change:** `apps/web/src/app/(app)/designer/_data/packLibraryApi.ts`, `apps/web/src/app/(app)/designer/library/PackLibraryClient.tsx`, `apps/web/src/app/(app)/designer/library/page.tsx`
- **Fix steps:**
  1. Make fetchServicePacks throw a typed error (status) on !ok.
  2. In client catch and set error state; render RefreshErrorState with retry; separate 403 message.
  3. Pass loader source from page.tsx and show notice when domain packs failed.
- **Acceptance:**
  - Component: 500 response renders error, not 'No packs match'.
  - Component: network reject ends loading state.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-DESIGNER-LIBRARY-02  ·  MEDIUM  ·  partly  ·  theme A11Y (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The pack preview is a hand-rolled fixed overlay (role=dialog, aria-modal, close on backdrop click) rather than the shared ConfirmDialog; no focus trap or return-focus logic is present in the component (PackLibraryClient.tsx preview block).
- **Verified evidence:** Preview overlay in PackLibraryClient.tsx (~:205-270): role='dialog' aria-modal, backdrop click closes; no Escape handler, no focus move or trap, no focus return. The shared ConfirmDialog (ds/ConfirmDialog.tsx:7-8,93-109) implements focus trap, ESC and return-focus but is confirm-oriented, so a reusable Modal/Drawer primitive is the right fix. Theme is a11y, not CONFIRM.
- **Files to change:** `apps/web/src/app/(app)/designer/library/PackLibraryClient.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx`
- **Fix steps:**
  1. Extract focus-trap/ESC logic from ConfirmDialog into a ds Modal (or reuse ConfirmDialog with custom description).
  2. Replace hand-rolled overlay with it; keep Close and Import as actions.
  3. Return focus to the Preview button.
- **Acceptance:**
  - Component: Escape closes; focus returns to trigger; Tab stays inside.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-DESIGNER-LIBRARY-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Domain-pack tokens (domainPackKey, sector) shown raw in meta line; no display names (PackCard.tsx metaBits).
- **Verified evidence:** ds/designer/PackCard.tsx:32-38 metaBits = [pack.domainPackKey ?? 'tenant', v, source, sector, jurisdiction]; domainPackKey is a raw key. sector/jurisdiction come from domain pack row (packSector/packJurisdiction) and may be raw tokens; domainByKey has display name available in PackLibraryClient.
- **Files to change:** `apps/web/src/app/_components/ds/designer/PackCard.tsx`, `apps/web/src/app/(app)/designer/library/PackLibraryClient.tsx`
- **Fix steps:**
  1. Pass domainName (domain.name) prop to PackCard and use it instead of domainPackKey.
  2. Humanize sector/jurisdiction if they are enum codes.
- **Acceptance:**
  - Component: card shows 'Property Tax' not 'property_tax'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-LIBRARY-04  ·  MEDIUM  ·  confirmed  ·  theme UX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Native selects styled with className 'btn ghost' and four separate filters plus a segmented control in one wrapping row; no reset/clear.
- **Verified evidence:** PackLibraryClient.tsx:~117-160: four native <select className='btn ghost'> (Sector, Jurisdiction, Source, Domain pack) plus Segmented for patterns in one flex-wrap row; no Reset/clear control, no result count.
- **Files to change:** `apps/web/src/app/(app)/designer/library/PackLibraryClient.tsx`
- **Fix steps:**
  1. Use the ds Select/FilterBar if available, else a proper .input select class.
  2. Add 'Clear filters' button visible when any filter != 'all' and a result count.
- **Acceptance:**
  - Component: clicking Clear resets all five filters.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-LIBRARY-05  ·  LOW  ·  partly  ·  theme CONSISTENCY (was OTHER)

- [x] **Status** (W2 PQ: closed by #N -- getServicePacks added to designerLoader; both packs server-loaded via unified path)
- **W0-10 note:** review found the W0 tick partly — Two load paths remain (server loader library/page.tsx:5 vs client fetch PackLibraryClient.tsx:46-62); only a domainPacksFailed notice added (PackLibraryClient.tsx:160). Acceptance "both lists load from one path" not met
- **First-pass claim:** Pack list and domain packs load through two different paths (server loader vs client fetch via /api/proxy), so one can be stale while the other is fresh.
- **Verified evidence:** Real: domainPacks come from server loader (library/page.tsx, revalidate 60s via fetchJson) while service packs are fetched client-side no-store in PackLibraryClient useEffect (:46-55) via /api/proxy. Inconsistent but no shared cache, so staleness is only up to 60s for domain pack filter options; not a correctness bug.
- **Files to change:** `apps/web/src/app/(app)/designer/library/page.tsx`, `apps/web/src/app/(app)/designer/library/PackLibraryClient.tsx`
- **Fix steps:**
  1. Load both from the server loader (add getServicePacks) or both client side; pick one.
  2. Then unify error handling per GAP-DESIGNER-LIBRARY-01.
- **Acceptance:**
  - Manual: both lists load from one path; error state covers both.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-DESIGNER-LIBRARY-01


---
## /designer/new  —  `designer/new.html`

- **Source:** `apps/web/src/app/(app)/designer/new/page.tsx`
- **Design reference:** `redesign/designer/new.html`

### GAP-DESIGNER-NEW-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Owning office placeholder claims 'Pre-filled from your office (optional)' but state is initialised to '' — nothing pre-fills (new/page.tsx:12 vs :103).
- **Verified evidence:** apps/web/src/app/(app)/designer/new/page.tsx:14 office state is useState(''); the input (~:98-104) placeholder says 'Pre-filled from your office (optional)'. Nothing reads a user/office profile, so it is never pre-filled; value only feeds ownerDepartment (:29).
- **Files to change:** `apps/web/src/app/(app)/designer/new/page.tsx`
- **Fix steps:**
  1. Either change placeholder to 'Owning office (optional)' in the office <input>
  2. Or prefill: read the caller's office from session/profile (only if an existing profile loader exposes it; do not invent a field) via useEffect and setOffice
- **Acceptance:**
  - Render page: placeholder no longer claims pre-fill
  - If prefill kept: input shows the profile office on load and edit still works
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; copy only.

### GAP-DESIGNER-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Pattern cards are buttons with no aria-pressed/radio semantics; selection is signalled by border colour only (new/page.tsx:64-84).
- **Verified evidence:** apps/web/src/app/(app)/designer/new/page.tsx:64-84 pattern cards are <button type=button> with border/background change only (active var). No aria-pressed, no radiogroup, no check mark. FeeBuilder.tsx:204-215 in same module already uses role=radiogroup/radio.
- **Files to change:** `apps/web/src/app/(app)/designer/new/page.tsx`
- **Fix steps:**
  1. Wrap the card grid in role="radiogroup" with aria-label
  2. Give each card role="radio" aria-checked={active} (or aria-pressed) and roving tabindex, mirroring FeeBuilder.tsx:204
  3. Add a non-colour cue (check icon / 'Selected' text) when active
- **Acceptance:**
  - Screen reader announces 'radio, checked' on selected card
  - Selected card shows a non-colour indicator (grayscale screenshot check)
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-NEW-03  ·  MEDIUM  ·  partly  ·  theme API (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Service key is auto-slugified from the name with no uniqueness feedback until the API responds; the key is immutable identity for published services (designerApi.ts slugifyServiceKey, new/page.tsx:30).
- **Verified evidence:** designerApi.ts:132-140 slugifyServiceKey appends crypto.randomUUID().slice(0,8) to the slug, so collisions are practically impossible; the claim of no uniqueness handling is overstated. True: key is generated silently (:26), never shown to the user, and error from createServiceDefinition is only surfaced generically (:33). Whether the key is immutable after publish is not verifiable here (catalogue service absent).
- **Files to change:** `apps/web/src/app/(app)/designer/_data/designerApi.ts`, `apps/web/src/app/(app)/designer/new/page.tsx`
- **Fix steps:**
  1. Show the generated key read-only under the name field (preview via slugifyServiceKey base) so users know it
  2. Map a 409/duplicate response in createServiceDefinition to a specific message
  3. Confirm with backend whether serviceKey is immutable and document it in HelpTip
- **Acceptance:**
  - Key preview visible before Create
  - Simulated 409 shows 'key already exists' message, button re-enabled
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; do not change key format for existing services.

### GAP-DESIGNER-NEW-04  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** 'Create draft' stays disabled without explanation when the name is empty; no inline validation message.
- **Verified evidence:** apps/web/src/app/(app)/designer/new/page.tsx:21 handleCreate returns silently if !name.trim(); Button disabled={!name.trim() || busy} (~:115). No message or aria-describedby; no zod schema at the form boundary (CLAUDE.md rule).
- **Files to change:** `apps/web/src/app/(app)/designer/new/page.tsx`
- **Fix steps:**
  1. Add zod schema (name 3-120 chars trimmed, office max length) in the page or designerConstants
  2. Validate on blur/submit and render inline error with id; set aria-describedby/aria-invalid on the input
  3. Keep disabled only for busy; show 'Enter a service name' otherwise
- **Acceptance:**
  - Unit test: empty/whitespace name yields error text
  - Submit with valid name calls createServiceDefinition once
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DESIGNER-NEW-05  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Channels are silently fixed to ['portal'] at creation (new/page.tsx:36); user sees them only later in B1.
- **Verified evidence:** apps/web/src/app/(app)/designer/new/page.tsx:30 channels: ['portal'] hard-coded in createServiceDefinition payload; UI never mentions channels. Later editing in B1 not checked.
- **Files to change:** `apps/web/src/app/(app)/designer/new/page.tsx`
- **Fix steps:**
  1. Add a line in the details card: 'Channels: Portal (change later in B1)'
  2. Optionally expose a checkbox group if backend accepts other channel values (verify in catalogue service)
- **Acceptance:**
  - Card shows the default channel before Create
  - Payload channels matches shown selection
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-DESIGNER-DETAIL-REVIEW-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Checker is inferred as 'anyone who is not the submitter' — no role check for Department Head — so any office user opening /designer/[id]/review sees Approve & Publish; enforcement is server-side only and undeterminable here (review/page.tsx:41-44,152).
- **Service:** `citizen-service (catalogue)`  ·  **Endpoint(s):** `['POST /v1/citizen/catalogue/services/:id/publish', 'POST /v1/citizen/catalogue/services/:id/reject', 'POST /v1/citizen/catalogue/services/:id/submit']`
- **Question:** Does publish/reject require a Department Head/approver role and reject when caller equals the submitter (maker-checker)?
- **How to verify:** Open publish handler in citizen-service catalogue module; check requireRole list and submittedBy != actor. curl publish as a plain office user and as the submitter, expect 403 both.
- **Test to add:** Given a submitted definition by user A, when A or a non-approver POSTs publish then 403; when a dept_head B POSTs then 200 and audit event emitted.
- **Impact if wrong:** Any office user can publish citizen services; unauthorised service changes go live.
- **Web change if wrong:** Gate the Approve & Publish button on approver role in designer/[id]/review/page.tsx:41-44,152 via getSessionRoles.

### GAP-DESIGNER-DETAIL-TEST-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** The sandbox test posts a payment and a GL journal in step 5-6; the panel does not say whether these are ledger-isolated sandbox postings, and finance-service is not in the snapshot so isolation is undeterminable (sandboxTestModel.ts:13-14; finance not present).
- **Service:** `citizen-service, finance-service`  ·  **Endpoint(s):** `['POST /v1/citizen/catalogue/services/:id/sandbox-test/run', 'GET .../sandbox-test/latest']`
- **Question:** Does sandbox-test/run create payment and GL journal in an isolated sandbox (flagged, rolled back or separate ledger) never touching real balances or reports?
- **How to verify:** Open the sandbox-test handler in citizen-service and the finance call it makes; run the test and query journals/GL totals before and after, expecting no change to production trial balance.
- **Test to add:** Given a run of steps 5-6 when finished then no posted journal or payment exists in the live ledger (or rows are sandbox=true and excluded from reports).
- **Impact if wrong:** Test runs pollute the real GL and payment records; audit and financial misstatement.
- **Web change if wrong:** Add an explicit 'sandbox - no ledger impact' note in the TestRunPanel (designer/[id]/test/page.tsx) only if isolation is confirmed; otherwise disable steps 5-6.


---
## Refuted by deep pass — do NOT implement

### GAP-DESIGNER-DETAIL-B2-02 · /designer/[id]/b2
- **First-pass claim:** Fields are draggable (draggable at FormBuilder.tsx:222 plus SortableList) while only sections have explicit Move up/Move down buttons; keyboard reorder of fields is not evident (FormBuilder.tsx:349-372).
- **Why refuted:** Field rows are rendered by SortableList (FormBuilder.tsx:395-403). SortableList.tsx:121-140 gives every row 'Move up' and 'Move down' buttons (aria-label, disabled at the ends) wired to moveFieldWithinSection (FormBuilder.tsx:402-403). Fields inside a section are not drag-reorderable. The only draggable elements are the palette buttons (FormBuilder.tsx:222) and section drop targets, and those are secondary to the click-to-add path (:224). So keyboard reordering exists. Minor true residue: the buttons are labelled just 'Move up/Move down' with no field name, so screen-reader users cannot tell which row.

### GAP-DESIGNER-DETAIL-TEST-05 · /designer/[id]/test
- **First-pass claim:** Run history is a plain list with no timestamps in the strings read (TestRunPanel.tsx:227).
- **Why refuted:** TestRunPanel.tsx ~223-236 renders history in a DataTable with columns 'Run at' (new Date(createdAt).toLocaleString('en-IN')), 'Result' status pill, 'Duration'; emptyTitle 'No test runs yet'. Timestamps are shown; it is not a plain list. Caveat: an empty/invalid createdAt would print 'Invalid Date' (sandboxTestApi.ts maps String(row.createdAt ?? '')).
