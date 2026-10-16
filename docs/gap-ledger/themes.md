# Detailed gap file — module `themes`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 26, BACKEND-VERIFY 5



---
## /themes  —  `themes/home.html`

- **Source:** `apps/web/src/app/(app)/themes/page.tsx`
- **Design reference:** `redesign/themes/home.html`

### GAP-THEMES-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Four overlapping branding surfaces on one hub — Tokens, Templates, Branding, Brand preset — plus /settings/branding (page.tsx:10-14); the notes ('Branding packs and logos' vs 'Active brand and presets') do not tell a user which one changes what tenants see.
- **Verified evidence:** themes/page.tsx:10-14 lists five ModuleHub links with notes 'Colour and scalar design tokens', 'Theme templates', 'Branding packs and logos', 'Active brand and presets', 'Tenant settings branding editor'. themes/branding and themes/brand are read-only ModuleListPage lists (themes/branding/page.tsx, themes/brand/page.tsx); the only editor is /settings/branding (settings/branding/page.tsx, a Brand Editor that PUT/GETs /api/proxy/v1/themes/brand) and the only publish action is on /themes/tokens (ThemeActions.tsx:56-70). Notes never say which is read-only vs which changes what tenants see.
- **Files to change:** `apps/web/src/app/(app)/themes/page.tsx`
- **Fix steps:**
  1. Rewrite each link's note in page.tsx to state the task and effect, e.g. Tokens: 'Review tokens and publish a theme revision to all tenant screens'; Branding: 'View branding packs (read-only)'; Brand preset: 'View the active brand (read-only)'; Edit brand: 'Change logo and colours tenants see'.
  2. Rename the last tile from 'Settings branding' to a task label such as 'Edit tenant brand' and order tiles as: Edit brand, Publish tokens, Templates, Packs, Active brand.
  3. Add a one-line 'Who sees what' description under the hub (ModuleHub description prop) that says tokens publish is tenant-wide.
  4. Decide with product whether themes/brand and themes/branding should be merged into the settings editor (see decision in risk).
- **Acceptance:**
  - Manual: open /themes; every tile note says either 'read-only' or names the tenant-visible change.
  - Component test: render themes page, assert tile labels/notes match the agreed copy.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy only; needs a product decision on whether the two read-only list routes should exist at all.

### GAP-THEMES-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Generic skeleton in loading.tsx (four stats and a block) does not match a five-tile hub; not-found has no way back (not-found.tsx:5-8).
- **Verified evidence:** themes/loading.tsx:3-13 renders a slate full-screen wrapper (min-h-screen bg-slate-50), a breadcrumb bar, title bar, 4 stat blocks and a 288px block; the hub (page.tsx) is a PageHeader + five LinkTiles in 3 columns inside .page-main, so shape and wrapper differ. not-found.tsx:5-8 renders EmptyState with title/message only and passes no `action`, so no way back. error.tsx already uses RouteError with retry and backHref='/themes', so that part of the suggested fix is already done.
- **Files to change:** `apps/web/src/app/(app)/themes/loading.tsx`, `apps/web/src/app/(app)/themes/not-found.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx inside `<div className="page-main">` using SkeletonBar/SkeletonCard from @/app/_components/ds (title bar + 5 SkeletonCard tiles in a 3-column grid) instead of Tailwind slate divs; add aria-busy and a visually-hidden 'Loading themes' label.
  2. In not-found.tsx pass `action={<Link href="/themes" className="btn primary">Back to Themes</Link>}` to EmptyState.
  3. Keep not-found reserved for notFound() calls; leave error.tsx as is.
- **Acceptance:**
  - Manual: throttle network, open /themes; skeleton shows 5 tile placeholders in the same grid as the loaded page.
  - Visit /themes/does-not-exist: page shows a 'Back to Themes' button that navigates to /themes.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; visual only.

### GAP-THEMES-HOME-04  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Hard-coded English strings rather than next-intl (page.tsx:7-14); 'Settings branding' reads as a page name, not a task.
- **Verified evidence:** Hard-coded English confirmed: title, description and all five labels/notes are literals at themes/page.tsx:6-14, and the themes tree has no next-intl usage (other routes such as (app)/crm/page.tsx:70 use getTranslations). 'Settings branding' (line 14) reads as a page name. Nothing is fabricated (no sample figures), so the FABRICATED tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/themes/page.tsx`, `apps/web/messages/en.json (or the repo's existing next-intl message catalogue; path not verified)`
- **Fix steps:**
  1. Add a `themes` namespace to the message catalogues (en + hi at least) with keys for title, description and each tile label/note.
  2. Convert page.tsx to `const t = await getTranslations('themes')` and use t() for ModuleHub title, description and links.
  3. Relabel the last tile as a task ('Edit tenant brand') as in GAP-THEMES-HOME-02.
- **Acceptance:**
  - Switch locale to hi: hub title, description and tiles render translated strings.
  - Grep of themes/page.tsx finds no user-facing string literals.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure the message catalogue location is the repo's actual one (not verified here).
- **Depends on:** GAP-THEMES-HOME-02


---
## /themes/brand  —  `themes/brand.html`

- **Source:** `apps/web/src/app/(app)/themes/brand/page.tsx`
- **Design reference:** `redesign/themes/brand.html`

### GAP-THEMES-BRAND-01  ·  HIGH  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1934, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says 'Active brand configuration' but there is no preview or colour/logo value and no control to activate a preset; a status of 'active' is just text, so the active brand is only inferable by reading the Status column (themes/_data.ts:60).
- **Verified evidence:** themes/_data.ts:60 status = status ?? state ?? lifecycle and :51-59 sublabel; ModuleListTable has no colour/logo preview or activate control (columns :39-45). Status is plain text at ModuleListTable.tsx:54. Brand payload fields for colours/logo not visible (theme-service absent).
- **Files to change:** `apps/web/src/app/(app)/themes/_data.ts`, `apps/web/src/app/(app)/themes/brand/page.tsx`, `apps/web/src/app/(app)/settings/branding/page.tsx`
- **Fix steps:**
  1. Decide ownership: /themes/brand vs /themes/branding vs /settings/branding (see GAP-THEMES-BRANDING-02).
  2. If kept, build a dedicated BrandPreview component showing colour swatches/logo from payload and a StatusPill for 'active'.
  3. Activation control needs a POST/PATCH endpoint with audit event; else reword subtitle to 'Brand presets'.
- **Acceptance:**
  - Active preset visually badged.
  - Swatches render for hex values.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Tenant-wide visual change; activation must be audited.
- **Depends on:** GAP-THEMES-BRANDING-02

### GAP-THEMES-BRAND-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** sublabel falls back to status (themes/_data.ts:51-59), so a row with no description repeats its status in Detail and Status; Meta prints the raw ISO updatedAt (_data.ts:61-67) instead of a tenant-locale date (CLAUDE.md timestamps rule).
- **Verified evidence:** themes/_data.ts:51-59 sublabel chain includes status/state (:53-54) so no-description rows duplicate status in Detail and Status (:60); meta chain (:61-67) uses toText(row.updatedAt) raw ISO string, rendered unformatted at ModuleListTable.tsx:55.
- **Files to change:** `apps/web/src/app/(app)/themes/_data.ts`
- **Fix steps:**
  1. Remove status/state from sublabel chain in themes/_data.ts:53-54.
  2. Format date-like meta: wrap updatedAt/createdAt with formatIndianDate (lib/formatters.ts:2) or a tenant-locale IST datetime helper.
  3. Give code/currency priority only if intended; otherwise prefer updatedAt for meta.
  4. Unit test mapRows with only status+updatedAt.
- **Acceptance:**
  - Detail shows '—' not the status when no description.
  - updatedAt shows dd/MM/yyyy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared by all themes lists; check tokens/templates pages still read well.

### GAP-THEMES-BRAND-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — UUID ids are still shortened to 8 characters (full id kept in a title; slug ids shown whole); the ID column is not removed or hidden
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

### GAP-THEMES-BRAND-04  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
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

### GAP-THEMES-BRAND-06  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
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

### GAP-THEMES-BRAND-07  ·  LOW  ·  partly  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Title 'Themes — Brand' is hard-coded English (page.tsx:15) and the subtitle names the internal service: "Active brand configuration and presets.".
- **Verified evidence:** page.tsx:15 title 'Themes — Brand' hard-coded (no getTranslations). Subtitle 'Active brand configuration and presets.' (:16) does NOT name an internal service, so that part of the observation is wrong (branding page does; see BRANDING-07). Fabrication theme tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/themes/brand/page.tsx`, `apps/web/messages/en.json`
- **Fix steps:**
  1. Use getTranslations (pattern admin/page.tsx:25) for title and subtitle.
  2. Add keys to message catalogue.
- **Acceptance:**
  - Title comes from catalogue.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only.


---
## /themes/branding  —  `themes/branding.html`

- **Source:** `apps/web/src/app/(app)/themes/branding/page.tsx`
- **Design reference:** `redesign/themes/branding.html`

### GAP-THEMES-BRANDING-01  ·  MEDIUM  ·  partly  ·  theme WIRING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Hub note promises 'Branding packs and logos' (themes/page.tsx:12) but no logo or asset is shown; Meta prints the raw ISO updatedAt (themes/_data.ts:61-67).
- **Verified evidence:** themes/page.tsx:12 note 'Branding packs and logos'; ModuleListTable shows no logo/asset, and meta prints raw ISO updatedAt (themes/_data.ts:64, ModuleListTable.tsx:55). Payload has no verified logo field.
- **Files to change:** `apps/web/src/app/(app)/themes/_data.ts`, `apps/web/src/app/(app)/themes/page.tsx`
- **Fix steps:**
  1. Format meta date via formatIndianDate.
  2. Either map a logo/asset URL field (confirm in theme-service contract) into a thumbnail, or reword hub note to 'Branding packs'.
- **Acceptance:**
  - Hub note matches page content.
  - Date formatted dd/MM/yyyy.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-THEMES-BRAND-02

### GAP-THEMES-BRANDING-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Three overlapping surfaces edit branding: /themes/brand, /themes/branding and /settings/branding (themes/page.tsx:12-14); this route is list-only with no edit or publish action.
- **Verified evidence:** themes/page.tsx:12-14 lists Branding, Brand preset and Settings branding as three links; /themes/branding and /themes/brand are read-only ModuleListPage lists (no actions) while editing lives at app/(app)/settings/branding/page.tsx.
- **Files to change:** `apps/web/src/app/(app)/themes/page.tsx`, `apps/web/src/app/(app)/themes/brand/page.tsx`, `apps/web/src/app/(app)/themes/branding/page.tsx`
- **Fix steps:**
  1. Product decision: consolidate into one Branding surface.
  2. Redirect /themes/brand and /themes/branding to the chosen route (next.config redirects).
  3. Update hub links in themes/page.tsx.
  4. Add edit/publish actions only on the surviving page.
- **Acceptance:**
  - Hub shows one branding entry.
  - Old URLs redirect.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Broken bookmarks if no redirects.
- **Depends on:** GAP-THEMES-BRAND-01

### GAP-THEMES-BRANDING-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — UUID ids are still shortened to 8 characters (full id kept in a title; slug ids shown whole); the ID column is not removed or hidden
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

### GAP-THEMES-BRANDING-04  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1862, verified on main 9c5e9e9e9)
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

### GAP-THEMES-BRANDING-06  ·  LOW  ·  confirmed  ·  theme OTHER (was CAP)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
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

### GAP-THEMES-BRANDING-07  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Title 'Themes — Branding' is hard-coded English (page.tsx:15) and the subtitle names the internal service: "Branding packs from theme-service.".
- **Verified evidence:** page.tsx:15 hard-coded English title; page.tsx:16 subtitle 'Branding packs from theme-service.' names an internal service (clerk-facing jargon). Fabrication theme tag is wrong.
- **Files to change:** `apps/web/src/app/(app)/themes/branding/page.tsx`, `apps/web/messages/en.json`
- **Fix steps:**
  1. Use getTranslations for title and subtitle.
  2. Reword subtitle to 'Branding packs for your organisation.'
- **Acceptance:**
  - No 'theme-service' text on page.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy only.


---
## /themes/templates  —  `themes/templates.html`

- **Source:** `apps/web/src/app/(app)/themes/templates/page.tsx`
- **Design reference:** `redesign/themes/templates.html`

### GAP-THEMES-TEMPLATES-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hub says 'Design tokens, templates and branding for tenant editions' (themes/page.tsx:7) yet templates show no edition, token count or preview and cannot be applied from this route (themes/_data.ts:28-77).
- **Verified evidence:** Hub text (themes/page.tsx:7) promises 'Design tokens, templates and branding for tenant editions'. templates/page.tsx only calls getThemeTemplates (_data.ts:89) whose mapRows (_data.ts:28-77) reduces every row to id/label/sublabel/status/meta; there is no edition, token-count or preview mapping, and the page has no apply/publish action (only ThemeActions on /themes/tokens publishes). Whether theme-service returns edition/tokenCount fields cannot be verified (service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/themes/templates/page.tsx`, `apps/web/src/app/(app)/themes/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm the GET /api/v1/themes/templates response shape with theme-service owners (fields for edition, token count, preview colours, applied flag).
  2. Add a dedicated `getThemeTemplateCards` loader in themes/_data.ts (zod-parsed) instead of the generic mapRows, returning edition, tokenCount and a small colour preview array.
  3. Render templates as a DataTable/cards with edition column and colour swatches (reuse the swatch from ThemeTokenTable).
  4. If apply is intended, add an ActionButton with requireReason calling the theme-service apply endpoint (endpoint must exist; do not invent), otherwise state 'read-only' in the description.
- **Acceptance:**
  - Component test: template row with edition 'psu' and 12 tokens shows both values and swatches.
  - Manual: /themes/templates shows edition and preview per template; description text no longer over-promises.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Applying a template changes tenant look; needs reason + audit if enabled.
- **Depends on:** GAP-THEMES-TEMPLATES-05

### GAP-THEMES-TEMPLATES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — UUID ids are still shortened to 8 characters (full id kept in a title; slug ids shown whole); the ID column is not removed or hidden
- **First-pass claim:** ID column prints row.id.slice(0, 8) (ModuleListTable.tsx:50): truncated ids mean nothing to clerks and can collide.
- **Verified evidence:** _components/ModuleListTable.tsx:50 renders `row.id.slice(0, 8)`. Because themes/_data.ts:32-41 falls back to key/code/name (and even `row-N`) when id is absent, the 'ID' may be a truncated name; UUIDs share 8-char prefixes rarely but names/codes do. This shared table is used by every ModuleListPage consumer, not just Themes.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Drop the ID column from ModuleListTable (clerks identify rows by Name/Detail); or show it only as a `title`/copy-to-clipboard tooltip using formatInternalRef from lib/formatters.ts.
  2. Keep `row.id` as the React key only.
  3. If an identifier is needed, show `row.meta`/code instead of the truncated id.
- **Acceptance:**
  - Component test: two rows with ids 'abcdefgh-1' and 'abcdefgh-2' render distinct visible identifiers or none.
  - Manual: /themes/templates has no 8-char opaque id column.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared component: check other module list pages/tests that assert the ID column.

### GAP-THEMES-TEMPLATES-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1862, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed fetch the badge says 'Couldn't load — showing nothing' but the card body reads 'No records / Nothing to show yet' (ModuleListTable.tsx:33-35), which looks like a genuinely empty tenant; no retry (ModuleListPage.tsx:28 collapses cache/fallback into 'api'/'error').
- **Verified evidence:** On source 'error' ModuleListPage.tsx:28 passes source='error' to ModuleListTable; useSeededResource (lib/sync/resource.ts:215-256) has no cache so provenance is 'error-no-data', the DataSourceBadge (ModuleListTable.tsx:33) says 'Couldn't load — showing nothing', but lines 34-35 still render EmptyState 'No records / Nothing to show yet for this module.' with no retry. (ModuleListPage only maps 'error'->'error', everything else->'api'; there is no cache/fallback collapse there, so that sub-claim is loose.) RefreshErrorState exists (ds/RefreshErrorState.tsx) and works in client components.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. In ModuleListTable, when `provenance === 'error-no-data'` (and data empty) render `<RefreshErrorState error={{what:'We could not load this list.', next:'Check your connection and try again.', actions:['retry','back','help']}} backHref={backHref} />` instead of the EmptyState and suppress the DataSourceBadge in that case.
  2. Keep EmptyState only for provenance 'live' with zero rows.
  3. Optionally add a `backHref` prop to ModuleListPage and forward it (Themes passes '/themes').
- **Acceptance:**
  - Component test: render ModuleListTable with source='error' and rows=[] and no cache: RefreshErrorState with a Retry button appears, 'No records' does not.
  - Component test: source='api', rows=[] still shows 'No records'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared by all ModuleListPage screens; failure copy changes everywhere, which is intended.

### GAP-THEMES-TEMPLATES-05  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Table has no search, sort or pagination and status is unstyled text (ModuleListTable.tsx:37-55), unlike the DS DataTable used on the tokens page.
- **Verified evidence:** ModuleListTable.tsx:37-55 is a bare `<table className="tbl">` inside `.tbl-wrap` with five fixed columns, no filter/sort/pagination, and status rendered as plain text (`{row.status ?? "—"}`, line 54). ds/DataTable.tsx supports sortable, filterable, pageSize and is used by ThemeTokenTable. No client-side cap exists in the loader (moduleLoader in _data.ts:79-86 does not add limit params); whether theme-service paginates cannot be verified.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Replace the hand-built table with `DataTable<ModuleRowSummary>` (sortable, filterable, pageSize 12) as ThemeTokenTable does.
  2. Render status via StatusPill (mapped from row.status) rather than raw text.
  3. If theme-service supports limit/offset, add page params to moduleLoader and pass total to DataTable; otherwise state the row count in the card title.
- **Acceptance:**
  - Component test: 30 rows show 12 per page, filter 'psu' narrows rows, header click sorts by Name.
  - Manual: status column shows coloured pill.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component, all ModuleListPage screens change layout; run their snapshot tests.
- **Depends on:** GAP-THEMES-TEMPLATES-03, GAP-THEMES-TEMPLATES-02

### GAP-THEMES-TEMPLATES-06  ·  LOW  ·  partly  ·  theme I18N (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Title 'Themes — Templates' is hard-coded English (page.tsx:15) and the subtitle names the internal service: "Theme templates from theme-service.".
- **Verified evidence:** Hard-coded English title 'Themes — Templates' and subtitle 'Theme templates from theme-service.' at templates/page.tsx:15-16 confirmed (same leak in branding/page.tsx: 'Branding packs from theme-service.'). Not fabricated data, so tag is I18N. Caveat: ModuleListPage.tsx:16-28 derives the offline cacheKey from slugify(title), so translating the title would change/split the per-user cache key.
- **Files to change:** `apps/web/src/app/(app)/themes/templates/page.tsx`, `apps/web/src/app/(app)/themes/branding/page.tsx`, `apps/web/src/app/(app)/themes/brand/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add optional `cacheKey` prop to ModuleListPage (default slugify(title)) and pass fixed keys ('module.themes-templates' etc.) from the themes pages before translating.
  2. Use getTranslations('themes') for title and description; replace 'from theme-service' with plain text such as 'Ready-made looks you can start from'.
  3. Use PageHeader back/backLabel props instead of the hand-rolled breadcrumb nav in each page.
- **Acceptance:**
  - Switch locale to hi: title/description translated; cached list still found after locale switch.
  - Grep: no 'theme-service' string in user-facing copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Cache-key change orphans old cached copies (harmless).
- **Depends on:** GAP-THEMES-HOME-04


---
## /themes/tokens  —  `themes/tokens.html`

- **Source:** `apps/web/src/app/(app)/themes/tokens/page.tsx`
- **Design reference:** `redesign/themes/tokens.html`

### GAP-THEMES-TOKENS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** On a failed load the badge appears but stats are real zeros and the palette shows 'No theme tokens … Publish a theme revision to seed the palette' (page.tsx:23,26-28; ThemeTokenTable.tsx:29-33) with Publish still enabled: the page nudges the user to publish a tenant-wide theme on top of a token set it could not read.
- **Verified evidence:** tokens/page.tsx:23 shows DataSourceBadge on error, but lines 26-28 pass numeric total/colourTokens/scalarTokens (all 0 from the empty fallback; StatCard shows '—' only for null/undefined/NaN, ds/StatCard.tsx:20-24). ThemeTokenTable.tsx:27-34 shows EmptyState 'No theme tokens ... Publish a theme revision to seed the palette' whenever rows are empty, and ThemeActions.tsx:29,56-58 keeps Publish enabled (canPublish depends only on the name). Publish does require a reason via the confirm dialog, which mitigates but does not remove the misleading nudge.
- **Files to change:** `apps/web/src/app/(app)/themes/tokens/page.tsx`, `apps/web/src/app/(app)/themes/ThemeTokenTable.tsx`, `apps/web/src/app/(app)/themes/ThemeActions.tsx`
- **Fix steps:**
  1. In tokens/page.tsx, when source==='error' render `<RefreshErrorState error={{what:'We could not load the theme tokens.', next:'Try again before publishing.', actions:['retry','back']}} backHref='/themes' />` in place of the stat grid and palette card.
  2. Pass `undefined` (renders '—') to StatCard values when source==='error'.
  3. Add a `disabled` prop to ThemeActions and pass `source==='error'` so Publish is disabled with a hint.
  4. Keep the 'seed the palette' empty-state copy only for source==='api' with zero tokens.
- **Acceptance:**
  - Component/page test: mock getThemeTokens -> {data:[],source:'error'}: retry state shown, stats show '—', Publish button disabled.
  - Mock {data:[],source:'api'}: empty-state copy shown and Publish enabled.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Publish is tenant-wide; disabling it on a failed read is the safe direction.

### GAP-THEMES-TOKENS-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0-10 note:** review found the W0 tick partly — ThemeContrastPanel on tokens page, but publish dialog (ThemeActions.tsx:66-72) still has text-only confirmDescription: no changed-token old/new list, no AA fail warning/block; two acceptance points unmet
- **First-pass claim:** No preview, diff or contrast check before publishing: the confirmation explains consequence but never shows which tokens change or whether brand.primary on surface.canvas meets WCAG contrast.
- **Verified evidence:** ThemeActions.tsx:56-70 wraps Publish in ActionButton with confirmTitle, consequence text, requireReason and reasonLabel (so a reason dialog does exist), but the POST at lines 19-23 sends only {name, reason}; the page never shows which tokens change vs the live theme, nor a contrast check. lib/contrast.ts exports contrast(hexA, hexB) (line 24) that is not used here. Maker!=checker enforcement and the audit event are server-side and cannot be verified (theme-service absent); what /v1/themes/publish publishes (a server-held draft?) is unknown.
- **Files to change:** `apps/web/src/app/(app)/themes/ThemeActions.tsx`, `apps/web/src/app/(app)/themes/tokens/page.tsx`, `apps/web/src/lib/contrast.ts`
- **Fix steps:**
  1. Confirm with theme-service what GET exposes for the draft/pending revision vs live; if there is none, add e.g. a diff endpoint (backend).
  2. In tokens/page.tsx compute WCAG contrast for brand.primary vs surface.canvas (and text pairs) with lib/contrast.contrast and show pass/fail (>=4.5) in a small panel.
  3. Pass a `changes` summary into the ActionButton confirmDescription (list of token key, old -> new, swatches) and block/warn when contrast < 4.5.
  4. Ensure server audit event and maker!=checker are verified in theme-service tests.
- **Acceptance:**
  - Unit test: pair #777 on #fff yields 'fails AA' warning in the publish dialog.
  - Manual: publish dialog lists changed tokens with old/new swatches before the reason field.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Tenant-wide visual change; a false 'pass' from a wrong contrast pair would ship an inaccessible theme.
- **Depends on:** GAP-THEMES-TOKENS-04

### GAP-THEMES-TOKENS-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Colour test is only 3- or 6-digit hex (page.tsx:9; ThemeTokenTable.tsx:9): rgb(), hsl() and 8-digit hex values are counted as scalar tokens and get no swatch.
- **Verified evidence:** tokens/page.tsx:9 and ThemeTokenTable.tsx:9 each declare the same HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/. rgb()/hsl()/8-digit (#rrggbbaa) and 4-digit hex values fail the test, so they are counted as scalar tokens in the stats (page.tsx:15-16) and rendered as plain text without a swatch (ThemeTokenTable.tsx:35-58). Duplicated regex can drift.
- **Files to change:** `apps/web/src/app/(app)/themes/tokens/page.tsx`, `apps/web/src/app/(app)/themes/ThemeTokenTable.tsx`, `apps/web/src/lib/colour.ts (new)`
- **Fix steps:**
  1. Create lib/colour.ts exporting `isCssColour(value)` that accepts #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla() via strict regexes (no url(), var(), or free text).
  2. Import it in both tokens/page.tsx and ThemeTokenTable.tsx and delete the local HEX constants.
  3. Only set the swatch `background` from a value that passed isCssColour (prevents arbitrary CSS injection).
- **Acceptance:**
  - Unit tests: '#fff', '#ffffff80', 'rgb(1 2 3)', 'hsl(120 50% 50%)' true; '12px', 'url(x)', 'red;x' false.
  - Manual: a token with value rgb(0,0,0) shows a swatch and is counted as colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; swatch rendering only.

### GAP-THEMES-TOKENS-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Page uses PageShell with Tailwind slate wrappers (PageShell.tsx:19-21) and emoji stat icons, while sibling theme routes use PageHeader; ThemeActions hard-codes hex fallbacks and inline styles (ThemeActions.tsx:38-52), so the branding admin page is off-theme in dark mode.
- **Verified evidence:** Confirmed: tokens/page.tsx uses PageShell (_components/PageShell.tsx:16,19,25,26) with hard-coded Tailwind classes (bg-slate-50, text-slate-900/600, no dark: variants) and emoji stat icons (page.tsx:26-28), whereas templates/brand/branding use ModuleListPage -> PageHeader. Overstated: ThemeActions.tsx:38-49 uses var(--ink2, #475569)/var(--line, #e2e8f0), so hex values are only fallbacks and follow the theme when the vars exist; the inline styles are style debt, not a dark-mode break. Emoji icons are the DS StatCard convention (icon: string), so only the PageShell wrapper is a real dark-mode risk (cannot run the app to see the rendered result).
- **Files to change:** `apps/web/src/app/(app)/themes/tokens/page.tsx`, `apps/web/src/app/(app)/themes/ThemeActions.tsx`
- **Fix steps:**
  1. Replace PageShell with `<div className="page-main">` + `<PageHeader title subtitle back='/themes' backLabel='Themes'>` as the sibling routes do (drop the hand-rolled breadcrumb).
  2. Move ThemeActions inline styles into DS classes (`.card`, `.pad`, form field class) and remove hex fallbacks.
  3. Replace emoji StatCard icons only if the DS provides an icon component (decision).
- **Acceptance:**
  - Manual: toggle dark mode on /themes/tokens; page background and title follow the theme.
  - Visual regression: header/breadcrumb identical to /themes/templates.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; layout only. Check whether other pages still use PageShell before changing the shared component.

### GAP-THEMES-TOKENS-06  ·  LOW  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** getThemeTokenRows in themes/_data.ts:88 is dead code: this page reads getThemeTokens from _data/loaders.ts:761-766 instead, so two loaders exist for one endpoint.
- **Verified evidence:** _data.ts:88 `getThemeTokenRows = moduleLoader('/api/v1/themes/tokens','themes.tokens')` has no importer (repo-wide grep finds only its definition). tokens/page.tsx:4,12 imports getThemeTokens from _data/loaders.ts:761-766, which hits the same /api/v1/themes/tokens with the same telemetryKey and maps to ThemeTokenSummary.
- **Files to change:** `apps/web/src/app/(app)/themes/_data.ts`
- **Fix steps:**
  1. Delete the `getThemeTokenRows` export from themes/_data.ts.
  2. Keep getThemeTokens in _data/loaders.ts as the single loader for /api/v1/themes/tokens.
- **Acceptance:**
  - `pnpm --filter web typecheck` and lint pass after removal; grep for getThemeTokenRows returns nothing.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-THEMES-TOKENS-07  ·  LOW  ·  partly  ·  theme FEEDBACK (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Success line 'Theme revision “…” published.' is aria-live but disappears on router.refresh with no link to the published revision or history (ThemeActions.tsx:25-26,72-74); the revision name defaults to the same 'Published tenant theme' every time.
- **Verified evidence:** ThemeActions.tsx:25 sets status 'Theme revision “…” published.' in a <p role=status aria-live=polite> (72-74). router.refresh() at line 26 re-renders server components but preserves client state, so the message most likely stays until navigation (observation's 'disappears' is probably wrong; not runtime-tested). True: no link to the published revision/history, no revision id returned or shown, and `name` defaults to 'Published tenant theme' each mount (line 15) and is not reset. No revisions/history route exists under themes/ (only brand, branding, templates, tokens), so a history link needs a new route/endpoint. Also line 24 throws `res.text()` raw, which can surface server text to the user.
- **Files to change:** `apps/web/src/app/(app)/themes/ThemeActions.tsx`
- **Fix steps:**
  1. Read the publish response ({id, version, publishedAt} if the endpoint returns them; verify with theme-service) and show 'Revision v{n} published at {IST time}' with a link once a history route exists.
  2. Replace the raw `res.text()` error with toHumanError('save') from lib/messages.
  3. Clear the reason and suggest a dated default name (e.g. 'Theme 29 Sep 2026') instead of the constant default.
  4. Move confirmation to a toast (ds/Toast) plus the persistent status line.
- **Acceptance:**
  - Manual: publish a revision; a confirmation with revision version stays visible after refresh.
  - Test: failing POST shows the human error text, not the server body.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; publish response shape unverified.


---
## Backend verification items (service code absent from snapshot)

### GAP-THEMES-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Themes has no layout.tsx, so unlike tenant it has neither ModuleGate nor any role gate; middleware.ts:48-59 checks only the session. Any signed-in user reaches the publish control behind the Tokens tile (themes/tokens/page.tsx:31). Backend authorization undeterminable (theme-service absent).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['GET /api/v1/themes/tokens', 'POST /api/proxy/v1/themes/publish (ThemeActions.tsx:19)']`
- **Question:** Does theme-service require an admin role on publish (and all themes routes) independent of the web UI?
- **How to verify:** Open theme-service publish route preHandler and policy; POST publish as employee token.
- **Test to add:** Given a non-admin token, when POST /v1/themes/publish, then 403 and no revision created or audit event of success.
- **Impact if wrong:** Any user can publish a tenant-wide irreversible theme.
- **Web change if wrong:** Add themes/layout.tsx with requireAnyRole and hide Tokens publish control for non-admins.

### GAP-THEMES-BRAND-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Route reachable by any signed-in user: themes has no layout.tsx (no ModuleGate) and middleware.ts checks only the session (middleware.ts:48-59); theme-service role enforcement undeterminable (service absent).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['GET /api/v1/themes/brand (themes/_data.ts:91)']`
- **Question:** Does theme-service restrict brand reads/writes to tenant_admin (or theme editor role) and reject others with 403?
- **How to verify:** Open theme-service brand route preHandler; curl as plain employee and tenant_admin.
- **Test to add:** Given employee token, when GET/PUT /v1/themes/brand write, then 403; tenant_admin 200 tenant-scoped.
- **Impact if wrong:** Any signed-in user can view/alter tenant branding.
- **Web change if wrong:** Add themes/layout.tsx with requireAnyRole([tenant_admin, platform_admin, super_admin]) as in tenant-admin/layout.tsx.

### GAP-THEMES-BRANDING-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Route reachable by any signed-in user: themes has no layout.tsx (no ModuleGate) and middleware.ts checks only the session (middleware.ts:48-59); theme-service role enforcement undeterminable (service absent).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['GET /api/v1/themes/branding (themes/_data.ts:90)']`
- **Question:** Does theme-service restrict branding endpoints to authorised admin roles?
- **How to verify:** Open theme-service branding route guard; curl as employee (403) and tenant_admin (200).
- **Test to add:** Given employee token, when hitting /v1/themes/branding mutation, then 403.
- **Impact if wrong:** Unauthorised tenant re-branding.
- **Web change if wrong:** Add themes/layout.tsx role gate (requireAnyRole) plus ModuleGate.

### GAP-THEMES-TEMPLATES-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Route reachable by any signed-in user: themes has no layout.tsx (no ModuleGate) and middleware.ts checks only the session (middleware.ts:48-59); theme-service role enforcement undeterminable (service absent).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['GET /api/v1/themes/templates (themes/_data.ts:89)']`
- **Question:** Does theme-service gate template routes by role?
- **How to verify:** Open theme-service templates routes; curl as employee and admin.
- **Test to add:** Given employee token, when mutating templates, then 403.
- **Impact if wrong:** Unauthorised template changes.
- **Web change if wrong:** Add themes/layout.tsx role gate.

### GAP-THEMES-TOKENS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Publish is irreversible and tenant-wide ('promotes … to every tenant surface and cannot be undone', ThemeActions.tsx:8-10,62-64) yet the POST body carries only { name, reason } (ThemeActions.tsx:19-23): what is published is not in the request, and the control is shown to every viewer (no role gate: no themes/layout.tsx, middleware.ts:48-59). Server-side authorization and maker-checker are undeterminable (theme-service absent).
- **Service:** `theme-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/themes/publish body {name, reason} (ThemeActions.tsx:19-23)', 'GET /api/v1/themes/tokens']`
- **Question:** What exactly does publish promote (draft token set id/version), is it role-restricted, maker-checker enforced (approver != requester) and audited with the reason?
- **How to verify:** Open theme-service publish handler: how it selects the draft, whether it takes revisionId/expectedVersion, approver check, audit emit.
- **Test to add:** Given draft v3 edited after the user loaded page, when publish without expectedVersion, then server rejects (409) or publishes the pinned v3; requester approving own change gives 403; audit includes reason.
- **Impact if wrong:** Irreversible tenant-wide theme change of unintended content by any user.
- **Web change if wrong:** Send draftId/expectedVersion in the POST body, gate control by role, and surface maker-checker pending state.
