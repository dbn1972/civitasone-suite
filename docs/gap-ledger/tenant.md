# Detailed gap file — module `tenant`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 62, BACKEND-VERIFY 11



---
## /tenant  —  `tenant/home.html`

- **Source:** `apps/web/src/app/(app)/tenant/page.tsx`
- **Design reference:** `redesign/tenant/home.html`

### GAP-TENANT-HOME-02  ·  MEDIUM  ·  partly  ·  theme ROLEGATE

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): apps/web/src/app/(app)/tenant/page.test.tsx (cross-link to /tenant-admin), w2-layout-notfound.test.tsx (non-admin redirected before any tile renders), services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (basic user 403))
- **First-pass claim:** Tiles duplicate the Tenant Admin area (/tenant-admin exists in the app tree with its own settings, plans, org hierarchy): two admin homes for the same concerns with no cross-link except the disabled-module fallback (ModuleGate.tsx).
- **Verified evidence:** Both /tenant (page.tsx, ModuleHub of 11 tiles) and /tenant-admin (tenant-admin/page.tsx, own users/roles/security/plans/usage/org-hierarchy/settings/subscription screens) exist and both appear in Sidebar.tsx:141-142. True that they overlap in concern (org hierarchy, plans, quotas/usage, settings, subscription) and that tenant/page.tsx has no link to /tenant-admin; ModuleGate.tsx links to /tenant-admin only in the disabled fallback. But they hit different endpoints (/api/v1/tenant/* vs /api/v1/admin/*, /billing/*, loaders.ts:4549-4665), and tenant/page.tsx has no role guard while /tenant is only gated by ModuleGate(moduleKey='tenant'). Whether the server enforces roles cannot be verified: tenant-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/tenant/page.tsx`, `apps/web/src/app/_components/ds/Sidebar.tsx`, `apps/web/src/app/(app)/tenant-admin/page.tsx`
- **Fix steps:**
  1. Decide product intent: keep /tenant as the tenant-service admin hub or fold its read-only lists into /tenant-admin.
  2. If kept, add a cross-link tile/banner in tenant/page.tsx (ModuleHub children) to /tenant-admin and back.
  3. Wrap admin-only tiles with the shared role check used by tenant-admin/page.tsx (canViewOperations pattern) and hide unusable tiles.
  4. Verify tenant-service enforces roles on /api/v1/tenant/* (out of snapshot).
- **Acceptance:**
  - Non-admin user sees no admin-only tiles on /tenant.
  - Hub has a visible link to /tenant-admin.
  - Direct API call by non-admin returns 403 (backend test).
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Medium; removing/merging routes affects navRouteManifest.ts and bookmarks. Server authorisation is the real control.

### GAP-TENANT-HOME-03  ·  MEDIUM  ·  partly  ·  theme EMPTYSTATE (was DEADROUTE)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx ('Back to Office home' -> /tenant; tile skeleton status region))
- **First-pass claim:** loading.tsx is a generic four-stat-and-block skeleton (loading.tsx:7-12) that does not match a tile hub; the not-found EmptyState has no link back (not-found.tsx:5-8).
- **Verified evidence:** loading.tsx:7-12 is a generic skeleton (h-4, h-9, four h-24 stat blocks, one h-72 block) - accurate, mismatched with a tile hub (and with the list pages). not-found.tsx:5-8 renders EmptyState with title/message and no action/link - accurate. However there is no dead link or dead route here (theme DEADROUTE is wrong): all 11 hub hrefs have a page.tsx (subscriptions dir exists, others verified in tree).
- **Files to change:** `apps/web/src/app/(app)/tenant/loading.tsx`, `apps/web/src/app/(app)/tenant/not-found.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx as a tile-grid skeleton (grid of ~9-11 rounded cards matching .mtile) or delete it and rely on the app-level loading.
  2. In not-found.tsx pass an action (link to /tenant and /dashboard) to EmptyState; check EmptyState's action prop in ds/EmptyState.
  3. Use plain-language copy without 'tenant'.
- **Acceptance:**
  - Visiting /tenant/does-not-exist shows a 'Back to Office home' link that navigates to /tenant.
  - Loading state shows tile-shaped placeholders (visual check).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-TENANT-HOME-04  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Description is one 150-character run-on sentence (page.tsx:7) and 'Tenant' is a banned clerk-facing term (lib/labels.ts:30); tile icons fall back to 📁 for every title here (LinkTiles.tsx:56-62).
- **Verified evidence:** page.tsx:7 description is ~150 chars, single run-on sentence, hard-coded; 'Tenant' title/description conflict with BANNED_CLERK_TERMS ('tenant', lib/labels.ts:30). LinkTiles.tsx:56-62 tileIcon falls back to '📁' unless title is in TILE_ICONS (none of the tenant tile titles: Overview, Quotas & Usage, Settings, Org Hierarchy, Subscriptions, Plans, Code Lists, Positions, Consent Exchange, Stewardship, Data Migration) or href contains dashboard/employees/leave/payroll/procurement/orders - so all 11 tiles get 📁. Correct. The finding's fix text (aria labels/non-colour cues) is unrelated.
- **Files to change:** `apps/web/src/app/(app)/tenant/page.tsx`, `apps/web/src/app/_components/LinkTiles.tsx`, `apps/web/messages`
- **Fix steps:**
  1. Move title/description to next-intl keys and shorten description to one short sentence; use LABELS.tenantTitle ('Office').
  2. Extend NavTile (packages/types) with optional icon, pass icon from ModuleHub links, and use it in tileIcon before the fallback; or add tenant titles to TILE_ICONS.
  3. Give each tenant tile a distinct icon.
  4. Add banned-term unit test for the hub copy.
- **Acceptance:**
  - Each /tenant tile shows a distinct icon, none is 📁.
  - findBannedTerms(title+description) returns [].
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; NavTile type change touches shared package.
- **Depends on:** LinkTiles


---
## /tenant/code-lists  —  `tenant/code-lists.html`

- **Source:** `apps/web/src/app/(app)/tenant/code-lists/page.tsx`
- **Design reference:** `redesign/tenant/code-lists.html`

### GAP-TENANT-CODE-LISTS-01  ·  HIGH  ·  interim  ·  theme WIRING

- [~] **Status** (INTERIM — INTERIM — needs backend values endpoint (effective-dated code values) + new web page; web+backend feature build)
- **W0 note:** partly fixed by #1916 — mapCodeListRows maps header fields (code, system/custom); no [code] detail route or effective dates
- **First-pass claim:** Subtitle promises 'effective-dated values' but only list headers are shown; values, effectiveFrom/effectiveTo are not mapped (tenant/_data.ts:32-75) and there is no drill-down link, so the reference data cannot be inspected.
- **Verified evidence:** mapTenantRows (tenant/_data.ts:32-75) flattens rows to id/label/sublabel/status/meta; it reads row.value but not a values array, effectiveFrom or effectiveTo. ModuleListTable has no link column and no [id] route exists under tenant/code-lists (only page.tsx). Payload shape from tenant-service is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/tenant/code-lists/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/code-lists/[code]/page.tsx`
- **Fix steps:**
  1. Confirm the values endpoint with backend (no such loader exists now).
  2. Add getTenantCodeListValues loader with zod-parsed shape (code, value, effectiveFrom, effectiveTo).
  3. Add /tenant/code-lists/[code] page with DataTable of values and date columns.
  4. Link each row's label to it; or drop 'effective-dated values' from the subtitle if not delivered.
- **Acceptance:**
  - Manual: click a list shows its values with effective dates.
  - Unit: zod parser rejects value rows missing effectiveFrom.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Reference data drives other modules; display must not imply edit rights.

### GAP-TENANT-CODE-LISTS-02  ·  MEDIUM  ·  confirmed  ·  theme UUID (was OTHER)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1801): ModuleListTable.showid.test.tsx (ID column hidden on all tenant pages))
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:50 prints row.id.slice(0,8) in the ID column for every row.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Add an optional showId (default true) prop to ModuleListTable and ModuleListPage, or replace the ID column with a meaningful code (row.meta).
  2. Set showId={false} on tenant pages.
- **Acceptance:**
  - Manual: no truncated id column on the page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table; keep default for other pages.

### GAP-TENANT-CODE-LISTS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps source to 'error'|'api'; ModuleListTable.tsx:31-35 renders DataSourceBadge ('Couldn't load — showing nothing') and, since data is [], the EmptyState 'No records / Nothing to show yet' (:32-33 in the else branch). No retry control exists. The badge and empty text contradict each other.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/_components/DataSourceBadge.tsx`
- **Fix steps:**
  1. Create shared RefreshErrorState (message + Retry calling router.refresh()).
  2. In ModuleListTable render it when provenance==='error-no-data' instead of EmptyState and suppress the badge in that case.
  3. Keep EmptyState only for provenance live with zero rows.
- **Acceptance:**
  - Component test: provenance error-no-data shows retry, not 'No records'.
  - Component test: live + empty shows EmptyState.
  - Manual: Retry re-fetches.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used app-wide; run its tests.
- **Depends on:** RefreshErrorState

### GAP-TENANT-CODE-LISTS-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): apps/web/src/app/_components/ModuleListTable.test.tsx ('client search box filters rows by label match', 'clicking the Name header sorts rows alphabetically', 'renders status through StatusPill') + tenant/*/page.test.tsx)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a plain <table className='tbl'> with no sort, filter or pagination; status printed as plain text (row.status ?? '—'). ds/DataTable supports sortable, filterable, pageSize.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Rebuild ModuleListTable on ds DataTable with sortable, filterable and pageSize=15.
  2. Render status via the DS StatusBadge/Pill component.
- **Acceptance:**
  - Manual: filter box narrows rows; headers sort.
  - Component test: status renders as badge.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table; check row-key and a11y tests.

### GAP-TENANT-CODE-LISTS-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): w2-pages-i18n.test.tsx (heading 'Office — Code Lists' from catalogue, no banned term))
- **First-pass claim:** Title 'Tenant — Code Lists' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Reference code lists and effective-dated values.".
- **Verified evidence:** code-lists/page.tsx title 'Tenant — Code Lists' is a hard-coded literal (:15) though the file has no useTranslations; BANNED_CLERK_TERMS in lib/labels.ts:30 includes 'tenant'. The page's breadcrumb 'Tenant' and hub also use it. Theme is COPY/I18N, not FABRICATED (no fake figures).
- **Files to change:** `apps/web/src/app/(app)/tenant/code-lists/page.tsx`, `apps/web/src/lib/labels.ts`
- **Fix steps:**
  1. Use label 'Office' (LABELS.tenantTitle) and next-intl keys for title/subtitle/breadcrumb.
  2. Rename title to 'Code Lists'; subtitle 'Reference code lists and their dated values.'
- **Acceptance:**
  - Unit: banned-terms test passes on rendered page copy.
  - Manual: title reads 'Office — Code Lists' or 'Code Lists'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant/consent-exchange  —  `tenant/consent-exchange.html`

- **Source:** `apps/web/src/app/(app)/tenant/consent-exchange/page.tsx`
- **Design reference:** `redesign/tenant/consent-exchange.html`

### GAP-TENANT-CONSENT-EXCHANGE-01  ·  HIGH  ·  interim  ·  theme DEADROUTE

- [~] **Status** (INTERIM — INTERIM — DPDP approve/reject needs decision endpoint + reviewer role absent from snapshot)
- **W0 note:** partly fixed by #1916 — mapConsentRows shows purpose/categories/expiry; page still read-only, no decision actions
- **First-pass claim:** No way to act on a consent request from the route: read-only table despite 'awaiting decision' (consent-exchange/page.tsx:16). Requests carry no purpose or data-category text for the reviewer.
- **Verified evidence:** consent-exchange/page.tsx is a ModuleListPage only: no action controls; subtitle 'awaiting decision' (:16). mapTenantRows carries no purpose or data-category fields. Whether a decision endpoint exists is cannot-verify (tenant-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/tenant/consent-exchange/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`
- **Fix steps:**
  1. Confirm approve/reject endpoint with backend.
  2. Add detail drawer/route with purpose, data categories, requester, expiry.
  3. Add Approve/Reject buttons with reason, confirm dialog and audit event; disable while pending.
  4. Until then reword subtitle to 'Cross-organisation consent requests' and mark read-only.
- **Acceptance:**
  - Manual: reviewer can approve a request and status updates.
  - Test: approve posts once and disables the button while pending.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** DPDP consent decisions need audit trail and role gating.
- **Depends on:** GAP-TENANT-CONSENT-EXCHANGE-02

### GAP-TENANT-CONSENT-EXCHANGE-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): w2-layout-notfound.test.tsx (non-admin gate) + w2-tenant-web-paths-authz.test.ts (consent/requests: employee 403) + _data.test.ts mapConsentRows (purpose+requester, no UUID). Gate is tenant_admin-level, not a DPO-specific role)
- **First-pass claim:** DPDP consent requests are listed for any signed-in user (no role gate: tenant/layout.tsx:5, middleware.ts:48-59). The payload is flattened to id/label/type/status (tenant/_data.ts:32-75), so the Name column shows the full request UUID (fallback at _data.ts:44-52) and requester, purpose, data categories and expiry are never shown. Subtitle says 'awaiting decision' yet the page has no approve/reject control and the hub's 'ledger' has no endpoint call.
- **Verified evidence:** True: tenant/layout.tsx only wraps ModuleGate (module enabled check), no role check; middleware.ts contains no role logic; mapTenantRows (_data.ts:32-75) keeps only id/label/sublabel/status/meta; the hub note mentions a 'ledger' with no loader. Name shows the UUID only when the payload lacks name/title/label/key/resource/code/domain (fallback to id, _data.ts:44-52) - payload cannot be verified. Purpose/requester are indeed not mapped.
- **Files to change:** `apps/web/src/app/(app)/tenant/layout.tsx`, `apps/web/src/app/(app)/tenant/consent-exchange/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/page.tsx`
- **Fix steps:**
  1. Add role check (e.g. DPO/admin) in the consent-exchange route or layout, redirecting others.
  2. Map requester, purpose, categories, expiry in a dedicated loader with zod.
  3. Never fall back to UUID for label; use 'Consent request' + requester.
  4. Remove 'ledger' from the hub note or add the ledger loader.
- **Acceptance:**
  - Test: non-DPO gets forbidden state.
  - Manual: requester and purpose visible, no UUID in Name column.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/consent data is exposed to all signed-in users if the backend also lacks a role check; verify server side too.
- **Depends on:** GAP-TENANT-CONSENT-EXCHANGE-01

### GAP-TENANT-CONSENT-EXCHANGE-03  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 tenant: closed by #2060; apps/web ModuleListTable.showid.test.tsx (showId={false} hides the ID column; time-ordered UUIDs sharing an 8-char prefix are no longer rendered) + every tenant page passes showId={false})
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide (UUIDs share the leading 8 chars when time-ordered).
- **Verified evidence:** ModuleListTable.tsx:50 truncates id to 8 chars. The 'collide' claim is plausible for time-ordered UUIDs but unproven.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Same as GAP-TENANT-CODE-LISTS-02 (showId prop).
- **Acceptance:**
  - Manual: no truncated id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table.
- **Depends on:** GAP-TENANT-CODE-LISTS-02

### GAP-TENANT-CONSENT-EXCHANGE-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx ('shows a retryable error state ... no cache exists', 'renders empty state when no rows') + ds/RefreshErrorState.test.tsx (Retry calls router.refresh))
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps source to 'error'|'api'; ModuleListTable.tsx:31-35 renders DataSourceBadge ('Couldn't load — showing nothing') and, since data is [], the EmptyState 'No records / Nothing to show yet' (:32-33 in the else branch). No retry control exists. The badge and empty text contradict each other.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/_components/DataSourceBadge.tsx`
- **Fix steps:**
  1. Create shared RefreshErrorState (message + Retry calling router.refresh()).
  2. In ModuleListTable render it when provenance==='error-no-data' instead of EmptyState and suppress the badge in that case.
  3. Keep EmptyState only for provenance live with zero rows.
- **Acceptance:**
  - Component test: provenance error-no-data shows retry, not 'No records'.
  - Component test: live + empty shows EmptyState.
  - Manual: Retry re-fetches.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used app-wide; run its tests.
- **Depends on:** RefreshErrorState

### GAP-TENANT-CONSENT-EXCHANGE-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** Same generic ModuleListTable (no sort/filter/pagination, plain status text).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Same as GAP-TENANT-CODE-LISTS-05.
- **Acceptance:**
  - Same as GAP-TENANT-CODE-LISTS-05.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table.
- **Depends on:** GAP-TENANT-CODE-LISTS-05

### GAP-TENANT-CONSENT-EXCHANGE-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): w2-pages-i18n.test.tsx (no banned term; translated heading))
- **First-pass claim:** Title 'Tenant — Consent Exchange' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Cross-tenant consent requests awaiting decision.".
- **Verified evidence:** consent-exchange/page.tsx title/subtitle hard-coded English; 'tenant' banned (labels.ts:30); 'Cross-tenant' also banned. Not fabricated data.
- **Files to change:** `apps/web/src/app/(app)/tenant/consent-exchange/page.tsx`
- **Fix steps:**
  1. Use next-intl keys and clerk terms: 'Office' / 'Cross-organisation'.
- **Acceptance:**
  - Banned-terms test passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant/data-migration  —  `tenant/data-migration.html`

- **Source:** `apps/web/src/app/(app)/tenant/data-migration/page.tsx`
- **Design reference:** `redesign/tenant/data-migration.html`

### GAP-TENANT-DATA-MIGRATION-01  ·  HIGH  ·  interim  ·  theme WIRING (was DEADROUTE)

- [~] **Status** (INTERIM — INTERIM — no start/retry/error-report endpoints; needs owner decision on data-integrity feature build)
- **W0 note:** partly fixed by #1916 — mapMigrationRows shows entities, records migrated, error count, dry-run; no start/retry/download control
- **First-pass claim:** 'Reconciliation jobs' (data-migration/page.tsx:16) show only name and status: no progress, record counts or mismatch totals (tenant/_data.ts:32-75), and no way to start, retry or download an error report. Read-only view of a data-integrity operation.
- **Verified evidence:** True: data-migration page is a read-only ModuleListPage of /api/v1/tenant/org/migrations mapped to id/label/status only (_data.ts). No start/retry/download control. Whether backend exposes start/retry/error-report endpoints is cannot-verify; it is a missing feature rather than a dead route.
- **Files to change:** `apps/web/src/app/(app)/tenant/data-migration/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`
- **Fix steps:**
  1. Get counts/progress fields from backend and extend a dedicated loader.
  2. Add columns processed/total/mismatches and a progress bar.
  3. Add Retry and Download error report actions only once endpoints exist; gate to admin role and audit.
- **Acceptance:**
  - Manual: job row shows counts and mismatches.
  - Test: retry button disabled while pending.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Data-integrity operation; actions need confirm and audit.

### GAP-TENANT-DATA-MIGRATION-02  ·  MEDIUM  ·  confirmed  ·  theme UUID (was OTHER)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1801): ModuleListTable.showid.test.tsx)
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:50 truncated id column.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Same as GAP-TENANT-CODE-LISTS-02.
- **Acceptance:**
  - Manual: no truncated id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table.
- **Depends on:** GAP-TENANT-CODE-LISTS-02

### GAP-TENANT-DATA-MIGRATION-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps source to 'error'|'api'; ModuleListTable.tsx:31-35 renders DataSourceBadge ('Couldn't load — showing nothing') and, since data is [], the EmptyState 'No records / Nothing to show yet' (:32-33 in the else branch). No retry control exists. The badge and empty text contradict each other.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`, `apps/web/src/app/_components/DataSourceBadge.tsx`
- **Fix steps:**
  1. Create shared RefreshErrorState (message + Retry calling router.refresh()).
  2. In ModuleListTable render it when provenance==='error-no-data' instead of EmptyState and suppress the badge in that case.
  3. Keep EmptyState only for provenance live with zero rows.
- **Acceptance:**
  - Component test: provenance error-no-data shows retry, not 'No records'.
  - Component test: live + empty shows EmptyState.
  - Manual: Retry re-fetches.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared table used app-wide; run its tests.
- **Depends on:** RefreshErrorState

### GAP-TENANT-DATA-MIGRATION-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** Same generic ModuleListTable limits.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Same as GAP-TENANT-CODE-LISTS-05.
- **Acceptance:**
  - Same as GAP-TENANT-CODE-LISTS-05.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table.
- **Depends on:** GAP-TENANT-CODE-LISTS-05

### GAP-TENANT-DATA-MIGRATION-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): w2-pages-i18n.test.tsx)
- **First-pass claim:** Title 'Tenant — Data Migration' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Organisation data migrations and reconciliation jobs.".
- **Verified evidence:** data-migration/page.tsx title hard-coded with banned 'Tenant' (labels.ts:30).
- **Files to change:** `apps/web/src/app/(app)/tenant/data-migration/page.tsx`
- **Fix steps:**
  1. Use next-intl keys and 'Office'/'Organisation' wording.
- **Acceptance:**
  - Banned-terms test passes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /tenant/org-hierarchy  —  `tenant/org-hierarchy.html`

- **Source:** `apps/web/src/app/(app)/tenant/org-hierarchy/page.tsx`
- **Design reference:** `redesign/tenant/org-hierarchy.html`

### GAP-TENANT-ORG-HIERARCHY-01  ·  HIGH  ·  interim  ·  theme WIRING

- [~] **Status** (INTERIM — INTERIM — flat indented table shown; real tree needs API shape confirmation or redirect decision)
- **W0 note:** partly fixed by #1916 — mapOrgHierarchyRows computes depth/indent from parentId; still flat table, no tree component
- **First-pass claim:** Hub note promises 'Organisation units and subtree views' (tenant/page.tsx:13) but the route is a flat table: parentId / children are not mapped (tenant/_data.ts:32-75), so the hierarchy — the point of the page — cannot be seen.
- **Verified evidence:** tenant/page.tsx:13 note is 'Organisation units and subtree views'. Page renders ModuleListPage (flat table). mapTenantRows (_data.ts:32-75) reads only id/label/sublabel/status/meta - parentId, children, level are never read, so hierarchy is not shown. Payload shape of /api/v1/tenant/org/hierarchy (_data.ts:90) cannot be verified: tenant-service is absent. Note a working hierarchy screen already exists at tenant-admin/org-hierarchy/page.tsx using getOrgHierarchy (loaders.ts:4665, OrgHierarchyNode).
- **Files to change:** `apps/web/src/app/(app)/tenant/org-hierarchy/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant-admin/org-hierarchy/page.tsx`
- **Fix steps:**
  1. Confirm tenant-service response shape for /api/v1/tenant/org/hierarchy (parentId or nested children).
  2. Add a dedicated mapper (mapOrgNodes) in _data.ts that keeps parentId/children and builds depth.
  3. Render an indented tree (reuse the tenant-admin/org-hierarchy rendering or a shared <OrgTree>) instead of ModuleListPage.
  4. Or, if not needed, reword the hub note and redirect to /tenant-admin/org-hierarchy.
- **Acceptance:**
  - Test: mapper given nested children returns rows with depth 0..n.
  - Manual: child units appear indented under their parent.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low read-only; risk is mismatching the API shape.
- **Depends on:** GAP-TENANT-HOME-02

### GAP-TENANT-ORG-HIERARCHY-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1801): ModuleListTable.showid.test.tsx + ModuleListTable.test.tsx slug-id test)
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:40 header 'ID' and :50 renders <span className="mono">{row.id.slice(0, 8)}</span>. Shared by every ModuleListPage screen; mapTenantRows (_data.ts:36-43) falls back to key/code/resource/`row-N` as id so truncation is lossy.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx drop the ID column (line 40) and the <td> at line 50 that renders row.id.slice(0, 8).
  2. Keep row.id only as React key and as a link target; show row.label as the first column.
  3. If a business code exists, map it in tenant/_data.ts mapTenantRows and render it as its own 'Code' column instead of a truncated UUID.
  4. If an id must stay visible (support), render the full id in a copyable, title-attributed mono span behind a 'Details' toggle.
- **Acceptance:**
  - Component test: row {id:'storage_gb'} and {id:'storage_backup_gb'} render distinct visible text (no 'storage_' twice).
  - Manual: /tenant/<page> shows no 8-char id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component so all ModuleListPage screens across modules change at once - check other modules' tests/snapshots.
- **Depends on:** ModuleListTable

### GAP-TENANT-ORG-HIERARCHY-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps loader source to 'error'|'api' (LoaderSource is already only those two, so the 'collapses cache/fallback' wording is loose; cache fallback happens later inside useSeededResource). ModuleListTable.tsx:33 shows DataSourceBadge ('Couldn't load — showing nothing' for provenance error-no-data, DataSourceBadge.tsx) and :34-36 shows EmptyState 'No records / Nothing to show yet' whenever data.length===0, regardless of provenance. No retry control. RefreshErrorState exists (ds/RefreshErrorState.tsx) but is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Change ModuleListPage.tsx:28 to pass the loader source through unchanged and, when source==='error' and no cached rows, render <RefreshErrorState error={toHumanError(...)} backHref='/tenant'> (ds/RefreshErrorState.tsx, client wrapper using router.refresh()).
  2. In ModuleListTable.tsx, branch on provenance==='error-no-data' (from useSeededResource) before the data.length===0 EmptyState at line 34-36 and render the error state with Retry instead of 'No records'.
  3. Keep the cached-provenance path (DataSourceBadge 'Showing saved data') unchanged.
  4. Reserve the 'No records' EmptyState for provenance==='live' with an empty array.
- **Acceptance:**
  - Component test: useSeededResource returns provenance 'error-no-data' and data [] -> renders Retry button, not 'No records'.
  - Test: source 'api' with [] -> 'No records' EmptyState and no badge.
  - Manual: block /api/v1/tenant/<endpoint>, load page, click Retry, data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but shared by all ModuleListPage screens - verify offline-cache behaviour (UX-002) still holds.
- **Depends on:** RefreshErrorState, ModuleListTable

### GAP-TENANT-ORG-HIERARCHY-05  ·  LOW  ·  partly  ·  theme UX-TABLE (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare <table> with no search, sort or pagination and status is a plain {row.status ?? "—"} (line 53) - true. The 'capped fetch / server-side pagination' remedy is not verifiable: tenant-service is absent and tenantLoader (_data.ts:78-85) sends no limit/offset. The lists here are small reference sets, so severity is low. Also 'DS DataTable used on the tokens page' could not be pinned to a tokens page; DataTable is used in tenant-admin/settings and metadata pages.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the plain <table className="tbl"> in ModuleListTable.tsx with the DS <DataTable> (ds/DataTable.tsx) using columns Name/Detail/Status/Meta.
  2. Render status through <StatusPill> (used in tenant-admin/subscription/page.tsx) with a label map so raw values become readable.
  3. Add client search and sort for the small tenant lists; add a page-size control only if the tenant-service list endpoints paginate (cannot verify - service absent).
  4. Do not add client filtering over a capped fetch; if server pagination exists, pass page/pageSize/query through tenantLoader in _data.ts.
- **Acceptance:**
  - Component test: table rows can be sorted by Name and filtered by search text.
  - Status cell renders a StatusPill with text, not raw snake_case.
  - Manual: >50 rows paginate (only if API supports it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, keep ModuleListPage consumers in other modules working.
- **Depends on:** ModuleListTable

### GAP-TENANT-ORG-HIERARCHY-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0-10 note:** review found the W0 tick partly — banned term removed via LABELS.tenantTitle ("Office") but tenant/org-hierarchy/page.tsx:16-17 still hard-coded English, no getTranslations/next-intl keys (fix step 1, locale-switch acceptance) and no banned-term test (step 3)
- **First-pass claim:** Title 'Tenant — Org Hierarchy' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Organisation units and hierarchy nodes.".
- **Verified evidence:** page.tsx title="Tenant — Org Hierarchy" and description are hard-coded English; 'tenant' is banned (lib/labels.ts:30). Theme FABRICATED is wrong: no sample figures.
- **Files to change:** `apps/web/src/app/(app)/tenant/org-hierarchy/page.tsx`
- **Fix steps:**
  1. Add next-intl keys and use getTranslations.
  2. Use 'Office' via LABELS.tenantTitle.
  3. Add banned-term test.
- **Acceptance:**
  - Heading has no banned term.
  - Locale switch translates title.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant/overview  —  `tenant/overview.html`

- **Source:** `apps/web/src/app/(app)/tenant/overview/page.tsx`
- **Design reference:** `redesign/tenant/overview.html`

### GAP-TENANT-OVERVIEW-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): apps/web/src/app/(app)/tenant/_data.test.ts mapOverviewRows (labelled name/edition/type/residency))
- **First-pass claim:** Hub note promises 'Current tenant profile and isolation posture' (tenant/page.tsx:11) but the payload is flattened to one row: id, name, type, status, code only (tenant/_data.ts:36-64). Isolation posture, edition and residency can never be shown.
- **Verified evidence:** tenant/page.tsx:11 note 'Current tenant profile and isolation posture'. mapTenantRows (_data.ts:32-75) flattens to id,label,sublabel(description/type/category/planName/value),status,meta(code/unit/...); edition, residency, isolation are never read. Real field names of /api/v1/tenant/current (_data.ts:87) cannot be verified - tenant-service absent - so 'can never be shown' is true of the current mapper only.
- **Files to change:** `apps/web/src/app/(app)/tenant/overview/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`
- **Fix steps:**
  1. Get response schema of GET /api/v1/tenant/current from tenant-service.
  2. Add a zod-validated profile schema at the boundary (CLAUDE.md rule) and a getTenantProfile loader returning a typed object.
  3. Render with DS Card + key/value list (name, type, status, code, edition, residency, isolation) instead of a one-row list.
  4. Or reword the hub note if the API lacks the fields.
- **Acceptance:**
  - Unit test: schema parses sample payload and rejects missing name.
  - Manual: /tenant/overview shows labelled fields.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; isolation/residency wording must be approved by product.

### GAP-TENANT-OVERVIEW-02  ·  MEDIUM  ·  partly  ·  theme WIRING (was UUID)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): _data.test.ts mapOverviewRows ('shows Unnamed when the tenant name is absent (never the raw UUID)'))
- **First-pass claim:** extractRows wraps any non-array object as [payload] (tenant/_data.ts:28-29), so the profile is a one-row 'list'; label falls back to the raw id when name/title are absent (_data.ts:44-52).
- **Verified evidence:** _data.ts:28-29: object payloads that are not wrapped in data/items/etc. become [payload], so the profile is a one-row list - true and deliberate for single-object endpoints. Label falls back to raw id at _data.ts:44-52 (name, title, label, key, resource, code, domain, then id) - true but only when all of those are absent. Theme UUID is a stretch: no ids are typed by users.
- **Files to change:** `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/overview/page.tsx`
- **Fix steps:**
  1. Add a dedicated single-object loader for overview (see OVERVIEW-01) rather than routing through extractRows.
  2. Drop the raw-id label fallback: use '—' or 'Unnamed' so a UUID is never shown as a name.
- **Acceptance:**
  - Test: payload without name renders '—' not the id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-TENANT-OVERVIEW-01

### GAP-TENANT-OVERVIEW-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1801): ModuleListTable.showid.test.tsx)
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:40 header 'ID' and :50 renders <span className="mono">{row.id.slice(0, 8)}</span>. Shared by every ModuleListPage screen; mapTenantRows (_data.ts:36-43) falls back to key/code/resource/`row-N` as id so truncation is lossy.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx drop the ID column (line 40) and the <td> at line 50 that renders row.id.slice(0, 8).
  2. Keep row.id only as React key and as a link target; show row.label as the first column.
  3. If a business code exists, map it in tenant/_data.ts mapTenantRows and render it as its own 'Code' column instead of a truncated UUID.
  4. If an id must stay visible (support), render the full id in a copyable, title-attributed mono span behind a 'Details' toggle.
- **Acceptance:**
  - Component test: row {id:'storage_gb'} and {id:'storage_backup_gb'} render distinct visible text (no 'storage_' twice).
  - Manual: /tenant/<page> shows no 8-char id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component so all ModuleListPage screens across modules change at once - check other modules' tests/snapshots.
- **Depends on:** ModuleListTable

### GAP-TENANT-OVERVIEW-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps loader source to 'error'|'api' (LoaderSource is already only those two, so the 'collapses cache/fallback' wording is loose; cache fallback happens later inside useSeededResource). ModuleListTable.tsx:33 shows DataSourceBadge ('Couldn't load — showing nothing' for provenance error-no-data, DataSourceBadge.tsx) and :34-36 shows EmptyState 'No records / Nothing to show yet' whenever data.length===0, regardless of provenance. No retry control. RefreshErrorState exists (ds/RefreshErrorState.tsx) but is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Change ModuleListPage.tsx:28 to pass the loader source through unchanged and, when source==='error' and no cached rows, render <RefreshErrorState error={toHumanError(...)} backHref='/tenant'> (ds/RefreshErrorState.tsx, client wrapper using router.refresh()).
  2. In ModuleListTable.tsx, branch on provenance==='error-no-data' (from useSeededResource) before the data.length===0 EmptyState at line 34-36 and render the error state with Retry instead of 'No records'.
  3. Keep the cached-provenance path (DataSourceBadge 'Showing saved data') unchanged.
  4. Reserve the 'No records' EmptyState for provenance==='live' with an empty array.
- **Acceptance:**
  - Component test: useSeededResource returns provenance 'error-no-data' and data [] -> renders Retry button, not 'No records'.
  - Test: source 'api' with [] -> 'No records' EmptyState and no badge.
  - Manual: block /api/v1/tenant/<endpoint>, load page, click Retry, data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but shared by all ModuleListPage screens - verify offline-cache behaviour (UX-002) still holds.
- **Depends on:** RefreshErrorState, ModuleListTable

### GAP-TENANT-OVERVIEW-06  ·  LOW  ·  partly  ·  theme UX-TABLE (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare <table> with no search, sort or pagination and status is a plain {row.status ?? "—"} (line 53) - true. The 'capped fetch / server-side pagination' remedy is not verifiable: tenant-service is absent and tenantLoader (_data.ts:78-85) sends no limit/offset. The lists here are small reference sets, so severity is low. A single-record profile does not need search/sort/pagination at all; better solved by OVERVIEW-01.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the plain <table className="tbl"> in ModuleListTable.tsx with the DS <DataTable> (ds/DataTable.tsx) using columns Name/Detail/Status/Meta.
  2. Render status through <StatusPill> (used in tenant-admin/subscription/page.tsx) with a label map so raw values become readable.
  3. Add client search and sort for the small tenant lists; add a page-size control only if the tenant-service list endpoints paginate (cannot verify - service absent).
  4. Do not add client filtering over a capped fetch; if server pagination exists, pass page/pageSize/query through tenantLoader in _data.ts.
- **Acceptance:**
  - Component test: table rows can be sorted by Name and filtered by search text.
  - Status cell renders a StatusPill with text, not raw snake_case.
  - Manual: >50 rows paginate (only if API supports it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, keep ModuleListPage consumers in other modules working.
- **Depends on:** ModuleListTable

### GAP-TENANT-OVERVIEW-07  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1923 — Uses LABELS.tenantTitle (Office), banned term gone; title/subtitle still hard-coded English, not next-intl
- **First-pass claim:** Title 'Tenant — Overview' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Current tenant profile from tenant-service.".
- **Verified evidence:** page.tsx (title prop) hard-codes title="Tenant — Overview" and the description string; no useTranslations in these pages although 423 of 829 page files elsewhere use next-intl. lib/labels.ts:30 lists 'tenant' in BANNED_CLERK_TERMS (LABELS.tenant='office', lib/labels.ts:11), and the page title contains it. Subtitle 'Current tenant profile from tenant-service.' is accurate copy but also hard-coded. Subtitle also names 'tenant-service' (internal service name) which is clerk-facing jargon.
- **Files to change:** `apps/web/src/app/(app)/tenant/overview/page.tsx`
- **Fix steps:**
  1. Add next-intl keys (e.g. tenant.<page>.title/subtitle) in the messages files and use getTranslations in the page.
  2. Replace the 'Tenant —' prefix with LABELS.tenantTitle ('Office') e.g. 'Office — <Page>'.
  3. Run findBannedTerms (lib/labels.ts) over the new strings in a unit test.
- **Acceptance:**
  - Unit test: rendered heading contains no banned term (case-insensitive).
  - Manual: switch locale to hi -> title translated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant/plans  —  `tenant/plans.html`

- **Source:** `apps/web/src/app/(app)/tenant/plans/page.tsx`
- **Design reference:** `redesign/tenant/plans.html`

### GAP-TENANT-PLANS-01  ·  HIGH  ·  partly  ·  theme WIRING (was MONEY)

- [x] **Status** (W2 PQ: closed — mapPlanRows now shows up to 5 module names joined by comma (e.g. 'hrms, finance, procurement'), with '+N more' overflow; test updated in _data.test.ts to assert names not count (GAP-TENANT-PLANS-01))
- **First-pass claim:** Subtitle promises 'pricing and module entitlements' (plans/page.tsx:16) but neither is mapped: only description, planName-as-type and currency survive (tenant/_data.ts:53-65). A plans page with no prices and no feature comparison (hub note: 'feature comparison').
- **Verified evidence:** plans/page.tsx description promises 'pricing and module entitlements'. mapTenantRows maps only description/type/category/planName -> sublabel (planName is a fallback after description/type/category, not 'type'), and meta = code ?? unit ?? usagePercent ?? limit ?? currency (_data.ts:60-65) - price, modules, features are not read; meta may show only a currency code. True no price/feature comparison. Field names in /api/v1/tenant/plans (_data.ts:100) cannot be verified: tenant-service absent. If price is returned in paise it must be formatted with formatINR per CLAUDE.md.
- **Files to change:** `apps/web/src/app/(app)/tenant/plans/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`
- **Fix steps:**
  1. Get plan schema from tenant-service; zod-validate at the boundary in a getTenantPlans mapper.
  2. Map price as integer paise and modules[] as string[]; never float.
  3. Render price via formatINR (lib/formatters) and entitlements as a list/chips; consider reusing tenant-admin/plans/PlansClient and getPlansData (loaders.ts:4598, /api/v1/billing/plans).
  4. Or drop 'pricing' from the subtitle if the API has none.
- **Acceptance:**
  - Test: price 149900 renders '₹1,499.00'.
  - Plans with modules show each module name.
  - No Number() division of money.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Money display; wrong unit assumption (paise vs rupees) would misstate prices by 100x - confirm with API contract.
- **Depends on:** GAP-TENANT-HOME-02

### GAP-TENANT-PLANS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant: closed by #2060; apps/web ModuleListTable.showid.test.tsx (showId={false} hides the ID column; time-ordered UUIDs sharing an 8-char prefix are no longer rendered) + every tenant page passes showId={false})
- **W0 note:** partly fixed by #1801 — Slug ids shown in full; UUID ids still sliced to 8 chars in ID column, column not dropped
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:40 header 'ID' and :50 renders <span className="mono">{row.id.slice(0, 8)}</span>. Shared by every ModuleListPage screen; mapTenantRows (_data.ts:36-43) falls back to key/code/resource/`row-N` as id so truncation is lossy.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx drop the ID column (line 40) and the <td> at line 50 that renders row.id.slice(0, 8).
  2. Keep row.id only as React key and as a link target; show row.label as the first column.
  3. If a business code exists, map it in tenant/_data.ts mapTenantRows and render it as its own 'Code' column instead of a truncated UUID.
  4. If an id must stay visible (support), render the full id in a copyable, title-attributed mono span behind a 'Details' toggle.
- **Acceptance:**
  - Component test: row {id:'storage_gb'} and {id:'storage_backup_gb'} render distinct visible text (no 'storage_' twice).
  - Manual: /tenant/<page> shows no 8-char id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component so all ModuleListPage screens across modules change at once - check other modules' tests/snapshots.
- **Depends on:** ModuleListTable

### GAP-TENANT-PLANS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps loader source to 'error'|'api' (LoaderSource is already only those two, so the 'collapses cache/fallback' wording is loose; cache fallback happens later inside useSeededResource). ModuleListTable.tsx:33 shows DataSourceBadge ('Couldn't load — showing nothing' for provenance error-no-data, DataSourceBadge.tsx) and :34-36 shows EmptyState 'No records / Nothing to show yet' whenever data.length===0, regardless of provenance. No retry control. RefreshErrorState exists (ds/RefreshErrorState.tsx) but is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Change ModuleListPage.tsx:28 to pass the loader source through unchanged and, when source==='error' and no cached rows, render <RefreshErrorState error={toHumanError(...)} backHref='/tenant'> (ds/RefreshErrorState.tsx, client wrapper using router.refresh()).
  2. In ModuleListTable.tsx, branch on provenance==='error-no-data' (from useSeededResource) before the data.length===0 EmptyState at line 34-36 and render the error state with Retry instead of 'No records'.
  3. Keep the cached-provenance path (DataSourceBadge 'Showing saved data') unchanged.
  4. Reserve the 'No records' EmptyState for provenance==='live' with an empty array.
- **Acceptance:**
  - Component test: useSeededResource returns provenance 'error-no-data' and data [] -> renders Retry button, not 'No records'.
  - Test: source 'api' with [] -> 'No records' EmptyState and no badge.
  - Manual: block /api/v1/tenant/<endpoint>, load page, click Retry, data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but shared by all ModuleListPage screens - verify offline-cache behaviour (UX-002) still holds.
- **Depends on:** RefreshErrorState, ModuleListTable

### GAP-TENANT-PLANS-05  ·  LOW  ·  partly  ·  theme UX-TABLE (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare <table> with no search, sort or pagination and status is a plain {row.status ?? "—"} (line 53) - true. The 'capped fetch / server-side pagination' remedy is not verifiable: tenant-service is absent and tenantLoader (_data.ts:78-85) sends no limit/offset. The lists here are small reference sets, so severity is low.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the plain <table className="tbl"> in ModuleListTable.tsx with the DS <DataTable> (ds/DataTable.tsx) using columns Name/Detail/Status/Meta.
  2. Render status through <StatusPill> (used in tenant-admin/subscription/page.tsx) with a label map so raw values become readable.
  3. Add client search and sort for the small tenant lists; add a page-size control only if the tenant-service list endpoints paginate (cannot verify - service absent).
  4. Do not add client filtering over a capped fetch; if server pagination exists, pass page/pageSize/query through tenantLoader in _data.ts.
- **Acceptance:**
  - Component test: table rows can be sorted by Name and filtered by search text.
  - Status cell renders a StatusPill with text, not raw snake_case.
  - Manual: >50 rows paginate (only if API supports it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, keep ModuleListPage consumers in other modules working.
- **Depends on:** ModuleListTable

### GAP-TENANT-PLANS-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1916 — Banned Tenant term replaced by LABELS.tenantTitle; page title still hard-coded English, no next-intl
- **First-pass claim:** Title 'Tenant — Plans' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Available plans with pricing and module entitlements.".
- **Verified evidence:** page.tsx (title prop) hard-codes title="Tenant — Plans" and the description string; no useTranslations in these pages although 423 of 829 page files elsewhere use next-intl. lib/labels.ts:30 lists 'tenant' in BANNED_CLERK_TERMS (LABELS.tenant='office', lib/labels.ts:11), and the page title contains it. Subtitle 'Available plans with pricing and module entitlements.' is accurate copy but also hard-coded. Subtitle promises pricing that is not mapped (see PLANS-01).
- **Files to change:** `apps/web/src/app/(app)/tenant/plans/page.tsx`
- **Fix steps:**
  1. Add next-intl keys (e.g. tenant.<page>.title/subtitle) in the messages files and use getTranslations in the page.
  2. Replace the 'Tenant —' prefix with LABELS.tenantTitle ('Office') e.g. 'Office — <Page>'.
  3. Run findBannedTerms (lib/labels.ts) over the new strings in a unit test.
- **Acceptance:**
  - Unit test: rendered heading contains no banned term (case-insensitive).
  - Manual: switch locale to hi -> title translated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant/positions  —  `tenant/positions.html`

- **Source:** `apps/web/src/app/(app)/tenant/positions/page.tsx`
- **Design reference:** `redesign/tenant/positions.html`

### GAP-TENANT-POSITIONS-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): _data.test.ts mapPositionRows ('Vacant' when filled strength is 0). The 'roles list' criterion is superseded: the positions payload carries no role bindings and the page subtitle no longer promises them)
- **First-pass claim:** Subtitle promises 'role bindings' but none are mapped (tenant/_data.ts:32-75); incumbent and roles never appear. Position title shows as Name and the code as Meta, with no vacancy indicator beyond raw status text.
- **Verified evidence:** Subtitle 'Position master records and role bindings.' Mapper (_data.ts:32-75) reads none of incumbent/roles/vacant; title -> label (name/title first), code -> meta (meta = code first), status -> raw text. All true for the current mapper. Real /api/v1/tenant/positions fields (_data.ts:95) cannot be verified: tenant-service absent.
- **Files to change:** `apps/web/src/app/(app)/tenant/positions/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`
- **Fix steps:**
  1. Confirm schema (incumbent, roles[], vacant flag) from tenant-service.
  2. Add a mapPositions mapper with zod at the boundary and columns Title, Code, Incumbent, Roles, Status.
  3. Show a Vacant StatusPill when no incumbent.
  4. Otherwise remove 'role bindings' from the subtitle.
- **Acceptance:**
  - Test: position without incumbent renders 'Vacant'.
  - Roles list shows names, not ids.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** PII: incumbent names are personal data - respect role visibility/masking.

### GAP-TENANT-POSITIONS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant: closed by #2060; apps/web ModuleListTable.showid.test.tsx (showId={false} hides the ID column; time-ordered UUIDs sharing an 8-char prefix are no longer rendered) + every tenant page passes showId={false})
- **W0 note:** partly fixed by #1801 — Slug ids full; UUID ids still sliced to 8 chars, ID column retained
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:40 header 'ID' and :50 renders <span className="mono">{row.id.slice(0, 8)}</span>. Shared by every ModuleListPage screen; mapTenantRows (_data.ts:36-43) falls back to key/code/resource/`row-N` as id so truncation is lossy.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx drop the ID column (line 40) and the <td> at line 50 that renders row.id.slice(0, 8).
  2. Keep row.id only as React key and as a link target; show row.label as the first column.
  3. If a business code exists, map it in tenant/_data.ts mapTenantRows and render it as its own 'Code' column instead of a truncated UUID.
  4. If an id must stay visible (support), render the full id in a copyable, title-attributed mono span behind a 'Details' toggle.
- **Acceptance:**
  - Component test: row {id:'storage_gb'} and {id:'storage_backup_gb'} render distinct visible text (no 'storage_' twice).
  - Manual: /tenant/<page> shows no 8-char id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component so all ModuleListPage screens across modules change at once - check other modules' tests/snapshots.
- **Depends on:** ModuleListTable

### GAP-TENANT-POSITIONS-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps loader source to 'error'|'api' (LoaderSource is already only those two, so the 'collapses cache/fallback' wording is loose; cache fallback happens later inside useSeededResource). ModuleListTable.tsx:33 shows DataSourceBadge ('Couldn't load — showing nothing' for provenance error-no-data, DataSourceBadge.tsx) and :34-36 shows EmptyState 'No records / Nothing to show yet' whenever data.length===0, regardless of provenance. No retry control. RefreshErrorState exists (ds/RefreshErrorState.tsx) but is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Change ModuleListPage.tsx:28 to pass the loader source through unchanged and, when source==='error' and no cached rows, render <RefreshErrorState error={toHumanError(...)} backHref='/tenant'> (ds/RefreshErrorState.tsx, client wrapper using router.refresh()).
  2. In ModuleListTable.tsx, branch on provenance==='error-no-data' (from useSeededResource) before the data.length===0 EmptyState at line 34-36 and render the error state with Retry instead of 'No records'.
  3. Keep the cached-provenance path (DataSourceBadge 'Showing saved data') unchanged.
  4. Reserve the 'No records' EmptyState for provenance==='live' with an empty array.
- **Acceptance:**
  - Component test: useSeededResource returns provenance 'error-no-data' and data [] -> renders Retry button, not 'No records'.
  - Test: source 'api' with [] -> 'No records' EmptyState and no badge.
  - Manual: block /api/v1/tenant/<endpoint>, load page, click Retry, data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but shared by all ModuleListPage screens - verify offline-cache behaviour (UX-002) still holds.
- **Depends on:** RefreshErrorState, ModuleListTable

### GAP-TENANT-POSITIONS-05  ·  LOW  ·  partly  ·  theme UX-TABLE (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05 + positions/page.test.tsx)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare <table> with no search, sort or pagination and status is a plain {row.status ?? "—"} (line 53) - true. The 'capped fetch / server-side pagination' remedy is not verifiable: tenant-service is absent and tenantLoader (_data.ts:78-85) sends no limit/offset. The lists here are small reference sets, so severity is low.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the plain <table className="tbl"> in ModuleListTable.tsx with the DS <DataTable> (ds/DataTable.tsx) using columns Name/Detail/Status/Meta.
  2. Render status through <StatusPill> (used in tenant-admin/subscription/page.tsx) with a label map so raw values become readable.
  3. Add client search and sort for the small tenant lists; add a page-size control only if the tenant-service list endpoints paginate (cannot verify - service absent).
  4. Do not add client filtering over a capped fetch; if server pagination exists, pass page/pageSize/query through tenantLoader in _data.ts.
- **Acceptance:**
  - Component test: table rows can be sorted by Name and filtered by search text.
  - Status cell renders a StatusPill with text, not raw snake_case.
  - Manual: >50 rows paginate (only if API supports it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, keep ModuleListPage consumers in other modules working.
- **Depends on:** ModuleListTable

### GAP-TENANT-POSITIONS-06  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1916 — LABELS.tenantTitle used (no banned term); title still hard-coded English, not next-intl
- **First-pass claim:** Title 'Tenant — Positions' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Position master records and role bindings.".
- **Verified evidence:** page.tsx (title prop) hard-codes title="Tenant — Positions" and the description string; no useTranslations in these pages although 423 of 829 page files elsewhere use next-intl. lib/labels.ts:30 lists 'tenant' in BANNED_CLERK_TERMS (LABELS.tenant='office', lib/labels.ts:11), and the page title contains it. Subtitle 'Position master records and role bindings.' is accurate copy but also hard-coded. Subtitle promises role bindings that are not mapped (see POSITIONS-01).
- **Files to change:** `apps/web/src/app/(app)/tenant/positions/page.tsx`
- **Fix steps:**
  1. Add next-intl keys (e.g. tenant.<page>.title/subtitle) in the messages files and use getTranslations in the page.
  2. Replace the 'Tenant —' prefix with LABELS.tenantTitle ('Office') e.g. 'Office — <Page>'.
  3. Run findBannedTerms (lib/labels.ts) over the new strings in a unit test.
- **Acceptance:**
  - Unit test: rendered heading contains no banned term (case-insensitive).
  - Manual: switch locale to hi -> title translated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant/quotas  —  `tenant/quotas.html`

- **Source:** `apps/web/src/app/(app)/tenant/quotas/page.tsx`
- **Design reference:** `redesign/tenant/quotas.html`

### GAP-TENANT-QUOTAS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was MONEY)

- [x] **Status** (W2 PQ: already fixed on main - tenant/_data.ts mapQuotaRows maps used/limit/percent from /api/v1/tenant/usage, tests in tenant/_data.test.ts; tenant-service returns no unit field so none is shown; verified in #2036)
- **W0-10 note:** review found the W0 tick partly — mapQuotaRows (tenant/_data.ts:111-139) maps used/limit/percent with zod, shows "40 / 100" + "40%" and "—" when unknown; but no progress bar (fix step 2) and unit is dropped (schema :97-107 has no unit, so "40 / 100 GB" acceptance not met).
- **First-pass claim:** The page exists to show consumption vs limit, but the mapper picks meta = code ?? unit ?? usagePercent ?? limit ?? currency (tenant/_data.ts:60-65): whenever a unit is present, usagePercent and limit are dropped, and 'used' is never mapped. The table can list resource names with no numbers at all.
- **Verified evidence:** _data.ts:60-65: meta = toText(row.code) ?? toText(row.unit) ?? (number usagePercent -> 'N%') ?? (number limit -> 'limit N') ?? toText(row.currency). Since toText stringifies numbers, first defined of code/unit wins and usagePercent/limit are dropped when unit is present; 'used'/'consumed' is never read. Not really MONEY (quota counts, not currency) though a unit can be storage. Real fields of /api/v1/tenant/usage (_data.ts:88) cannot be verified: tenant-service absent (tenant-admin/usage uses getUsageQuotas with UsageResource, loaders.ts:4549, /api/v1/admin/usage).
- **Files to change:** `apps/web/src/app/(app)/tenant/quotas/page.tsx`, `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant-admin/usage/UsageDisplay.tsx`
- **Fix steps:**
  1. Add mapQuotaRows in _data.ts producing {resource, used, limit, unit, percent} with zod at the boundary.
  2. Render a Used / Limit column and a progress bar (reuse tenant-admin/usage/UsageDisplay or a shared component).
  3. Compute percent from used/limit if usagePercent absent; show '—' when unknown.
  4. Do not treat storage units as money.
- **Acceptance:**
  - Test: {resource:'storage_gb',unit:'GB',used:40,limit:100,usagePercent:40} shows '40 / 100 GB' and 40%.
  - Row with unit but no numbers shows '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; ensure units and percent are consistent.
- **Depends on:** GAP-TENANT-QUOTAS-02

### GAP-TENANT-QUOTAS-02  ·  MEDIUM  ·  confirmed  ·  theme STATUS (was OTHER)

- [x] **Status** (W2 tenant: closed by #2060; QuotaStatusPill (ds/StatusPill.tsx) renders amber/red tones, an aria-hidden icon + text for near limit and exceeded, and sentence-case fallback (foo_bar -> Foo bar), scoped to the quotas page via ModuleListPage statusStyle=quota so humanizeStatus is unchanged elsewhere; asserted by apps/web/src/app/_components/ds/StatusPill.quota.test.tsx. Per-row highlight at threshold NOT built)
- **W0-10 note:** review found the W0 tick partly — tenant/_data.ts:126-130 emits "Near limit"/"Exceeded"/"OK" and StatusPill humanizes, but ds/StatusPill.tsx STATUS_MAP has no near limit/exceeded/ok keys so pill falls to default "info" blue (:508), not amber; no icon cue and no row highlight in ModuleListTable.tsx:66.
- **First-pass claim:** Status shows raw snake_case values such as near_limit (ModuleListTable.tsx:53) and there is no threshold colouring or warning.
- **Verified evidence:** ModuleListTable.tsx:53 renders {row.status ?? "—"} raw; mapTenantRows passes row.status/state unchanged (_data.ts:58), so near_limit (if returned) is shown verbatim, with no colour or warning. Whether the API emits near_limit cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/tenant/quotas/page.tsx`
- **Fix steps:**
  1. Create a status label/tone map (ok/near_limit/exceeded) and render with <StatusPill>.
  2. Also add a text/icon cue, not colour only.
  3. Humanise unknown snake_case values (replace _ with space, sentence case) as fallback.
  4. Highlight rows at or above threshold.
- **Acceptance:**
  - near_limit renders 'Near limit' with amber pill and icon.
  - Unknown value 'foo_bar' renders 'Foo bar'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** ModuleListTable

### GAP-TENANT-QUOTAS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1801, verified on main 9c5e9e9e9; W1 SF-01a re-confirmed on #2016: ids shown via shared formatShortId, slug ids such as storage_gb / storage_backup_gb render whole, covered by ModuleListTable.test.tsx)
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide (storage_gb and storage_backup_gb both show "storage_").
- **Verified evidence:** ModuleListTable.tsx:40 header 'ID' and :50 renders <span className="mono">{row.id.slice(0, 8)}</span>. Shared by every ModuleListPage screen; mapTenantRows (_data.ts:36-43) falls back to key/code/resource/`row-N` as id so truncation is lossy. The collision example is plausible: 'storage_gb'.slice(0,8) and 'storage_backup_gb'.slice(0,8) are both 'storage_'; the id falls back to row.resource (_data.ts:38).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx drop the ID column (line 40) and the <td> at line 50 that renders row.id.slice(0, 8).
  2. Keep row.id only as React key and as a link target; show row.label as the first column.
  3. If a business code exists, map it in tenant/_data.ts mapTenantRows and render it as its own 'Code' column instead of a truncated UUID.
  4. If an id must stay visible (support), render the full id in a copyable, title-attributed mono span behind a 'Details' toggle.
- **Acceptance:**
  - Component test: row {id:'storage_gb'} and {id:'storage_backup_gb'} render distinct visible text (no 'storage_' twice).
  - Manual: /tenant/<page> shows no 8-char id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared component so all ModuleListPage screens across modules change at once - check other modules' tests/snapshots.
- **Depends on:** ModuleListTable

### GAP-TENANT-QUOTAS-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListPage.tsx:28 maps loader source to 'error'|'api' (LoaderSource is already only those two, so the 'collapses cache/fallback' wording is loose; cache fallback happens later inside useSeededResource). ModuleListTable.tsx:33 shows DataSourceBadge ('Couldn't load — showing nothing' for provenance error-no-data, DataSourceBadge.tsx) and :34-36 shows EmptyState 'No records / Nothing to show yet' whenever data.length===0, regardless of provenance. No retry control. RefreshErrorState exists (ds/RefreshErrorState.tsx) but is unused here.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Change ModuleListPage.tsx:28 to pass the loader source through unchanged and, when source==='error' and no cached rows, render <RefreshErrorState error={toHumanError(...)} backHref='/tenant'> (ds/RefreshErrorState.tsx, client wrapper using router.refresh()).
  2. In ModuleListTable.tsx, branch on provenance==='error-no-data' (from useSeededResource) before the data.length===0 EmptyState at line 34-36 and render the error state with Retry instead of 'No records'.
  3. Keep the cached-provenance path (DataSourceBadge 'Showing saved data') unchanged.
  4. Reserve the 'No records' EmptyState for provenance==='live' with an empty array.
- **Acceptance:**
  - Component test: useSeededResource returns provenance 'error-no-data' and data [] -> renders Retry button, not 'No records'.
  - Test: source 'api' with [] -> 'No records' EmptyState and no badge.
  - Manual: block /api/v1/tenant/<endpoint>, load page, click Retry, data appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; but shared by all ModuleListPage screens - verify offline-cache behaviour (UX-002) still holds.
- **Depends on:** RefreshErrorState, ModuleListTable

### GAP-TENANT-QUOTAS-06  ·  LOW  ·  partly  ·  theme UX-TABLE (was CAP)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare <table> with no search, sort or pagination and status is a plain {row.status ?? "—"} (line 53) - true. The 'capped fetch / server-side pagination' remedy is not verifiable: tenant-service is absent and tenantLoader (_data.ts:78-85) sends no limit/offset. The lists here are small reference sets, so severity is low.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the plain <table className="tbl"> in ModuleListTable.tsx with the DS <DataTable> (ds/DataTable.tsx) using columns Name/Detail/Status/Meta.
  2. Render status through <StatusPill> (used in tenant-admin/subscription/page.tsx) with a label map so raw values become readable.
  3. Add client search and sort for the small tenant lists; add a page-size control only if the tenant-service list endpoints paginate (cannot verify - service absent).
  4. Do not add client filtering over a capped fetch; if server pagination exists, pass page/pageSize/query through tenantLoader in _data.ts.
- **Acceptance:**
  - Component test: table rows can be sorted by Name and filtered by search text.
  - Status cell renders a StatusPill with text, not raw snake_case.
  - Manual: >50 rows paginate (only if API supports it).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; shared component, keep ModuleListPage consumers in other modules working.
- **Depends on:** ModuleListTable

### GAP-TENANT-QUOTAS-07  ·  LOW  ·  confirmed  ·  theme I18N (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1916 — Banned term removed via LABELS.tenantTitle; title still hard-coded English, no next-intl
- **First-pass claim:** Title 'Tenant — Quotas & Usage' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Resource consumption and plan limits for this tenant.".
- **Verified evidence:** page.tsx (title prop) hard-codes title="Tenant — Quotas & Usage" and the description string; no useTranslations in these pages although 423 of 829 page files elsewhere use next-intl. lib/labels.ts:30 lists 'tenant' in BANNED_CLERK_TERMS (LABELS.tenant='office', lib/labels.ts:11), and the page title contains it. Subtitle 'Resource consumption and plan limits for this tenant.' is accurate copy but also hard-coded.
- **Files to change:** `apps/web/src/app/(app)/tenant/quotas/page.tsx`
- **Fix steps:**
  1. Add next-intl keys (e.g. tenant.<page>.title/subtitle) in the messages files and use getTranslations in the page.
  2. Replace the 'Tenant —' prefix with LABELS.tenantTitle ('Office') e.g. 'Office — <Page>'.
  3. Run findBannedTerms (lib/labels.ts) over the new strings in a unit test.
- **Acceptance:**
  - Unit test: rendered heading contains no banned term (case-insensitive).
  - Manual: switch locale to hi -> title translated.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /tenant/settings  —  `tenant/settings.html`

- **Source:** `apps/web/src/app/(app)/tenant/settings/page.tsx`
- **Design reference:** `redesign/tenant/settings.html`

### GAP-TENANT-SETTINGS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): _data.test.ts mapSettingRows (value with and without description))
- **First-pass claim:** Value is mixed into the Detail column and is replaced by description/type/category when those exist (tenant/_data.ts:53-58), so a setting's value may not be shown at all.
- **Verified evidence:** tenant/_data.ts:53-58 sublabel = description ?? type ?? category ?? planName ?? value, so value is shown only when none of the earlier fields exist; there is no separate Value column (ModuleListTable columns ID/Name/Detail/Status/Meta, :39-45). A setting that has a description hides its value. Setting payload shape not visible (tenant-service absent), but the precedence is real.
- **Files to change:** `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/settings/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In tenant/_data.ts create mapSettingRows for getTenantSettings (separate from mapTenantRows) that maps key->label, description->sublabel, value->meta.
  2. Optionally add `columns` prop to ModuleListTable/ModuleListPage so settings page labels Meta as 'Value'.
  3. Mask values for keys flagged secret/sensitive if the API exposes such a flag (cannot verify field).
  4. Unit test mapSettingRows with {key,value,description} asserting all three surface.
- **Acceptance:**
  - Setting with key, value and description shows value in the Value column and description in Detail.
  - Row without description still shows value.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Config values may be sensitive; do not print secrets in clear.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SETTINGS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W1 SF-01a: closed by #2016)
- **W0 note:** partly fixed by #1801 — Slug ids shown in full; settings with UUID id still sliced to 8 chars, ID column kept
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide (auth.session_timeout_min and auth.session_timeout_max both show "auth.ses").
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className="mono">{row.id.slice(0, 8)}</span> (file lines 37-55 hold the table). Ids come from mapper fallback chain (id/key/code/... then `row-N`), so long keys/UUIDs sharing a prefix display identically; <tr key={row.id}> at :47 would also duplicate if real ids collide. Collision example is plausible only if the settings payload has no `id` and the mapper falls back to `key` (tenant/_data.ts:37-39); payload not visible, so the specific example is unverified.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the ID column: drop `.slice(0, 8)`; show the full id in a mono, truncating via CSS (max-w + text-overflow) with title={row.id}.
  2. Better: hide the raw ID column entirely for clerks and lead with row.label; keep id as a copyable secondary/aria-label value (add optional `showId` prop on ModuleListTable defaulting false).
  3. Do not show synthetic `row-N` ids (mapper fallback); render "—" when id startsWith("row-").
  4. Add a component test in ModuleListTable.test.tsx with two rows 'auth.session_timeout_min' and 'auth.session_timeout_max' asserting they are distinguishable.
- **Acceptance:**
  - Rows with ids 'auth.session_timeout_min'/'auth.session_timeout_max' render distinct text (or no ID column).
  - Full id is available via title/tooltip.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component used by ~65 pages; visual change only, no money/PII.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SETTINGS-04  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx (router.refresh))
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListTable.tsx:50-51 renders DataSourceBadge with provenance from useSeededResource; DataSourceBadge.tsx:71 prints "Couldn't load — showing nothing" for provenance 'error-no-data', while ModuleListTable.tsx:34-35 (data.length===0) renders EmptyState 'No records / Nothing to show yet for this module.' in the same card, so a failure looks like an empty list. No retry action. Correction to observation: ModuleListPage.tsx:28 only maps LoaderSource ('api'|'error', apiClient.ts:6) to the same two values; the cache fallback is handled in useSeededResource (resource.ts:208-213, 'cached' provenance), not collapsed at :28. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx (props error,onBack,backHref,helpHref).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance: when provenance==='error-no-data' && data.length===0 render <RefreshErrorState error=... /> (or LoadErrorState) inside the Card instead of EmptyState, with a Retry that calls router.refresh() (page is force-dynamic).
  2. Keep EmptyState only for provenance==='live' with 0 rows; reword message per module via optional `emptyMessage` prop on ModuleListPage.
  3. Drop/replace the duplicate DataSourceBadge text in the error-no-data case so the card shows one message.
  4. Add component tests: (source='error', rows=[]) shows retry and no 'No records'; (source='api', rows=[]) shows 'No records'.
- **Acceptance:**
  - Mock fetch failure with empty cache: card shows error state + Retry, not 'No records'.
  - Successful empty response still shows 'No records'.
  - Retry click re-invokes loader (router.refresh called).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 list pages; must not hide legitimately empty results or cached-data banner.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SETTINGS-05  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05 + settings/page.test.tsx)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:36-55 renders a plain <table className="tbl"> with no search, sort or pagination and status as plain text ({row.status ?? "—"} at :54). themes/ThemeTokenTable.tsx:38 uses DS <DataTable> (app/_components/ds/DataTable.tsx:172, has filterable/exportable). The loader fetches with no page/limit params (tenant/_data.ts:77-83), so 'server-side pagination' would need backend contract; the supplied fix text about 'client-side filtering of a capped fetch' does not match this code (no client filtering exists).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the hand-rolled <table> in ModuleListTable.tsx with DS <DataTable<ModuleRowSummary>> using columns Name, Detail, Status, Meta and filterable enabled.
  2. Render Status via DS <StatusPill> instead of raw text.
  3. Only add server pagination once the tenant/theme endpoints document limit/offset/total; until then keep client-side sort/filter.
  4. Add a test that typing in the filter narrows rows and status renders a StatusPill.
- **Acceptance:**
  - Filter box narrows rows by label/detail.
  - Column header click sorts.
  - Status shows as pill with accessible text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 pages; bulk-visual change, verify offline cache seeding still works.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SETTINGS-06  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1916 — LABELS.tenantTitle + reworded subtitle; no next-intl keys, breadcrumb/title still hard-coded
- **First-pass claim:** Title 'Tenant — Settings' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Tenant-scoped configuration keys and values.".
- **Verified evidence:** page.tsx:15 has literal title and :16 the literal subtitle; page.tsx:12 breadcrumb also says 'Tenant'. lib/labels.ts:11 maps tenant->'Office' and :30 lists 'tenant' in BANNED_CLERK_TERMS, so the copy conflicts with the rule. Subtitle text matches observation. The catalogue fix text (remove sample figures) does not apply: nothing here is fabricated; the real issue is untranslated/banned wording.
- **Files to change:** `apps/web/src/app/(app)/tenant/settings/page.tsx`, `apps/web/src/lib/labels.ts`, `apps/web/messages/en.json`
- **Fix steps:**
  1. In the page.tsx use `getTranslations` from next-intl/server (pattern in app/(app)/admin/page.tsx:4,25) and add title/subtitle keys to the message catalogue.
  2. Use LABELS.tenantTitle ('Office', lib/labels.ts:11-12) instead of the literal 'Tenant' in title and breadcrumb (<a href="/tenant">Tenant</a> at line 12).
  3. Reword the subtitle without 'tenant' (e.g. 'Office configuration keys and values.').
  4. Run the BANNED_CLERK_TERMS unit test against the new strings.
- **Acceptance:**
  - Page renders 'Office — ...' title from catalogue.
  - BANNED_CLERK_TERMS test passes for page copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only. Confirm messages file location (not inspected).


---
## /tenant/stewardship  —  `tenant/stewardship.html`

- **Source:** `apps/web/src/app/(app)/tenant/stewardship/page.tsx`
- **Design reference:** `redesign/tenant/stewardship.html`

### GAP-TENANT-STEWARDSHIP-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): _data.test.ts mapStewardshipRows ('Unassigned'); ID column now hidden so no row-N ids are displayed (ModuleListTable.showid.test.tsx))
- **First-pass claim:** Subtitle promises 'assigned stewards' but no steward field is mapped (tenant/_data.ts:53-65): only the domain name, so accountability — the purpose of data governance — is invisible. IDs render as row-1, row-2 (fallback at _data.ts:43) when payloads lack id.
- **Verified evidence:** page.tsx:16 subtitle promises 'assigned stewards' and tenant/_data.ts:44-65 maps no steward/owner field (label = name/title/label/key/.../domain, sublabel = description/type/category/planName/value). Id fallback `row-N` exists at :43 but only when no id/resource/key/code/planId/subscriptionId. The steward field name in the /data-governance/domains response cannot be seen (tenant-service absent), so the mapping fix cannot be finalized.
- **Files to change:** `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/stewardship/page.tsx`
- **Fix steps:**
  1. Confirm the domain payload field for steward (e.g. steward/owner) from the tenant-service OpenAPI.
  2. Add mapStewardshipRows in tenant/_data.ts mapping domain->label, description->sublabel, steward->meta with 'Unassigned' when absent.
  3. Add a 'Steward' header via ModuleListTable `columns` prop, or reword subtitle to drop 'assigned stewards' until wired.
  4. Unit test mapper with and without steward.
- **Acceptance:**
  - Domain row shows steward name or 'Unassigned'.
  - No `row-N` ids displayed.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Accountability data; showing wrong field would mislead governance owners.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-STEWARDSHIP-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant: closed by #2060; apps/web ModuleListTable.showid.test.tsx (showId={false} hides the ID column; time-ordered UUIDs sharing an 8-char prefix are no longer rendered) + every tenant page passes showId={false})
- **W0 note:** partly fixed by #1801 — Slug ids full; UUID ids still sliced to 8 chars, ID column retained
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className="mono">{row.id.slice(0, 8)}</span> (file lines 37-55 hold the table). Ids come from mapper fallback chain (id/key/code/... then `row-N`), so long keys/UUIDs sharing a prefix display identically; <tr key={row.id}> at :47 would also duplicate if real ids collide.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the ID column: drop `.slice(0, 8)`; show the full id in a mono, truncating via CSS (max-w + text-overflow) with title={row.id}.
  2. Better: hide the raw ID column entirely for clerks and lead with row.label; keep id as a copyable secondary/aria-label value (add optional `showId` prop on ModuleListTable defaulting false).
  3. Do not show synthetic `row-N` ids (mapper fallback); render "—" when id startsWith("row-").
  4. Add a component test in ModuleListTable.test.tsx with two rows 'auth.session_timeout_min' and 'auth.session_timeout_max' asserting they are distinguishable.
- **Acceptance:**
  - Rows with ids 'auth.session_timeout_min'/'auth.session_timeout_max' render distinct text (or no ID column).
  - Full id is available via title/tooltip.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component used by ~65 pages; visual change only, no money/PII.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-STEWARDSHIP-03  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1862): apps/web/src/app/_components/ModuleListTable.test.tsx (retry/empty) + ds/RefreshErrorState.test.tsx)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListTable.tsx:50-51 renders DataSourceBadge with provenance from useSeededResource; DataSourceBadge.tsx:71 prints "Couldn't load — showing nothing" for provenance 'error-no-data', while ModuleListTable.tsx:34-35 (data.length===0) renders EmptyState 'No records / Nothing to show yet for this module.' in the same card, so a failure looks like an empty list. No retry action. Correction to observation: ModuleListPage.tsx:28 only maps LoaderSource ('api'|'error', apiClient.ts:6) to the same two values; the cache fallback is handled in useSeededResource (resource.ts:208-213, 'cached' provenance), not collapsed at :28. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx (props error,onBack,backHref,helpHref).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance: when provenance==='error-no-data' && data.length===0 render <RefreshErrorState error=... /> (or LoadErrorState) inside the Card instead of EmptyState, with a Retry that calls router.refresh() (page is force-dynamic).
  2. Keep EmptyState only for provenance==='live' with 0 rows; reword message per module via optional `emptyMessage` prop on ModuleListPage.
  3. Drop/replace the duplicate DataSourceBadge text in the error-no-data case so the card shows one message.
  4. Add component tests: (source='error', rows=[]) shows retry and no 'No records'; (source='api', rows=[]) shows 'No records'.
- **Acceptance:**
  - Mock fetch failure with empty cache: card shows error state + Retry, not 'No records'.
  - Successful empty response still shows 'No records'.
  - Retry click re-invokes loader (router.refresh called).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 list pages; must not hide legitimately empty results or cached-data banner.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-STEWARDSHIP-05  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05 + stewardship/page.test.tsx)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:36-55 renders a plain <table className="tbl"> with no search, sort or pagination and status as plain text ({row.status ?? "—"} at :54). themes/ThemeTokenTable.tsx:38 uses DS <DataTable> (app/_components/ds/DataTable.tsx:172, has filterable/exportable). The loader fetches with no page/limit params (tenant/_data.ts:77-83), so 'server-side pagination' would need backend contract; the supplied fix text about 'client-side filtering of a capped fetch' does not match this code (no client filtering exists).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the hand-rolled <table> in ModuleListTable.tsx with DS <DataTable<ModuleRowSummary>> using columns Name, Detail, Status, Meta and filterable enabled.
  2. Render Status via DS <StatusPill> instead of raw text.
  3. Only add server pagination once the tenant/theme endpoints document limit/offset/total; until then keep client-side sort/filter.
  4. Add a test that typing in the filter narrows rows and status renders a StatusPill.
- **Acceptance:**
  - Filter box narrows rows by label/detail.
  - Column header click sorts.
  - Status shows as pill with accessible text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 pages; bulk-visual change, verify offline cache seeding still works.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-STEWARDSHIP-06  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W2 tenant: closed by #2060; apps/web/src/app/(app)/tenant/w2-pages-i18n.test.tsx (title + subtitle + breadcrumb come from the tenantPages namespace; en/hi parity, hi differs from en, no banned term in en/hi strings or rendered heading))
- **W0 note:** partly fixed by #1916 — LABELS.tenantTitle used, subtitle reworded; still hard-coded English, no next-intl
- **First-pass claim:** Title 'Tenant — Stewardship' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Data governance domains and assigned stewards.".
- **Verified evidence:** page.tsx:15 has literal title and :16 the literal subtitle; page.tsx:12 breadcrumb also says 'Tenant'. lib/labels.ts:11 maps tenant->'Office' and :30 lists 'tenant' in BANNED_CLERK_TERMS, so the copy conflicts with the rule. Subtitle matches observation. The catalogue fix text (remove sample figures) does not apply: nothing here is fabricated; the real issue is untranslated/banned wording.
- **Files to change:** `apps/web/src/app/(app)/tenant/stewardship/page.tsx`, `apps/web/src/lib/labels.ts`, `apps/web/messages/en.json`
- **Fix steps:**
  1. In the page.tsx use `getTranslations` from next-intl/server (pattern in app/(app)/admin/page.tsx:4,25) and add title/subtitle keys to the message catalogue.
  2. Use LABELS.tenantTitle ('Office', lib/labels.ts:11-12) instead of the literal 'Tenant' in title and breadcrumb (<a href="/tenant">Tenant</a> at line 12).
  3. Reword the subtitle without 'tenant' (e.g. 'Office configuration keys and values.').
  4. Run the BANNED_CLERK_TERMS unit test against the new strings.
- **Acceptance:**
  - Page renders 'Office — ...' title from catalogue.
  - BANNED_CLERK_TERMS test passes for page copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only. Confirm messages file location (not inspected).


---
## /tenant/subscriptions  —  `tenant/subscriptions.html`

- **Source:** `apps/web/src/app/(app)/tenant/subscriptions/page.tsx`
- **Design reference:** `redesign/tenant/subscriptions.html`

### GAP-TENANT-SUBSCRIPTIONS-01  ·  HIGH  ·  partly  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): _data.test.ts mapSubscriptionRows (plan name, 'Renews ... 2026'; no raw uuid). Date uses the house formatIndianDate, not a literal dd/MM/yyyy)
- **First-pass claim:** Name column falls back to the raw subscriptionId because no name/title/label/key/resource/code/domain exists on the payload (tenant/_data.ts:44-52), so the primary label is an opaque id; renewal date, amount and lifecycle actions (hub: 'lifecycle') have no column.
- **Verified evidence:** tenant/_data.ts:44-52 label falls back to id, and id falls back to subscriptionId (:42), so an id-only payload shows an opaque id as the name; planName is only in sublabel (:57). No renewal date/amount/actions column exists in mapper or table. Theme tag DATEFMT is wrong: the core gap is missing field mapping and lifecycle actions; payload fields unverifiable (tenant-service absent).
- **Files to change:** `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/app/(app)/tenant/subscriptions/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm subscription payload fields (planName, renewsAt/endDate, amountPaise, status) from tenant-service contract.
  2. Add mapSubscriptionRows: label = planName ?? name, meta = formatIndianDate(renewal) from lib/formatters.ts, status kept.
  3. Add a renewal-date column via ModuleListTable `columns` prop.
  4. Lifecycle actions (renew/cancel) need a backend endpoint plus audit event; scope separately or drop 'lifecycle' from hub note.
- **Acceptance:**
  - Subscription row shows plan name and dd/MM/yyyy renewal date.
  - No raw uuid as name.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Billing-adjacent; mutations must be audited and role-gated.
- **Depends on:** SHARED:ModuleListTable, GAP-TENANT-SUBSCRIPTIONS-05

### GAP-TENANT-SUBSCRIPTIONS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 tenant: closed by #2060; apps/web ModuleListTable.showid.test.tsx (showId={false} hides the ID column; time-ordered UUIDs sharing an 8-char prefix are no longer rendered) + every tenant page passes showId={false})
- **W0 note:** partly fixed by #1801 — Slug ids full; UUID ids still sliced to 8 chars, ID column retained
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** ModuleListTable.tsx:50 renders <span className="mono">{row.id.slice(0, 8)}</span> (file lines 37-55 hold the table). Ids come from mapper fallback chain (id/key/code/... then `row-N`), so long keys/UUIDs sharing a prefix display identically; <tr key={row.id}> at :47 would also duplicate if real ids collide.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx replace the ID column: drop `.slice(0, 8)`; show the full id in a mono, truncating via CSS (max-w + text-overflow) with title={row.id}.
  2. Better: hide the raw ID column entirely for clerks and lead with row.label; keep id as a copyable secondary/aria-label value (add optional `showId` prop on ModuleListTable defaulting false).
  3. Do not show synthetic `row-N` ids (mapper fallback); render "—" when id startsWith("row-").
  4. Add a component test in ModuleListTable.test.tsx with two rows 'auth.session_timeout_min' and 'auth.session_timeout_max' asserting they are distinguishable.
- **Acceptance:**
  - Rows with ids 'auth.session_timeout_min'/'auth.session_timeout_max' render distinct text (or no ID column).
  - Full id is available via title/tooltip.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component used by ~65 pages; visual change only, no money/PII.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SUBSCRIPTIONS-03  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** ModuleListTable.tsx:50-51 renders DataSourceBadge with provenance from useSeededResource; DataSourceBadge.tsx:71 prints "Couldn't load — showing nothing" for provenance 'error-no-data', while ModuleListTable.tsx:34-35 (data.length===0) renders EmptyState 'No records / Nothing to show yet for this module.' in the same card, so a failure looks like an empty list. No retry action. Correction to observation: ModuleListPage.tsx:28 only maps LoaderSource ('api'|'error', apiClient.ts:6) to the same two values; the cache fallback is handled in useSeededResource (resource.ts:208-213, 'cached' provenance), not collapsed at :28. RefreshErrorState exists at app/_components/ds/RefreshErrorState.tsx (props error,onBack,backHref,helpHref).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable.tsx branch on provenance: when provenance==='error-no-data' && data.length===0 render <RefreshErrorState error=... /> (or LoadErrorState) inside the Card instead of EmptyState, with a Retry that calls router.refresh() (page is force-dynamic).
  2. Keep EmptyState only for provenance==='live' with 0 rows; reword message per module via optional `emptyMessage` prop on ModuleListPage.
  3. Drop/replace the duplicate DataSourceBadge text in the error-no-data case so the card shows one message.
  4. Add component tests: (source='error', rows=[]) shows retry and no 'No records'; (source='api', rows=[]) shows 'No records'.
- **Acceptance:**
  - Mock fetch failure with empty cache: card shows error state + Retry, not 'No records'.
  - Successful empty response still shows 'No records'.
  - Retry click re-invokes loader (router.refresh called).
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 list pages; must not hide legitimately empty results or cached-data banner.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SUBSCRIPTIONS-05  ·  LOW  ·  partly  ·  theme MONEY

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 9c5e9e9e9)
- **First-pass claim:** Currency ('INR') surfaces as Meta (tenant/_data.ts:60-65) without any amount; money as paise bigint (CLAUDE.md) is never rendered.
- **Verified evidence:** tenant/_data.ts:60-65 meta = code ?? unit ?? usagePercent ?? limit ?? currency, so currency prints alone only when none of the others exist. No amount is mapped or rendered anywhere. Whether the payload carries an amount (paise) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/tenant/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Confirm amount field and unit with tenant-service (paise bigint as string per CLAUDE.md rule 11).
  2. In mapSubscriptionRows read amount as string/bigint, never Number-multiply; render via the existing money formatter in lib/formatters.ts (formatINR-style helper near :61).
  3. Show 'Currency' only alongside amount.
  4. Test that 1234500 paise renders ₹12,345.00.
- **Acceptance:**
  - Amount paise 1234500 shows ₹12,345.00.
  - Missing amount shows '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Money display: no float math.
- **Depends on:** GAP-TENANT-SUBSCRIPTIONS-01

### GAP-TENANT-SUBSCRIPTIONS-06  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1923): same assertions as CODE-LISTS-05 + subscriptions/page.test.tsx)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:36-55 renders a plain <table className="tbl"> with no search, sort or pagination and status as plain text ({row.status ?? "—"} at :54). themes/ThemeTokenTable.tsx:38 uses DS <DataTable> (app/_components/ds/DataTable.tsx:172, has filterable/exportable). The loader fetches with no page/limit params (tenant/_data.ts:77-83), so 'server-side pagination' would need backend contract; the supplied fix text about 'client-side filtering of a capped fetch' does not match this code (no client filtering exists).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the hand-rolled <table> in ModuleListTable.tsx with DS <DataTable<ModuleRowSummary>> using columns Name, Detail, Status, Meta and filterable enabled.
  2. Render Status via DS <StatusPill> instead of raw text.
  3. Only add server pagination once the tenant/theme endpoints document limit/offset/total; until then keep client-side sort/filter.
  4. Add a test that typing in the filter narrows rows and status renders a StatusPill.
- **Acceptance:**
  - Filter box narrows rows by label/detail.
  - Column header click sorts.
  - Status shows as pill with accessible text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by ~65 pages; bulk-visual change, verify offline cache seeding still works.
- **Depends on:** SHARED:ModuleListTable

### GAP-TENANT-SUBSCRIPTIONS-07  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W2 tenant RE-CONFIRMED (was W0 PROVISIONAL; originally closed by #1916): w2-pages-i18n.test.tsx (catalogue title, no banned term))
- **First-pass claim:** Title 'Tenant — Subscriptions' is hard-coded English rather than next-intl (page.tsx:15) and 'tenant' is on the banned clerk-facing terms list (lib/labels.ts:30); subtitle: "Current subscription details and lifecycle state.".
- **Verified evidence:** page.tsx:15 has literal title and :16 the literal subtitle; page.tsx:12 breadcrumb also says 'Tenant'. lib/labels.ts:11 maps tenant->'Office' and :30 lists 'tenant' in BANNED_CLERK_TERMS, so the copy conflicts with the rule. Subtitle matches observation. The catalogue fix text (remove sample figures) does not apply: nothing here is fabricated; the real issue is untranslated/banned wording.
- **Files to change:** `apps/web/src/app/(app)/tenant/subscriptions/page.tsx`, `apps/web/src/lib/labels.ts`, `apps/web/messages/en.json`
- **Fix steps:**
  1. In the page.tsx use `getTranslations` from next-intl/server (pattern in app/(app)/admin/page.tsx:4,25) and add title/subtitle keys to the message catalogue.
  2. Use LABELS.tenantTitle ('Office', lib/labels.ts:11-12) instead of the literal 'Tenant' in title and breadcrumb (<a href="/tenant">Tenant</a> at line 12).
  3. Reword the subtitle without 'tenant' (e.g. 'Office configuration keys and values.').
  4. Run the BANNED_CLERK_TERMS unit test against the new strings.
- **Acceptance:**
  - Page renders 'Office — ...' title from catalogue.
  - BANNED_CLERK_TERMS test passes for page copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only. Confirm messages file location (not inspected).


---
## Backend verification items (service code absent from snapshot)

### GAP-TENANT-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for usage/settings/consent/requests/org/migrations; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** No role gate on a hub that fans out to quotas, configuration keys, DPDP consent requests and data migrations: layout.tsx:5 only checks module enablement and middleware.ts:48-59 only a session. Every tile is shown to every signed-in user; backend authorization undeterminable (tenant-service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/usage', 'GET /api/v1/tenant/settings', 'GET /api/v1/tenant/consent/requests', 'GET /api/v1/tenant/org/migrations']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate? Also check that consent and migration data are limited to admin/DPO roles.
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/usage, /api/v1/tenant/settings, /api/v1/tenant/consent/requests, /api/v1/tenant/org/migrations; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/usage; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-CODE-LISTS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/code-lists; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/code-lists']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/code-lists; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/code-lists; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-DATA-MIGRATION-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/org/migrations (super_admin only); plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/org/migrations']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/org/migrations; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/org/migrations; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-ORG-HIERARCHY-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/org/hierarchy; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/org/hierarchy']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/org/hierarchy; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/org/hierarchy; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-OVERVIEW-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 tenant INTERIM — NEEDS OWNER DECISION: GET /v1/tenant/current has no role gate by design (any signed-in user reads their OWN tenant profile; scoping asserted in w2-tenant-web-paths-authz.test.ts). The ledger asks for basic-user 403; the /tenant web area is admin-gated (layout.tsx) but the API is not. Gating it could break shell consumers of /v1/tenants/current)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/current']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/current; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/current; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-PLANS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 tenant INTERIM — NEEDS OWNER DECISION: GET /v1/tenant/plans returns the static plan-comparison catalogue to ANY authenticated user by design (comment in subscriptions/routes.ts; pinned by subscription-upgrade.test.ts). The ledger asks for basic-user 403. No tenant data is exposed; owner to decide whether pricing is admin-only)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/plans']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/plans; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/plans; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-POSITIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/positions; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/positions']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/positions; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/positions; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-QUOTAS-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/usage; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/usage']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/usage; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/usage; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-SETTINGS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; role gate pinned in services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted), and the list response now masks credential-named keys server-side (settings/routes.ts maskSecretSettings), asserted by services/tenant-service/tests/w2-settings-list-masking.test.ts: admin sees ******** for smtp_password, ordinary value intact)
- **First-pass claim:** Any signed-in user can read every tenant configuration key and value: no role gate (tenant/layout.tsx:5, middleware.ts:48-59), and the value is printed verbatim in the Detail column when the row has no description (tenant/_data.ts:53-58 maps sublabel = description ?? type ?? category ?? planName ?? value). No masking of secret-looking keys. Backend filtering undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/settings']`
- **Question:** Is GET settings restricted to admin roles and does it redact secret-typed values (masked or omitted)?
- **How to verify:** Open the settings handler/DTO in tenant-service: role guard and secret flag/redaction; seed key smtp_password and GET as basic user and as admin.
- **Test to add:** Given secret key; when GET settings as admin; then value is masked ('****'); as basic user then 403.
- **Impact if wrong:** Credentials/secrets exposed to every employee.
- **Web change if wrong:** Also in tenant/_data.ts:53-58 never fall back to value for the Detail column; mask keys matching secret|password|token|key.

### GAP-TENANT-STEWARDSHIP-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/data-governance/domains; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/data-governance/domains']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/data-governance/domains; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/data-governance/domains; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).

### GAP-TENANT-SUBSCRIPTIONS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 tenant: closed by #2060; verified server-side on main: services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts (exact web path: no token 401, basic employee 403, admin role admitted) for /v1/tenant/subscription/current; plus web gate apps/web/src/app/(app)/tenant/w2-layout-notfound.test.tsx)
- **First-pass claim:** Route reachable by any signed-in user: only ModuleGate (tenant/layout.tsx:5) and a session check (middleware.ts:48-59) stand in front of it; role enforcement in tenant-service is undeterminable (service absent).
- **Service:** `tenant-service`  ·  **Endpoint(s):** `['GET /api/v1/tenant/subscription/current']`
- **Question:** Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
- **How to verify:** Open tenant-service route guards for /api/v1/tenant/subscription/current; call each with a token holding only a basic user role expecting 403.
- **Test to add:** Given basic signed-in user; when GET /api/v1/tenant/subscription/current; then 403; given tenant admin then 200 scoped to own tenantId.
- **Impact if wrong:** Any employee reads tenant governance, plans or configuration.
- **Web change if wrong:** Add requireAnyRole(tenant admin) in tenant/layout.tsx (web change needed regardless since gate is missing).
