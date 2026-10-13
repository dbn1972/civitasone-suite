# Detailed gap file — module `setup`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 7



---
## /setup  —  `setup/home.html`

- **Source:** `apps/web/src/app/(app)/setup/page.tsx`
- **Design reference:** `redesign/setup/home.html`

### GAP-SETUP-HOME-01  ·  HIGH  ·  partly  ·  theme MODULEGATE (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Required step 'Set up departments' is evaluated from GET /api/v1/hrms/org-chart (progress.ts:77-82) but has no moduleKey (setupSteps.ts:72-81), so it always shows. A tenant with HR turned off can never complete it, so allRequiredComplete() never returns true and the 'Your office is ready' card is unreachable.
- **Verified evidence:** Confirmed: apps/web/src/lib/setupSteps.ts:71-81 'departments' is required:true with no moduleKey, evaluated in apps/web/src/app/(app)/setup/progress.ts:77-82 from /api/v1/hrms/org-chart, and page.tsx:32 only hides steps with a moduleKey. allRequiredComplete (setupSteps.ts:157) needs it complete. Not verifiable: whether the gateway returns an error when HR is off (would give 'unknown', never complete). Additionally the signal is wrong even with HR on: the org-chart route (hrms-service/src/modules/orgchart/routes.ts) is a people hierarchy, and a real departments endpoint exists (/api/v1/hrms/departments, used by (app)/hr/departments/page.tsx:32), contradicting the comment at progress.ts:78.
- **Files to change:** `apps/web/src/lib/setupSteps.ts`, `apps/web/src/app/(app)/setup/progress.ts`
- **Fix steps:**
  1. Set moduleKey: 'hrms' on the departments step (or make it non-required when HR is off) so it is filtered by isModuleEnabled.
  2. Change evalDepartments to count /api/v1/hrms/departments instead of org-chart, and fix the comment.
  3. Ensure REQUIRED_STEP_KEYS/allRequiredComplete only consider steps visible for the tenant (pass visible keys).
  4. Add tests: HR disabled -> step hidden and ready card reachable.
- **Acceptance:**
  - Tenant with HR off, other required steps done: 'Your office is ready' appears.
  - Tenant with HR on and zero departments: step is 'To do'; after adding one it turns Done.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium. Changes when the ready state and onboarding funnel events fire.
- **Depends on:** GAP-SETUP-HOME-04

### GAP-SETUP-HOME-02  ·  HIGH  ·  confirmed  ·  theme OTHER (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** 'Do it later' links to /dashboard and records nothing (SetupWizard.tsx:143-146): the step stays 'To do', stays the resume target on every visit and keeps counting against progress, while the label implies a deferral was saved.
- **Verified evidence:** apps/web/src/app/(app)/setup/SetupWizard.tsx:143-147 'Do it later' shows only for non-required, non-complete steps and is a plain Link to /dashboard; nothing is recorded. Resume target is firstIncompleteIndex (setupSteps.ts:162-165), which includes optional steps, and progress counts them in totalCount (page.tsx:44,58), so the step stays 'To do'. The button only navigates away. Theme I18N is wrong (behaviour/copy).
- **Files to change:** `apps/web/src/app/(app)/setup/SetupWizard.tsx`, `apps/web/src/lib/setupSteps.ts`, `apps/web/src/app/(app)/setup/page.tsx`
- **Fix steps:**
  1. Decide semantics: either rename the link 'Skip to dashboard', or persist a per-tenant deferral.
  2. If persisting: store skipped step keys (tenant setting/user preference via existing settings API) and treat them as 'skipped' status excluded from resume and denominator.
  3. Have firstIncompleteIndex ignore skipped steps.
- **Acceptance:**
  - After 'Do it later' on step 6, revisiting /setup resumes at the next step and the counter excludes step 6.
  - Skipped step can still be opened.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low. Requires a place to store the flag (no endpoint confirmed).

### GAP-SETUP-HOME-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Completion signals are weak or inconsistent: 'modules' is complete when tenant-settings returns any row (progress.ts:91-94), not when a module choice was made; 'branches' completes at ≥1 location but 'people' needs >1 user (progress.ts:72-89), so a single head-office record counts as 'add your branch offices'.
- **Verified evidence:** apps/web/src/app/(app)/setup/progress.ts:72-74 branches complete at >=1 location (true); :84-89 people needs >1 user (true); :91-94 modules = listStatus of getTenantSettings, i.e. any row from /api/v1/admin/tenant/modules (loaders.ts:803, mapTenantSettings returns null when zero rows, so an empty list is probably treated as a load failure -> 'unknown' rather than todo; not verified in apiClient). 'Any row' is not proof the admin chose modules. Descriptions are accurate; a single head-office record counting as 'add your branch offices' is by design per the copy ('head office first').
- **Files to change:** `apps/web/src/app/(app)/setup/progress.ts`
- **Fix steps:**
  1. Define 'modules' completion explicitly (e.g. a 'modulesConfirmed' flag or at least one enabled module set by the admin), not row count.
  2. For branches, either require >=2 locations or reword the step copy to 'Add your head office'.
  3. Handle empty modules list as todo, not unknown.
- **Acceptance:**
  - Tenant with the default module seed still shows 'modules' To do until confirmed.
  - Single head-office tenant shows the step per the chosen rule.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-SETUP-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Steps 1 and 5 both send the clerk to /tenant-admin/settings (setupSteps.ts:58, 102) and step 3 (departments) to /hr/directory, not to a screen that creates departments; the wizard cannot tell which action the clerk performed on return.
- **Verified evidence:** setupSteps.ts:58 (org-profile) and :102 (modules) both use /tenant-admin/settings; :80 departments uses /hr/directory. A departments management screen exists: apps/web/src/app/(app)/hr/departments (with /new). SetupWizard.tsx:117 appends ?return=/setup, but grep of tenant-admin/settings and locations finds no code reading a `return` param, so users are not sent back.
- **Files to change:** `apps/web/src/lib/setupSteps.ts`, `apps/web/src/app/(app)/tenant-admin/settings/page.tsx`
- **Fix steps:**
  1. Point departments entryHref to /hr/departments (or /hr/departments/new).
  2. Give step 5 a distinct entry (module toggles section or anchor #modules) and step 1 #profile.
  3. Implement `return` handling (validated same-origin relative path) on target pages, or drop the misleading query.
- **Acceptance:**
  - Clicking 'Add departments' lands on the departments page.
  - Steps 1 and 5 open different sections/anchors.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Validate return param against open redirects.
- **Depends on:** GAP-SETUP-HOME-01

### GAP-SETUP-HOME-05  ·  MEDIUM  ·  partly  ·  theme ERRORS (was CONFIRM)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Sample-data controls fire two POST/DELETE calls (locations + finance bills) with no per-call result; a partial failure is reported as a single message (SampleDataControls.tsx:24-43). Clear is behind a ConfirmDialog; Add runs immediately.
- **Verified evidence:** apps/web/src/app/(app)/setup/SampleDataControls.tsx:24-28 posts to locations and finance in Promise.all and throws only if BOTH fail (`!locRes.ok && !finRes.ok`); if only one fails, the user is told 'Example offices and bills added'. Same for clear (:41-45): a half failure closes the dialog and reports success. So the problem is worse than the observation (partial failure reported as success, not as a single message). Add has no confirmation (true); Clear uses ConfirmDialog (:88).
- **Files to change:** `apps/web/src/app/(app)/setup/SampleDataControls.tsx`
- **Fix steps:**
  1. Use Promise.allSettled and inspect both responses.
  2. Report per-source result: e.g. 'Offices added; bills could not be added' with a retry for the failed one.
  3. On clear with partial failure keep the dialog open with the specific error.
  4. Optionally confirm Add too (creates records in a real tenant).
- **Acceptance:**
  - Mock locations 200 and finance 500: message names bills as failed, not success.
  - Both 200: current success message.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Sample data is [SAMPLE]-labelled; clear only deletes samples.

### GAP-SETUP-HOME-06  ·  LOW  ·  confirmed  ·  theme ICONS (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Emoji used as step icons and in the ready card (setupSteps.ts icon fields, SetupWizard.tsx:74, 102) — decorative, aria-hidden, but inconsistent with the DS icon set.
- **Verified evidence:** Emoji icon fields at setupSteps.ts:52,62,74,86,96,107,119,131; rendered inside aria-hidden spans at SetupWizard.tsx:127 and :102 (🎉); another 🎉 sits in the encouragement string at :74 which is not hidden. Inconsistent with the DS icon set (StatIcon uses lucide).
- **Files to change:** `apps/web/src/lib/setupSteps.ts`, `apps/web/src/app/(app)/setup/SetupWizard.tsx`
- **Fix steps:**
  1. Replace icon strings with lucide icon names/components (Building2, MapPin, Layers, Users, Puzzle, BookOpen, Palmtree, Wallet).
  2. Render via a small icon map in SetupWizard.
  3. Drop the emoji from the encouragement text or aria-hide it.
- **Acceptance:**
  - No emoji in the wizard markup; step icons use the DS icon set.
  - No axe issues.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-SETUP-HOME-07  ·  LOW  ·  confirmed  ·  theme THEMING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Outline colour for the resume card uses a hard-coded fallback #4f46e5 and warning text #92400e instead of tokens (SetupWizard.tsx:93, 123).
- **Verified evidence:** apps/web/src/app/(app)/setup/SetupWizard.tsx:93 and :149 use color #92400e; :123 outline uses var(--primary, #4f46e5) (token with hard-coded fallback); the sample-data message colours in SampleDataControls.tsx:79-81 are also hard-coded hex. Only the fallback is arguably harmless. Line refs :93,123 are right; :149 is a third instance.
- **Files to change:** `apps/web/src/app/(app)/setup/SetupWizard.tsx`, `apps/web/src/app/(app)/setup/SampleDataControls.tsx`
- **Fix steps:**
  1. Replace #92400e with the warning text token (e.g. var(--warn) or var(--warn-ink) if defined in the DS CSS).
  2. Drop the #4f46e5 fallback from var(--primary).
  3. Use var(--bad)/var(--good) style tokens for the sample-data message.
- **Acceptance:**
  - Grep of the setup folder finds no hex colours.
  - Dark mode shows readable text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
