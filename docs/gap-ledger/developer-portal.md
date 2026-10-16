# Detailed gap file — module `developer-portal`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 6



---
## /developer-portal  —  `developer-portal/home.html`

- **Source:** `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Design reference:** `redesign/developer-portal/home.html`

### GAP-DEVELOPER-PORTAL-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W2 re-confirmed: closed by #1925; page.tsx renders RefreshErrorState when source==='error', StatCards are skipped on error, recent-keys card is also skipped)
- **First-pass claim:** On fetch failure the badge appears but 'API keys issued 0 / Active keys 0' still render as facts; the same happens for a real zero (page.tsx source==='error' block + StatCard values).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal/page.tsx:79-104 getAPIKeys() returns [] on failure; error only renders <DataSourceBadge> (:93-97) and StatCards still show totalKeys/activeKeys = 0 (:100-101). Recent-keys card is hidden on 0 (:151), so page reads as a real empty tenant. RefreshErrorState exists (_components/ds/RefreshErrorState.tsx).
- **Files to change:** `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Fix steps:**
  1. When source==='error', render <RefreshErrorState error={...} backHref='/dashboard'/> in place of the two key StatCards and the recent-keys card
  2. Pass value='—' for the key cards on error
  3. Keep capability grid (static)
- **Acceptance:**
  - Mock loader error: no '0' shown, retry button calls router.refresh
  - Real zero keys still shows 0 without error state
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-DEVELOPER-PORTAL-HOME-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W2 re-confirmed: closed by #1925; API Reference is status='preview' with href='/docs/api' and linkLabel='Open API reference'; Sandbox stays planned with link to /sandbox)
- **First-pass claim:** Roadmap contradicts shipped surfaces: 'API Reference' and 'Sandbox & Test Tenant' are tagged Planned while /docs/api and /sandbox exist in the marketing group (page.tsx CAPABILITIES vs (marketing)/docs/api/page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal/page.tsx:30-37 API Reference status 'planned', and :54-61 Sandbox 'planned'. Marketing routes exist: apps/web/src/app/(marketing)/docs/api/page.tsx (API Reference, links openapi.yaml) and apps/web/src/app/(marketing)/sandbox/page.tsx (demo data, no sign-up). But the sandbox page is a public demo, not the 'isolated test tenant with disposable credentials' described in the card, so Sandbox may legitimately be planned; API Reference is only a curated static page, not the 'auto-published per-release' reference described. Also /docs/api/openapi.yaml was not found in the repo snapshot.
- **Files to change:** `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Fix steps:**
  1. Change API Reference to 'preview' with linkLabel 'Open API reference' href '/docs/api'
  2. Reword card descriptions to state what exists vs planned; keep Sandbox planned but link to /sandbox as 'Demo sandbox'
  3. Confirm with product which state is true
- **Acceptance:**
  - Cards link to /docs/api and /sandbox
  - availableCount/plannedCount reflect new statuses
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy accuracy.
- **Depends on:** GAP-DEVELOPER-PORTAL-HOME-03

### GAP-DEVELOPER-PORTAL-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Capabilities available' and 'On the roadmap' KPIs are counts of a hard-coded array, presented like live metrics; 'preview' items count as roadmap (page.tsx availableCount/plannedCount).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal/page.tsx:83-84 availableCount/plannedCount derive from the hard-coded CAPABILITIES array and render as StatCards (:102-103) alongside live key counts. plannedCount = status !== 'active', so 'preview' items (Webhooks, Diagnostics) count as roadmap: 5 of 6.
- **Files to change:** `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Fix steps:**
  1. Replace the two KPI cards with a status legend or remove them
  2. Or split into Available / Preview / Planned counts and label 'Platform roadmap'
- **Acceptance:**
  - No KPI implies live telemetry
  - Counts match array statuses
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DEVELOPER-PORTAL-HOME-04  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W2 re-confirmed: closed by #1925; developer-portal/layout.tsx calls requireAnyRole(['tenant_admin','platform_admin','super_admin']); getAPIKeys() skipped for non-admins)
- **First-pass claim:** Key list exposes keyPrefix for every user who can open the page; there is no role gate (no layout) although the management page is under tenant-admin (page.tsx recent-keys card).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal has no layout.tsx (only error/loading/not-found/page); tenant-admin/layout.tsx uses requireAnyRole(['tenant_admin','platform_admin','super_admin']). The developer page shows keyName + keyPrefix (:175-177) to any authenticated user with the module. keyPrefix is a non-secret prefix (secret not shown) but still credential metadata. Whether /api/v1/admin/api-keys rejects non-admins is not verifiable (admin service absent).
- **Files to change:** `apps/web/src/app/(app)/developer-portal/layout.tsx`, `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Fix steps:**
  1. Add developer-portal/layout.tsx calling requireAnyRole with same ALLOWED as tenant-admin (or hide only the keys card)
  2. Skip getAPIKeys() when role lacks access
  3. Verify server endpoint enforces admin role
- **Acceptance:**
  - Non-admin gets forbidden/redirect or no key card
  - tenant_admin sees page unchanged
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Could lock out developers who are not tenant admins; decide intended audience.
- **Depends on:** GAP-DEVELOPER-PORTAL-HOME-01

### GAP-DEVELOPER-PORTAL-HOME-05  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx renders a full-screen slate shell with its own max-w-7xl wrapper while the page uses className 'wrap' — layout jumps on load (loading.tsx vs page.tsx).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal/loading.tsx:2-3 uses tailwind 'min-h-screen bg-slate-50 p-6 md:p-8' + 'max-w-7xl'; page uses <div className='wrap'> with PageHeader and .grid g-4. Loader is a different shell and dark-mode-incompatible slate colours.
- **Files to change:** `apps/web/src/app/(app)/developer-portal/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx like documents/loading.tsx: div.wrap, .skeleton header, .grid.g-4 of 4 stat skeletons, one card skeleton
  2. Use ds SkeletonCard, no slate/hex colours
- **Acceptance:**
  - Navigating shows no horizontal/vertical jump
  - Dark mode skeleton uses theme tokens
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DEVELOPER-PORTAL-HOME-06  ·  LOW  ·  partly  ·  theme THEME (was FABRICATED)

- [x] **Status** (W2 PQ: closed by #TBD, GAP-DEVELOPER-PORTAL-HOME-06: emoji mapped to lucide via StatIcon.tsx; StatCards use tone= tokens not hex iconBg; capability li uses var(--panel) not #fff)
- **W0-10 note:** review found the W0 tick partly — Hex/#fff removed, but emoji icons remain (developer-portal/page.tsx:142-143 StatCard icon=emoji); step 2 lucide swap not done, no dark-mode snapshot
- **First-pass claim:** Emoji icons and hard-coded #hex icon backgrounds (#f1f5f9, #ecfdf3, #eef2ff, #fffaeb) ignore dark mode (page.tsx StatCard iconBg).
- **Verified evidence:** apps/web/src/app/(app)/developer-portal/page.tsx:100-103 iconBg hex values and :126 li background '#fff' are hard-coded; emoji icons in CAPABILITIES. Dark-mode effect not run here. StatCard prop iconBg accepts a string; token alternative not checked.
- **Files to change:** `apps/web/src/app/(app)/developer-portal/page.tsx`
- **Fix steps:**
  1. Replace hex with CSS vars (e.g. var(--panel), var(--primary-soft)) in StatCards and li
  2. Swap emoji for lucide icons used in Sidebar
- **Acceptance:**
  - Dark mode shows no white tiles
  - Visual snapshot in both themes
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
