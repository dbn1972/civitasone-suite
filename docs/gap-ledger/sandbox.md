# Detailed gap file — module `sandbox`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 5



---
## /sandbox  —  `sandbox/home.html`

- **Source:** `apps/web/src/app/(marketing)/sandbox/page.tsx`
- **Design reference:** `redesign/sandbox/home.html`

### GAP-SANDBOX-HOME-01  ·  HIGH  ·  confirmed  ·  theme AUTH (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** The "no sign-up required" page is unreachable while signed out: /sandbox is not in the middleware PUBLIC list, so anonymous visitors are redirected to /auth/login?next=/sandbox before it renders (middleware.ts:11,97-104).
- **Verified evidence:** apps/web/src/middleware.ts:11 PUBLIC lists /auth, /api/auth, /api/careers, /careers, /_next, /favicon.ico, /sw.js, /api/metrics; '/sandbox' is absent. With no access cookie, :99-104 redirects to defaultLoginPath() with ?next=/sandbox. (The marketing home and pricing are also not in PUBLIC, so the whole (marketing) group is behind login, unless another mechanism serves them; not checked.) The observation's :97-104 is right.
- **Files to change:** `apps/web/src/middleware.ts`
- **Fix steps:**
  1. Decide with product whether /sandbox (and the rest of (marketing)) should be public.
  2. If yes, add "/sandbox" to PUBLIC (prefix match also covers sub-paths).
  3. Add a middleware test asserting anonymous GET /sandbox passes without redirect.
  4. Ensure the sandbox destination is also reachable anonymously (see HOME-02).
- **Acceptance:**
  - Signed out, GET /sandbox returns 200 (no redirect to /auth/login).
  - Other protected routes still redirect.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Medium. Widening PUBLIC is a security-sensitive change; the sandbox must run on demo data only.
- **Depends on:** GAP-SANDBOX-HOME-02

### GAP-SANDBOX-HOME-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** All seven "Enter as {role}" cards link to the same /dashboard; the role id is never used, so nothing differs by persona, and (app)/layout.tsx:56-57 sends an unauthenticated visitor to login anyway (page.tsx:79).
- **Verified evidence:** apps/web/src/app/(marketing)/sandbox/page.tsx:79 every card uses href={`/dashboard`}; role.id is defined (:12 etc.) but unused. apps/web/src/app/(app)/layout.tsx `if (!token) redirect("/auth/login")` (about line 57) sends an anonymous visitor to login. No sandbox session route exists (grep for sandbox in app/ finds only marketing and unrelated files).
- **Files to change:** `apps/web/src/app/(marketing)/sandbox/page.tsx`, `apps/web/src/app/api/sandbox/enter/route.ts (new)`, `apps/web/src/middleware.ts`
- **Fix steps:**
  1. Decide the sandbox mechanism (demo tenant + per-role demo login).
  2. Create a route handler /api/sandbox/enter?role=<id> that validates role against the allowed list (zod), issues a demo-tenant session cookie for that role, then redirects to /dashboard.
  3. Change the card href to /api/sandbox/enter?role=${role.id} (or a POST form).
  4. Make that route public in middleware.
  5. Until built, hide the page or label cards 'Coming soon' rather than linking to /dashboard.
- **Acceptance:**
  - Clicking 'Office Head' then 'Citizen' lands on dashboards with different roles/nav.
  - Unknown role param returns 400.
  - Anonymous visitor reaches the dashboard without a login redirect.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** High. Passwordless demo sessions must be confined to a demo tenant with no real data or email/payment side effects.
- **Depends on:** GAP-SANDBOX-HOME-01

### GAP-SANDBOX-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** The role emoji are plain text in a div with no aria-hidden, so screen readers announce e.g. "office building" before each card; headings jump from h1 to h3 (page.tsx:82-83).
- **Verified evidence:** apps/web/src/app/(marketing)/sandbox/page.tsx:82 `<div className="text-4xl">{role.icon}</div>` has no aria-hidden; the page has h1 at :63 and the cards' titles are h3 (:83) with no h2 between. Both statements true.
- **Files to change:** `apps/web/src/app/(marketing)/sandbox/page.tsx`
- **Fix steps:**
  1. Add aria-hidden="true" to the icon div.
  2. Change the card title element from h3 to h2 (or add a visually hidden h2 'Choose a role' above the grid).
  3. Optionally move copy to next-intl keys if marketing pages are localised.
- **Acceptance:**
  - axe reports no heading-order issue on /sandbox.
  - Screen reader reads card as 'Office Head, ...' without the emoji name.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-SANDBOX-HOME-04  ·  LOW  ·  partly  ·  theme COPY (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** "Resets daily" (hero) and "Refreshed every 24 hours" (footer) describe the same thing in two ways; no time or timezone (page.tsx:67,91-93).
- **Verified evidence:** apps/web/src/app/(marketing)/sandbox/page.tsx:67 says 'Resets daily.' and :96 says 'Refreshed every 24 hours.'; both true, redundant, neither states a time/zone. It is copy only, not a date-format issue, so theme DATEFMT is a stretch. Whether the reset actually runs and when is not visible in this snapshot.
- **Files to change:** `apps/web/src/app/(marketing)/sandbox/page.tsx`
- **Fix steps:**
  1. Confirm the real reset schedule (e.g. 02:00 IST) with whoever owns the demo tenant job.
  2. Keep one statement, e.g. 'Demo data resets every day at 02:00 IST.', and remove the duplicate in the footer or hero.
- **Acceptance:**
  - Page states the reset once, with time and IST.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Wrong reset claim would mislead evaluators.

### GAP-SANDBOX-HOME-05  ·  LOW  ·  partly  ·  theme THEMING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Page uses Tailwind utility classes and hard-coded grays (bg-white, text-gray-*) instead of the DS tokens used inside the app, so dark mode and tenant theming do not apply (page.tsx:57-97).
- **Verified evidence:** apps/web/src/app/(marketing)/sandbox/page.tsx uses Tailwind utilities with fixed grays/white/amber (:56-96), true. But this is a public marketing page under the (marketing) layout, not in-app; the DS tokens (var(--ink) etc.) live in the app shell CSS. Dark mode and tenant theming are not required for an anonymous marketing page unless the marketing layout supports them (layout.tsx not verified for theming). Theme FABRICATED is wrong (no sample figures).
- **Files to change:** `apps/web/src/app/(marketing)/sandbox/page.tsx`, `apps/web/src/app/(marketing)/layout.tsx`
- **Fix steps:**
  1. Check whether (marketing)/layout.tsx and sibling pages (pricing, contact) use the same Tailwind grays; if so leave consistent.
  2. If marketing is to follow brand tokens, map bg-white/text-gray-* to the Tailwind theme colours bound to the CSS variables and change all marketing pages together.
- **Acceptance:**
  - Sandbox looks consistent with the pricing and contact pages in light and dark preference.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low. Cosmetic.
