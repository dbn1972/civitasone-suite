# Detailed gap file — module `install`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 37



---
## /install  —  `install/home.html`

- **Source:** `apps/web/src/app/(app)/install/page.tsx`
- **Design reference:** `redesign/install/home.html`

### GAP-INSTALL-HOME-01  ·  HIGH  ·  defect  ·  theme BACKEND

- [x] **Status** (W2 PQ: closed by #2036)
- **First-pass claim:** Data-shape mismatch: page.tsx reads step.stepNo/title/isRequired/completedAt/errorMessage/description, but getInstallSteps runs every row through mapRows(), which only ever emits {id,label,sublabel,status,meta} (_data.ts:44-79,98). As coded, title and stepNo render as undefined, isRequired is always falsy so every step is Optional, Required complete reads 0/0 and Status never reaches Complete. ModuleRowSummary itself (@civitasone/types) is not in the snapshot, so whether tsc tolerates the extra fields is undeterminable.
- **Service:** `apps/web (install-service shape unverified)`  ·  **Endpoint(s):** `['GET /api/v1/install/steps']`
- **Question:** See evidence.
- **How to verify:** Verified by reading source; see evidence.
- **Test to add:** Given sample steps payload, mapper returns title, stepNo, isRequired populated.
- **Impact if wrong:** Installer wizard shows blank titles and wrong progress.
- **Web change if wrong:** 
- **Finding:** apps/web/src/app/(app)/install/_data.ts:33-79,98: getInstallSteps uses moduleLoader->mapRows which emits only {id,label,sublabel,status,meta}; install/page.tsx:29-33,114-138 reads step.isRequired, step.stepNo, step.title, step.description, step.completedAt, step.errorMessage, none produced by mapRows. Result: title/stepNo undefined, requiredSteps empty (0/0), all steps 'Optional'. status is also compared to lowercase 'completed'/'failed' but mapRows passes the raw string. Install-service response shape itself is unverified but the page cannot work with any payload.

### GAP-INSTALL-HOME-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch reads as a fresh tenant: source 'error' shows only the small badge, then total===0 renders the 'No installation steps found' EmptyState and invites Stage 3 activation with no retry (page.tsx:47-59).
- **Verified evidence:** install/page.tsx:48 shows the DataSourceBadge on error; getInstallSteps returns [] on error so total===0 (:50) and the EmptyState 'No installation steps found' plus activation panel render (:50-58). No retry. (Line numbers in the observation were shifted by ~4.)
- **Files to change:** `apps/web/src/app/(app)/install/page.tsx`
- **Fix steps:**
  1. If source==='error' render <RefreshErrorState error={toHumanError('load',{area:'installation steps'})} backHref='/dashboard'/> and skip the empty state and activation panel.
  2. Keep EmptyState only for source==='api' && total===0.
  3. Show '—' in stats if partial render is kept.
- **Acceptance:**
  - Mock getInstallSteps error: no 'No installation steps' text; Retry shown.
  - Empty success: EmptyState still shown.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-INSTALL-HOME-03  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Run / Retry / Skip and Stage 3 activation (tenant provisioning mutations, PATCH via proxy) are shown to every viewer with no role gate and no client-side audit context; optional steps skip with no confirmation (InstallStepActions.tsx:39-46).
- **Verified evidence:** InstallStepActions.tsx:29 sends PATCH /api/proxy/v1/install/steps/{id}/run|skip|retry to every viewer; page.tsx:141-148 renders it for all non-completed steps; no requireAnyRole in any install file and no install layout. Skip confirm exists only when isRequired (:40-45); optional steps skip immediately (:44). Client sends no reason/audit context. Server RBAC and audit cannot be verified (install-service absent).
- **Files to change:** `apps/web/src/app/(app)/install/layout.tsx`, `apps/web/src/app/(app)/install/InstallStepActions.tsx`, `apps/web/src/app/(app)/install/page.tsx`
- **Fix steps:**
  1. Add install/layout.tsx with requireAnyRole (shared with DOMAIN-PACKS-01).
  2. Pass canOperate to InstallStepActions; render read-only status for others.
  3. Add a confirm (with optional reason) for skipping optional steps too.
  4. Verify server-side role check and audit events for run/skip/retry.
- **Acceptance:**
  - Non-admin sees steps without buttons.
  - Skipping optional step opens confirm.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; tenant provisioning.
- **Depends on:** GAP-INSTALL-DOMAIN-PACKS-01

### GAP-INSTALL-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme STATEMACHINE (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Run and Retry are both enabled for every non-completed step, including Retry on a never-run pending step and Run on a failed one; there is no per-status logic (InstallStepActions.tsx:60-82).
- **Verified evidence:** InstallStepActions.tsx:53-79 all three buttons use only disabled={busy||done}; status prop is accepted (:9) but unused. page.tsx:141 renders actions for any status !== completed (pending, in_progress, failed, skipped), so Retry shows on pending and Run on failed.
- **Files to change:** `apps/web/src/app/(app)/install/InstallStepActions.tsx`
- **Fix steps:**
  1. Derive enabled actions from status: pending -> Run, Skip; failed -> Retry, Skip; in_progress -> none (or Cancel); skipped -> Run.
  2. Hide or disable others with title explaining; confirm valid transitions with install-service.
- **Acceptance:**
  - Component test per status asserts which buttons exist.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm allowed transitions with backend.

### GAP-INSTALL-HOME-05  ·  MEDIUM  ·  confirmed  ·  theme ERRORMSG (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** PATCH errors show raw (await res.text()) in a small red line; no busy indicator besides aria-busy (InstallStepActions.tsx:30-32,86).
- **Verified evidence:** InstallStepActions.tsx:30 throws new Error(await res.text()) and :83-85 prints it in a text-xs red <p>; body may be JSON/HTML. Busy state is only aria-busy (:57); no spinner or label change.
- **Files to change:** `apps/web/src/app/(app)/install/InstallStepActions.tsx`
- **Fix steps:**
  1. Use useFormError().fromResponse (as InspectionActions.tsx does) to build a human message.
  2. Show 'Running…' label/spinner while busy.
  3. Use a DS alert with role=alert, larger than text-xs.
- **Acceptance:**
  - 500 with JSON body shows human sentence, not raw JSON.
  - Busy button label changes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-INSTALL-HOME-06  ·  MEDIUM  ·  confirmed  ·  theme DSDRIFT (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Page is styled with Tailwind slate/indigo utility classes and hard-coded StatCard iconBg hex instead of DS tokens; StatCard value 'Complete' is derived from required steps only while progress % counts all steps, so the two can disagree (page.tsx:30-36,62-66).
- **Verified evidence:** page.tsx Tailwind slate/indigo throughout (:60-75, 188-230) and iconBg hex at :64,:71,:77. Status card :63-66 uses allRequiredComplete (required only) while progress (:36,:94-190) counts all steps; e.g. all required done, optional pending gives 'Complete' and 80%. It also ignores failed optional steps.
- **Files to change:** `apps/web/src/app/(app)/install/page.tsx`
- **Fix steps:**
  1. Define one completion rule: label 'Required steps complete' vs overall percent, or show 'Complete' only when no step is pending/failed.
  2. Replace iconBg hex with DS variants and Tailwind colours with tokens.
  3. Show both 'x/y required' and 'x/y all' consistently.
- **Acceptance:**
  - Fixture: required done, optional pending shows 'Required complete' not 'Complete' beside 80%.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-INSTALL-HOME-07  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Domain Pack panel fetch errors are swallowed and replaced by the static municipal catalogue (domainPackApi.ts fetchDomainPacksForInstall), so an outage looks like a healthy list with only one pack.
- **Verified evidence:** Same root cause as DOMAIN-PACKS-02: domainPackApi.ts:84,88 swallow errors and return the static catalogue; embedded panel is rendered on /install at page.tsx:57,151,164.
- **Files to change:** `apps/web/src/app/(app)/install/domainPackApi.ts`, `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`
- **Fix steps:**
  1. Implement the error-return and retry banner from GAP-INSTALL-DOMAIN-PACKS-02; the embedded variant uses it automatically.
- **Acceptance:**
  - Mock 500: /install panel shows retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-INSTALL-DOMAIN-PACKS-02

### GAP-INSTALL-HOME-08  ·  LOW  ·  confirmed  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Footer uses plain <a href> (full page load) instead of next/link, and 'Domain Packs (Stage 3)' is jargon for tenant admins (page.tsx:169-173).
- **Verified evidence:** page.tsx:169-173 uses plain <a href='/install/console'> and <a href='/install/domain-packs'> (full reload), label 'Domain Packs (Stage 3)'; the same label is in console/page.tsx:12-14. domain-packs/page.tsx:51-55 also uses <a>.
- **Files to change:** `apps/web/src/app/(app)/install/page.tsx`, `apps/web/src/app/(app)/install/domain-packs/page.tsx`, `apps/web/src/app/(app)/install/console/page.tsx`
- **Fix steps:**
  1. Replace <a> with next/link Link.
  2. Rename to 'Domain Packs' with note 'Import ready-made service templates'.
- **Acceptance:**
  - Client navigation without full reload; label has no 'Stage 3'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /install/console  —  `install/console.html`

- **Source:** `apps/web/src/app/(app)/install/console/page.tsx`
- **Design reference:** `redesign/install/console.html`

### GAP-INSTALL-CONSOLE-01  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub has no live context: no current stage, failed-step count or last-run time, so an installer must open each list to learn the state (console/page.tsx:5-24).
- **Verified evidence:** install/console/page.tsx:5-22 is a static ModuleHub with 6 links and no children; no fetch. ModuleHub accepts children (ModuleHub.tsx) so a status strip is possible. Data source: getInstallSteps (_data/loaders.ts:4343) gives steps with status/completedAt.
- **Files to change:** `apps/web/src/app/(app)/install/console/page.tsx`
- **Fix steps:**
  1. Make the page async; call getInstallSteps().
  2. Pass ModuleHub children: StatGrid with current step, failed count, completed x/y required; last completed date via formatIndianDate.
  3. On source==='error' show RefreshErrorState instead of numbers.
- **Acceptance:**
  - Failed step present -> tile shows count and links to /install/steps.
  - Error state renders retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INSTALL-HOME-02

### GAP-INSTALL-CONSOLE-02  ·  MEDIUM  ·  defect  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Jargon tiles ('Silo provisions', 'Module resolution catalogue', 'Atomic install steps') with no explanation; help slug 'install' link target not verified in this snapshot (page.tsx:8).
- **Service:** `apps/web`  ·  **Endpoint(s):** `['GET /help/install (apps/web help route)']`
- **Question:** The help slug 'install' passed to PageHeader must resolve to a help module.
- **How to verify:** Open apps/web/src/lib/helpContent.ts; HELP_MODULES slugs are finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin (lines 57-324) - no 'install'. Load /help/install expecting 404.
- **Test to add:** Given ModuleHub help=install, when /help/install is requested, then 200 with title (currently notFound()).
- **Impact if wrong:** Help link on the install console 404s; installers get no guidance.
- **Web change if wrong:** Add an 'install' HelpModule (or point help to 'tenant-admin') and add plain-language descriptions to the Silo provisions / Module resolution / Atomic install steps tiles in install/console/page.tsx:15-21.
- **Finding:** apps/web/src/lib/helpContent.ts:57-324 slugs exclude 'install'; help/[module]/page.tsx:21 calls notFound() for unknown slug; install/console/page.tsx:8 passes help="install"; tiles at :15-21 have terse notes only.

### GAP-INSTALL-CONSOLE-03  ·  LOW  ·  partly  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Wizard, Stages and Steps overlap (all show install steps/stages); the hub does not say which to use for what (page.tsx:11-20).
- **Verified evidence:** console/page.tsx:10-19 lists Installer wizard ('Guided install steps'), Stages ('Install stages and progress'), Steps ('Atomic install steps'); the notes hint at differences but do not say when to use which. Overlap of data on the /install/stages and /install/steps pages was not read here; the wizard (install/page.tsx) itself is steps with actions.
- **Files to change:** `apps/web/src/app/(app)/install/console/page.tsx`
- **Fix steps:**
  1. Rewrite notes: wizard 'Start here: run and skip steps in order', Stages 'Read-only progress by stage', Steps 'Full step list with status and errors'.
  2. Order tiles by usage; mark the wizard as primary.
- **Acceptance:**
  - Each tile note states a distinct purpose.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-INSTALL-CONSOLE-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Segment loading.tsx (stat blocks) does not match this stat-less hub, so the skeleton jumps on load (install/loading.tsx).
- **Verified evidence:** install/loading.tsx (segment-wide, applies to /install/console) draws a title bar, 4 stat blocks and a 72px body using Tailwind slate + min-h-screen; console renders a PageHeader and tile grid only. Also hard-coded slate colours, no dark mode.
- **Files to change:** `apps/web/src/app/(app)/install/loading.tsx`, `apps/web/src/app/(app)/install/console/loading.tsx`
- **Fix steps:**
  1. Add install/console/loading.tsx with header skeleton and 6 tile skeletons.
  2. Convert install/loading.tsx to DS skeleton tokens (no bg-slate-50, min-h-screen).
- **Acceptance:**
  - Navigating to /install/console shows a tile skeleton with no layout jump.
  - Dark mode skeleton readable.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /install/domain-packs  —  `install/domain-packs.html`

- **Source:** `apps/web/src/app/(app)/install/domain-packs/page.tsx`
- **Design reference:** `redesign/install/domain-packs.html`

### GAP-INSTALL-DOMAIN-PACKS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — install/layout.tsx role gate + canOperate hides activation (domain-packs/page.tsx:9, panel :242) and server routes check roles, but activation result is only a static 'Activation accepted ... queued' (DomainPackActivatePanel.tsx:204-222) with no job id or status polling; acceptance 'shows job status until completed or failed' unmet
- **First-pass claim:** Activation (imports service drafts into the catalogue) is available to any viewer; there is no role gate, and success is only 'accepted' (202) with no status polling or link to the queued job (DomainPackActivatePanel.tsx doActivate; domainPackApi.ts).
- **Verified evidence:** install/domain-packs/page.tsx:40-59 has no role check and there is no install/layout.tsx (ls install); requireAnyRole exists (lib/auth/roleGuard.ts) and is used in crm layouts. DomainPackActivatePanel.doActivate (:59-76) POSTs /api/proxy/v1/install/stages/3/domain-pack/activate (domainPackApi.ts:96); the proxy route has no role code. Result shows 'Activation accepted... queued' (:177-179) with no status polling or link to a job. Server-side enforcement in install-service cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/install/layout.tsx`, `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`, `apps/web/src/app/(app)/install/domainPackApi.ts`
- **Fix steps:**
  1. Create install/layout.tsx calling requireAnyRole(['admin','super_admin','platform_admin','tenant_admin'], '/dashboard') (confirm role names with security owner).
  2. Use getSessionRoles in page.tsx to pass canActivate prop; hide/disable Activate and Skip/Run buttons for others with explanation.
  3. Return the job id from activate result and link/poll it (needs a status endpoint; check install-service).
  4. Verify install-service enforces the same role check and audit event.
- **Acceptance:**
  - Non-admin visiting /install/domain-packs is redirected.
  - Admin activation shows job status until completed or failed.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High; tenant provisioning mutations.
- **Depends on:** GAP-INSTALL-HOME-03

### GAP-INSTALL-DOMAIN-PACKS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** List fetch failure is silently swallowed: fetchDomainPacksForInstall returns the static catalogue on any error, so an outage looks like a working single-pack library (domainPackApi.ts:fetchDomainPacksForInstall).
- **Verified evidence:** domainPackApi.ts:81-90 fetchDomainPacksForInstall returns mergeDomainPackCatalog([]) on !res.ok (:84) and in catch (:88); the panel (:43-49) cannot tell failure from success, so it shows the static municipal pack only.
- **Files to change:** `apps/web/src/app/(app)/install/domainPackApi.ts`, `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`
- **Fix steps:**
  1. Return {packs, error} (or throw) from fetchDomainPacksForInstall.
  2. In the panel keep an error state; render ErrorState with Retry (re-run effect) above the static fallback, labelled 'Showing built-in pack only'.
  3. Disable Activate for packs not confirmed by the API if the API is the source of truth.
- **Acceptance:**
  - Mock fetch 500: retry banner shown.
  - Mock fetch OK with empty data: no banner.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-INSTALL-HOME-07

### GAP-INSTALL-DOMAIN-PACKS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Pack outcomes are hard-coded in the client (domainPackCatalog.ts) and override the API's packKeys for the municipal pack, so server-side changes to the pack never show; summary is also static.
- **Verified evidence:** domainPackCatalog.ts:22-53 hard-codes MUNICIPAL_DOMAIN_PACK with 3 outcomes; domainPackApi.ts:58 forces summary from catalog and :60-61 uses catalog.outcomes ahead of the API's packKeys; the activate call sends selected.outcomes packKeys (Panel :64-67), so server changes to the pack's packKeys are ignored in both display and request. Static outcomes copy at Panel :99-103,246-252.
- **Files to change:** `apps/web/src/app/(app)/install/domainPackApi.ts`, `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`, `apps/web/src/app/(app)/install/domainPackCatalog.ts`
- **Fix steps:**
  1. In mergeDomainPackCatalog prefer API packKeys when present; use catalog only for labels of known keys.
  2. Send packKeys from the API row, or omit and let the server decide.
  3. Remove hard-coded TL/PGR/Water text in the panel; derive from outcomes.
  4. Show 'not available' when the API returns nothing.
- **Acceptance:**
  - Test: API row with 4 packKeys -> 4 outcomes listed and sent.
  - Unknown packKey gets a fallback label.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium; wrong pack set could be activated.
- **Depends on:** GAP-INSTALL-DOMAIN-PACKS-02

### GAP-INSTALL-DOMAIN-PACKS-04  ·  MEDIUM  ·  partly  ·  theme DSDRIFT (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — breadcrumb replaced with Link; DomainPackActivatePanel and domain-packs page still use Tailwind indigo/slate classes instead of DS tokens
- **First-pass claim:** Panel is Tailwind-styled (indigo/slate) with hard-coded colours, breadcrumb is hand-rolled with '←' text; 'Activated' button is disabled with no way to re-run or view result after reload (DomainPackActivatePanel.tsx).
- **Verified evidence:** Tailwind indigo/slate classes are real (Panel :78-89,201; page.tsx:51-55 hand-rolled breadcrumb with '←' text and plain <a>). Overstated on 'Activated' disabled: that is React state only (Panel :36,202,206); after reload result is null, so the button is enabled again and a second activation is possible; no view of the prior result exists. Theme not FABRICATED.
- **Files to change:** `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`, `apps/web/src/app/(app)/install/domain-packs/page.tsx`
- **Fix steps:**
  1. Swap Tailwind colours for DS tokens/classes (btn, card, StatusPill) or ensure tokens map.
  2. Use AutoBreadcrumb/PageHeader back instead of the hand text.
  3. Persist activation status (query the activation job/status endpoint) so reload shows 'Activated' or last result; confirm with backend that repeat activation is idempotent.
- **Acceptance:**
  - Reload after activation shows activated state.
  - Dark mode contrast passes.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium; double activation.
- **Depends on:** GAP-INSTALL-DOMAIN-PACKS-01

### GAP-INSTALL-DOMAIN-PACKS-05  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Copy exposes internal references ('DoD §13(f)', pack keys 'pack:trade-license') to end users (DomainPackActivatePanel.tsx).
- **Verified evidence:** Panel :103 shows '(DoD §13(f))', :100 raw key municipal-in-v1, :158 and :272 show pack keys like pack:trade-license in mono text, :179 shows 'Pack <key> queued'; catalog.ts header also cites DoD. Strings hard-coded.
- **Files to change:** `apps/web/src/app/(app)/install/DomainPackActivatePanel.tsx`, `apps/web/src/app/(app)/install/domainPackCatalog.ts`
- **Fix steps:**
  1. Remove the DoD reference from user copy.
  2. Show pack name only; put keys behind a 'Technical details' disclosure.
  3. Move strings to next-intl.
- **Acceptance:**
  - No '§' or 'pack:' string visible by default.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /install/modules  —  `install/modules.html`

- **Source:** `apps/web/src/app/(app)/install/modules/page.tsx`
- **Design reference:** `redesign/install/modules.html`

### GAP-INSTALL-MODULES-01  ·  HIGH  ·  partly  ·  theme FORMAT (was MONEY)

- [x] **Status** (W2 PQ: closed — showId={false} added to install/modules/page.tsx to hide UUID fragment column (GAP-INSTALL-MODULES-01))
- **W0 note:** partly fixed by #1923 — meta dates are now formatted (metaKind) but a UUID id is still shown as an 8-character fragment in ModuleListTable (full id only in the title)
- **First-pass claim:** Generic ID/Name/Detail/Status/Meta columns come from a heuristic mapper (_data.ts:26-79): ID is a raw id truncated to 8 chars and Meta prints whatever of code|currency|updatedAt|createdAt exists, i.e. a raw ISO timestamp, not a formatted date (ModuleListTable.tsx:56-62).
- **Verified evidence:** No money is involved: _data.ts mapRows (lines 26-79) builds ModuleRowSummary generically; ModuleListTable.tsx:50 prints row.id.slice(0, 8) in a mono span and :54 prints row.meta verbatim. meta = code ?? currency ?? updatedAt ?? createdAt (_data.ts:57-63), so it is a raw ISO string only when the row has no code/currency; points/balance are printed as 'N pts'/'bal N' without formatting. The MONEY tag/fix is wrong; the real issues are an 8-char id fragment and an unformatted timestamp.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/install/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In _data.ts mapRows keep updatedAt/createdAt as separate optional fields (extend ModuleRowSummary in @civitasone/types with updatedAt?: string) instead of folding them into meta.
  2. In ModuleListTable.tsx render the timestamp column with formatIndianDate from @/lib/formatters (as BinsTable.tsx does), and render code (not id) as the identifier where present.
  3. Replace row.id.slice(0, 8) with the row code/name; show the full id only in a title/aria-label or copy control.
  4. Drop the 'bal N' meta (unformatted number, possibly money) or format via formatINR/formatMoney if the field is confirmed paise; cannot confirm unit from this snapshot.
- **Acceptance:**
  - Component test: row {updatedAt:'2026-03-01T10:00:00Z'} renders a formatted Indian date, not the ISO string.
  - Row with code renders the code in the identifier column; no 8-char UUID fragment is visible.
  - Row with no meta renders '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared ModuleListTable is used by many module list pages; column changes affect all, so snapshot-test a few consumers.

### GAP-INSTALL-MODULES-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows a badge inside the card and the 'Nothing to show yet' EmptyState together, with no retry action, so an outage reads as 'no records' (ModuleListTable.tsx:31-41).
- **Verified evidence:** apps/web/src/app/(app)/install/modules/page.tsx:7 passes source into ModuleListPage which forwards 'error' to ModuleListTable (ModuleListPage.tsx:28). ModuleListTable.tsx:33 renders DataSourceBadge (provenance error-no-data gives 'Couldn't load — showing nothing', DataSourceBadge.tsx:71) and, when data is empty, :34-35 also renders EmptyState 'No records / Nothing to show yet for this module.' There is no retry action. RefreshErrorState exists at ds/RefreshErrorState.tsx and is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable use provenance from useSeededResource; when provenance === 'error-no-data' && data.length === 0 render <RefreshErrorState error={...} backHref='/install/console'/> instead of EmptyState.
  2. Keep DataSourceBadge only for the 'cached' provenance case.
  3. Build the HumanError (what/next/actions:['retry','back']) via @/lib/messages, matching metadata/records/page.tsx usage.
  4. Keep EmptyState only for provenance === 'live' with zero rows.
- **Acceptance:**
  - Component test: source='error', no cache -> role=alert error with a Retry button, no 'Nothing to show yet' text.
  - source='api' with [] -> EmptyState, no error.
  - Clicking Retry calls router.refresh().
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component affects every ModuleListPage consumer; low business risk.

### GAP-INSTALL-MODULES-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Status is plain text (no StatusPill) and there is no search, sort, pagination or mobile card transform on the .tbl (ModuleListTable.tsx:43-66).
- **Verified evidence:** ModuleListTable.tsx:37-58 renders a bare <table className='tbl'> from data.map with no DataTable, search, sort or pagination; status at :53 is plain text {row.status ?? '—'} with no StatusPill (StatusPill exists at ds/StatusPill.tsx). No client-side filtering of a capped fetch exists (the install loaders in _data.ts pass no limit), so the 'stop client-side filtering' fix text does not apply.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the raw table with DataTable from @/app/_components/ds (as BinsTable.tsx does) with sortable, filterable, pageSize={15}.
  2. Render status column via StatusPill with a label (non-colour cue).
  3. Keep the ID/Name/Detail/Status/Meta columns as Col definitions so mobile card transform comes from DataTable.
- **Acceptance:**
  - Test: 30 rows -> 15 shown with pager; filter box narrows rows.
  - Status cell renders StatusPill text.
  - Manual: at 375px width the table does not overflow horizontally.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; install lists are small so pagination is UX only.
- **Depends on:** GAP-INSTALL-MODULES-01

### GAP-INSTALL-MODULES-04  ·  MEDIUM  ·  partly  ·  theme CONTENT (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Module resolution catalogue' rows show only id/label/status/meta: no dependency, edition or entitlement column, so resolution cannot be reviewed (ModuleListTable.tsx:44-55).
- **Verified evidence:** ModuleListTable.tsx:40-44 has only ID/Name/Detail/Status/Meta columns, so no dependency/edition/entitlement columns exist. True, but the loader (_data.ts:87) is a generic mapper over /api/v1/install/modules and the install-service response shape is not in this snapshot (only hrms-service is present), so it cannot be confirmed that such fields exist. The I18N tag/fix (next-intl) does not describe this observation; the i18n claim is a separate systemic point.
- **Files to change:** `apps/web/src/app/(app)/install/modules/page.tsx`, `apps/web/src/app/(app)/install/_data.ts`, `packages/types (ModuleRowSummary or new InstallModuleRow)`
- **Fix steps:**
  1. Confirm with install-service owners which fields /api/v1/install/modules returns (dependsOn, edition, entitlement, resolvedVersion).
  2. Add a typed InstallModuleRow and a dedicated mapper in _data.ts (zod parse at boundary) instead of mapRows.
  3. Render a dedicated DataTable in modules/page.tsx with dependency, edition and entitlement columns.
  4. Add non-colour status cues (StatusPill label).
- **Acceptance:**
  - Test: mapper maps fixture with dependsOn/edition to typed row.
  - Page shows edition and dependency columns for a fixture module.
  - Missing optional field renders '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Depends on unseen API contract; do not invent fields.
- **Depends on:** GAP-INSTALL-MODULES-03

### GAP-INSTALL-MODULES-05  ·  LOW  ·  partly  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Only a back link (no module breadcrumb Home / Install / page); page title uses an em-dash prefix 'Install — …' instead of a breadcrumb trail (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/install/modules/page.tsx:9-11 renders a single back link to /install/console inside <nav aria-label='Breadcrumb'> and title 'Install — ...' (line 15). But the AppShell already renders a global AutoBreadcrumb in the TopBar (ds/AppShell.tsx:30, used by (app)/layout.tsx:72), so a trail exists; tenant-admin/users/page.tsx:18-22 documents removing duplicate back affordances for that reason. The local nav is a back link mislabelled as Breadcrumb; the 'wiring' theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/install/modules/page.tsx`, `apps/web/src/app/_components/AutoBreadcrumb.tsx`
- **Fix steps:**
  1. Remove the local <nav aria-label='Breadcrumb'> or change it to a plain back link without the Breadcrumb landmark (two landmarks with the same name confuse screen readers).
  2. Add 'install' and its subsegments (console, stages, steps, modules, silos) to SEGMENT_LABELS in AutoBreadcrumb.tsx and make /install/console linkable in navRouteManifest.ts.
  3. Change titles to 'Modules' etc. (drop 'Install — ' prefix) since the crumb supplies context.
- **Acceptance:**
  - Page has exactly one landmark named Breadcrumb.
  - Crumb reads Home / Install / Modules with Install linking to /install/console.
  - Test in AutoBreadcrumb tests for /install/modules.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /install/silos  —  `install/silos.html`

- **Source:** `apps/web/src/app/(app)/install/silos/page.tsx`
- **Design reference:** `redesign/install/silos.html`

### GAP-INSTALL-SILOS-01  ·  HIGH  ·  partly  ·  theme FORMAT (was MONEY)

- [x] **Status** (W2 PQ: closed — showId={false} added to install/silos/page.tsx to hide UUID fragment column (GAP-INSTALL-SILOS-01))
- **W0 note:** partly fixed by #1923 — meta dates are now formatted (metaKind) but a UUID id is still shown as an 8-character fragment in ModuleListTable (full id only in the title)
- **First-pass claim:** Generic ID/Name/Detail/Status/Meta columns come from a heuristic mapper (_data.ts:26-79): ID is a raw id truncated to 8 chars and Meta prints whatever of code|currency|updatedAt|createdAt exists, i.e. a raw ISO timestamp, not a formatted date (ModuleListTable.tsx:56-62).
- **Verified evidence:** No money is involved: _data.ts mapRows (lines 26-79) builds ModuleRowSummary generically; ModuleListTable.tsx:50 prints row.id.slice(0, 8) in a mono span and :54 prints row.meta verbatim. meta = code ?? currency ?? updatedAt ?? createdAt (_data.ts:57-63), so it is a raw ISO string only when the row has no code/currency; points/balance are printed as 'N pts'/'bal N' without formatting. The MONEY tag/fix is wrong; the real issues are an 8-char id fragment and an unformatted timestamp.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/install/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In _data.ts mapRows keep updatedAt/createdAt as separate optional fields (extend ModuleRowSummary in @civitasone/types with updatedAt?: string) instead of folding them into meta.
  2. In ModuleListTable.tsx render the timestamp column with formatIndianDate from @/lib/formatters (as BinsTable.tsx does), and render code (not id) as the identifier where present.
  3. Replace row.id.slice(0, 8) with the row code/name; show the full id only in a title/aria-label or copy control.
  4. Drop the 'bal N' meta (unformatted number, possibly money) or format via formatINR/formatMoney if the field is confirmed paise; cannot confirm unit from this snapshot.
- **Acceptance:**
  - Component test: row {updatedAt:'2026-03-01T10:00:00Z'} renders a formatted Indian date, not the ISO string.
  - Row with code renders the code in the identifier column; no 8-char UUID fragment is visible.
  - Row with no meta renders '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared ModuleListTable is used by many module list pages; column changes affect all, so snapshot-test a few consumers.

### GAP-INSTALL-SILOS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows a badge inside the card and the 'Nothing to show yet' EmptyState together, with no retry action, so an outage reads as 'no records' (ModuleListTable.tsx:31-41).
- **Verified evidence:** apps/web/src/app/(app)/install/silos/page.tsx:7 passes source into ModuleListPage which forwards 'error' to ModuleListTable (ModuleListPage.tsx:28). ModuleListTable.tsx:33 renders DataSourceBadge (provenance error-no-data gives 'Couldn't load — showing nothing', DataSourceBadge.tsx:71) and, when data is empty, :34-35 also renders EmptyState 'No records / Nothing to show yet for this module.' There is no retry action. RefreshErrorState exists at ds/RefreshErrorState.tsx and is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable use provenance from useSeededResource; when provenance === 'error-no-data' && data.length === 0 render <RefreshErrorState error={...} backHref='/install/console'/> instead of EmptyState.
  2. Keep DataSourceBadge only for the 'cached' provenance case.
  3. Build the HumanError (what/next/actions:['retry','back']) via @/lib/messages, matching metadata/records/page.tsx usage.
  4. Keep EmptyState only for provenance === 'live' with zero rows.
- **Acceptance:**
  - Component test: source='error', no cache -> role=alert error with a Retry button, no 'Nothing to show yet' text.
  - source='api' with [] -> EmptyState, no error.
  - Clicking Retry calls router.refresh().
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component affects every ModuleListPage consumer; low business risk.

### GAP-INSTALL-SILOS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Status is plain text (no StatusPill) and there is no search, sort, pagination or mobile card transform on the .tbl (ModuleListTable.tsx:43-66).
- **Verified evidence:** ModuleListTable.tsx:37-58 renders a bare <table className='tbl'> from data.map with no DataTable, search, sort or pagination; status at :53 is plain text {row.status ?? '—'} with no StatusPill (StatusPill exists at ds/StatusPill.tsx). No client-side filtering of a capped fetch exists (the install loaders in _data.ts pass no limit), so the 'stop client-side filtering' fix text does not apply.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the raw table with DataTable from @/app/_components/ds (as BinsTable.tsx does) with sortable, filterable, pageSize={15}.
  2. Render status column via StatusPill with a label (non-colour cue).
  3. Keep the ID/Name/Detail/Status/Meta columns as Col definitions so mobile card transform comes from DataTable.
- **Acceptance:**
  - Test: 30 rows -> 15 shown with pager; filter box narrows rows.
  - Status cell renders StatusPill text.
  - Manual: at 375px width the table does not overflow horizontally.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; install lists are small so pagination is UX only.
- **Depends on:** GAP-INSTALL-SILOS-01

### GAP-INSTALL-SILOS-04  ·  MEDIUM  ·  closed  ·  theme ROLEGATE

- [~] **Status** (W2 PQ: PARTLY closed by #2120 - web gate + forbidden state on silos/page.tsx using INSTALL_SILO_READ_ROLES (mirrors backend READER_ROLES), allow-listed mapSiloProvisions with fixture test, nav link hidden from non-readers on /install/console, backend 403 covered by services/install-service/tests/routes-coverage-full.test.ts 'GET /v1/install/silo-provisions > 403 wrong role'. NEEDS OWNER DECISION: web INSTALL_VIEW_ROLES (install_user, install_admin, super_admin, tenant_admin) vs backend silo READER_ROLES (install_admin, super_admin, platform_admin, install_user) disagree on tenant_admin / platform_admin; kept [~] until aligned. No PRIORITY_QUEUE.md entry exists for this item.)
- **First-pass claim:** Silo provision records are shown with the generic mapper's heuristics (name/title/label/code, description/status) — infrastructure identifiers or error text in these fields would be displayed unfiltered to any viewer; no role gate (_data.ts:44-79, silos/page.tsx).
- **Verified evidence:** silos/page.tsx has no role check, and mapRows (_data.ts:44-63) shows name/title/label/code as label and description/status as detail verbatim (ModuleListTable.tsx:51-53). The mapper does not read errorMessage or infra fields, so error text is only shown if the API puts it into description/status. Whether the route is role-restricted is decided by the (app) layout / gateway and install-service, neither verifiable here (only hrms-service in snapshot). Exposure to any viewer is therefore plausible but unproven.
- **Files to change:** `apps/web/src/app/(app)/install/silos/page.tsx`, `apps/web/src/app/(app)/install/_data.ts`
- **Fix steps:**
  1. Confirm gateway/install-service enforce an admin role on GET /api/v1/install/silo-provisions.
  2. Gate the page via the shared role guard used by other admin pages (check (app)/layout.tsx roles) and hide the nav entry for non-admins.
  3. Replace the generic mapper for silos with an allow-listed typed mapper (tenant, region, status only); do not show free-text detail.
- **Acceptance:**
  - Non-admin session gets forbidden state, not the list.
  - Fixture row with infra hostname in description is not rendered.
  - Server test confirms 403 for non-admin (backend).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Infrastructure disclosure and tenant isolation info; verify server enforcement first.

### GAP-INSTALL-SILOS-05  ·  LOW  ·  partly  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Only a back link (no module breadcrumb Home / Install / page); page title uses an em-dash prefix 'Install — …' instead of a breadcrumb trail (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/install/silos/page.tsx:9-11 renders a single back link to /install/console inside <nav aria-label='Breadcrumb'> and title 'Install — ...' (line 15). But the AppShell already renders a global AutoBreadcrumb in the TopBar (ds/AppShell.tsx:30, used by (app)/layout.tsx:72), so a trail exists; tenant-admin/users/page.tsx:18-22 documents removing duplicate back affordances for that reason. The local nav is a back link mislabelled as Breadcrumb; the 'wiring' theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/install/silos/page.tsx`, `apps/web/src/app/_components/AutoBreadcrumb.tsx`
- **Fix steps:**
  1. Remove the local <nav aria-label='Breadcrumb'> or change it to a plain back link without the Breadcrumb landmark (two landmarks with the same name confuse screen readers).
  2. Add 'install' and its subsegments (console, stages, steps, modules, silos) to SEGMENT_LABELS in AutoBreadcrumb.tsx and make /install/console linkable in navRouteManifest.ts.
  3. Change titles to 'Modules' etc. (drop 'Install — ' prefix) since the crumb supplies context.
- **Acceptance:**
  - Page has exactly one landmark named Breadcrumb.
  - Crumb reads Home / Install / Modules with Install linking to /install/console.
  - Test in AutoBreadcrumb tests for /install/modules.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /install/stages  —  `install/stages.html`

- **Source:** `apps/web/src/app/(app)/install/stages/page.tsx`
- **Design reference:** `redesign/install/stages.html`

### GAP-INSTALL-STAGES-01  ·  HIGH  ·  partly  ·  theme FORMAT (was MONEY)

- [x] **Status** (W2 PQ: closed — showId={false} added to install/stages/page.tsx to hide UUID fragment column (GAP-INSTALL-STAGES-01))
- **W0 note:** partly fixed by #1923 — meta dates are now formatted (metaKind) but a UUID id is still shown as an 8-character fragment in ModuleListTable (full id only in the title)
- **First-pass claim:** Generic ID/Name/Detail/Status/Meta columns come from a heuristic mapper (_data.ts:26-79): ID is a raw id truncated to 8 chars and Meta prints whatever of code|currency|updatedAt|createdAt exists, i.e. a raw ISO timestamp, not a formatted date (ModuleListTable.tsx:56-62).
- **Verified evidence:** No money is involved: _data.ts mapRows (lines 26-79) builds ModuleRowSummary generically; ModuleListTable.tsx:50 prints row.id.slice(0, 8) in a mono span and :54 prints row.meta verbatim. meta = code ?? currency ?? updatedAt ?? createdAt (_data.ts:57-63), so it is a raw ISO string only when the row has no code/currency; points/balance are printed as 'N pts'/'bal N' without formatting. The MONEY tag/fix is wrong; the real issues are an 8-char id fragment and an unformatted timestamp.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/install/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In _data.ts mapRows keep updatedAt/createdAt as separate optional fields (extend ModuleRowSummary in @civitasone/types with updatedAt?: string) instead of folding them into meta.
  2. In ModuleListTable.tsx render the timestamp column with formatIndianDate from @/lib/formatters (as BinsTable.tsx does), and render code (not id) as the identifier where present.
  3. Replace row.id.slice(0, 8) with the row code/name; show the full id only in a title/aria-label or copy control.
  4. Drop the 'bal N' meta (unformatted number, possibly money) or format via formatINR/formatMoney if the field is confirmed paise; cannot confirm unit from this snapshot.
- **Acceptance:**
  - Component test: row {updatedAt:'2026-03-01T10:00:00Z'} renders a formatted Indian date, not the ISO string.
  - Row with code renders the code in the identifier column; no 8-char UUID fragment is visible.
  - Row with no meta renders '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared ModuleListTable is used by many module list pages; column changes affect all, so snapshot-test a few consumers.

### GAP-INSTALL-STAGES-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows a badge inside the card and the 'Nothing to show yet' EmptyState together, with no retry action, so an outage reads as 'no records' (ModuleListTable.tsx:31-41).
- **Verified evidence:** apps/web/src/app/(app)/install/stages/page.tsx:7 passes source into ModuleListPage which forwards 'error' to ModuleListTable (ModuleListPage.tsx:28). ModuleListTable.tsx:33 renders DataSourceBadge (provenance error-no-data gives 'Couldn't load — showing nothing', DataSourceBadge.tsx:71) and, when data is empty, :34-35 also renders EmptyState 'No records / Nothing to show yet for this module.' There is no retry action. RefreshErrorState exists at ds/RefreshErrorState.tsx and is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable use provenance from useSeededResource; when provenance === 'error-no-data' && data.length === 0 render <RefreshErrorState error={...} backHref='/install/console'/> instead of EmptyState.
  2. Keep DataSourceBadge only for the 'cached' provenance case.
  3. Build the HumanError (what/next/actions:['retry','back']) via @/lib/messages, matching metadata/records/page.tsx usage.
  4. Keep EmptyState only for provenance === 'live' with zero rows.
- **Acceptance:**
  - Component test: source='error', no cache -> role=alert error with a Retry button, no 'Nothing to show yet' text.
  - source='api' with [] -> EmptyState, no error.
  - Clicking Retry calls router.refresh().
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component affects every ModuleListPage consumer; low business risk.

### GAP-INSTALL-STAGES-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Status is plain text (no StatusPill) and there is no search, sort, pagination or mobile card transform on the .tbl (ModuleListTable.tsx:43-66).
- **Verified evidence:** ModuleListTable.tsx:37-58 renders a bare <table className='tbl'> from data.map with no DataTable, search, sort or pagination; status at :53 is plain text {row.status ?? '—'} with no StatusPill (StatusPill exists at ds/StatusPill.tsx). No client-side filtering of a capped fetch exists (the install loaders in _data.ts pass no limit), so the 'stop client-side filtering' fix text does not apply.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the raw table with DataTable from @/app/_components/ds (as BinsTable.tsx does) with sortable, filterable, pageSize={15}.
  2. Render status column via StatusPill with a label (non-colour cue).
  3. Keep the ID/Name/Detail/Status/Meta columns as Col definitions so mobile card transform comes from DataTable.
- **Acceptance:**
  - Test: 30 rows -> 15 shown with pager; filter box narrows rows.
  - Status cell renders StatusPill text.
  - Manual: at 375px width the table does not overflow horizontally.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; install lists are small so pagination is UX only.
- **Depends on:** GAP-INSTALL-STAGES-01

### GAP-INSTALL-STAGES-04  ·  MEDIUM  ·  partly  ·  theme MISSING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Stages and Steps are read-only lists, yet Stage 3 has an action elsewhere; the stage list offers no Run/Retry and no progress per stage (stages/page.tsx, ModuleListTable.tsx).
- **Verified evidence:** stages/page.tsx:20-22 already renders a link 'Open Domain Pack activation (Stage 3)' to /install/domain-packs (route exists), so nothing is dead. The list is read-only and has no Run/Retry or per-stage progress; run/skip/retry actions live only on the wizard (install/page.tsx via InstallStepActions.tsx:29, operating on steps, not stages). The stage API exposes no known progress field in this snapshot.
- **Files to change:** `apps/web/src/app/(app)/install/stages/page.tsx`, `apps/web/src/app/(app)/install/_data.ts`
- **Fix steps:**
  1. Add a link from Stages to the wizard (/install) for run/retry, next to the existing Domain Pack link.
  2. If the API returns step counts per stage, add a typed stages mapper and show completed/total; otherwise leave read-only and say so in the description.
  3. Do not add stage-level Run without a backend endpoint.
- **Acceptance:**
  - Page shows link to /install.
  - With fixture step counts, a progress cell shows e.g. 2/5.
  - No new controls call an endpoint that does not exist.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; avoid adding actions that mutate install state without confirm.
- **Depends on:** GAP-INSTALL-STEPS-04

### GAP-INSTALL-STAGES-05  ·  LOW  ·  partly  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Only a back link (no module breadcrumb Home / Install / page); page title uses an em-dash prefix 'Install — …' instead of a breadcrumb trail (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/install/stages/page.tsx:9-11 renders a single back link to /install/console inside <nav aria-label='Breadcrumb'> and title 'Install — ...' (line 15). But the AppShell already renders a global AutoBreadcrumb in the TopBar (ds/AppShell.tsx:30, used by (app)/layout.tsx:72), so a trail exists; tenant-admin/users/page.tsx:18-22 documents removing duplicate back affordances for that reason. The local nav is a back link mislabelled as Breadcrumb; the 'wiring' theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/install/stages/page.tsx`, `apps/web/src/app/_components/AutoBreadcrumb.tsx`
- **Fix steps:**
  1. Remove the local <nav aria-label='Breadcrumb'> or change it to a plain back link without the Breadcrumb landmark (two landmarks with the same name confuse screen readers).
  2. Add 'install' and its subsegments (console, stages, steps, modules, silos) to SEGMENT_LABELS in AutoBreadcrumb.tsx and make /install/console linkable in navRouteManifest.ts.
  3. Change titles to 'Modules' etc. (drop 'Install — ' prefix) since the crumb supplies context.
- **Acceptance:**
  - Page has exactly one landmark named Breadcrumb.
  - Crumb reads Home / Install / Modules with Install linking to /install/console.
  - Test in AutoBreadcrumb tests for /install/modules.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## /install/steps  —  `install/steps.html`

- **Source:** `apps/web/src/app/(app)/install/steps/page.tsx`
- **Design reference:** `redesign/install/steps.html`

### GAP-INSTALL-STEPS-01  ·  HIGH  ·  partly  ·  theme FORMAT (was MONEY)

- [x] **Status** (W2 PQ: ALREADY-FIXED — install/steps/page.tsx uses InstallStepsLog typed component (stepNo/title/isRequired/status columns); no UUID column exists so UUID-hide fix is inapplicable (GAP-INSTALL-STEPS-01))
- **W0 note:** partly fixed by #1923 — meta dates are now formatted (metaKind) but a UUID id is still shown as an 8-character fragment in ModuleListTable (full id only in the title)
- **First-pass claim:** Generic ID/Name/Detail/Status/Meta columns come from a heuristic mapper (_data.ts:26-79): ID is a raw id truncated to 8 chars and Meta prints whatever of code|currency|updatedAt|createdAt exists, i.e. a raw ISO timestamp, not a formatted date (ModuleListTable.tsx:56-62).
- **Verified evidence:** No money is involved: _data.ts mapRows (lines 26-79) builds ModuleRowSummary generically; ModuleListTable.tsx:50 prints row.id.slice(0, 8) in a mono span and :54 prints row.meta verbatim. meta = code ?? currency ?? updatedAt ?? createdAt (_data.ts:57-63), so it is a raw ISO string only when the row has no code/currency; points/balance are printed as 'N pts'/'bal N' without formatting. The MONEY tag/fix is wrong; the real issues are an 8-char id fragment and an unformatted timestamp.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/install/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In _data.ts mapRows keep updatedAt/createdAt as separate optional fields (extend ModuleRowSummary in @civitasone/types with updatedAt?: string) instead of folding them into meta.
  2. In ModuleListTable.tsx render the timestamp column with formatIndianDate from @/lib/formatters (as BinsTable.tsx does), and render code (not id) as the identifier where present.
  3. Replace row.id.slice(0, 8) with the row code/name; show the full id only in a title/aria-label or copy control.
  4. Drop the 'bal N' meta (unformatted number, possibly money) or format via formatINR/formatMoney if the field is confirmed paise; cannot confirm unit from this snapshot.
- **Acceptance:**
  - Component test: row {updatedAt:'2026-03-01T10:00:00Z'} renders a formatted Indian date, not the ISO string.
  - Row with code renders the code in the identifier column; no 8-char UUID fragment is visible.
  - Row with no meta renders '—'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared ModuleListTable is used by many module list pages; column changes affect all, so snapshot-test a few consumers.

### GAP-INSTALL-STEPS-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed fetch shows a badge inside the card and the 'Nothing to show yet' EmptyState together, with no retry action, so an outage reads as 'no records' (ModuleListTable.tsx:31-41).
- **Verified evidence:** apps/web/src/app/(app)/install/steps/page.tsx:7 passes source into ModuleListPage which forwards 'error' to ModuleListTable (ModuleListPage.tsx:28). ModuleListTable.tsx:33 renders DataSourceBadge (provenance error-no-data gives 'Couldn't load — showing nothing', DataSourceBadge.tsx:71) and, when data is empty, :34-35 also renders EmptyState 'No records / Nothing to show yet for this module.' There is no retry action. RefreshErrorState exists at ds/RefreshErrorState.tsx and is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable use provenance from useSeededResource; when provenance === 'error-no-data' && data.length === 0 render <RefreshErrorState error={...} backHref='/install/console'/> instead of EmptyState.
  2. Keep DataSourceBadge only for the 'cached' provenance case.
  3. Build the HumanError (what/next/actions:['retry','back']) via @/lib/messages, matching metadata/records/page.tsx usage.
  4. Keep EmptyState only for provenance === 'live' with zero rows.
- **Acceptance:**
  - Component test: source='error', no cache -> role=alert error with a Retry button, no 'Nothing to show yet' text.
  - source='api' with [] -> EmptyState, no error.
  - Clicking Retry calls router.refresh().
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component affects every ModuleListPage consumer; low business risk.

### GAP-INSTALL-STEPS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Status is plain text (no StatusPill) and there is no search, sort, pagination or mobile card transform on the .tbl (ModuleListTable.tsx:43-66).
- **Verified evidence:** ModuleListTable.tsx:37-58 renders a bare <table className='tbl'> from data.map with no DataTable, search, sort or pagination; status at :53 is plain text {row.status ?? '—'} with no StatusPill (StatusPill exists at ds/StatusPill.tsx). No client-side filtering of a capped fetch exists (the install loaders in _data.ts pass no limit), so the 'stop client-side filtering' fix text does not apply.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the raw table with DataTable from @/app/_components/ds (as BinsTable.tsx does) with sortable, filterable, pageSize={15}.
  2. Render status column via StatusPill with a label (non-colour cue).
  3. Keep the ID/Name/Detail/Status/Meta columns as Col definitions so mobile card transform comes from DataTable.
- **Acceptance:**
  - Test: 30 rows -> 15 shown with pager; filter box narrows rows.
  - Status cell renders StatusPill text.
  - Manual: at 375px width the table does not overflow horizontally.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; install lists are small so pagination is UX only.
- **Depends on:** GAP-INSTALL-STEPS-01

### GAP-INSTALL-STEPS-04  ·  MEDIUM  ·  confirmed  ·  theme MISSING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Duplicates the wizard's step list but read-only and without isRequired/stepNo/errorMessage: a failed step shows only the word 'failed' and cannot be retried here (steps/page.tsx, ModuleListTable.tsx:44-55).
- **Verified evidence:** steps/page.tsx uses the generic ModuleListPage (ModuleListTable.tsx:40-44), showing only id/name/detail/status/meta. The wizard (install/page.tsx:114-146) shows stepNo, isRequired, errorMessage (line 136-138) and InstallStepActions (run/skip/retry, InstallStepActions.tsx:25-31). So /install/steps is a lossy read-only duplicate; a failed step shows only the status word, and no link to the wizard.
- **Files to change:** `apps/web/src/app/(app)/install/steps/page.tsx`, `apps/web/src/app/(app)/install/_data.ts`
- **Fix steps:**
  1. Decision: either redirect /install/steps to /install or keep it as a log view.
  2. If kept, add a typed steps mapper (stepNo, isRequired, errorMessage) reusing the type from getInstallSteps in _data/loaders.ts (used by install/page.tsx).
  3. Render errorMessage for failed rows and a 'Retry in installer' link to /install.
  4. Do not duplicate InstallStepActions here.
- **Acceptance:**
  - Failed step fixture shows its errorMessage and a link to /install.
  - Rows are ordered by stepNo.
  - Required steps are marked.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; keep single place for state-changing actions.

### GAP-INSTALL-STEPS-05  ·  LOW  ·  partly  ·  theme NAV (was WIRING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Only a back link (no module breadcrumb Home / Install / page); page title uses an em-dash prefix 'Install — …' instead of a breadcrumb trail (page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/install/steps/page.tsx:9-11 renders a single back link to /install/console inside <nav aria-label='Breadcrumb'> and title 'Install — ...' (line 15). But the AppShell already renders a global AutoBreadcrumb in the TopBar (ds/AppShell.tsx:30, used by (app)/layout.tsx:72), so a trail exists; tenant-admin/users/page.tsx:18-22 documents removing duplicate back affordances for that reason. The local nav is a back link mislabelled as Breadcrumb; the 'wiring' theme is wrong.
- **Files to change:** `apps/web/src/app/(app)/install/steps/page.tsx`, `apps/web/src/app/_components/AutoBreadcrumb.tsx`
- **Fix steps:**
  1. Remove the local <nav aria-label='Breadcrumb'> or change it to a plain back link without the Breadcrumb landmark (two landmarks with the same name confuse screen readers).
  2. Add 'install' and its subsegments (console, stages, steps, modules, silos) to SEGMENT_LABELS in AutoBreadcrumb.tsx and make /install/console linkable in navRouteManifest.ts.
  3. Change titles to 'Modules' etc. (drop 'Install — ' prefix) since the crumb supplies context.
- **Acceptance:**
  - Page has exactly one landmark named Breadcrumb.
  - Crumb reads Home / Install / Modules with Install linking to /install/console.
  - Test in AutoBreadcrumb tests for /install/modules.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.
