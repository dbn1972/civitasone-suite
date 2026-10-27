# Detailed gap file — module `loyalty`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 18, BACKEND-VERIFY 2



---
## /loyalty  —  `loyalty/home.html`

- **Source:** `apps/web/src/app/(app)/loyalty/page.tsx`
- **Design reference:** `redesign/loyalty/home.html`

### GAP-LOYALTY-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme LOADING

- [x] **Status** (W2 PQ: closed by #w2-loyalty-part-1 -- added retry affordance: all-null stats guard renders a `/loyalty` refresh link)
- **W0 note:** partly fixed by #1924 — hub shows real KPI counts ('—' on failure) and the skeleton matches; no retry affordance on the hub when stats fail.
- **First-pass claim:** Hub has no data: no member/points/redemption counts, so an operator cannot tell whether the programme is healthy; the four-stat-card loading skeleton (loading.tsx:12-20) suggests stats were intended but never built.
- **Verified evidence:** loyalty/page.tsx:12-16 renders only PageHeader + LinkTiles (5 static tiles); no data fetch. loading.tsx:12-20 shows a 4-card stat grid skeleton and a 96-high block, so the skeleton does not match the page shape. Whether a stats endpoint exists cannot be verified (loyalty-service absent).
- **Files to change:** `apps/web/src/app/(app)/loyalty/page.tsx`, `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/loading.tsx`
- **Fix steps:**
  1. Decide the KPIs (active members, points issued, redemptions pending) and confirm an endpoint or derive counts from the list endpoints.
  2. Add getLoyaltyStats loader and render StatGrid/StatCard from app/_components/ds above the tiles; show '—' on error, never 0.
  3. Rewrite loading.tsx with ds SkeletonBar/StatGrid skeleton matching header + 4 stat cards + tiles (drop the 96-high block).
  4. If no stats will be built, shrink the skeleton to header + tile grid.
- **Acceptance:**
  - Manual: hub shows counts; with the API down shows '—' and a retry state.
  - Loading state visually matches final layout (no layout jump).
  - Loader test for error path returns source 'error'.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; showing 0 on failure would mislead operators.
- **Depends on:** GAP-LOYALTY-HOME-04

### GAP-LOYALTY-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Every tile renders the same generic folder emoji: TILE_ICONS has no Programs/Members/Accruals/Redemptions/Tiers entry and no href fallback matches (LinkTiles.tsx:103-154).
- **Verified evidence:** apps/web/src/app/_components/LinkTiles.tsx:8-46 TILE_ICONS has no Programs, Members, Accruals, Redemptions or Tiers keys (only 'Training Programs'); tileIcon (52-59) falls back by href substring dashboard/employees/leave/payroll/procurement/orders, none match /loyalty/*, so all five tiles return the '📁' default at line 58.
- **Files to change:** `apps/web/src/app/_components/LinkTiles.tsx`
- **Fix steps:**
  1. Add TILE_ICONS entries: Programs, Members, Accruals, Redemptions, Tiers with distinct emoji/icons.
  2. Prefer adding an optional icon field to NavTile (packages types) so modules set their own, falling back to TILE_ICONS.
  3. Check other modules for the same default folder icon.
- **Acceptance:**
  - Snapshot/component test: each loyalty tile renders a non-folder icon.
  - Manual: /loyalty shows five distinct icons.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-LOYALTY-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Skeleton (loading.tsx:3-5) uses min-h-screen bg-slate-50 and pulse animations with no dark-mode variant, unlike the ds Skeleton components.
- **Verified evidence:** apps/web/src/app/(app)/loyalty/loading.tsx:3-5 uses className 'min-h-screen bg-slate-50' on the wrapper, bg-white and border-slate-100 cards (13-14) and bg-gray-200 bars, all without dark: variants; ds SkeletonBar exists in app/_components/ds/Skeleton.tsx and is used by meeting/admin/loading.tsx. min-h-screen also nests a full-height block inside the app shell.
- **Files to change:** `apps/web/src/app/(app)/loyalty/loading.tsx`
- **Fix steps:**
  1. Rewrite using SkeletonBar and ds Card/StatGrid so tokens handle dark mode.
  2. Drop min-h-screen and bg-slate-50 wrapper; use the page-main class like page.tsx.
  3. Match the final layout (header + tiles or stats + tiles).
- **Acceptance:**
  - Manual: toggle dark mode, navigate to /loyalty with throttled network; skeleton is dark, no white flash.
  - No tailwind slate/gray literals remain in loading.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /loyalty/accruals  —  `loyalty/accruals.html`

- **Source:** `apps/web/src/app/(app)/loyalty/accruals/page.tsx`
- **Design reference:** `redesign/loyalty/accruals.html`

### GAP-LOYALTY-ACCRUALS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was MONEY)

- [~] **Status** (W2 INTERIM -- NEEDS OWNER DECISION: loyalty-service has no tenant-wide accruals endpoint; page shows per-member points position correctly); page honestly shows per-member points position; NEEDS OWNER DECISION: tenant-wide accruals endpoint or per-member drill-down route)
- **W0 note:** partly fixed by #1924 — points/lifetime now always visible via a zod-typed loader and the drill-down promise is removed; page still lists per-member enrolment positions, not points transactions (no tenant-wide accruals endpoint).
- **First-pass claim:** Accruals page shows no accruals: it lists enrolments (loyalty/_data.ts:90) and points/balance is the LAST option of the meta chain, after code/currency/updatedAt/createdAt (loyalty/_data.ts:61-67), so any row with a timestamp never shows points or balance. The "accrual/balance drill-down" (accruals/page.tsx:16) has no drill-down route.
- **Verified evidence:** apps/web/src/app/(app)/loyalty/_data.ts:91 getLoyaltyAccruals = moduleLoader('/api/v1/loyalty/enrolments') (same as members, line 90 in the read; file lines 88-92). mapRows meta chain (61-67) is code ?? currency ?? updatedAt ?? createdAt ?? points ?? balance, so any row with a string timestamp never surfaces points/balance. accruals/page.tsx:16 describes 'accrual/balance drill-down' but ls shows only loyalty/accruals/page.tsx; no drill-down route. Points are not money, so the paise/formatINR theme does not apply; loyalty-service is absent so real field names cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/accruals/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx (or new loyalty table component)`
- **Fix steps:**
  1. Confirm the real accrual/points-transaction endpoint with loyalty-service (not verifiable here) and add getLoyaltyAccruals against it instead of /enrolments.
  2. Replace the generic mapRows for loyalty with a typed mapper (zod schema at the boundary) producing {member, programme, points, balance, date}.
  3. Render a dedicated table with Points and Balance columns (Intl en-IN grouping) and a date column via formatIndianDate.
  4. Either build /loyalty/accruals/[memberId] or reword the description and drop 'drill-down'.
- **Acceptance:**
  - Unit test: mapper with a row {points: 120, balance: 4500, createdAt} keeps points and balance visible.
  - Manual: accruals page shows transactions, not enrolments, with points earned per row.
  - Description no longer promises a drill-down that does not exist.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Depends on undocumented loyalty-service response shape; wrong mapping would show wrong balances to staff.
- **Depends on:** GAP-LOYALTY-ACCRUALS-02

### GAP-LOYALTY-ACCRUALS-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** Closed by e8a7008cd (service) and dccf96f6d (web) (owner decision D4c #14, 2026-10-27): profile id treated as personal data - shortened, loyalty-role only, full id via audited reveal; names, if ever needed, come via CDP masking rules.
- **W0 note:** partly fixed by #1924 — layout now role-gates /loyalty/* (LOYALTY_READ_ROLES -> PermissionDenied) and the loader is zod-parsed; no <Masked> component / PII masking (member ref is shown shortened only).
- **First-pass claim:** Points transactions ("Points earning transactions and bonus rules", loyalty/page.tsx:8) have no loader at all; only /enrolments is called. Identified person rows are shown without masking (DPDP).
- **Verified evidence:** True: only getLoyaltyAccruals -> /api/v1/loyalty/enrolments exists (_data.ts:91); there is no points-transaction loader and loyalty/page.tsx:8 promises 'Points earning transactions and bonus rules'. Not verifiable: whether enrolment rows carry personal data - the table (ModuleListTable.tsx:48-55) prints only id[0..8], name/label, sublabel, status, meta, and loyalty-service is not in the snapshot. Route protection is only ModuleGate moduleKey='loyalty' (loyalty/layout.tsx) - no role check. No masking component (<Masked>) exists in app/_components.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/layout.tsx`, `apps/web/src/app/_components/Masked.tsx (new, if fields are confirmed PII)`
- **Fix steps:**
  1. Ask loyalty-service owner for the points-transaction endpoint and the fields returned; then add a loader in _data.ts with zod parsing.
  2. Classify which returned fields are personal data (name, phone, email, member no.) per docs/SECURITY.md.
  3. Create a shared <Masked value role-reveal> component and use it for those fields; log reveal via the audit client.
  4. Add a role guard in loyalty/layout.tsx (getSessionRoles) if loyalty data is restricted.
- **Acceptance:**
  - Loader test with mocked fetchJson: transaction rows parsed, invalid rows rejected.
  - Component test: <Masked> shows masked text for a non-privileged role and full text for a privileged one.
  - Manual: unauthorised role cannot open /loyalty/accruals.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII exposure depends on unseen payload; masking wrongly could hide data staff need.
- **Depends on:** GAP-LOYALTY-ACCRUALS-01

### GAP-LOYALTY-ACCRUALS-03  ·  MEDIUM  ·  partly  ·  theme NUMFMT (was MONEY)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Where points print they are `${row.points} pts` / `bal ${row.balance}` raw numbers (loyalty/_data.ts:66-67): no lakh grouping, and no paise conversion should the service store monetary balances as paise (CLAUDE.md).
- **Verified evidence:** _data.ts:66-67 renders `${row.points} pts` and `bal ${row.balance}` from raw numbers without grouping (accurate), and only when no code/currency/timestamp precedes them. However loyalty points are not rupee amounts; paise/formatMoney (lib/formatters.ts:90, minor-unit money) would apply only if balance is monetary, which cannot be verified (loyalty-service absent).
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`
- **Fix steps:**
  1. Confirm with loyalty-service whether balance is points or minor-unit money.
  2. For points: format with new Intl.NumberFormat('en-IN').format(n) in the mapper or in a dedicated loyalty table.
  3. For money: parse as integer paise/string and use formatMoney from lib/formatters.ts; never floats.
  4. Do this together with the mapper rewrite in GAP-LOYALTY-ACCRUALS-01.
- **Acceptance:**
  - Unit test: points 1234567 renders '12,34,567 pts'.
  - If monetary: 250000 paise renders as rupees via formatMoney.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for points; money interpretation must be confirmed to avoid 100x display errors.
- **Depends on:** GAP-LOYALTY-ACCRUALS-01


---
## /loyalty/members  —  `loyalty/members.html`

- **Source:** `apps/web/src/app/(app)/loyalty/members/page.tsx`
- **Design reference:** `redesign/loyalty/members.html`

### GAP-LOYALTY-MEMBERS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Description promises "tier status" but Detail is sublabel = description ?? status ?? state ?? category ?? tier (loyalty/_data.ts:51-59): whenever the enrolment carries a status, Detail just repeats the Status column and the tier is never reachable.
- **Verified evidence:** _data.ts:51-59 sublabel = description ?? status ?? state ?? category ?? tier ?? programName ?? agentId ?? profileId; status column = status ?? state ?? lifecycle (60). When an enrolment has status/state, Detail duplicates Status, and tier is reached only if description, status, state and category are all absent. members/page.tsx:16 promises 'tier status'.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/members/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm enrolment field names (tier, programName, points) with loyalty-service; add a typed getLoyaltyMembers mapper that puts tier in its own field.
  2. Extend ModuleRowSummary (packages types) or create a LoyaltyMemberRow with tier and programme columns.
  3. Render a dedicated members table with Tier and Programme columns, StatusPill for status.
  4. Remove status from the sublabel chain for loyalty.
- **Acceptance:**
  - Unit test: row {status:'active', tier:'Gold'} yields tier 'Gold' in its own column and Detail is not 'active'.
  - Manual: Members page shows a Tier column.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Field names unverified; wrong key gives blank tiers.
- **Depends on:** GAP-LOYALTY-ACCRUALS-01

### GAP-LOYALTY-MEMBERS-02  ·  HIGH  ·  partly  ·  theme PII

- [x] **Status** Closed by dccf96f6d (owner decision D4c #15, 2026-10-27): same ruling as ACCRUALS-02; offline cache no longer stores the full profile id (rows carry only the shortened ref; cache keys moved to v2).
- **W0 note:** partly fixed by #1924 — role gate (PermissionDenied) added and member ref shortened; no <Masked> reveal component and the offline cache still holds the full profileId.
- **First-pass claim:** Members and Accruals both call GET /api/v1/loyalty/enrolments (loyalty/_data.ts:89-90): two pages, one dataset. Enrolments are personal data (DPDP) and are printed with no masking or role gate (ModuleListTable.tsx:50-53, layout.tsx:5).
- **Verified evidence:** True: members and accruals both call /api/v1/loyalty/enrolments (_data.ts:90-91) and ModuleListTable.tsx:48-55 prints rows unmasked; loyalty/layout.tsx only applies ModuleGate (module enabled), no role check. Not verifiable: which fields the enrolment payload holds (id slice, name/label, status, meta only are rendered) - loyalty-service absent, so 'personal data printed' is plausible but unproven. Also the table caches rows in encrypted offline cache via useSeededResource (ModuleListTable.tsx:19).
- **Files to change:** `apps/web/src/app/(app)/loyalty/layout.tsx`, `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/_components/Masked.tsx (new)`
- **Fix steps:**
  1. Confirm payload fields with loyalty-service and classify PII per docs/SECURITY.md.
  2. Add role guard in loyalty/layout.tsx using getSessionRoles for member-level pages.
  3. Create shared <Masked> and apply to identifying fields in the members mapper.
  4. Separate accruals from enrolments (see ACCRUALS-01) so the same dataset is not exposed twice.
- **Acceptance:**
  - Unauthorised role hitting /loyalty/members gets forbidden state.
  - Masked component test for reveal/no-reveal roles.
  - Cached offline copy contains only masked values.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP exposure depends on actual payload; over-masking hampers desk staff.
- **Depends on:** GAP-LOYALTY-ACCRUALS-02

### GAP-LOYALTY-MEMBERS-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Meta shows createdAt/updatedAt as raw ISO strings (2026-08-14T09:12:44Z) because those precede points/balance in the meta chain (loyalty/_data.ts:61-67); no formatting or time zone.
- **Verified evidence:** _data.ts:61-67 meta = code ?? currency ?? updatedAt ?? createdAt ...; toText returns the ISO string unchanged (line 13), and ModuleListTable.tsx:54 prints row.meta as-is, so timestamps show raw (e.g. 2026-08-14T09:12:44Z). formatIndianDate exists in lib/formatters.ts:2 (dd/MM/yyyy en-IN, no explicit IST timezone).
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Return dates as separate fields (updatedAt, createdAt) from the mapper rather than folding into meta.
  2. Render them with formatIndianDate; add timeZone:'Asia/Kolkata' in the formatter if IST is required.
  3. Show a labelled 'Updated' column.
- **Acceptance:**
  - Unit test: '2026-08-14T09:12:44Z' renders '14/08/2026'.
  - Manual: Members meta column shows no ISO 'T...Z' strings.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; UTC dates near midnight can shift a day if IST not applied.
- **Depends on:** GAP-LOYALTY-MEMBERS-01

### GAP-LOYALTY-MEMBERS-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 PQ: closed by #w2-loyalty-part-1 -- getLoyaltyMembers/getLoyaltyAccruals return {rows,total}; pages render "Showing x-y of n" and URL prev/next links)
- **W0 note:** partly fixed by #1924 — DataTable filter/sort + 25/page client paging and server limit/offset (?page=, 50/page) added; no next/prev pager or total in the UI and search is client-side only.
- **First-pass claim:** No search, filter or pagination for what will be a large enrolment list; the whole response is rendered (ModuleListTable.tsx:63-80).
- **Verified evidence:** ModuleListTable.tsx:48-55 maps all data rows with no search, filter, sort or pagination; loader is a single GET /api/v1/loyalty/enrolments with no query params (_data.ts:90). Server pagination support cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/members/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm loyalty-service list params (page/limit/q/status) and response totals.
  2. Read searchParams in members/page.tsx and pass page, q, status to the loader.
  3. Add search input + pager to a members table (ds DataTable) driven by URL params.
  4. Show total count and 'Showing x-y of n'.
- **Acceptance:**
  - Manual: 1000 enrolments show 25 per page with next/prev and total.
  - Search by name updates URL and results server-side.
  - Test: loader builds query string from params.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; caching key must include query to avoid cross-page stale cache.


---
## /loyalty/programs  —  `loyalty/programs.html`

- **Source:** `apps/web/src/app/(app)/loyalty/programs/page.tsx`
- **Design reference:** `redesign/loyalty/programs.html`

### GAP-LOYALTY-PROGRAMS-01  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** ModuleListTable prints only the first 8 characters of the row id in a mono cell as the first column (ModuleListTable.tsx:50); for UUID-keyed programmes that is a meaningless fragment, and rows have no link (no /loyalty/programs/[id] route exists).
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0,8) in a mono span as first column; mapRows id (_data.ts:24-33) is id ?? key ?? code ?? name..., so for UUIDs it is a fragment. Rows are not links; ls shows no loyalty/programs/[id] route.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Drop the ID column (or move it into a copy-on-click tooltip) and make Name the first column.
  2. Add optional href builder prop to ModuleListPage/ModuleListTable and link the name when a detail route exists.
  3. Because this shared table is used by ~64 files (grep ModuleListTable/ModuleListPage), make this a prop with sane default and roll out module by module.
- **Acceptance:**
  - Programs list first column is programme name, no 8-char hex fragments.
  - Component test: with href prop the name is an anchor.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; change touches many modules - verify snapshots.

### GAP-LOYALTY-PROGRAMS-02  ·  MEDIUM  ·  confirmed  ·  theme MISSINGFEATURE (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only list although the home tile says "Create and manage loyalty programmes" (loyalty/page.tsx:6): there is no create/edit control anywhere under (app)/loyalty; status renders as raw lowercase text with no pill (ModuleListTable.tsx:53).
- **Verified evidence:** loyalty/page.tsx:6 says 'Create and manage loyalty programmes'; programs/page.tsx renders ModuleListPage only; grep of loyalty tree finds no fetch method/mutation and no create/edit route (only page/_data/loading/error/layout). ModuleListTable.tsx:53 prints row.status raw; StatusPill exists in ds.
- **Files to change:** `apps/web/src/app/(app)/loyalty/programs/page.tsx`, `apps/web/src/app/(app)/loyalty/programs/new/page.tsx (new)`, `apps/web/src/app/(app)/loyalty/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Decide scope: build create/edit (needs loyalty-service POST/PATCH endpoints, unverified) or reword tile to 'View loyalty programmes'.
  2. If building, add a form with zod validation, idempotency key and audit-friendly reason for edits.
  3. Render status through StatusPill with humanizeStatus (lib/formatters.ts:44) in the shared table.
  4. Hide the action for roles without manage rights.
- **Acceptance:**
  - Tile copy matches capabilities.
  - If built: create programme end-to-end, list refreshes, validation errors shown.
  - Status column shows a pill, not raw lowercase.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Programme config drives point liabilities; needs approval flow and audit if made editable.
- **Depends on:** GAP-LOYALTY-PROGRAMS-01


---
## /loyalty/redemptions  —  `loyalty/redemptions.html`

- **Source:** `apps/web/src/app/(app)/loyalty/redemptions/page.tsx`
- **Design reference:** `redesign/loyalty/redemptions.html`

### GAP-LOYALTY-REDEMPTIONS-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** A failed fetch renders the badge "Couldn't load - showing nothing" AND the calm EmptyState "No records / Nothing to show yet for this module." with no retry (ModuleListTable.tsx:33,35; ModuleListPage.tsx:28); a clerk can read it as "no redemptions" - risky for reward fulfilment.
- **Verified evidence:** ModuleListTable.tsx:33 DataSourceBadge shows 'Couldn't load - showing nothing' for provenance error-no-data (DataSourceBadge.tsx:73-74) and line 34-35 renders EmptyState 'No records / Nothing to show yet for this module.' whenever data.length===0, with no source check and no retry. ModuleListPage.tsx:90 passes source. RefreshErrorState (ds) with router.refresh retry exists. Same shared table is used by ~64 pages.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. In ModuleListTable read provenance from useSeededResource; when provenance==='error-no-data' render <RefreshErrorState error={toHumanError('load',{area:title})} backHref=...> instead of EmptyState.
  2. Keep EmptyState only for provenance live with zero rows.
  3. Remove the amber badge in the error branch to avoid double messaging.
  4. Add optional backHref prop passed by ModuleListPage.
- **Acceptance:**
  - Component test: source='error', no cache -> retry button visible, 'No records' text absent.
  - Component test: source='api', [] -> EmptyState shown.
  - Manual: kill gateway, load /loyalty/redemptions, see error with Retry.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Shared component; behavior change on all ModuleListPage screens - intended.

### GAP-LOYALTY-REDEMPTIONS-02  ·  MEDIUM  ·  confirmed  ·  theme MISSINGFEATURE (was DATEFMT)

- [~] **Status** (W2 INTERIM -- NEEDS OWNER DECISION: loyalty-service has no fulfil/reject endpoint; Void-only flow is the correct interim)
- **W0 note:** partly fixed by #1924 — dedicated table with Reward/Points/Status/Requested/Voided columns and an admin Void action (reason required); no fulfil/reject flow (loyalty-service has no such endpoint) and no Fulfilled column.
- **First-pass claim:** Redemption history has no points-spent, reward, amount or fulfilment-date column, only generic Detail/Meta (ModuleListTable.tsx:40-44); pending/rejected redemptions cannot be actioned - no mutation code in the route tree.
- **Verified evidence:** ModuleListTable.tsx:37-46 fixed generic columns ID/Name/Detail/Status/Meta; no points-spent, reward, or fulfilment date. Loyalty tree has no mutation code (no method: POST etc.), so pending redemptions cannot be approved/fulfilled. The DATEFMT tag is wrong. Backend endpoints for fulfil/reject cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/redemptions/page.tsx`, `apps/web/src/app/(app)/loyalty/redemptions/RedemptionActions.tsx (new)`
- **Fix steps:**
  1. Get redemption schema and fulfil/reject endpoints from loyalty-service.
  2. Add typed getLoyaltyRedemptions mapper (zod) with member, reward, points, status, requestedAt, fulfilledAt.
  3. Render dedicated table with formatIndianDate for dates and StatusPill.
  4. Add fulfil/reject actions using ConfirmDialog (reason on reject), idempotency key, and audit event via backend.
- **Acceptance:**
  - Table shows Reward, Points, Requested, Fulfilled columns.
  - Pending redemption can be fulfilled and status updates.
  - Reject requires reason.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Reward fulfilment has financial impact; double-fulfil must be prevented by idempotency/optimistic version.
- **Depends on:** GAP-LOYALTY-REDEMPTIONS-01

### GAP-LOYALTY-REDEMPTIONS-03  ·  LOW  ·  partly  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** label falls back through name/title/label/code/type/entityType/direction (loyalty/_data.ts:42-50), so a redemption with only a type shows a raw token.
- **Verified evidence:** _data.ts:41-50 label = name ?? title ?? label ?? code ?? type ?? entityType ?? direction ?? id, so a redemption without name/title shows a raw type token or finally the full id. It is a data-mapping/labelling problem, not i18n; strings in the shared table are also hard-coded English (ModuleListTable.tsx:35-44) but that is not what the finding describes.
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`
- **Fix steps:**
  1. Use the typed mapper for redemptions: label = reward name (or programme + member), fall back to humanizeStatus-style label (lib/formatters.ts:44) for enum tokens.
  2. Never fall back to the raw id as label; show '—'.
  3. Drop entityType/direction from the loyalty chain.
- **Acceptance:**
  - Unit test: row {type:'POINTS_REDEEM'} yields 'Points redeem' not raw token.
  - Row with no name shows '—' rather than a UUID.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LOYALTY-REDEMPTIONS-02


---
## /loyalty/tiers  —  `loyalty/tiers.html`

- **Source:** `apps/web/src/app/(app)/loyalty/tiers/page.tsx`
- **Design reference:** `redesign/loyalty/tiers.html`

### GAP-LOYALTY-TIERS-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Tiers page is the Programs list again: getLoyaltyTiers calls GET /api/v1/loyalty/programs (loyalty/_data.ts:92) and prints programme rows; no tier names, thresholds or benefits appear although the home tile promises "Tier definitions, thresholds, and benefits" (loyalty/page.tsx:10).
- **Verified evidence:** _data.ts:92 getLoyaltyTiers = moduleLoader('/api/v1/loyalty/programs','loyalty.tiers'), i.e. identical endpoint to getLoyaltyPrograms (line 88); tiers/page.tsx feeds it to ModuleListPage, so programme rows appear. loyalty/page.tsx:10 promises 'Tier definitions, thresholds, and benefits'. A dedicated tiers endpoint or nested tiers in the programme payload cannot be verified (loyalty-service absent).
- **Files to change:** `apps/web/src/app/(app)/loyalty/_data.ts`, `apps/web/src/app/(app)/loyalty/tiers/page.tsx`
- **Fix steps:**
  1. Confirm whether tiers are a separate endpoint or nested in the programme response.
  2. Write getLoyaltyTiers to fetch that source and flatten to {programme, tier, threshold, benefits}.
  3. Render a dedicated table with Threshold (points) and Benefits columns.
  4. If no tier data is exposed, remove the Tiers tile/page until backend exists.
- **Acceptance:**
  - Tiers page lists tier names with thresholds, not programme rows.
  - Loader test with nested tiers fixture flattens correctly.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong endpoint mapping would mislead about eligibility thresholds.

### GAP-LOYALTY-TIERS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 9c5e9e9e9)
- **First-pass claim:** Description "Tier definitions via programme configuration" (tiers/page.tsx:16) admits the data is indirect; nothing shows where tiers are configured and there is no edit control.
- **Verified evidence:** tiers/page.tsx description 'Tier definitions via programme configuration.' and the page has no link to programs and no edit control; no mutation code in the loyalty tree.
- **Files to change:** `apps/web/src/app/(app)/loyalty/tiers/page.tsx`
- **Fix steps:**
  1. Add a link or note pointing to the programme where tiers are configured (e.g. /loyalty/programs) or to the future editor.
  2. Replace the description with plain wording of what the page shows.
  3. If editing is planned, track under GAP-LOYALTY-PROGRAMS-02.
- **Acceptance:**
  - Tiers page tells the user where tiers are edited via a working link.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LOYALTY-TIERS-01, GAP-LOYALTY-PROGRAMS-02

### GAP-LOYALTY-TIERS-03  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 PQ: closed by #w2-loyalty-part-1 -- Programme short ref now a Link to /loyalty/programs with full UUID in title; navigable reference not an orphan fragment)
- **W0 note:** partly fixed by #1924 — tier name is now the first column, but the Programme column still renders an 8-char UUID prefix; no status pill (tier defs carry no status).
- **First-pass claim:** Same shared table: 8-char id fragment, raw status text, raw meta (ModuleListTable.tsx:50-53).
- **Verified evidence:** Duplicate of PROGRAMS-01: ModuleListTable.tsx:50 id.slice(0,8), :53 raw status, :54 raw meta; tiers page uses the same table.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Fixed by the shared-table changes in GAP-LOYALTY-PROGRAMS-01 (drop id column) and PROGRAMS-02 (StatusPill).
  2. Format meta via typed mapper (see MEMBERS-03).
- **Acceptance:**
  - Tiers list shows no 8-char id fragments and a status pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-LOYALTY-PROGRAMS-01, GAP-LOYALTY-PROGRAMS-02


---
## Backend verification items (service code absent from snapshot)

### GAP-LOYALTY-HOME-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: ALREADY-FIXED -- verified: loyalty-service GET routes all call requireRole(ctx, READ_ROLES); layout.tsx adds hasAnyRole(LOYALTY_READ_ROLES) web gate)
- **First-pass claim:** All five sub-pages depend on loyalty-service via the gateway (loyalty/_data.ts:88-92), absent from this snapshot: contract, roles and audit are undeterminable. Tiles are shown to all users regardless of role.
- **Service:** `loyalty-service`  ·  **Endpoint(s):** `['GET /api/v1/loyalty/programs', '/enrolments', '/redemptions']`
- **Question:** Which roles may read each loyalty endpoint and are member records scoped/audited?
- **How to verify:** Open loyalty-service route guards; curl each endpoint with employee vs loyalty admin JWT.
- **Test to add:** Given employee token, when GET enrolments, then 403 or own-record only.
- **Impact if wrong:** Member PII and balances visible to all users.
- **Web change if wrong:** Add role gate in loyalty/layout.tsx and hide tiles per role.

### GAP-LOYALTY-PROGRAMS-03  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: ALREADY-FIXED -- verified: programs/repo.ts toView() returns name:r.name (NOT NULL); _data.ts uses z.string() required; UUID fallback cannot occur)
- **First-pass claim:** Generic mapRows guesses fields (name/title/label/code/type... then id), so a programme without a name shows its full raw id as Name (loyalty/_data.ts:32-50); loyalty-service is absent from the snapshot so the true shape is undeterminable.
- **Service:** `loyalty-service`  ·  **Endpoint(s):** `['GET /api/v1/loyalty/programs']`
- **Question:** What is the exact programme response shape and is name always present?
- **How to verify:** Open loyalty-service programs DTO/schema; curl GET and inspect keys; check name is NOT NULL.
- **Test to add:** Given programme created via API, when GET list, then each item has non-empty name.
- **Impact if wrong:** Raw UUIDs shown as names.
- **Web change if wrong:** Replace generic mapRows in loyalty/_data.ts:32-50 with typed mapping.
