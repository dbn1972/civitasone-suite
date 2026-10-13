# Detailed gap file — module `cdp`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 27, BACKEND-VERIFY 8, REFUTED 2



---
## /cdp  —  `cdp/home.html`

- **Source:** `apps/web/src/app/(app)/cdp/page.tsx`
- **Design reference:** `redesign/cdp/home.html`

### GAP-CDP-HOME-01  ·  HIGH  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hub tile 'Segments' promises 'Create and manage audience segments for campaigns' (page.tsx:8) but /cdp/segments is a read-only ModuleListPage with no create/edit control (segments/page.tsx:14-21) — the primary CDP job is unreachable from the UI.
- **Verified evidence:** cdp/page.tsx:8 'Create and manage audience segments'; segments/page.tsx:16 is ModuleListPage 'Audience segments for campaigns.' with no create/edit control; no segments/new or [id] route exists in cdp/segments/. Whether cdp-service has segment write endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/cdp/page.tsx`, `apps/web/src/app/(app)/cdp/segments/page.tsx`
- **Fix steps:**
  1. Short term: reword tile to 'View audience segments' in cdp/page.tsx.
  2. Long term: add cdp/segments/new with a zod-validated form and server action posting to the segments API (needs endpoint check).
- **Acceptance:**
  - Tile text matches destination.
  - If create is built: valid segment saves and appears in the list; invalid rules are rejected.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy fix; L for a builder.

### GAP-CDP-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** loading.tsx shows four stat placeholders and a 96-unit block (loading.tsx:11-21) although page.tsx has neither stats nor a table; also hard-coded slate/gray colours, so dark mode flashes light.
- **Verified evidence:** cdp/loading.tsx:12-21 four stat cards and an h-96 block; hub has only LinkTiles. Uses bg-slate-50, bg-gray-200, bg-white (no dark variants). Child routes have their own loading.tsx, so this file effectively serves only the hub.
- **Files to change:** `apps/web/src/app/(app)/cdp/loading.tsx`
- **Fix steps:**
  1. Rewrite cdp/loading.tsx as header + 5 tile skeletons.
  2. Use theme tokens instead of slate/gray.
- **Acceptance:**
  - Hub load shows tile skeletons, no shift.
  - No white flash in dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CATALOGUE-HOME-03


---
## /cdp/events  —  `cdp/events.html`

- **Source:** `apps/web/src/app/(app)/cdp/events/page.tsx`
- **Design reference:** `redesign/cdp/events.html`

### GAP-CDP-EVENTS-01  ·  HIGH  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Meta column prints raw ISO timestamps (e.g. 2026-09-12T05:41:09.221Z) because mapRows passes toText(row.updatedAt) through unformatted (_data.ts:78-86) while sibling CDP pages use formatIndianDate (profiles/page.tsx:9).
- **Verified evidence:** apps/web/src/app/(app)/cdp/_data.ts:79-87 meta = code ?? currency ?? updatedAt ?? createdAt ?? lastSeenAt, all via toText with no formatting, so a row lacking code/currency shows raw ISO. profiles/page.tsx:3,39 uses formatIndianDate. Whether taxonomy rows (GET /api/v1/cdp/events/taxonomy) carry updatedAt cannot be verified (cdp-service absent); the example timestamp is illustrative. formatIndianDate returns dd/mm/yyyy, not 'dd Mon yyyy'. Severity high is overstated.
- **Files to change:** `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. In cdp/_data.ts mapRows, format updatedAt/createdAt/lastSeenAt with formatIndianDate (or a datetime helper) before returning meta.
  2. Keep code/currency as-is.
  3. Add unit test in _data.test.ts for an ISO updatedAt row.
- **Acceptance:**
  - Row {updatedAt:'2026-09-12T05:41:09Z'} meta shows 12/09/2026 (IST date).
  - Invalid date string is shown unchanged, not 'Invalid Date'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Many _data.ts copies have the same pattern.

### GAP-CDP-EVENTS-02  ·  MEDIUM  ·  confirmed  ·  theme TABLE-FEATURES (was CAP)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** ModuleListTable prints the raw record id truncated to 8 chars in an 'ID' column (ModuleListTable.tsx:44) and a generic 'Detail'/'Meta' pair, so a steward sees hash-like fragments instead of business labels; no sort, filter or pagination for lists that can hold many rows.
- **Verified evidence:** apps/web/src/app/_components/ModuleListTable.tsx:50 slices id to 8 chars; generic Detail/Meta headers (:42-44); plain table without sort/filter/paging (:40-53). Whether taxonomy lists are large is unknown.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/(app)/cdp/events/page.tsx`
- **Fix steps:**
  1. Use DataTable (sortable, filterable, pageSize 25) for events page.
  2. Rename columns for events: Event, Category, Status, Updated (typed loader like getCdpProfileList).
  3. Show full event name; drop the truncated ID column.
- **Acceptance:**
  - 60 taxonomy rows paginate; filter 'login' narrows.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Shared component.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-06

### GAP-CDP-EVENTS-03  ·  MEDIUM  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Loading skeleton heading is 'Events' but the page title is 'CDP — Events' (loading.tsx:8 vs page.tsx:17); inconsistent title flicker and hard-coded light colours (loading.tsx:13-16).
- **Verified evidence:** apps/web/src/app/(app)/cdp/events/loading.tsx:6 h1 'Events' vs events/page.tsx:15 'CDP — Events'; :12,15 hard-coded #f1f5f9 blocks (light only). Also the skeleton has four stat blocks though the page has none.
- **Files to change:** `apps/web/src/app/(app)/cdp/events/loading.tsx`
- **Fix steps:**
  1. Change h1 to 'CDP — Events' (and drop the stat blocks).
  2. Replace #f1f5f9 with a token such as var(--surface-2).
  3. Same for other cdp/*/loading.tsx if they copy this.
- **Acceptance:**
  - Title does not change on load.
  - Dark mode shows no light flash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CDP-EVENTS-04  ·  MEDIUM  ·  confirmed  ·  theme DUPLICATE-COLUMN (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Detail column is populated with description ?? status ?? …, so status can appear twice (Detail and Status) for taxonomy rows without a description (_data.ts:66-76).
- **Verified evidence:** apps/web/src/app/(app)/cdp/_data.ts:69-78 sublabel chain includes status/state, and Status column duplicates it (apps/web/src/app/_components/ModuleListTable.tsx:52-53).
- **Files to change:** `apps/web/src/app/(app)/cdp/_data.ts`
- **Fix steps:**
  1. In cdp/_data.ts sublabel chain, drop status/state (and agentId/profileId where redundant) so sublabel only uses description/category/tier.
  2. Leave status only in the Status column of ModuleListTable.
  3. Add a mapRows unit test with a row {name,status} asserting sublabel is undefined.
- **Acceptance:**
  - Row {name:'A',status:'ACTIVE'} renders Detail '—' and Status 'ACTIVE' (not ACTIVE twice).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only change.
- **Depends on:** GAP-CATALOGUE-CATEGORIES-03


---
## /cdp/identity  —  `cdp/identity.html`

- **Source:** `apps/web/src/app/(app)/cdp/identity/page.tsx`
- **Design reference:** `redesign/cdp/identity.html`

### GAP-CDP-IDENTITY-01  ·  HIGH  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Only the first 50 anonymous visitors are ever shown: loader hard-codes ?limit=50 (_data.ts:113) and the table has no pagination or 'showing 50 of N' note, so a steward cannot tell the list is truncated.
- **Verified evidence:** cdp/_data.ts:115 hard-codes '/api/v1/cdp/identity/anonymous-visitors?limit=50' (comment 109-114 says limit is mandatory server-side). identity/page.tsx passes rows straight to ModuleListPage -> ModuleListTable (_components/ModuleListTable.tsx:34-58), a plain <table> with no pagination, no count, no truncation note. Note: there is no client-side filtering here (fix text about that is n/a). Whether the API returns a total/cursor cannot be verified: cdp-service is not in the snapshot.
- **Files to change:** `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/(app)/cdp/identity/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm with cdp-service whether GET anonymous-visitors returns total/nextCursor; if not, add it (backend).
  2. Change getCdpIdentity to accept {limit,offset|cursor} from searchParams and return {rows,total}.
  3. In identity/page.tsx read searchParams and render a pager (Prev/Next, 'Showing X-Y of N').
  4. Interim without backend change: if rows.length===limit show 'Showing first 50; more may exist' note in ModuleListPage children.
  5. Consider migrating to ds DataTable (pageSize) instead of ModuleListTable for this route.
- **Acceptance:**
  - Unit test: loader with 50 rows returned shows the 'first 50 / more may exist' note; with 12 rows shows none.
  - Manual: seed >50 visitors; page 2 shows the next set and count reads 'of N'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; read-only list. Stewards may otherwise miss unresolved visitors beyond the first 50.
- **Depends on:** GAP-CDP-SEGMENTS-03

### GAP-CDP-IDENTITY-02  ·  MEDIUM  ·  confirmed  ·  theme CAP (was UUID)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Rows are labelled by visitorRef, with an 8-char raw id in the ID column and the status repeated as Detail and Status (mapper ladder, _data.ts:59-76); there is no action to resolve an identity from this page although the description says 'pending identity resolution'.
- **Verified evidence:** mapRows (_data.ts:41-97): id=row.id, label falls to visitorRef (l.67), sublabel = description ?? status (l.69-71) and status = row.status (l.78), so the same value renders in Detail and Status columns; ModuleListTable.tsx:50 prints id.slice(0,8) in an ID column. The table is read-only: no resolve/link action exists although description (identity/page.tsx:16) says 'pending identity resolution'. EntityPicker fix does not apply (visitors are anonymous, no name).
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/(app)/cdp/identity/page.tsx`
- **Fix steps:**
  1. Give ModuleListTable optional per-page column config (hide ID, rename Detail/Meta, omit sublabel when equal to status) or write a dedicated identity table with ds DataTable.
  2. In mapRows skip sublabel when it equals status.
  3. Drop the 8-char raw id column for identity; show visitorRef and last seen.
  4. Either add a 'Resolve' action (needs backend endpoint; do not invent) linking to steward flow, or reword the description to 'Anonymous visitors not yet linked to a profile (view only)'.
- **Acceptance:**
  - Component test: row with status 'anonymous' renders it once, not twice.
  - No 8-hex-char id fragment visible in the table.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low. Shared ModuleListTable change affects many modules; make new props opt-in.
- **Depends on:** GAP-CDP-IDENTITY-01

### GAP-CDP-IDENTITY-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Meta shows raw lastSeenAt ISO string (_data.ts:83-84), unformatted.
- **Verified evidence:** mapRows meta ladder (_data.ts:79-87) uses toText(row.lastSeenAt) as a raw string; ModuleListTable.tsx:54 prints it as-is, so users see e.g. 2026-09-28T10:15:00.000Z. Correction: shared formatIndianDate (lib/formatters.ts:2) is date-only dd/mm/yyyy in browser locale, not 'dd Mon yyyy' and not forced IST; there is no shared date-time formatter (ai/chat has two local formatDateTime copies).
- **Files to change:** `apps/web/src/lib/formatters.ts`, `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using timeZone:'Asia/Kolkata' and reuse it (replace local copies in ai/chat).
  2. In mapRows keep raw ISO in meta but add metaKind:'date' (or format there) so ModuleListTable renders formatIndianDateTime for date fields.
  3. Add cases to _data.test.ts.
- **Acceptance:**
  - Unit: formatIndianDateTime('2026-09-28T10:15:00Z') -> '28/09/2026, 3:45 pm' (IST).
  - Identity table shows no 'T'/'Z' ISO strings.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; presentation only.
- **Depends on:** GAP-CDP-SEGMENTS-04

### GAP-CDP-IDENTITY-05  ·  LOW  ·  partly  ·  theme LOADING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Loading heading 'Identity Graph' differs from page title 'CDP — Identity Graph' (loading.tsx:8).
- **Verified evidence:** identity/loading.tsx:6 heading is 'Identity' (not 'Identity Graph' as stated); page title is 'CDP — Identity Graph' (page.tsx:15), so the mismatch is real. Loading also uses hard-coded #f1f5f9 skeleton blocks (l.12,15) and a 4-stat skeleton although the page has no stat cards. error.tsx exists in the folder.
- **Files to change:** `apps/web/src/app/(app)/cdp/identity/loading.tsx`
- **Fix steps:**
  1. Set h1 to 'CDP — Identity Graph' and add the back link to match page.tsx.
  2. Replace stat skeleton with a single table skeleton; use ds Skeleton component instead of inline #f1f5f9.
  3. Same for profiles/segments/steward loading.tsx (share one CdpListLoading).
- **Acceptance:**
  - Visual: heading does not change text when data arrives.
  - No hard-coded hex in loading.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /cdp/profiles  —  `cdp/profiles.html`

- **Source:** `apps/web/src/app/(app)/cdp/profiles/page.tsx`
- **Design reference:** `redesign/cdp/profiles.html`

### GAP-CDP-PROFILES-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** labelOf() uses email then phone as the row label (page.tsx:19-25), so direct personal identifiers (email, phone) render unmasked in the list and in the CSV export (exportable, page.tsx:83-84) — DPDP data-minimisation gap; no role gate or masking.
- **Verified evidence:** profiles/page.tsx:22-28 labelOf tries name, fullName, email, phone then id, and l.35 puts it in the 'Profile' column; DataTable at l.61-81 has exportable so the CSV includes the label (ds/DataTable.tsx:274). No masking, gate or audit. Line refs in finding (19-25, 83-84) are off; real ones are 22-28 and 76-77.
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/page.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Reuse the Masked helper from GAP-CDP-PROFILES-DETAIL-01.
  2. Rank labelOf: name/fullName first; if only email/phone exists show masked form.
  3. Remove `exportable` or export masked values plus emit audit event.
  4. Add a 'Type' or 'Ref' fallback instead of raw contact.
- **Acceptance:**
  - Profile with only email shows 'a***@domain'.
  - CSV has no full email/phone.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High DPDP exposure; masking hurts search by email, so keep server-side search.
- **Depends on:** GAP-CDP-PROFILES-DETAIL-01

### GAP-CDP-PROFILES-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** On fetch failure the four StatCards render 0 and the table shows 'No profiles yet' (page.tsx:63-68,86-87) with only a small badge above; a steward can read 'zero profiles' as fact (compare change/page.tsx which renders '—' when errored).
- **Verified evidence:** Loader returns [] with source 'error' (_data.ts:123-130). profiles/page.tsx:42-58 computes stats from rows so StatCards show '0' (Avg Attributes hard-codes '0', l.58); the DataTable shows emptyTitle 'No profiles yet' (l.78-80); only a DataSourceBadge (l.53) hints at failure. Change home uses errored ? '—'.
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/page.tsx`
- **Fix steps:**
  1. const errored = source==='error'; pass errored ? '—' : value to the four StatCards.
  2. When errored render <RefreshErrorState error={toHumanError('load',{area:'profiles'})}/> in place of the DataTable card.
  3. Drop the footnote when errored.
- **Acceptance:**
  - Test: loader error -> no '0' stat values, no 'No profiles yet', refresh error visible.
  - Healthy empty list still shows 'No profiles yet'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CDP-PROFILES-03  ·  MEDIUM  ·  partly  ·  theme UUID (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Rows with no name/email/phone fall back to the full 36-char profile UUID as label (page.tsx:26), a raw id shown to users.
- **Verified evidence:** labelOf falls back to full profile id (page.tsx:27) so a nameless profile shows a 36-char UUID in the Profile column. Real but the theme PII is wrong (it is an internal id, not personal data).
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/page.tsx`
- **Fix steps:**
  1. Fallback to `${profileType} · …${id.slice(-6)}` (e.g. 'Customer · …a3f9c1').
  2. Keep full id in the row link only.
- **Acceptance:**
  - Profile without name/email/phone shows a short label, no UUID.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CDP-PROFILES-DETAIL-02

### GAP-CDP-PROFILES-04  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Footnote 'Showing the {n} most recently resolved profiles' uses rows.length even when the loader silently capped at limit=200 (_data.ts:122); there is no 'of N total' count.
- **Verified evidence:** _data.ts:124 requests '/api/v1/cdp/profiles?limit=200'; footnote page.tsx:83-85 says 'Showing the {rows.length} most recently resolved profiles', and the 'Total Profiles' stat (l.55) is also rows.length, so at 200 it reads as the total. Schema cdpProfileListSchema lives in @civitasone/schemas, absent from the snapshot, so a total field cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/(app)/cdp/profiles/page.tsx`
- **Fix steps:**
  1. Check whether the list response carries total; if yes extend cdpProfileListSchema and loader to return {rows,total}.
  2. Rename stat to 'Loaded profiles' or show total; footnote 'Showing latest 200 of N'.
  3. Add limit/offset from searchParams and pager; until then show 'more may exist' when rows.length===200.
- **Acceptance:**
  - With 200 rows returned the footnote states the list is capped.
  - Total stat matches API total.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but stats (Multi-Source, Avg Attributes) are computed on a capped sample and mislead.
- **Depends on:** GAP-CDP-IDENTITY-01

### GAP-CDP-PROFILES-05  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Loading heading 'Profiles' vs 'CDP — Profiles'; hard-coded #f1f5f9 skeleton colour (profiles/loading.tsx:13-16).
- **Verified evidence:** profiles/loading.tsx:6 heading 'Profiles' vs page title 'CDP — Profiles' (page.tsx:48); skeleton uses hard-coded #f1f5f9 (l.12,15). No fabricated data; StatCard iconBg hex literals on page are the same style. Theme FABRICATED is wrong.
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/loading.tsx`
- **Fix steps:**
  1. Change h1 to 'CDP — Profiles' with back link.
  2. Use ds Skeleton / CSS var instead of #f1f5f9.
- **Acceptance:**
  - Loading and loaded headings identical; no hex in file.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CDP-IDENTITY-05


---
## /cdp/profiles/[id]  —  `cdp/profiles-detail.html`

- **Source:** `apps/web/src/app/(app)/cdp/profiles/[id]/page.tsx`
- **Design reference:** `redesign/cdp/profiles-detail.html`

### GAP-CDP-PROFILES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Attributes table prints every attribute value verbatim (value: entry.value, page.tsx:70) with an exportable CSV (page.tsx:112-113) — email, phone and any other personal attribute are shown and exportable with no masking, role gate or access audit (DPDP); the 'hashed' promise on page.tsx:168 covers only identifiers.
- **Verified evidence:** resolveAttributeSources (c360.ts) maps every profile.attributes key via displayValue with no filtering; profiles/[id]/page.tsx:61-67 builds rows, 112-128 renders DataTable with exportable and exportFilename, and DataTable.downloadCsv (ds/DataTable.tsx:274-290) writes all values client-side. No <Masked> use, no role check (cdp/layout.tsx only has ModuleGate moduleKey='cdp'), no audit call on view/export. The 'stored hashed' note (page.tsx:175-177) covers identifiers only. No shared <Masked> component exists in the app (only unrelated mentions in admin/integrations).
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/[id]/page.tsx`, `apps/web/src/app/(app)/cdp/profiles/[id]/c360.ts`, `apps/web/src/app/_components/ds/DataTable.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`
- **Fix steps:**
  1. Create ds/Masked.tsx (masks email/phone/PAN/Aadhaar-like values, reveal button gated by a permission, calls an audit endpoint on reveal).
  2. Add a maskAttribute(key,value) helper in c360.ts using key-name classes (email, phone, mobile, dob, address, aadhaar, pan).
  3. Render masked value in the Value column; reveal requires a role from session claims.
  4. Turn off exportable on the attributes table, or add a DataTable exportGuard prop that exports masked values only and emits an audit event.
  5. Backend: confirm/add audit event for PII view+export (cannot verify; service absent).
- **Acceptance:**
  - Component test: attribute 'email' renders 'a***@x.com'; CSV export contains masked value.
  - Role without cdp.pii.read cannot reveal; reveal fires an audit call.
  - Manual: profile with phone attribute never shows full number by default.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: DPDP data-minimisation. Masking must not break stewards' legit lookup; keep reveal path.
- **Depends on:** GAP-CDP-PROFILES-01

### GAP-CDP-PROFILES-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Subtitle prints the full profile UUID ('Golden profile {profile.id}', page.tsx:82) and Source Lineage prints raw sourceId — raw ids shown to users.
- **Verified evidence:** page.tsx:94 subtitle prints `Golden profile ${profile.id}` (full UUID) and Source Lineage column 'Record' prints entry.sourceId (l.82-88, 137). Line refs in the finding are off (82 -> 94). The URL already carries the id. EntityPicker is not relevant on a read-only detail page.
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/[id]/page.tsx`
- **Fix steps:**
  1. Subtitle: use display label (name/fullName attribute, masked) plus profileType; move id to a copy-to-clipboard 'Ref' chip showing last 8 chars.
  2. Source lineage: keep sourceId only if it is a business reference; otherwise show it in a 'mono' truncated form with title tooltip.
  3. Share the display-label helper with profiles/page.tsx labelOf.
- **Acceptance:**
  - Detail page shows no 36-char UUID in visible text.
  - Copy chip copies the full id.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Support staff may want the id; keep it copyable.
- **Depends on:** GAP-CDP-PROFILES-03

### GAP-CDP-PROFILES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** When a secondary loader fails (identity or timeline) that table falls to its 'No linked identifiers' / 'No events yet' empty copy beside a single generic badge (page.tsx:39-44,146-160); the badge does not say which panel is wrong.
- **Verified evidence:** Loaders return {data:[],source:'error'} on failure (_data.ts:146-166). page.tsx:41 folds three sources into one anyLoadFailed and shows a single generic DataSourceBadge (l.98). Identity table falls to 'No linked identifiers' (l.171-173) and events to 'No events yet' (155-157) and stat 'Linked Identifiers' reads 0 (l.102). Related: when the profile fetch itself errors, profile is null so the 'Profile not found' EmptyState renders (l.43-54) beside the badge - an error shown as not-found.
- **Files to change:** `apps/web/src/app/(app)/cdp/profiles/[id]/page.tsx`
- **Fix steps:**
  1. Keep identitySource/eventsSource separately; when 'error' render <RefreshErrorState error={toHumanError('load',{area:'linked identifiers'})}/> in place of that DataTable.
  2. Pass '—' to the Linked Identifiers StatCard when identitySource==='error' (StatCard already renders null as '—').
  3. If source==='error' for the profile, render RefreshErrorState instead of 'Profile not found'; reserve not-found for genuine 404 (loader's null).
- **Acceptance:**
  - Test: mock timeline loader error -> Recent Events card shows refresh error, not 'No events yet'.
  - Profile loader error -> no 'Profile not found' text.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-CDP-PROFILES-DETAIL-04  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Attribution Coverage and Contributing Systems stats read 0 for lineage-free profiles with no explanatory tooltip; 'Unattributed' is explained only in a paragraph.
- **Verified evidence:** Coverage: attributionCoveragePct returns 0 when there are no attributes (c360.ts) and 0% when nothing is attributed; Contributing Systems = 0 when lineage empty (page.tsx:100-103). StatCards have no tooltip/help; explanation of 'Unattributed' is only the paragraph at l.107-111. But the 0 values are genuine, not fabricated, and the Contributing Systems card has an explicit empty state (l.181-186), so impact is small. StatCard has no help/title prop.
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/cdp/profiles/[id]/page.tsx`
- **Fix steps:**
  1. Add optional `hint` prop to StatCard rendered via HelpTip.
  2. Attribution Coverage hint: 'Share of attributes whose source system is recorded. 0% means no ingest named the fields it wrote.'
  3. Show '—' instead of 0% when attributeSources.length===0.
- **Acceptance:**
  - Hover/focus on the stat shows the hint (keyboard reachable).
  - Profile with no attributes shows '—' for coverage.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-CDP-PROFILES-DETAIL-05  ·  LOW  ·  partly  ·  theme NAVUX

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Detail route has no breadcrumb nav (only PageHeader back) unlike sibling children; layout uses .grid.g-main and .fields classes (page.tsx:115,193) not in ds.
- **Verified evidence:** Detail page does have PageHeader back='/cdp/profiles' with label (page.tsx:92-97), so a back link exists; there is no multi-level breadcrumb. The claim that .grid.g-main and .fields are not in the design system is wrong: both are defined in app/civitas-ds.css (l.104, 218). Siblings identity/segments/steward hand-roll a duplicate <nav class='back'> above PageHeader, so the inconsistency runs the other way. Tables are wrapped in .tbl-wrap (horizontal scroll) but have no card transform on mobile.
- **Files to change:** `apps/web/src/app/(app)/cdp/identity/page.tsx`, `apps/web/src/app/(app)/cdp/segments/page.tsx`, `apps/web/src/app/(app)/cdp/steward/page.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Add back/backLabel props to ModuleListPage and pass them to PageHeader.
  2. Remove the hand-written <nav class='back'> blocks from identity, segments and steward pages.
  3. Optionally use AutoBreadcrumb on the detail route.
- **Acceptance:**
  - Each CDP child page shows exactly one back link to /cdp.
  - No duplicate 'Customer Data Platform' link in DOM.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /cdp/segments  —  `cdp/segments.html`

- **Source:** `apps/web/src/app/(app)/cdp/segments/page.tsx`
- **Design reference:** `redesign/cdp/segments.html`

### GAP-CDP-SEGMENTS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Page description 'Audience segments for campaigns.' (page.tsx:18) contradicts the hub tile 'Create and manage audience segments for campaigns.' (page.tsx:8 of hub) — the route offers no create, edit, or delete control at all.
- **Verified evidence:** segments/page.tsx:15 description 'Audience segments for campaigns.' while cdp/page.tsx:8 tile says 'Create and manage audience segments for campaigns.'. The route renders only ModuleListPage -> read-only ModuleListTable; no create/edit/delete control anywhere in cdp/segments. Whether cdp-service has segment write endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/cdp/page.tsx`, `apps/web/src/app/(app)/cdp/segments/page.tsx`
- **Fix steps:**
  1. Decision: if segment authoring is out of scope, change the hub tile to 'View audience segments for campaigns.'
  2. If in scope: add 'New segment' form (zod-validated, POST via browserJson, audit-emitting endpoint) and edit/archive actions with ConfirmDialog.
  3. Do not add UI until backend endpoints are confirmed.
- **Acceptance:**
  - Hub tile and page description agree.
  - (If built) create -> row appears; audit event emitted.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low for copy fix; M-L if authoring is built.

### GAP-CDP-SEGMENTS-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Segment membership counts and rule definitions are not shown; the generic table only prints id, name, description, status, updatedAt (ModuleListTable.tsx:34-41).
- **Verified evidence:** mapRows maps only id/label/sublabel/status/meta (_data.ts:41-97); ModuleListTable columns are ID, Name, Detail, Status, Meta (l.40-44). No member count or rule summary is mapped or shown. Whether the segments API returns memberCount/rules cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/(app)/cdp/segments/page.tsx`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Confirm segment list payload fields with cdp-service.
  2. Add a typed loader getCdpSegmentList with zod schema (like getCdpProfileList) and ds DataTable columns: Name, Members, Rule summary, Status, Updated.
  3. Show '—' for missing counts, never 0.
- **Acceptance:**
  - Segment row shows member count from API.
  - Missing count renders '—'.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-CDP-SEGMENTS-01

### GAP-CDP-SEGMENTS-03  ·  MEDIUM  ·  confirmed  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** ModuleListTable prints the raw record id truncated to 8 chars in an 'ID' column (ModuleListTable.tsx:44) and a generic 'Detail'/'Meta' pair, so a steward sees hash-like fragments instead of business labels; no sort, filter or pagination for lists that can hold many rows.
- **Verified evidence:** ModuleListTable.tsx:50 prints row.id.slice(0,8) in the ID column; headers Detail/Meta generic (l.42,44); plain <table> with no sort, filter or pagination (l.37-58). Shared by every ModuleListPage route so the same defect exists across modules.
- **Files to change:** `apps/web/src/app/_components/ModuleListTable.tsx`, `apps/web/src/app/_components/ModuleListPage.tsx`
- **Fix steps:**
  1. Rebuild ModuleListTable on ds DataTable (sortable, filterable, pageSize=25).
  2. Make the ID column optional (default hidden) and allow columns labels via ModuleListPage props.
  3. Keep useSeededResource offline cache and DataSourceBadge behaviour.
- **Acceptance:**
  - Segments list can be sorted by name and filtered.
  - No hash-like id column by default.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: shared component used by many modules; run all ModuleListPage route tests.

### GAP-CDP-SEGMENTS-04  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Loading heading 'Segments' vs title 'CDP — Segments' (loading.tsx:8); Meta is a raw ISO timestamp (_data.ts:78-86).
- **Verified evidence:** segments/loading.tsx:6 heading 'Segments' vs 'CDP — Segments' (page.tsx:14); Meta shows raw updatedAt ISO via mapRows (_data.ts:79-83) rendered unformatted at ModuleListTable.tsx:54. Loading uses hard-coded #f1f5f9.
- **Files to change:** `apps/web/src/app/(app)/cdp/segments/loading.tsx`, `apps/web/src/app/(app)/cdp/_data.ts`, `apps/web/src/app/_components/ModuleListTable.tsx`
- **Fix steps:**
  1. Fix heading to 'CDP — Segments'.
  2. Format date meta with the new formatIndianDateTime (see GAP-CDP-IDENTITY-03).
- **Acceptance:**
  - Heading stable across loading; meta reads as a date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-CDP-IDENTITY-03


---
## /cdp/steward  —  `cdp/steward.html`

- **Source:** `apps/web/src/app/(app)/cdp/steward/page.tsx`
- **Design reference:** `redesign/cdp/steward.html`

### GAP-CDP-STEWARD-02  ·  HIGH  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Merge is judged from two 8-char UUID prefixes (ProfileLink id.slice(0,8), panel:33-37) and a confidence bar; the confirm dialog also shows only prefixes, so the steward approves an irreversible merge without seeing the two people's names or attributes.
- **Verified evidence:** StewardQueuePanel: ProfileLink shows id.slice(0,8)… (l.56-62); ConfirmDialog text shows target/source prefixes (l.196-199); success message also prefixes (l.95). Confidence bar present. But the dialog is already an ActionButton/ConfirmDialog with requireReason, a warning that it is irreversible, and the ProfileLink opens the full Customer 360 in another route. So 'no ConfirmDialog/reason' in the fix text is already done; the real gap is that names/attributes are not shown in the queue or dialog. Maker != checker: queue has decidedBy but no requester field on MergeCandidate, enforcement is server-side and cannot be verified. Audit emission is backend (absent).
- **Files to change:** `apps/web/src/app/(app)/cdp/steward/StewardQueuePanel.tsx`, `apps/web/src/lib/cdp/steward.ts`
- **Fix steps:**
  1. Fetch getCdpProfile for source and target (or extend queue API to embed display name + key attributes, backend) and render name, type and 2-3 masked attributes in the two columns.
  2. Render a side-by-side comparison in the confirm description (confirmDescription accepts ReactNode).
  3. Use masked email/phone (see GAP-CDP-PROFILES-DETAIL-01).
  4. Open profile links in new tab with 'View' label; keep short id as secondary text.
  5. Verify with backend that decide rejects requester==decider.
- **Acceptance:**
  - Dialog shows both profile names and attributes before Approve enabled.
  - Attempt as the flagging user gets a human-readable refusal.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: irreversible merge; extra fetches must not block deciding when a profile fails to load (show 'details unavailable').
- **Depends on:** GAP-CDP-PROFILES-DETAIL-01

### GAP-CDP-STEWARD-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Decision is async (202 → queue consumer): rows show 'Submitted…' locally and stay until a manual Refresh; a reload resets submittedIds so a decided row may reappear as pending and offer a second decision (panel:45-56).
- **Verified evidence:** submittedIds (l.68) is component state and is reset inside load() (l.79), so both Refresh and page reload drop it; a row still 'pending' server-side (consumer lag) becomes actionable again. Server-side duplicate protection (ALREADY_DECIDED per steward.ts:64-66 comment) cannot be verified because cdp-service is absent; the UI only guarantees within one mounted session. The 'stay until manual Refresh' part is true (no polling).
- **Files to change:** `apps/web/src/app/(app)/cdp/steward/StewardQueuePanel.tsx`
- **Fix steps:**
  1. Do not clear submittedIds in load(); instead drop an id only when the refreshed row is no longer 'pending'.
  2. Persist submitted ids in sessionStorage (try/catch) keyed by tenant for reload.
  3. Poll getStewardQueue every ~5s (max N times) while submittedIds is non-empty; stop when settled.
  4. Verify backend returns idempotent result on repeat decision.
- **Acceptance:**
  - After Approve then Refresh while consumer lag simulated, row stays 'Submitted…'.
  - Row flips to approved after poll without manual refresh.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Medium: duplicate decision on irreversible merge; server must remain authoritative.

### GAP-CDP-STEWARD-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Loading state is bare 'Loading…' text (panel:102) and the Refresh button is hidden when the queue is empty, so an empty queue cannot be re-polled.
- **Verified evidence:** StewardQueuePanel.tsx:121-122 loading branch is a bare <p>Loading…</p>; the Refresh button sits inside the non-empty branch (l.131-136), so with items.length===0 (l.123-128) there is no Refresh/retry. steward/loading.tsx is the route skeleton, separate.
- **Files to change:** `apps/web/src/app/(app)/cdp/steward/StewardQueuePanel.tsx`
- **Fix steps:**
  1. Replace 'Loading…' with ds Skeleton rows and aria-busy.
  2. Move the Refresh button (and pending count) above the ternary so it shows in empty state.
  3. Pass action={<button>Refresh</button>} to EmptyState.
- **Acceptance:**
  - Empty queue still shows Refresh; clicking refetches.
  - Loading state shows skeleton, not plain text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-CDP-HOME-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** cdp-service is not in this snapshot (services/ has only hrms-service), so tile destinations' endpoints cannot be verified — undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/profiles', 'GET /api/v1/cdp/identity/anonymous-visitors', 'GET /api/v1/cdp/segments', 'GET /api/v1/cdp/events/taxonomy', 'GET/POST /v1/cdp/steward/queue|decide']`
- **Question:** Do all five tile destinations map to live cdp-service routes that the tile viewer role may call?
- **How to verify:** List cdp-service route registrations; curl each of the five endpoints with the lowest CDP role and expect 200 (steward endpoints may be 403 for non-steward).
- **Test to add:** Given a CDP viewer token, when each tile endpoint is called, then none returns 404/501; steward routes return 403 only for non-steward.
- **Impact if wrong:** Tiles lead to dead or forbidden pages; low.
- **Web change if wrong:** Hide/disable tiles whose endpoint 403s for the role.

### GAP-CDP-EVENTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Taxonomy is fetched from cdp-service GET /v1/cdp/events/taxonomy — service is absent from this snapshot; row shape (eventName, description, status) is inferred from the mapper comment only (_data.ts:57-58): undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/events/taxonomy']`
- **Question:** Does taxonomy return rows shaped {eventName, description, status} inside a {data} envelope with status limited to a fixed enum?
- **How to verify:** Open cdp-service events route/handler and its zod response schema; curl GET /v1/cdp/events/taxonomy with a viewer token and diff keys against mapper in apps/web/src/app/(app)/cdp/_data.ts:57-58.
- **Test to add:** Given seeded taxonomy rows, when GET taxonomy as viewer, then 200 and every row has eventName, description, status (enum) and no extra PII fields.
- **Impact if wrong:** Page renders blank/wrong names if keys differ; low.
- **Web change if wrong:** Adjust mapper in cdp/_data.ts to actual keys.

### GAP-CDP-IDENTITY-04  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Visitor row shape (visitorRef, lastSeenAt, firstSeenAt) is described only in mapper comments; cdp-service absent from snapshot (limit mandatory, per _data.ts:106-112 comment) — undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/identity/anonymous-visitors?limit=']`
- **Question:** Does anonymous-visitors require and cap limit, and return {visitorRef, firstSeenAt, lastSeenAt} only?
- **How to verify:** Open the visitors handler schema; curl without limit (expect 400) and with limit=100000 (expect capped/400).
- **Test to add:** Given no limit, when GET visitors, then 400 VALIDATION; given limit above max, then 400 or clamped; rows contain no raw identifiers.
- **Impact if wrong:** Unbounded scan/DoS and identifier leakage; medium.
- **Web change if wrong:** Always send limit; align mapper keys in cdp/_data.ts:106-112.

### GAP-CDP-PROFILES-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** cdp-service is absent from this snapshot; CDPProfile schema lives in @civitasone/schemas (not read) — undeterminable whether attributes can hold Aadhaar.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/profiles']`
- **Question:** Does the profile schema/ingest reject or mask Aadhaar and other government identifiers in the free-form attributes bag?
- **How to verify:** Open ingest validator and CDPProfile schema in @civitasone/schemas; POST an event with attributes.aadhaar=123412341234 and inspect stored/returned value.
- **Test to add:** Given an ingest payload with a 12-digit Aadhaar in attributes, when stored and listed, then rejected or masked (last 4 only).
- **Impact if wrong:** DPDP/Aadhaar Act violation; high.
- **Web change if wrong:** Mask or drop attribute keys in the profiles list mapper as defence in depth.

### GAP-CDP-PROFILES-DETAIL-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** cdp-service (profiles, identity, timeline) absent from snapshot — response envelope {data} known only from schemas import; undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/profiles/:id', 'GET /api/v1/cdp/identity/:id (encoded)']`
- **Question:** Does profile/identity/timeline return a {data} envelope matching @civitasone/schemas CDPProfile, with 404 for unknown id and 403 for unauthorized viewers?
- **How to verify:** Open profile handler and compare response with schema package; curl unknown id and a low-role token.
- **Test to add:** Given unknown id, when GET profile, then 404 with error envelope; given valid id, then body parses with CDPProfileSchema.
- **Impact if wrong:** Detail page crashes or shows partial PII; low.
- **Web change if wrong:** Tolerate 404 and parse via schema in c360.ts.

### GAP-CDP-SEGMENTS-05  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Segments endpoint shape and mutation endpoints are not present in this snapshot (cdp-service absent): undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /api/v1/cdp/segments']`
- **Question:** What is the segment response shape and are create/update/delete endpoints present, role-gated and audited?
- **How to verify:** List cdp segments routes; curl GET and attempt POST/DELETE as viewer (expect 403) and as marketer (expect 2xx plus audit row).
- **Test to add:** Given viewer token, when POST segment, then 403; given editor, then 201 and an audit entry is written.
- **Impact if wrong:** Unaudited or open audience mutation; medium.
- **Web change if wrong:** Add/hide mutation UI according to role.

### GAP-CDP-STEWARD-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** Approve/Reject render for every viewer (panel:150-190); the client has no role check, so a non-steward gets buttons that will 403 at cdp-service (route roles undeterminable: service absent).
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['GET /v1/cdp/steward/queue', 'POST /v1/cdp/steward/decide']`
- **Question:** Does POST steward/decide enforce a steward role (403 otherwise) so non-stewards cannot merge profiles?
- **How to verify:** Open steward routes preHandler/requireRole; curl decide with a non-steward token expecting 403 and no state change.
- **Test to add:** Given a non-steward token, when POST decide approve, then 403 and both profiles unchanged.
- **Impact if wrong:** Any user could merge customer profiles (data integrity, privacy); high.
- **Web change if wrong:** Read role from session and hide Approve/Reject in StewardQueuePanel.tsx for non-stewards.

### GAP-CDP-STEWARD-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W0 2026-10-13: closed by #1924, verified on main 62bf2e6eb)
- **First-pass claim:** steward/consumer.ts referenced in the panel comment lives in cdp-service — absent from snapshot; merge semantics, audit trail and maker-checker are undeterminable.
- **Service:** `cdp-service`  ·  **Endpoint(s):** `['POST /v1/cdp/steward/decide', 'steward/consumer.ts (queue)']`
- **Question:** Does approve merge profiles atomically, write an audit record with decider identity, and forbid the requester from being the sole approver?
- **How to verify:** Open steward/consumer.ts and decide handler; run an approve and inspect merged profile, tombstone and audit rows; test double-submit.
- **Test to add:** Given a pending pair, when approve twice, then one merge, one audit row, second call idempotent; reject leaves both intact.
- **Impact if wrong:** Irreversible wrong merges without audit trail; high.
- **Web change if wrong:** Show pending state after decide; nothing else.


---
## Refuted by deep pass — do NOT implement

### GAP-CDP-HOME-03 · /cdp
- **First-pass claim:** Hub is the only CDP page that does not render the 'Customer Data Platform' back link the five children show (compare events/page.tsx:12-14); breadcrumb consistency depends on AutoBreadcrumb only.
- **Why refuted:** cdp/page.tsx is the module root: it has no parent page to link back to. The catalogue hub (catalogue/page.tsx) is identical. The related true inconsistency is that children mix a hand-written nav (events/segments) with PageHeader back= (profiles/page.tsx:47-48), not the hub.

### GAP-CDP-STEWARD-04 · /cdp/steward
- **First-pass claim:** Failed decisions show the server's raw 'CODE: message' text (lib/cdp/steward.ts:60-62 docs 'ALREADY_DECIDED: …'), contrary to the plain-language rule in RouteError.tsx.
- **Why refuted:** Decisions go through browserJson (lib/api/browserClient.ts:67-70) which throws errorMessageFromResponse(res), built from toHumanError catalogue (l.57-65) and never includes server code/text. ActionButton shows e.message (ds/ActionButton.tsx:49). So raw 'CODE: message' is not shown; the docstring at lib/cdp/steward.ts:64-66 is stale. Residual: the message is a generic 'save' failure; a race (ALREADY_DECIDED) is not explained. Fix text about loading.tsx is unrelated.
