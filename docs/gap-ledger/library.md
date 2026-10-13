# Detailed gap file — module `library`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 5



---
## /library  —  `library/home.html`

- **Source:** `apps/web/src/app/(app)/library/page.tsx`
- **Design reference:** `redesign/library/home.html`

### GAP-LIBRARY-HOME-01  ·  HIGH  ·  confirmed  ·  theme NAVUX

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The /library route is not a library module: it is an audit-issue catalogue titled 'Issue Library' whose back link goes to /admin (page.tsx:154-158). Users looking for a document or book library land on engineering findings, and the sidebar has no 'library' entry (data-active mapped to audit, the nearest group, as no NAV id fits).
- **Verified evidence:** library/page.tsx:154-158 renders PageHeader title 'Issue Library' with back='/admin'; ISSUE_LIBRARY (l.54-119) is a static list of UX/a11y/security findings. The real document/book library is /estab/library (navRouteManifest.ts:50). Sidebar.tsx has no '/library' entry (grep empty). The 'data-active mapped to audit' claim could not be found in code.
- **Files to change:** `apps/web/src/app/(app)/library/page.tsx`, `apps/web/src/app/_components/navRouteManifest.ts`
- **Fix steps:**
  1. Decide the intent: either move the catalogue to developer docs (see GAP-LIBRARY-HOME-03) and delete /library, or rename it.
  2. If kept, retitle the page 'Audit finding types' and keep it reachable only from the admin/audit area (link from there), leaving the 'library' name to /estab/library.
  3. If /library should be the document library, replace the route with a redirect to /estab/library (next.config redirects or redirect() in page.tsx).
  4. Remove /library from any nav manifests that list it; keep back link pointing to the real parent.
- **Acceptance:**
  - Visiting /library no longer shows engineering findings under the name 'Library'.
  - Sidebar/nav search for 'library' leads only to /estab/library.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; static page, but a redirect could break bookmarks.
- **Depends on:** GAP-LIBRARY-HOME-03

### GAP-LIBRARY-HOME-02  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No segment layout: unlike legal/layout.tsx there is no requireAnyRole or ModuleGate for /library, so role and module-visibility rules do not apply to this route (only the parent (app)/layout.tsx runs).
- **Verified evidence:** Confirmed: no library/layout.tsx exists (dir has only page.tsx, loading.tsx), so no requireAnyRole/ModuleGate as in legal/layout.tsx:7-9; only (app)/layout.tsx applies. Impact is overstated: the page is a hard-coded static list with no API call or tenant data, so nothing sensitive is exposed.
- **Files to change:** `apps/web/src/app/(app)/library/layout.tsx`
- **Fix steps:**
  1. If the page is kept, add library/layout.tsx mirroring legal/layout.tsx: requireAnyRole([...]) from @/lib/auth/roleGuard with admin/auditor roles.
  2. If the page is removed (HOME-01/03), no change needed.
- **Acceptance:**
  - A viewer-only user without the allowed role is redirected/denied at /library.
  - Allowed role still loads the page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; wrong role list could lock out auditors.
- **Depends on:** GAP-LIBRARY-HOME-01

### GAP-LIBRARY-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Tenant-facing page lists internal engineering gaps in plain terms (for example 'Missing CSRF protection on state-changing APIs', page.tsx:82); the page says it is the same for every tenant and maintained by developers (page.tsx:161-163), so it belongs in developer docs, not the product UI.
- **Verified evidence:** library/page.tsx:82 has 'Missing CSRF protection on state-changing APIs' and l.160-163 states it is the same for every tenant and maintained by developers. It is dev-facing content shown in the tenant product UI.
- **Files to change:** `apps/web/src/app/(app)/library/page.tsx`, `docs/`
- **Fix steps:**
  1. Move ISSUE_LIBRARY content to developer docs (docs/ folder or the marketing /docs chapters).
  2. Delete apps/web/src/app/(app)/library/page.tsx and loading.tsx, or gate behind a platform_admin-only layout if a live view is really wanted.
  3. Remove any nav/manifest references.
- **Acceptance:**
  - No tenant-role user can see /library.
  - Content exists in developer docs.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; check nobody links to /library.
- **Depends on:** GAP-LIBRARY-HOME-01

### GAP-LIBRARY-HOME-04  ·  LOW  ·  partly  ·  theme LOADING (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** library/loading.tsx renders a six-tile card grid that never shows (the page has no async work) and does not match the list layout; severity colours mix token pairs with literals #2563eb/#eff6ff/#6b7280 (page.tsx:27,33-34).
- **Verified evidence:** library/loading.tsx renders header skeleton plus six SkeletonCard in grid g-3, while page.tsx is a client component over static data (no fetch), so the skeleton only flashes during route chunk load; it does not resemble the list layout. Hard-coded colours are real but at lines 27,29 (#2563eb,#6b7280) and 35,37 (#eff6ff,#f9fafb), not only 27,33-34; critical/high/low already use var(--bad/--warn/--good). Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/library/loading.tsx`, `apps/web/src/app/(app)/library/page.tsx`
- **Fix steps:**
  1. Replace loading.tsx body with header skeleton plus 4-5 stacked full-width list-row skeletons (or delete it if the page is removed).
  2. Replace #2563eb/#eff6ff and #6b7280/#f9fafb in SEVERITY_COLOR/SEVERITY_BG with existing info/accent tokens from civitas-ds.css (verify contrast >= 4.5:1, per comment l.17-23).
- **Acceptance:**
  - Skeleton shape matches the list of cards.
  - No raw hex remains in page.tsx; axe contrast passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; contrast regression if tokens differ.
- **Depends on:** GAP-LIBRARY-HOME-01

### GAP-LIBRARY-HOME-05  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Codes W1–W7 and I1 are shown raw with no legend, and strings are hard-coded English rather than next-intl keys (page.tsx:54-118).
- **Verified evidence:** library/page.tsx:54-118 defines codes W1-W7 and I1 shown in a monospace chip (l.240-251) with no legend; all titles/remediation/labels ('Search issues', 'No issues match your filters.') are English literals. next-intl is used elsewhere (182 files use useTranslations) but not here.
- **Files to change:** `apps/web/src/app/(app)/library/page.tsx`
- **Fix steps:**
  1. Add a one-line legend (W = web finding, I = interaction) or drop the codes.
  2. Move strings to next-intl message keys with useTranslations, following an existing page in the app.
  3. Give severity chip a text label (already text) and keep as is.
- **Acceptance:**
  - Legend visible above the list.
  - Switching locale changes labels.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; skip if page is removed.
- **Depends on:** GAP-LIBRARY-HOME-01
