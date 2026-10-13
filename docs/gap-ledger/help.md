# Detailed gap file — module `help`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 9



---
## /help  —  `help/home.html`

- **Source:** `apps/web/src/app/(app)/help/page.tsx`
- **Design reference:** `redesign/help/home.html`

### GAP-HELP-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle promises guides "for every part of the system" (page.tsx:31) but only nine "Major Modules" have guides (helpContent.ts:41-51); CRM, Helpdesk, Assets, Stock, Fleet, Learning and the rest of the nav have none, and there is no indication of that gap.
- **Verified evidence:** help/page.tsx:31 subtitle says 'guides for every part of the system'; the header comment (page.tsx:15-16) says 'every module the office uses'. HELP_MODULES in lib/helpContent.ts has exactly nine entries (finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin; MAJOR_MODULE_SLUGS at helpContent.ts:41-51). Sidebar.tsx has many more modules (Helpdesk :94, CRM, Assets, Stock, Fleet, Learning...) with no guide and the hub shows no note about that.
- **Files to change:** `apps/web/src/app/(app)/help/page.tsx`, `apps/web/src/lib/helpContent.ts`
- **Fix steps:**
  1. Change the PageHeader subtitle at help/page.tsx:31 to something true, e.g. 'Short guides for the main modules, plus a plain-English glossary.'
  2. Add a one-line note under the 'Guides by module' heading: 'Guides for other modules are being added. For anything not listed, raise a ticket from Helpdesk.' (reuse the existing 'Still stuck?' footer link to /helpdesk).
  3. Optional follow-up: add HelpModule entries in lib/helpContent.ts for helpdesk, crm, assets, stock, fleet, learning using the existing HelpModule shape (slug, moduleKey, tasks, terms); generateStaticParams in [module]/page.tsx picks them up automatically.
- **Acceptance:**
  - Component/snapshot test: /help subtitle no longer contains 'every part of the system'.
  - Manual: /help shows the 'other modules' note and Helpdesk link works.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None (copy only). Writing the extra module guides is separate content work.

### GAP-HELP-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme UX (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Glossary is a single flat A–Z dl of all 81 entries with no search, anchors or filter (page.tsx:23-67); aliases are separate rows ("HoA" and "Head of Account", "UC" and "Utilisation Certificate", glossary.ts:11-17), so the page is long and repetitive on a phone.
- **Verified evidence:** help/page.tsx:23-25 sorts Object.entries(GLOSSARY) with localeCompare and 58-67 renders one flat <dl> with no search box, no letter anchors, no filter. lib/glossary.ts has 81 entries; aliases are separate rows (HoA line 11 vs 'Head of Account' line 12, UC line 16 vs 'Utilisation Certificate' line 17). Sorting by key mixes abbreviations and full names so alias pairs are not adjacent. The theme tag PII does not apply.
- **Files to change:** `apps/web/src/app/(app)/help/GlossaryList.tsx`, `apps/web/src/app/(app)/help/page.tsx`, `apps/web/src/lib/glossary.ts`
- **Fix steps:**
  1. Create client component help/GlossaryList.tsx taking entries: [term, definition][]; add a text input (label 'Search words') filtering on term and definition, and an A-Z jump-link row using id anchors per initial letter.
  2. Render it from help/page.tsx in place of the inline <dl> (keep the Card wrapper and intro paragraph).
  3. Collapse aliases: add an optional alias map in lib/glossary.ts (e.g. HoA -> 'Head of Account') and render one row 'Head of Account (HoA)' instead of two rows; keep the lookup used by tooltips (explain()) unchanged.
  4. Show 'No words match' empty text with aria-live polite when the filter has no hits.
- **Acceptance:**
  - Test: typing 'voucher' shows only the Voucher entry; clearing restores all.
  - Test: HoA and Head of Account render as one row.
  - Manual at 375px width: A-Z bar wraps and jumping to a letter scrolls to it.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. explain()/defineTerm() tooltips share GLOSSARY so do not delete alias keys, only change presentation.

### GAP-HELP-HOME-03  ·  MEDIUM  ·  partly  ·  theme UX (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** No empty state: when no module is enabled the heading renders over an empty grid (page.tsx:35-51). Also isModuleEnabled is called without roles (page.tsx:21), so super_admin/platform_admin lose the bypass documented at moduleVisibility.ts:33 and see fewer guides than the modules they can open.
- **Verified evidence:** Empty-state claim is not reachable: HELP_MODULES includes tenant-admin with moduleKey null (helpContent.ts:329) and isModuleEnabled returns true for a null key (moduleVisibility.ts:39), so the grid always has at least one tile. True part: help/page.tsx:21 calls isModuleEnabled(enabled, m.moduleKey) without the roles argument, so the super_admin/platform_admin bypass (moduleVisibility.ts:42) is never used here. But no caller passes roles (ModuleGate.tsx:25 and setup/page.tsx:32 also omit it), so an admin is gated out of the module itself by ModuleGate too; no guide-vs-module mismatch actually occurs today.
- **Files to change:** `apps/web/src/app/(app)/help/page.tsx`
- **Fix steps:**
  1. Decide the intended policy: if admins should bypass gating, pass getSessionRoles() (lib/auth/roleGuard.ts:26) into isModuleEnabled here AND in ModuleGate.tsx and setup/page.tsx together; otherwise remove the dead roles bypass or its doc comment.
  2. Defensive only: if visibleModules.length === 0, render EmptyState 'No guides for your enabled modules' instead of an empty grid.
- **Acceptance:**
  - Unit test: isModuleEnabled(['finance'], 'grants', ['super_admin']) true and the same call without roles false, and a page test for whichever policy is chosen.
  - Test: with enabled=['finance'] the hub still shows Finance and Tenant Admin.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Changing the bypass in only one place would let admins see guides for modules that ModuleGate then blocks. Change consistently or not at all.

### GAP-HELP-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme UX (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** "Take the welcome tour again" silently clears one localStorage key and hard-navigates to /dashboard (ReplayTourButton.tsx:98-105): full reload, no confirmation, and if storage is blocked the catch swallows the error yet still navigates, so the tour does not replay and the user is told nothing.
- **Verified evidence:** help/ReplayTourButton.tsx:7-13: replay() runs localStorage.removeItem('civitasone.tour.dashboard.v1') inside try/catch that ignores errors, then window.location.assign('/dashboard') (full reload). No confirmation, no toast. FirstRunTour.tsx:34 uses the same key and its own catch (about line 74) simply does not show the tour when storage is unavailable, so with blocked storage the user lands on the dashboard with no tour and no message. Line numbers in the observation (98-105) are wrong; file is 18 lines. ConfirmDialog/maker-checker do not apply to a harmless preference reset.
- **Files to change:** `apps/web/src/app/(app)/help/ReplayTourButton.tsx`, `apps/web/src/app/(app)/dashboard/FirstRunTour.tsx`
- **Fix steps:**
  1. In ReplayTourButton use useRouter().push('/dashboard') instead of window.location.assign, so no full reload (FirstRunTour reads storage on mount so a client navigation is enough).
  2. Track success: on catch, set local error state and do NOT navigate; render inline role='alert' text 'Your browser is blocking saved settings, so the tour cannot replay.'
  3. Export the STORAGE_KEY constant from FirstRunTour (or a small tour.ts) and import it instead of duplicating the string.
  4. Show useToast().toast.success('Welcome tour will start on the dashboard.') before navigating.
- **Acceptance:**
  - Component test: mock localStorage.removeItem to throw -> router.push not called and alert text shown.
  - Component test: normal path removes the key and calls router.push('/dashboard').
  - Manual: click button, dashboard opens with the tour modal visible without a browser reload.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Client-side navigation must still mount FirstRunTour fresh; verify the effect runs on soft navigation.

### GAP-HELP-HOME-05  ·  LOW  ·  confirmed  ·  theme STYLE (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1924 — token-based tile icon background and tile-shaped loading skeletons are in; hub strings in help/page.tsx are still literal English (no getTranslations/help namespace)
- **First-pass claim:** Hard-coded English strings and inline styles (icon background #eef2ff, page.tsx:44) instead of next-intl keys and tokens; loading.tsx draws four stat-card blocks the hub does not have (loading.tsx:4-9).
- **Verified evidence:** help/page.tsx:44 has inline style background '#eef2ff' on the tile icon (.mtile .ic in civitas-ds.css:242 has no background and .mtile is #fff at :241, so dark theme also breaks). Titles, subtitle, headings and glossary intro are literal English (lines 9, 30-31, 35, 53, 55-56, 70-72) although next-intl is used in ~420 files (useTranslations/getTranslations). help/loading.tsx:4-9 draws a title bar plus four stat-card blocks and a 256px table block, but the hub has no stat cards. Not a fabricated-figure issue.
- **Files to change:** `apps/web/src/app/(app)/help/page.tsx`, `apps/web/src/app/(app)/help/loading.tsx`, `apps/web/src/app/(app)/help/[module]/loading.tsx`, `apps/web/src/app/civitas-ds.css`
- **Fix steps:**
  1. Replace style={{ background: '#eef2ff' }} at page.tsx:44 with a token-based class (e.g. .mtile .ic { background: var(--brand-soft) } in civitas-ds.css, using whichever existing soft-brand token the DS defines).
  2. Move the hub strings into the help namespace via getTranslations('help') and add keys to the message files (en, hi).
  3. Rewrite help/loading.tsx as: heading skeleton, then a 3-column grid of 6 tile-shaped skeletons (matches .grid.g-3 .mtile), then one card skeleton; drop the 4 stat blocks.
  4. Reuse the same skeleton for help/[module]/loading.tsx but with a button-shaped block and two task cards.
- **Acceptance:**
  - Manual: dark theme shows tile icon backgrounds using tokens, no #eef2ff in the DOM.
  - Grep test: no hex colours in help/**/*.tsx.
  - Manual: throttle network, loading skeleton has no stat-card row.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Translation keys need Hindi copy sign-off.


---
## /help/[module]  —  `help/module.html`

- **Source:** `apps/web/src/app/(app)/help/[module]/page.tsx`
- **Design reference:** `redesign/help/module.html`

### GAP-HELP-MODULE-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1916/#1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Grants guide steps do not match the screens: "Choose the instalment to release. Send the payment for approval." (helpContent.ts:250-253) — the coded flow is a Release button on a pending installment that disburses directly after a typed reason (grants/installments/InstallmentsTable.tsx:70-90); the eOffice "Raise for approval" exists only on the disbursement detail page, which no list links to.
- **Verified evidence:** lib/helpContent.ts (grants task 'Release a grant payment', ~lines 246-253) says 'Choose the instalment to release. Send the payment for approval.' Actual UI: grants/installments/InstallmentsTable.tsx:66-92 shows a Release ActionButton on pending rows with requireReason, which POSTs /api/proxy/v1/grants/installments/{id}/disburse directly ({mode:'PFMS', beneficiaryBankRef: reason}); there is no approval step there. 'Raise for approval' (_components/RaiseEOfficeNote.tsx:156) is only rendered on grants/disbursements/[id]/page.tsx:65-72, and no list links to /grants/disbursements/[id] (grep of grants/** finds no href to it; ReleasesTable has no row link). Note: the reason typed is sent as beneficiaryBankRef, which looks like a mis-mapping worth a separate check.
- **Files to change:** `apps/web/src/lib/helpContent.ts`, `apps/web/src/app/(app)/grants/releases/ReleasesTable.tsx`
- **Fix steps:**
  1. Get a product decision: is releasing an installment meant to go straight to disbursement, or through eOffice approval first? (money movement without maker-checker is a control question, not just copy).
  2. If direct release stays: rewrite steps to 'Open Grants, then Installments.', 'Find the pending installment and click Release.', 'Type the approval reference or reason and confirm; the amount is sent for payment and cannot be undone.'
  3. If approval is intended: add rowLinkKey/rowLinkPrefix='/grants/disbursements/' (or a link column) on the releases list so the detail page with 'Raise for approval' is reachable, then keep the 'send for approval' wording and name the page.
  4. Verify that the reason field is not being written into beneficiaryBankRef (InstallmentsTable.tsx:~87) with the grants team.
- **Acceptance:**
  - Content review: each step text maps to a visible button label on the referenced screen.
  - If approval flow chosen: manual click-path from Grants > Releases to a disbursement detail with 'Raise for approval' works.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Wrong instructions on a payment flow; if the direct-release path lacks approval that is a business-control gap and must be escalated, not just re-worded.

### GAP-HELP-MODULE-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1916/#1925, verified on main 9c5e9e9e9)
- **First-pass claim:** "Record it once received and verified" (helpContent.ts:261) — UC Management offers only Verify and Reject on submitted/pending certificates (grants/utilization/UtilizationTable.tsx:70-114); there is no record/upload action for the office. Spelling also differs ("instalment" here, "Installment" in the UI and glossary).
- **Verified evidence:** lib/helpContent.ts (~line 261) step 'Record it once received and verified.' grants/utilization/UtilizationTable.tsx:~67-112 renders only Verify (POST utilization-certs/{id}/validate status 'validated') and Reject (status 'rejected'), and only when status is submitted or pending; the utilization folder has only UtilizationTable/page/loading/error, so there is no record/upload/new action for the office. Spelling: guide text uses 'instalment'/'Utilisation' while the UI, terms list and glossary.ts:71 use 'Installment' (the terms array entry 'Installment' resolves the glossary key).
- **Files to change:** `apps/web/src/lib/helpContent.ts`
- **Fix steps:**
  1. Replace step 3 with 'When the grantee submits the certificate, click Verify to accept it, or Reject to send it back with a reason.'
  2. Replace step 2 with 'Find the grantee's certificate and check its status (Submitted or Pending).'
  3. Standardise spelling across the grants guide: use 'installment' (matches UI and glossary) and 'utilisation' consistently.
- **Acceptance:**
  - Content review against UtilizationTable button labels (Verify, Reject).
  - Grep: no 'instalment' left in helpContent.ts.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; copy only. If product actually wants an office-side 'record UC' action that is a new feature.
- **Depends on:** GAP-HELP-MODULE-01

### GAP-HELP-MODULE-03  ·  MEDIUM  ·  confirmed  ·  theme UX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** No enablement check: the hub filters by isModuleEnabled (page.tsx:21) but this route only calls getHelpModule (page.tsx:20), so a guide for a module the office has turned off is still served by direct URL; steps are plain text with no links to the screens they describe.
- **Verified evidence:** help/[module]/page.tsx:20-21 (getHelpModule then notFound) never consults getEnabledModules/isModuleEnabled, while help/page.tsx:21 does, so /help/grants renders for a tenant that disabled Grants. There is no help/layout.tsx. Steps are rendered as plain <li>{step}</li> (page.tsx ~46-48) with strings only. Severity is low: guides are static text, no data leaks. Note generateStaticParams makes the page static; reading enablement makes it dynamic.
- **Files to change:** `apps/web/src/app/(app)/help/[module]/page.tsx`, `apps/web/src/lib/helpContent.ts`
- **Fix steps:**
  1. Make HelpModulePage async; call getEnabledModules() and if !isModuleEnabled(enabled, mod.moduleKey) render EmptyState 'This module is not enabled for your office' with a link back to /help (or call notFound()).
  2. Drop or keep generateStaticParams knowingly (dynamic rendering will override it).
  3. Extend the task step type to string | { text: string; href?: string } and render <Link> when href is present; add hrefs for the main steps (e.g. /grants/installments, /grants/utilization).
  4. Update helpContent.ts entries incrementally; string steps stay valid.
- **Acceptance:**
  - Test: enabled=['finance'] and slug 'grants' shows the not-enabled state; slug 'finance' renders.
  - Test: a step with href renders an anchor to the right route.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Keep the same role policy as the hub (see HOME-03) so hub and detail agree.
- **Depends on:** GAP-HELP-HOME-03

### GAP-HELP-MODULE-04  ·  LOW  ·  confirmed  ·  theme UX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Unknown slug lands on the root "404 — Page not found" EmptyState with no link back to the Help Centre (app/not-found.tsx:3-9); title embeds an emoji from data (page.tsx:32) which screen readers read aloud; loading.tsx shows four stat blocks the page never has.
- **Verified evidence:** app/not-found.tsx:3-9 is the only not-found (no app/(app)/not-found.tsx, no help/not-found.tsx); [module]/page.tsx:21 calls notFound() so an unknown slug shows EmptyState '404 - Page not found' with no action, although EmptyState supports an `action` prop (ds/EmptyState.tsx:8,40). [module]/page.tsx:32 builds the title as `${mod.icon} ${mod.title}` so the emoji is part of the h1 text and is read aloud. help/[module]/loading.tsx shows four stat blocks the page never has (same skeleton as hub).
- **Files to change:** `apps/web/src/app/(app)/help/not-found.tsx`, `apps/web/src/app/(app)/help/[module]/page.tsx`, `apps/web/src/app/(app)/help/[module]/loading.tsx`
- **Fix steps:**
  1. Add help/not-found.tsx modelled on helpdesk/not-found.tsx: EmptyState title 'Guide not found', message, and action={<Link href='/help' className='btn primary'>Back to Help Centre</Link>}.
  2. In [module]/page.tsx pass title={mod.title} and render the icon separately in a <span aria-hidden='true'> (PageHeader has an icon slot? if not, wrap the title node).
  3. Replace loading.tsx skeleton with header + button + two task-card blocks (see HOME-05).
- **Acceptance:**
  - Manual: /help/does-not-exist shows 'Guide not found' with a working link to /help.
  - Test: h1 accessible name equals the module title without the emoji.
  - Loading state shows no stat-card row.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Confirm PageHeader.title accepts ReactNode before passing a node.
- **Depends on:** GAP-HELP-HOME-05
