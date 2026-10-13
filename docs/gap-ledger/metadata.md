# Detailed gap file — module `metadata`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 21, BACKEND-VERIFY 2



---
## /metadata  —  `metadata/home.html`

- **Source:** `apps/web/src/app/(app)/metadata/page.tsx`
- **Design reference:** `redesign/metadata/home.html`

### GAP-METADATA-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** End-user copy prints the API surface: subtitle "via /api/v1/metadata/*" and card text "(/api/v1/metadata/entities)" (page.tsx:7,19) - developer wording on an admin screen.
- **Verified evidence:** apps/web/src/app/(app)/metadata/page.tsx:19 subtitle '...via /api/v1/metadata/*.' and :7 desc 'Custom entity definitions (/api/v1/metadata/entities)' print API paths to the admin.
- **Files to change:** `apps/web/src/app/(app)/metadata/page.tsx`
- **Fix steps:**
  1. Reword PageHeader subtitle to 'Configure custom entities, fields, rules, records and forms.'
  2. Remove '(/api/v1/metadata/entities)' from LINKS[0].desc.
  3. Add a lint/grep check (or reuse across other hubs) for '/api/v' in JSX strings.
- **Acceptance:**
  - Rendered hub contains no '/api/' text (component test on page markup).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-METADATA-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was VALIDATION)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Card title and link text repeat ("Entities" then "Entities →") and the Rules card is titled "Validation rules" while its page is titled "Rules" (page.tsx:9, rules/page.tsx:16).
- **Verified evidence:** apps/web/src/app/(app)/metadata/page.tsx:7,25 card title 'Entities' and link text 'Entities →' repeat; LINKS[2].title 'Validation rules' (:9) vs rules/page.tsx:16 PageHeader title 'Rules' (and Card title 'Rules' :20). Minor labelling inconsistency; nothing to do with validation code.
- **Files to change:** `apps/web/src/app/(app)/metadata/page.tsx`, `apps/web/src/app/(app)/metadata/rules/page.tsx`
- **Fix steps:**
  1. Pick one name ('Validation rules') and use it in the hub title and rules/page.tsx PageHeader + Card titles (:16,:20).
  2. Change link text to a verb phrase ('Open entities →') or make the whole Card a Link (see HOME-04).
- **Acceptance:**
  - Hub card title equals target page H1 for all five cards.
  - No card shows identical title and link text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-METADATA-HOME-04

### GAP-METADATA-HOME-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Loading skeleton has six cards for a five-card hub (loading.tsx:10-16); plain <Link className="text-sm underline"> rather than a button/tile makes the small text the only click target.
- **Verified evidence:** apps/web/src/app/(app)/metadata/loading.tsx:11 renders Array.from({length: 6}) SkeletonCards in 'grid g-3' while page.tsx LINKS has 5 entries in 'grid md:grid-cols-2' (page.tsx:21) - count and column layout both differ. page.tsx:25 uses <Link className="text-sm underline"> as the only click target inside a non-clickable Card. Also unused EmptyState import (page.tsx:1).
- **Files to change:** `apps/web/src/app/(app)/metadata/loading.tsx`, `apps/web/src/app/(app)/metadata/page.tsx`
- **Fix steps:**
  1. Set skeleton length to 5 and use the same grid classes as page.tsx (or share a constant).
  2. Wrap each Card in a Link (as municipal/page.tsx does) or use ds LinkTiles/ModuleHub (app/_components/LinkTiles.tsx, ModuleHub.tsx) so the whole tile is the target.
  3. Remove unused EmptyState import.
- **Acceptance:**
  - Skeleton renders 5 cards matching page grid.
  - Clicking anywhere on a tile navigates; tile focus ring visible via keyboard.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /metadata/entities  —  `metadata/entities.html`

- **Source:** `apps/web/src/app/(app)/metadata/entities/page.tsx`
- **Design reference:** `redesign/metadata/entities.html`

### GAP-METADATA-ENTITIES-01  ·  HIGH  ·  confirmed  ·  theme RAWJSON (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Filled state is a raw JSON.stringify dump in a <pre> (first 50 rows, page.tsx:~59): keys like id/label/sublabel/status shown as code to a business user; no table, no sort, no truncation notice past 50.
- **Verified evidence:** entities/page.tsx:26 renders <pre>{JSON.stringify(data.slice(0, 50), null, 2)}</pre>. data is ModuleRowSummary[] {id,label,sublabel?,status?} mapped in metadata/_data.ts:489-505. No table, no notice when >50 rows. Caveat: mapRows drops all other fields, so a richer table needs mapper changes; backend row shape not verifiable.
- **Files to change:** `apps/web/src/app/(app)/metadata/entities/page.tsx`, `apps/web/src/app/(app)/metadata/_data.ts`, `apps/web/src/app/_components/ds (table reuse)`
- **Fix steps:**
  1. Replace <pre> with a table (Label, Description, Status via StatusPill, Id) using data mapped by mapRows.
  2. Show 'Showing 50 of N' or paginate rather than slice(0,50).
  3. Extract a shared MetadataRowTable used by entities, fields, rules, records, forms pages (which are identical 33-line files).
- **Acceptance:**
  - Test: 3 rows render 3 table rows with labels, no JSON braces.
  - With 60 rows a notice or pager appears.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; presentational.
- **Depends on:** GAP-METADATA-FIELDS-01

### GAP-METADATA-ENTITIES-02  ·  HIGH  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Module purpose is "Configure custom entities" yet there is no create, edit, publish or delete control anywhere under metadata/ - the empty state even says "Create entities via the metadata API." (entities/page.tsx:~57), sending clerks to an API.
- **Verified evidence:** No create/edit/publish/delete controls in metadata/ (pages list only links, e.g. metadata/page.tsx:7-11; entity page empty state says 'Create entities via the metadata API.' at entities/page.tsx:24). True. But whether a write API exists cannot be verified (metadata service not in snapshot), and building an entity designer is a product decision, not a page bug.
- **Files to change:** `apps/web/src/app/(app)/metadata/entities/page.tsx`
- **Fix steps:**
  1. Decide scope: read-only viewer vs entity designer.
  2. If read-only, reword empty state and subtitle (currently exposes /api/v1/metadata/entities, :15) in business terms.
  3. If designer: needs backend endpoints, zod forms, ConfirmDialog for publish/delete, audit events.
- **Acceptance:**
  - Empty state does not mention an API.
  - If designer chosen: create entity flow with audit event.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** Schema-changing operations need approvals/audit.


---
## /metadata/fields  —  `metadata/fields.html`

- **Source:** `apps/web/src/app/(app)/metadata/fields/page.tsx`
- **Design reference:** `redesign/metadata/fields.html`

### GAP-METADATA-FIELDS-01  ·  HIGH  ·  confirmed  ·  theme RAWJSON (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Filled state is a raw JSON.stringify dump in a <pre> (first 50 rows, page.tsx:~59): keys like id/label/sublabel/status shown as code to a business user; no table, no sort, no truncation notice past 50.
- **Verified evidence:** fields/page.tsx:26 same JSON.stringify(data.slice(0,50)) <pre> dump (line ~59 in the note is wrong). Same fix as entities.
- **Files to change:** `apps/web/src/app/(app)/metadata/fields/page.tsx`
- **Fix steps:**
  1. Use the shared MetadataRowTable from GAP-METADATA-ENTITIES-01.
  2. Add truncation notice past 50.
- **Acceptance:**
  - Test: renders table not <pre>.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.
- **Depends on:** GAP-METADATA-ENTITIES-01

### GAP-METADATA-FIELDS-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** This page calls getMetadataEntities() = GET /api/v1/metadata/entities (fields/page.tsx:9) and prints entity rows under the heading "Fields"; the correct loader getMetadataFields() (GET /api/v1/metadata/fields) exists in _data.ts:53 but is never called. A user sees entity data labelled as fields.
- **Verified evidence:** fields/page.tsx:2 imports getMetadataEntities and :7 calls it; getMetadataFields exists at metadata/_data.ts:517 (not :53) with path /api/v1/metadata/fields but is unused here. So entity rows appear under 'Fields'. Whether fields list without entity filter is meaningful cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/metadata/fields/page.tsx`
- **Fix steps:**
  1. Import getMetadataFields and call it instead of getMetadataEntities.
  2. Update telemetry/copy accordingly.
  3. If API requires entityId, add searchParams.entity and pass to loader (needs backend confirmation).
- **Acceptance:**
  - Test: mock getMetadataFields; page renders those rows and getMetadataEntities is not called.
  - Network tab shows /api/v1/metadata/fields.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Endpoint response shape may differ; mapRows is generic.

### GAP-METADATA-FIELDS-03  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says "select entity to drill into fields" (fields/page.tsx:17) but there is no selector, link or query parameter anywhere in the page - the drill-down does not exist.
- **Verified evidence:** Subtitle at fields/page.tsx:17 (file line ~14) says '(select entity to drill into fields)' but the page has no selector, links or searchParams; only a dump. Confirmed.
- **Files to change:** `apps/web/src/app/(app)/metadata/fields/page.tsx`, `apps/web/src/app/(app)/metadata/_data.ts`, `apps/web/src/app/(app)/metadata/entities/page.tsx`
- **Fix steps:**
  1. Add entity select/links on entities page to /metadata/fields?entity=<id>.
  2. Read searchParams.entity, pass to loader if backend supports filtering (unverified), else remove the promise from the subtitle.
- **Acceptance:**
  - Choosing an entity shows only its fields.
  - Subtitle matches behaviour.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; presentational.
- **Depends on:** GAP-METADATA-FIELDS-02

### GAP-METADATA-FIELDS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty/subtitle copy exposes the API path and calls the state "No data" instead of naming fields (fields/page.tsx:17,26).
- **Verified evidence:** fields/page.tsx subtitle 'Wired to /api/v1/metadata/entities (select entity...)' exposes an API path and EmptyState title 'No data' with message about entities (:26 in observation; file line ~24). Same pattern on other metadata pages (entities subtitle shows path).
- **Files to change:** `apps/web/src/app/(app)/metadata/fields/page.tsx`, `apps/web/src/app/(app)/metadata/entities/page.tsx`, `apps/web/src/app/(app)/metadata/forms/page.tsx`, `apps/web/src/app/(app)/metadata/rules/page.tsx`, `apps/web/src/app/(app)/metadata/records/page.tsx`
- **Fix steps:**
  1. Rewrite subtitles in business language.
  2. Empty state: title 'No fields defined', message 'Fields you add to an entity appear here.'
  3. Apply to all five metadata pages.
- **Acceptance:**
  - No page shows /api/ paths in visible copy.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentational.


---
## /metadata/forms  —  `metadata/forms.html`

- **Source:** `apps/web/src/app/(app)/metadata/forms/page.tsx`
- **Design reference:** `redesign/metadata/forms.html`

### GAP-METADATA-FORMS-01  ·  HIGH  ·  confirmed  ·  theme RAWDUMP (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Filled state is a raw JSON.stringify dump in a <pre> (first 50 rows, page.tsx:~59): keys like id/label/sublabel/status shown as code to a business user; no table, no sort, no truncation notice past 50.
- **Verified evidence:** apps/web/src/app/(app)/metadata/forms/page.tsx:28 renders <pre>{JSON.stringify(data.slice(0, 50), null, 2)}</pre>; data is ModuleRowSummary[] (id,label,sublabel,status) mapped in metadata/_data.ts:25-41. No table/sort/count, and rows beyond 50 are silently dropped. Same pattern in entities/ and fields/ pages. Line ref ~59 in the finding is wrong (it is 28). Note: the suggested fix (server pagination) is over-scoped; the loader exposes no total/page meta (mapRows returns only an array).
- **Files to change:** `apps/web/src/app/(app)/metadata/forms/page.tsx`, `apps/web/src/app/(app)/metadata/_data.ts`
- **Fix steps:**
  1. In forms/page.tsx replace the <pre> with the ds <DataTable> (already used in municipal/_components/RecordsTable.tsx) with columns Name(label), Type/Description(sublabel), Status(cellType:'status'); set sortable, filterable, pageSize=25.
  2. Drop data.slice(0,50) so all fetched rows are available to client paging.
  3. Show a row count line ("N Forms") above the table; hide raw id or show as secondary column only.
  4. Use EmptyState with a domain title (see -04) for zero rows.
  5. Optionally extract a shared <MetadataRowsTable rows=... /> in metadata/_components and reuse across entities/fields/rules/records/forms pages.
- **Acceptance:**
  - Component test: given 3 ModuleRowSummary rows, page shows a table with 3 rows and no <pre>/JSON braces in the DOM.
  - Given 60 rows, all are reachable via pager/filter (no silent cap).
  - Manual: click column header sorts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only list. Row shape unchanged.
- **Depends on:** GAP-METADATA-FORMS-02, shared MetadataRowsTable

### GAP-METADATA-FORMS-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** This page calls getMetadataEntities() = GET /api/v1/metadata/entities (forms/page.tsx:9) and prints entity rows under the heading "Forms"; the correct loader getMetadataForms() (GET /api/v1/metadata/forms) exists in _data.ts:56 but is never called. A user sees entity data labelled as forms.
- **Verified evidence:** apps/web/src/app/(app)/metadata/forms/page.tsx:9 calls getMetadataEntities(); metadata/_data.ts:56 defines getMetadataForms() for /api/v1/metadata/forms but grep shows it is not imported by this page (only fields/ page uses its own loader). Page heading/Card title 'Forms' therefore label entity rows. Whether the /forms endpoint returns useful un-scoped data (vs requiring an entity) cannot be verified: backend absent.
- **Files to change:** `apps/web/src/app/(app)/metadata/forms/page.tsx`
- **Fix steps:**
  1. Change import to { getMetadataForms } from '../_data' and call it at page.tsx:9.
  2. Keep toResourceState/RefreshErrorState wiring; update area text if needed.
  3. If the endpoint requires an entity scope (confirm with metadata-service owner), add optional ?entity= searchParams and pass through loader instead of listing unscoped.
  4. Update subtitle/empty copy (see -03, -04).
- **Acceptance:**
  - Component test with mocked getMetadataForms returning rows: rendered rows come from it and getMetadataEntities is not called.
  - Manual: page lists forms, not entity definitions.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; if endpoint 404s, page shows the existing RefreshErrorState instead of misleading entity data.

### GAP-METADATA-FORMS-03  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says "select entity to drill into forms" (forms/page.tsx:17) but there is no selector, link or query parameter anywhere in the page - the drill-down does not exist.
- **Verified evidence:** apps/web/src/app/(app)/metadata/forms/page.tsx:17 subtitle says '(select entity to drill into forms)' but the file has no selector, Link, searchParams or entity param anywhere (lines 8-32). Drill-down does not exist.
- **Files to change:** `apps/web/src/app/(app)/metadata/forms/page.tsx`
- **Fix steps:**
  1. Simplest: remove the parenthetical from the PageHeader subtitle once -02 is fixed, since the page will list its own resource.
  2. If entity-scoped listing is wanted, accept searchParams.entity, render a Segmented/select of entities from getMetadataEntities, and pass entity to the loader (needs backend confirmation).
- **Acceptance:**
  - Page subtitle contains no reference to selecting an entity unless a selector exists.
  - If selector added: choosing an entity updates ?entity= and the list filters.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy/UX only.
- **Depends on:** GAP-METADATA-FORMS-02

### GAP-METADATA-FORMS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty/subtitle copy exposes the API path and calls the state "No data" instead of naming forms (forms/page.tsx:17,26).
- **Verified evidence:** apps/web/src/app/(app)/metadata/forms/page.tsx:17 subtitle 'Wired to /api/v1/metadata/entities ...' exposes the API path; :26 EmptyState title 'No data' with message 'Entities from the metadata API appear here as the entry point for forms.' Both are developer wording and name entities rather than forms.
- **Files to change:** `apps/web/src/app/(app)/metadata/forms/page.tsx`
- **Fix steps:**
  1. Set subtitle to plain business copy e.g. 'Custom forms defined for your organisation.'
  2. EmptyState title 'No forms yet'; message explaining how to create one (or that none are defined).
  3. Remove API paths from user-facing strings across metadata pages (entities/fields subtitles too).
- **Acceptance:**
  - Grep of metadata/**/page.tsx user strings finds no '/api/v1'.
  - Empty state names the resource ('No forms yet').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-METADATA-FORMS-02


---
## /metadata/records  —  `metadata/records.html`

- **Source:** `apps/web/src/app/(app)/metadata/records/page.tsx`
- **Design reference:** `redesign/metadata/records.html`

### GAP-METADATA-RECORDS-01  ·  HIGH  ·  confirmed  ·  theme RAWDUMP (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Filled state is a raw JSON.stringify dump in a <pre> (first 50 rows, page.tsx:~59): keys like id/label/sublabel/status shown as code to a business user; no table, no sort, no truncation notice past 50.
- **Verified evidence:** apps/web/src/app/(app)/metadata/records/page.tsx:28 renders <pre>{JSON.stringify(data.slice(0, 50), null, 2)}</pre>; data is ModuleRowSummary[] (id,label,sublabel,status) mapped in metadata/_data.ts:25-41. No table/sort/count, and rows beyond 50 are silently dropped. Same pattern in entities/ and fields/ pages. Line ref ~59 in the finding is wrong (it is 28). Note: the suggested fix (server pagination) is over-scoped; the loader exposes no total/page meta (mapRows returns only an array).
- **Files to change:** `apps/web/src/app/(app)/metadata/records/page.tsx`, `apps/web/src/app/(app)/metadata/_data.ts`
- **Fix steps:**
  1. In records/page.tsx replace the <pre> with the ds <DataTable> (already used in municipal/_components/RecordsTable.tsx) with columns Name(label), Type/Description(sublabel), Status(cellType:'status'); set sortable, filterable, pageSize=25.
  2. Drop data.slice(0,50) so all fetched rows are available to client paging.
  3. Show a row count line ("N Records") above the table; hide raw id or show as secondary column only.
  4. Use EmptyState with a domain title (see -04) for zero rows.
  5. Optionally extract a shared <MetadataRowsTable rows=... /> in metadata/_components and reuse across entities/fields/rules/records/forms pages.
- **Acceptance:**
  - Component test: given 3 ModuleRowSummary rows, page shows a table with 3 rows and no <pre>/JSON braces in the DOM.
  - Given 60 rows, all are reachable via pager/filter (no silent cap).
  - Manual: click column header sorts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only list. Row shape unchanged.
- **Depends on:** GAP-METADATA-RECORDS-02, shared MetadataRowsTable

### GAP-METADATA-RECORDS-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** This page calls getMetadataEntities() = GET /api/v1/metadata/entities (records/page.tsx:9) and prints entity rows under the heading "Records"; the correct loader getMetadataRecords() (GET /api/v1/metadata/records) exists in _data.ts:55 but is never called. A user sees entity data labelled as records.
- **Verified evidence:** apps/web/src/app/(app)/metadata/records/page.tsx:9 calls getMetadataEntities(); metadata/_data.ts:55 defines getMetadataRecords() for /api/v1/metadata/records but grep shows it is not imported by this page (only fields/ page uses its own loader). Page heading/Card title 'Records' therefore label entity rows. Whether the /records endpoint returns useful un-scoped data (vs requiring an entity) cannot be verified: backend absent.
- **Files to change:** `apps/web/src/app/(app)/metadata/records/page.tsx`
- **Fix steps:**
  1. Change import to { getMetadataRecords } from '../_data' and call it at page.tsx:9.
  2. Keep toResourceState/RefreshErrorState wiring; update area text if needed.
  3. If the endpoint requires an entity scope (confirm with metadata-service owner), add optional ?entity= searchParams and pass through loader instead of listing unscoped.
  4. Update subtitle/empty copy (see -03, -04).
- **Acceptance:**
  - Component test with mocked getMetadataRecords returning rows: rendered rows come from it and getMetadataEntities is not called.
  - Manual: page lists records, not entity definitions.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; if endpoint 404s, page shows the existing RefreshErrorState instead of misleading entity data.

### GAP-METADATA-RECORDS-03  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says "select entity to drill into records" (records/page.tsx:17) but there is no selector, link or query parameter anywhere in the page - the drill-down does not exist.
- **Verified evidence:** apps/web/src/app/(app)/metadata/records/page.tsx:17 subtitle says '(select entity to drill into records)' but the file has no selector, Link, searchParams or entity param anywhere (lines 8-32). Drill-down does not exist.
- **Files to change:** `apps/web/src/app/(app)/metadata/records/page.tsx`
- **Fix steps:**
  1. Simplest: remove the parenthetical from the PageHeader subtitle once -02 is fixed, since the page will list its own resource.
  2. If entity-scoped listing is wanted, accept searchParams.entity, render a Segmented/select of entities from getMetadataEntities, and pass entity to the loader (needs backend confirmation).
- **Acceptance:**
  - Page subtitle contains no reference to selecting an entity unless a selector exists.
  - If selector added: choosing an entity updates ?entity= and the list filters.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy/UX only.
- **Depends on:** GAP-METADATA-RECORDS-02

### GAP-METADATA-RECORDS-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty/subtitle copy exposes the API path and calls the state "No data" instead of naming records (records/page.tsx:17,26).
- **Verified evidence:** apps/web/src/app/(app)/metadata/records/page.tsx:17 subtitle 'Wired to /api/v1/metadata/entities ...' exposes the API path; :26 EmptyState title 'No data' with message 'Entities from the metadata API appear here as the entry point for records.' Both are developer wording and name entities rather than records.
- **Files to change:** `apps/web/src/app/(app)/metadata/records/page.tsx`
- **Fix steps:**
  1. Set subtitle to plain business copy e.g. 'Custom records defined for your organisation.'
  2. EmptyState title 'No records yet'; message explaining how to create one (or that none are defined).
  3. Remove API paths from user-facing strings across metadata pages (entities/fields subtitles too).
- **Acceptance:**
  - Grep of metadata/**/page.tsx user strings finds no '/api/v1'.
  - Empty state names the resource ('No records yet').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-METADATA-RECORDS-02


---
## /metadata/rules  —  `metadata/rules.html`

- **Source:** `apps/web/src/app/(app)/metadata/rules/page.tsx`
- **Design reference:** `redesign/metadata/rules.html`

### GAP-METADATA-RULES-01  ·  HIGH  ·  confirmed  ·  theme RAWDUMP (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Filled state is a raw JSON.stringify dump in a <pre> (first 50 rows, page.tsx:~59): keys like id/label/sublabel/status shown as code to a business user; no table, no sort, no truncation notice past 50.
- **Verified evidence:** apps/web/src/app/(app)/metadata/rules/page.tsx:28 renders <pre>{JSON.stringify(data.slice(0, 50), null, 2)}</pre>; data is ModuleRowSummary[] (id,label,sublabel,status) mapped in metadata/_data.ts:25-41. No table/sort/count, and rows beyond 50 are silently dropped. Same pattern in entities/ and fields/ pages. Line ref ~59 in the finding is wrong (it is 28). Note: the suggested fix (server pagination) is over-scoped; the loader exposes no total/page meta (mapRows returns only an array).
- **Files to change:** `apps/web/src/app/(app)/metadata/rules/page.tsx`, `apps/web/src/app/(app)/metadata/_data.ts`
- **Fix steps:**
  1. In rules/page.tsx replace the <pre> with the ds <DataTable> (already used in municipal/_components/RecordsTable.tsx) with columns Name(label), Type/Description(sublabel), Status(cellType:'status'); set sortable, filterable, pageSize=25.
  2. Drop data.slice(0,50) so all fetched rows are available to client paging.
  3. Show a row count line ("N Rules") above the table; hide raw id or show as secondary column only.
  4. Use EmptyState with a domain title (see -04) for zero rows.
  5. Optionally extract a shared <MetadataRowsTable rows=... /> in metadata/_components and reuse across entities/fields/rules/records/forms pages.
- **Acceptance:**
  - Component test: given 3 ModuleRowSummary rows, page shows a table with 3 rows and no <pre>/JSON braces in the DOM.
  - Given 60 rows, all are reachable via pager/filter (no silent cap).
  - Manual: click column header sorts.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only list. Row shape unchanged.
- **Depends on:** GAP-METADATA-RULES-02, shared MetadataRowsTable

### GAP-METADATA-RULES-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** This page calls getMetadataEntities() = GET /api/v1/metadata/entities (rules/page.tsx:9) and prints entity rows under the heading "Rules"; the correct loader getMetadataRules() (GET /api/v1/metadata/rules) exists in _data.ts:54 but is never called. A user sees entity data labelled as rules.
- **Verified evidence:** apps/web/src/app/(app)/metadata/rules/page.tsx:9 calls getMetadataEntities(); metadata/_data.ts:54 defines getMetadataRules() for /api/v1/metadata/rules but grep shows it is not imported by this page (only fields/ page uses its own loader). Page heading/Card title 'Rules' therefore label entity rows. Whether the /rules endpoint returns useful un-scoped data (vs requiring an entity) cannot be verified: backend absent.
- **Files to change:** `apps/web/src/app/(app)/metadata/rules/page.tsx`
- **Fix steps:**
  1. Change import to { getMetadataRules } from '../_data' and call it at page.tsx:9.
  2. Keep toResourceState/RefreshErrorState wiring; update area text if needed.
  3. If the endpoint requires an entity scope (confirm with metadata-service owner), add optional ?entity= searchParams and pass through loader instead of listing unscoped.
  4. Update subtitle/empty copy (see -03, -04).
- **Acceptance:**
  - Component test with mocked getMetadataRules returning rows: rendered rows come from it and getMetadataEntities is not called.
  - Manual: page lists rules, not entity definitions.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; if endpoint 404s, page shows the existing RefreshErrorState instead of misleading entity data.

### GAP-METADATA-RULES-03  ·  HIGH  ·  confirmed  ·  theme WIRING (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Subtitle says "select entity to drill into rules" (rules/page.tsx:17) but there is no selector, link or query parameter anywhere in the page - the drill-down does not exist.
- **Verified evidence:** apps/web/src/app/(app)/metadata/rules/page.tsx:17 subtitle says '(select entity to drill into rules)' but the file has no selector, Link, searchParams or entity param anywhere (lines 8-32). Drill-down does not exist.
- **Files to change:** `apps/web/src/app/(app)/metadata/rules/page.tsx`
- **Fix steps:**
  1. Simplest: remove the parenthetical from the PageHeader subtitle once -02 is fixed, since the page will list its own resource.
  2. If entity-scoped listing is wanted, accept searchParams.entity, render a Segmented/select of entities from getMetadataEntities, and pass entity to the loader (needs backend confirmation).
- **Acceptance:**
  - Page subtitle contains no reference to selecting an entity unless a selector exists.
  - If selector added: choosing an entity updates ?entity= and the list filters.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; copy/UX only.
- **Depends on:** GAP-METADATA-RULES-02

### GAP-METADATA-RULES-04  ·  MEDIUM  ·  confirmed  ·  theme COPY (was WIRING)

- [x] **Status** (W0 2026-10-13: closed by #1928, verified on main 9c5e9e9e9)
- **First-pass claim:** Empty/subtitle copy exposes the API path and calls the state "No data" instead of naming rules (rules/page.tsx:17,26).
- **Verified evidence:** apps/web/src/app/(app)/metadata/rules/page.tsx:17 subtitle 'Wired to /api/v1/metadata/entities ...' exposes the API path; :26 EmptyState title 'No data' with message 'Entities from the metadata API appear here as the entry point for rules.' Both are developer wording and name entities rather than rules.
- **Files to change:** `apps/web/src/app/(app)/metadata/rules/page.tsx`
- **Fix steps:**
  1. Set subtitle to plain business copy e.g. 'Custom rules defined for your organisation.'
  2. EmptyState title 'No rules yet'; message explaining how to create one (or that none are defined).
  3. Remove API paths from user-facing strings across metadata pages (entities/fields subtitles too).
- **Acceptance:**
  - Grep of metadata/**/page.tsx user strings finds no '/api/v1'.
  - Empty state names the resource ('No rules yet').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-METADATA-RULES-02


---
## Backend verification items (service code absent from snapshot)

### GAP-METADATA-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** A configuration hub for custom entities/rules/forms - tenant-wide, schema-changing functionality - has no layout, no ModuleGate and no role gate (metadata/ has no layout.tsx; contrast loyalty/meeting layouts with ModuleGate). Any signed-in user can open it; nothing can be verified server-side (no metadata-service in snapshot).
- **Service:** `metadata-service`  ·  **Endpoint(s):** `['all /api/v1/metadata/*']`
- **Question:** Do metadata write routes require a schema-admin role, and are entity/field/rule changes audited and versioned?
- **How to verify:** Open metadata-service route guards; curl POST entity with employee JWT expecting 403.
- **Test to add:** Given non-admin token, when POST/PUT metadata entity, then 403; admin change writes audit.
- **Impact if wrong:** Any user can alter tenant schema.
- **Web change if wrong:** Add metadata/layout.tsx with requireAnyRole + ModuleGate.

### GAP-METADATA-ENTITIES-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** mapRows only reads arrays from payload / payload.data / payload.items (_data.ts:18-24) and maps sublabel from description|type|entityKey; the true entity shape is undeterminable (no metadata-service), and rows carry no link to fields/rules/forms.
- **Service:** `metadata-service`  ·  **Endpoint(s):** `['GET /api/v1/metadata/entities']`
- **Question:** What is the entity list response envelope and fields (key, label, description, type, fieldsCount)?
- **How to verify:** Open metadata-service entities handler/DTO; curl GET and inspect envelope and keys.
- **Test to add:** When GET entities, then items[] each with entityKey, label; envelope matches loader (array/data/items).
- **Impact if wrong:** Empty or mislabelled entity table.
- **Web change if wrong:** Map real fields and add links to fields/rules/forms in metadata/_data.ts:18-24.
