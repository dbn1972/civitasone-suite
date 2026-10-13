# Detailed gap file — module `establishment`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 4, REFUTED 1



---
## /establishment  —  `establishment/home.html`

- **Source:** `apps/web/src/app/(app)/establishment/page.tsx`
- **Design reference:** `redesign/establishment/home.html`

### GAP-ESTABLISHMENT-HOME-02  ·  LOW  ·  partly  ·  theme DESIGN-SYSTEM (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx and not-found.tsx use Tailwind classes (bg-gray-200, animate-pulse) instead of the ds Skeleton/tokens, so the skeleton ignores dark mode; not-found.tsx has no back link. not-found is unreachable from this page (it only redirects) and only fires for unknown children of /establishment.
- **Verified evidence:** establishment/loading.tsx:3-10 uses Tailwind bg-gray-200/bg-gray-100 animate-pulse without dark: variants (confirmed); not-found.tsx renders only ds EmptyState with no back link (confirmed, 10 lines). Also estab/loading.tsx uses bg-slate-* the same way. Reachability: establishment/page.tsx redirects, so its loading/not-found only appear for unknown children such as /establishment/foo (confirmed by page.tsx:4). 'Dead link' theme is wrong; this is design-system drift on unreachable-ish files.
- **Files to change:** `apps/web/src/app/(app)/establishment/loading.tsx`, `apps/web/src/app/(app)/establishment/not-found.tsx`, `apps/web/src/app/(app)/estab/loading.tsx`
- **Fix steps:**
  1. Replace loading.tsx markup with ds Skeleton/SkeletonTable (token based, dark-mode aware), or delete it if the segment becomes a config redirect (see FILES-02).
  2. Add an action to not-found.tsx: <Link href='/estab' className='btn'>Back to Establishment</Link> (EmptyState supports actions? check props; else wrap).
  3. Apply same fix to estab/loading.tsx.
- **Acceptance:**
  - Dark mode: skeleton not bright gray.
  - /establishment/foo shows not-found with a working link back.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-ESTABLISHMENT-FILES-02

### GAP-ESTABLISHMENT-HOME-03  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** A permanent alias is implemented as a runtime redirect() (page.tsx:4) — no permanent flag, so search/bookmarks keep the alias and every visit costs a round trip.
- **Verified evidence:** establishment/page.tsx:4 uses redirect('/estab') which issues a 307 temporary redirect; permanent alias should use permanentRedirect from next/navigation or a permanent next.config redirect. No next.config file exists in the apps/web snapshot, so config-level alternative is unverified.
- **Files to change:** `apps/web/src/app/(app)/establishment/page.tsx`, `apps/web/src/app/(app)/establishment/files/page.tsx`
- **Fix steps:**
  1. Change import to `import { permanentRedirect } from 'next/navigation'` and call permanentRedirect('/estab') (and '/estab/list' in files/page.tsx).
  2. Or move both to next.config redirects with permanent:true and delete the pages.
- **Acceptance:**
  - curl -I /establishment returns 308 with Location: /estab.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; browsers cache 308 aggressively, so make sure the target won't change.
- **Depends on:** GAP-ESTABLISHMENT-FILES-02


---
## /establishment/files  —  `establishment/files.html`

- **Source:** `apps/web/src/app/(app)/establishment/files/page.tsx`
- **Design reference:** `redesign/establishment/files.html`

### GAP-ESTABLISHMENT-FILES-01  ·  MEDIUM  ·  partly  ·  theme NAVUX (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Alias hides a naming mismatch: user-facing "Files" lives at /estab/list while /estab/files/[id] and /estab/files/new are the detail and create routes (estab/files/{[id],new}); breadcrumbs derived from the path would offer a dead /estab/files crumb (navRouteManifest.ts header comment).
- **Verified evidence:** Naming mismatch is real: establishment/files/page.tsx:4 redirects to /estab/list while detail/create live at estab/files/[id] and estab/files/new (no estab/files/page.tsx). But the 'dead crumb' claim is refuted: navRouteManifest.ts header lists /estab/files as a grouping with no index page and LINKABLE_INTERMEDIATE_PATHS (only /estab, /estab/library, /estab/quarters for estab) excludes it, so AutoBreadcrumb renders it as plain text, not a link. Remaining issue: /estab/files as a URL is not reachable by design.
- **Files to change:** `apps/web/src/app/(app)/estab/files/page.tsx (new, optional)`
- **Fix steps:**
  1. Optional: add estab/files/page.tsx that permanentRedirect('/estab/list') so a hand-typed /estab/files or a future breadcrumb link resolves; then regenerate the manifest with scripts/gen-nav-route-manifest.mjs.
  2. Otherwise no change; document the alias in the manifest header.
- **Acceptance:**
  - GET /estab/files returns a redirect to /estab/list, not 404.
  - Breadcrumb on /estab/files/new has no broken link.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-ESTABLISHMENT-FILES-02  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Loading skeleton (Tailwind classes, loading.tsx) flashes before the redirect and does not resemble the file list.
- **Verified evidence:** establishment/files/page.tsx is a synchronous server redirect('/estab/list'); it inherits establishment/loading.tsx (Tailwind gray animate-pulse blocks: header, 4 tiles, big block). On soft navigation the loading boundary can flash before the redirect; on a cold request the redirect happens before any HTML. Skeleton does not resemble a file list, and neither ds Skeleton nor dark variants are used. Impact is small.
- **Files to change:** `apps/web/src/app/(app)/establishment/loading.tsx`, `next.config.js (redirects, if present in the deployed repo; not found in apps/web snapshot)`
- **Fix steps:**
  1. Prefer a config-level redirect (next.config redirects(): /establishment -> /estab, /establishment/files -> /estab/list, permanent) so no page or skeleton is involved; then delete establishment/files, establishment/page and loading.tsx.
  2. If keeping the pages, replace loading.tsx with `return null` or ds SkeletonTable.
- **Acceptance:**
  - Visiting /establishment/files shows no skeleton flash and lands on /estab/list.
  - Response status is 308.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. next.config.js was not visible, verify its presence first.
- **Depends on:** GAP-ESTABLISHMENT-HOME-03


---
## Refuted by deep pass — do NOT implement

### GAP-ESTABLISHMENT-HOME-01 · /establishment
- **First-pass claim:** Two module keys for one module: this segment gates on "establishment" while /estab has its own layout; isModuleEnabled matches loosely by substring (moduleVisibility.ts:45), so the two only agree by accident of naming.
- **Why refuted:** Both segments use the SAME key: establishment/layout.tsx:5 <ModuleGate moduleKey='establishment'> and estab/layout.tsx:14 <ModuleGate moduleKey='establishment'>. There are not two module keys. isModuleEnabled (lib/moduleVisibility.ts:44-45) is indeed lenient (name.includes(key) || key.includes(name), documented in its header comment and covering 'establishment' vs 'estab'), but this page does not depend on that. The only true residual point is that lenient substring matching can over-match (e.g. a module named 'estab-x'), a generic ModuleGate concern, not specific to this page.
