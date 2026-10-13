# Detailed gap file — module `dashboard`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 10, BACKEND-VERIFY 1



---
## /  —  `dashboard/home.html`

- **Source:** `apps/web/src/app/(marketing)/page.tsx`
- **Design reference:** `redesign/dashboard/home.html`

### GAP-DASHBOARD-HOME-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Hero card is labelled 'Live System Stats' but shows hard-coded 33 / 5 / 80%+; the '33 modules' figure is not derived from the module registry and the console dashboard lists 17 (page.tsx hero card vs dashboard/page.tsx MODULES).
- **Verified evidence:** (marketing)/page.tsx:79-96 card labelled 'Live System Stats' with hard-coded 33 modules, 5 languages, 80%+ test coverage, plus <h2> '33 modules' (:154). Dashboard MODULES lists 17; nothing derives 33. Static text under a 'Live' label and green dot.
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`
- **Fix steps:**
  1. Rename label to 'At a glance' and remove the pulsing green dot, or bind numbers to a generated build-time constant
  2. Generate module count from the module registry at build (shared registry from HOME-2-03) and languages from i18n locale list
  3. Drop '80%+ test coverage' unless sourced from CI badge
  4. Update h2 '33 modules' to same constant
- **Acceptance:**
  - No 'Live' wording on static figures
  - Module count equals registry length (unit test)
- **Needs:** web+decision  ·  **Effort:** XS <1h  ·  **Risk:** Reputational: unsupported claims on a government-vendor page.
- **Depends on:** GAP-DASHBOARD-HOME-2-03

### GAP-DASHBOARD-HOME-02  ·  HIGH  ·  confirmed  ·  theme CLAIMS (was MONEY)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Comparison table asserts competitor licensing ranges (SAP ₹50L–5Cr, Oracle ₹30L–3Cr) and '0 hours' training with no source; risky for a Government vendor page (page.tsx comparison array).
- **Verified evidence:** (marketing)/page.tsx:30-37 comparison rows assert SAP '₹50L-5Cr', Oracle '₹30L-3Cr', '40+ hours' training, 'no contest' (:205), with no source or 'as of' date. Static strings, not money math; paise/formatINR fix is irrelevant.
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`
- **Fix steps:**
  1. Decision (legal/marketing): remove competitor price and training rows or cite a dated public source
  2. Add footnote 'Indicative, as of <date>, source ...' and disclaimer
  3. Replace 'no contest' with neutral copy
  4. Have legal review use of SAP/Oracle names
- **Acceptance:**
  - Table has no unsourced competitor numbers
  - Footnote present if any remain
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Trademark/misrepresentation exposure for competitor claims.

### GAP-DASHBOARD-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme CLAIMS (was MONEY)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Zero Cost / ₹0 licensing' sits beside a 'View Pricing' CTA and a /pricing route, giving a contradictory message (page.tsx hero CTA vs features).
- **Verified evidence:** Hero (:60) 'Zero training. ₹0 licensing.', feature card 'Zero Cost' (:16) and table '₹0' (:32) sit beside 'View Pricing' (:69-74). pricing/page.tsx lists a ₹0/month small-office tier and a ₹15,000/month tier (line ~25), so ₹0 is only true for the open-source small-office edition.
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`, `apps/web/src/app/(marketing)/pricing/page.tsx`
- **Fix steps:**
  1. Qualify hero copy: '₹0 licensing for Small Office (open source)'
  2. Change 'Zero Cost' card to 'Open-source core' and table row to 'Licensing/year: ₹0 (Small Office)'
  3. Change CTA to 'See editions'
- **Acceptance:**
  - No unqualified ₹0 claim on landing page
  - Copy matches pricing page tiers
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Commercial claim accuracy.

### GAP-DASHBOARD-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Learn more →' links to /#finance, /#hr … which have no matching ids on the page (page.tsx modules map: href=`/#${name.toLowerCase()}`).
- **Verified evidence:** (marketing)/page.tsx:165 href=`/#${m.name.toLowerCase()}` e.g. /#finance, '/#citizen portal'. Only ids on the page are #features (:133) and #modules (:152); none matches, so links just go to top of landing page.
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`
- **Fix steps:**
  1. Add slug field to modules array and link to /docs/<slug> (docs route exists) or to an id'd detail section
  2. Remove the link if no destination exists
  3. Slug must not contain spaces
- **Acceptance:**
  - Each Learn more link lands on an existing anchor or docs page
  - Test: all in-page hrefs resolve to an id
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DASHBOARD-HOME-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Emoji used as feature/module icons throughout; role chips in 'Choose a role' look clickable but are plain spans (page.tsx roles map).
- **Verified evidence:** Emoji icons in features (:8-16) and modules (:20-27); role chips (:249-253) are plain <span> with pill styling next to 'Choose a role' and lead nowhere, though Sandbox exists (/sandbox).
- **Files to change:** `apps/web/src/app/(marketing)/page.tsx`
- **Fix steps:**
  1. Make chips <Link href={`/sandbox?role=...`}> if sandbox supports role param (check sandbox/page.tsx), else restyle as non-interactive text list
  2. Replace emoji with lucide icons with aria-hidden
  3. Add focus/hover styles for links
- **Acceptance:**
  - Chips keyboard-focusable and navigate to sandbox with role
  - or chips visibly non-interactive
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /dashboard  —  `dashboard/home-2.html`

- **Source:** `apps/web/src/app/(app)/dashboard/page.tsx`
- **Design reference:** `redesign/dashboard/home-2.html`

### GAP-DASHBOARD-HOME-2-01  ·  HIGH  ·  partly  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Command Center is advertised ('What is happening, what needs action') but shows no data: actions are static links; 'Urgent' pills are hard-coded, so an empty queue still shows red 'Urgent' (RoleCommandCenter.tsx:~30-60, priority field).
- **Verified evidence:** RoleCommandCenter.tsx:5-97 CENTERS are static links with hard-coded priority; 'Urgent' pill (:135-142) and red left border (:130) show regardless of any data, and copy at :117-118 says 'What needs your action now'. So true: no counts/data, urgent is static. Line refs ~30-60 were wrong. Not fabricated numbers, but misleading urgency.
- **Files to change:** `apps/web/src/app/(app)/dashboard/RoleCommandCenter.tsx`
- **Fix steps:**
  1. Rename 'Urgent' pill to a neutral 'Priority' or remove until backed by counts
  2. Bind counts to existing endpoints (e.g. workflow inbox count) and show badge only when count>0
  3. Change copy to 'Shortcuts for your role' until data-bound
  4. Show '—' on fetch failure via RefreshErrorState pattern
- **Acceptance:**
  - With zero pending items no Urgent pill
  - Pill/count appears when endpoint returns >0
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low, but misleading urgency erodes trust.

### GAP-DASHBOARD-HOME-2-02  ·  HIGH  ·  partly  ·  theme AUTHZ (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Role gating is client-visible substring matching: m.roles.some(prefix => roles.some(r => r.includes(prefix))) — a role such as 'chr_manager' matches 'hr'; tiles are convenience only, but the 'hr'/'admin' matches leak modules to unrelated roles (page.tsx visibleModules; RoleCommandCenter match).
- **Verified evidence:** Substring matching confirmed: page.tsx:32 r.includes(prefix) and RoleCommandCenter.tsx:16-79 x.includes('hr') etc. E.g. 'chr_manager' matches 'hr', 'tenant_x' matches. Not client-visible: getSessionRoles() (roleGuard.ts:27-32) runs in server components, decoding JWT cookie without signature verification. Impact limited to tile/shortcut visibility; module routes are gated by ModuleGate/requireAnyRole separately.
- **Files to change:** `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/dashboard/RoleCommandCenter.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Create hasRoleFamily(roles,family) in roleGuard.ts matching exact role or prefix with delimiter (r===p || r.startsWith(p+'_') || r.startsWith(p+':'))
  2. Use it in visibleModules and all CENTERS.match
  3. Add unit tests incl. 'chr_manager' not matching 'hr'
  4. Prefer entitlement from a module-access endpoint used by Sidebar (moduleKey) over role strings
- **Acceptance:**
  - Unit: hasRoleFamily(['chr_manager'],'hr') === false; ['hr_officer'] true
  - Dashboard for chr_manager shows no HR tile
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Real authorization is elsewhere; low security risk, but check role naming convention before tightening so legitimate roles do not vanish.

### GAP-DASHBOARD-HOME-2-03  ·  MEDIUM  ·  partly  ·  theme REGISTRY (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Module list is a hard-coded 17-item array, missing modules that exist in the app (Court, Designer, Visitor, Meeting, Inspection, Revenue, Billing …) so Court/Designer users see no tile (page.tsx MODULES).
- **Verified evidence:** MODULES (page.tsx:10-28) has 17 hard-coded items - true. Missing modules that exist under (app): court, designer, visitor, meeting, inspection, revenue, billing, works, fleet, etc. Court is in Sidebar (Sidebar.tsx:100). Not fabricated data; it is a stale duplicate of the module registry.
- **Files to change:** `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Extract a shared module registry (label, href, icon, moduleKey, roles) used by both Sidebar and dashboard
  2. Derive dashboard tiles from it filtered by entitlement/moduleKey
  3. Add missing modules (Court, Designer, Visitor, Meeting, Inspection, Revenue...)
  4. Add a test that every top-level (app) route in navRouteManifest has a registry entry
- **Acceptance:**
  - Court user sees Court tile
  - Registry test fails when a route is added without an entry
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Exposing tiles must still follow ModuleGate entitlements.

### GAP-DASHBOARD-HOME-2-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Zero visible modules is treated as an empty state ('No modules assigned yet') using only the cookie roles; code comments mark it ux-001-ok because no fetch is involved, so a mis-decoded or missing session looks like an access problem (page.tsx modules.length === 0 branch).
- **Verified evidence:** page.tsx:86-95 shows 'No modules assigned yet' when filtered list is empty. Comments state ux-001-ok, and it is accurate that no fetch is involved. But getSessionRoles() returns [] on missing cookie or decode failure (roleGuard.ts:27-32), so an expired/malformed token also shows the access-problem message. Only reports/knowledge/notifications have roles [] so a zero result actually needs those absent - they always show, so empty state can practically not occur for a valid decode (those 3 always match).
- **Files to change:** `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Since 3 role-less modules always match, the empty branch is effectively unreachable; verify and remove or keep as defensive
  2. When roles.length===0 show 'Session could not be read - sign in again' with link to /auth/login instead of access message
  3. Optionally redirect to login in middleware if token undecodable
- **Acceptance:**
  - roles=[] renders sign-in-again message
  - roles with no matches (if branch reachable) shows access message
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DASHBOARD-HOME-2-05  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** 'Command Center' title vs nav label 'Dashboard'; 'My approvals' goes to /workflow which is not a module tile.
- **Verified evidence:** en.json:2299 home.title='Command Center'; Sidebar.tsx:48 label 'Dashboard' (hard-coded English in sidebar) - mismatch true. '/workflow' link (page.tsx:47) is not a module tile - true but intended as a cross-module inbox, not a bug. Sidebar label not i18n'd.
- **Files to change:** `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`, `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Align naming: pick 'Dashboard' for nav and page h1, or 'Command Center' for both, via one next-intl key
  2. Move Sidebar label to next-intl
  3. Update hi.json
- **Acceptance:**
  - Nav label and page title identical in en and hi
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-DASHBOARD-HOME-06  ·  LOW  ·  partly  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Footer/nav link /careers; no such route in the marketing group (layout.tsx footer). Download PDF target /docs/CivitasOne-User-Manual.pdf not verified in the snapshot.
- **Service:** ``  ·  **Endpoint(s):** `[]`
- **Question:** Do /careers and /docs/CivitasOne-User-Manual.pdf resolve?
- **How to verify:** ls apps/web/src/app/careers; ls apps/web/public/docs (public dir absent in snapshot).
- **Test to add:** Playwright: GET /careers returns 200; HEAD /docs/CivitasOne-User-Manual.pdf returns 200 application/pdf.
- **Impact if wrong:** Broken marketing links.
- **Web change if wrong:** Add the PDF to public/docs or remove the link.
- **Finding:** /careers exists at apps/web/src/app/careers/page.tsx (outside (marketing) group, so footer link at (marketing)/layout.tsx:83 works). apps/web/public not in snapshot so the PDF cannot be confirmed.
