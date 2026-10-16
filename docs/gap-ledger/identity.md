# Detailed gap file — module `identity`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 33, BACKEND-VERIFY 1, REFUTED 1



---
## /identity  —  `identity/home.html`

- **Source:** `apps/web/src/app/(app)/identity/page.tsx`
- **Design reference:** `redesign/identity/home.html`

### GAP-IDENTITY-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme ICONS (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** All seven tiles render the same 📁 emoji because no tile title matches TILE_ICONS (LinkTiles.tsx:52-59), so the hub gives no visual differentiation between users, keys and emergency access; pastel backgrounds are hard-coded hex (LinkTiles.tsx:50) and ignore dark theme.
- **Verified evidence:** LinkTiles.tsx:10-49 TILE_ICONS has no keys for Users, Sessions, API keys, Break-glass, WebAuthn, MFA (admin), SSO (admin); fallbacks at 55-59 match only dashboard/employees/leave/payroll/procurement/orders, none in identity hrefs, so all seven get 📁 (line 60). TILE_BG is hard-coded pastel hex at line 51 (not 50) applied inline at line 97; dark-mode appearance not run-tested. NavTile type in @civitasone/types absent, so an `icon` field on tiles is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`, `apps/web/src/app/(app)/identity/page.tsx`
- **Fix steps:**
  1. Add TILE_ICONS entries for Users, Sessions, 'API keys', 'Break-glass', WebAuthn, 'MFA (admin)', 'SSO (admin)' (lucide/emoji consistent with StatIcon).
  2. Better: add optional icon to ModuleHub links and pass it through to LinkTiles.
  3. Replace TILE_BG hex with CSS-variable classes that have dark values.
  4. Check other hubs still render (title collisions like 'Users').
- **Acceptance:**
  - Identity hub shows seven distinct icons.
  - Tiles readable in dark theme.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared LinkTiles used by all hubs; visual regression only.

### GAP-IDENTITY-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check: identity/layout.tsx applies ModuleGate only (layout.tsx:5), so the hub advertises Users, API keys and Break-glass to every signed-in user of the tenant; hiding tiles by role is not done client-side.
- **Verified evidence:** identity/layout.tsx:5 has no requireAnyRole; identity/page.tsx:10-16 shows all seven links to everyone. The two tenant-admin links lead to tenant-admin/layout.tsx which redirects non-admins to /dashboard, so those users click and bounce.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`, `apps/web/src/app/(app)/identity/page.tsx`, `apps/web/src/app/_components/ModuleHub.tsx`
- **Fix steps:**
  1. Add requireAnyRole in identity/layout.tsx (see API-KEYS-01).
  2. Add optional roles?: string[] to ModuleHub links and filter with getSessionRoles() in the server component.
  3. Hide MFA/SSO tiles for non-tenant-admin roles.
- **Acceptance:**
  - Non-admin does not see MFA (admin)/SSO (admin) tiles.
  - Admin sees all seven.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Hiding tiles is UX only; server gates remain authoritative.
- **Depends on:** GAP-IDENTITY-API-KEYS-01

### GAP-IDENTITY-HOME-03  ·  MEDIUM  ·  partly  ·  theme WIRING (was I18N)

- [~] **Status** (W2 PQ: INTERIM — NEEDS OWNER DECISION: reword already landed in #1862; at-a-glance stats require backend endpoint confirmation and a product decision on which metrics to surface)
- **W0 note:** partly fixed by #1862 — '(admin)' reworded to 'Managed in Tenant Admin'; no at-a-glance MFA/SSO/session stats added (decision pending)
- **First-pass claim:** Two tiles leave the module for Tenant Admin (page.tsx:14-15), labelled "(admin)"; there is no MFA or SSO status here, and the hub carries no counts or health (nothing to show an admin at a glance).
- **Verified evidence:** The two tenant-admin links are at page.tsx:15-16 (not 14-15) labelled '(admin)'; true that the hub shows no MFA/SSO status or counts (ModuleHub children slot unused). This is an enhancement request rather than a defect; endpoints for MFA/SSO/session counts cannot-verify. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/identity/page.tsx`
- **Fix steps:**
  1. Decision: which at-a-glance figures (active sessions, keys expiring, MFA coverage) matter.
  2. If endpoints exist, add a server summary via ModuleHub children with StatCards and '—' on failure.
  3. Reword '(admin)' to a note such as 'Managed in Tenant Admin'.
- **Acceptance:**
  - Hub shows agreed stats or none; failures show '—' not 0.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Do not invent metrics; needs backend confirmation.

### GAP-IDENTITY-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:9); the group loading state is just "Loading identity…" with no header or skeleton (loading.tsx:4).
- **Verified evidence:** identity/page.tsx:7 description 'Users, sessions, API keys, break-glass and WebAuthn credentials from identity-service.' (line 7, not 9). identity/loading.tsx:4 is just <p>Loading identity…</p> inside page-main, no PageHeader or skeleton (other modules use skeleton loading, e.g. grants/utilization/loading.tsx).
- **Files to change:** `apps/web/src/app/(app)/identity/page.tsx`, `apps/web/src/app/(app)/identity/loading.tsx`
- **Fix steps:**
  1. Rewrite description without the service name: 'Users, sessions, API keys, emergency access and passkeys for this office.'
  2. Replace loading.tsx with the skeleton pattern used in grants/utilization/loading.tsx (title bar + tile grid) and aria-busy.
- **Acceptance:**
  - No 'identity-service' text in the UI.
  - Loading state shows skeleton tiles.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /identity/api-keys  —  `identity/api-keys.html`

- **Source:** `apps/web/src/app/(app)/identity/api-keys/page.tsx`
- **Design reference:** `redesign/identity/api-keys.html`

### GAP-IDENTITY-API-KEYS-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check on an identity-administration route: identity/layout.tsx only checks that the module is enabled (layout.tsx:5) and the page calls the loader directly (page.tsx:7-8), so any signed-in tenant user reaches this list; DPDP-sensitive identity data depends entirely on the unseen backend.
- **Verified evidence:** identity/layout.tsx:5 only ModuleGate; api-keys/page.tsx:8 calls getIdentityApiKeys (_data.ts:90 -> /api/v1/admin/api-keys) with no role check. The equivalent tenant-admin/api-keys route is behind tenant-admin/layout.tsx requireAnyRole, so the same data is guarded on one path and open on the other. Backend enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`
- **Fix steps:**
  1. Decision: allowed roles for identity admin pages; tenant-admin/layout.tsx uses ['tenant_admin','platform_admin','super_admin'].
  2. Add requireAnyRole(IDENTITY_ROLES) from '@/lib/auth/roleGuard' to identity/layout.tsx:4 before <ModuleGate>.
  3. Backend must independently authorise /api/v1/admin/* (not in snapshot).
- **Acceptance:**
  - Non-admin session opening /identity/api-keys redirects to /dashboard.
  - tenant_admin session still loads it.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Over-narrow role list blocks helpdesk staff who legitimately view users/sessions.
- **Depends on:** roleGuard.requireAnyRole, GAP-IDENTITY-HOME-02

### GAP-IDENTITY-API-KEYS-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No create, rotate or revoke control for API keys (ModuleListTable.tsx:36-56); keys are the highest-risk credential in the module and the list cannot act on one, nor show scopes, owner, expiry or last-used.
- **Verified evidence:** True for this route: ModuleListTable.tsx:36-56 is a read-only 5-column table (ID, Name, Detail, Status, Meta) with no actions, scopes, expiry or last-used. But tenant-admin/api-keys already has APIKeyActions.tsx (create with scopes, rotate, revoke via ConfirmDialog) and APIKeysTable.tsx with Scope, Last used, Expires columns. So the capability exists; the identity route is a redundant weaker stub.
- **Files to change:** `apps/web/src/app/(app)/identity/api-keys/page.tsx`, `apps/web/src/app/(app)/identity/page.tsx`
- **Fix steps:**
  1. Decision: make /identity/api-keys redirect() to /tenant-admin/api-keys (and drop its loader) or repoint the hub tile at line 12 of identity/page.tsx.
  2. If keeping a separate page, reuse APIKeysTable/APIKeyActions from tenant-admin/api-keys instead of ModuleListPage.
  3. Keep audit emission on create/rotate/revoke in the backend.
- **Acceptance:**
  - Clicking 'API keys' on Identity hub lands on a page with Create/Rotate/Revoke, scopes, expiry, last used.
  - No duplicate unguarded list remains.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Removing route may break bookmarks; use a redirect.
- **Depends on:** GAP-IDENTITY-API-KEYS-01

### GAP-IDENTITY-API-KEYS-04  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** "Detail" repeats "Status" whenever there is no description (sublabel falls back to status, _data.ts:55-64) and Meta prints the raw ISO createdAt/updatedAt string (_data.ts:65-69), e.g. 2026-09-28T09:14:22Z.
- **Verified evidence:** _data.ts:51-59: sublabel = description ?? status ?? state ..., so Detail duplicates Status when no description (ModuleListTable.tsx:52-53). Meta (_data.ts:61-67) = code ?? currency ?? updatedAt ?? createdAt, so raw ISO timestamp appears only when code and currency are absent (updatedAt is preferred over createdAt). Shared mapRows, so all identity lists are affected.
- **Files to change:** `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Remove status/state from the sublabel fallback chain in mapRows (lines 55-56) so Detail shows only description/category/tier.
  2. Format ISO-looking meta values with formatIndianDate (lib/formatters.ts) — detect via /^\d{4}-\d{2}-\d{2}T/.
  3. Prefer separate typed columns for created/updated instead of overloading Meta.
- **Acceptance:**
  - Row with status only -> Detail '—'.
  - updatedAt 2026-09-28T09:14:22Z shows 28/09/2026.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Other modules sharing mapRows-style loaders may want the same fix.

### GAP-IDENTITY-API-KEYS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On failure the page shows the badge "Couldn't load — showing nothing" and then the EmptyState "No records" (ModuleListTable.tsx:27-33): no retry, and an empty result and an error look alike.
- **Verified evidence:** fetchJson returns [] with source 'error' on failure (apiClient.ts:170-172). ModuleListTable.tsx:33-35 renders DataSourceBadge then EmptyState 'No records / Nothing to show yet for this module.' when data is empty; no retry. Same component serves many modules.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, if provenance==='error-no-data' && data.length===0 render <RefreshErrorState error={toHumanError('load',{area:'records'})}/> instead of EmptyState.
  2. Keep EmptyState only for provenance==='live'.
  3. Apply once in the shared component to fix every ModuleListPage consumer.
- **Acceptance:**
  - Mock failed fetch -> error state with Retry, no 'No records'.
  - Empty success -> 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component: run snapshot tests for all ModuleListPage users.
- **Depends on:** RefreshErrorState

### GAP-IDENTITY-API-KEYS-06  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:15) and titles use "Identity — X" while the breadcrumb is a bare back link built with <a href> (full page reload, page.tsx:12).
- **Verified evidence:** api-keys/page.tsx:16 description 'API keys from identity-service.' (line 16, not 15); title 'Identity — API keys' at line 15; breadcrumb is a manual <nav><a href="/identity"> at lines 11-13 causing full reload. ModuleListPage.tsx:84 PageHeader has no back prop plumbed.
- **Files to change:** `apps/web/src/app/(app)/identity/api-keys/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add optional back/backLabel props to ModuleListPage and pass to PageHeader (which renders a next/link).
  2. Replace the manual nav with back="/identity" backLabel="Identity".
  3. Rewrite description to user language, e.g. 'Service and integration API keys for this office.'
- **Acceptance:**
  - Clicking back does client-side navigation.
  - No internal service name in visible copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-IDENTITY-BREAKGLASS-06


---
## /identity/breakglass  —  `identity/breakglass.html`

- **Source:** `apps/web/src/app/(app)/identity/breakglass/page.tsx`
- **Design reference:** `redesign/identity/breakglass.html`

### GAP-IDENTITY-BREAKGLASS-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check on an identity-administration route: identity/layout.tsx only checks that the module is enabled (layout.tsx:5) and the page calls the loader directly (page.tsx:7-8), so any signed-in tenant user reaches this list; DPDP-sensitive identity data depends entirely on the unseen backend.
- **Verified evidence:** identity/layout.tsx:5 ModuleGate only; breakglass/page.tsx:8 loads /api/v1/admin/breakglass (_data.ts:91) with no role check. tenant-admin/breakglass is under the requireAnyRole tenant-admin layout. Backend enforcement cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`
- **Fix steps:**
  1. Decision: allowed roles for identity admin pages; tenant-admin/layout.tsx uses ['tenant_admin','platform_admin','super_admin'].
  2. Add requireAnyRole(IDENTITY_ROLES) from '@/lib/auth/roleGuard' to identity/layout.tsx:4 before <ModuleGate>.
  3. Backend must independently authorise /api/v1/admin/* (not in snapshot).
- **Acceptance:**
  - Non-admin redirected from /identity/breakglass.
  - Admin sees list.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Same as API-KEYS-01.
- **Depends on:** GAP-IDENTITY-API-KEYS-01

### GAP-IDENTITY-BREAKGLASS-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Emergency-access requests can be listed but not approved, denied or closed (ModuleListTable.tsx:36-56), and requester, approver, reason, window and expiry are not columns (_data.ts:33-70); a break-glass workflow needs dual control and a visible audit trail.
- **Verified evidence:** Identity list is read-only with only ID/Name/Detail/Status/Meta (ModuleListTable.tsx:36-56; mapRows _data.ts:28-77 has no requester/approver/reason/window). tenant-admin/breakglass has BreakglassTable.tsx (Requester, Reason, Requested, Duration, Status) and BreakglassActions.tsx 'Close session' plus an [id] detail page. No approve/deny action exists in either place; whether break-glass is approve-first or self-activate-then-review is a product decision not visible in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/identity/breakglass/page.tsx`, `apps/web/src/app/(app)/identity/page.tsx`
- **Fix steps:**
  1. Decision: point /identity/breakglass at the tenant-admin implementation (redirect or reuse BreakglassTable) so requester/reason/duration/Close session are available.
  2. Decision with security owner: dual-control approve/deny workflow needed? If yes backend must add endpoints (not evidenced).
  3. Ensure every close/approve emits an audit event (backend).
- **Acceptance:**
  - Identity break-glass page shows requester, reason, window and Close session.
  - Non-admin cannot reach it.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Emergency access control; do not add actions without backend enforcement and audit.
- **Depends on:** GAP-IDENTITY-BREAKGLASS-01

### GAP-IDENTITY-BREAKGLASS-03  ·  HIGH  ·  partly  ·  theme ROLEGATE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Break-glass reasons and target systems may sit in `description`/`status`, which the mapper prints verbatim to any viewer (_data.ts:55-64) — no masking or role gate is applied client-side.
- **Verified evidence:** mapRows (_data.ts:51-59) shows description ?? status as Detail verbatim, and ModuleListTable.tsx:52 prints it to any viewer, no masking. But mapRows never reads reason/justification/targetSystem keys, so a reason is displayed only if the API names it 'description'; no evidence it does. Risk is real only combined with the missing role gate (BREAKGLASS-01).
- **Files to change:** `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/app/(app)/identity/layout.tsx`
- **Fix steps:**
  1. Land the role gate (BREAKGLASS-01) first.
  2. Check breakglass API response shape with identity-service owner; if reason is free text, render it only for admin roles in the detail view.
  3. Do not add reason to shared mapRows for lists visible to non-admins.
- **Acceptance:**
  - Non-admin cannot see any break-glass row.
  - Reason text shown only in admin detail.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** DPDP: free-text reasons may contain personal data.
- **Depends on:** GAP-IDENTITY-BREAKGLASS-01

### GAP-IDENTITY-BREAKGLASS-04  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** "Detail" repeats "Status" whenever there is no description (sublabel falls back to status, _data.ts:55-64) and Meta prints the raw ISO createdAt/updatedAt string (_data.ts:65-69), e.g. 2026-09-28T09:14:22Z.
- **Verified evidence:** Same shared mapper as API-KEYS-04: _data.ts:51-59 sublabel falls back to status; _data.ts:61-67 meta uses code ?? currency ?? updatedAt ?? createdAt raw ISO only when code/currency absent.
- **Files to change:** `apps/web/src/app/(app)/identity/_data.ts`
- **Fix steps:**
  1. Same fix as GAP-IDENTITY-API-KEYS-04 (single change in mapRows).
- **Acceptance:**
  - Detail no longer duplicates Status; dates render dd/mm/yyyy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared with all identity lists.
- **Depends on:** GAP-IDENTITY-API-KEYS-04

### GAP-IDENTITY-BREAKGLASS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On failure the page shows the badge "Couldn't load — showing nothing" and then the EmptyState "No records" (ModuleListTable.tsx:27-33): no retry, and an empty result and an error look alike.
- **Verified evidence:** Identical to API-KEYS-05: ModuleListTable.tsx:33-35 badge plus 'No records' EmptyState on failed fetch; no retry.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Fix once in ModuleListTable per GAP-IDENTITY-API-KEYS-05.
- **Acceptance:**
  - Failed fetch shows error with Retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component.
- **Depends on:** GAP-IDENTITY-API-KEYS-05

### GAP-IDENTITY-BREAKGLASS-06  ·  LOW  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:15) and titles use "Identity — X" while the breadcrumb is a bare back link built with <a href> (full page reload, page.tsx:12).
- **Verified evidence:** breakglass/page.tsx:16 description 'Break-glass access requests.' (no service name, differs from claim), but title 'Identity — Break-glass' line 15 and manual <a href="/identity"> breadcrumb lines 11-13 (full reload) are true. The 'from identity-service' wording applies to api-keys/users/sessions, not this page.
- **Files to change:** `apps/web/src/app/(app)/identity/breakglass/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Use PageHeader back/backLabel (add passthrough to ModuleListPage) instead of manual <a>.
  2. Consider dropping 'Identity — ' title prefix.
- **Acceptance:**
  - Back link navigates client-side.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-IDENTITY-API-KEYS-06


---
## /identity/sessions  —  `identity/sessions.html`

- **Source:** `apps/web/src/app/(app)/identity/sessions/page.tsx`
- **Design reference:** `redesign/identity/sessions.html`

### GAP-IDENTITY-SESSIONS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check on an identity-administration route: identity/layout.tsx only checks that the module is enabled (layout.tsx:5) and the page calls the loader directly (page.tsx:7-8), so any signed-in tenant user reaches this list; DPDP-sensitive identity data depends entirely on the unseen backend.
- **Verified evidence:** identity/layout.tsx:4-5 renders only <ModuleGate moduleKey="identity"> (ModuleGate.tsx:22-27 checks tenant module enablement only, no roles). sessions/page.tsx:8 calls the loader directly with no role check. Contrast tenant-admin/layout.tsx:4-8 and hr/layout.tsx:44-46 which call requireAnyRole. Any signed-in user with the module enabled renders the list; backend identity-service is absent from the snapshot so server-side scoping is cannot-verify. Line refs in the observation (layout.tsx:5, page.tsx:7-8) are correct.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`, `apps/web/src/lib/auth/identityRoles.ts (new)`
- **Fix steps:**
  1. Create IDENTITY_ADMIN_ROLES = ["tenant_admin","platform_admin","super_admin"] (mirror tenant-admin/layout.tsx ALLOWED) in a shared constant.
  2. In identity/layout.tsx call requireAnyRole(IDENTITY_ADMIN_ROLES) before returning <ModuleGate>, as hr/layout.tsx does.
  3. Decide whether the /identity hub (identity/page.tsx) and the Sidebar entry (ds/Sidebar.tsx:140) should also be hidden for non-admins; hide the link if so.
  4. Confirm with the identity-service owners that /api/identity/* also enforces the same roles (deny-by-default) and tenant scoping.
- **Acceptance:**
  - Unit/layout test: session with roles ["employee"] calling IdentityLayout is redirected (requireAnyRole); ["tenant_admin"] renders children.
  - Manual: sign in as employee, open /identity/sessions, /identity/users, /identity/webauthn: redirected, no list rendered.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Choosing the role set is a business decision; too narrow locks out legitimate HR/security officers, too broad leaves DPDP-sensitive identity data exposed. Client guard does not replace backend enforcement.
- **Depends on:** shared: identity role guard

### GAP-IDENTITY-SESSIONS-02  ·  HIGH  ·  partly  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No way to end a session: list has no revoke / sign-out-everywhere control (ModuleListTable.tsx:36-56), the main reason an admin opens a sessions page after a lost device or suspected compromise.
- **Verified evidence:** ModuleListTable.tsx:57-90 renders a read-only 5-column table (ID, Name, Detail, Status, Meta) with no actions, so the identity/sessions page (page.tsx:8-22) indeed has no revoke control. But the capability exists elsewhere: tenant-admin/sessions/SessionsTable.tsx:51-66 revokes via DELETE /api/proxy/identity/sessions/{id} with ConfirmDialog and reason, and tenant-admin/sessions/page.tsx uses getActiveSessions (loaders.ts:4298, the same /api/identity/sessions endpoint). The observation's line range 36-56 is off (actual table 57-90). No 'sign out everywhere' exists anywhere (backend cannot be verified).
- **Files to change:** `apps/web/src/app/(app)/identity/sessions/page.tsx`, `apps/web/src/app/(app)/tenant-admin/sessions/SessionsTable.tsx`
- **Fix steps:**
  1. Preferred: replace identity/sessions/page.tsx body with the tenant-admin SessionsTable + getActiveSessions (extract SessionsTable to a shared location or import it) so revoke, MFA and IP/user columns come for free.
  2. Alternatively make identity/sessions redirect() to /tenant-admin/sessions and point the hub link at it, to keep one implementation.
  3. Keep the existing ConfirmDialog with reason and the audit-emitting DELETE; do not add a new endpoint.
  4. For sign-out-everywhere per user: add only if identity-service exposes an endpoint (cannot-verify); otherwise raise a backend ticket.
- **Acceptance:**
  - Component test: clicking Revoke on an active row opens ConfirmDialog; confirming issues DELETE /api/proxy/identity/sessions/{id} and refreshes.
  - Manual: as tenant_admin revoke a session from /identity/sessions; row shows Revoked.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Revocation is a security-sensitive mutation; must be role-gated (SESSIONS-01) and audited server-side; accidental self-revoke should be warned.
- **Depends on:** GAP-IDENTITY-SESSIONS-01, GAP-IDENTITY-SESSIONS-03

### GAP-IDENTITY-SESSIONS-03  ·  HIGH  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** A sessions list without user, device, IP or last-seen: the mapper keeps only id/type/status/date (_data.ts:41-70), so rows cannot be attributed to a person and Name may show a bare id.
- **Verified evidence:** _data.ts:33-70 mapRows keeps id/label/sublabel/status/meta only. Sessions have no userName/email/ipAddress/userAgent in its key lists, so label falls to name/title/label/code/type/entityType/direction/id (lines 43-51) and can be the bare id; ID column shows row.id.slice(0,8) (ModuleListTable.tsx:81). No user, device, IP or last-seen columns. The richer typed shape SessionSummary (userEmail,userName,ipAddress,userAgent,lastActiveAt,mfaVerified,status) is already consumed by tenant-admin/sessions/page.tsx from the same endpoint via getActiveSessions (loaders.ts:4298). Theme is not really DATEFMT.
- **Files to change:** `apps/web/src/app/(app)/identity/sessions/page.tsx`, `apps/web/src/app/(app)/identity/_data.ts`
- **Fix steps:**
  1. Stop using getIdentitySessions/mapRows for sessions; use getActiveSessions() (loaders.ts:4298) with the tenant-admin SessionsTable columns (user name/email, IP, userAgent, lastActiveAt, MFA, status).
  2. Render lastActiveAt with formatDateTime (lib/admin/sftpIngestion.ts:280, move to lib/formatters.ts) in IST.
  3. Remove getIdentitySessions from _data.ts once unused.
  4. Mask/limit IP per DPDP decision (see SESSIONS-01).
- **Acceptance:**
  - Component test: given a SessionSummary fixture the row shows user name, IP and formatted last-active date, not a UUID.
  - Manual: /identity/sessions rows identifiable to a person.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** IP and user agent are personal data under DPDP; show only to admin roles.
- **Depends on:** GAP-IDENTITY-SESSIONS-02

### GAP-IDENTITY-SESSIONS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** "Detail" repeats "Status" whenever there is no description (sublabel falls back to status, _data.ts:55-64) and Meta prints the raw ISO createdAt/updatedAt string (_data.ts:65-69), e.g. 2026-09-28T09:14:22Z.
- **Verified evidence:** _data.ts:55-64 sublabel = description ?? status ?? state ?? ... so when no description exists Detail equals Status (ModuleListTable.tsx:83-84 prints both). Meta (_data.ts:65-69) = code ?? currency ?? updatedAt ?? createdAt and is rendered raw at ModuleListTable.tsx:85, so an ISO string like 2026-09-28T09:14:22Z is shown untouched. Note updatedAt is preferred over createdAt and only one date is shown, unlabelled. No date formatting anywhere in the pipeline.  Superseded if SESSIONS-03 is done.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDateTime to lib/formatters.ts (move from lib/admin/sftpIngestion.ts:280) with timeZone "Asia/Kolkata" and dd Mon yyyy, HH:mm.
  2. In _data.ts mapRows keep meta as a raw ISO field (e.g. metaDate) instead of pre-stringifying; format in ModuleListTable via formatDateTime.
  3. Do not fall back sublabel to status; drop the status fallback so Detail shows "—" when no description.
- **Acceptance:**
  - Unit test mapRows: row without description gives no sublabel.
  - Component test: meta 2026-09-28T09:14:22Z renders 28 Sep 2026, 14:44 (IST).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ModuleListTable/mapRows are shared by other modules' _data.ts (identity, and copies elsewhere); changing them affects all generic lists. Existing formatIndianDate is dd/MM/yyyy with no timezone.
- **Depends on:** GAP-IDENTITY-SESSIONS-03

### GAP-IDENTITY-SESSIONS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On failure the page shows the badge "Couldn't load — showing nothing" and then the EmptyState "No records" (ModuleListTable.tsx:27-33): no retry, and an empty result and an error look alike.
- **Verified evidence:** ModuleListPage.tsx:28 maps source==='error' to ModuleListTable source 'error'; ModuleListTable.tsx:50-56 uses useSeededResource; with no cache it yields provenance 'error-no-data', DataSourceBadge.tsx:71-72 prints "Couldn't load — showing nothing" (no retry), and ModuleListTable.tsx:65-66 then shows EmptyState "No records / Nothing to show yet for this module." because data is []. Empty ok-result and error differ only by the amber badge. Observation's lines 27-33 are actually 64-66. sessions inherits it via _data.ts fetchJson default [] fallback. RefreshErrorState exists (ds/RefreshErrorState.tsx) and uses router.refresh().
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable, when provenance === 'error-no-data' render <RefreshErrorState error={toHumanError("load",{area: title})} backHref="/identity" /> instead of DataSourceBadge+EmptyState (pass a backHref/area prop from ModuleListPage).
  2. Keep the cached-provenance badge path unchanged.
  3. Only show EmptyState when provenance is 'live' and data is empty.
- **Acceptance:**
  - Component test: provenance error-no-data renders retry button and no 'No records' text.
  - Manual: block /api/identity/sessions and load page; retry button visible; success after unblock and click.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ModuleListTable is shared across many module list pages, so the fix changes all of them (positively) and needs regression checks; cached path must stay intact.

### GAP-IDENTITY-SESSIONS-06  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:15) and titles use "Identity — X" while the breadcrumb is a bare back link built with <a href> (full page reload, page.tsx:12).
- **Verified evidence:** page.tsx:14-16 description="Sessions from identity-service." names an internal service; title "Identity — Sessions" (line 15); breadcrumb at lines 11-13 is a plain <a href="/identity"> (full reload) rather than next/link or PageHeader back prop. Same pattern in api-keys/breakglass pages. The observation's page.tsx:15/12 refs are approximately right (description line 16, anchor line 12).
- **Files to change:** `apps/web/src/app/(app)/identity/sessions/page.tsx`
- **Fix steps:**
  1. Replace hand-built <nav class=back> with PageHeader back="/identity" backLabel="Back to Identity" (used in payroll pages) or next/link.
  2. Change description to user language, e.g. "People currently signed in to your organisation."
  3. Title "Sessions" with breadcrumb showing the Identity parent.
- **Acceptance:**
  - Manual: click breadcrumb; no full-page reload (network shows RSC fetch).
  - Text search: no 'identity-service' in rendered UI.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic; low risk.


---
## /identity/users  —  `identity/users.html`

- **Source:** `apps/web/src/app/(app)/identity/users/page.tsx`
- **Design reference:** `redesign/identity/users.html`

### GAP-IDENTITY-USERS-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check on an identity-administration route: identity/layout.tsx only checks that the module is enabled (layout.tsx:5) and the page calls the loader directly (page.tsx:7-8), so any signed-in tenant user reaches this list; DPDP-sensitive identity data depends entirely on the unseen backend.
- **Verified evidence:** identity/layout.tsx:4-5 renders only <ModuleGate moduleKey="identity"> (ModuleGate.tsx:22-27 checks tenant module enablement only, no roles). users/page.tsx:8 calls the loader directly with no role check. Contrast tenant-admin/layout.tsx:4-8 and hr/layout.tsx:44-46 which call requireAnyRole. Any signed-in user with the module enabled renders the list; backend identity-service is absent from the snapshot so server-side scoping is cannot-verify. Line refs in the observation (layout.tsx:5, page.tsx:7-8) are correct.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`, `apps/web/src/lib/auth/identityRoles.ts (new)`
- **Fix steps:**
  1. Create IDENTITY_ADMIN_ROLES = ["tenant_admin","platform_admin","super_admin"] (mirror tenant-admin/layout.tsx ALLOWED) in a shared constant.
  2. In identity/layout.tsx call requireAnyRole(IDENTITY_ADMIN_ROLES) before returning <ModuleGate>, as hr/layout.tsx does.
  3. Decide whether the /identity hub (identity/page.tsx) and the Sidebar entry (ds/Sidebar.tsx:140) should also be hidden for non-admins; hide the link if so.
  4. Confirm with the identity-service owners that /api/identity/* also enforces the same roles (deny-by-default) and tenant scoping.
- **Acceptance:**
  - Unit/layout test: session with roles ["employee"] calling IdentityLayout is redirected (requireAnyRole); ["tenant_admin"] renders children.
  - Manual: sign in as employee, open /identity/sessions, /identity/users, /identity/webauthn: redirected, no list rendered.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Choosing the role set is a business decision; too narrow locks out legitimate HR/security officers, too broad leaves DPDP-sensitive identity data exposed. Client guard does not replace backend enforcement.
- **Depends on:** shared: identity role guard

### GAP-IDENTITY-USERS-02  ·  HIGH  ·  partly  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Users list is read-only with no invite / lock / role change (ModuleListTable.tsx:36-56), and is the only user directory the Identity hub links to.
- **Verified evidence:** identity/users/page.tsx:8-22 is a read-only ModuleListPage (ModuleListTable.tsx:57-90 has no actions) so no invite/lock/role change here. But the claim that it is the only user directory the hub links to is a hub-only truth: identity/page.tsx:10-16 links /identity/users plus /tenant-admin/mfa and /tenant-admin/sso, yet a full tenant-admin/users route (UsersTable.tsx POSTs /api/proxy/v1/admin/users at :181, [id] detail, roles at /tenant-admin/roles) exists behind requireAnyRole and is simply not linked from the hub. Theme DEADROUTE is wrong; it is a duplicate/underpowered page.
- **Files to change:** `apps/web/src/app/(app)/identity/page.tsx`, `apps/web/src/app/(app)/identity/users/page.tsx`
- **Fix steps:**
  1. Decide canonical user admin: tenant-admin/users. Either redirect("/tenant-admin/users") from identity/users/page.tsx or re-use UsersTable there.
  2. Update identity/page.tsx hub links to point Users at /tenant-admin/users and add Roles (/tenant-admin/roles).
  3. Remove getIdentityUsers from _data.ts if unused.
- **Acceptance:**
  - Manual: Identity hub Users link lands on a page with invite/lock/role actions for tenant_admin.
  - Test: /identity/users no longer renders ModuleListTable.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Two admin surfaces with different guards cause confusion; consolidating must retain the tenant-admin role gate.
- **Depends on:** GAP-IDENTITY-USERS-01

### GAP-IDENTITY-USERS-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic mapper drops identity-specific fields: it keeps id/label/sublabel/status/meta by guessing keys such as name, title, code, description, updatedAt (_data.ts:33-70), so email, role, IP, scopes or expiry are never shown, and when no name-like key exists the Name column repeats the raw id.
- **Verified evidence:** _data.ts:33-70 mapRows: id from id/key/code/name/..., label from name/title/label/code/type/entityType/direction/id, so email, roles, lastLogin are dropped and Name repeats the id when no name key exists (a user record with only email/username falls to id, line 51). ID column is slice(0,8) (ModuleListTable.tsx:81). The richer UserSummary typed loader (getAdminUsers, loaders.ts:4155, same /api/identity/users endpoint) and tenant-admin UsersTable already exist.
- **Files to change:** `apps/web/src/app/(app)/identity/users/page.tsx`, `apps/web/src/app/_components/Masked.tsx (new, if masking wanted)`
- **Fix steps:**
  1. Follow USERS-02: use getAdminUsers()/UsersTable columns (name, email, role, status, last login).
  2. If a list must show contact data, create shared <Masked value reveal> (client, reveal gated by role, emits audit event via existing audit endpoint) and mask email/phone by default.
  3. Never show IDs as names; fall back to email, not id.
- **Acceptance:**
  - Component test: row shows email and role, not truncated UUID.
  - Test Masked: default shows a***@d***.in; reveal requires admin role and posts an audit event.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Adds visible PII (email); masking and reveal audit must land together (DPDP). Reveal audit needs a backend audit endpoint (not verified).
- **Depends on:** GAP-IDENTITY-USERS-02, GAP-IDENTITY-USERS-01

### GAP-IDENTITY-USERS-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** "Detail" repeats "Status" whenever there is no description (sublabel falls back to status, _data.ts:55-64) and Meta prints the raw ISO createdAt/updatedAt string (_data.ts:65-69), e.g. 2026-09-28T09:14:22Z.
- **Verified evidence:** _data.ts:55-64 sublabel = description ?? status ?? state ?? ... so when no description exists Detail equals Status (ModuleListTable.tsx:83-84 prints both). Meta (_data.ts:65-69) = code ?? currency ?? updatedAt ?? createdAt and is rendered raw at ModuleListTable.tsx:85, so an ISO string like 2026-09-28T09:14:22Z is shown untouched. Note updatedAt is preferred over createdAt and only one date is shown, unlabelled. No date formatting anywhere in the pipeline.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDateTime to lib/formatters.ts (move from lib/admin/sftpIngestion.ts:280) using timeZone "Asia/Kolkata".
  2. In _data.ts keep meta as raw ISO in a separate field; format via formatDateTime in ModuleListTable.
  3. Remove the status fallback from sublabel so Detail shows "—" when absent.
- **Acceptance:**
  - Unit test mapRows: row without description gives no sublabel.
  - Component test: meta 2026-09-28T09:14:22Z renders a formatted IST date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared generic list component used by other modules; change must be regression-checked across them.
- **Depends on:** shared: ModuleListTable generic list

### GAP-IDENTITY-USERS-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On failure the page shows the badge "Couldn't load — showing nothing" and then the EmptyState "No records" (ModuleListTable.tsx:27-33): no retry, and an empty result and an error look alike.
- **Verified evidence:** ModuleListPage.tsx:28 maps source==='error' to ModuleListTable source 'error'; ModuleListTable.tsx:50-56 uses useSeededResource; with no cache it yields provenance 'error-no-data', DataSourceBadge.tsx:71-72 prints "Couldn't load — showing nothing" (no retry), and ModuleListTable.tsx:65-66 then shows EmptyState "No records / Nothing to show yet for this module." because data is []. Empty ok-result and error differ only by the amber badge. Observation's lines 27-33 are actually 64-66. users inherits it via _data.ts fetchJson default [] fallback. RefreshErrorState exists (ds/RefreshErrorState.tsx) and uses router.refresh().
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Fix once in shared ModuleListTable (see GAP-IDENTITY-SESSIONS-05); no page-level change needed.
- **Acceptance:**
  - Component test: provenance error-no-data renders retry button and no 'No records' text.
  - Manual: block /api/identity/users and load page; retry button visible; success after unblock and click.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ModuleListTable is shared across many module list pages, so the fix changes all of them (positively) and needs regression checks; cached path must stay intact.
- **Depends on:** GAP-IDENTITY-SESSIONS-05

### GAP-IDENTITY-USERS-06  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:15) and titles use "Identity — X" while the breadcrumb is a bare back link built with <a href> (full page reload, page.tsx:12).
- **Verified evidence:** page.tsx:14-16 description="Users from identity-service." names an internal service; title "Identity — Users" (line 15); breadcrumb at lines 11-13 is a plain <a href="/identity"> (full reload) rather than next/link or PageHeader back prop. Same pattern in api-keys/breakglass pages. The observation's page.tsx:15/12 refs are approximately right (description line 16, anchor line 12).
- **Files to change:** `apps/web/src/app/(app)/identity/users/page.tsx`
- **Fix steps:**
  1. Replace hand-built <nav class=back> with PageHeader back="/identity" backLabel="Back to Identity" (used in payroll pages) or next/link.
  2. Change description to user language, e.g. "People currently signed in to your organisation."
  3. Title "Sessions" with breadcrumb showing the Identity parent.
- **Acceptance:**
  - Manual: click breadcrumb; no full-page reload (network shows RSC fetch).
  - Text search: no 'identity-service' in rendered UI.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic; low risk.


---
## /identity/webauthn  —  `identity/webauthn.html`

- **Source:** `apps/web/src/app/(app)/identity/webauthn/page.tsx`
- **Design reference:** `redesign/identity/webauthn.html`

### GAP-IDENTITY-WEBAUTHN-01  ·  HIGH  ·  confirmed  ·  theme ROLEGATE (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No role check on an identity-administration route: identity/layout.tsx only checks that the module is enabled (layout.tsx:5) and the page calls the loader directly (page.tsx:7-8), so any signed-in tenant user reaches this list; DPDP-sensitive identity data depends entirely on the unseen backend.
- **Verified evidence:** identity/layout.tsx:4-5 renders only <ModuleGate moduleKey="identity"> (ModuleGate.tsx:22-27 checks tenant module enablement only, no roles). webauthn/page.tsx:8 calls the loader directly with no role check. Contrast tenant-admin/layout.tsx:4-8 and hr/layout.tsx:44-46 which call requireAnyRole. Any signed-in user with the module enabled renders the list; backend identity-service is absent from the snapshot so server-side scoping is cannot-verify. Line refs in the observation (layout.tsx:5, page.tsx:7-8) are correct.
- **Files to change:** `apps/web/src/app/(app)/identity/layout.tsx`, `apps/web/src/lib/auth/identityRoles.ts (new)`
- **Fix steps:**
  1. Create IDENTITY_ADMIN_ROLES = ["tenant_admin","platform_admin","super_admin"] (mirror tenant-admin/layout.tsx ALLOWED) in a shared constant.
  2. In identity/layout.tsx call requireAnyRole(IDENTITY_ADMIN_ROLES) before returning <ModuleGate>, as hr/layout.tsx does.
  3. Decide whether the /identity hub (identity/page.tsx) and the Sidebar entry (ds/Sidebar.tsx:140) should also be hidden for non-admins; hide the link if so.
  4. Confirm with the identity-service owners that /api/identity/* also enforces the same roles (deny-by-default) and tenant scoping.
- **Acceptance:**
  - Unit/layout test: session with roles ["employee"] calling IdentityLayout is redirected (requireAnyRole); ["tenant_admin"] renders children.
  - Manual: sign in as employee, open /identity/sessions, /identity/users, /identity/webauthn: redirected, no list rendered.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Choosing the role set is a business decision; too narrow locks out legitimate HR/security officers, too broad leaves DPDP-sensitive identity data exposed. Client guard does not replace backend enforcement.
- **Depends on:** shared: identity role guard

### GAP-IDENTITY-WEBAUTHN-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W2 PQ: closed by #2082)
- **W0 note:** partly fixed by #1862 — PasskeyManager with confirm-gated remove, titled My passkeys; register shows not-available (backend 501), no rename
- **First-pass claim:** Passkeys cannot be registered, renamed or removed here (ModuleListTable.tsx:36-56), and the list shows no owner, so it is unclear whether these are the viewer's own credentials or a tenant-wide list.
- **Verified evidence:** webauthn/page.tsx:7-20 renders ModuleListPage read-only (ModuleListTable.tsx:57-90 no actions). Endpoint /api/v1/identity/webauthn/credentials (_data.ts:79) is unverifiable (identity-service absent); the mapper has no owner field (userId/userEmail not in key lists), so whether rows are the viewer's or tenant-wide is not shown. No other webauthn route exists (tenant-admin has no webauthn dir). Register/rename/remove needs browser WebAuthn ceremony (navigator.credentials) and endpoints not visible.
- **Files to change:** `apps/web/src/app/(app)/identity/webauthn/page.tsx`, `apps/web/src/app/(app)/identity/webauthn/PasskeyManager.tsx (new)`, `apps/web/src/app/(app)/identity/_data.ts`
- **Fix steps:**
  1. Confirm with identity-service whether the credentials endpoint is self-scoped or admin-wide; label the page accordingly ("My passkeys" vs "All passkeys").
  2. Add owner column (name/email) if admin-wide.
  3. Add client PasskeyManager: rename (PATCH) and remove (DELETE) with ConfirmDialog + reason; register via navigator.credentials.create with server challenge (only if endpoints exist).
  4. Use zod at the fetch boundary for request bodies.
- **Acceptance:**
  - Component test: Remove opens ConfirmDialog and calls DELETE on confirm, list refreshes.
  - Manual: page title makes scope (own vs tenant) explicit.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Removing a passkey can lock users out; require confirmation and keep another factor. Endpoints cannot be verified.
- **Depends on:** GAP-IDENTITY-WEBAUTHN-01

### GAP-IDENTITY-WEBAUTHN-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** No last-used date or authenticator type: only id, name-like label, status and one date survive the mapper (_data.ts:33-70).
- **Verified evidence:** _data.ts:33-70 mapRows retains only id/label/sublabel/status/meta; last-used, authenticator type/transports/createdAt (separately) are dropped and only one date (updatedAt else createdAt, lines 65-69) survives, unlabelled and raw. The wire shape of credentials is cannot-verify (identity-service absent). Theme DATEFMT partly right.
- **Files to change:** `apps/web/src/app/(app)/identity/webauthn/page.tsx`, `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add a typed WebauthnCredential mapper (zod-parsed) in _data.ts with fields the API actually returns (name, lastUsedAt, authenticatorType/transports, createdAt) after confirming the contract.
  2. Render via DataTable columns 'Last used' (formatDateTime), 'Type', 'Registered'.
  3. Fall back to "—" for missing fields.
- **Acceptance:**
  - Unit test mapper with a credential fixture -> lastUsedAt present.
  - Manual: columns Last used / Type visible.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Field names guessed without the service; verify contract before coding.
- **Depends on:** GAP-IDENTITY-WEBAUTHN-02

### GAP-IDENTITY-WEBAUTHN-04  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** "Detail" repeats "Status" whenever there is no description (sublabel falls back to status, _data.ts:55-64) and Meta prints the raw ISO createdAt/updatedAt string (_data.ts:65-69), e.g. 2026-09-28T09:14:22Z.
- **Verified evidence:** _data.ts:55-64 sublabel = description ?? status ?? state ?? ... so when no description exists Detail equals Status (ModuleListTable.tsx:83-84 prints both). Meta (_data.ts:65-69) = code ?? currency ?? updatedAt ?? createdAt and is rendered raw at ModuleListTable.tsx:85, so an ISO string like 2026-09-28T09:14:22Z is shown untouched. Note updatedAt is preferred over createdAt and only one date is shown, unlabelled. No date formatting anywhere in the pipeline.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/identity/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatDateTime to lib/formatters.ts (move from lib/admin/sftpIngestion.ts:280) using timeZone "Asia/Kolkata".
  2. In _data.ts keep meta as raw ISO in a separate field; format via formatDateTime in ModuleListTable.
  3. Remove the status fallback from sublabel so Detail shows "—" when absent.
- **Acceptance:**
  - Unit test mapRows: row without description gives no sublabel.
  - Component test: meta 2026-09-28T09:14:22Z renders a formatted IST date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared generic list component used by other modules; change must be regression-checked across them.
- **Depends on:** shared: ModuleListTable generic list

### GAP-IDENTITY-WEBAUTHN-05  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On failure the page shows the badge "Couldn't load — showing nothing" and then the EmptyState "No records" (ModuleListTable.tsx:27-33): no retry, and an empty result and an error look alike.
- **Verified evidence:** ModuleListPage.tsx:28 maps source==='error' to ModuleListTable source 'error'; ModuleListTable.tsx:50-56 uses useSeededResource; with no cache it yields provenance 'error-no-data', DataSourceBadge.tsx:71-72 prints "Couldn't load — showing nothing" (no retry), and ModuleListTable.tsx:65-66 then shows EmptyState "No records / Nothing to show yet for this module." because data is []. Empty ok-result and error differ only by the amber badge. Observation's lines 27-33 are actually 64-66. webauthn inherits it via _data.ts fetchJson default [] fallback. RefreshErrorState exists (ds/RefreshErrorState.tsx) and uses router.refresh().
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Fix once in shared ModuleListTable (see GAP-IDENTITY-SESSIONS-05); no page-level change needed.
- **Acceptance:**
  - Component test: provenance error-no-data renders retry button and no 'No records' text.
  - Manual: block /api/identity/webauthn and load page; retry button visible; success after unblock and click.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** ModuleListTable is shared across many module list pages, so the fix changes all of them (positively) and needs regression checks; cached path must stay intact.
- **Depends on:** GAP-IDENTITY-SESSIONS-05

### GAP-IDENTITY-WEBAUTHN-06  ·  LOW  ·  partly  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle names the internal service ("from identity-service", page.tsx:15) and titles use "Identity — X" while the breadcrumb is a bare back link built with <a href> (full page reload, page.tsx:12).
- **Verified evidence:** Breadcrumb is a plain <a href="/identity"> (webauthn/page.tsx:12) and title is "Identity — WebAuthn" (line 15): true. But the subtitle is "WebAuthn credentials." (line 16); it does NOT name identity-service (only sessions/users do; the hub subtitle identity/page.tsx:7 does).
- **Files to change:** `apps/web/src/app/(app)/identity/webauthn/page.tsx`
- **Fix steps:**
  1. Replace <nav>/<a> with PageHeader back="/identity" or next/link.
  2. Rewrite description as user copy, e.g. "Passkeys registered for sign-in."
  3. Adopt title convention decided for the identity group.
- **Acceptance:**
  - Manual: breadcrumb navigates client-side without full reload.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cosmetic.


---
## Backend verification items (service code absent from snapshot)

### GAP-IDENTITY-API-KEYS-03  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** ID mapping tries `row.key` before name (_data.ts:35-43); if /api/v1/admin/api-keys returns a secret under `key` without `id`, its first 8 characters are printed in the ID column and cached offline by useSeededResource (ModuleListTable.tsx:21-26). Payload shape undeterminable (service absent).
- **Service:** `identity-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/api-keys']`
- **Question:** GET /v1/admin/api-keys must never return secret key material (only id, name, prefix, scopes, createdAt, lastUsedAt, status) and must include a stable id.
- **How to verify:** In identity-service open the admin api-keys list handler and its response schema; curl GET /v1/admin/api-keys as tenant_admin and assert no field named key/secret/hash and that every row has a UUID id.
- **Test to add:** Given an API key was just created, when tenant_admin lists keys, then each row has id and keyPrefix and no property matching /secret|key$|hash/ ; response schema test fails if one is added.
- **Impact if wrong:** Secret disclosure into HTML, the offline cache (useSeededResource) and logs; credential compromise.
- **Web change if wrong:** In identity/_data.ts drop row.key from the id fallback chain for this loader (use id only); if service returns a secret, stop caching the route offline.


---
## Refuted by deep pass — do NOT implement

### GAP-IDENTITY-HOME-05 · /identity
- **First-pass claim:** WebAuthn / Break-glass wording differs from the child page titles ("Identity — WebAuthn", "Identity — Break-glass") so the hub label and page title read as different things.
- **Why refuted:** Hub labels 'API keys', 'Break-glass', 'WebAuthn' (page.tsx:12-14) match the child titles 'Identity — API keys/Break-glass/WebAuthn' (api-keys/page.tsx:15, breakglass/page.tsx:15, webauthn/page.tsx:15) apart from the 'Identity — ' prefix; the wording does not differ. Any residual issue is the prefix style, covered by the breadcrumb/title findings.
