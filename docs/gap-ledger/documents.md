# Detailed gap file — module `documents`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 19, BACKEND-VERIFY 2



---
## /documents  —  `documents/home.html`

- **Source:** `apps/web/src/app/(app)/documents/page.tsx`
- **Design reference:** `redesign/documents/home.html`

### GAP-DOCUMENTS-HOME-01  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** /documents has no landing page: e-Office Inbox and Document Library are siblings but the root always opens the Library (page.tsx:4), so a clerk who lives in the inbox must click through every time; Library links to Inbox and vice versa (library/page.tsx:97, inbox/page.tsx:70).
- **Verified evidence:** apps/web/src/app/(app)/documents/page.tsx:4 redirect('/documents/library'); library/page.tsx:92-98 and inbox/page.tsx:65-71 cross-link. No remembered preference or landing.
- **Files to change:** `apps/web/src/app/(app)/documents/page.tsx`
- **Fix steps:**
  1. Either build a landing with two cards and counts, or redirect to inbox per role (e.g. cookie last-used)
  2. Keep sub-navigation via shared PageHeader actions
- **Acceptance:**
  - Clerk landing goes to inbox after choosing it once
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-DOCUMENTS-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Documents is not in Sidebar.tsx (only Field Ops is present of this slice) yet navRouteManifest.ts lists "/documents"; the module is reachable only by URL or by tenant module list. Nearest NAV group in this prototype: Establishment (estab) — approximation, not code fact.
- **Verified evidence:** Sidebar.tsx contains no 'documents' entry (0 grep matches) while apps/web/src/app/_components/navRouteManifest.ts:48 lists '/documents'; layout.tsx gates with ModuleGate moduleKey 'documents'. Nearest group note is speculative.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Add { icon: FolderOpen/Files, label:'Documents', href:'/documents', moduleKey:'documents' } to appropriate group
  2. Verify moduleKey exists in getEnabledModules
- **Acceptance:**
  - Enabled tenant sees link; disabled does not
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCUMENTS-HOME-03  ·  LOW  ·  partly  ·  theme LOADING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Flash of the generic skeleton grid (documents/loading.tsx) before the redirect; it does not resemble the Library table it lands on.
- **Verified evidence:** apps/web/src/app/(app)/documents/page.tsx calls redirect() during server render, so the skeleton in documents/loading.tsx (SkeletonCard grid) is not meaningfully flashed on /documents; but library and inbox have no loading.tsx of their own, so they inherit the card-grid skeleton though they render tables.
- **Files to change:** `apps/web/src/app/(app)/documents/library/loading.tsx`, `apps/web/src/app/(app)/documents/inbox/loading.tsx`
- **Fix steps:**
  1. Add table-shaped loading.tsx to library and inbox
- **Acceptance:**
  - Skeleton resembles table
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /documents/inbox  —  `documents/inbox.html`

- **Source:** `apps/web/src/app/(app)/documents/inbox/page.tsx`
- **Design reference:** `redesign/documents/inbox.html`

### GAP-DOCUMENTS-INBOX-01  ·  HIGH  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "+ New Dak" and every row "View" are plain <button>s with no onClick/href in a Server Component (page.tsx:72,45): they do nothing. The subtitle promises Acknowledge, forward, submit for approval (page.tsx:68) but no such action exists on the page.
- **Verified evidence:** inbox/page.tsx:72 '+ New Dak' and :45 (DakRow) 'View' are <button className=btn> with no onClick/href/type; page is a Server Component (no 'use client'), so no handler can exist. Subtitle at :68 promises 'Acknowledge, forward, or submit for approval' but no such control or endpoint call exists anywhere on the page. No dak detail route exists under documents/ (only inbox, library, new). Document-service is not in the snapshot, so create/acknowledge/forward endpoints cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/documents/inbox/page.tsx`, `apps/web/src/app/(app)/documents/inbox/DakActions.tsx (new)`, `apps/web/src/app/(app)/documents/inbox/[id]/page.tsx (new, only if backend exposes a dak detail)`
- **Fix steps:**
  1. Decide scope with product: either wire the actions or shrink the promise. Immediately change subtitle (:68) to what exists ('Daks and files assigned to you.') and remove the dead '+ New Dak' button (:72) until a create flow exists.
  2. If the document-service exposes GET /v1/documents/inbox/:id, add [id]/page.tsx and turn the View button into <Link href={`/documents/inbox/${dak.id}`} className='btn'>.
  3. For Acknowledge/Forward add a small 'use client' DakActions component (ActionButton from ds + ConfirmDialog) that POSTs to the confirmed endpoint, then router.refresh(); surface errors through useFormError('dak').
  4. Emit audit events server-side for acknowledge/forward (CLAUDE.md audit rule); web only shows result via Toast.
- **Acceptance:**
  - Rendered inbox has no <button> without onClick/href (component test).
  - Clicking View navigates to the dak detail (or button is absent).
  - Acknowledge changes row status to 'acknowledged' after refresh and an audit event exists (backend test).
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Approvals/forwarding on official dak: wiring to a wrong endpoint or without audit is a workflow-integrity risk; removing dead controls is safe.
- **Depends on:** GAP-DOCUMENTS-INBOX-04

### GAP-DOCUMENTS-INBOX-03  ·  MEDIUM  ·  confirmed  ·  theme STATUS

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Priority/status are printed as raw lowercase enum strings (page.tsx:37,40); due date has no overdue treatment, so an urgent dak past due looks identical to one due next month.
- **Verified evidence:** inbox/page.tsx:37 and :40 render {dak.priority}/{dak.status} raw inside a pill (tone from local priorityPill/statusPill :8-19, so colour exists, but text is lower-case enum). formatDate (:21) only formats; dueDate (:42) has no comparison with today, so overdue is not flagged. Shared StatusPill (ds/StatusPill.tsx) has no urgent/high/forwarded/acknowledged keys (falls back to 'info'), so keep the local tone helpers rather than switching blindly.
- **Files to change:** `apps/web/src/app/(app)/documents/inbox/page.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Wrap the label in humanizeStatus() from @/lib/formatters at :37 and :40 (or add urgent/high/forwarded/acknowledged to STATUS_MAP and use <StatusPill>).
  2. Add isOverdue(dak.dueDate, dak.status) helper (due < start of today and status not acknowledged); when true render the date with class 'bad' and an 'Overdue' text pill (non-colour cue).
  3. Optionally add an 'Overdue' StatCard next to Urgent.
- **Acceptance:**
  - Component test: priority 'urgent' renders 'Urgent'.
  - Dak with dueDate yesterday and status pending shows 'Overdue'; future date does not.
  - Acknowledged dak past due is not flagged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Timezone: compare in IST calendar days to avoid off-by-one on due dates.

### GAP-DOCUMENTS-INBOX-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The dak id is never shown and the row is not a link: assignedTo, and any reference number needed to cite the dak in a noting, are unavailable (DakSummary.assignedTo unused).
- **Verified evidence:** DakRow (inbox/page.tsx:30-48) renders subject, priority, status, due, created and a dead View button; dak.id and dak.assignedTo are mapped by the loader (documents/_data/loaders.ts:36-45, types.ts DakSummary) but never displayed; the subject is plain <strong>, not a link. No dak reference/diary number field exists in DakSummary, so the 'reference number' cannot be shown from current types; only the id.
- **Files to change:** `apps/web/src/app/(app)/documents/inbox/page.tsx`, `apps/web/src/app/(app)/documents/_data/types.ts`, `apps/web/src/app/(app)/documents/_data/loaders.ts`
- **Fix steps:**
  1. Make the subject a <Link> to a dak detail route once one exists (see INBOX-01); until then show a short reference via formatInternalRef(dak.id) from @/lib/formatters.
  2. Add an 'Assigned to' column from dak.assignedTo; resolve to a name (not a raw uuid) via the existing user-name lookup, else show '—'.
  3. If backend has a diary/dak number, add it to DakSummary + toDak() and show it as the first column.
- **Acceptance:**
  - Row shows a reference and assignee (name, not uuid).
  - Subject link opens detail (after INBOX-01).
  - toDak maps the new field (unit test).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low. Do not print raw user ids (PII/UUID leakage).
- **Depends on:** GAP-DOCUMENTS-INBOX-01

### GAP-DOCUMENTS-INBOX-05  ·  MEDIUM  ·  partly  ·  theme I18N (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** All strings hard-coded in English, no next-intl keys (page.tsx:67-100); table is not responsive-transformed (class tbl inside tbl-wrap only).
- **Verified evidence:** Hard-coded English confirmed across inbox/page.tsx:64-100 (titles, headers, EmptyState). But next-intl is used in only a handful of files in apps/web/src (AskCivitasOne*, ds/DataTable), so this page matches the prevailing app convention; not a regression specific to it. Table: <div className='tbl-wrap'><table className='tbl'> (:91-92) only; I found no card-transform CSS or data-label attrs in the ds, so it relies on horizontal scroll. Theme is I18N/RESPONSIVE, not FABRICATED (nothing fabricated).
- **Files to change:** `apps/web/src/app/(app)/documents/inbox/page.tsx`, `apps/web/messages/en.json (or the repo's next-intl catalogue)`
- **Fix steps:**
  1. Only do this as part of an app-wide i18n pass: extract the strings to a 'documents.inbox' namespace and use getTranslations in the Server Component.
  2. Formatting dates: pass the active locale to toLocaleDateString instead of the fixed 'en-IN'.
  3. For mobile, use the shared DataTable (ds/DataTable.tsx) if it supports stacked rows, otherwise leave tbl-wrap scroll.
- **Acceptance:**
  - No literal English in JSX of inbox/page.tsx (lint rule or grep).
  - Switching locale to hi renders translated headers.
  - Table is usable at 360px width.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** Low; the risk is starting page-by-page i18n inconsistently.

### GAP-DOCUMENTS-INBOX-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Loading skeleton (documents/loading.tsx) is a generic 6-card grid shared with the library and upload pages, not a table skeleton.
- **Verified evidence:** documents/loading.tsx renders a page-header skeleton plus 6 <SkeletonCard/> in 'grid g-3'; the same file covers inbox, library and new (no route-level loading.tsx under inbox/ or library/). Inbox and library are stat grid + table, so the skeleton shape differs.
- **Files to change:** `apps/web/src/app/(app)/documents/inbox/loading.tsx (new)`, `apps/web/src/app/(app)/documents/library/loading.tsx (new)`
- **Fix steps:**
  1. Create inbox/loading.tsx and library/loading.tsx using PageHeader-like skeleton, 4 skeleton stat tiles and <SkeletonTable rows={8}/> from ds/Skeleton.tsx.
  2. Keep documents/loading.tsx for the hub only.
- **Acceptance:**
  - Throttle network: inbox shows table skeleton, not cards.
  - No layout shift when data arrives (visual check).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /documents/library?folderId=  —  `documents/library.html`

- **Source:** `apps/web/src/app/(app)/documents/library/page.tsx`
- **Design reference:** `redesign/documents/library.html`

### GAP-DOCUMENTS-LIBRARY-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Folder rows are misaligned with the header: folder.path is rendered in the "Type" column and the Open button in the "Version" column, with em-dashes elsewhere (page.tsx:31-45 vs 133-138) — a screen reader announces "Version: Open".
- **Verified evidence:** Header (library/page.tsx:245-250) is Name, Type, Size, Tags, Status, Version. FolderRow (:31-46) emits: name, folder.path (falls in Type), '—' (Size), '—' (Tags), '—' (Status), then the Open link (in the Version column). Screen reader reads 'Version: Open' and 'Type: /path'. (Line numbers in the observation are correct for the file.)
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`
- **Fix steps:**
  1. Rewrite FolderRow cells to match the columns: Name (link to ?folderId, with folder icon), Type 'Folder', Size '—', Tags '—', Status '—', Version '—'.
  2. Drop the separate Open button; make the name cell <Link href={`/documents/library?folderId=${folder.id}`}>.
  3. Show folder.path in a title/secondary line under the name, not in Type.
  4. Add visually-hidden text for the '—' cells (e.g. 'not applicable').
- **Acceptance:**
  - Component test: folder row has 6 <td> aligned to 6 <th>, Type cell text 'Folder'.
  - Keyboard: Tab reaches folder name link; Enter opens the folder.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCUMENTS-LIBRARY-02  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** File rows have no open/download/rename/delete action and no link (page.tsx:48-59), yet the page lists status "deleted" files (page.tsx:26-28). The library is view-only; the only way to add content is "+ Upload File", which registers a name and tags only (see /documents/new).
- **Verified evidence:** FileRow (library/page.tsx:48-59) has only display cells; no link, no actions column (header has 6 cols, none is Action). priorityPill(:25-29) deliberately styles status 'deleted' as bad, and the page does not filter files, so deleted rows are shown if the API returns them (whether it does is unverifiable: document-service absent). Upload at /documents/new registers name + tags only (new/page.tsx:20-27). No download/open/rename/delete route exists under documents/.
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`, `apps/web/src/app/(app)/documents/_data/loaders.ts`, `apps/web/src/app/(app)/documents/library/FileActions.tsx (new)`
- **Fix steps:**
  1. Confirm with document-service which endpoints exist (GET file/download url, PATCH rename, DELETE). Do not invent them.
  2. Add an Actions column; 'use client' FileActions with Download (use presigned URL endpoint), Rename, Delete via ConfirmDialog + useFormError; router.refresh() after.
  3. Filter status==='deleted' out by default (or behind a 'Show deleted' toggle for admins).
  4. Delete must be soft-delete with an audit event on the backend.
- **Acceptance:**
  - Active file row shows Download and it fetches the file.
  - Deleted files are hidden unless toggled.
  - Delete asks for confirmation and row disappears after refresh.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Deletion/retention of official records: needs soft delete, role check, audit trail.
- **Depends on:** GAP-DOCUMENTS-NEW-01

### GAP-DOCUMENTS-LIBRARY-03  ·  MEDIUM  ·  confirmed  ·  theme SCOPE-LABEL (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "Total Files" counts files in the current folder while "Folders" counts every folder in the tenant, and both sit beside tenant-wide Inbox/Urgent (page.tsx:103-106); labels do not say which scope.
- **Verified evidence:** 'Total Files' = files.length (:103, list fetched with ?folderId, so folder-scoped), 'Folders' = folders.length (:104, getDocumentFolders() takes no parent argument, so all tenant folders, not currentFolders), 'Inbox'/'Urgent' = tenant-wide stats.inboxCount/urgentCount (:105-106). No label states the scope. Theme is a labelling/scope issue, not I18N.
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`
- **Fix steps:**
  1. Compute folders count from currentFolders.length (or label 'All folders').
  2. Rename labels: 'Files in this folder', 'Sub-folders', 'Inbox (all)', 'Urgent (all)'; or drop Inbox/Urgent from the library.
  3. Show '—' for Total Files when fSource==='error' (already done).
- **Acceptance:**
  - Open a sub-folder: 'Sub-folders' equals rows of type folder shown.
  - Labels state scope.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCUMENTS-LIBRARY-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Unknown or deleted folderId falls back to printing the raw id in the heading (page.tsx:116); no not-found state and folderId is used unvalidated from searchParams (page.tsx:66).
- **Verified evidence:** library/page.tsx:66 takes searchParams.folderId as-is (only URL-encoded into the API query in loaders.ts:49); :116 renders `folders.find(...)?.name ?? folderId`, so an unknown/deleted/foreign id prints raw in the heading. No notFound() or not-found state; the page shows 'Empty folder' instead.
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`, `apps/web/src/app/(app)/documents/library/not-found.tsx (new)`
- **Fix steps:**
  1. Validate folderId with zod (z.string().uuid()) and call notFound() if malformed.
  2. After loaders resolve: if foldersSource==='api' and folderId is set and no folder matches, call notFound() (never when foldersSource==='error').
  3. Heading: use folder name only; drop the ?? folderId fallback; build the breadcrumb from folder.path/parentId chain.
  4. Add library/not-found.tsx with back link to /documents/library.
- **Acceptance:**
  - /documents/library?folderId=bogus returns the not-found page.
  - Folders API error still shows RefreshErrorState, not 404.
  - Heading never shows a uuid.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Do not turn a fetch failure into 404 (see LIBRARY-05).

### GAP-DOCUMENTS-LIBRARY-05  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error handling is split: DataSourceBadge shows only for the files loader (page.tsx:89) while RefreshErrorState shows if files or folders failed (page.tsx:81,124). A folders-only failure shows an error card with no badge; stats failure shows dashes with no other signal.
- **Verified evidence:** Confirmed: DataSourceBadge renders only for fSource==='error' (library/page.tsx:89 real numbering) while errored (:81) = files OR folders failed and drives the RefreshErrorState (:124). Folders-only failure => error card, no badge. Stats failure => '—' in the two tiles only (:105-106), no message. Overstated: the RefreshErrorState already gives the clerk a clear error with Retry, so the missing badge is inconsistency/duplication (files failure shows both amber badge and error card) rather than a hidden failure.
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`
- **Fix steps:**
  1. Remove the DataSourceBadge at :89 (redundant with RefreshErrorState) or show it for statsSource==='error' only.
  2. Show one inline muted note 'Counts unavailable' when statsSource==='error'.
  3. Keep '—' for tiles when their own source failed (already true).
- **Acceptance:**
  - Force folders 500: single error card with Retry, no stray badge.
  - Force stats 500: table renders, tiles show '—' plus note.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-DOCUMENTS-LIBRARY-06  ·  LOW  ·  partly  ·  theme CAP

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Helper named priorityPill is used for file status (page.tsx:25); mime types are shown raw ("application/vnd.openxmlformats-officedocument…") in a pill and will overflow on mobile. No search, sort or pagination.
- **Verified evidence:** priorityPill (library/page.tsx:25) is used for file status and is misnamed: confirmed. Mime rendered raw in <span className='pill mut'> (:52 real numbering); long values like application/vnd.openxmlformats-officedocument... make the cell wide, but the table is inside tbl-wrap so it scrolls horizontally rather than breaking the page. No search, sort or pagination: confirmed (getDocumentFiles passes only folderId, no limit/offset; whether API caps results is unverifiable).
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`, `apps/web/src/app/(app)/documents/_data/loaders.ts`
- **Fix steps:**
  1. Rename priorityPill -> fileStatusTone (or use StatusPill with humanizeStatus).
  2. Add mimeLabel(mime) mapping to 'PDF', 'Word', 'Excel', 'Image', 'ZIP' with fallback to extension; show full mime in title attribute.
  3. Add ?q=&page= searchParams and pass to the loader (only if the API supports them; else backend first).
- **Acceptance:**
  - Word file shows 'Word', not the vnd.openxml string.
  - With >50 files pagination controls appear (after backend support).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-DOCUMENTS-LIBRARY-07  ·  LOW  ·  partly  ·  theme I18N (was PII)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Hard-coded English strings, no next-intl keys; DPDP: tags/file names may carry personal data but there is no classification or access marking column.
- **Verified evidence:** Hard-coded English across library/page.tsx confirmed, but next-intl is not used on comparable pages (see INBOX-05). DPDP claim is speculative: FileSummary (types.ts) has no classification/confidentiality field, so a column cannot be bound without a backend addition; no PII is actually rendered beyond names and tags. Theme should be I18N/CLASSIFICATION, not PII masking.
- **Files to change:** `apps/web/src/app/(app)/documents/library/page.tsx`, `apps/web/src/app/(app)/documents/_data/types.ts`
- **Fix steps:**
  1. Extract strings during the app-wide i18n pass.
  2. Ask backend whether documents carry a classification (public/internal/restricted); if yes add to FileSummary + toFile and render a pill column; if no, drop the requirement.
- **Acceptance:**
  - If classification exists: each row shows it.
  - No literal strings in JSX after i18n pass.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; classification display is informational, enforcement must be server-side.
- **Depends on:** GAP-DOCUMENTS-INBOX-05


---
## /documents/new  —  `documents/new.html`

- **Source:** `apps/web/src/app/(app)/documents/new/page.tsx`
- **Design reference:** `redesign/documents/new.html`

### GAP-DOCUMENTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The screen is titled "Upload Document" and the primary action is "Create Record", but no file input exists; the POST carries only name and tags (page.tsx:20-27). A clerk registers an empty record with no way to attach content from this route, and the notice points to a "library view" that has no attach action (library/page.tsx:48-59).
- **Verified evidence:** new/page.tsx: title 'Upload Document' (:37 real), submit 'Create Record' (:91); form has only File Name and Tags inputs; POST body is {name, tags} JSON (:20-27, real lines) to /api/v1/documents/files; no <input type=file>. Notice at :86 says 'attach a file from the library view once the record is created', but library FileRow has no attach action. ds/FileUpload.tsx exists and is reusable. Whether document-service has a multipart/presigned upload endpoint cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/documents/new/page.tsx`, `apps/web/src/app/(app)/documents/_data/loaders.ts`, `apps/web/src/app/_components/ds/FileUpload.tsx`
- **Fix steps:**
  1. Get the upload contract from document-service (presigned S3 URL flow or multipart). Do not guess.
  2. Add ds <FileUpload> to the form; on submit request upload URL, PUT the file, then POST the metadata (name defaults from file.name, mimeType, sizeBytes from File).
  3. Until backend supports it, retitle page 'Register Document Record' and remove the misleading notice.
- **Acceptance:**
  - Selecting a PDF and saving creates a record with mimeType and sizeBytes and the file downloadable.
  - No file selected: submit blocked with a field error.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Untrusted file upload: needs size/type limits and AV scan server-side.
- **Depends on:** GAP-DOCUMENTS-LIBRARY-02

### GAP-DOCUMENTS-NEW-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** No folder selector: records are always created at root (no folderId in body, page.tsx:23-26) so files can never be filed into the folder tree shown by the library; mimeType, size and version are not sent either.
- **Verified evidence:** Body is {name, tags} only (new/page.tsx:23-26 real numbering). No folder select, mimeType, sizeBytes or version. Web model already has folderId (types.ts FileSummary) and the list endpoint filters by ?folderId, so the backend concept exists; whether POST accepts folderId is not verifiable (service absent).
- **Files to change:** `apps/web/src/app/(app)/documents/new/page.tsx`, `apps/web/src/app/(app)/documents/_data/loaders.ts`
- **Fix steps:**
  1. Add a folder select populated from getDocumentFolders() (fetch in a Server wrapper and pass folders as props, or read ?folderId= from the URL to prefill).
  2. Include folderId (null for root) in the POST body; keep zod validation server-side.
  3. Send mimeType/sizeBytes when the FileUpload from NEW-01 lands; leave version to the backend.
- **Acceptance:**
  - Creating with folder 'Budget' makes the file appear in /documents/library?folderId=<id>.
  - Cancel/back keeps folder context.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify backend rejects folderIds from another tenant.
- **Depends on:** GAP-DOCUMENTS-NEW-01

### GAP-DOCUMENTS-NEW-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Error box has no role="alert" and no label for the field in error (page.tsx:52-56); fields use inline style rather than the shared form components.
- **Verified evidence:** Error div (new/page.tsx:52-56) is a styled <div> with no role='alert'/aria-live; only a single form-level message exists, no per-field errors and no aria-invalid/aria-describedby. Fields use inline style objects (:65-70, 78-83). There are no shared Input/Field components in ds/ (ls ds shows only Button, Card, FileUpload, etc.), so 'use the shared form components' requires creating one (domains/new has same problem). Labels ARE present (wrapping <label>).
- **Files to change:** `apps/web/src/app/(app)/documents/new/page.tsx`, `apps/web/src/app/_components/ds/FormField.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Add role='alert' to the error box.
  2. Create ds/FormField (label, input, hint, error with id/aria-describedby/aria-invalid) and use it here.
  3. Move colours to CSS classes/tokens (input class).
- **Acceptance:**
  - Screen reader announces submit errors.
  - Field with server-side error has aria-invalid and linked message.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-DOMAINS-NEW-04

### GAP-DOCUMENTS-NEW-05  ·  LOW  ·  confirmed  ·  theme COPY (was FABRICATED)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** "S3/storage" is an internal term shown to clerks (page.tsx:86); hard-coded English.
- **Verified evidence:** new/page.tsx:86 (real numbering) shows 'File content upload (S3/storage) is wired to the backend...' to clerks: internal jargon and a misleading claim. Hard-coded English is the app norm here.
- **Files to change:** `apps/web/src/app/(app)/documents/new/page.tsx`
- **Fix steps:**
  1. Delete the paragraph, or replace with plain copy that matches the real capability (e.g. 'Attach the file below' once NEW-01 lands, or 'This creates the record only; file upload is not available yet').
- **Acceptance:**
  - Page contains no 'S3' or 'storage' term.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-DOCUMENTS-NEW-01


---
## Backend verification items (service code absent from snapshot)

### GAP-DOCUMENTS-INBOX-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** getDocumentStats() is fetched (page.tsx:53-55) but `stats` is never used; summary counts from /inbox/summary are ignored and KPIs are derived from the returned list, so they will disagree with the Library page (library/page.tsx:105-106) if the list is paginated server-side. document-service is absent from the snapshot: pagination and scoping undeterminable.
- **Service:** `document-service`  ·  **Endpoint(s):** `['GET /v1/documents/inbox', 'GET /v1/documents/inbox/summary']`
- **Question:** Does /inbox return the full user-scoped list (or page metadata with total) and does /inbox/summary count the same scope as the Library page?
- **How to verify:** Open the inbox and summary handlers in document-service; compare filters and pagination; seed 120 items and check list length vs summary.inboxCount.
- **Test to add:** Given 120 inbox items for user U when GET inbox is called then either all are returned or response includes total, and summary.inboxCount == 120.
- **Impact if wrong:** KPI tiles disagree with the Library and undercount pending dak.
- **Web change if wrong:** Use getDocumentStats() (documents/inbox/page.tsx:53-55) for KPI tiles instead of list length, or paginate.

### GAP-DOCUMENTS-NEW-03  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Uses a raw fetch() (page.tsx:20) rather than the shared api client, and File Name has no client-side length or extension validation (page.tsx:60-69). Audit of the create is document-service concern — service absent, undeterminable.
- **Service:** `document-service`  ·  **Endpoint(s):** `['POST /api/v1/documents/files']`
- **Question:** Does the create handler validate fileName length/extension with zod, require auth and emit an audit event?
- **How to verify:** Open the files POST route in document-service; POST a 300-char name and a .exe name, expecting 422; check audit emit.
- **Test to add:** Given fileName of 300 chars or disallowed extension when POSTed then 422 with fieldErrors; valid create emits one audit event.
- **Impact if wrong:** Bad file names and unaudited document creation.
- **Web change if wrong:** Add maxLength/extension checks and use the shared api client in documents/new/page.tsx:20,60-69.
