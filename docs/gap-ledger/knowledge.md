# Detailed gap file — module `knowledge`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 57, BACKEND-VERIFY 12



---
## /knowledge  —  `knowledge/home.html`

- **Source:** `apps/web/src/app/(app)/knowledge/page.tsx`
- **Design reference:** `redesign/knowledge/home.html`

### GAP-KNOWLEDGE-HOME-01  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** /knowledge/list and /knowledge/documents/new are not reachable from the hub (page.tsx:9-15); the Documents list is only reachable by typing the URL.
- **Verified evidence:** Hub links (page.tsx:9-15) list dashboard, repository, policies, faqs, assistant, records, search; none to /knowledge/list or /knowledge/documents/new. However documents are reachable via Repository (its '+ Publish Document' button repository/page.tsx:62) and the dashboard (:117); only /knowledge/list is orphaned (no inbound link anywhere in apps/web/src, and it duplicates repository - see LIST-03). Not in navRouteManifest either.
- **Files to change:** `apps/web/src/app/(app)/knowledge/page.tsx`, `apps/web/src/app/(app)/knowledge/list/page.tsx`
- **Fix steps:**
  1. Resolve LIST-03 first (merge list into repository).
  2. If keeping /knowledge/list, add a hub link {href:'/knowledge/list', label:'Documents'}; otherwise add nothing.
  3. Optionally add a 'New document' tile pointing to /knowledge/documents/new.
- **Acceptance:**
  - Every knowledge page that is meant to exist is reachable from the hub with no typed URL.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-KNOWLEDGE-LIST-03

### GAP-KNOWLEDGE-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Three names for the same area: hub "Knowledge & DMS" (page.tsx:6), dashboard "Knowledge & Document Management" (dashboard/page.tsx:112), list "Knowledge — Documents" (list/page.tsx:48).
- **Verified evidence:** Titles differ: hub 'Knowledge & DMS' (page.tsx:6), dashboard 'Knowledge &amp; Document Management' (dashboard/page.tsx:112), list 'Knowledge — Documents' (list/page.tsx:48), repository 'Digital Repository' (repository/page.tsx:57).
- **Files to change:** `apps/web/src/app/(app)/knowledge/page.tsx`, `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`, `apps/web/src/app/(app)/knowledge/list/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Fix steps:**
  1. Pick one module name (e.g. 'Knowledge & Documents') and one name per sub-page.
  2. Put strings in next-intl messages (apps/web/src/messages) or one constants file.
  3. Update the four PageHeader titles and the sidebar label to match.
- **Acceptance:**
  - Sidebar label, hub title and page titles use the agreed names.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-KNOWLEDGE-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was LOADING)

- [x] **Status** (W0 2026-10-13 re-confirmed W1 SF-02/03 (#2010): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** not-found.tsx gives no back link or retry — EmptyState only (not-found.tsx:5-8).
- **Verified evidence:** not-found.tsx:5-8 renders <EmptyState title message/> with no action; ds EmptyState supports an action?: ReactNode prop (EmptyState.tsx:8). It is triggered by notFound() in policies/[id]/page.tsx:11, so a missing document shows a generic 'Page not found' with no way back. error.tsx already uses RouteError with back link, so only not-found is bare.
- **Files to change:** `apps/web/src/app/(app)/knowledge/not-found.tsx`
- **Fix steps:**
  1. Pass action={<Link href='/knowledge' className='btn primary'>Back to Knowledge</Link>} (plus a secondary link to /knowledge/policies).
  2. Reword message to 'This document or page does not exist or you no longer have access.'
- **Acceptance:**
  - Visit /knowledge/policies/00000000-0000-0000-0000-000000000000: page shows Back to Knowledge link that navigates to /knowledge.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-KNOWLEDGE-HOME-05  ·  LOW  ·  confirmed  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W1 SF-11: closed by #2025)
- **First-pass claim:** loading.tsx uses hard-coded tailwind slate colours and min-h-screen inside the app shell (loading.tsx:3), which will not follow dark mode and can force double scrolling.
- **Verified evidence:** loading.tsx:3 uses className 'min-h-screen bg-slate-50 p-6 md:p-8' and bg-slate-200 blocks; dark mode is the .dark class in civitas-ds.css so slate palette will not adapt, and min-h-screen inside the shell can create nested scroll. Same markup in list/loading.tsx:3 and about 120 other loading.tsx files under apps/web/src/app (grep 'min-h-screen bg-slate-50'). ds/Skeleton.tsx exists.
- **Files to change:** `apps/web/src/app/(app)/knowledge/loading.tsx`, `apps/web/src/app/(app)/knowledge/list/loading.tsx`, `apps/web/src/app/_components/ds/Skeleton.tsx`
- **Fix steps:**
  1. Create a shared PageSkeleton (stat row + table) in app/_components/ds built from Skeleton.tsx with var(--panel)/var(--line) tokens and no min-h-screen.
  2. Replace knowledge/loading.tsx and list/loading.tsx bodies with it; then codemod the other loading.tsx files.
  3. Wrap in the same .wrap container as pages.
- **Acceptance:**
  - In dark mode the skeleton uses dark panel colours.
  - No double scrollbar while loading.
- **Needs:** web  ·  **Effort:** S ~half day (knowledge only) / M (all modules)  ·  **Risk:** Cosmetic only.


---
## /knowledge/assistant  —  `knowledge/assistant.html`

- **Source:** `apps/web/src/app/(app)/knowledge/assistant/page.tsx`
- **Design reference:** `redesign/knowledge/assistant.html`

### GAP-KNOWLEDGE-ASSISTANT-01  ·  HIGH  ·  confirmed  ·  theme VALIDATION (was LOADING)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Failed ask/escalate prints the raw proxy response body to the user: throw new Error(await res.text()) then setError(e.message) (AssistantClient.tsx:35,39,54,58,90) — breaks the clerk-safe error rule stated in RouteError.tsx.
- **Verified evidence:** AssistantClient.tsx:61 and :80 throw new Error((await res.text()) || fallback) and the catch blocks (l.64-66, l.83-85) setError(e.message), rendered at l.116. The fallback only applies when body is empty, so proxy/gateway JSON or HTML error bodies are shown to the clerk. Line numbers differ from the finding (35,39,54,58,90). RouteError.tsx header states raw server text must never be shown.
- **Files to change:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.tsx`
- **Fix steps:**
  1. Replace throw new Error(await res.text()) with throw new Error(status-only) and never surface e.message.
  2. Use toHumanError("load"/"save", {area:"assistant"}) from @/lib/messages for display, following knowledge/dashboard/page.tsx.
  3. Optionally log res.status to telemetry (no console.log per CLAUDE.md).
  4. Show error in an element with role="alert".
- **Acceptance:**
  - Mock proxy returning 500 with body '{"stack":...}': UI shows friendly message only.
  - Error region has role=alert.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-ASSISTANT-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Metrics failure renders real zeros: source==="error" only adds a badge while all four StatCards show 0 / 0% (page.tsx:16-21, loaders.ts:136 empty default) — reads as "no questions asked".
- **Verified evidence:** assistant/page.tsx:16 renders DataSourceBadge when source==="error" (so a badge is shown), but StatCards l.18-21 use loaders.ts empty default (getAssistantMetrics, ~l.132-133 all zeros) and render 0 / 0%. Zeros are thus shown beside a badge; misleading but not entirely unflagged.
- **Files to change:** `apps/web/src/app/(app)/knowledge/assistant/page.tsx`
- **Fix steps:**
  1. Set errored = source === "error".
  2. Pass "—" to all four StatCard values when errored.
  3. Optionally render RefreshErrorState above the stats but keep AssistantClient usable.
- **Acceptance:**
  - With source=error, all four stats show '—'; assistant input still works.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-KNOWLEDGE-ASSISTANT-03  ·  MEDIUM  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Enter key calls ask() without the busy guard (AssistantClient.tsx:76 vs disabled only on the button :82), allowing duplicate submissions.
- **Verified evidence:** AssistantClient.tsx:102 onKeyDown Enter calls void ask() with no busy check; ask() (l.49-51) only guards on !question.trim(), and the Button is disabled by busy at l.108. Pressing Enter repeatedly (or while thinking) fires duplicate POSTs. Also IME composition Enter isn't handled.
- **Files to change:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.tsx`
- **Fix steps:**
  1. Guard at top of ask(): if (busy || !question.trim()) return;
  2. In onKeyDown check !e.nativeEvent.isComposing && !busy.
  3. Wrap in a <form onSubmit> for native semantics and set max length on the input.
- **Acceptance:**
  - Test: fire two Enter keydowns quickly -> fetch called once.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-ASSISTANT-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Escalation is one click with hard-coded priority "Medium", no confirmation and no ticket reference returned to the user (AssistantClient.tsx:52,125).
- **Verified evidence:** AssistantClient.tsx:78 hard-codes priority "Medium" and escalate() (l.71-88) fires on a single click (button l.143-150); on success it sets escalated and shows 'A helpdesk ticket has been opened.' (l.151) but no ticket reference is displayed even though the response body is never read. Escalation creates a ticket, not a financial/approval action, so maker-checker is not applicable; a confirmation is optional. Finding's line numbers (52,125) are off.
- **Files to change:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.tsx`
- **Fix steps:**
  1. Read the escalate response JSON and show ticket id/number if returned (confirm response shape with backend; cannot verify).
  2. Add optional priority select (Low/Medium/High) defaulting to Medium.
  3. Add lightweight confirm or keep one-click but with an undo-safe 'Ticket opened' state (already present).
  4. Ensure backend emits audit event (not visible here).
- **Acceptance:**
  - After escalating, ticket reference appears when returned.
  - Priority selection is sent in request body.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-KNOWLEDGE-ASSISTANT-05  ·  MEDIUM  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Citations show a truncated document id (docId.slice(0,8)) as monospace with no link to the source document (AssistantClient.tsx:104); grounded flag is fetched but never used (:8).
- **Verified evidence:** AssistantClient.tsx:130 shows c.title plus ({c.docId.slice(0,8)}) in monospace, no link. The grounded field is declared in AskAnswer (l.34) but never read (answer.grounded unused). A document viewer route exists at knowledge/policies/[id] (policies only); no generic knowledge document detail route exists, so a link is only possible for policy-source citations. Line refs in finding (104, :8) are off.
- **Files to change:** `apps/web/src/app/(app)/knowledge/assistant/AssistantClient.tsx`
- **Fix steps:**
  1. Link citations with source === "policy" (verify actual source value) to /knowledge/policies/${docId}; otherwise render title only.
  2. Drop the truncated id from the visible text (keep in title attribute).
  3. Use answer.grounded: when false show a notice 'Answer is not grounded in a source document'.
  4. Long-term: add a document detail route and link all sources.
- **Acceptance:**
  - Policy citation is a link opening policy page.
  - Ungrounded answer shows notice.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /knowledge/dashboard  —  `knowledge/dashboard.html`

- **Source:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`
- **Design reference:** `redesign/knowledge/dashboard.html`

### GAP-KNOWLEDGE-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W2 knowledge re-confirmed in #2059: no storage/quota card; test apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'has no fabricated storage/quota card'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** "Storage — % of quota" is fabricated: storagePct = round(total documents / 500 × 100) (dashboard/page.tsx:93). A count of documents is presented as a storage quota; file bytes are never read.
- **Verified evidence:** dashboard/page.tsx:93 storagePct = min(100, round(total/500*100)); StorageDonut (l.46-66, rendered l.165) labels it 'Storage usage: N% of quota'. 500 is a magic number; no file size or quota data is read. KnowledgeDocSummary/types show no size field (grep of _data/types.ts found none).
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`
- **Fix steps:**
  1. Remove the Storage card, or replace with 'Documents' count if no quota API exists.
  2. If backend provides usedBytes/quotaBytes, add a loader and pass real values to StorageDonut; show 'not available' otherwise.
  3. Update aria-label accordingly.
- **Acceptance:**
  - No '% of quota' is displayed without real byte data.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; removing a misleading figure.

### GAP-KNOWLEDGE-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was DATEFMT)

- [x] **Status** (W2 knowledge re-confirmed in #2059: labels match computation; test apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'labels match computation: Active and Archived cards'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** "Due for Archival" counts status==="archived" (already archived) and "Under Retention" counts approved+under_review (page.tsx:82-83); neither derives from a retention date.
- **Verified evidence:** page.tsx:82 underRetention counts status approved or under_review; l.83 dueForArchival counts status==="archived" (already archived). Neither uses a retention date. A records loader exists (getKnowledgeRecords, loaders.ts:4421) with a records page; whether records carry retention/expiry dates cannot be verified from this file. Theme DATEFMT is wrong.
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Inspect KnowledgeRecord type for retentionUntil/disposalDate fields.
  2. If present, fetch getKnowledgeRecords() and compute Due for Archival = retention date within N days or past; format with formatIndianDate.
  3. If absent, rename cards to 'Archived' and 'Published/In review' to match what is counted.
- **Acceptance:**
  - Card labels match their computation.
  - Due for Archival changes when a retention date passes.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; but wrong retention counts could mislead records compliance.

### GAP-KNOWLEDGE-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W2 knowledge re-confirmed in #2059: chips carry ?q= and no bulk link; test apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'search chips carry the query param'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Dead deep links: Bulk upload → ?bulk=true (page.tsx:116) and search chips → ?q= (page.tsx:178) are ignored — documents/new/page.tsx reads only searchParams.category and search/page.tsx reads no params.
- **Verified evidence:** page.tsx:116 links /knowledge/documents/new?bulk=true; documents/new/page.tsx reads only searchParams.category and grep for 'bulk' in documents/ finds nothing. Search chips (l.178) link /knowledge/search?q=...; search/page.tsx takes no searchParams and passes only initialDocs; grep of SearchClient for searchParams/q found nothing.
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`, `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`, `apps/web/src/app/(app)/knowledge/search/page.tsx`, `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`
- **Fix steps:**
  1. Search: make page accept searchParams.q and pass initialQuery to KnowledgeSearchClient to prefill and run the filter.
  2. Bulk: either remove the button (an ImportButton already exists in repository/ and list/) or link to the repository page import flow.
  3. Remove readOnly quick-search input or make it a form to /knowledge/search.
- **Acceptance:**
  - Clicking a chip opens search with the term applied.
  - Bulk upload button opens an actual bulk flow.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-KNOWLEDGE-DASHBOARD-04  ·  MEDIUM  ·  partly  ·  theme WIRING (was I18N)

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Fixed: RecentDocsTable.tsx rowLinkKey=id -> /knowledge/documents/[id] (documents/[id] now exists); header already 'Author'. Test: apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'Given a recent document, then the author column reads Author (not Dept) and the title links to the document detail'.
- **First-pass claim:** Recent table labels doc.author as "Dept" (RecentDocsTable.tsx:21) and rows are not links; no document detail route exists under knowledge/.
- **Verified evidence:** RecentDocsTable.tsx:21 labels the doc.author column 'Dept'; rows have no link (columns l.208-218 have no render for title). No generic document detail route: knowledge has policies/[id] only. Author may be a person, not a department (page.tsx:102 author ?? '—'). Theme I18N is not the accurate tag.
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/RecentDocsTable.tsx`
- **Fix steps:**
  1. Rename header to 'Author' (or 'Owner') unless a department field exists.
  2. Link title to /knowledge/policies/${id} when category is policy; otherwise plain text until a detail route exists.
- **Acceptance:**
  - Header reads 'Author'.
  - Policy row title navigates to detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-DASHBOARD-06  ·  LOW  ·  partly  ·  theme VISUAL (was FABRICATED)

- [x] **Status** (W2 knowledge re-confirmed in #2059: residual literal hex fallbacks (var(--brand, #4f46e5) etc, and --brand is not even defined) removed in this PR -> var(--primary)/var(--ink)/var(--mut); test apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'announces the top categories with counts, labels each bar, and uses no literal hex colour'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Chart: hard-coded #ca8a04 fill, single-series labels truncated at 9 chars, no values/axis and a generic aria-label (page.tsx:25,32,35).
- **Verified evidence:** page.tsx:35 hard-codes fill="#ca8a04"; l.32 truncates labels at >10 chars to 9 + ellipsis (finding said 9); l.25 aria-label is 'Documents by category bar chart' with no data summary; bars have no value labels or axis, only <text> category names. Also fixed 9px text.
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`
- **Fix steps:**
  1. Use design tokens (var(--brand) or chart palette) instead of #ca8a04.
  2. Add value labels above bars and <title> per bar; lengthen aria-label to summarise top categories with counts.
  3. Add <title> with full name for truncated labels.
- **Acceptance:**
  - Screen reader announces categories and counts.
  - No literal hex in the chart.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-KNOWLEDGE-DASHBOARD-07  ·  LOW  ·  confirmed  ·  theme CAP

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main: StatCards/chart read the server aggregate GET /v1/knowledge/documents/summary (dashboard/page.tsx:73); the list feeds only the 5 recent rows and is capped by the service default page size. Tests: apps/web/src/app/(app)/knowledge/dashboard/page.test.tsx 'shows the repository-wide total, not the length of the capped list' and services/knowledge-service/tests/gap2-knowledge-dashboard-metrics.test.ts.
- **First-pass claim:** All aggregates are computed client-side from the full documents list (no aggregate endpoint) — cost grows with the repository; list is cached 120s (loaders.ts:4414).
- **Verified evidence:** page.tsx:77-98 loads the whole docs list via getKnowledgeDocs (loaders.ts:4412-4418, revalidateSeconds 120, fetch /api/v1/knowledge/documents, no limit) and computes counts, categories and recent 5 in the server component; no aggregate endpoint used. Cost is server-side render O(n) plus payload transfer, not client-side as stated (page is a server component). Cache is 120s as stated.
- **Files to change:** `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Request a /knowledge/documents/summary aggregate endpoint from backend (counts by status/category, recent 5) - cannot verify existence.
  2. Meanwhile add a ?limit and show 'based on first N documents' note when the list is capped.
  3. Replace computations with the summary response.
- **Acceptance:**
  - Dashboard loads with constant payload size regardless of repository size.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.


---
## /knowledge/documents/new  —  `knowledge/documents-new.html`

- **Source:** `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`
- **Design reference:** `redesign/knowledge/documents-new.html`

### GAP-KNOWLEDGE-DOCUMENTS-NEW-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [ ] **Status** (W2 knowledge INTERIM - needs owner decision: file upload. accessLevel is done (select, least-privilege default internal, server-side enum + clearance, restricted/confidential only for knowledge_admin). The create command has no fileKey and there is no object-storage upload flow; the form says so honestly instead of implying a file was stored.)
- **First-pass claim:** The form is titled "Publish Document" but posts only { title, category } (CreateDocumentForm.tsx:36-39): no file/content, access level, version or approval path, although list/search/detail views display accessLevel, version and fileType. The created record is an empty shell.
- **Verified evidence:** CreateDocumentForm.tsx:36-39 builds body {title, category} only; form renders just Title and Category inputs (:62-69). Button reads 'Publish document' (:81). No file, access level, version or content field, though list/KnowledgeDocsTable.tsx:23-25 and search show version/accessLevel. Backend createDocumentBody is only quoted in the comment at :9-12; knowledge-service is absent from the snapshot so accepted fields (file, accessLevel, version) cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.tsx`, `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`
- **Fix steps:**
  1. Confirm with knowledge-service which fields POST /api/v1/knowledge/documents accepts (accessLevel, fileKey/upload, version, description); add them to createDocumentBody (zod) if missing.
  2. Add an Access level <select> (values from KnowledgeDocSummary.accessLevel) and a file picker using the existing ds FileUpload (app/_components/ds/FileUpload.tsx) to CreateDocumentForm.
  3. Extend the zod-validated body and handleSubmit to send accessLevel and the uploaded file reference; disable submit until a file or body is present.
  4. Rename the submit/title copy to match what is created (see NEW-04).
- **Acceptance:**
  - Submitting with file + access level creates a document whose row in /knowledge/list shows that Access value.
  - Submitting without a file shows an inline required-field error and sends no request.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Uploads carry PII/DPDP-sensitive files; access level default must be least-privilege and enforced server-side.
- **Depends on:** GAP-KNOWLEDGE-DOCUMENTS-NEW-04

### GAP-KNOWLEDGE-DOCUMENTS-NEW-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Decision (the ledger's own safe option): remove the entry points. Dashboard bulk link was already gone; this PR deletes list/ImportButton.tsx and repository/ImportButton.tsx and their usage. Test: apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-NEW-02/LIST-04/NEW-04: no Import control; no link targets mode=import or bulk=true'.
- **First-pass claim:** ?bulk=true (dashboard) and ?mode=import (Import buttons in list/repository) both land here and are ignored — page.tsx reads only searchParams.category (page.tsx:4-6). Users who click Bulk upload/Import see the single-document form.
- **Verified evidence:** page.tsx:4-6 types searchParams as { category?: string } and reads only category; bulk and mode are never read. Producers: dashboard/page.tsx:116 (?bulk=true), list/ImportButton.tsx:11 and repository/ImportButton.tsx:11 (?mode=import). No bulk/import UI exists anywhere under knowledge/.
- **Files to change:** `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`, `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`, `apps/web/src/app/(app)/knowledge/list/ImportButton.tsx`, `apps/web/src/app/(app)/knowledge/repository/ImportButton.tsx`
- **Fix steps:**
  1. Decide: build bulk/import (CSV/zip upload via ds FileUpload with a per-row result table) or remove the entry points.
  2. If removing: delete the Bulk upload Link (dashboard/page.tsx:116) and both ImportButton.tsx files and their usages.
  3. If building: read searchParams.bulk/mode in page.tsx, render a BulkImportForm client component, POST each item to /documents and report per-row success/failure.
- **Acceptance:**
  - Clicking Bulk upload / Import either shows an import UI or the control is gone.
  - No link in the knowledge tree targets a query param the destination ignores.
- **Needs:** decision  ·  **Effort:** S ~half day (remove) / L >2d (build)  ·  **Risk:** Removing is safe; building bulk write needs per-row audit events and duplicate handling.
- **Depends on:** GAP-KNOWLEDGE-LIST-04

### GAP-KNOWLEDGE-DOCUMENTS-NEW-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: category is a select from _data/categories.ts and the repository segment uses categorySegment stems; tests apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.test.tsx (NEW-03) and apps/web/src/app/(app)/knowledge/_data/statusLabels.test.ts categorySegment, apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'choosing the Circulars segment keeps Circular documents'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Category is free text (form:68) but the repository segments filter by substring of "circulars/policies/notifications" (RepositoryClient.tsx:24) — typos or "Circular Letter" silently fall out of filters.
- **Verified evidence:** CreateDocumentForm.tsx:68 is a free-text input with placeholder 'Circular, Policy, Notification' (singular). RepositoryClient.tsx:24 filters with rawCategory.toLowerCase().includes(seg.toLowerCase()) where seg is 'Circulars'/'Policies'/'Notifications' (SEG_OPTIONS :17). So even the placeholder examples 'Circular', 'Policy', 'Notification' do NOT match (substring of plural), i.e. the documented usage silently drops out of segments. Stored category vocabulary in the backend is not visible.
- **Files to change:** `apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`
- **Fix steps:**
  1. Define a shared category constant list (e.g. knowledge/_data/categories.ts: Circular, Policy, Notification, Retention Schedule) used by form and filter.
  2. Replace the category <input> with a <select> from that list (keep ?category= default; keep Retention Schedule for records flow).
  3. Change RepositoryClient SEG_OPTIONS filter to exact match on the constant (case-insensitive) instead of includes(plural).
  4. Optionally validate category against the list in the zod body server-side.
- **Acceptance:**
  - Create a document with category 'Circular' and confirm it appears under the Circulars segment.
  - Unit test: filter function returns the doc for each canonical category and none for others.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Existing rows with free-text categories will not match the exact filter; map legacy values or keep a fallback 'Other'.

### GAP-KNOWLEDGE-DOCUMENTS-NEW-04  ·  MEDIUM  ·  partly  ·  theme COPY (was CONFIRM)

- [x] **Status** (W2 knowledge re-confirmed in #2059: residual: repository page still said '+ Publish Document' - now '+ Add Document' (t(), en+hi); tests apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'the create action reads + Add Document' and apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.test.tsx 'submit button reads Add document'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Button says "Publish" but no publish/approval semantics are visible; the maker-checker lifecycle lives on /knowledge/policies/[id] and this route does not create governed documents (POST /documents, not /policies).
- **Verified evidence:** Submit label is 'Publish document' (CreateDocumentForm.tsx:81) and page title 'Publish Document' (page.tsx:11), POSTing to /api/proxy/v1/knowledge/documents (:41). The governed lifecycle (submit/approve/publish/acknowledge) lives in policies/[id]/PolicyActions.tsx:20-69 against /policies/{id}/... The copy is misleading. The proposed fix (ConfirmDialog with reason, maker!=checker, audit) is not appropriate for a plain create; whether the documents endpoint sets a published status is not visible (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.tsx`, `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/page.tsx`, `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`
- **Fix steps:**
  1. Decide product intent: (a) plain repository upload -> rename to 'Add document' / 'Save document' and update the '+ Publish Document' buttons (repository/page.tsx:62, dashboard/page.tsx:117); or (b) governed doc -> route to a policies create flow (see POLICIES-01).
  2. Update PageHeader title/subtitle and the submit label accordingly; show a status hint ('Saved as draft') after success.
  3. Confirm server-side that documents POST emits an audit event (backend).
- **Acceptance:**
  - Button/title text matches resulting status shown in /knowledge/list after creation.
  - No 'Publish' wording remains on a route that does not run the publish lifecycle.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Copy-only if (a); (b) is a product change.
- **Depends on:** GAP-KNOWLEDGE-POLICIES-01

### GAP-KNOWLEDGE-DOCUMENTS-NEW-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: no inline #fff on .field cards; banner uses tokens; test apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.test.tsx 'does not hard-code a white background on the field cards'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Field wrappers hard-code background:#fff (form:62,66) and a fixed maxWidth 820, so dark mode shows white cards.
- **Verified evidence:** CreateDocumentForm.tsx:62 and :66 set inline background:'#fff' on .field wrappers, overriding civitas-ds.css:221 .field{background:var(--panel)}; dark mode is a .dark class on <html> (civitas-ds.css:317), so these render white. Also page.tsx:20 hard-codes the info banner colours (#fffaeb/#92400e). The fixed maxWidth 820 (form :60, page :20) is a layout choice, not a dark-mode defect.
- **Files to change:** `apps/web/src/app/(app)/knowledge/documents/new/CreateDocumentForm.tsx`, `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`
- **Fix steps:**
  1. Delete the background:'#fff' from both .field style props (keep padding, or drop it too since .field already sets padding).
  2. Replace the banner's inline hex colours in page.tsx:20 with a token-based class (e.g. existing .banner/.pill warn tokens).
  3. Move maxWidth 820 into a class if reuse is desired.
- **Acceptance:**
  - Toggle dark mode: Title and Category cards use panel colour, text readable.
  - Light mode visually unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /knowledge/faqs  —  `knowledge/faqs.html`

- **Source:** `apps/web/src/app/(app)/knowledge/faqs/page.tsx`
- **Design reference:** `redesign/knowledge/faqs.html`

### GAP-KNOWLEDGE-FAQS-01  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Stat cards are not null-gated: on error the page shows badge + RefreshErrorState but FAQs/Categories/Guided flows read 0 (page.tsx:24-28,30).
- **Verified evidence:** faqs/page.tsx:25-27 pass faqs.length, categories.size, flows.length directly; loader fallback is [] (loaders.ts:99,115) so on error all read '0'. errored (:12) only gates the body (:30) and badge (:23). The error body itself already uses RefreshErrorState (:31). StatCard maps null/NaN to '—' (StatCard.tsx displayValue), so passing null is enough.
- **Files to change:** `apps/web/src/app/(app)/knowledge/faqs/page.tsx`
- **Fix steps:**
  1. In the three StatCard value props use errored ? null : x.toLocaleString('en-IN') (or the '—' string as list/page.tsx:59 does).
  2. Optionally set backHref='/knowledge' on RefreshErrorState (:31).
- **Acceptance:**
  - Force the loaders to error (stop knowledge-service): stat cards show '—', not 0.
  - Healthy state with zero FAQs still shows 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-KNOWLEDGE-FAQS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** "Browse" page with no search or category filter; long FAQ lists are only scannable by scrolling, while /knowledge/search covers documents only (SearchClient.tsx:63-74).
- **Verified evidence:** faqs/page.tsx renders every FAQ as <details> (:40-48) with no input or filter; page is a server component. SearchClient.tsx:55-74 filters initialDocs (documents) only. FaqSummary carries category and tags (loaders.ts:106-107) so client-side filtering needs no backend change.
- **Files to change:** `apps/web/src/app/(app)/knowledge/faqs/page.tsx`, `apps/web/src/app/(app)/knowledge/faqs/FaqBrowser.tsx`
- **Fix steps:**
  1. Create client component FaqBrowser({faqs}) with a search input and category <select> (derive from f.category ?? 'General').
  2. Filter on question, answer and tags case-insensitively; show EmptyState 'No FAQs match' with clear-filters.
  3. Render FaqBrowser from page.tsx in place of the inline map (keep server fetch); keep <details> markup.
- **Acceptance:**
  - Typing a keyword hides non-matching FAQs; clearing restores all.
  - Selecting a category shows only that category; FAQs with null category appear under 'General'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** None; read-only UI.
- **Depends on:** GAP-KNOWLEDGE-FAQS-05

### GAP-KNOWLEDGE-FAQS-05  ·  LOW  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Null category is counted as "general" in the stat (page.tsx:14) but no category label is printed for those FAQs (page.tsx:44).
- **Verified evidence:** faqs/page.tsx:14 counts null category as 'general' in the Categories stat, while :44 prints the category only when truthy, so uncategorised FAQs show no label. Theme is not I18N.
- **Files to change:** `apps/web/src/app/(app)/knowledge/faqs/page.tsx`
- **Fix steps:**
  1. Introduce const cat = f.category ?? 'General' and render it at :44 (or exclude null from the Categories count at :14).
  2. Share the same derivation with the FaqBrowser filter (FAQS-03).
- **Acceptance:**
  - An FAQ with null category shows '· General'.
  - Categories stat equals the number of distinct labels visible.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-KNOWLEDGE-FAQS-03

### GAP-KNOWLEDGE-FAQS-06  ·  LOW  ·  partly  ·  theme OTHER (was DEADROUTE)

- [ ] **Status** (W2 knowledge INTERIM - needs backend field: the FAQ API/table has no sourcePolicyId/sourceDocId, so there is nothing to link. Not invented.)
- **First-pass claim:** Answers render as pre-wrapped plain text (page.tsx:46): no links to the cited policy despite the assistant citing documents.
- **Verified evidence:** Answer is rendered as <p style=whiteSpace:pre-wrap>{f.answer}</p> (faqs/page.tsx:46) - true. But the FAQ loader maps only id, question, answer, category, tags, status, updatedAt (loaders.ts:102-110); there is no policy/document reference field, so there is no dead link, just no data to link. Assistant citations exist separately (assistant/AssistantClient.tsx:97-101). Whether the API exposes a sourceDocId is not visible (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/_data/loaders.ts`, `apps/web/src/app/(app)/knowledge/_data/types.ts`, `apps/web/src/app/(app)/knowledge/faqs/page.tsx`
- **Fix steps:**
  1. Ask knowledge-service whether FaqSummary can expose sourcePolicyId/sourceDocId; if so add it to types.ts and the loaders.ts:102 mapper.
  2. In faqs/page.tsx render 'Source: <Link href=/knowledge/policies/{id}>' under the answer when present.
  3. Optionally auto-link URLs in answer via a small safe linkify helper (no dangerouslySetInnerHTML).
- **Acceptance:**
  - FAQ with sourcePolicyId shows a link that opens /knowledge/policies/[id].
  - FAQ without it renders unchanged.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; ensure link text is plain-escaped.


---
## /knowledge/list  —  `knowledge/list.html`

- **Source:** `apps/web/src/app/(app)/knowledge/list/page.tsx`
- **Design reference:** `redesign/knowledge/list.html`

### GAP-KNOWLEDGE-LIST-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [ ] **Status** (W2 knowledge partial in #2059 - needs owner decision for the rest: rows now open /knowledge/documents/[id] from repository, dashboard and search (list route redirects). Still open: download, archive-with-reason and version upload - knowledge-service has no archive/download command (only PATCH articles/:id/publish). Needs a product decision and a maker-checker/audit design before building. Was: W1 SF-02/03 re-check #2010 reopened.)
- **W2 evidence:** Tests for the row link: apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-LIST-01: a row title links to /knowledge/documents/<full id>'; apps/web/src/app/(app)/knowledge/documents/[id]/page.test.tsx.
- **First-pass claim:** Dead-end table: rows have no link and no detail route exists (knowledge/ has documents/new only) — a document cannot be opened, downloaded, versioned or archived from any page.
- **Verified evidence:** list/page.tsx:72 renders KnowledgeDocsTable; its DataTable (KnowledgeDocsTable.tsx:18-36) has no rowLinkKey/rowLinkPrefix (policies/page.tsx:75-76 shows the prop pair). rows.id is the truncated 8-char string (page.tsx:34), so the real id is not even in the row. knowledge/documents contains only new/ (no [id] route), no download/archive/version calls anywhere in apps/web/src knowledge. Backend endpoints for GET/archive/version are not visible (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/list/page.tsx`, `apps/web/src/app/(app)/knowledge/list/KnowledgeDocsTable.tsx`, `apps/web/src/app/(app)/knowledge/documents/[id]/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`
- **Fix steps:**
  1. Confirm knowledge-service endpoints: GET /documents/{id}, download URL, POST archive, version upload; add to loaders (documents/_data).
  2. Add rawId to DocRow in list/page.tsx and repository/page.tsx; pass rowLinkKey='rawId' rowLinkPrefix='/knowledge/documents/'.
  3. Create documents/[id]/page.tsx (metadata, version list, download, archive via ActionButton with requireReason) with loading.tsx and not-found handling.
  4. Emit audit for archive/download server-side.
- **Acceptance:**
  - Clicking a row opens /knowledge/documents/<uuid> with metadata and status.
  - Archive requires a reason and the doc leaves the active list.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Archive/download of controlled documents needs access-level checks server-side (DPDP).
- **Depends on:** GAP-KNOWLEDGE-LIST-02, GAP-KNOWLEDGE-LIST-03

### GAP-KNOWLEDGE-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 knowledge re-confirmed in #2059: no truncated-UUID Doc ID column; test apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-LIST-02: no Doc ID column and author header reads Author'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** "Doc ID" is the first 8 hex characters of the UUID upper-cased (page.tsx:34) — not a stable reference number and not what policies show (referenceNo).
- **Verified evidence:** list/page.tsx:34 sets id: doc.id.slice(0,8).toUpperCase(); repository/page.tsx:43 does the same. Governed policies show referenceNo with the same slice only as a fallback (policies/page.tsx:22). Whether the documents API returns a referenceNo is not visible (KnowledgeDocSummary type is imported from a module absent in the snapshot).
- **Files to change:** `apps/web/src/app/(app)/knowledge/list/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Fix steps:**
  1. Check KnowledgeDocSummary/knowledge-service for a reference/number field; if absent request one (backend sequence per tenant).
  2. Show that reference in the 'Doc ID' column; otherwise remove the column or show '—'.
  3. Keep the full id only as rawId for links (see LIST-01).
- **Acceptance:**
  - No truncated UUID appears in the Doc ID column.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Removing the column changes CSV export.
- **Depends on:** GAP-KNOWLEDGE-LIST-01

### GAP-KNOWLEDGE-LIST-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was VALIDATION)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Near-duplicate of /knowledge/repository (same loader, same table with fewer columns) and not linked from the hub; two competing lists with different status labels (repository labels under_review "Draft", repository/page.tsx:18).
- **Verified evidence:** Both list/page.tsx:10 and repository/page.tsx:9 call getKnowledgeDocs() (app/_data/loaders.ts:4412). list adds stats, Access column and status labels; repository adds Circulars/Policies/Notifications segments. Status labels do differ: list:21 'Under review' vs repository:18 'Draft' for under_review, and repository has no draft label (:16-21). /knowledge/list has no inbound link. Extra defect: repository stat cards 'Circulars' = approved count and 'Notifications' = under_review count (repository/page.tsx:69,71) - not real category counts. Theme VALIDATION is wrong.
- **Files to change:** `apps/web/src/app/(app)/knowledge/list/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`, `apps/web/src/app/(app)/knowledge/_data/docStatus.ts`
- **Fix steps:**
  1. Choose one canonical list (recommend repository) and fold list's Access column/stats into it.
  2. Make list/page.tsx redirect('/knowledge/repository') or delete it and list/ImportButton.tsx, KnowledgeDocsTable.tsx, loading.tsx.
  3. Extract statusLabel/statusPillStatus into docStatus.ts and use in every page (dashboard too) with under_review -> 'Under review'.
  4. Fix repository stat cards to count by category, not by status.
- **Acceptance:**
  - Only one documents list exists; status label for under_review is identical everywhere.
  - Circulars stat equals count of docs in the Circular category.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Bookmarks to /knowledge/list must redirect.
- **Depends on:** GAP-KNOWLEDGE-DOCUMENTS-NEW-03

### GAP-KNOWLEDGE-LIST-04  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Both ImportButton components deleted (list/ and repository/). Test: apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-NEW-02/LIST-04/NEW-04: no Import control'.
- **First-pass claim:** Import button is a plain navigation to ?mode=import, which the target page ignores (ImportButton.tsx:11, documents/new/page.tsx:4-6) — no import UI exists.
- **Verified evidence:** list/ImportButton.tsx:10-12 sets window.location.href='/knowledge/documents/new?mode=import' (full page reload, not router push); documents/new/page.tsx:4-6 ignores mode. repository/ImportButton.tsx is an identical copy. No import UI exists.
- **Files to change:** `apps/web/src/app/(app)/knowledge/list/ImportButton.tsx`, `apps/web/src/app/(app)/knowledge/repository/ImportButton.tsx`
- **Fix steps:**
  1. Remove both ImportButton components and their <ImportButton /> usages until an import flow exists (see NEW-02).
  2. If kept, use next/link or router.push and read mode in the destination page.
- **Acceptance:**
  - Neither list nor repository shows an Import button, or Import opens a functioning importer.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-KNOWLEDGE-DOCUMENTS-NEW-02

### GAP-KNOWLEDGE-LIST-06  ·  LOW  ·  confirmed  ·  theme OTHER (was PII)

- [x] **Status** (W2 knowledge re-confirmed in #2059: residual: the Access column did not exist on the surviving list (repository) - added in this PR with lock + spelled-out level; tests apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'LIST-06: restricted documents show a lock and the spelled-out level' and apps/web/src/app/(app)/knowledge/documents/[id]/page.test.tsx 'shows lock icon for restricted access level'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Access level printed raw (KnowledgeDocsTable.tsx:25) with no pill or lock icon for restricted documents (DPDP visibility cue).
- **Verified evidence:** KnowledgeDocsTable.tsx:25 declares { key:'accessLevel', label:'Access' } with no render, so DataTable.cellValue (DataTable.tsx:138) prints the raw string. Restriction is not visually distinguished. The proposed <Masked> fix does not apply (nothing to mask; the mask helper does not exist in the shared tree, only a local MaskedInput in hr/employees/new/steps/Step4.tsx). Enforcement of access level on the server cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/knowledge/list/KnowledgeDocsTable.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`
- **Fix steps:**
  1. Add a render for accessLevel that shows a pill (StatusPill or new AccessPill) with a lock icon and sr-only text for restricted/confidential values; humanize labels.
  2. Enumerate accessLevel values from the API type and map each to a variant; unknown -> neutral.
- **Acceptance:**
  - Restricted docs show lock icon + text 'Restricted'; public shows neutral pill.
  - Screen reader reads the level, not just colour.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Display only; do not treat as access control.


---
## /knowledge/policies  —  `knowledge/policies.html`

- **Source:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`
- **Design reference:** `redesign/knowledge/policies.html`

### GAP-KNOWLEDGE-POLICIES-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: policies/new + CreatePolicyForm + role-gated '+ New'; empty state now has the create link inside it (this PR); tests apps/web/src/app/(app)/knowledge/policies/page.test.tsx 'GAP-POLICIES-01: + New action links to /knowledge/policies/new' and 'an author sees a working create link inside the empty state'; services/knowledge-service/tests/policies-lifecycle.test.ts 'creates a draft SOP'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Empty state instructs "Create a SOP, policy or circular to begin the lifecycle" (page.tsx:62) but the route has no create action and there is no policies/new page; documents/new posts to /documents, not /policies, so governed documents cannot be authored from the web app.
- **Verified evidence:** policies/page.tsx:62 EmptyState says 'Create a SOP, policy or circular...' yet PageHeader (:45-49) has no actions, and there is no policies/new directory. No web code POSTs to /knowledge/policies (only lifecycle calls at PolicyActions.tsx:20). documents/new posts to /documents (CreateDocumentForm.tsx:41). A draft-creating policies endpoint is implied by the lifecycle (submit on 'draft') but cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`, `apps/web/src/app/(app)/knowledge/policies/new/page.tsx`, `apps/web/src/app/(app)/knowledge/policies/new/CreatePolicyForm.tsx`
- **Fix steps:**
  1. Confirm POST /api/v1/knowledge/policies body (docType, title, body, reviewMonths?) with backend.
  2. Add policies/new/page.tsx + CreatePolicyForm (title, docType select sop/policy/circular, body textarea) using useFormError, zod validation and the proxy pattern of CreateDocumentForm.
  3. Add PageHeader actions '+ New' linking to it (role-gated) and redirect to the new /knowledge/policies/[id] on success.
- **Acceptance:**
  - Authoring a draft creates a row with status draft visible in the list.
  - Empty state now offers a working create link.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** New governed documents must emit audit events; author becomes maker.
- **Depends on:** GAP-KNOWLEDGE-DOCUMENTS-NEW-04

### GAP-KNOWLEDGE-POLICIES-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main (policies/page.tsx toRow docType uppercased, PoliciesTable has no cellType on Type). Test: apps/web/src/app/(app)/knowledge/policies/page.test.tsx 'GAP-POLICIES-02: the Type cell is plain text, not a status pill (and Status is)'.
- **First-pass claim:** cellType "status" is applied to Type (page.tsx:67), so document type gets status-pill semantics (colour implies state).
- **Verified evidence:** policies/page.tsx:67 sets cellType:'status' on docType; DataTable.cellValue (DataTable.tsx:127) renders StatusPill, which falls back to variant 'info' (blue) for unknown values (StatusPill.tsx), so every type gets a state-looking pill (label humanized, e.g. 'Sop').
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`
- **Fix steps:**
  1. Remove cellType from the Type column; use render with a neutral tag (uppercase SOP/POLICY/CIRCULAR).
- **Acceptance:**
  - Type column shows plain neutral text/tag, not a status pill.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-KNOWLEDGE-POLICIES-03  ·  MEDIUM  ·  partly  ·  theme OTHER (was DEADROUTE)

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main for the acceptance criteria (overdue pill, Review-due stat links to ?filter=review-due). Author column deliberately not added: the API returns ids only (no names) - tracked under POLICIES-DETAIL-01. Tests: apps/web/src/app/(app)/knowledge/policies/page.test.tsx 'GAP-POLICIES-03: an overdue published review shows a red (bad) Overdue pill', 'Review due stat links to ?filter=review-due', '?filter=review-due shows review-due data only'.
- **First-pass claim:** No owner/author, approver or overdue cue in the table although authorId/approverId are loaded (loaders.ts:42-43); "Review due" stat has no link to the list filtered to overdue reviews.
- **Verified evidence:** Row type/columns (policies/page.tsx:8-17,65-73) omit author/approver although loaded (loaders.ts:42-43); reviewDue is plain text with no overdue cue (:27). The 'Review due' StatCard (:55) is not clickable and StatCard has no href prop (StatCard.tsx:4-11), so a link would need a wrapper. Data is UUIDs, so names need a lookup. It is missing feature, not a dead link (theme wrong).
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`, `apps/web/src/app/_components/ds/StatCard.tsx`
- **Fix steps:**
  1. Add reviewDueDate < today check and show an 'Overdue' StatusPill (overdue maps to bad) in the Review due column.
  2. Add ?filter=review-due handling in page.tsx (searchParams) showing the getReviewDuePolicies() rows and wrap the stat in a Link.
  3. Add Author column once names are resolvable (backend or HR lookup).
- **Acceptance:**
  - Overdue review dates show a red Overdue pill.
  - Clicking the Review due stat lists only those policies.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** None.
- **Depends on:** GAP-KNOWLEDGE-POLICIES-DETAIL-01

### GAP-KNOWLEDGE-POLICIES-05  ·  LOW  ·  confirmed  ·  theme UUID

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main (list and detail show 'Unassigned'). Tests: apps/web/src/app/(app)/knowledge/policies/page.test.tsx 'GAP-POLICIES-05' and apps/web/src/app/(app)/knowledge/policies/[id]/page.test.tsx 'GAP-POLICIES-05: a draft without referenceNo shows Unassigned in the header'.
- **First-pass claim:** Reference falls back to id.slice(0,8) for drafts without referenceNo (page.tsx:22) — a truncated UUID shown as a document number.
- **Verified evidence:** policies/page.tsx:22 uses p.referenceNo ?? p.id.slice(0,8).toUpperCase(); same fallback in [id]/page.tsx:30. Truncated UUID looks like a real document number.
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`, `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`
- **Fix steps:**
  1. Replace the fallback with '—' or 'Unassigned (draft)' in both places.
  2. Confirm backend assigns referenceNo at approval/publish.
- **Acceptance:**
  - Draft without referenceNo shows 'Unassigned', never hex.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-KNOWLEDGE-POLICIES-06  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13 re-confirmed W1 SF-02/03 (#2010): closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Statuses shown lowercase with underscores replaced ("under review"), not sentence-case labels used on the dashboard/list pages (page.tsx:25).
- **Verified evidence:** toRow makes status 'under review' (policies/page.tsx:25), but the Status column uses cellType 'status' (:69) so the visible pill is passed through StatusPill/humanizeStatus -> 'Under Review' (Title Case), not lowercase. It stays lowercase in CSV export and the filter text, and in the detail StatCard (policies/[id]/page.tsx:34 renders policy.status.replace(/_/g,' ') as plain lowercase). list/page.tsx uses sentence case ('Under review'), so labels are inconsistent.
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/page.tsx`, `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Create a shared policyStatusLabel() (sentence case) and use it in policies/page.tsx, [id]/page.tsx and the documents helper.
  2. Pass label to StatusPill via render in the Status column instead of relying on cellType.
- **Acceptance:**
  - Detail page Status card shows 'Under review'; list pill and CSV use the same label.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-KNOWLEDGE-LIST-03


---
## /knowledge/policies/[id]  —  `knowledge/policies-detail.html`

- **Source:** `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`
- **Design reference:** `redesign/knowledge/policies-detail.html`

### GAP-KNOWLEDGE-POLICIES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (W2 knowledge INTERIM - needs identity lookup: DPDP part done server-side (acknowledgement list returns everyone only to approver roles; others get the total and their own id) and the page prints no UUIDs. Resolving ids to names needs a directory lookup the knowledge-service must not join to; owner decision on the source (hr/identity API) needed.)
- **W2 evidence:** Tests: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'the acknowledgement list shows an approver everyone, but a knowledge_user only the total and their own id'; apps/web/src/app/(app)/knowledge/policies/[id]/page.test.tsx 'GAP-DETAIL-01'.
- **First-pass claim:** Acknowledgement list prints raw employee UUIDs to every viewer (page.tsx:60-64): unreadable for the HR owner and a DPDP concern (who has/hasn’t acknowledged is personal data); no role gate is visible in the web tree.
- **Verified evidence:** policies/[id]/page.tsx:60-64 maps acks.employeeIds to <li> monospace raw ids. No role check exists in page.tsx; roleGuard.getSessionRoles()/PermissionDenied are used elsewhere (hr/rti/page.tsx:37-40) but not here. No shared Masked component exists. Server-side authorisation of the /acknowledgements endpoint is not visible (service absent). Employee names would need a lookup (getEmployees, app/_data/loaders.ts:1122) - the ack payload carries ids only.
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/knowledge/_data/loaders.ts`
- **Fix steps:**
  1. Gate the acknowledgements card by role in page.tsx using getSessionRoles() (e.g. HR/policy-owner roles - decision) and render PermissionDenied or only the count for others.
  2. Resolve ids to names: ask backend to return {employeeId, name, ackedAt}, or batch-lookup via the HR employee loader server-side.
  3. Render name + short department instead of the UUID; keep id in a title/ARIA attribute only for permitted roles.
  4. Confirm backend audit-logs reads of the ack list.
- **Acceptance:**
  - Non-HR user opening a published policy sees the count only.
  - HR user sees names, not UUIDs.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of who read what; role list must be agreed with HR.

### GAP-KNOWLEDGE-POLICIES-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W2 PQ: closed by #2037)
- **W0-10 note:** review found the W0 tick partly — authorId/currentUserId wired (page.tsx:76-80, getSessionUserId roleGuard.ts:56) and Approve/Publish disabled for author, BUT disabled button shows no reason: explanation lives only in confirmDescription (PolicyActions.tsx:72-77,116-121) which never opens when disabled (ActionButton.tsx:108-115 has no title/tooltip); no role-eligibility check for approver rights (step 3); server maker-checker exists (policies/commands.ts:123,173)
- **First-pass claim:** Lifecycle buttons render by status only (PolicyActions.tsx:29-32): Approve is offered to the author and to every role; the maker-checker rule fails only after Confirm, and the raw server text is shown in the dialog (PolicyActions.tsx:25).
- **Verified evidence:** PolicyActions.tsx:29-32 derive canSubmit/canApprove/canPublish/canAcknowledge from status only; the component receives only policyId and status (:15), and page.tsx:47 does not pass authorId or the session user. The dialog itself says 'you must not be the author' (:50). On failure post() throws new Error(await res.text()) (:25) and ActionButton shows e.message in the dialog (ActionButton.tsx:48-49), i.e. raw server body (likely JSON). Server-side maker-checker enforcement is claimed in the comment (:10) but the service is absent - cannot verify. Session helpers: roleGuard.ts has roles/tid/name but no getSessionUserId (sub is in the JWT payload type, roleGuard.ts:6); whether sub equals authorId is unknown.
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/PolicyActions.tsx`, `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Add getSessionUserId() to lib/auth/roleGuard.ts (decode payload.sub); confirm sub maps to authorId.
  2. In page.tsx pass authorId={policy.authorId}, currentUserId and roles to PolicyActions.
  3. In PolicyActions compute isAuthor and role eligibility; disable/hide Approve and Publish with an explanatory tooltip when isAuthor or role lacks approver rights.
  4. Replace throw new Error(await res.text()) with parsed envelope -> toHumanError/useFormError message (lib/useFormError.ts, lib/messages.ts).
  5. Keep server enforcement; add a test that same-user approve returns 403.
- **Acceptance:**
  - Author opens own under_review doc: Approve disabled with reason text.
  - Different approver can approve; forced 403 shows a readable message, not JSON.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Hiding is UX only; server check is the control. Wrong sub/authorId mapping could lock out legitimate approvers.
- **Depends on:** GAP-KNOWLEDGE-POLICIES-DETAIL-04

### GAP-KNOWLEDGE-POLICIES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was CONFIRM)

- [x] **Status** (W0 2026-10-13 re-confirmed in W2 PQ-A #2037 (files touched, behaviour re-checked, tests green); was W0 PROVISIONAL: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Publish hard-codes reviewMonths:12 and the dialog promises "sets the effective date" (PolicyActions.tsx:58-59) — reviewer cannot choose effective date or review cycle.
- **Verified evidence:** PolicyActions.tsx:59 sends { reviewMonths: 12 } fixed; ActionButton offers only an optional reason input (requireReason, ActionButton.tsx:74), not effective-date or review-cycle fields. Dialog text at :58 says 'sets the effective date' without stating the value. Whether the publish endpoint accepts effectiveDate is not visible (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/PolicyActions.tsx`
- **Fix steps:**
  1. Replace the Publish ActionButton with useConfirmAction + ConfirmDialog (ds) hosting a review-cycle <select> (6/12/24 months) and, if backend supports it, an effective-date input defaulting to today.
  2. Show the resulting review-due date in the dialog text.
  3. Send { reviewMonths, effectiveDate? } from state; validate with zod on the server.
- **Acceptance:**
  - Choosing 24 months results in reviewDueDate = effective + 24 months on the detail page.
  - Dialog states the effective date that will be applied.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Publishing notifies users and opens acknowledgements; wrong date has compliance consequences.

### GAP-KNOWLEDGE-POLICIES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (W2 knowledge INTERIM - names + reason: Return/Reject with a mandatory reason exists and an Approval trail card now shows author/reviewer/approver relative to the viewer without raw ids. Still open: names (see DETAIL-01) and showing the reject reason in the trail - the service keeps the reason only in the event/audit payload, not on the record; needs a schema decision. Was: W1 SF-02/03 re-check #2010 reopened.)
- **W2 evidence:** Tests: apps/web/src/app/(app)/knowledge/policies/[id]/page.test.tsx 'GAP-DETAIL-04: the approval trail ...' (x2); apps/web/src/app/(app)/knowledge/policies/[id]/PolicyActions.test.tsx 'GAP-DETAIL-04'; services/knowledge-service/tests/reject-endpoint.test.ts.
- **First-pass claim:** Under review has only Approve — no Reject / return-for-changes path (PolicyActions.tsx:46-53); reviewerId, approverId, authorId and supersedesId are loaded but never displayed (loaders.ts:42-43,71-72), so maker-checker evidence is invisible.
- **Verified evidence:** PolicyActions.tsx:46-53 shows only Approve for under_review; there is no reject/return action and no reject endpoint call in the web tree. authorId/approverId are mapped in toPolicySummary (loaders.ts:42-43), reviewerId/supersedesId in the detail mapper (loaders.ts:77-78); page.tsx never renders them (only status/effective/review/ack count, :34-37). Line refs in the observation (71-72) are off by a few lines. Existence of a reject endpoint cannot be verified (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/PolicyActions.tsx`, `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`
- **Fix steps:**
  1. Confirm/ask backend for POST /policies/{id}/reject (or return) that requires a reason and emits an audit event.
  2. Add a Reject ActionButton (danger, requireReason, minReasonLength 10) beside Approve when canApprove.
  3. Add an 'Approval trail' card in page.tsx showing author, reviewer, approver (names, not UUIDs - see DETAIL-01) and supersedes link.
- **Acceptance:**
  - Reject with reason returns doc to draft and reason appears in the trail.
  - Approval trail lists author/reviewer/approver for a published policy.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval workflow change; must be audit-logged.
- **Depends on:** GAP-KNOWLEDGE-POLICIES-DETAIL-01, GAP-KNOWLEDGE-POLICIES-DETAIL-02

### GAP-KNOWLEDGE-POLICIES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: server now returns the caller's own id to non-approvers so alreadyAcknowledged still works; was W0 re-confirmed W1 SF-02/03 (#2010): closed by #1916). Tests: apps/web/src/app/(app)/knowledge/policies/[id]/page.test.tsx 'GAP-DETAIL-05'; services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'acknowledging twice yields one ack'
- **First-pass claim:** "I have read & understood" stays available while status is published, with no per-user acknowledged state; repeat acknowledgements and the constant note "Read and understood" (PolicyActions.tsx:62-67) are unmanaged.
- **Verified evidence:** canAcknowledge = status === 'published' (PolicyActions.tsx:32) and the note is the constant 'Read and understood' (:67) - true. But the component cannot know the current employee's ack state: page.tsx:47 passes only policyId/status, the ack list has employee ids only, and the session has no employee id helper. Whether the server ignores duplicate acknowledgements is not visible (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/PolicyActions.tsx`, `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Confirm server idempotency; if not, make POST acknowledge idempotent per employee+version.
  2. Pass alreadyAcknowledged (session employee id in acks.employeeIds) to PolicyActions and replace the button with an 'Acknowledged on <date>' note.
  3. Optionally add a comment textarea instead of the fixed note (ActionButton needs custom body, or useConfirmAction).
- **Acceptance:**
  - Second acknowledge attempt is not offered / returns no duplicate row.
  - Acknowledgement count increases by exactly 1 per employee.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Ack records are compliance evidence; duplicates skew counts.
- **Depends on:** GAP-KNOWLEDGE-POLICIES-DETAIL-01

### GAP-KNOWLEDGE-POLICIES-DETAIL-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** No version history, no download and no supersedes link; body is plain pre-wrapped text (page.tsx:42-44).
- **Verified evidence:** page.tsx:42-44 renders policy.body as pre-wrap text. No version history, download or supersedes link is rendered although supersedesId is loaded (loaders.ts:78) and the target route /knowledge/policies/[id] exists. Version-history and download endpoints are unknown (service absent).
- **Files to change:** `apps/web/src/app/(app)/knowledge/policies/[id]/page.tsx`, `apps/web/src/app/(app)/knowledge/_data/loaders.ts`
- **Fix steps:**
  1. Render 'Supersedes' with <Link href={'/knowledge/policies/'+policy.supersedesId}> (web-only, quick win).
  2. Ask backend for version list + download endpoints; add a 'Versions' card and a Download button when available.
  3. Render body via a sanitised markdown component if body is markdown (decision).
- **Acceptance:**
  - Policy with supersedesId shows a working link to the older version.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /knowledge/records  —  `knowledge/records.html`

- **Source:** `apps/web/src/app/(app)/knowledge/records/page.tsx`
- **Design reference:** `redesign/knowledge/records.html`

### GAP-KNOWLEDGE-RECORDS-01  ·  HIGH  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** (W2 knowledge re-confirmed in #2059: disposed/transferred labels and neutral pill; tests apps/web/src/app/(app)/knowledge/records/page.test.tsx 'GAP-RECORDS-01' and apps/web/src/app/(app)/knowledge/_data/statusLabels.test.ts recordStatusLabel/recordStatusPill; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** A record with status "disposed" (already destroyed) is labelled "Weeding due" with a red rejected pill and counted in "Weeding Due" (page.tsx:26,34,81) — the register shows finished disposals as pending work.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx:26,34 map status 'disposed' to pill 'rejected' and label 'Weeding due'; :81 counts disposed as 'Weeding Due' KPI. 'disposed' is a terminal state so the label presents a finished action as pending work. Strings are hard-coded English (no next-intl), which is the tagged theme but a minor part.
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`
- **Fix steps:**
  1. In recordStatusLabel map 'disposed' to 'Disposed' and 'transferred' to 'Transferred' (not 'Review').
  2. Change recordStatusPill('disposed') to a neutral/archived pill, not 'rejected'.
  3. Define 'Weeding due' as status==='active' && disposalDueDate<=today, and use that for the Weeding Due KPI (see RECORDS-02).
  4. Move labels to a shared status-label map/next-intl keys; keep text on the pill so meaning is not colour-only.
- **Acceptance:**
  - Component test: record with status disposed renders 'Disposed' with no red pill.
  - KPI Weeding Due excludes disposed records and counts active overdue ones.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display only. Do not change stored statuses.
- **Depends on:** GAP-KNOWLEDGE-RECORDS-02

### GAP-KNOWLEDGE-RECORDS-02  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: isReviewDue/isWeedingDue boundaries; tests apps/web/src/app/(app)/knowledge/_data/recordDue.test.ts and apps/web/src/app/(app)/knowledge/records/page.test.tsx 'GAP-RECORDS-01/02'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** "Due" means three different things: KPI Due Review = active with disposalDueDate ≤ +30 days (page.tsx:17-21), KPI Weeding Due = disposed (page.tsx:81), Due segment = disposed OR transferred (RecordsClient.tsx:23-24). Counts will not reconcile with the filtered table.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx:17-21 Due Review = active with disposalDueDate<=now+30d; :81 Weeding Due = status disposed; RecordsClient.tsx:22-24 'Due' segment = disposed OR transferred. Three definitions; the Due segment matches neither KPI.
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`, `apps/web/src/app/(app)/knowledge/records/RecordsClient.tsx`
- **Fix steps:**
  1. Create a shared helper (e.g. knowledge/_data/recordDue.ts) exporting isReviewDue(rec,today) and isWeedingDue(rec,today) based on status==='active' and disposalDueDate.
  2. Use it for both KPIs in page.tsx and pass a precomputed dueKind (none|review|weeding) on each RecordRow.
  3. Make RecordsClient 'Due' segment filter on dueKind !== 'none'.
  4. Rename KPIs to 'Due for review (30d)' and 'Overdue for weeding' with subtitles.
- **Acceptance:**
  - Unit test isReviewDue/isWeedingDue with boundary dates.
  - KPI number equals row count of the corresponding segment.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; GFR retention semantics need a business owner to confirm the definitions (decision).
- **Depends on:** GAP-KNOWLEDGE-RECORDS-01, GAP-KNOWLEDGE-RECORDS-07

### GAP-KNOWLEDGE-RECORDS-03  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE (was OTHER)

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main (Policy button -> /knowledge/policies, no ignored query params). Test: apps/web/src/app/(app)/knowledge/records/page.test.tsx 'GAP-RECORDS-03: Policy header button links to /knowledge/policies'.
- **First-pass claim:** Header "Policy" button links to /knowledge/records?filter=policy (page.tsx:72); the page and RecordsClient never read searchParams, so it reloads the same view.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx:72 Link href '/knowledge/records?filter=policy'; KnowledgeRecordsPage takes no searchParams (page.tsx:8) and RecordsClient has no useSearchParams. The link reloads the same view. A policy list exists at /knowledge/policies.
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`
- **Fix steps:**
  1. Point the Policy button to /knowledge/policies (existing route) or remove it.
  2. If a records-specific policy filter is really wanted, read searchParams.filter in page.tsx and pass initial segment to RecordsClient.
- **Acceptance:**
  - Clicking Policy navigates to the policies page (or button removed).
  - No link on the page targets a query param the page ignores.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-RECORDS-04  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [ ] **Status** (W2 knowledge INTERIM - needs owner decision: disposal is GFR-governed and irreversible; there is no dispose/weed command or approval workflow in knowledge-service and none was invented. The page stays a read-only schedule.)
- **First-pass claim:** Disposal is irreversible and GFR-governed, yet the page has no weed/dispose/transfer action, approval or certificate step — it is a read-only list; "+ Schedule" creates a categorised document, not a record (documents/new/page.tsx:22-24).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx is a read-only list with no dispose/weed/transfer control (confirmed). '+ Schedule' (page.tsx:73) goes to documents/new?category=Retention Schedule, and documents/new/page.tsx:22-24 states openly that records are projected from documents and there is no records-schedule command. The knowledge service is not in the snapshot, so whether a dispose command exists is cannot-verify; the gap is a missing feature and not a defect of existing code.
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`, `apps/web/src/app/(app)/knowledge/records/RecordsClient.tsx`, `(new) apps/web/src/app/(app)/knowledge/records/DisposeDialog.tsx`
- **Fix steps:**
  1. Decision first: confirm with product whether disposal is done in this system and the knowledge-service command/endpoint.
  2. If yes, add a row action opening the shared ConfirmDialog with mandatory reason and certificate reference.
  3. Server must enforce maker!=checker and emit an audit event; web only calls the endpoint.
  4. Restrict the action to records with status active and past disposalDueDate.
- **Acceptance:**
  - Dispose action is unavailable to non-authorised roles.
  - Submitting without a reason is blocked.
  - Audit event visible after disposal.
- **Needs:** decision  ·  **Effort:** L >2d  ·  **Risk:** High: irreversible GFR-governed destruction; needs approval workflow and audit.

### GAP-KNOWLEDGE-RECORDS-06  ·  LOW  ·  partly  ·  theme WIRING

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main (recordStatusLabel/Pill cover archived+inactive; RecordRow has a Disposal due column). Tests: apps/web/src/app/(app)/knowledge/records/page.test.tsx 'Given archived and inactive records, then each row shows a labelled pill; disposal-due is formatted or a dash' and apps/web/src/app/(app)/knowledge/_data/statusLabels.test.ts recordStatusLabel/recordStatusPill cases.
- **First-pass claim:** Status "archived" prints the raw lowercase value; "inactive" is labelled but no pill maps it (page.tsx:24-38). disposalDueDate is never shown as a column.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx:24-38: archived does have a pill ('archived', :28) but recordStatusLabel (:32-38) has no archived case, so raw 'archived' prints lowercase. 'inactive' has a label but recordStatusPill returns 'mut' (:29), so pill mapping is missing. disposalDueDate is fetched (used :18-19) but RecordRow (:40-50) and DataTable columns omit it (RecordsClient.tsx:139-150).
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`, `apps/web/src/app/(app)/knowledge/records/RecordsClient.tsx`
- **Fix steps:**
  1. Add 'archived' -> 'Archived' and a default title-case fallback in recordStatusLabel.
  2. Map 'inactive' to a pill in recordStatusPill.
  3. Add disposalDueDate to RecordRow and a 'Disposal due' column using formatIndianDate from @/lib/formatters.
- **Acceptance:**
  - Rows for archived/inactive show labelled pills.
  - Disposal due column shows dd/mm/yyyy or dash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-RECORDS-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: IST calendar-date cutoff; test apps/web/src/app/(app)/knowledge/_data/recordDue.test.ts 'at 20:00 UTC (01:30 IST next day) advances the date'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** 30-day window uses the server clock in server-local time (page.tsx:12-14), so the "Due Review" count can differ by a day from what IST users expect.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/records/page.tsx:12-14 uses new Date() and setDate on the server (server TZ, default UTC) and compares to new Date(r.disposalDueDate) at :19; a date-only value parses as UTC midnight. Page is a server component with revalidate 120s in the loader, so boundaries shift by up to a day for IST users. Impact is small.
- **Files to change:** `apps/web/src/app/(app)/knowledge/records/page.tsx`
- **Fix steps:**
  1. Compute the cutoff as an IST calendar date (Intl with timeZone 'Asia/Kolkata') in the shared isReviewDue helper.
  2. Compare date strings (YYYY-MM-DD) rather than Date instances.
- **Acceptance:**
  - Test: with system TZ UTC and clock 20:00 UTC on day D, a record due D+31 IST is counted correctly at the boundary.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-KNOWLEDGE-RECORDS-02


---
## /knowledge/repository  —  `knowledge/repository.html`

- **Source:** `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Design reference:** `redesign/knowledge/repository.html`

### GAP-KNOWLEDGE-REPOSITORY-01  ·  HIGH  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Stat cards are wrong by construction: "Circulars" and "Published" both = approved count, "Notifications" = under_review count (page.tsx:69-71). Circulars are not counted by category, and pending-review documents are reported as notifications.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/page.tsx:69-71: Circulars and Published both use approved; Notifications uses under_review. The category segment (RepositoryClient.tsx:17,24) uses category text, so cards disagree with the segments.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Fix steps:**
  1. Compute Circulars/Policies/Notifications counts with the same category-matching function used by RepositoryClient (extract to a shared helper).
  2. Keep Published = approved; change the Notifications card to category-based, and add an 'Under review' card if needed.
  3. Better: derive counts from the same normalised docType field (see REPOSITORY-07).
- **Acceptance:**
  - Card counts equal rows shown after selecting the matching segment.
  - Published != Circulars in a dataset with approved policies.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only.
- **Depends on:** GAP-KNOWLEDGE-REPOSITORY-07

### GAP-KNOWLEDGE-REPOSITORY-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** ALREADY-FIXED on main (errored gate in repository/page.tsx). Tests: apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-REPOSITORY-02: error state shows RefreshErrorState' and 'on a failed load the stat cards show dashes and no zero counts'.
- **First-pass claim:** Failed fetch reads as an empty repository: only DataSourceBadge is added (page.tsx:55); stats stay 0 and RepositoryClient shows "No documents found in the repository." (RepositoryClient.tsx:36). Dashboard and list gate this (RefreshErrorState); repository does not.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/page.tsx:9 destructures source; :55 only shows DataSourceBadge when error; stats (:68-71) render 0 from empty array; RepositoryClient.tsx:35-36 shows 'No documents found in the repository.' The loader returns empty data with source 'error' (apiClient.ts:119-172). records and list pages already gate on errored with RefreshErrorState.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/page.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`
- **Fix steps:**
  1. Set errored = source==='error' as in knowledge/list/page.tsx.
  2. Render StatCard values as '—' when errored.
  3. Render <RefreshErrorState error={toHumanError('load',{area:'documents'})}/> in place of RepositoryClient when errored.
  4. Only show the empty state when source is 'api' and docs.length===0.
- **Acceptance:**
  - Mock loader error: page shows retry state, dashes in cards, no 'No documents' text.
  - Empty success case still shows the empty state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-KNOWLEDGE-REPOSITORY-03  ·  HIGH  ·  confirmed  ·  theme WIRING

- [x] **Status** (W2 knowledge re-confirmed in #2059: archived hidden, footnote count equals hidden rows; tests apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-REPOSITORY-03' (x2); was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Footnote says archived documents are "not shown" (page.tsx:79-83) but rows = docs.map(...) includes archived documents (page.tsx:42) — the message is false.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/page.tsx:42 rows = docs.map(...) with no status filter (archived included, labelled 'Archived' at :19), while :79-83 says '{archived} archived documents not shown'. The message is false.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Fix steps:**
  1. Decide: hide archived by default (filter docs before map) or show them.
  2. If hiding, add an 'Include archived' toggle and keep the footnote accurate; else delete the footnote block (:79-83).
  3. Keep Documents card total consistent with the choice.
- **Acceptance:**
  - Footnote text matches table content.
  - Archived count equals rows hidden.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-REPOSITORY-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER (was I18N)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** under_review is labelled "Draft" here (page.tsx:18) but "Under review" on list, dashboard and search; real drafts (status "draft") show the raw string.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/page.tsx:18 maps under_review to 'Draft' whereas knowledge/list/page.tsx:19 and search/SearchClient.tsx:48 use 'Under review'/'Draft' distinctly; :16-21 has no 'draft' case, so a real draft prints raw 'draft' (pill is 'draft' at :26). Dashboard label not re-checked.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/page.tsx`, `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`, `apps/web/src/app/(app)/knowledge/list/page.tsx`, `(new) apps/web/src/app/(app)/knowledge/_data/statusLabels.ts`
- **Fix steps:**
  1. Create a shared knowledgeDocStatusLabel/knowledgeDocStatusPill in knowledge/_data.
  2. Map approved->Published, under_review->Under review, draft->Draft, archived->Archived, with a title-case fallback.
  3. Replace the three local copies (repository, list, search).
- **Acceptance:**
  - Unit test each status maps identically across pages.
  - under_review never renders as 'Draft'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-KNOWLEDGE-REPOSITORY-05  ·  MEDIUM  ·  partly  ·  theme DEADROUTE

- [x] **Status** (W2 knowledge re-confirmed in #2059: residual: row links pointed at /knowledge/policies/<id> and Import was a dead param - rows now open /knowledge/documents/<id> and Import is removed in this PR; tests apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'GAP-LIST-01 ...' and 'GAP-NEW-02/LIST-04/NEW-04 ...'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Import navigates to ?mode=import, ignored by the target form (ImportButton.tsx:11); rows have no link to a document detail (none exists).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/ImportButton.tsx:11 navigates to /knowledge/documents/new?mode=import; documents/new/page.tsx:4-5 reads only searchParams.category, so mode is ignored (confirmed). Rows have no link (RepositoryClient.tsx DataTable has no rowHref although DataTable supports a row link builder). A governed detail route does exist at knowledge/policies/[id] but it uses getKnowledgePolicy; whether it serves every category is cannot-verify without the service.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/ImportButton.tsx`, `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`, `apps/web/src/app/(app)/knowledge/documents/new/page.tsx`
- **Fix steps:**
  1. Either implement mode=import in documents/new (file-upload variant of CreateDocumentForm) or remove the Import button.
  2. Use next/link instead of window.location.href.
  3. Pass a rowHref to DataTable pointing to /knowledge/policies/{fullId} once confirmed it accepts all documents; include the full id in the row (currently sliced to 8 chars at page.tsx:43).
- **Acceptance:**
  - Import opens a form that differs from Publish, or the button is gone.
  - Clicking a row opens its detail.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-KNOWLEDGE-REPOSITORY-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: segment filter uses canonical stems; tests apps/web/src/app/(app)/knowledge/_data/statusLabels.test.ts categorySegment (x7) and apps/web/src/app/(app)/knowledge/repository/page.test.tsx 'choosing the Circulars segment keeps Circular documents and drops the others'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Segments filter by substring of a free-text category; "Notifications" matches only categories containing that word (RepositoryClient.tsx:24).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx:24 filters by rawCategory.toLowerCase().includes('circulars'|'policies'|'notifications'); a category 'Circular' (singular) does not match 'Circulars'. Category is a free string from the API type.
- **Files to change:** `apps/web/src/app/(app)/knowledge/repository/RepositoryClient.tsx`, `apps/web/src/app/(app)/knowledge/repository/page.tsx`
- **Fix steps:**
  1. Match on stems ('circular','polic','notif') in a shared docType helper, or better use a controlled category value if the API provides one.
  2. Use the helper for both segments and stat cards.
- **Acceptance:**
  - Category 'Circular' appears under Circulars segment.
  - Segment counts sum consistently with All (plus 'Other').
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-KNOWLEDGE-REPOSITORY-01


---
## /knowledge/search  —  `knowledge/search.html`

- **Source:** `apps/web/src/app/(app)/knowledge/search/page.tsx`
- **Design reference:** `redesign/knowledge/search.html`

### GAP-KNOWLEDGE-SEARCH-01  ·  HIGH  ·  partly  ·  theme CAP

- [x] **Status** (W2 knowledge re-confirmed in #2059: subtitle/placeholder honest; test apps/web/src/app/(app)/knowledge/search/page.test.tsx 'GAP-SEARCH-01: subtitle does not claim full-text or all modules'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** Search is a client-side substring score over whatever documents the list loader returned (SearchClient.tsx:28-37,66-74) yet is titled "Full-text + metadata search across all documents & modules". There is no full-text index, no other module and no server call; large repositories are capped by the list endpoint.
- **Verified evidence:** apps/web/src/app/(app)/knowledge/search/SearchClient.tsx:28-37 scores by substring on title, category, author, fileType and tags; :66-74 filters initialDocs client-side; search/page.tsx:5 loads getKnowledgeDocs (/api/v1/knowledge/documents). Subtitle at :124 claims full-text across all documents and modules and placeholder :178 mentions files and records. True: no full-text, no other modules. The list endpoint cap cannot be verified (knowledge service absent from snapshot).
- **Files to change:** `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`, `apps/web/src/app/(app)/knowledge/search/page.tsx`
- **Fix steps:**
  1. Short term: change subtitle/placeholder to 'Search document titles, categories, authors and tags'.
  2. Long term: add a server search endpoint (CLAUDE.md names Meilisearch) and call it via a loader taking q; make page.tsx read searchParams.q.
  3. Show total count and truncation notice if the list is capped.
- **Acceptance:**
  - Copy no longer claims full-text/all modules.
  - With >N documents a match beyond the fetched page is still found (after backend work).
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Medium: current copy misleads users into thinking absence of a hit means absence of a document.
- **Depends on:** GAP-KNOWLEDGE-SEARCH-04

### GAP-KNOWLEDGE-SEARCH-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W2 knowledge re-confirmed in #2059: error shows retry state; test apps/web/src/app/(app)/knowledge/search/page.test.tsx 'GAP-SEARCH-02: failed fetch shows retry state, not No documents found'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** A failed documents fetch is invisible: page.tsx:6 drops source, so the user sees "No documents found" for every query (SearchClient.tsx:213-219).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/search/page.tsx:5 destructures only data, dropping source; on failure the loader returns [] so SearchClient.tsx:213-219 renders 'No documents found'. No error indicator at all (not even DataSourceBadge).
- **Files to change:** `apps/web/src/app/(app)/knowledge/search/page.tsx`, `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`
- **Fix steps:**
  1. Read source in page.tsx and if 'error' render <RefreshErrorState error={toHumanError('load',{area:'documents'})}/> instead of the client.
  2. Or pass an errored prop and disable the input with an error banner.
- **Acceptance:**
  - Loader error shows retry state, not 'No documents found'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** RefreshErrorState

### GAP-KNOWLEDGE-SEARCH-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 knowledge re-confirmed in #2059: column is Status, segment filters rows; test apps/web/src/app/(app)/knowledge/search/SearchClient.test.tsx 'SEARCH-03: selecting Files keeps only documents with a fileType; the column header is Status'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** "Source module" column renders the document status pill (SearchClient.tsx:90-92); the All/Documents/Files segment keeps state in resultSeg but never filters rows (SearchClient.tsx:61,225-229).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/search/SearchClient.tsx:90-92 the 'Source module' column renders StatusPill of doc.status; :61 resultSeg set by Segmented (:225-229) but resultRows is never filtered by it (matchedDocs at :66-74 ignores resultSeg). Files segment has no basis since fileType is not used to classify.
- **Files to change:** `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`
- **Fix steps:**
  1. Rename column to 'Status' (or show 'Knowledge' as source module).
  2. Either filter resultRows by resultSeg (Documents vs Files via fileType presence) or remove the Segmented control.
- **Acceptance:**
  - Selecting Files reduces rows to docs with fileType.
  - Column header matches its content.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-KNOWLEDGE-SEARCH-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** q param already read on main; result links pointed at /knowledge/policies/<id> (wrong route for non-policy documents) - now /knowledge/documents/<id>. Tests: apps/web/src/app/(app)/knowledge/search/SearchClient.test.tsx 'Given a matching result, then its title links to the document detail route', 'Given a q param, results are shown immediately'; apps/web/src/app/(app)/knowledge/search/page.test.tsx 'GAP-SEARCH-04'.
- **First-pass claim:** Result rows have no link to open a document; dashboard chips pass ?q= but the page never reads it (dashboard/page.tsx:178, search/page.tsx:4-6).
- **Verified evidence:** SearchClient.tsx:83-92 result titleNode is plain text, DataTable given no row link; dashboard/page.tsx:174-178 chips link to /knowledge/search?q=..., but search/page.tsx:4-6 takes no searchParams and SearchClient starts with query '' and submitted false (:56-57).
- **Files to change:** `apps/web/src/app/(app)/knowledge/search/page.tsx`, `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`
- **Fix steps:**
  1. Accept searchParams.q in page.tsx and pass initialQuery to KnowledgeSearchClient; initialise query state and submitted=true when non-empty.
  2. Link title to the document detail route (policies/[id] if it serves documents; else decision).
  3. Use rowHref on DataTable.
- **Acceptance:**
  - Opening /knowledge/search?q=travel%20policy shows results immediately.
  - Clicking a result opens detail.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-KNOWLEDGE-REPOSITORY-05

### GAP-KNOWLEDGE-SEARCH-05  ·  MEDIUM  ·  confirmed  ·  theme WIRING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1916, verified on main 3c4fb6e5f)
- **First-pass claim:** Ranking ignores archived/superseded documents: an archived, superseded policy scores the same as the live one (SearchClient.tsx:28-37).
- **Verified evidence:** apps/web/src/app/(app)/knowledge/search/SearchClient.tsx:28-37 relevanceScore never inspects doc.status; sort at :72 is by score only, so archived and live get equal rank. The Doc type has no supersededBy field, so 'superseded' cannot be detected on the client (cannot-verify whether API supplies it).
- **Files to change:** `apps/web/src/app/(app)/knowledge/search/SearchClient.tsx`
- **Fix steps:**
  1. Exclude or down-weight status 'archived' (e.g. score*0.3, or hide unless Status filter chosen).
  2. Add a badge for archived rows.
  3. If API provides a superseded flag, extend the Doc type and zod schema, then penalise.
- **Acceptance:**
  - Archived doc with same title ranks below approved one.
  - Filtering Status=archived still shows it.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-KNOWLEDGE-HOME-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Every /v1/knowledge/* route authenticates (401), role-gates (403) and tenant-scopes (RLS GUC + tenant_id). Tests: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts (401/403 on documents, records, policies, faqs, guided-flows; tenant B never sees tenant A rows) and services/knowledge-service/tests/routes.test.ts.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/* (hub links only)']`
- **Question:** The knowledge hub's downstream list endpoints must each authenticate, tenant-scope and be reachable by the roles the hub shows links to.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/* (hub links only); curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/* (hub links only) then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-ASSISTANT-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 knowledge REOPENED in #2059 by PROVISIONAL re-check - needs owner decision: PII redaction before persistence is real and tested (gap-knowledge-faqs02-assistant06.test.ts), but there is no retention window/expiresAt column or purge job on assistant_interactions and no per-interaction audit event. Retention period needs an owner decision, then a migration + purge job. Was: W0 PROVISIONAL closed by #1916.)
- **First-pass claim:** Free-text questions are stored as assistant interactions (metrics.total); DPDP retention/masking of personal data typed into the question is undeterminable. Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/knowledge/assistant/ask', 'POST /v1/knowledge/assistant/escalate', 'GET /v1/knowledge/assistant/metrics']`
- **Question:** The assistant ask/escalate handlers must apply a retention limit and PII masking (Aadhaar, PAN, phone, email) to stored question text, and log an audit event per interaction.
- **How to verify:** Open the assistant ask handler and interaction schema in knowledge-service; POST a question containing an Aadhaar-like number and query the interactions table/log: expect masked text and a purge/retention job or TTL.
- **Test to add:** Given question 'my Aadhaar 1234 5678 9012', when POST ask then stored interaction text has the number masked and the interaction has expiresAt within the retention window; audit event emitted.
- **Impact if wrong:** DPDP non-compliance: personal data retained indefinitely in free-text logs.
- **Web change if wrong:** Add a hint under the question box not to enter personal identifiers, if masking is not done server-side.

### GAP-KNOWLEDGE-DASHBOARD-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** GET documents is authenticated, tenant scoped, paginated; summary endpoint gives complete counts and excludes uncleared levels. Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'summary counts exclude uncleared documents' + 'paginates'; services/knowledge-service/tests/gap2-knowledge-dashboard-metrics.test.ts.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/documents']`
- **Question:** GET /v1/knowledge/documents must require an authenticated role, tenant-scope, return category/status/createdAt per row and paginate so dashboard counts are complete.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-DOCUMENTS-NEW-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 knowledge REOPENED in #2059 by PROVISIONAL re-check - needs owner decision: title length (200) + trim and the document.created audit event are covered by tests, but duplicate-title handling is NOT implemented (acceptance: same title twice -> 409 DUPLICATE_TITLE or a new version). Choosing 409 vs versioning (and a unique index on lower(title) per tenant) is a product call. Was: W0 PROVISIONAL closed by #1916.)
- **First-pass claim:** Audit event on document creation, title length limit and duplicate-title handling are undeterminable. Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['POST /api/proxy/v1/knowledge/documents']`
- **Question:** POST /v1/knowledge/documents must zod-validate title (max length, trim), reject or version duplicate titles per tenant, restrict to a publisher role and emit a document.created audit event.
- **How to verify:** Open the create handler and validator in knowledge-service; POST title of 10,000 chars (expect 400), same title twice (expect 409 or version), as a plain employee (expect 403 if restricted), and check the emitted audit event.
- **Test to add:** Given an existing document 'Leave Policy', when POST the same title then 409 DUPLICATE_TITLE (or new version); title >256 chars gives 400; success emits one audit event with actor and documentId.
- **Impact if wrong:** Untracked or duplicated official documents; no audit trail.
- **Web change if wrong:** Surface 409/400 field errors in CreateDocumentForm (formError.fromResponse already used).

### GAP-KNOWLEDGE-FAQS-02  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge re-confirmed in #2059: non-editors get published only on list; residual: by-id read leaked drafts - fixed in this PR; tests services/knowledge-service/tests/gap-knowledge-faqs02-assistant06.test.ts and services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'draft by id is 404'; was W0 PROVISIONAL: closed by #1916)
- **First-pass claim:** status is loaded for FAQs and flows (loaders.ts:108,130) but the page never filters on it (page.tsx:40,59); draft/retired entries would be shown to every viewer unless the API filters — undeterminable.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/faqs', 'GET /api/v1/knowledge/guided-flows']`
- **Question:** GET faqs and guided-flows must return only status=published items to non-editor roles (drafts/retired only for knowledge editors).
- **How to verify:** Open the faqs and guided-flows list handlers; seed one draft and one retired FAQ; curl as employee and expect only published; as knowledge editor expect all.
- **Test to add:** Given FAQ statuses draft/published/retired, when an employee GETs /v1/knowledge/faqs then only the published one is returned.
- **Impact if wrong:** Unapproved or retired guidance shown to every staff member.
- **Web change if wrong:** Add .filter(status==='published') in faqs/page.tsx:40,59 for non-editors.

### GAP-KNOWLEDGE-FAQS-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** GET faqs/guided-flows: 401 without token, 403 foreign role, tenant scoped, published-only for non-editors; by-id read now applies the same status rule. Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'lists are authenticated, tenant scoped and published-only for knowledge_user; draft by id is 404'.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/faqs', 'GET /api/v1/knowledge/guided-flows']`
- **Question:** GET faqs and guided-flows must require authentication, tenant-scope and return the fields the web maps (id, question, answer, status, category).
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/faqs; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/faqs then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-LIST-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Verified in services/knowledge-service/src/modules/documents/routes.ts: GET /v1/knowledge/documents authenticates (401), role-gated (403), tenant scoped (RLS + tenant_id), paginated (limit/offset) and now filters by accessLevel clearance in the query (clearance.ts). Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'Given restricted/confidential docs ... knowledge_user lists next', 'never returns another tenant rows', 'paginates', '401 without a token and 403 for a foreign role'.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/documents']`
- **Question:** GET /v1/knowledge/documents must authenticate, tenant-scope, paginate and return status/category/accessLevel per row.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-POLICIES-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Fixed in services/knowledge-service/src/modules/policies/{repo,queries,routes}.ts: draft/under_review/approved are returned only to approver roles and the document's own author/reviewer; others get published/superseded; review-due is tenant scoped, published only. Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'a draft is hidden from other knowledge_users ...', 'GET by id: a draft is 404 ...', 'policies are tenant scoped and need a token'.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/policies', 'GET /api/v1/knowledge/policies/review-due']`
- **Question:** GET policies must return draft/under_review items only to editors and published to others; review-due must be tenant-scoped and computed server-side.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/policies; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/policies then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-POLICIES-DETAIL-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Role per transition verified (approve/reject/publish/supersede/withdraw = approver roles; maker-checker 403; invalid state 409) and acknowledgement now binds to the caller (employeeId must equal the actor, 403 otherwise) and is an idempotent no-op on repeat (no duplicate event/audit). Tests: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'transitions are role gated ...', 'an acknowledgement cannot be forged for another employee (403) and acknowledging twice yields one ack'; services/knowledge-service/tests/policies-lifecycle.test.ts 'maker-checker: author cannot approve their own document (403)'.
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/policies/{id}', 'GET /api/v1/knowledge/policies/{id}/acknowledgements', 'POST /v1/knowledge/policies/{id}/submit|approve|publish|acknowledge']`
- **Question:** Policy transition endpoints must enforce role per transition (submit: author, approve: approver != author, publish: publisher), reject invalid state transitions with 409, emit audit events, and acknowledge must bind to the caller's own employee id.
- **How to verify:** In knowledge-service open the policy routes; POST approve as the author (expect 403), publish on a draft (expect 409), acknowledge as an employee twice (expect idempotent) and check the acknowledgements list contains only the caller's id.
- **Test to add:** Given draft policy P by user U, when U POSTs approve then 403; when approver POSTs approve on draft then 409; acknowledge by E twice yields one ack.
- **Impact if wrong:** Policies published without approval or acknowledgements forged for others.
- **Web change if wrong:** Hide actions by role in PolicyActions.tsx and map 403/409 to plain messages.

### GAP-KNOWLEDGE-RECORDS-05  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/records']`
- **Question:** GET /v1/knowledge/records must authenticate, tenant-scope, restrict by record classification/retention and return expiry/retention dates the page uses for its 30-day window.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/records; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/records then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-REPOSITORY-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Service now applies accessLevel clearance on list/search/detail/records/summary (documents/clearance.ts, repo.ts). Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts (list, search, detail, summary, records cases; mutation-checked).
- **First-pass claim:** Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/documents']`
- **Question:** GET /v1/knowledge/documents must apply accessLevel filtering for the caller and paginate, since the repository page lists everything returned.
- **How to verify:** In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
- **Test to add:** Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
- **Impact if wrong:** Unauthorised or wrong knowledge content shown to staff.
- **Web change if wrong:** none

### GAP-KNOWLEDGE-SEARCH-06  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 knowledge: closed by #2059)
- **W2 evidence:** Restricted/confidential documents are absent from the list, search (POST /search) and by-id (404) for a non-admin, in the SQL WHERE (not hidden by the UI). Test: services/knowledge-service/tests/w2-knowledge-clearance-visibility.test.ts 'search (POST /search) omits restricted docs ...' and 'detail by id: 404 for an uncleared user'. The same clearance now also applies to GET /v1/knowledge/search (engine query + clearance-joined DB fallback), /documents/:id/versions* (list/get/create/restore: 404 for an uncleared document) and POST /ai/search and /ai/summarize (filtered in the retrieval query). Test: services/knowledge-service/tests/w2-knowledge-readpaths-clearance.test.ts; packages/search/tests/search.test.ts.
- **First-pass claim:** Whether restricted documents (accessLevel) are already filtered out for the caller is undeterminable. Backend knowledge-service is not in the snapshot (services/ holds only hrms-service): endpoints, roles, audit and payload validation for /v1/knowledge/* are undeterminable; shapes below come from the page/loader code only.
- **Service:** `knowledge-service`  ·  **Endpoint(s):** `['GET /api/v1/knowledge/documents (search filters client-side in SearchClient.tsx)']`
- **Question:** GET /v1/knowledge/documents must exclude documents whose accessLevel exceeds the caller's clearance, because search runs client-side over whatever the list returns.
- **How to verify:** Open the documents list handler in knowledge-service; seed a 'restricted' doc; curl as a low-privilege employee and assert it is absent from the response body (not merely hidden).
- **Test to add:** Given a restricted document, when an employee without clearance GETs /v1/knowledge/documents then it is absent; a knowledge admin sees it.
- **Impact if wrong:** Restricted documents leak to unauthorised staff via search results.
- **Web change if wrong:** Add a server-side search endpoint (?q=) and stop shipping the full list to the browser.
