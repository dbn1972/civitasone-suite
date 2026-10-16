# Detailed gap file — module `recommendations`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 16, BACKEND-VERIFY 4



---
## /recommendations  —  `recommendations/home.html`

- **Source:** `apps/web/src/app/(app)/recommendations/page.tsx`
- **Design reference:** `redesign/recommendations/home.html`

### GAP-RECOMMENDATIONS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Hub promises "Real-time recommendations" and "churn prediction" but every child is the same generic 5-column ID/Name/Detail/Status/Meta list (recommendations/*/page.tsx, ModuleListTable.tsx:34-46).
- **Verified evidence:** recommendations/page.tsx:6-9 descriptions promise 'Real-time recommendations', 'churn prediction', 'analytics'; all four child pages (nba, matrix, health, feedback) use identical ModuleListPage -> ModuleListTable 5-column list (ModuleListTable.tsx:37-57). The NBA endpoint is /predictive, refreshed with revalidate 30s (_data.ts:79-85), not real-time push.
- **Files to change:** `apps/web/src/app/(app)/recommendations/page.tsx`
- **Fix steps:**
  1. Reword tile descriptions to what is shown ('Recent next-best-action signals', 'Cross-sell affinity list', 'At-risk accounts', 'Recorded feedback').
  2. Or build purpose-built views (see HEALTH-01, MATRIX-02, FEEDBACK-01).
- **Acceptance:**
  - Hub copy matches the content of each child page.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECOMMENDATIONS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Tiles carry no counts or status, so a clerk cannot tell whether anything needs action (page.tsx:5-10).
- **Verified evidence:** recommendations/page.tsx:5-10 static NavTile[] with title, description, href only; LinkTiles is fed no counts. Data would need four extra fetches (_data.ts loaders exist).
- **Files to change:** `apps/web/src/app/(app)/recommendations/page.tsx`
- **Fix steps:**
  1. Make Page async, call getRecNba/getRecHealth/getRecFeedback with Promise.all.
  2. Show count (e.g. at-risk accounts, open suggestions) as tile badge if NavTile supports it, else add StatGrid above tiles.
  3. Show '—' on error, not 0.
- **Acceptance:**
  - Tiles show counts from fixtures.
  - One failed endpoint does not blank the hub.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; adds four server fetches, keep revalidate.

### GAP-RECOMMENDATIONS-HOME-03  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** loading.tsx draws four stat cards and a 24rem block; the loaded hub has neither (loading.tsx:12-21), so the skeleton jumps.
- **Verified evidence:** recommendations/loading.tsx:12-21 draws 4 stat cards and :21 a h-96 block, while the loaded page (page.tsx:12-18) is a header plus LinkTiles only; also uses tailwind min-h-screen and inline pulse animation unlike the .skeleton pattern elsewhere.
- **Files to change:** `apps/web/src/app/(app)/recommendations/loading.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx as header placeholder plus 4 tile-shaped blocks in a grid matching LinkTiles columns='four'.
  2. Use the shared .skeleton class.
- **Acceptance:**
  - No layout shift between skeleton and loaded hub.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-RECOMMENDATIONS-HOME-04  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Gate key is "recommendation" while route and nav are "recommendations" (layout.tsx:5) — works only via fuzzy match in isModuleEnabled; a tenant flag named "recommendations" is ambiguous.
- **Verified evidence:** recommendations/layout.tsx:5 moduleKey='recommendation'; lib/moduleVisibility.ts:44-45 isModuleEnabled matches name===key || name.includes(key) || key.includes(name), so 'recommendations' enabled matches via includes. Works but bidirectional substring matching is loose (a short name could match other modules).
- **Files to change:** `apps/web/src/app/(app)/recommendations/layout.tsx`, `apps/web/src/lib/moduleVisibility.ts`
- **Fix steps:**
  1. Determine the canonical module id used in tenant entitlements and use exactly that in layout.tsx.
  2. Tighten isModuleEnabled to exact match after aliasing, with a test for recommendation(s).
- **Acceptance:**
  - Layout key equals entitlement key.
  - Unit test: enabled ['recommendations'] enables the route; ['recommendation'] handled explicitly per decision.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Tightening matching could hide modules for tenants with legacy flag names; check tenant data.


---
## /recommendations/feedback  —  `recommendations/feedback.html`

- **Source:** `apps/web/src/app/(app)/recommendations/feedback/page.tsx`
- **Design reference:** `redesign/recommendations/feedback.html`

### GAP-RECOMMENDATIONS-FEEDBACK-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** "Analytics" without any aggregate: no acceptance rate, count or chart — only a raw event list (feedback/page.tsx:16-19, ModuleListTable.tsx).
- **Verified evidence:** recommendations/feedback/page.tsx:14-19 passes rows to ModuleListPage with description 'Acceptance and rejection analytics.'; ModuleListTable.tsx renders only a 5-column row list (:37-57). No counts, rates or charts. Endpoint /api/v1/recommendations/feedback (_data.ts:91) shape unknown; recommendation-service absent, so whether an aggregate endpoint exists cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/recommendations/feedback/page.tsx`, `apps/web/src/app/(app)/recommendations/_data.ts`
- **Fix steps:**
  1. Compute counts from rows client-side: accepted, rejected, total, acceptance rate, rendered as StatGrid/StatCard above the table (status field is already mapped in _data.ts:60).
  2. Or rename the page/description to 'Feedback log' until an aggregate endpoint exists.
  3. If backend offers aggregates, add a typed loader with zod.
- **Acceptance:**
  - Fixture of 3 accepted and 1 rejected shows 75% acceptance tile.
  - Empty data shows '—' not 0%.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-RECOMMENDATIONS-FEEDBACK-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by this PR; FeedbackSummaryView with typed loader (rejection-summary endpoint) replaces generic ModuleListTable; acceptance: named columns with consistent meaning verified in _data.ts and FeedbackSummaryView.tsx)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:50) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-62), so a column can mean different things per row.
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0,8); _data.ts:32-67 mapRows picks id/label/sublabel/status/meta from cascades of ~10 alternative keys (e.g. sublabel falls back description>status>state>category>tier>programName>agentId>profileId; meta code>currency>updatedAt>createdAt>points>balance), so semantics vary per row, and sublabel often duplicates status. Also id falls back to name or 'row-N'.
- **Files to change:** `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/recommendations/feedback/page.tsx`
- **Fix steps:**
  1. Get the real response shapes from recommendation-service and define per-endpoint zod schemas + typed row types in _data.ts.
  2. Add a columns prop to ModuleListPage/ModuleListTable (or use DataTable) so each page declares its own columns and formats.
  3. Stop truncating ids; show full id with copy or hide it.
- **Acceptance:**
  - Feedback table shows explicitly named columns (e.g. Recommendation, Outcome, Recorded at).
  - Malformed rows fail zod and surface the error state.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; affects all ModuleListPage users if the shared component changes, so add columns as optional.

### GAP-RECOMMENDATIONS-FEEDBACK-03  ·  LOW  ·  confirmed  ·  theme STATUS

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Status is printed as plain text with no StatusPill styling, so accepted and rejected look identical (ModuleListTable.tsx:53).
- **Verified evidence:** ModuleListTable.tsx:53 renders `{row.status ?? '—'}` as plain text; StatusPill (ds/StatusPill.tsx) is not imported in this file. 'accepted' is also not in STATUS_MAP; 'rejected' is (bad).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Import StatusPill from ./ds and render `row.status ? <StatusPill status={row.status}/> : '—'`.
  2. Add 'accepted': 'good' (and 'dismissed'/'ignored': 'mut' once the enum is known) to STATUS_MAP.
- **Acceptance:**
  - Accepted renders a green pill, rejected a red pill.
  - Missing status still shows '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared table used by many modules; status text becomes humanized capitalised text.


---
## /recommendations/health  —  `recommendations/health.html`

- **Source:** `apps/web/src/app/(app)/recommendations/health/page.tsx`
- **Design reference:** `redesign/recommendations/health.html`

### GAP-RECOMMENDATIONS-HEALTH-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Health Scores page shows no score: the endpoint is /health/at-risk and the table has no numeric or trend column, only a guessed status string (_data.ts:36-53, ModuleListTable.tsx:53), so nothing tells a clerk who to call first.
- **Verified evidence:** health/page.tsx:8 uses getRecHealth -> /api/v1/recommendations/health/at-risk (_data.ts:90). The table (ModuleListTable.tsx:37-57) has no score, trend or sort; ordering is whatever the API returns. Response fields unknown (service absent), so whether a score is even returned is cannot-verify; mapRows would show a numeric score only as bal/points meta if named so.
- **Files to change:** `apps/web/src/app/(app)/recommendations/health/page.tsx`, `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm at-risk payload fields (score, band, trend, reason, lastContact) with recommendation-service.
  2. Add a typed loader + dedicated HealthTable (DataTable) with Score, Band (StatusPill), Trend, Reason columns, default sorted by score ascending.
  3. Rename page title to 'At-risk accounts' if no score is provided.
- **Acceptance:**
  - Highest-risk account appears first with visible numeric score.
  - Table sort by score works.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-RECOMMENDATIONS-FEEDBACK-02

### GAP-RECOMMENDATIONS-HEALTH-02  ·  MEDIUM  ·  partly  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** At-risk accounts are business names/contacts of customers; the table prints label/sublabel verbatim with no role gate or masking beyond ModuleGate (DPDP) (ModuleListTable.tsx:51-52).
- **Verified evidence:** ModuleListTable.tsx:51-52 prints row.label and row.sublabel verbatim; access is gated only by ModuleGate (layout.tsx:5, tenant module flag), not by role. Whether at-risk rows carry personal data (customer names/contacts) is not verifiable; ModuleRowSummary only has label/sublabel/meta. For business accounts this is CRM-level data normally visible to the role.
- **Files to change:** `apps/web/src/app/(app)/recommendations/health/page.tsx`, `apps/web/src/app/(app)/recommendations/layout.tsx`
- **Fix steps:**
  1. Confirm with backend which fields the at-risk endpoint returns and whether they include individual contact data.
  2. Enforce a role/permission check (existing PermissionDenied component) on the recommendations routes matching service RBAC.
  3. Mask contact fields if present via the shared masking helper and audit reveal.
- **Acceptance:**
  - User without the CRM permission sees PermissionDenied.
  - No phone/email appear unmasked in rendered HTML.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** DPDP exposure if contacts are returned; server-side RBAC must be the real control.

### GAP-RECOMMENDATIONS-HEALTH-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by this PR; HealthTable (typed HealthRow loader with zod schema) replaces ModuleListTable; Account / Score / Band / Updated columns have fixed meaning per row)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:50) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-62), so a column can mean different things per row.
- **Verified evidence:** Same generic mapping as FEEDBACK-02: ModuleListTable.tsx:50 slices id to 8 chars; _data.ts:32-67 cascades keys for label/sublabel/status/meta.
- **Files to change:** `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/recommendations/health/page.tsx`
- **Fix steps:**
  1. Duplicate of GAP-RECOMMENDATIONS-FEEDBACK-02: fix once with per-endpoint typed rows and a columns prop.
  2. Health page columns: Account, Score, Band, Reason, Updated.
- **Acceptance:**
  - Columns have fixed meaning for every row on this page.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-RECOMMENDATIONS-FEEDBACK-02


---
## /recommendations/matrix  —  `recommendations/matrix.html`

- **Source:** `apps/web/src/app/(app)/recommendations/matrix/page.tsx`
- **Design reference:** `redesign/recommendations/matrix.html`

### GAP-RECOMMENDATIONS-MATRIX-01  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W2 PQ: closed by this PR; matrix/page.tsx subtitle is 'Product affinity rules (read-only).' — no longer claims 'configuration')
- **First-pass claim:** Described as "configuration" but the page is read-only: no add, edit or disable rule control anywhere in the tree (matrix/page.tsx:14-19).
- **Verified evidence:** matrix/page.tsx:14-19 description 'Product affinity rules and cross-sell configuration.' (page.tsx:16), page renders ModuleListPage only; no create/edit/disable controls exist in recommendations/ tree (files: nba, matrix, health, feedback pages, _data.ts with GET loaders only). Write endpoints in recommendation-service cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/recommendations/matrix/page.tsx`
- **Fix steps:**
  1. Reword to 'Product affinity rules (read-only)' until editing exists.
  2. If rule management is required, add write endpoints with audit events, then a form with zod validation and a disable toggle.
- **Acceptance:**
  - Copy no longer says 'configuration' for a read-only view.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy; rule editing is an L feature.

### GAP-RECOMMENDATIONS-MATRIX-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** An affinity matrix is rendered as a flat list, so source product, target product and weight are squeezed into Name/Detail (ModuleListTable.tsx:50-54).
- **Verified evidence:** matrix/page.tsx uses generic ModuleListPage; ModuleListTable.tsx:50-54 has only ID/Name/Detail/Status/Meta, and _data.ts:42-59 has no source/target/weight fields, so a rule's source product, target product and weight land in label/sublabel/meta by key-name luck. Real response shape not visible.
- **Files to change:** `apps/web/src/app/(app)/recommendations/matrix/page.tsx`, `apps/web/src/app/(app)/recommendations/_data.ts`
- **Fix steps:**
  1. Get the /recommendations/matrix payload shape; define zod schema.
  2. Build MatrixTable with columns Source, Target, Weight/Lift, Status (DataTable, numeric sort), or a grid heatmap if data is dense.
  3. Reuse the loader with responseSchema instead of mapRows.
- **Acceptance:**
  - Each rule shows source, target and weight in separate columns.
  - Sorting by weight is numeric.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-RECOMMENDATIONS-FEEDBACK-02

### GAP-RECOMMENDATIONS-MATRIX-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 PQ: closed by this PR; MatrixTable (typed MatrixRuleRow loader) replaces ModuleListTable; Source Product / Target Product / Weight / Priority columns have fixed meaning per row)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:50) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-62), so a column can mean different things per row.
- **Verified evidence:** Same as FEEDBACK-02: ModuleListTable.tsx:50 slice(0,8) id; _data.ts:32-67 key-guessing cascades.
- **Files to change:** `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/recommendations/matrix/page.tsx`
- **Fix steps:**
  1. Duplicate of GAP-RECOMMENDATIONS-FEEDBACK-02: fix once with typed per-endpoint rows and columns prop.
- **Acceptance:**
  - Matrix columns have fixed meaning for every row.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-RECOMMENDATIONS-FEEDBACK-02


---
## /recommendations/nba  —  `recommendations/nba.html`

- **Source:** `apps/web/src/app/(app)/recommendations/nba/page.tsx`
- **Design reference:** `redesign/recommendations/nba.html`

### GAP-RECOMMENDATIONS-NBA-01  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Subtitle leaks an internal service name — "Predictive / NBA signals from recommendation-service." (nba/page.tsx:16); clerks see infrastructure jargon.
- **Verified evidence:** nba/page.tsx:16 passes description="Predictive / NBA signals from recommendation-service." to ModuleListPage, rendered as visible subtitle. It is a raw service name; no recommendation-service exists in this snapshot (only services/hrms-service). Theme WIRING is wrong: it is copy.
- **Files to change:** `apps/web/src/app/(app)/recommendations/nba/page.tsx`
- **Fix steps:**
  1. In nba/page.tsx:16 replace description with user-facing copy, e.g. "Suggested next steps for each customer or record, based on recent activity."
  2. Check sibling pages (matrix, health, feedback) under (app)/recommendations for the same 'from recommendation-service' pattern and fix together
  3. If next-intl is wired for this route group, move title/description to a message key
- **Acceptance:**
  - Page subtitle contains no hyphenated service name (grep 'recommendation-service' under apps/web/src/app returns no user-visible strings)
  - Manual: /recommendations/nba shows plain-language subtitle
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None; copy only.

### GAP-RECOMMENDATIONS-NBA-02  ·  MEDIUM  ·  partly  ·  theme WIRING (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** A "next best action" list with no customer, no recommended action and no accept/reject control: the row is only id[0:8]/label/sublabel/status/meta guessed from ~10 keys (_data.ts:32-62, ModuleListTable.tsx:50-54).
- **Verified evidence:** True that the UI shows only ID/Name/Detail/Status/Meta: ModuleListTable.tsx:40-54 renders row.id.slice(0,8), label, sublabel, status, meta, and _data.ts:28-77 mapRows guesses each from ~8-10 alternative keys (name/title/label/code/type..., description/status/state/category/tier..., status/state/lifecycle, code/currency/updatedAt/points/balance). No customer, recommended-action or accept/reject control exists. Cannot verify what /api/v1/recommendations/predictive actually returns (recommendation-service absent from snapshot), so whether the payload even has customer/action fields is unknown. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/recommendations/nba/page.tsx`, `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `packages/types (new NbaRecommendation type)`
- **Fix steps:**
  1. Confirm real /api/v1/recommendations/predictive response shape with backend owner (subject/entity, action, score, status, id)
  2. Add a typed NbaRecommendation in @civitasone/types and a dedicated getRecNba mapper in _data.ts (zod parse at boundary) instead of the generic mapRows
  3. Create NbaTable component with columns Subject, Recommended action, Confidence, Status and Accept/Dismiss buttons calling a documented endpoint (only if backend provides one; else read-only)
  4. Use NbaTable in nba/page.tsx in place of ModuleListPage; keep RefreshErrorState when source==='error'
  5. Remove the generic-key guesses for this loader
- **Acceptance:**
  - Component test: given a payload with subject/action/score the table renders those columns, not an 8-char id
  - Accept/Dismiss (if built) posts once and updates row status; error shows inline message
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Building accept/reject without a backend contract would be a fabricated feature; gate on API confirmation.
- **Depends on:** GAP-RECOMMENDATIONS-NBA-03

### GAP-RECOMMENDATIONS-NBA-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W2 PQ: closed by this PR; NbaTable (typed NbaScoreRow loader) replaces ModuleListTable; Subject / Model / Score / Confidence / Updated columns; id.slice(0,8) replaced by formatSubjectRef; sublabel/status duplication gone)
- **First-pass claim:** Generic table: ID is row.id.slice(0, 8) (ModuleListTable.tsx:50) and Detail/Status/Meta are guessed from whichever of ~10 keys exist (_data.ts:36-62), so a column can mean different things per row.
- **Verified evidence:** ModuleListTable.tsx:50 renders row.id.slice(0,8); _data.ts:32-41 id falls back through id/key/code/name/agentId/profileId/accountId/conversationId/'row-N', label 42-50, sublabel 51-59 (description, else status, ... else agentId), meta 61-67 (code, currency, updatedAt, createdAt, points, balance). Sublabel and Status can duplicate (status is a sublabel fallback), and meta can be a code, timestamp or points depending on the row. Same shared loader serves all recommendations pages.
- **Files to change:** `apps/web/src/app/(app)/recommendations/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/recommendations/nba/page.tsx`
- **Fix steps:**
  1. Replace generic mapRows for getRecNba with an explicit typed mapper per known field (see NBA-02)
  2. Stop using row.id.slice(0,8) as an identifier column for the NBA table; show subject name and link to it
  3. Drop the sublabel->status fallback so the Detail and Status columns never repeat
  4. Format meta timestamps with formatIndianDate (lib/formatters.ts) in a labelled 'Updated' column
- **Acceptance:**
  - Unit test on mapper: row with status only yields sublabel undefined
  - Component test: two rows with different key sets render values under identical, consistently named columns
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Other pages sharing ModuleListTable must be left unchanged.
- **Depends on:** GAP-RECOMMENDATIONS-NBA-02


---
## Backend verification items (service code absent from snapshot)

### GAP-RECOMMENDATIONS-FEEDBACK-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: verified — recommendation-service present; rejection-summary GET uses resolveContext + requireRole (REC_ROLES) = 401 without token, 403 wrong role; web side now calls /feedback/rejection-summary (no per-recommendation required); N/A for unbounded: requireRole enforced)
- **First-pass claim:** recommendation-service is absent from the snapshot; auth, pagination and shape of /api/v1/recommendations/feedback are undeterminable.
- **Service:** `recommendation-service`  ·  **Endpoint(s):** `['GET /api/v1/recommendations/feedback']`
- **Question:** Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
- **How to verify:** Open the route in recommendation-service; curl /api/v1/recommendations/feedback without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
- **Test to add:** Given no token, when GET /api/v1/recommendations/feedback, then 401; given a token, then 200 with array items matching the schema.
- **Impact if wrong:** Unauthenticated or unbounded data exposure.
- **Web change if wrong:** Add pagination controls and zod schema in loader.

### GAP-RECOMMENDATIONS-HEALTH-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: verified — health/scoring-routes.ts GET /v1/recommendations/health/at-risk uses resolveContext + requireRole + limit param (max 200); 401 without token, 403 wrong role; paginated)
- **First-pass claim:** recommendation-service is absent from the snapshot; auth, pagination and shape of /api/v1/recommendations/health/at-risk are undeterminable.
- **Service:** `recommendation-service`  ·  **Endpoint(s):** `['GET /api/v1/recommendations/health/at-risk']`
- **Question:** Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
- **How to verify:** Open the route in recommendation-service; curl /api/v1/recommendations/health/at-risk without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
- **Test to add:** Given no token, when GET /api/v1/recommendations/health/at-risk, then 401; given a token, then 200 with array items matching the schema.
- **Impact if wrong:** Unauthenticated or unbounded data exposure.
- **Web change if wrong:** Add pagination controls and zod schema in loader.

### GAP-RECOMMENDATIONS-MATRIX-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: verified — matrix/routes.ts GET /v1/recommendations/matrix uses resolveContext + requireRole + limit/offset (max 200); 401 without token, 403 wrong role; paginated)
- **First-pass claim:** recommendation-service is absent from the snapshot; auth, pagination and shape of /api/v1/recommendations/matrix are undeterminable.
- **Service:** `recommendation-service`  ·  **Endpoint(s):** `['GET /api/v1/recommendations/matrix']`
- **Question:** Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
- **How to verify:** Open the route in recommendation-service; curl /api/v1/recommendations/matrix without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
- **Test to add:** Given no token, when GET /api/v1/recommendations/matrix, then 401; given a token, then 200 with array items matching the schema.
- **Impact if wrong:** Unauthenticated or unbounded data exposure.
- **Web change if wrong:** Add pagination controls and zod schema in loader.

### GAP-RECOMMENDATIONS-NBA-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: verified — predictive/routes.ts GET /v1/recommendations/predictive uses resolveContext + requireRole + limit/offset (max 200, READ_ROLES); 401 without token, 403 wrong role; paginated)
- **First-pass claim:** recommendation-service is absent from the snapshot; auth, pagination and shape of /api/v1/recommendations/predictive are undeterminable.
- **Service:** `recommendation-service`  ·  **Endpoint(s):** `['GET /api/v1/recommendations/predictive']`
- **Question:** Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
- **How to verify:** Open the route in recommendation-service; curl /api/v1/recommendations/predictive without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
- **Test to add:** Given no token, when GET /api/v1/recommendations/predictive, then 401; given a token, then 200 with array items matching the schema.
- **Impact if wrong:** Unauthenticated or unbounded data exposure.
- **Web change if wrong:** Add pagination controls and zod schema in loader.
