# Detailed gap file — module `offline`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 4, BACKEND-VERIFY 1



---
## /offline  —  `offline/home.html`

- **Source:** `apps/web/src/app/offline/page.tsx`
- **Design reference:** `redesign/offline/home.html`

### GAP-OFFLINE-HOME-01  ·  HIGH  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** The only action is "Go to dashboard" (page.tsx): the dashboard is a normal app route that is exactly as unreachable as the page just requested when there is no cache and no network, so the button can loop the user back here; there is no "Try again" / reload action and no online detection to leave automatically.
- **Verified evidence:** offline/page.tsx:26-41 has only <a href='/dashboard'> and no reload or online listener; the page is force-static server-only (:1), so no JS. The service worker that serves this fallback is not present in the snapshot (no sw file found), so whether /dashboard is cached and can loop is cannot-verify; without cache and network it does loop.
- **Files to change:** `apps/web/src/app/offline/page.tsx`, `apps/web/src/app/offline/OfflineActions.tsx (new client component)`
- **Fix steps:**
  1. Add a client component with a 'Try again' button (location.reload()) and an 'online' event listener that navigates to the original/dashboard path.
  2. Keep the dashboard link as secondary.
  3. Use navigator.onLine for state text.
- **Acceptance:**
  - Component test: dispatch window 'online' event -> location assign called.
  - Manual: airplane mode, click Try again, remains on page; reconnect redirects.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-OFFLINE-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme DARKMODE (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** All styling is inline hard-coded hex (#f8fafc background, #0f172a text, #4f46e5 button — page.tsx), ignoring design tokens: a forced light page for dark-mode users, and brand colour differs from the primary token.
- **Verified evidence:** Inline styles use #f8fafc, #0f172a, #475569 and #4f46e5 (page.tsx:13,21,22,33) while --primary is #00439C (civitas-ds.css:6) and dark mode uses .dark class; page is outside the (app) group so gets a forced light look. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/offline/page.tsx`
- **Fix steps:**
  1. Replace inline styles with DS classes/tokens (var(--bg), var(--ink), btn primary).
  2. Confirm civitas-ds.css is loaded on this route (root layout) and precached by the SW.
- **Acceptance:**
  - Manual: dark mode shows dark page, button uses primary colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure CSS is in the SW precache.

### GAP-OFFLINE-HOME-04  ·  MEDIUM  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** Hard-coded English, no next-intl key (page.tsx) on a page intended for field/low-connectivity users; "isn't available offline yet" says nothing about which pages are available or how to make them so.
- **Verified evidence:** Copy is hard-coded English (page.tsx:21-25), though root layout does provide NextIntlClientProvider (layout.tsx:33) so keys are possible; the page is a server component with force-static. The text does say previously visited screens and queued changes are saved, but doesn't list which pages. Which pages are cached is cannot-verify (no SW in snapshot).
- **Files to change:** `apps/web/src/app/offline/page.tsx`, `apps/web/src/messages/en.json`
- **Fix steps:**
  1. Move copy to a next-intl 'offline' namespace (getTranslations).
  2. List cached areas only if SW precache list is known; otherwise add link to Help.
- **Acceptance:**
  - Switch locale to hi; page renders Hindi text.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-OFFLINE-HOME-05  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1925, verified on main 9c5e9e9e9)
- **First-pass claim:** The <main> has min-height 100vh and no landmark navigation or skip target; the emoji is decorative-only so the visual cue is absent to assistive tech (acceptable).
- **Verified evidence:** <main> with minHeight 100vh (:7-9) is true; emoji is aria-hidden (:18) intentionally, as the finding itself concedes. A skip target/landmark nav on a single-message page adds little; only real gap is heading/status semantics for reconnect.
- **Files to change:** `apps/web/src/app/offline/page.tsx`
- **Fix steps:**
  1. Optionally add role='status' text that announces reconnection once the online listener from OFFLINE-HOME-01 exists.
- **Acceptance:**
  - Screen reader announces 'Back online' on reconnect.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-OFFLINE-HOME-01


---
## Backend verification items (service code absent from snapshot)

### GAP-OFFLINE-HOME-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The page promises "your queued changes are saved on this device and will sync automatically" (page.tsx) but shows no count, list or last-sync time, and no service worker source or registration was found in the snapshot (only message listeners in SyncProvider.tsx / ConnectionStatus.tsx), so neither the fallback routing nor the sync promise is verifiable; for a govt user with queued approvals this is an unverifiable data-safety claim.
- **Service:** `service worker / sync layer (no backend service)`  ·  **Endpoint(s):** `['service worker fetch handler', 'POST queued mutations via lib/sync/requestQueue.ts']`
- **Question:** Is a service worker registered that serves /offline and replays queued mutations idempotently on reconnect?
- **How to verify:** Grep repo for sw.js/registration; in Chrome DevTools go offline, submit a mutation, reconnect and confirm one replay.
- **Test to add:** Given queued approval offline, when connection returns, then exactly one request with same idempotency key is sent and count shown.
- **Impact if wrong:** Queued approvals lost or duplicated.
- **Web change if wrong:** Show queue count and last sync on offline/page.tsx; register SW.
