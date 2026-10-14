# Detailed gap file — module `workflow`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 39, BACKEND-VERIFY 5



---
## /workflow  —  `workflow/home.html`

- **Source:** `apps/web/src/app/(app)/workflow/page.tsx`
- **Design reference:** `redesign/workflow/home.html`

### GAP-WORKFLOW-HOME-02  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Workflow is not in the sidebar (ds/Sidebar.tsx has no /workflow entry); it is reachable only from the dashboard "My approvals" button (dashboard/page.tsx:47), RoleCommandCenter and GlobalSearch (GlobalSearch.tsx:69). The mockup nav has no matching id, so data-active is set to "designer" (nearest Citizen-services item).
- **Verified evidence:** Same as GAP-WORKFLOW-DEFINITIONS-05: Sidebar.tsx has no /workflow item; entry points dashboard/page.tsx:47, RoleCommandCenter.tsx:110, GlobalSearch.tsx:69. Mockup data-active claim is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. In Sidebar.tsx NAV, add an item { icon: Workflow (lucide), label: 'Workflow & Approvals', href: '/workflow', moduleKey: 'workflow' } to the operations/citizen group; workflow/layout.tsx already gates on ModuleGate moduleKey='workflow' so the key matches.
  2. Confirm isActive(href) highlights the entry for /workflow/definitions, /workflow/list, /workflow/designer and /workflow/my-tasks (prefix match).
  3. Keep dashboard 'My approvals' button and GlobalSearch link unchanged.
  4. For the HTML mockups in civitas-redesign, add a nav id for Workflow instead of mapping data-active to 'designer'.
- **Acceptance:**
  - Component test: Sidebar renders a Workflow link when the tenant has module 'workflow' enabled and hides it when disabled.
  - Manual: open /workflow/definitions - the Workflow item is shown as active.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; a nav entry could appear for roles who lack workflow permission - reuse rolesAllowed if the module has a role model.
- **Depends on:** GAP-WORKFLOW-DEFINITIONS-05

### GAP-WORKFLOW-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme DATAINTEGRITY (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "In progress" here counts active+pending+running (page.tsx:13-17) but the Instances page "Active" counts active+running only (list/page.tsx:14-19) — the same population is two different numbers a click apart.
- **Verified evidence:** workflow/page.tsx:13-16 'In progress' = active+pending+running; list/page.tsx:14-16 'Active' = active+running (pending omitted). Both from getAnalyticsSummary instancesByStatus.
- **Files to change:** `apps/web/src/app/(app)/workflow/page.tsx`, `apps/web/src/app/(app)/workflow/list/page.tsx`, `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`
- **Fix steps:**
  1. Add helper inProgressCount(instancesByStatus) in workflowTypes.ts (active+pending+running).
  2. Use it on both pages and label both 'In progress'.
  3. Add a unit test for the helper.
- **Acceptance:**
  - Unit test: {active:2,pending:3,running:1} gives 6 on both pages.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm 'pending' is an instance status with product owner.

### GAP-WORKFLOW-HOME-05  ·  LOW  ·  partly  ·  theme STYLE (was FABRICATED)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** loading.tsx and the cards use Tailwind slate utilities and emoji icons (loading.tsx:1-22; page.tsx:34-44) instead of DS tokens, so dark mode shows light placeholders; tiles give 4 items in a "three" column grid (page.tsx:87).
- **Verified evidence:** Confirmed: workflow/loading.tsx uses slate-200 utilities (4 stats, 2 cards, 3 tiles); page.tsx:34-44 uses emoji icons in StatCard (a pattern used app-wide, so not specific to this route); LinkTiles columns='three' (page.tsx:87) with 4 tiles (:89-92) renders g-3 => 3+1 orphan. Dark-mode effect of slate-200 is cannot-verify (no tailwind config in snapshot). Not a 'fabricated data' issue.
- **Files to change:** `apps/web/src/app/(app)/workflow/loading.tsx`, `apps/web/src/app/(app)/workflow/page.tsx`
- **Fix steps:**
  1. Use columns='four' for the 4 tiles (page.tsx:87).
  2. Replace slate skeleton blocks with ds Skeleton or token background (var(--line2)).
  3. Leave emoji icons unless a DS icon set decision is made.
- **Acceptance:**
  - Manual: hub shows 4 tiles in one row on desktop, 2x2 on tablet.
  - Loading skeleton visible in dark mode.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /workflow/definitions  —  `workflow/definitions.html`

- **Source:** `apps/web/src/app/(app)/workflow/definitions/page.tsx`
- **Design reference:** `redesign/workflow/definitions.html`

### GAP-WORKFLOW-DEFINITIONS-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Dead-end authoring: the page tells users to "Clone a template … then customise the approval steps" (definitions/page.tsx:99-116) and the empty state says "Start from a template below", but there is no Clone, New or Open-in-designer control anywhere on the page; template rows are not links (no rowLinkKey) — the promised workflow cannot be started here.
- **Verified evidence:** definitions/page.tsx:98-115: Templates card text says 'Clone a template ...' (:101-103) and empty state (:77) says 'Start from a template below', but the templates DataTable (:104-112) has no rowLinkKey/rowHref/actions; nothing on the page links to /workflow/designer or any clone action. The definitions table does link rows (:88-89).
- **Files to change:** `apps/web/src/app/(app)/workflow/definitions/page.tsx`, `apps/web/src/app/_components/ds/DataTable.tsx`
- **Fix steps:**
  1. Add a 'Use template' action per template row (DataTable rowActions or a render column) that POSTs a clone and redirects to /workflow/designer?definitionId=new - needs backend clone endpoint (not visible in snapshot).
  2. Add a page-level 'New workflow' button linking to /workflow/designer.
  3. Until clone exists, reword copy to remove the promise.
- **Acceptance:**
  - Manual: each template row has a working Use template action that opens an editable copy.
  - Component test: New workflow button href is /workflow/designer.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Cloning creates tenant data; needs permission check and audit.
- **Depends on:** GAP-WORKFLOW-DESIGNER-01

### GAP-WORKFLOW-DEFINITIONS-03  ·  MEDIUM  ·  partly  ·  theme COPY (was STATUS)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Naming drift: route "Definitions", hub tile "Definitions — Process definitions, versions and graphs" (workflow/page.tsx:90), header "Approval Workflows"; status raw values (deployed, active, draft) shown as-is via StatusPill with no vocabulary.
- **Verified evidence:** Naming drift is real: PageHeader title 'Approval Workflows' (definitions/page.tsx:56), hub tile 'Definitions' (workflow/page.tsx:91), breadcrumb 'Definitions' (detail pages). Overstated on status: DataTable cellType 'status' (DataTable.tsx:127) renders StatusPill, which humanizes (StatusPill.tsx bug-fix note) rather than showing raw text; but 'deployed' is absent from STATUS_MAP so it falls to neutral 'info' tone while 'active' is green.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/workflow/definitions/page.tsx`, `apps/web/src/app/(app)/workflow/page.tsx`
- **Fix steps:**
  1. Pick one name (e.g. 'Approval workflows') and use it in the hub tile, header, breadcrumb and detail pages.
  2. Add deployed: 'good' (and published/archived as needed) to STATUS_MAP after checking the workflow status enum from the API types.
  3. Add a status legend or HelpTip only if statuses stay >3.
- **Acceptance:**
  - Unit test: StatusPill status 'deployed' gets variant 'good'.
  - Manual: same term used in hub tile, header and breadcrumb.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Shared StatusPill change affects all modules; only add unambiguous keys.

### GAP-WORKFLOW-DEFINITIONS-04  ·  MEDIUM  ·  partly  ·  theme NAVUX

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — local Breadcrumbs removed from most pages but workflow/my-tasks/page.tsx still imports it and workflow/_components/Breadcrumbs.tsx still exists
- **First-pass claim:** No Breadcrumbs component here, unlike the sibling Instances/My-tasks/detail pages that render Breadcrumbs (list/page.tsx:24); the page also wraps in page-main with a different container (definitions/page.tsx:54).
- **Verified evidence:** True that definitions/page.tsx renders no local <Breadcrumbs> while list/detail pages do. But AppShell.tsx:30 renders a global <AutoBreadcrumb/> in the TopBar for every route and workflow/ is in LINKABLE_INTERMEDIATE_PATHS (navRouteManifest.ts:128); tenant-admin/users/page.tsx:18-22 documents removing page-local crumbs as redundant. So the sibling pages are the outliers (duplicate crumbs). 'page-main' is used in ~719 files and has no rule in civitas-ds.css, so the 'different container' claim is not a real difference.
- **Files to change:** `apps/web/src/app/(app)/workflow/list/page.tsx`, `apps/web/src/app/(app)/workflow/definitions/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/instances/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/_components/Breadcrumbs.tsx`
- **Fix steps:**
  1. Remove the local <Breadcrumbs> from workflow list/detail/instance pages (rely on AutoBreadcrumb + PageHeader back).
  2. Delete workflow/_components/Breadcrumbs.tsx if no users remain.
  3. Do not add breadcrumbs to definitions/page.tsx.
- **Acceptance:**
  - Manual: each workflow page shows exactly one breadcrumb trail (top bar).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKFLOW-DEFINITIONS-05  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Workflow is not in the sidebar (ds/Sidebar.tsx has no /workflow entry); it is reachable only from the dashboard "My approvals" button (dashboard/page.tsx:47), RoleCommandCenter and GlobalSearch (GlobalSearch.tsx:69). The mockup nav has no matching id, so data-active is set to "designer" (nearest Citizen-services item).
- **Verified evidence:** Confirmed: ds/Sidebar.tsx NAV (lines 47-143) has no /workflow item; entry points are dashboard/page.tsx:47, dashboard/RoleCommandCenter.tsx:110 and GlobalSearch.tsx:69. workflow/layout.tsx already gates via ModuleGate moduleKey='workflow'. The 'mockup data-active=designer' part refers to the HTML mockups outside apps/web and is cannot-verify here.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. In Sidebar.tsx NAV, add an item { icon: Workflow (lucide), label: 'Workflow & Approvals', href: '/workflow', moduleKey: 'workflow' } to the operations/citizen group; workflow/layout.tsx already gates on ModuleGate moduleKey='workflow' so the key matches.
  2. Confirm isActive(href) highlights the entry for /workflow/definitions, /workflow/list, /workflow/designer and /workflow/my-tasks (prefix match).
  3. Keep dashboard 'My approvals' button and GlobalSearch link unchanged.
  4. For the HTML mockups in civitas-redesign, add a nav id for Workflow instead of mapping data-active to 'designer'.
- **Acceptance:**
  - Component test: Sidebar renders a Workflow link when the tenant has module 'workflow' enabled and hides it when disabled.
  - Manual: open /workflow/definitions - the Workflow item is shown as active.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; a nav entry could appear for roles who lack workflow permission - reuse rolesAllowed if the module has a role model.

### GAP-WORKFLOW-DEFINITIONS-06  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** No loading.tsx for this segment — the hub skeleton (4 stats, 2 cards, 3 tiles) flashes before a 3-stat + table page; Templates "Steps" column is left-aligned numeric.
- **Verified evidence:** Not accurate that there is no loading.tsx: workflow/definitions/loading.tsx exists (title, subtitle, 4 stat blocks in grid-cols-4, one h-80 block) using Tailwind slate-200. It mismatches the page (3 StatCards + 2 cards) and the hub loading.tsx (workflow/loading.tsx: 4 stats, 2 cards, 3 tiles) only applies to the hub. True: 'Steps' column (page.tsx:108) has no align:'right' (DataTable supports align at DataTable.tsx:43) and steps may be undefined.
- **Files to change:** `apps/web/src/app/(app)/workflow/definitions/loading.tsx`, `apps/web/src/app/(app)/workflow/definitions/page.tsx`
- **Fix steps:**
  1. Change definitions/loading.tsx to 3 stat skeletons + table card + templates card using ds Skeleton component instead of slate utilities.
  2. Add align:'right' to the Steps column and render '—' for missing values.
- **Acceptance:**
  - Manual: throttle network; skeleton has 3 stat tiles matching the page.
  - Steps column is right aligned.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /workflow/definitions/[id]  —  `workflow/definitions-detail.html`

- **Source:** `apps/web/src/app/(app)/workflow/definitions/[id]/page.tsx`
- **Design reference:** `redesign/workflow/definitions-detail.html`

### GAP-WORKFLOW-DEFINITIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only dead end: no Edit, Clone, Activate/Deactivate or "Open in Designer" action and no link to instances of this definition (definitions/[id]/page.tsx:43-54), even though a Designer exists at /workflow/designer; status can be seen but never changed from the UI.
- **Verified evidence:** definitions/[id]/page.tsx:43-53 PageHeader actions contain only StatusPill and DataSourceBadge; no link to /workflow/designer, no instances link (list/page.tsx has no definition filter), no activate/deactivate. designer/page.tsx ignores any definition id (DesignerCanvas.tsx:94 discards definitions). The service designer persists via designer/_data/workflowBuilderApi.ts:58-88 (/v1/workflow/designer/definitions) but activate/clone endpoints are not visible in this snapshot.
- **Files to change:** `apps/web/src/app/(app)/workflow/definitions/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/designer/page.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`
- **Fix steps:**
  1. Add a PageHeader action 'Open in Designer' linking to /workflow/designer?definitionId={id} (requires DESIGNER-01 load support).
  2. Add 'View instances' link to /workflow/list (add definitionId query filter to list/page.tsx when the API supports it).
  3. Add Activate/Deactivate only after backend confirms an endpoint; gate with ConfirmDialog and role check.
  4. Show read-only note when status is not draft.
- **Acceptance:**
  - Manual: definition detail shows Open in Designer and it lands on the designer with the graph loaded.
  - Component test: buttons render for a writer role, absent for viewers.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Changing definition status affects live approvals; require confirmation and audit event.
- **Depends on:** GAP-WORKFLOW-DESIGNER-01

### GAP-WORKFLOW-DEFINITIONS-DETAIL-02  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Definition not found" is unreachable: getJson turns every non-2xx (including 404) and every unmappable body into source "error" (workflowData.ts:75-78; mapper returns null), so page.tsx:10-33 always takes the "Could not load definition" copy for a bad id.
- **Verified evidence:** workflowData.ts:75-78 returns source:'error' for any !res.ok (status kept in result.status) and for mapper null; mapDefinition returns null for a non-record. page.tsx:10-23 only treats source==='error' as load failure, so the 'Definition not found' copy (source!=='error' with null def) can never occur. The result's `status` field (WorkflowResult) is available but unused.
- **Files to change:** `apps/web/src/app/(app)/workflow/definitions/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/not-found.tsx`
- **Fix steps:**
  1. In page.tsx read `status` from getDefinitionById; if status===404 call notFound() (workflow/not-found.tsx exists).
  2. Keep the 'Could not load' EmptyState (use RefreshErrorState with retry) for other errors.
  3. Treat 400/422 (bad id) as not found too.
- **Acceptance:**
  - Unit test: mocked 404 renders not-found; mocked 500 renders error state; 200 renders detail.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-DEFINITIONS-DETAIL-03

### GAP-WORKFLOW-DEFINITIONS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme INPUTVALIDATION (was UUID)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** params.id is interpolated raw into the upstream path (workflowData.ts:137-139, `/v1/workflow/definitions/${id}`) with no UUID validation or encoding; a crafted segment can address a different gateway path.
- **Verified evidence:** workflowData.ts:137-139 interpolates `/v1/workflow/definitions/${id}` unvalidated and getJson (:69-71) prepends base and forwards the user's Bearer token. Next decodes params.id, so an id such as 'x/../../v1/other' (via %2F) is normalized by fetch to a different gateway path. Impact limited to same gateway with the user's own token (read-only GET), but it is unvalidated path injection. Same pattern likely in getInstance/task getters (not checked).
- **Files to change:** `apps/web/src/app/(app)/workflow/_data/workflowData.ts`, `apps/web/src/app/(app)/workflow/definitions/[id]/page.tsx`
- **Fix steps:**
  1. Add a zod uuid (or /^[A-Za-z0-9_-]{1,64}$/) check in getDefinitionById and return {data:null,source:'error',status:404} when invalid.
  2. Use encodeURIComponent(id) in the path.
  3. Apply the same guard to every id-taking getter in workflowData.ts (instances/tasks).
- **Acceptance:**
  - Unit test: id '../x' and 'a/b' never issue a fetch and yield 404.
  - Valid uuid still fetches /v1/workflow/definitions/<uuid>.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; ensure legacy non-uuid ids (codes) are still allowed by the regex.

### GAP-WORKFLOW-DEFINITIONS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Raw internals shown to users: nodeKey codes (so_review), role codes (section_officer) and SLA as minutes (SLA 2880m) in DefinitionGraph.tsx; no human duration or role display name.
- **Verified evidence:** DefinitionGraph.tsx:143 prints n.roleRef raw, :145 prints `SLA {n.slaMinutes}m`, :150 prints n.nodeKey in mono. formatDuration exists in workflowTypes (exported via workflowData.ts:43) and is used on the hub. No role display-name lookup is used.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/DefinitionGraph.tsx`
- **Fix steps:**
  1. Use formatDuration(n.slaMinutes*60) (or a minutes variant) for SLA, e.g. '2 days'.
  2. Show titleCase(roleRef) (replace _ with space) or resolve display names via a roles lookup if one exists.
  3. Move nodeKey into a title/tooltip or 'Advanced' detail instead of the visible row.
- **Acceptance:**
  - Unit test: slaMinutes 2880 renders '2 days'; roleRef 'section_officer' renders 'Section officer'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKFLOW-DEFINITIONS-DETAIL-05  ·  LOW  ·  confirmed  ·  theme COPY (was WIRING)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** The card is titled "Process graph" but DefinitionGraph is a flat list — its docstring promises an SVG flow strip that is not rendered (DefinitionGraph.tsx:1-6); branches are visible only as "[condition]" text.
- **Verified evidence:** DefinitionGraph.tsx:1-6 docstring says 'plus an SVG flow strip when the graph is small'; the component (:100-173) only renders an ordered list with outgoing edges and [condition] text. Card title in page.tsx:63 is 'Process graph'. No dead code beyond the docstring.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/DefinitionGraph.tsx`
- **Fix steps:**
  1. Either correct the docstring and rename the card 'Steps and transitions', or add a read-only reactflow/SVG strip for nodes<=12.
  2. Render conditions as readable chips with aria-label 'when ...'.
- **Acceptance:**
  - Manual: card title matches what is rendered; docstring no longer promises SVG.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /workflow/designer  —  `workflow/designer.html`

- **Source:** `apps/web/src/app/(app)/workflow/designer/page.tsx`
- **Design reference:** `redesign/workflow/designer.html`

### GAP-WORKFLOW-DESIGNER-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was PII)

- [~] **Status** (W2 PQ: partial in #2036; Save always creates a NEW draft by design; in-place update needs a versioning decision)
- **W0-10 note:** review found the W0 tick partly — Open/Save-as-new-draft/name input exist (DesignerCanvas.tsx:137-196,514-546, page.tsx definitionId) but: no dirty flag and no beforeunload guard (fix step 4, none found under workflow/designer); Save button disabled only while saving (:544), not when validation errors exist (acceptance); always POST new draft, no update of opened definition
- **First-pass claim:** Nothing can be saved, opened or published: definitionId and definitionName are set up but never read (DesignerCanvas.tsx:102-103), the fetched `definitions` prop is discarded as `_definitions` (DesignerCanvas.tsx:94) and there is no Save/Open/Export control. Refreshing loses the model; the persistence API exists only in the separate service designer (designer/_data/workflowBuilderApi.ts:58-88).
- **Verified evidence:** DesignerCanvas.tsx:94 destructures `definitions: _definitions` and never uses it; :102-103 definitionId/definitionName are state with no setter used; the toolbar (:292-304) has only Validate and a count; no save, open, export. page.tsx:7 fetches getDesignerDefinitions but nothing renders it. Persistence exists elsewhere: designer/_data/workflowBuilderApi.ts:58-88 (loadWorkflowDesign/persistWorkflowDesign against /api/proxy/v1/workflow/designer/definitions). Not a PII issue.
- **Files to change:** `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`, `apps/web/src/app/(app)/workflow/designer/page.tsx`, `apps/web/src/app/(app)/workflow/designer/_data/designerData.ts`
- **Fix steps:**
  1. Add a definition selector ('Open') using the definitions prop and load nodes/edges into useNodesState/useEdgesState; support ?definitionId= on page.tsx.
  2. Add Save that maps nodes/edges to the designer API shape (DesignerDefinitionDetail in designerData.ts) and calls the existing designer definitions POST/PUT (reuse workflowBuilderApi persist pattern; do not invent endpoints).
  3. Add editable definitionName input, dirty flag, and success/error feedback.
  4. Add beforeunload guard while dirty.
- **Acceptance:**
  - Manual: create graph, Save, reload and Open - same graph appears.
  - Component test: Save disabled when there are validation errors; PUT/POST payload contains nodes and edges.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Overwriting a live definition changes running approvals; save as new version/draft only.

### GAP-WORKFLOW-DESIGNER-03  ·  HIGH  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Keyboard-inaccessible authoring: palette items are drag-only (BpmnPalette.tsx:7-10,24-30 — draggable buttons with onDragStart, no onClick) and connections require pointer dragging between handles; WCAG 2.1.1 fails for the route's main task.
- **Verified evidence:** BpmnPalette.tsx:23-30: buttons are draggable with onDragStart only, no onClick/onKeyDown; canvas add path is only onDrop (DesignerCanvas.tsx:125-147). Edge creation uses reactflow onConnect from handle drag with no keyboard alternative. WCAG 2.1.1 failure for authoring.
- **Files to change:** `apps/web/src/app/(app)/workflow/designer/_components/BpmnPalette.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/PropertyPanel.tsx`
- **Fix steps:**
  1. Give BpmnPalette an onAdd(type) prop; on click/Enter add a node at viewport center via reactFlowInstance.screenToFlowPosition and select it.
  2. In PropertyPanel add 'Connect to...' select listing other nodes that calls setEdges(addEdge()).
  3. Update aria-label to 'Add {label} to canvas' and instruction text.
  4. Keep drag as enhancement.
- **Acceptance:**
  - Component test: pressing Enter on a palette button adds a node.
  - Manual: full graph (start-task-end) built with keyboard only.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-WORKFLOW-DESIGNER-04  ·  MEDIUM  ·  confirmed  ·  theme DEADROUTE

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Validate" is client-only (DesignerCanvas.tsx:172-254) and covers four rules; it ignores tasks with no incoming/outgoing flow, missing assignee roles and empty gateway conditions, and the backend ValidationResult type (designerData.ts:48-56) is never called. Before any click the panel already says "No issues found" (ValidationIndicators.tsx:14-35) — false assurance.
- **Verified evidence:** DesignerCanvas.tsx:172-254 implements 4 checks (missing start, missing end, gateway without outgoing, dangling edges) + end reachability; no checks for task in/out, assignee, gateway conditions. designerData.ts:48-56 defines ValidationResult but no function calls a validate endpoint. ValidationIndicators.tsx:75-97 shows green 'No issues found' whenever violations is empty, including before any validation. Note 'dangling edge' is not reachable in practice (reactflow removes edges).
- **Files to change:** `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/ValidationIndicators.tsx`
- **Fix steps:**
  1. Add hasValidated state; before first Validate show neutral 'Not validated yet'; reset to that after any node/edge change.
  2. Add rules: task needs incoming and outgoing edge, task assignee non-empty, gateway edges/conditions for exclusive gateway, start has no incoming.
  3. Call a server validate endpoint only if backend confirms one exists (ValidationResult type suggests it); otherwise keep client-side.
- **Acceptance:**
  - Unit test: empty canvas shows 'Not validated'; after Validate shows the missing start/end.
  - Unit test: orphan task yields a violation.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** False assurance on approval flows is the main risk; keep validation blocking Save/Publish.

### GAP-WORKFLOW-DESIGNER-05  ·  MEDIUM  ·  partly  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Layout is fixed three columns (w-56 + flex-1 + w-72, DesignerCanvas.tsx:262-335) with Tailwind slate/white utilities, not tokens: at tablet/phone widths the canvas is squeezed to nothing and dark mode leaves white panels. The "/ 500 elements" limit is displayed but never enforced (DesignerCanvas.tsx:256,302).
- **Verified evidence:** Layout: DesignerCanvas.tsx:262 flex gap-3 with BpmnPalette w-56 (BpmnPalette.tsx:14) and right column w-72 (:309), no breakpoints; all panels use slate/white utilities (also PropertyPanel, ValidationIndicators) - tailwind config is not in the snapshot so dark-mode mapping is cannot-verify, but bg-white is hard-coded. '/ 500 elements' at :256,302 is display only; onDrop (:125-147) and onConnect never check the limit. Not a PII item.
- **Files to change:** `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/BpmnPalette.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/PropertyPanel.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/ValidationIndicators.tsx`
- **Fix steps:**
  1. Replace slate/white utilities with DS tokens (var(--panel), var(--line), var(--ink2)).
  2. Below 1024px stack palette above and property panel below (flex-col, palette horizontal scroll).
  3. Enforce MAX_ELEMENTS=500 in onDrop/onConnect and show a message when reached.
- **Acceptance:**
  - Manual: 768px and 375px widths keep canvas at least 320px high; dark theme shows no white panels.
  - Unit test: 501st node is rejected.
- **Needs:** web  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-WORKFLOW-DESIGNER-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Assignee Role and Condition Expression are free text ("e.g. finance_officer", "e.g. amount > 100000", PropertyPanel.tsx) with no role picker or expression check — a typo produces a definition no one can be assigned; no undo/redo and no unsaved-changes guard.
- **Verified evidence:** PropertyPanel.tsx:125-136 Assignee Role is a text input (placeholder 'e.g. finance_officer', maxLength 100) and :~145-155 Condition Expression is free text (placeholder 'e.g. amount > 100000'); no validation. DesignerCanvas has no undo/redo history and no unsaved guard. The service designer already fetches positions via fetchTenantPositions (designer/_data/workflowBuilderApi.ts:90).
- **Files to change:** `apps/web/src/app/(app)/workflow/designer/_components/PropertyPanel.tsx`, `apps/web/src/app/(app)/workflow/designer/_components/DesignerCanvas.tsx`
- **Fix steps:**
  1. Replace assignee input with a select/EntityPicker fed by tenant roles or positions (reuse fetchTenantPositions; confirm roles endpoint with backend).
  2. Validate condition with a small parser (field op value) and show inline error; add rule to Validate.
  3. Add undo/redo stack for nodes/edges and Ctrl+Z / Ctrl+Y.
  4. Add beforeunload guard when dirty.
- **Acceptance:**
  - Unit test: invalid condition 'amount >' shows error and blocks Save.
  - Manual: selecting a role stores its code; undo restores prior graph.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Wrong role references leave approvals unassigned; validate against live roles.
- **Depends on:** GAP-WORKFLOW-DESIGNER-01

### GAP-WORKFLOW-DESIGNER-07  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Workflow is not in the sidebar (ds/Sidebar.tsx has no /workflow entry); it is reachable only from the dashboard "My approvals" button (dashboard/page.tsx:47), RoleCommandCenter and GlobalSearch (GlobalSearch.tsx:69). The mockup nav has no matching id, so data-active is set to "designer" (nearest Citizen-services item).
- **Verified evidence:** Same as GAP-WORKFLOW-DEFINITIONS-05: Sidebar.tsx has no /workflow item (verified); routes reached from dashboard/page.tsx:47, RoleCommandCenter.tsx:110, GlobalSearch.tsx:69. Mockup data-active claim is cannot-verify.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. In Sidebar.tsx NAV, add an item { icon: Workflow (lucide), label: 'Workflow & Approvals', href: '/workflow', moduleKey: 'workflow' } to the operations/citizen group; workflow/layout.tsx already gates on ModuleGate moduleKey='workflow' so the key matches.
  2. Confirm isActive(href) highlights the entry for /workflow/definitions, /workflow/list, /workflow/designer and /workflow/my-tasks (prefix match).
  3. Keep dashboard 'My approvals' button and GlobalSearch link unchanged.
  4. For the HTML mockups in civitas-redesign, add a nav id for Workflow instead of mapping data-active to 'designer'.
- **Acceptance:**
  - Component test: Sidebar renders a Workflow link when the tenant has module 'workflow' enabled and hides it when disabled.
  - Manual: open /workflow/definitions - the Workflow item is shown as active.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; a nav entry could appear for roles who lack workflow permission - reuse rolesAllowed if the module has a role model.
- **Depends on:** GAP-WORKFLOW-DEFINITIONS-05


---
## /workflow/instances/[id]  —  `workflow/instances-detail.html`

- **Source:** `apps/web/src/app/(app)/workflow/instances/[id]/page.tsx`
- **Design reference:** `redesign/workflow/instances-detail.html`

### GAP-WORKFLOW-INSTANCES-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Audit readability: the transition history — the "immutable" maker-checker record — identifies the actor only as the first 8 characters of a UUID ("8f2d41ab…", HistoryTimeline.tsx:53) and the assignee the same (TasksTable.tsx:90); nobody can tell who approved without a database lookup.
- **Verified evidence:** HistoryTimeline.tsx:53 renders `actor <span class=mono>{t.actorId.slice(0,8)}…</span>`; TasksTable.tsx:90 does the same for assigneeId. WorkflowTransition (workflowTypes.ts:~75) and mapper (workflowData.ts:240-249) carry only actorId, no name. Whether the history API can return an actor name is cannot-verify (workflow-service not in snapshot).
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/HistoryTimeline.tsx`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`, `apps/web/src/app/(app)/workflow/_data/workflowData.ts`, `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`, `apps/web/src/lib/directory/resolveUsers.ts (new)`
- **Fix steps:**
  1. Confirm with workflow/identity service owners whether history and task payloads can include actorName/assigneeName, else add a batched user-directory lookup by id (server side).
  2. Add optional actorName/assigneeName to WorkflowTransition and WorkflowTask in workflowTypes.ts and map them in getInstanceHistory/mapTask.
  3. If the API lacks names, add resolveUserNames(ids[]) server helper called once in instances/[id]/page.tsx and my-tasks/page.tsx and pass a Map to the components.
  4. In HistoryTimeline render name (fallback 'Unknown user' + full id in title attr, copyable); same for the Assignee column in TasksTable.
  5. Show role/designation next to the name for approve/reject rows.
- **Acceptance:**
  - Unit test: HistoryTimeline with actorName='A. Kumar' renders that name and not the 8-char id.
  - Manual: open an instance with an approved task; timeline names the approver.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Audit view; wrong name resolution would misattribute approvals - resolve server-side and never guess.
- **Depends on:** GAP-WORKFLOW-MY-TASKS-02

### GAP-WORKFLOW-INSTANCES-DETAIL-02  ·  HIGH  ·  partly  ·  theme FAILMASK

- [x] **Status** (W1 follow-up: closed by #2002, verified on main d341ad6f1)
- **First-pass claim:** Mandatory-document checklist fails silently: DocVerificationChecklist returns null on error/empty in compact mode (DocVerificationChecklist.tsx:75-80), which is the mode TasksTable always uses (TasksTable.tsx:116-124), and Approve is never disabled by missing mandatory docs — an officer can approve with the checklist absent or "missing".
- **Verified evidence:** DocVerificationChecklist.tsx:74-78 returns null on error in compact mode (79-83 also null while loading; 84 null on empty). TasksTable.tsx:118-124 always passes compact, and only when refType contains 'application' with nodeKey+refId. Approve (TaskActions.tsx:248-263) has no disabled/guard tied to the checklist. Any server-side enforcement is cannot-verify (no workflow-service). Fix text in the finding (notFound mapping) does not apply here.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`, `apps/web/src/app/(app)/workflow/_components/TaskActions.tsx`
- **Fix steps:**
  1. In DocVerificationChecklist expose an onState callback ({status:'loading'|'error'|'ready', missingMandatory:number}).
  2. Render a compact visible error line ('Documents could not be checked' + Retry button that re-runs the effect) instead of null when compact.
  3. Show a compact summary chip ('2 mandatory missing') when items load.
  4. Lift state in TasksTable per row and pass `approveDisabledReason` to TaskActions; disable Approve (with title/aria-describedby) when status is error/loading or missingMandatory>0, keeping Return/Reject enabled.
  5. Confirm with backend that /complete also rejects approval with missing mandatory docs (do not rely on UI only).
- **Acceptance:**
  - Component test: fetch 500 -> error text and Retry visible in compact mode.
  - Component test: one mandatory item provided=false -> Approve disabled with reason.
  - Manual: kill the proxy -> Approve stays disabled, not silently enabled.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Blocking approvals on a flaky checklist can stall officers; provide retry and a documented override path (decision needed).
- **Depends on:** GAP-WORKFLOW-MY-TASKS-06

### GAP-WORKFLOW-INSTANCES-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Current step ignores instance.currentNode (workflowTypes.ts:60) and derives it from the newest history row (page.tsx:52-55): if the history fetch fails the card reads "—" although the instance has a step; stats also print real zeros for Open tasks / Transitions when their fetches errored (page.tsx:82-88).
- **Verified evidence:** instances/[id]/page.tsx:52-55 derives currentStep from newest history row's toNode, '—' if history empty/failed; WorkflowInstanceDetail.currentNode is mapped (workflowData.ts:206) but unused. Lines 84-85 pass openTasks.length and history.length directly, so errored fetches (tasksSource/historySource==='error', data []) print 0. StatCard (ds/StatCard.tsx:21 displayValue) already renders null/undefined/NaN as '—'. The Open tasks and history cards below do show RefreshErrorState (100-102,118-119), so only the stats mislead.
- **Files to change:** `apps/web/src/app/(app)/workflow/instances/[id]/page.tsx`
- **Fix steps:**
  1. Set currentStep = instance.currentNode ?? (historySource==='error' ? null : latest?.toNode) ?? null.
  2. Pass value={tasksSource==='error' ? null : openTasks.length} to Open tasks and historySource==='error' ? null : history.length to Transitions.
  3. Keep step key humanised via titleCase for display.
- **Acceptance:**
  - Test: history fetch error with instance.currentNode='inspection' -> card shows Inspection.
  - Test: tasks fetch error -> Open tasks stat shows '—' not 0.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKFLOW-INSTANCES-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was DATEFMT)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** After Approve/Return/Reject the row is refreshed away (router.refresh) and the "Task approved." live-region and banner live inside the row component that unmounts (TaskActions.tsx:52-66,111-160) — the outcome announcement is lost to screen readers and sighted users alike.
- **Verified evidence:** TaskActions.tsx:205-207 keeps the toast state (useToast 175-194) and the aria-live node (301-302) inside the row component; approve/return/reject onSuccess (259-262, 277-280, 296-299) call announce() then router.refresh(). The page filters to pending tasks (instances/[id]/page.tsx:51, my-tasks fetches status=pending) so the decided row unmounts with its live region/banner; announcement is at best racy. Claim leaves the row so its toast survives. Theme is a11y/feedback, not date format. A global ToastProvider exists ((app)/layout.tsx:70, ds/Toast.tsx useToast).
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/TaskActions.tsx`
- **Fix steps:**
  1. Replace local useToast in TaskActions with `useToast()` from '@/app/_components/ds' (global ToastProvider) so toasts live above the table.
  2. Call toast.success/error before router.refresh() in each onSuccess; remove local banner/sr-only node.
  3. Verify ds Toast has an aria-live region; if not add role=status.
- **Acceptance:**
  - Test: approve -> toast text present in document after row removed.
  - Manual with screen reader: outcome announced once.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKFLOW-INSTANCES-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme CONFIRM

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **W0 note:** partly fixed by #1923 — TaskActions now maps maker-checker failures to a specific message; no isMaker check hides or disables Approve in the UI
- **First-pass claim:** Failure of a decision shows only "We couldn't save your task…" (TaskActions.tsx:31-34); a maker-checker denial (same user as maker) is indistinguishable from a network error, and Approve is offered to the maker in the first place.
- **Verified evidence:** TaskActions.tsx:160-172 postJson throws taskActionError() for any non-2xx, discarding status (403/409 vs 5xx/network), shown by ActionButton (useConfirmAction catch). True. Approve is offered whenever status pending (248-263) with no knowledge of the current user or maker; the description only says maker-checker applies (253). Whether the backend enforces maker!=checker is cannot-verify (workflow-service absent); the task payload has no makerId (workflowTypes WorkflowTask).
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/TaskActions.tsx`, `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`, `apps/web/src/app/(app)/workflow/_data/workflowData.ts`
- **Fix steps:**
  1. Make postJson throw a typed error carrying status; map 403/409 with a maker-checker code to a specific message via toHumanError (add catalogue entry 'You cannot approve a request you created').
  2. Expose makerId (or requesterId) on WorkflowTask if backend provides it; in TasksTable pass `isMaker` (= makerId === session user id) to TaskActions.
  3. Hide/disable Approve with explanatory tooltip when isMaker.
  4. Keep server as the authority; UI check is convenience.
- **Acceptance:**
  - Test: mock 403 maker-checker -> dialog shows specific message not generic save error.
  - Test: isMaker=true -> Approve disabled.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Approval control; must not weaken backend enforcement.
- **Depends on:** GAP-WORKFLOW-INSTANCES-DETAIL-01

### GAP-WORKFLOW-INSTANCES-DETAIL-06  ·  MEDIUM  ·  confirmed  ·  theme INPUT-VALIDATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Instance not found" (page.tsx:37-49) is unreachable: getInstanceById maps every non-2xx incl. 404 to source "error" (workflowData.ts:75-78, comment at 214-217); params.id is interpolated raw into the upstream URL (workflowData.ts:222).
- **Verified evidence:** getJson (workflowData.ts:75) maps any !res.ok, including 404, to {data:null, source:'error'}; getInstanceById (218-227, comment 212-217) does no differentiation. page.tsx:27-49 therefore only ever hits the error branch except if the mapper returns null-> also 'error'; the 'Instance not found' text (40,44) is unreachable. params.id is interpolated raw into the URL at workflowData.ts:222 (also 231-236, 304); Next decodes %2F/'?' so `../` or query injection into the gateway path is possible (gateway auth still applies). 'DEADROUTE' is a mislabel: this is dead branch/input validation.
- **Files to change:** `apps/web/src/app/(app)/workflow/_data/workflowData.ts`, `apps/web/src/app/(app)/workflow/instances/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/not-found.tsx`
- **Fix steps:**
  1. Validate id with zod uuid schema at page entry; call notFound() on failure.
  2. Use encodeURIComponent(id) in getInstanceById/getInstanceHistory/getTasksForInstance paths (and query).
  3. In getJson keep status; in page, if source==='error' && status===404 call notFound() (workflow/not-found.tsx exists).
  4. Otherwise render RefreshErrorState instead of the EmptyState in the load-error branch.
- **Acceptance:**
  - Test: id='../admin' -> notFound, no upstream call.
  - Test: upstream 404 -> not-found page; upstream 500 -> RefreshErrorState.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; validation also hardens the path.

### GAP-WORKFLOW-INSTANCES-DETAIL-07  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** refId is printed raw and not linked to the source record (page.tsx:90-98); no cancel/suspend control exists although the list counts "Cancelled" instances; DocVerificationChecklist calls /verification-lane while its docstring says /documents/checklist (DocVerificationChecklist.tsx:3-6,52).
- **Verified evidence:** page.tsx:89-96 prints refType and raw refId as plain text, unlinked (true). No cancel/suspend control exists anywhere in workflow components (true; only TaskActions). InstancesTable/list counts cancelled from analytics (list/page.tsx:18-20). DocVerificationChecklist docstring (line 5) says /v1/citizen/documents/checklist but fetch at line 53 uses .../verification-lane (true). Whether a cancel API exists is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/workflow/instances/[id]/page.tsx`, `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx`, `apps/web/src/lib/workflow/refLink.ts (new)`
- **Fix steps:**
  1. Create refLinkFor(refType, refId) mapping known types (application, leave, etc.) to existing detail routes; render as <Link> with human label, else plain text without raw uuid.
  2. Fix docstring in DocVerificationChecklist to /verification-lane.
  3. Decision: whether cancel/suspend is in scope; if yes add ActionButton (requireReason) calling the backend endpoint once it exists.
- **Acceptance:**
  - Test: refType 'leave_request' renders a link to the leave detail.
  - Docstring matches fetch URL.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Cancel/suspend touches process integrity; needs approval rules.


---
## /workflow/list  —  `workflow/list.html`

- **Source:** `apps/web/src/app/(app)/workflow/list/page.tsx`
- **Design reference:** `redesign/workflow/list.html`

### GAP-WORKFLOW-LIST-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Headline stats and table come from two different fetches and analytics failure is invisible: `{ data: analytics }` discards the source (list/page.tsx:9-12), so a failed analytics call shows Active/Completed/Cancelled = 0 above a full table, and Total falls back to rows.length (list/page.tsx:33) — capped at limit=200 (workflowData.ts:181-192), so Total and Completed can disagree for large tenants.
- **Verified evidence:** list/page.tsx:9-12 destructures `{ data: analytics }` dropping source; on failure getAnalyticsSummary returns EMPTY_ANALYTICS (workflowData.ts:317-326) so active/completed/cancelled render 0 (34-36). Total = `analytics.totalInstances || instances.length` (33) so zero analytics falls back to rows, which are capped by limit=200 (workflowData.ts:183). StatCard supports null -> '—'.
- **Files to change:** `apps/web/src/app/(app)/workflow/list/page.tsx`
- **Fix steps:**
  1. Capture `source: analyticsSource` from getAnalyticsSummary.
  2. When analyticsSource==='error' pass null to Total/Active/Completed/Cancelled; otherwise use analytics.totalInstances without the rows fallback.
  3. Show DataSourceBadge or a RefreshErrorState note for the stats when analytics failed.
  4. If rows.length >= 200 show 'Showing first 200 of N'.
- **Acceptance:**
  - Test: analytics 500 -> four stats show '—' while table renders.
  - Test: analytics ok, 500 instances -> Total 500.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-02

### GAP-WORKFLOW-LIST-02  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Error is a warning-icon EmptyState with no Try again (list/page.tsx:41-49) — the pattern UX-001 replaced elsewhere with RefreshErrorState; stats stay real zeros.
- **Verified evidence:** list/page.tsx:41-49 uses EmptyState icon ⚠️ with no retry when source==='error'; RefreshErrorState is available in ds and already used in instances/[id]/page.tsx:102. Stats stay zeros (34-36).
- **Files to change:** `apps/web/src/app/(app)/workflow/list/page.tsx`, `apps/web/src/app/(app)/workflow/my-tasks/page.tsx`
- **Fix steps:**
  1. Import RefreshErrorState from ds; replace EmptyState with <RefreshErrorState error={toHumanError('load',{area:'instances'})} />.
  2. Pass null to stats on error (see LIST-01).
- **Acceptance:**
  - Test: getInstances error -> Try again button present; click triggers router.refresh.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-01

### GAP-WORKFLOW-LIST-03  ·  MEDIUM  ·  partly  ·  theme DATA-GAP (was UUID)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** List mapper keeps only id, name, status, version (workflowData.ts:171-180) — definition, current step, subject (refType/refId) and dates that the detail mapper reads (workflowData.ts:194-212) never reach the list, so users cannot tell what an instance is about, how old it is, or where it is stuck; name silently falls back to the raw UUID.
- **Verified evidence:** mapInstance (workflowData.ts:171-179) keeps id,name,status,version only, whereas mapInstanceDetail (194-211) also reads definitionName, refType, refId, currentNode, createdAt, updatedAt. name falls back to the raw id (175). True, but whether the LIST endpoint returns those fields is cannot-verify (workflow-service absent); the mapper simply discards them if present.
- **Files to change:** `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`, `apps/web/src/app/(app)/workflow/_data/workflowData.ts`, `apps/web/src/app/(app)/workflow/_components/InstancesTable.tsx`
- **Fix steps:**
  1. Extend WorkflowInstance with optional definitionName, refType, refId, currentNode, createdAt.
  2. Read them in mapInstance via optStr (same as detail mapper).
  3. Add Definition, Subject, Current step, Started (formatIndianDate) columns to InstancesTable; sort by createdAt desc by default.
  4. If the list endpoint lacks them, ask backend to add; fallback name = titleCase(definitionName) not uuid.
- **Acceptance:**
  - Test: mapInstance with full payload keeps fields.
  - Manual: list shows what/where/how old for each instance.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-04

### GAP-WORKFLOW-LIST-04  ·  MEDIUM  ·  confirmed  ·  theme UUID

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** ID column prints the first 8 chars of a UUID with an ellipsis (InstancesTable.tsx:67) — not copyable, not unique-safe, not a business reference.
- **Verified evidence:** InstancesTable.tsx:67 renders `{r.id.slice(0, 8)}…` in mono, sortable:false. Truncated, not copyable. Row href to detail exists (rowHref).
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/InstancesTable.tsx`
- **Fix steps:**
  1. Replace ID column with a business reference (refType+refId label or definition code) once LIST-03 fields exist.
  2. Keep short id only as secondary, with copy-to-clipboard button and full id in title.
- **Acceptance:**
  - Test: full id available via copy button; column no longer ellipsised uuid alone.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-03

### GAP-WORKFLOW-LIST-05  ·  MEDIUM  ·  partly  ·  theme NAV (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Workflow is not in the sidebar (ds/Sidebar.tsx has no /workflow entry); it is reachable only from the dashboard "My approvals" button (dashboard/page.tsx:47), RoleCommandCenter and GlobalSearch (GlobalSearch.tsx:69). The mockup nav has no matching id, so data-active is set to "designer" (nearest Citizen-services item).
- **Verified evidence:** ds/Sidebar.tsx has no /workflow entry (grep: none; 'Service Designer' /designer at line 97). Entry points confirmed: dashboard/page.tsx:47, RoleCommandCenter.tsx:110, GlobalSearch.tsx:69. The layout is ModuleGate moduleKey 'workflow' (workflow/layout.tsx). The 'data-active=designer' claim concerns the HTML mockup in the redesign repo and was not verified in app code.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Add a 'Workflow / Approvals' item {href:'/workflow', moduleKey:'workflow'} in the Citizen/Ops group with an icon (e.g. Workflow/GitBranch from lucide).
  2. Optionally add a pending-tasks count badge from getTasks.
  3. Update mockup nav id mapping in the redesign prototype.
- **Acceptance:**
  - Test: Sidebar with workflow module enabled shows link and marks it active on /workflow/my-tasks.
  - Hidden when module disabled.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-WORKFLOW-LIST-06  ·  LOW  ·  partly  ·  theme OTHER (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Suspense fallback={null} leaves the card blank while useSearchParams resolves (list/page.tsx:52-54); no "Start instance" action or CSV export though the definitions table offers export.
- **Verified evidence:** Suspense fallback={null} at list/page.tsx:55 (obs said 52-54) - but InstancesTable is a client component using useSearchParams, so blank flash is real yet brief. No Start-instance action or export in list; definitions table export not checked beyond the claim. theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/workflow/list/page.tsx`, `apps/web/src/app/(app)/workflow/_components/InstancesTable.tsx`
- **Fix steps:**
  1. Use a Skeleton from ds as Suspense fallback.
  2. Decision: is starting instances from the UI wanted (usually started by domain modules)? If yes add action; if export needed add CSV export via the same helper DefinitionsTable uses, with audit event.
- **Acceptance:**
  - Manual: throttle network -> skeleton appears instead of blank card.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** CSV export of instance data should be role-gated/audited.


---
## /workflow/my-tasks  —  `workflow/my-tasks.html`

- **Source:** `apps/web/src/app/(app)/workflow/my-tasks/page.tsx`
- **Design reference:** `redesign/workflow/my-tasks.html`

### GAP-WORKFLOW-MY-TASKS-02  ·  HIGH  ·  confirmed  ·  theme UUID

- [~] **Status** (W2 PQ: partial in #2036 (requester and date delivered); amount NOT delivered: instance context has no typed amount field, needs owner decision)
- **W0-10 note:** review found the W0 tick partly — Instance column is now an Open instance link, but Subject is still refType + 8-char refId (TasksTable.tsx:19-23); no requester/amount/summary fields in WorkflowTask or mapTask, so approver still cannot decide without opening instance
- **First-pass claim:** Approvers act blind: the row shows Subject as a title-cased refType ("Leave Request") only (TasksTable.tsx:80-84); refId, requester, amount and dates are never displayed, and the Instance link is an 8-char UUID fragment (TasksTable.tsx:100-104) — a user must open each instance to learn what is being approved.
- **Verified evidence:** TasksTable.tsx:79-83 Subject = titleCase(refType) only; refId, requester, amount, dates not in WorkflowTask (workflowTypes) nor rendered; Instance column (95-108) shows `instanceId.slice(0,8)…` as a plain <a>. Whether the API supplies requester/amount/due is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`, `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`, `apps/web/src/app/(app)/workflow/_data/workflowData.ts`
- **Fix steps:**
  1. Ask backend for subject summary fields (title, requesterName, amount in paise, createdAt/dueAt) on the task list; map in mapTask.
  2. Render Subject as 'Leave Request - <summary>' linking to the source record; format amounts with formatMoney (paise) and dates with formatIndianDate.
  3. Make the Instance column a labelled link ('Open instance') rather than a uuid fragment, and use next/link.
  4. Add rowHref to instance detail.
- **Acceptance:**
  - Test: task with summary renders requester/amount/date.
  - Manual: approver can decide without opening the instance.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Amounts must use paise/formatMoney; exposing requester PII should respect role.
- **Depends on:** GAP-WORKFLOW-INSTANCES-DETAIL-01

### GAP-WORKFLOW-MY-TASKS-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** "Claimed" counts any assigneeId (my-tasks/page.tsx:16), not tasks claimed by me, and "Open tasks" equals "Pending" because the fetch is already status=pending (my-tasks/page.tsx:11-14) — two of four stats are redundant, and the StatusFilter can only ever offer All/Pending.
- **Verified evidence:** my-tasks/page.tsx:76 fetches status=pending; pending (78) and Open tasks (93) are both tasks.length effectively (filter is redundant). Claimed = tasks with any assigneeId (80), not mine (no current user id compared). StatusFilter options derive from tasks' statuses (TasksTable.tsx:30-34) so only All/Pending appear.
- **Files to change:** `apps/web/src/app/(app)/workflow/my-tasks/page.tsx`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`
- **Fix steps:**
  1. Replace stats with: Open (tasks.length), Unassigned, Claimed by me (assigneeId === session user id via existing getSession helper), Overdue (once SLA field exists).
  2. Drop the status filter on my-tasks (showStatusFilter=false prop) or fetch without status filter for a history tab.
- **Acceptance:**
  - Test: tasks assigned to others are not counted in 'Claimed by me'.
  - StatusFilter hidden when only one status.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-MY-TASKS-05

### GAP-WORKFLOW-MY-TASKS-04  ·  MEDIUM  ·  confirmed  ·  theme PAGINATION (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Inbox silently truncates at limit=200 (workflowData.ts:281-283) with no pager cue; all four stats are computed from that slice, so counts stop being true beyond 200 open tasks.
- **Verified evidence:** getTasks (workflowData.ts:281-283) hard-codes limit=200 and no offset/total; all stats in my-tasks/page.tsx:78-80 compute from the slice; DataTable paginates client-side only (pageSize 15). No truncation notice. Theme DEADROUTE wrong. Whether the API returns a total/next cursor is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/workflow/_data/workflowData.ts`, `apps/web/src/app/(app)/workflow/my-tasks/page.tsx`
- **Fix steps:**
  1. Extend WorkflowResult with optional total/truncated (from API meta or rows.length>=limit).
  2. Show banner 'Showing first 200 tasks' when truncated and compute stats from server counts if available.
  3. Prefer server-side pagination via ?page= params.
- **Acceptance:**
  - Test: 200 rows returned -> truncation notice shown.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.

### GAP-WORKFLOW-MY-TASKS-05  ·  MEDIUM  ·  partly  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** No urgency signal: nodes carry slaMinutes (workflowTypes.ts:27) and analytics tracks breaches, but the inbox has no due/age/SLA column or default sort, and the error state is a warning EmptyState with stats at real zeros (my-tasks/page.tsx:38-45) — an outage reads as inbox zero.
- **Verified evidence:** Error state is EmptyState ⚠️ with no retry (my-tasks/page.tsx:101-108) and stats print zeros (93-96): true, an outage looks like zeros though the table area says 'Could not load'. WorkflowNode.slaMinutes exists (workflowTypes.ts, node type) but WorkflowTask has no dueAt/slaMinutes, so SLA column needs API support (cannot-verify). No default sort set on DataTable.
- **Files to change:** `apps/web/src/app/(app)/workflow/my-tasks/page.tsx`, `apps/web/src/app/(app)/workflow/_data/workflowTypes.ts`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`
- **Fix steps:**
  1. Use RefreshErrorState on error and pass null to StatCards when source==='error'.
  2. Request createdAt and dueAt on tasks; add Age and Due columns (formatIndianDate) with overdue pill; default sort oldest/most overdue first.
- **Acceptance:**
  - Test: error -> Try again and '—' stats.
  - Test: overdue task sorts first with Overdue pill.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-02

### GAP-WORKFLOW-MY-TASKS-06  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Mandatory-document checklist is fetched per row from the browser (N+1, TasksTable.tsx:118-126) and is invisible on error in compact mode (DocVerificationChecklist.tsx:75-80); Approve is never blocked by "missing" documents.
- **Verified evidence:** TasksTable.tsx:118-124 mounts a DocVerificationChecklist per qualifying row; each runs its own useEffect fetch (DocVerificationChecklist.tsx:41-71) from the browser: N requests per page (up to 200 rows mounted since DataTable pages client-side only render 15, so N<=15 per page). Compact error/loading/empty return null (74-84). Approve unguarded (TaskActions.tsx). Overlaps INSTANCES-DETAIL-02.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`
- **Fix steps:**
  1. Fix per INSTANCES-DETAIL-02 for error and approve gating.
  2. Add a batched endpoint or server-side prefetch (POST verification-lane with applicationIds[]) and pass results down; or lazy-load on row expand.
  3. Cache per (lane, application) in a small client cache to avoid refetch on paging.
- **Acceptance:**
  - Test: 15 rows produce <=1 checklist request.
  - See DETAIL-02 acceptance.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-INSTANCES-DETAIL-02

### GAP-WORKFLOW-MY-TASKS-07  ·  MEDIUM  ·  partly  ·  theme NAV (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Workflow is not in the sidebar (ds/Sidebar.tsx has no /workflow entry); it is reachable only from the dashboard "My approvals" button (dashboard/page.tsx:47), RoleCommandCenter and GlobalSearch (GlobalSearch.tsx:69). The mockup nav has no matching id, so data-active is set to "designer" (nearest Citizen-services item).
- **Verified evidence:** Same as LIST-05: ds/Sidebar.tsx lacks /workflow; entry points at dashboard/page.tsx:47, RoleCommandCenter.tsx:110, GlobalSearch.tsx:69 confirmed. data-active=designer mockup mapping not verifiable in app code. Duplicate of GAP-WORKFLOW-LIST-05.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`
- **Fix steps:**
  1. Fix once with LIST-05: add Workflow item to Sidebar.tsx.
- **Acceptance:**
  - See LIST-05.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-WORKFLOW-LIST-05

### GAP-WORKFLOW-MY-TASKS-08  ·  LOW  ·  partly  ·  theme UX (was CONFIRM)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1923, verified on main 9c5e9e9e9)
- **First-pass claim:** Up to four full-size confirm dialogs per row (Claim included) for a reversible-in-effect claim; the "Task approved." live region unmounts with the refreshed row (TaskActions.tsx:52-66); Actions column is a wrapping button cluster with no mobile treatment (TasksTable.tsx:107-127).
- **Verified evidence:** Every action goes through ActionButton with a ConfirmDialog, incl. Claim (TaskActions.tsx:230-247): up to four dialogs (Claim, Approve, Return, Reject) per row, true. Live region unmounts with the row (see DETAIL-04) but Claim keeps the row. Actions cell is inline-flex wrap (229) inside grid (TasksTable.tsx:115); no responsive handling in DataTable usage (not verified in DataTable). 'Reversible' claim is unverified: description says claimed tasks leave others' inboxes and no unclaim exists in the UI.
- **Files to change:** `apps/web/src/app/(app)/workflow/_components/TaskActions.tsx`, `apps/web/src/app/(app)/workflow/_components/TasksTable.tsx`
- **Fix steps:**
  1. Make Claim a plain button (no dialog) with toast; keep dialogs for decisions.
  2. Collapse Return/Reject into an overflow menu on narrow widths; keep Approve primary.
  3. Decision: add Unclaim if backend supports.
- **Acceptance:**
  - Manual: Claim is one click; at 375px width actions do not overflow.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Removing confirmation on claim slightly raises accidental claim risk.
- **Depends on:** GAP-WORKFLOW-INSTANCES-DETAIL-04


---
## Backend verification items (service code absent from snapshot)

### GAP-WORKFLOW-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Access is open: no requireAnyRole and the hub links straight to task inbox, instance history and the definition designer (workflow/layout.tsx is ModuleGate only). Tenant-wide analytics are visible to every user; service-side scoping is undeterminable (services/workflow-service absent).
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['GET /api/v1/workflow/analytics/summary']`
- **Question:** Is analytics/summary scoped to the caller's tenant and role (or restricted to workflow admins), or does it return tenant-wide figures to every authenticated user?
- **How to verify:** Open the analytics summary handler in workflow-service; curl as a plain employee and as a workflow admin and compare counts and the required-role preHandler.
- **Test to add:** Given a user with no workflow role, when GET analytics/summary, then 403 (or only own-scope counts); given admin, then tenant-wide counts.
- **Impact if wrong:** Information disclosure of tenant-wide workload and SLA metrics to all users.
- **Web change if wrong:** Add requireAnyRole to workflow/page.tsx and hide designer/definitions links for non-admins if service does not enforce.

### GAP-WORKFLOW-HOME-04  ·  MEDIUM  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Breach rate assumes a 0–1 fraction (slaBreachRate*100, page.tsx:50) and defaults every missing metric to 0 (workflowData.ts:317-346): a service returning percent would print 630%, and a partial payload prints a clean "0.0%". Contract undeterminable (service absent).
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['GET /api/v1/workflow/analytics/summary']`
- **Question:** Does slaBreachRate come back as a 0-1 fraction (not percent) and are all metrics always present in the payload?
- **How to verify:** Read the analytics handler/schema for slaBreachRate; curl with 63 breached of 100 and confirm 0.63; test a tenant with no data returns explicit zeros.
- **Test to add:** Given 63/100 breached tasks, when GET analytics/summary, then slaBreachRate == 0.63; given empty tenant, then all fields present and numeric.
- **Impact if wrong:** Breach rate printed as 6300% or a false clean 0.0%, hiding SLA failures.
- **Web change if wrong:** Divide by 100 if percent is returned; make workflowData.ts return null (not 0) for missing metrics and render a dash.

### GAP-WORKFLOW-DEFINITIONS-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Two divergent contracts for the same endpoint: this page reads module/triggerEvent/steps (page.tsx:6-14) with a bare cast, while workflowData.ts maps GET /v1/workflow/definitions to {code, version, description} only (workflowData.ts:107-131). Which fields the service actually returns is undeterminable (workflow-service absent); Module and Trigger columns may render blank.
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['GET /api/v1/workflow/definitions', 'GET /api/v1/workflow/templates']`
- **Question:** Does GET /v1/workflow/definitions return items with id, name, module, triggerEvent, steps (count), status, version (page.tsx:6-14) as well as code/description used by workflowData.ts:107-131?
- **How to verify:** Open the definitions list handler and its response schema in workflow-service; curl GET /api/v1/workflow/definitions as a workflow admin and diff the keys against page.tsx Definition and workflowData.ts mapper.
- **Test to add:** Given a seeded definition, when GET /v1/workflow/definitions, then each item has module, triggerEvent, steps as number, status, version (contract test shared with web fixtures).
- **Impact if wrong:** Module and Trigger columns render blank; admins cannot tell definitions apart.
- **Web change if wrong:** Align page.tsx to reuse workflowData.ts mapper or add missing fields to the type; default absent fields to an explicit dash.

### GAP-WORKFLOW-DESIGNER-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Server fetch is wasted and its failure misleads: page.tsx awaits GET /workflow/designer/definitions (designerData.ts:77-100) only to pass it to a component that ignores it, so the header badge "Couldn't load — showing nothing" (page.tsx:16) reports a failure with zero effect on the canvas. Endpoint contract undeterminable (workflow-service absent).
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['GET /api/v1/workflow/designer/definitions?pageSize=100', 'GET /api/v1/workflow/designer/definitions/:id']`
- **Question:** Do the designer definitions endpoints exist, return a stable list shape, and require a designer role rather than any authenticated user?
- **How to verify:** Open designer routes in workflow-service; curl the list as designer and as plain user (expect 403 for the latter) and note the body shape vs designerData.ts:77-100.
- **Test to add:** Given a user without designer role, when GET designer/definitions, then 403; given designer, then 200 {data:[{id,name,version}]}.
- **Impact if wrong:** Designer shows a false failure badge or exposes unpublished workflow definitions to non-designers.
- **Web change if wrong:** Stop awaiting the fetch in page.tsx (canvas ignores it) or pass the data to the component; drop the misleading badge.

### GAP-WORKFLOW-MY-TASKS-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Decision buttons are shown on every pending row: TaskActions gates only Claim on `assigned` (TaskActions.tsx:107-166), so Approve/Return/Reject render for tasks another officer has claimed, and for the maker's own submission despite the "approver must be distinct" dialog copy. Such clicks end in a generic "We couldn't save your task" (TaskActions.tsx:31-34); real enforcement is undeterminable (workflow-service absent).
- **Service:** `workflow-service`  ·  **Endpoint(s):** `['POST /v1/workflow/tasks/:id/complete', 'POST /v1/workflow/tasks/:id/claim', 'GET /v1/workflow/tasks']`
- **Question:** Does complete reject (403/409) when the task is claimed by another assignee, when actor is not in the task's role group, and when actor equals the maker (maker-checker)?
- **How to verify:** Open the task complete handler in workflow-service; curl complete as user B on a task claimed by A (expect 409/403) and as the maker (expect 403 with distinct code).
- **Test to add:** Given task claimed by A, when B posts complete approve, then 409 TASK_CLAIMED; given maker==actor, then 403 MAKER_CHECKER; given assignee, then 200 and audit row.
- **Impact if wrong:** Maker approves own submission or overrides another officer: segregation-of-duties breach.
- **Web change if wrong:** Hide Approve/Return/Reject unless task.assignee==me (or unclaimed after Claim) and submitter!=me; map 403/409 codes to specific messages in TaskActions.tsx.
