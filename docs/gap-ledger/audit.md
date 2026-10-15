# Detailed gap file — module `audit`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 64, BACKEND-VERIFY 11, CANNOT-VERIFY 1



---
## /audit  —  `audit/home.html`

- **Source:** `apps/web/src/app/(app)/audit/page.tsx`
- **Design reference:** `redesign/audit/home.html`

### GAP-AUDIT-HOME-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** A tenant with zero audit events renders as a fetch failure: mapAuditRows returns null on an empty array (loaders.ts:432) so apiClient.ts:155-158 sets source "error"; badge says “Couldn't load — showing nothing”. No EmptyState exists in page.tsx.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:432 mapAuditRows returns null when mapped is empty (also when every row lacks actor/action, :429), and apiClient.ts:155-158/164-167 converts null to source 'error'. audit/page.tsx has no error or empty branch (:37 badge only, table always rendered) so an empty tenant sees 'Couldn't load — showing nothing' (DataSourceBadge.tsx:71). Same pattern as GAP-AUDIT-CAG-02.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/page.tsx`, `apps/web/src/app/(app)/audit/AuditLogTable.tsx`
- **Fix steps:**
  1. Return [] from mapAuditRows when the payload is a valid array (null only for wrong shape); consider logging skipped rows.
  2. In page.tsx use toResourceState and render EmptyState ('No audit events yet') for empty and RefreshErrorState for error.
  3. Add tests for empty and malformed payloads.
- **Acceptance:**
  - Empty API list -> EmptyState, no error badge.
  - Payload {} -> error state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-CAG-02

### GAP-AUDIT-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED (was FAILMASK)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** “Policy Alerts” is the failures count repeated (page.tsx:35: failures > 0 ? failures : 0) — a fourth KPI that carries no new information and is not a policy signal.
- **Verified evidence:** audit/page.tsx:35 value={failures > 0 ? failures : 0} is just failures, duplicating the Failures tile at :34; there is no policy-alert data. Theme is not FAILMASK.
- **Files to change:** `apps/web/src/app/(app)/audit/page.tsx`
- **Fix steps:**
  1. Remove the Policy Alerts tile, or source it from a real policy-service alert count (endpoint not visible; needs decision).
  2. If removed, switch the grid to g-3.
- **Acceptance:**
  - Grid shows Total, Success, Failures only.
  - Or tile value differs from Failures when policy alerts exist.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme COLUMNS (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Log has no timestamp, IP or event id column — an audit log without “when” cannot support an investigation (AuditLogTable.tsx:19-31).
- **Verified evidence:** AuditLogTable.tsx:18-30 columns are Actor, Action, Target, Result only. mapAuditRows (apps/web/src/app/_data/loaders.ts:415-431) discards any timestamp/id/IP even if the API sends them, and AuditRowSummary has four fields. Also outcome defaults to 'success' when unknown (:424-428). Whether /api/audit/events returns timestamp/ip/id cannot be verified.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/AuditLogTable.tsx`, `packages/types AuditRowSummary (absent)`
- **Fix steps:**
  1. Confirm event fields (createdAt, ip, id, correlationId) with audit-service.
  2. Extend AuditRowSummary and mapAuditRows to keep id and timestamp (and ip if permitted).
  3. Add When column (formatIndianDateTime, default sort desc) and Event id to AuditLogTable; use exportable if needed.
  4. Map unknown outcome to 'unknown' instead of success.
- **Acceptance:**
  - Test: mapper keeps timestamp.
  - Table shows When column sorted newest first.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: audit view must not mislead; IP display is PII, gate by role.

### GAP-AUDIT-HOME-04  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Fetch failure leaves KPIs at 0 (page.tsx:9-12 has no errored branch, unlike cag/vigilance) — silent all-zero dashboard with only a small badge.
- **Verified evidence:** audit/page.tsx:8-12 computes KPIs from auditItems with no errored branch (unlike cag/page.tsx:11-16); on error data=[] so tiles show 0 and only DataSourceBadge (:37) appears, the table renders empty.
- **Files to change:** `apps/web/src/app/(app)/audit/page.tsx`
- **Fix steps:**
  1. Use toResourceState; if error, render '—' in all StatCards and RefreshErrorState instead of the table.
  2. Share the pattern with cag/page.tsx.
- **Acceptance:**
  - Error source -> tiles '—' and error card.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-HOME-01

### GAP-AUDIT-HOME-05  ·  LOW  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Breadcrumb “Audit” links to /audit/dashboard while the module’s landing route is /audit (page.tsx:16); sidebar and breadcrumb disagree on home.
- **Verified evidence:** audit/page.tsx:17 breadcrumb 'Audit' links to /audit/dashboard while the current page (/audit, Event Log) is also the sidebar target (Sidebar.tsx:115). Same issue as GAP-AUDIT-DASHBOARD-03.
- **Files to change:** `apps/web/src/app/(app)/audit/page.tsx`
- **Fix steps:**
  1. Apply the module-home decision from GAP-AUDIT-DASHBOARD-03 to this breadcrumb.
  2. Use a shared AuditBreadcrumb component.
- **Acceptance:**
  - Breadcrumb parent matches sidebar target.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-AUDIT-DASHBOARD-03

### GAP-AUDIT-HOME-06  ·  LOW  ·  partly  ·  theme PII

- [ ] **Status** (W2 audit: INTERIM, needs owner decision. Not changed: actor identity is the core content of an audit log and the page is role-gated; the ledger step is a documented lawful basis plus security-review sign-off, which only the owner can record. Related pending owner question: who the tenant-admin audit page is for (audit-service /v1/audit/events currently allows audit_officer, audit_admin, super_admin, platform_admin only; not changed by W2))
- **First-pass claim:** Actor shown as raw email/name string; no masking for DPDP (mapAuditRows loaders.ts:420).
- **Verified evidence:** Confirmed: apps/web/src/app/_data/loaders.ts:420 maps actor to raw string/email/name and AuditLogTable.tsx:19 prints it. But the page is role-gated (audit/layout.tsx:5) and actor identity is the core content of an audit log, so masking would defeat the purpose; DPDP concern applies mainly to export/IP/user-agent (see EXPORTS-02). Low severity.
- **Files to change:** `apps/web/src/app/(app)/audit/AuditLogTable.tsx`
- **Fix steps:**
  1. Do not mask actor for authorised audit roles; document the lawful basis.
  2. Optionally show display name with email in title attribute, and hide IP behind role check when added (HOME-03).
- **Acceptance:**
  - Security review sign-off recorded.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Masking would impair investigations.
- **Depends on:** GAP-AUDIT-HOME-03


---
## /audit/cag  —  `audit/cag.html`

- **Source:** `apps/web/src/app/(app)/audit/cag/page.tsx`
- **Design reference:** `redesign/audit/cag.html`

### GAP-AUDIT-CAG-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED (was OTHER)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: cag/page.test.tsx 'GAP-AUDIT-CAG-01: KPIs are 3 paragraphs / 1 settled / 2 pending from real statuses'; loaders.cag.test.ts 'does not fabricate per-row totalParas/settled/pending')
- **First-pass claim:** Each API row is mapped to totalParas: 1, settled 0|1, pending 1|0 (loaders.ts:4015-4017), so Total Paras/Settled/Pending columns are constants and the KPI “Total Paras” equals the row count; the “totals per report” the UI implies are never real.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:4015-4017 hard-codes totalParas:1, settled = status==='settled'?1:0, pending = the inverse for every API row. cag/page.tsx:13-15 sums those, so Total Paras KPI == row count and the CagTable columns Total Paras/Settled/Pending (CagTable.tsx:23-25) are 1/0 or 0/1 per row. Whether the API returns real per-report totals cannot be seen (audit-service and @civitasone/types absent).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/cag/page.tsx`, `apps/web/src/app/(app)/audit/cag/CagTable.tsx`
- **Fix steps:**
  1. In getCagParas mapResponse, stop fabricating totals: either drop totalParas/settled/pending from the mapped row or map them from real API fields once the audit-service para/report contract confirms them.
  2. Until then remove the three per-row count columns from CagTable columns[] (CagTable.tsx:23-25); keep Report Year, Para No., Department, Status.
  3. In page.tsx compute KPIs from row status (Total = paras.length, Settled = count status==='settled', Pending = the rest) and relabel Total Paras as 'Paragraphs'.
  4. If per-report aggregates are wanted, add a report-level aggregate to the audit paras API and a grouped view.
- **Acceptance:**
  - Component test: 3 rows (settled, replied, open) -> KPIs 3/1/2 and no constant 1/0 columns.
  - Manual: /audit/cag shows no per-row 1/0 counts.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only. Decision needed on whether the backend has report-level totals.
- **Depends on:** GAP-AUDIT-CAG-04

### GAP-AUDIT-CAG-02  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: loaders.cag.test.ts 'GAP-AUDIT-CAG-02: a valid but EMPTY array is an empty register, not an error'; cag/page.test.tsx 'a valid empty list shows the honest empty state')
- **First-pass claim:** Empty list → mapResponse returns null (loaders.ts:4021) → source "error"; the “No CAG paragraphs found” EmptyState (page.tsx:40-47) can never render and a tenant with no paras sees an outage message.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:4021 returns null when mapped.length===0 (also when input array is empty), and apiClient.ts:155-158/164-167 turns null into source 'error'. page.tsx:33-38 then renders RefreshErrorState, so the EmptyState at page.tsx:39-46 is unreachable; an empty tenant sees a load-failure message. (The fix text about '—' KPIs is already done: page.tsx:27-30.) The same 'empty -> null' pattern is repeated in ~17 mappers in loaders.ts (e.g. 432, 448, 469).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/cag/page.tsx`
- **Fix steps:**
  1. In getCagParas mapResponse return null only when getArrayPayload(p) is null (wrong shape); return the mapped array even when empty.
  2. Do the same in mapAuditRows (see GAP-AUDIT-HOME-01) and, as a shared fix, add a helper (e.g. mapList) in loaders.ts that returns [] for a valid empty array.
  3. Keep page.tsx as is; the EmptyState branch becomes reachable via toResourceState 'ready' + length check (use toResourceState(result) status 'empty' rather than paras.length).
- **Acceptance:**
  - Unit test: mapResponse([]) and mapResponse({data:[]}) yield [] and source 'api'.
  - Manual with empty API: /audit/cag shows 'No CAG paragraphs found', not the load error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low. Real malformed payloads must still error; only valid empty arrays change.
- **Depends on:** GAP-AUDIT-HOME-01

### GAP-AUDIT-CAG-03  ·  MEDIUM  ·  partly  ·  theme STATUS

- [x] **Status** (W2 audit: closed by #2058. loaders.ts maps an unmodelled/missing para status to 'unknown' with rawStatus kept; CagTable shows humanized raw text (neutral pill); Pending excludes unknown. Tests: loaders.cag.test.ts 'an unmodelled status becomes unknown with the raw value kept', cag/CagTable.test.tsx 'an unmodelled status xyz renders Xyz', cag/page.test.tsx 'an unknown-status para is counted in Paragraphs but not guessed into Pending or Settled'. Backend enum for paras (draft/issued/replied/settled/pending_recovery/closed) confirmed in audit-service para/schema.ts)
- **W0-10 note:** review found the W0 tick partly — StatusPill tones added, but unknown API status still collapses to "Under Review" (loaders.ts:5353-5357 default "under_review") instead of humanized raw text; no unknown-status test (acceptance 'xyz' -> 'Xyz')
- **First-pass claim:** Status mapping collapses API values: “replied” → Partially Settled, “pending_recovery” → Nearly Settled, all others (including unknown) → Under Review (loaders.ts:4009-4013) — status text is inferred, not stated by the backend.
- **Verified evidence:** Mapping is real but line refs are off: apps/web/src/app/_data/loaders.ts:4004-4008 maps settled and closed -> settled (the observation omits 'closed'), replied -> partially_settled, pending_recovery -> nearly_settled, everything else -> under_review. CagTable.tsx:7-12,26 labels them and passes the label to StatusPill, but StatusPill STATUS_MAP has only 'under review' (warn); 'Settled', 'Partially Settled', 'Nearly Settled' fall to the neutral 'info' tone, so a settled para is not green. Unknown backend statuses silently become Under Review.
- **Files to change:** `apps/web/src/app/_components/ds/StatusPill.tsx`, `apps/web/src/app/(app)/audit/cag/CagTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add 'settled':'good', 'partially settled':'warn', 'nearly settled':'warn' to STATUS_MAP in StatusPill.tsx.
  2. In CagTable pass status label via StatusPill's label prop with a normalized key.
  3. In getCagParas keep the raw API status alongside the mapped one (or type-check against the API enum) and show unknown values as their humanized raw text instead of 'Under Review'.
- **Acceptance:**
  - Component test: settled row renders pill.good; unknown status 'xyz' renders 'Xyz' not 'Under Review'.
  - Confirm the API status enum with audit-service owners.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low; StatusPill is shared, adding keys only affects those exact strings.

### GAP-AUDIT-CAG-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: CagTable.test.tsx 'a row with no department/report year renders —'; loaders.cag.test.ts 'a missing reportYear/department becomes null'; cag/page.test.tsx 'Departments counts a shared department once and ignores a missing one' (added in #2058))
- **First-pass claim:** department falls back to deptRef and reportYear to sourceRef (loaders.ts:4005-4006): raw reference ids can reach the user; Departments KPI counts "" as a department.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:4002-4003 (not 4005-4006): reportYear = row.reportYear ?? row.sourceRef ?? '' and department = row.department ?? row.deptRef ?? ''. Raw reference ids can show in the Report Year / Department cells; page.tsx:16 counts new Set(department).size so '' counts as a department.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/cag/page.tsx`, `apps/web/src/app/(app)/audit/cag/CagTable.tsx`
- **Fix steps:**
  1. Do not fall back to sourceRef/deptRef for display; map missing values to null/'—' (change CagParaSummary fields to string|null or use '—').
  2. In page.tsx:16 filter falsy departments before building the Set.
  3. Optionally resolve deptRef to a department name via the existing department loader.
- **Acceptance:**
  - Unit test: row with only deptRef renders '—' and Departments KPI ignores it.
  - Two rows with the same department count once.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; may reveal rows lacking department data.
- **Depends on:** GAP-AUDIT-CAG-01

### GAP-AUDIT-CAG-05  ·  MEDIUM  ·  partly  ·  theme LOADING (was FABRICATED)

- [x] **Status** (W0 2026-10-13 closed by #1872, verified on main 5a8bec9cc; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx is one bare box (cag/loading.tsx:1-3) — no header/KPI/table placeholders, unlike audit/loading.tsx; layout jumps on load.
- **Verified evidence:** cag/loading.tsx:1-3 is a single <div class='skeleton'> versus audit/loading.tsx:12-40 which draws breadcrumb, header, 4 KPI cards and table rows. Real but cosmetic (layout shift); theme is not FABRICATED. Vigilance/investigation have their own loading.tsx files (not checked line by line).
- **Files to change:** `apps/web/src/app/(app)/audit/cag/loading.tsx`, `apps/web/src/app/(app)/audit/loading.tsx`
- **Fix steps:**
  1. Extract the Bar/shimmer skeleton from audit/loading.tsx into a shared AuditListSkeleton (audit/_components/AuditListSkeleton.tsx).
  2. Render it from cag/loading.tsx (and vigilance/investigation if they are also bare).
- **Acceptance:**
  - Throttle network in browser: /audit/cag shows header, 4 KPI and table placeholders, no jump on load.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AUDIT-CAG-06  ·  LOW  ·  confirmed  ·  theme PROVENANCE (was FABRICATED)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: CagTable.test.tsx 'GAP-AUDIT-CAG-06: cached provenance shows the saved-data badge with its timestamp')
- **First-pass claim:** No DataSourceBadge / provenance chip on the page even though CagTable seeds from cache (CagTable.tsx:17 useSeededResource) — cached rows are not labelled.
- **Verified evidence:** CagTable.tsx:15 destructures only { data } from useSeededResource and renders no DataSourceBadge (compare ModuleListTable.tsx which passes provenance/cachedAt/offline). Additionally page.tsx:33-38 renders RefreshErrorState instead of CagTable when the server load fails, so the cache fallback in useSeededResource can never surface; the cache seeding is effectively dead on this page.
- **Files to change:** `apps/web/src/app/(app)/audit/cag/CagTable.tsx`, `apps/web/src/app/(app)/audit/cag/page.tsx`
- **Fix steps:**
  1. In CagTable destructure { data, provenance, cachedAt, offline } and render <DataSourceBadge provenance={provenance ?? 'live'} cachedAt={cachedAt} offline={offline} /> above the DataTable.
  2. In page.tsx, when errored render CagTable (rows=[], source='error') so cached data can show with the 'cached' badge, falling back to RefreshErrorState only when no cache; or remove useSeededResource if offline is not required.
- **Acceptance:**
  - Component test: provenance 'cached' shows the cached badge with timestamp.
  - Manual: offline reload of /audit/cag shows cached rows labelled as saved.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low. Showing cached audit data must be labelled clearly.


---
## /audit/compliance  —  `audit/compliance.html`

- **Source:** `apps/web/src/app/(app)/audit/compliance/page.tsx`
- **Design reference:** `redesign/audit/compliance.html`

### GAP-AUDIT-COMPLIANCE-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** CERT-In tile shows “Compliant” whenever overdue === 0 (page.tsx:55), including on fetch failure or zero items where all counts are 0 — a false compliance assertion on a regulatory screen.
- **Verified evidence:** compliance/page.tsx:49 (not 55): value={overdue === 0 ? 'Compliant' : 'Review'} with up={overdue===0}. The stats at :23-27,47-50 are computed before the errored check (:21,53), so on fetch failure items=[] gives 'Compliant', '0%', '0 / 0' while the error card shows below. Same for an empty tenant.
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/page.tsx`
- **Fix steps:**
  1. Use toResourceState(await getAuditCompliance()); when status is 'error' or total===0 render '—' for all four StatCards.
  2. Set CERT-In tile value to 'Compliant' only when total>0 and overdue===0; otherwise 'No data'/'—'.
  3. Drop the DataSourceBadge at :52 in favour of the RefreshErrorState already rendered.
- **Acceptance:**
  - Test: items=[] and source 'error' -> CERT-In tile shows '—' not 'Compliant'.
  - Test: 3 complied, 0 overdue -> 'Compliant'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Regulatory: a false 'Compliant' is the main risk being removed.

### GAP-AUDIT-COMPLIANCE-02  ·  HIGH  ·  partly  ·  theme EXPORT (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Generate Report is a client-side JSON blob of the loaded rows, not a signed server artifact (GenerateReportButton.tsx:8-13 note; download at :34-40). No audit event, no signature, no confirmation, and it leaves the browser with any PII in the rows — while /audit/exports offers the signed WORM pipeline.
- **Verified evidence:** GenerateReportButton.tsx:8-13 documents that audit-service has no report endpoint; :17-41 builds a JSON blob of items client-side and downloads it with no confirmation, no audit event and no signature (the file itself says so in its 'note'). True. Overstated PII claim: the rows are AuditComplianceItem (lawOrRule, section, requirement, dueDate, department, status per page.tsx:9-17), i.e. policy metadata, not personal data; full type is in the absent @civitasone/types. /audit/exports has the signed pipeline (ExportConsole).
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/GenerateReportButton.tsx`, `(backend) audit-service compliance report job`
- **Fix steps:**
  1. Short term: wrap in ActionButton with confirmTitle explaining the file is an unsigned snapshot and rename the button 'Download snapshot (unsigned)'.
  2. Emit an audit event for the download by POSTing to an existing audit-event endpoint if one exists (none visible; otherwise backend work).
  3. Long term: add a compliance-scoped job type to the exports pipeline and have this button create it via ExportConsole's flow.
- **Acceptance:**
  - Clicking shows a confirm dialog naming 'unsigned'.
  - After backend job exists, download is signed and verifiable.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Compliance evidence produced without provenance may be relied on by auditors.
- **Depends on:** GAP-AUDIT-EXPORTS-01

### GAP-AUDIT-COMPLIANCE-03  ·  MEDIUM  ·  confirmed  ·  theme DATAINTEGRITY (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Card split is a substring heuristic: lawOrRule containing “dpdp”/“data” vs “cert”/“iso”/“ntp”; if neither matches it slices the list in halves (page.tsx:30-33). An item can appear in both cards and the “DPDP” card is titled generically “Compliance requirements”.
- **Verified evidence:** compliance/page.tsx:29-32: dpdpItems = lawOrRule contains 'dpdp' or 'data'; certItems = contains 'cert','iso' or 'ntp'; each side independently falls back to a half-slice of the whole list when empty. An item matching both (e.g. 'Data ... ISO 27001') appears in both cards; 'iso' also matches unrelated words; if only one side matches the other shows a half slice that may duplicate. Card title at :58 is generic 'Compliance requirements' though variant is dpdp. Not a PII issue.
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/page.tsx`, `apps/web/src/app/(app)/audit/compliance/ComplianceTable.tsx`
- **Fix steps:**
  1. Group by a backend category field if the API has one (cannot verify); otherwise partition once: an item goes to the first matching bucket only, unmatched to 'Other', with no half-slice fallback.
  2. Rename card titles to 'DPDP Act requirements' and 'Regulatory & govt policy'.
  3. Extract the partition into a pure helper with unit tests.
- **Acceptance:**
  - Test: item 'DPDP Data ISO' appears in exactly one card.
  - Test: no item duplicated across cards; unmatched items land in 'Other'.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; changes which table shows which control.

### GAP-AUDIT-COMPLIANCE-04  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** “6-hr reporting” delta and up flag are hard-coded copy (page.tsx:55), not data; Compliance Score counts only status==="complied" so “planned” items depress it while Open Actions (pending + overdue, page.tsx:56) excludes them.
- **Verified evidence:** compliance/page.tsx:49 hard-codes delta='6-hr reporting' and up={overdue===0} (copy, not data). Score (:27) = complied/total where total includes 'planned' and any other status; Open Actions (:50) = pending+overdue, excluding planned, so the two KPIs use different denominators. Line refs in the observation (55/56) are off.
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/page.tsx`
- **Fix steps:**
  1. Remove delta/up from the CERT-In StatCard or replace with a real value (e.g. overdue count).
  2. Define one status model: score = complied/(complied+pending+overdue) or explicitly show 'x planned'; add a planned count as a helper text.
  3. Compute counts in one helper shared with GenerateReportButton (it duplicates the logic at :18-28).
- **Acceptance:**
  - Test: 2 complied, 1 planned -> score and Open Actions consistent with the documented formula.
  - CERT-In tile has no static '6-hr' delta.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Medium: KPI definition change is visible to auditors.
- **Depends on:** GAP-AUDIT-COMPLIANCE-01

### GAP-AUDIT-COMPLIANCE-05  ·  MEDIUM  ·  confirmed  ·  theme COLUMNS (was PII)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Due dates are shown only on the DPDP table; overdue items in the regulatory table show no due date (ComplianceTable.tsx:63-73).
- **Verified evidence:** ComplianceTable.tsx:42-46 adds a Due column only for variant 'dpdp'; the cert variant (:58-76) has Law, Requirement, Dept, Status only, so overdue regulatory items show no due date even though every row has dueDate (page.tsx:9-17). Not PII.
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/ComplianceTable.tsx`
- **Fix steps:**
  1. Add the Due column (formatIndianDate(item.dueDate)) to the cert variant, ideally before Status.
  2. Add Section to the cert law column as done for dpdp (:38).
  3. Optionally style overdue due dates with the bad tone.
- **Acceptance:**
  - Component test: cert table header includes 'Due'.
  - Overdue row shows its due date.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-AUDIT-COMPLIANCE-06  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Toast is position:fixed bottom-right, 5 s, no dismiss (GenerateReportButton.tsx:44-48).
- **Verified evidence:** GenerateReportButton.tsx:46-50: span with position:fixed bottom/right 18, zIndex 100, cleared by setTimeout 5000 (:40); no close control and the timeout is not cleared on unmount. It is role='status' aria-live polite, so screen readers do get it. Also hard-coded inline style rather than a shared toast.
- **Files to change:** `apps/web/src/app/(app)/audit/compliance/GenerateReportButton.tsx`
- **Fix steps:**
  1. Use the app's shared toast/notification component if one exists in ds (else create ds/Toast) with a dismiss button.
  2. Track the timer in a ref and clear it on unmount.
- **Acceptance:**
  - Toast can be dismissed with click and Escape.
  - No state update after unmount.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /audit/dashboard  —  `audit/dashboard.html`

- **Source:** `apps/web/src/app/(app)/audit/dashboard/page.tsx`
- **Design reference:** `redesign/audit/dashboard.html`

### GAP-AUDIT-DASHBOARD-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** On fetch failure the page renders AUDIT_DASHBOARD_EMPTY zeros and “Compliance 0.0%” (loaders.ts:3917-3922, page.tsx:36) with only a small badge — an outage reads as a zero-compliance department.
- **Verified evidence:** apps/web/src/app/_data/loaders.ts:3916-3921 defines AUDIT_DASHBOARD_EMPTY (all 0) as the fetch fallback. dashboard/page.tsx:28-31 renders those zeros and `${data.compliancePct.toFixed(1)}%` -> '0.0%' (line 31, not 36) unconditionally; page.tsx:33 shows only a small DataSourceBadge on error. No error.tsx in dashboard/ (audit/error.tsx catches throws only).
- **Files to change:** `apps/web/src/app/(app)/audit/dashboard/page.tsx`
- **Fix steps:**
  1. Wrap result with toResourceState; when 'error' render '—' in all four StatCards and a RefreshErrorState (toHumanError('load',{area:'audit dashboard'})) above Quick links.
  2. Keep Quick links rendered so navigation works during an outage.
- **Acceptance:**
  - Test: source 'error' -> no '0.0%' text, RefreshErrorState visible.
  - Live zero data still shows '0.0%'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-DASHBOARD-02  ·  MEDIUM  ·  confirmed  ·  theme NAVUX (was OTHER)

- [x] **Status** (W0 2026-10-13 PROVISIONAL — re-confirm in this module's next wave PR: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Quick links omit CAG Audit, Vigilance and Investigation (page.tsx:6-13) — those are only reachable from the Event Log sub-nav (audit/page.tsx:21-25); the dashboard is not a full index of the module.
- **Verified evidence:** dashboard/page.tsx:6-13 QUICK_LINKS has 6 entries (Observations, Risk Register, Audit Plan, Compliance, Event Log, Export Jobs); CAG Audit, Vigilance, Investigation are only linked from audit/page.tsx:21-25. Sidebar.tsx:115 has just one Audit entry.
- **Files to change:** `apps/web/src/app/(app)/audit/dashboard/page.tsx`
- **Fix steps:**
  1. Add CAG Audit (/audit/cag), Vigilance (/audit/vigilance), Investigation (/audit/investigation) to QUICK_LINKS.
  2. Better: export one AUDIT_SECTIONS constant used by both dashboard quick links and the audit/page.tsx sub-nav.
- **Acceptance:**
  - Dashboard shows 9 links, all resolve (200).
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.
- **Depends on:** GAP-AUDIT-DASHBOARD-03

### GAP-AUDIT-DASHBOARD-03  ·  MEDIUM  ·  confirmed  ·  theme NAVUX

- [x] **Status** (W2 audit: closed by #2058. exports, observations list, observation detail, plan and risk-register pages now use AuditBreadcrumb, so every 'Audit' crumb goes to AUDIT_HOME (/audit, same as the sidebar). Tests: _components/AuditBreadcrumb.test.tsx, observations/page.test.tsx, observations/[id]/page.test.tsx, plan/page.test.tsx, risk-register/page.test.tsx (each asserts Audit crumb href=/audit))
- **First-pass claim:** The sidebar “Audit” entry lands on /audit (Event Log) while every sub-page breadcrumb points to /audit/dashboard (e.g. compliance/page.tsx:39) — two competing homes.
- **Verified evidence:** Sidebar.tsx:115 links Audit to /audit (Event Log; also GlobalSearch.tsx:75, dashboard/page.tsx of app). Breadcrumb 'Audit' links to /audit/dashboard in compliance/page.tsx:37 (not 39), audit/page.tsx:17, exports/page.tsx:17 and legal/cases/[id]/not-found.tsx:11. Two homes.
- **Files to change:** `apps/web/src/app/_components/ds/Sidebar.tsx`, `apps/web/src/app/_components/GlobalSearch.tsx`, `apps/web/src/app/(app)/audit/page.tsx`, `apps/web/src/app/(app)/audit/compliance/page.tsx`, `apps/web/src/app/(app)/audit/exports/page.tsx`
- **Fix steps:**
  1. Decide the module home (recommend /audit/dashboard as overview, Event Log at /audit/events or stays /audit).
  2. Point Sidebar.tsx:115, GlobalSearch.tsx:75 and all breadcrumbs to the same route.
  3. Centralise as AUDIT_HOME constant; audit/page.tsx breadcrumb should not link to itself as parent.
- **Acceptance:**
  - Click sidebar Audit and any breadcrumb 'Audit' -> same page.
  - No page's parent breadcrumb points to itself.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; deep links to /audit stay valid.
- **Depends on:** GAP-AUDIT-HOME-05

### GAP-AUDIT-DASHBOARD-04  ·  MEDIUM  ·  partly  ·  theme NAVUX

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** Dashboard breadcrumb has no “Audit” parent and no back link; the counts are not links to their lists (Open Observations does not open /audit/observations?status=open).
- **Verified evidence:** dashboard/page.tsx:20-22 breadcrumb contains only the current page 'Audit Dashboard' and PageHeader has no back prop (PageHeader supports back/backLabel). True. StatCard (StatCard.tsx:4-27) has no href prop and audit/observations/page.tsx computes status counts client-side with no searchParams, so a ?status=open link would currently do nothing.
- **Files to change:** `apps/web/src/app/_components/ds/StatCard.tsx`, `apps/web/src/app/(app)/audit/dashboard/page.tsx`, `apps/web/src/app/(app)/audit/observations/page.tsx`
- **Fix steps:**
  1. Add optional href to StatCard (wrap in Link) or wrap cards in Link on the dashboard.
  2. Read searchParams.status in observations/page.tsx and pre-filter/pass initial filter to ObservationsTable.
  3. Add 'Audit' parent link to the breadcrumb of the dashboard per the module-home decision.
- **Acceptance:**
  - Clicking Open Observations lands on /audit/observations?status=open with only open rows.
  - Card is keyboard focusable.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-DASHBOARD-03


---
## /audit/exports  —  `audit/exports.html`

- **Source:** `apps/web/src/app/(app)/audit/exports/page.tsx`
- **Design reference:** `redesign/audit/exports.html`

### GAP-AUDIT-EXPORTS-01  ·  HIGH  ·  partly  ·  theme ENDPOINT (was PII)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: ExportConsole.test.tsx 'POSTs the create to /api/proxy/v1/audit/exports and reads data.id')
- **First-pass claim:** Generate posts to /api/proxy/audit/exports (ExportConsole.tsx:127) while every other call uses /api/proxy/v1/audit/… (lines 91, 168, 301) — the v1 segment is missing; either the create route differs from the list/poll routes or the export cannot be created. Cannot be determined without audit-service.
- **Verified evidence:** Confirmed inconsistency: ExportConsole.tsx:127 POSTs /api/proxy/audit/exports while :91, :168, :301 and loaders.ts:3979 use /v1/audit/exports. The catch-all proxy (api/proxy/[...path]/route.ts:36-41) just forwards to <gateway>/api/<subpath>, so create hits /api/audit/exports and list/poll hit /api/v1/audit/exports. loaders.ts:691 also GETs /api/audit/events without v1, so the gateway may alias both, but audit-service and gateway routes are not in the snapshot. Related mismatch: create reads body.id at top level (:136) whereas poll reads body.data (:96). Theme is not PII.
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx`
- **Fix steps:**
  1. Confirm the create route with the gateway/audit-service (POST /api/v1/audit/exports?).
  2. Change the fetch at ExportConsole.tsx:127 to /api/proxy/v1/audit/exports.
  3. Read the id as (body.data?.id ?? body.id) after confirming the envelope.
  4. Add a test with a mocked fetch asserting URL and envelope.
- **Acceptance:**
  - Generate export -> job appears and polling reaches 'completed' against a real gateway.
  - Unit test asserts POST path /api/proxy/v1/audit/exports.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low if the alias exists; otherwise this is a broken feature for signed regulator exports.

### GAP-AUDIT-EXPORTS-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** PII columns (IP, user-agent, before/after values) are offered to every role that reaches the page; only a caption says the audit-admin check is server-side (ExportConsole.tsx:219-225). No client role gate, and the confirm dialog names PII but does not ask for a reason (unlike observation actions with requireReason).
- **Verified evidence:** ExportConsole.tsx:219-225 shows the includePii checkbox to everyone; caption says 'requires an audit-admin role; honoured server-side'. audit/layout.tsx:5 lets audit_officer, finance_admin, dept_head in too. Confirm dialog (:227-240) names PII but ActionButton is not given requireReason (supported: ActionButton.tsx onConfirm(reason), requireReason). generate() ignores any reason and does not send one.
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx`, `apps/web/src/app/(app)/audit/exports/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. In page.tsx (server) compute canExportPii = getSessionRoles() includes audit_admin/platform_admin/super_admin and pass to ExportConsole.
  2. Disable or hide the PII checkbox unless canExportPii, with tooltip explaining why.
  3. Add requireReason (min length) on the ActionButton when includePii is true and send reason in the POST body once the backend accepts it (backend field needs confirming).
  4. Keep the server-side enforcement as authority.
- **Acceptance:**
  - audit_officer sees PII checkbox disabled.
  - With includePii the dialog demands a reason and blocks empty.
  - Backend audit event records the reason (backend check).
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** High sensitivity: PII exports; UI gating is advisory only, server check must stay.
- **Depends on:** GAP-AUDIT-EXPORTS-01

### GAP-AUDIT-EXPORTS-03  ·  MEDIUM  ·  confirmed  ·  theme ACTIONS (was PII)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: ExportsTable.test.tsx 'shows Verify only on completed rows'; ExportConsole.recheck.test.tsx 'EXPORTS-03: verifying a completed export shows the integrity-verified result' (added in #2058))
- **First-pass claim:** Footer tells users to “Use Verify integrity to re-validate an artifact” (page.tsx:39) but Verify exists only for the single Current job; rows in Recent exports have Download only (ExportsTable.tsx:40-47).
- **Verified evidence:** exports/page.tsx:39 footer says to use Verify integrity to re-validate an artifact; ExportsTable.tsx:18-46 has only a Download column, no verify. runVerify exists only inside ExportConsole for the current job (:163-186, button :309).
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportsTable.tsx`, `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx`, `apps/web/src/app/(app)/audit/exports/page.tsx`
- **Fix steps:**
  1. Extract runVerify + result panel from ExportConsole into a reusable VerifyButton/VerifyResult component taking jobId.
  2. Add a Verify action to completed rows in ExportsTable (GET /api/proxy/v1/audit/exports/:id/verify).
  3. Until then reword the footer.
- **Acceptance:**
  - Completed row in Recent exports has Verify; result shows hash/signature match.
  - Failed/queued rows have no Verify.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-AUDIT-EXPORTS-04  ·  MEDIUM  ·  partly  ·  theme COLUMNS (was PII)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: ExportsTable.test.tsx 'renders distinguishing columns so same-day exports differ' and 'builds the download href through the tokenised proxy')
- **First-pass claim:** Recent exports rows show jobType and date only — no id, window, row count, PII flag or requester — so two exports on the same day cannot be told apart; Download uses a raw downloadUrl (ExportsTable.tsx:42) whereas the console uses a tokenised proxy link (:301).
- **Verified evidence:** ExportsTable.tsx:18-46 shows jobType, requested date, format pill, status and download (five columns), so the 'jobType and date only' description is overstated. It has no id, window, row count, PII flag or requester, so same-day exports are hard to tell apart. Download is the raw item.downloadUrl (:43, not :42) whereas ExportConsole uses /api/proxy/v1/audit/exports/:id/download?token=... (:301). What downloadUrl contains (AuditExportJob type) cannot be seen.
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportsTable.tsx`
- **Fix steps:**
  1. Add columns Job id (short), Window, Rows, PII yes/no, Requested by, Requested time, if present on AuditExportJob (verify type).
  2. Build the download href the same way as ExportConsole via a shared helper using the tokenised proxy URL.
  3. Use full date-time (see EXPORTS-05).
- **Acceptance:**
  - Two same-day exports are distinguishable.
  - Download from the table uses the proxy URL with token.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Medium: raw downloadUrl may bypass the requester/PII check.
- **Depends on:** GAP-AUDIT-EXPORTS-05

### GAP-AUDIT-EXPORTS-05  ·  MEDIUM  ·  partly  ·  theme TIME (was PII)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: ExportConsole.test.tsx 'resumes polling from sessionStorage on mount'; ExportConsole.recheck.test.tsx 'EXPORTS-05: starting job B after job A keeps B polling past A's 120s safety timer' (added in #2058))
- **First-pass claim:** Requested shows a date without time (formatIndianDate); polling state is lost on reload — a running job disappears from “Current job” (ExportConsole.tsx state is local).
- **Verified evidence:** Date-only: ExportsTable.tsx:20 and ExportConsole.tsx:283,291 use formatIndianDate (date, no time). Job state is local useState (ExportConsole.tsx:63) so a reload clears Current job, but a running job still appears in Recent exports (server list, status Generating) though that list is not polled. Extra bug: the 120 s safety timer at :117 is never cleared, so a stale timer can stop polling of a later job.
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx`, `apps/web/src/app/(app)/audit/exports/ExportsTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime to formatters.ts and use it for requested/signed times.
  2. Persist the current job id in sessionStorage (try/catch) or a ?job= query param and resume polling on mount.
  3. Store the safety timeout in a ref and clear it in stopPolling.
- **Acceptance:**
  - Reload during a running job resumes Current job.
  - Start job A then job B: A's timer does not stop B's polling.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-AUDIT-EXPORTS-06  ·  LOW  ·  confirmed  ·  theme THEME (was PII)

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (no hex colours remain in exports/, tokens used). Test added in #2058: exports/ExportConsole.recheck.test.tsx 'EXPORTS-06: no hard-coded hex colours remain in the exports folder sources')
- **First-pass claim:** Inline hex colours in toasts/verify panel (#abefc6, #fecdca, #f6fef9) bypass tokens and dark mode (ExportConsole.tsx:253-330).
- **Verified evidence:** ExportConsole.tsx:253 hard-codes #abefc6/#fecdca/#b2ddff and :322-323 #abefc6/#fecdca/#f6fef9/#fffbfa; also #667085 (:223,266,305) and #475467 in exports/page.tsx:39. civitas-ds.css:15-18 already defines --goodbd/--badbd/--infobd with exactly those values; #f6fef9/#fffbfa have no token (use --goodbg/--badbg).
- **Files to change:** `apps/web/src/app/(app)/audit/exports/ExportConsole.tsx`, `apps/web/src/app/(app)/audit/exports/page.tsx`
- **Fix steps:**
  1. Replace border hexes with var(--goodbd)/var(--badbd)/var(--infobd).
  2. Use var(--goodbg)/var(--badbg) for the verify panel and var(--mut)/var(--ink2) for greys.
  3. Lint: add a no-hex rule for inline styles if present.
- **Acceptance:**
  - grep shows no hex colours in the exports folder.
  - Dark mode renders readable panels.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /audit/investigation  —  `audit/investigation.html`

- **Source:** `apps/web/src/app/(app)/audit/investigation/page.tsx`
- **Design reference:** `redesign/audit/investigation.html`

### GAP-AUDIT-INVESTIGATION-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: loaders.investigation.test.ts 'a valid but EMPTY array stays source api', 'a 500 surfaces as source error', 'rows that ALL drop surface as an error'; investigation/page.test.tsx 'shows the error state')
- **First-pass claim:** Empty list → null → source "error" (loaders.ts:4078): “No investigations found” (page.tsx:40-47) is unreachable; a fresh tenant sees a failure card.
- **Verified evidence:** loaders.ts:4078 `return mapped.length > 0 ? mapped : null` (also drops rows lacking id at 4076), and apiClient.ts:162-166 turns a null map result into {source:'error'}. So a valid empty list (fresh tenant) makes page.tsx:11/33-38 render RefreshErrorState instead of the EmptyState at page.tsx:40-47, which is unreachable. The page itself already handles error correctly (RefreshErrorState, '—' KPIs, no notFound); the bug is in the loader.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/investigation/page.tsx`
- **Fix steps:**
  1. In getInvestigations mapResponse (loaders.ts ~4055-4079) return `mapped` (possibly []) whenever the payload is a valid array; return null only when getArrayPayload(p) is null or when rows.length>0 and mapped.length===0 (all rows malformed).
  2. Log/telemetry-skip individual malformed rows instead of collapsing to null.
  3. Apply the same fix to sibling audit loaders using `mapped.length>0 ? mapped : null` (getCagParas, getVigilanceCases in the same file).
  4. Keep page.tsx as is; add a page test for both branches.
- **Acceptance:**
  - Unit test: fetchJson mock returning [] -> getInvestigations gives source 'api', data [] -> page renders 'No investigations found'.
  - Mock 500 -> RefreshErrorState with retry and '—' in all four KPI cards.
  - Mock array of only id-less rows -> source 'error'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; shared loader pattern - check other pages that rely on null-for-empty to signal failure.
- **Depends on:** GAP-AUDIT-INVESTIGATION-04

### GAP-AUDIT-INVESTIGATION-02  ·  HIGH  ·  confirmed  ·  theme PII

- [ ] **Status** (W2 audit: INTERIM, needs owner decision (which roles may see subject/findings and whether CSV export is allowed at all; step 1 of the ledger). In place on main: server-side redaction in investigation/page.tsx for roles outside AUDIT_INVESTIGATION_DETAIL_ROLES, table mask, export disabled and export guard exportAudit. Tests: investigation/page.test.tsx 'does not ship raw subject/findings to a role outside the detail set', InvestigationTable.test.tsx 'masks subject/findings and hides CSV export for a non-privileged role'. Not built: an audited per-row reveal control, and backend field redaction (GET /v1/audit/investigations only role-gates; it returns clear text to every reader role))
- **First-pass claim:** Free-text findings and subject of internal investigations are shown in the table and exported to CSV for every audit-layout role (InvestigationTable.tsx:24-25, layout.tsx:5) — no masking or role gate for sensitive case content (DPDP).
- **Verified evidence:** InvestigationTable.tsx:20-23 renders `subject` and `findings` in clear text for every row and line 31 sets `exportable` so DataTable.downloadCsv (DataTable.tsx:281-289) writes all columns to a client-side CSV. Access gate is only layout.tsx:5 ALLOWED (audit_officer, audit_admin, platform_admin, super_admin, finance_admin, dept_head) - finance_admin and dept_head can read every case. No shared <Masked> exists (only local MaskedInput in hr/employees/new/steps/Step4.tsx and admin/integrations), no export audit event. Backend redaction cannot be verified (audit-service absent).
- **Files to change:** `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`, `apps/web/src/app/(app)/audit/investigation/InvestigationTable.tsx`, `apps/web/src/app/(app)/audit/investigation/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. DECISION first: which roles may see subject/findings (proposal: audit_admin, audit_officer assigned to case) and whether CSV export is allowed at all.
  2. In page.tsx call getSessionRoles() (server) and pass `canViewDetail` to InvestigationTable.
  3. Create ds/Masked.tsx (mask by default, reveal click that POSTs an audit event via the proxy) and use it in the subject and findings render fns; show '••••' for roles without reveal.
  4. Set `exportable={canExport}` and, when exporting, exclude/mask subject+findings and emit an audit event (who, when, row count) via the proxy.
  5. Backend: the investigations endpoint must redact the same fields for unauthorised roles - UI masking alone is not a control.
- **Acceptance:**
  - Component test: dept_head sees masked subject/findings and no CSV button; audit_admin sees reveal.
  - Reveal and export each create an audit record (check network call).
  - CSV downloaded by a restricted role contains no free text.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** PII/DPDP: over-masking blocks investigators; under-masking is a leak. Client mask without server redaction is cosmetic.
- **Depends on:** Masked (new shared ds component)

### GAP-AUDIT-INVESTIGATION-03  ·  MEDIUM  ·  partly  ·  theme FORMAT (was PII)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: investigation/InvestigationTable.test.tsx 'renders a formatted date, and a malformed value as its raw string, never Invalid Date' (added in #2058; format is DD Mon YYYY, sort uses the raw ISO key))
- **First-pass claim:** Started is rendered as the raw API string (loaders.ts:4069 toText, InvestigationTable.tsx:23) — no formatIndianDate, unlike compliance/exports; sorting is lexical on the raw value.
- **Verified evidence:** True that `started` is passed raw: loaders.ts:4070 `toText(row.started) ?? ''` and InvestigationTable.tsx:22 has no render fn (no formatIndianDate, which handles ISO strings, formatters.ts:2-7). Sorting is via DataTable compareValues (DataTable.tsx:160-170): string localeCompare numeric, so it is only 'lexical' - it is chronological if the API returns ISO-8601, wrong for any other format. The API date format cannot be verified (service absent). The 'fix' text on this finding (Masked/CSV) belongs to -02, not this one; theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/investigation/InvestigationTable.tsx`
- **Fix steps:**
  1. Add `render: (r) => formatIndianDate(r.started as string)` to the `started` column (import from @/lib/formatters).
  2. Keep sort on the raw ISO value; add `cellType`/csv mapping so CSV exports ISO, not dd/mm/yyyy.
  3. Confirm with backend that `started` is ISO-8601 (date or timestamp).
- **Acceptance:**
  - Component test: started '2026-03-05' renders 05/03/2026 and sorts ascending by date.
  - Malformed value renders raw string, not 'Invalid Date'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-INVESTIGATION-04  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (loader maps unmodelled status to 'unknown'). Tests: _data/loaders.investigation.test.ts 'an unknown backend status becomes unknown, NOT in_progress'; added in #2058: investigation/page.test.tsx 'Active Investigations excludes unknown-status rows but Total Cases still counts them')
- **First-pass claim:** Unknown status silently becomes in_progress (loaders.ts:4071-4073), inflating “Active Investigations”.
- **Verified evidence:** loaders.ts:4071-4074 maps any status other than in_progress/findings_submitted/closed (and missing status) to 'in_progress'; page.tsx:13 counts 'in_progress' as Active, so unknown/new backend statuses (e.g. 'on_hold', 'reopened') inflate Active Investigations and show a wrong pill.
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/investigation/InvestigationTable.tsx`, `apps/web/src/app/(app)/audit/investigation/page.tsx`
- **Fix steps:**
  1. In getInvestigations, do not coerce: skip/telemetry-flag rows with an unknown status, or widen InvestigationSummary status with an 'unknown' member (type lives in @civitasone/types, absent from snapshot).
  2. Add STATUS_LABELS entry / fallback pill 'Unknown' in InvestigationTable.tsx:7-11.
  3. Exclude 'unknown' from the Active count in page.tsx:13; consider adding it to Total only.
- **Acceptance:**
  - Loader test: status 'on_hold' does not produce 'in_progress'.
  - Page shows Active count excluding unknown-status rows.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; coordinate the status enum with backend.
- **Depends on:** GAP-AUDIT-INVESTIGATION-01

### GAP-AUDIT-INVESTIGATION-05  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [ ] **Status** (W2 audit: INTERIM, needs owner decision / backend. audit-service has only GET /v1/audit/investigations; there is no detail, assign, submit-findings or close endpoint, and no maker-checker rule defined. Inventing them in the web is unsafe, so the tracker stays display-only)
- **First-pass claim:** No case detail route or action: rows are not links and no mutation (assign, submit findings, close) exists in code — the tracker is display-only.
- **Verified evidence:** InvestigationTable.tsx:17-32 passes no rowHref or action column to DataTable; there is no app/(app)/audit/investigation/[id] route (dir contains only InvestigationTable, error, loading, page) and no fetch/POST in the folder. Only /audit/page.tsx:24 links to the list. Display-only. Backend endpoints for assign/submit/close cannot be verified.
- **Files to change:** `apps/web/src/app/(app)/audit/investigation/[id]/page.tsx (new)`, `apps/web/src/app/(app)/audit/investigation/InvestigationActions.tsx (new)`, `apps/web/src/app/(app)/audit/investigation/InvestigationTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. DECISION/backend: confirm audit-service endpoints for GET /audit/investigations/:id and assign/submit-findings/close (not visible here).
  2. Add `rowHref={(r)=>`/audit/investigation/${r.id}`}` and a detail page with a getInvestigationById loader (fetchJson + zod).
  3. Add Assign / Submit findings / Close actions using the ObservationActions.tsx pattern (ConfirmDialog requireReason, POST via /api/proxy, router.refresh()), maker!=checker on close.
  4. Hide actions by role (see OBSERVATIONS-DETAIL-02).
- **Acceptance:**
  - Clicking a row opens the case; assign/close require a reason and appear in audit trail.
  - Non-permitted role sees no action buttons.
- **Needs:** web+backend  ·  **Effort:** L >2d  ·  **Risk:** Approvals/closure of investigations is high-stakes; needs maker-checker and audit events.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-02

### GAP-AUDIT-INVESTIGATION-06  ·  LOW  ·  partly  ·  theme LOADING

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** loading.tsx is one bare box (investigation/loading.tsx); no provenance badge for cached rows.
- **Verified evidence:** loading.tsx is indeed one bare `.skeleton` div (loading.tsx:2) not matching PageHeader+4 StatCards+table. Provenance claim: InvestigationTable.tsx:14 destructures only `data` from useSeededResource and never renders DataSourceBadge with `provenance`, so cached rows would be silent - but page.tsx:33-38 renders RefreshErrorState when the server errors, so the cached fallback branch is effectively unreachable today (table only mounts on source 'api' with rows).
- **Files to change:** `apps/web/src/app/(app)/audit/investigation/loading.tsx`, `apps/web/src/app/(app)/audit/investigation/InvestigationTable.tsx`
- **Fix steps:**
  1. Rewrite loading.tsx to render PageHeader placeholder, 4 Skeleton stat blocks (ds/Skeleton.tsx) and a table skeleton.
  2. Either drop useSeededResource in InvestigationTable or render `<DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline}/>` from the same hook call, and let page.tsx pass the table on error so offline cache can be used.
- **Acceptance:**
  - Loading state visually matches final layout (no layout shift).
  - With offline cache and server error, cached badge is shown.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /audit/observations  —  `audit/observations.html`

- **Source:** `apps/web/src/app/(app)/audit/observations/page.tsx`
- **Design reference:** `redesign/audit/observations.html`

### GAP-AUDIT-OBSERVATIONS-01  ·  HIGH  ·  confirmed  ·  theme LABELS (was CONFIRM)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: severityMeta maps critical/major/minor/observation and 'high' no longer collapses to Low (unit-tested); it renders raw 'high' in a neutral pill)
- **First-pass claim:** Risk vocabularies disagree: the Log dialog offers Low/Medium/High (LogObservationButton.tsx:150-152) but the table renders critical/major as red pills showing the raw lowercase word, “minor” as “Medium” and everything else as “Low” (ObservationsTable.tsx:14-18); a “High” logged observation may display as “Low”.
- **Verified evidence:** Vocabulary mismatch verified: LogObservationButton.tsx:13,148-153 sends riskLevel low/medium/high, while ObservationsTable.tsx:12-16 riskPill treats critical|major as red pill printing the raw lowercase word, 'minor' as 'Medium', and anything else (including 'high', 'medium', 'low') as 'Low'. If the API echoes 'high' as severity a High observation renders as 'Low'. How the service maps riskLevel->severity is cannot-verify (audit-service and @civitasone/types absent). Theme CONFIRM is wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/ObservationsTable.tsx`, `apps/web/src/app/(app)/audit/observations/LogObservationButton.tsx`, `apps/web/src/lib/audit/observationLabels.ts (new)`
- **Fix steps:**
  1. Backend: confirm severity enum and mapping from riskLevel; align one vocabulary (e.g. low/medium/high/critical).
  2. Create observationLabels.ts with a single SEVERITY map -> {label, pillClass}; use it in riskPill, the detail page and the Log dialog options.
  3. Unknown severity must render neutral pill with raw text, never 'Low'.
  4. Capitalise labels (Critical/High/Medium/Low).
- **Acceptance:**
  - Unit test: each backend severity maps to expected label; 'high' does not render Low.
  - Log a High observation -> list shows High.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Misclassified audit risk affects prioritisation.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-04

### GAP-AUDIT-OBSERVATIONS-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: observations/page.test.tsx 'OBS-02: tile values equal the filtered row counts' (added in #2058); observationLabels.test.ts isOpen/isSettled/isUnderReply)
- **First-pass claim:** “Open” KPI counts status==="open" only (page.tsx:13) while the Open segment lists every non-closed row (ObservationsTable.tsx:34) — the tile and the filtered list disagree; “Settled (FY)” counts all closed rows with no fiscal-year filter (page.tsx:15).
- **Verified evidence:** page.tsx:12 Open KPI = status==='open' only; ObservationsTable.tsx:34 Open segment = status !== 'closed' (includes replied, partially_closed, compliance_pending), so tile and list disagree. Under Reply (14 line 13) counts only 'replied', so partially_closed/compliance_pending appear in no tile. page.tsx:14 'Settled (FY)' counts all closed rows with no date filter.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/page.tsx`, `apps/web/src/app/(app)/audit/observations/ObservationsTable.tsx`, `apps/web/src/lib/audit/observationLabels.ts (new)`
- **Fix steps:**
  1. Define shared predicates isOpen/isUnderReply/isSettled in observationLabels.ts and use in both page.tsx and ObservationsTable.tsx.
  2. Decide Open KPI = all unsettled or open-only; make the Open segment identical.
  3. Either filter Settled by fiscal year (raisedDate or closedDate within FY, April-March) or relabel to 'Settled'.
- **Acceptance:**
  - Test: dataset with open/replied/partially_closed/closed -> tile values equal filtered row counts.
  - Settled label matches its filter.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Low; reporting semantics.

### GAP-AUDIT-OBSERVATIONS-03  ·  MEDIUM  ·  partly  ·  theme OTHER

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: observations/page.test.tsx 'OBS-03: string amounts are summed numerically' (added in #2058))
- **First-pass claim:** Money Value KPI sums every observation including settled ones (page.tsx:16) and treats null as 0; the value is an audit exposure, not an outstanding amount. Cell shows “—” for missing amounts.
- **Verified evidence:** page.tsx:15 `items.reduce((s,i)=>s+(i.amount ?? 0),0)` sums all observations including closed and treats null as 0 - true (line 15, not 16). The KPI is labelled 'Money Value' and the list column 'Money value' (table 62 shows '—' when falsy, including 0) so it is exposure, and the business intent is undecided. Extra risk: if amount arrives as a string (paise as bigint-string) `+` would concatenate; type is in absent @civitasone/types. formatMoney(totalAmount) is the correct paise formatter; fallback literal '₹0.00' is hard-coded.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/page.tsx`
- **Fix steps:**
  1. DECISION: relabel tile 'Total exposure' or add 'Outstanding' computed over non-closed rows only.
  2. Sum via BigInt(String(i.amount ?? 0)) and pass to formatMoney to be safe for large/string amounts.
  3. Replace hard-coded '₹0.00' with formatMoney(0n).
- **Acceptance:**
  - Tile with closed obs excluded (if outstanding chosen) equals sum of open rows.
  - Amounts as strings are summed numerically.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Money display; keep paise arithmetic.

### GAP-AUDIT-OBSERVATIONS-04  ·  MEDIUM  ·  partly  ·  theme MONEY (was OTHER)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: rupeesToMinorString used for amountInvolvedMinor (tested at 25000010); list response parsed by AuditObservationSummaryListSchema)
- **First-pass claim:** Response is cast without mapping (loaders.ts:3938) while create posts amountInvolvedMinor and the list reads amount — the contract for money units and field names is unverifiable here and a schema drift would not be caught.
- **Verified evidence:** loaders.ts:3933-3939 casts `getArrayPayload(p) as AuditObservationSummary[]` in mapResponse - no field mapping, true. But it is not unvalidated: responseSchema AuditObservationSummaryListSchema (from @civitasone/schemas/web, absent) is applied by fetchJson before mapResponse (apiClient.ts:147-152), so drift is caught if the schema is strict - cannot-verify. Unit mismatch is real to inspect: create posts amountInvolvedMinor (LogObservationButton.tsx:72,85) while list/detail read `amount` and pass to formatMoney (minor units); consistency depends on the service. Also LogObservationButton.tsx:72 `String(Math.round(n*100))` is float math on money, which violates the paise rule.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/LogObservationButton.tsx`, `apps/web/src/app/_data/loaders.ts`, `apps/web/src/lib/money.ts (new, or existing helper)`
- **Fix steps:**
  1. Add rupeesToPaiseString(input) that parses the decimal string with integer math (split on '.', max 2 dp, BigInt) and use it at LogObservationButton.tsx:64-73 instead of Number()*100.
  2. Map list rows explicitly in getAuditObservations (amount from amountInvolvedMinor or amount, as string/bigint) and document unit in the type.
  3. Verify AuditObservationSummaryListSchema requires the fields the page reads.
- **Acceptance:**
  - Unit test: '250000.10' -> '25000010'; '0.1' -> '10'; '1.005' rejected or rounded per rule; no float error at 1e12.
  - Schema test: payload missing observationNo is rejected.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Money: precision errors in audit exposure.

### GAP-AUDIT-OBSERVATIONS-05  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W1 SF-19: closed by #2014; earlier W0 tick #1872 re-confirmed against 9e34d2e4a: Log observation goes through ConfirmDialog with optional reason; the Log form dialog is now ds/Modal)
- **First-pass claim:** Log observation is a mutation with no ConfirmDialog and no reason, unlike reply/refer on the detail page (ObservationActions.tsx:170-183); audit-on-mutation cannot be confirmed (audit-service absent).
- **Verified evidence:** LogObservationButton.tsx:58-105 submit posts directly to /api/proxy/v1/audit/observations after only required-field validation; no ConfirmDialog/reason (ConfirmDialog with requireReason is used for reply/refer at ObservationActions.tsx:170-185). Server-side audit event cannot be verified (audit-service absent). Note: for create, a reason is arguably optional; a plain confirm summary is the minimum.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/LogObservationButton.tsx`
- **Fix steps:**
  1. After field validation open ConfirmDialog (title 'Log observation OBS-...?', summary of risk/amount) with requireReason optional per policy.
  2. Send `reason` in payload like ObservationActions.tsx:80.
  3. Backend: verify audit event emitted on create; if not, add.
- **Acceptance:**
  - Click Log observation opens confirm; cancel keeps form; confirm posts once and refreshes list.
  - Network payload contains reason when required.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Low; double-submit guarded by busy flag.

### GAP-AUDIT-OBSERVATIONS-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (ObservationsTable empty prompt; page error branch shows — tiles). Tests added in #2058: observations/page.test.tsx 'OBS-06: an empty tenant gets the guided Log your first observation prompt' and 'OBS-06: a fetch failure shows the error state and — tiles, never zeros or the empty prompt')
- **First-pass claim:** Empty tenant: table shows no EmptyState / “Log your first observation” prompt (ObservationsTable.tsx).
- **Verified evidence:** DataTable renders a generic EmptyState ('No records found', 'There are no items to display yet.') when no visible rows (DataTable.tsx:183-186,319-320), so it is not bare headers. ObservationsTable.tsx:55-71 passes no emptyIcon/emptyTitle/emptyMessage/emptyAction, so there is no guided 'Log your first observation' prompt; also a fetch error (source 'error', items []) shows the same empty state plus KPIs of 0 (page.tsx:35 only adds DataSourceBadge).
- **Files to change:** `apps/web/src/app/(app)/audit/observations/ObservationsTable.tsx`, `apps/web/src/app/(app)/audit/observations/page.tsx`
- **Fix steps:**
  1. Pass emptyIcon/emptyTitle='No observations yet'/emptyMessage/emptyAction (LogObservationButton) to DataTable; use different copy when a filter is active.
  2. In page.tsx use toResourceState/RefreshErrorState on source==='error' and show '—' KPIs (pattern in investigation/page.tsx).
- **Acceptance:**
  - Empty tenant shows guided prompt with action; error shows retry state not zeros.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-INVESTIGATION-01


---
## /audit/observations/[id]  —  `audit/observations-detail.html`

- **Source:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`
- **Design reference:** `redesign/audit/observations-detail.html`

### GAP-AUDIT-OBSERVATIONS-DETAIL-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (lib/audit/observationWorkflow.ts deriveWorkflow drives the timeline). Tests: lib/audit/observationWorkflow.test.ts 'closed → every step done (Closure no longer stuck on todo)', 'replied → Committee review current'; added in #2058: observations/[id]/page.test.tsx 'DETAIL-01: a closed observation shows every workflow step done'. The 'by' column still reads 'Not tracked' (honest; no committee data in the payload))
- **First-pass claim:** The workflow timeline and “Action & compliance” steps are fixed literals (page.tsx:23-28, 78-85): only the reply step reacts to data. Status closed/replied/partially_closed never advances “Committee review” or “Closure”, so a settled observation still shows Closure as “todo”.
- **Verified evidence:** page.tsx:24-29 stepRows and 80-85 timeline are literals: 'Audit committee review' by 'ACO' status '—' and 'Closure / recovery' status '—' are fixed; 'Committee review' and 'Closure' <li> are always class 'todo' (83-84). Only reply step reads obs.replies.length. page.tsx never reads obs.status, so closed/replied/partially_closed observations (statuses used in ObservationsTable.tsx:18-24) still show Closure as todo. The AuditObservationDetail type is in @civitasone/types (absent) so whether detail carries status/closedAt/committee fields is cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`, `apps/web/src/app/(app)/audit/observations/[id]/ObservationTables.tsx`, `apps/web/src/lib/audit/observationWorkflow.ts (new)`
- **Fix steps:**
  1. Create a pure helper deriveWorkflow(obs) -> steps[] mapping status open/replied/compliance_pending/partially_closed/closed to Done/Current/Todo for Raised, Reply/ATN, Committee review, Closure.
  2. Use it to build both stepRows and the timeline <li> classes in page.tsx; fill `d` dates only from real fields (closedAt, replies[].repliedAt).
  3. Where no committee data exists, render 'Not tracked' rather than 'ACO'/'—'; remove hard-coded actors.
  4. Confirm the detail payload exposes status (backend/type check).
- **Acceptance:**
  - Unit test deriveWorkflow: closed -> all Done; open with no reply -> Reply current.
  - Closed observation shows Closure done.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; misleading compliance status today.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-04

### GAP-AUDIT-OBSERVATIONS-DETAIL-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: canReply/canRefer gate on role and status !== closed in page.tsx)
- **First-pass claim:** Refer and Record Reply are shown regardless of observation status or role (page.tsx:41, ObservationActions.tsx:194-195); a closed observation can still be referred as an audit para, and non-audit-admin roles will only learn from a 403 after filling the form and the reason dialog.
- **Verified evidence:** ObservationActions.tsx:190-199 always renders Refer and Record Reply, taking only obsId and department; page.tsx:43 passes no status or role. Any layout-allowed role (layout.tsx:5 includes finance_admin, dept_head) sees them; failures surface only after form + ConfirmDialog via formError.fromResponse (lines 96-99). getSessionRoles() (roleGuard.ts:26) is server-side and available to the page. Which roles/status the service allows cannot be verified (audit-service absent).
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`, `apps/web/src/app/(app)/audit/observations/[id]/ObservationActions.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. DECISION/backend: confirm the roles allowed to reply and to refer, and statuses in which each is valid (e.g. no refer when closed).
  2. In page.tsx compute `canReply`/`canRefer` from getSessionRoles() and obs.status and pass to ObservationActions.
  3. In ObservationActions render each button only when allowed (or disabled with title explaining why).
  4. Keep server enforcement; keep 403 handling.
- **Acceptance:**
  - Closed observation: Refer hidden/disabled.
  - dept_head without permission sees no action buttons.
  - Direct POST as unauthorised role still returns 403.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Approvals: wrong client gating could hide legitimate actions; role list must come from backend policy.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-01

### GAP-AUDIT-OBSERVATIONS-DETAIL-03  ·  MEDIUM  ·  confirmed  ·  theme FAILMASK (was LOADING)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: observations/[id]/page.test.tsx 'DETAIL-03: a 404 renders the not-found page', 'a 500 renders the retry error state', 'a 403 renders the access-restricted copy' (added in #2058))
- **First-pass claim:** Not-found and outage are the same screen: a failed fetch returns null (loaders.ts:3943-3948) → “Observation not found … the ID is invalid” (page.tsx:12-19), misleading during an outage.
- **Verified evidence:** loaders.ts:3942-3948 fetchJson default is null; any 4xx/5xx/network/invalid payload returns {data:null, source:'error', status}. page.tsx:11-19 tests only `!obs` and shows 'Observation not found... ID is invalid' for outages too. Consequence: the DataSourceBadge at page.tsx:45 is dead code (obs is null whenever source==='error'). LoaderResult carries `status`/`errorMessage` (apiClient.ts:33-39) so 404 can be told apart; ds/LoadErrorState.tsx and RefreshErrorState exist. audit/error.tsx and not-found.tsx exist at the parent level.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`
- **Fix steps:**
  1. Destructure `status` too: `const { data: obs, source, status } = await getAuditObservationById(id)`.
  2. If source==='error' and status===404 call notFound() (parent not-found.tsx); if 403 render LoadErrorState (access restricted); other errors render RefreshErrorState with backHref='/audit/observations'.
  3. Render 'Observation not found' only for 404; remove the dead DataSourceBadge line.
- **Acceptance:**
  - Mock 404 -> not-found page; mock 500 -> retry error state; mock 403 -> access restricted copy.
  - Valid id renders as before.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-OBSERVATIONS-DETAIL-04  ·  MEDIUM  ·  confirmed  ·  theme LABELS (was WIRING)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: observations/[id]/page.test.tsx 'DETAIL-04: shows the shared status and risk pills' and 'an unknown status renders its raw text in a neutral pill' (added in #2058); observationLabels.test.ts)
- **First-pass claim:** Header title is the observation no. and department only — no subtitle, no risk/status pill; status of the observation is not displayed anywhere on the page (page.tsx:38-42).
- **Verified evidence:** page.tsx:40-44 PageHeader gets title `${obs.observationNo} · ${obs.department ?? '—'}` only (no subtitle); no status is rendered anywhere on the page (Details card 51-58 shows auditee, finding, money, risk as raw text, dates, period, para). The list page shows a status pill (ObservationsTable.tsx:18-25) so the detail regresses. Whether the detail type has `status` is cannot-verify (type package absent).
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`, `apps/web/src/lib/audit/observationLabels.ts (new)`
- **Fix steps:**
  1. Extract riskPill/statusPill from observations/ObservationsTable.tsx into a shared module (observationLabels.tsx) and reuse in both pages.
  2. Show status pill and risk pill next to the title (PageHeader subtitle/actions area or a fld row 'Status').
  3. Confirm obs.status is in AuditObservationDetail; add to schema if missing.
- **Acceptance:**
  - Detail page shows status pill and risk pill identical to list row.
  - Unknown status renders neutral pill, not blank.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-01

### GAP-AUDIT-OBSERVATIONS-DETAIL-05  ·  MEDIUM  ·  partly  ·  theme LABELS (was MONEY)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: severityMeta label plus accept/reject review actions behind canReview)
- **First-pass claim:** Risk is printed as the raw enum (obs.severity, page.tsx:52) and money via formatMoney; the replies table has no way to accept/reject a reply though acceptedByAuditor is shown.
- **Verified evidence:** Risk is printed raw at page.tsx:54 (`{obs.severity}`) - true. Money is NOT a defect: page.tsx:53 uses formatMoney (formatters.ts:90, minor units/paise), the correct helper. Replies: ObservationTables.tsx:27-34 shows Accepted/Rejected/'—' from acceptedByAuditor and there is no accept/reject action anywhere in the folder (ObservationActions has only reply/refer) - true; endpoint cannot be verified. Theme MONEY is wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`, `apps/web/src/app/(app)/audit/observations/[id]/ObservationTables.tsx`, `apps/web/src/app/(app)/audit/observations/[id]/ObservationActions.tsx`, `apps/web/src/lib/audit/observationLabels.ts (new)`
- **Fix steps:**
  1. Render risk through the shared riskPill/label map (see OBSERVATIONS-01) instead of raw obs.severity.
  2. DECISION/backend: confirm an accept/reject reply endpoint; if it exists add per-row Accept/Reject in RepliesTable behind role check, ConfirmDialog requireReason, POST via /api/proxy, router.refresh().
- **Acceptance:**
  - Risk shows 'High'/'Critical' label with pill.
  - Auditor can accept a reply with reason; status pill updates; non-auditors see no buttons.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Accepting a reply closes compliance - needs audit event and role gate.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-01, GAP-AUDIT-OBSERVATIONS-DETAIL-02

### GAP-AUDIT-OBSERVATIONS-DETAIL-06  ·  LOW  ·  partly  ·  theme WIRING (was LOADING)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: observations/[id]/page.test.tsx 'DETAIL-06: a payload without replies renders No replies yet and does not throw' (added in #2058))
- **First-pass claim:** Detail payload is cast without mapping and obs.replies.map is called unguarded (page.tsx:22) — a missing replies array crashes the segment into error.tsx.
- **Verified evidence:** Code is as described: loaders.ts:3947 `p as AuditObservationDetail` and page.tsx:22,26,61 call obs.replies.map/.length unguarded. But fetchJson runs AuditObservationDetailSchema.safeParse first (apiClient.ts:147-152; loaders.ts:3946), so a missing replies array is rejected as invalid_payload (-> 'not found' screen, see -03) unless the schema defaults/optionalises it. The schema lives in @civitasone/schemas/web (absent) - cannot-verify whether replies is required. Crash into audit/error.tsx is only possible if the schema allows undefined.
- **Files to change:** `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Defensive: `const replies = obs.replies ?? []` and use it at lines 22, 26, 61, 82.
  2. Verify AuditObservationDetailSchema marks replies as `.default([])` or required; add the same default in mapResponse.
- **Acceptance:**
  - Component test: detail payload without replies renders 'No replies yet' and does not throw.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-03


---
## /audit/plan  —  `audit/plan.html`

- **Source:** `apps/web/src/app/(app)/audit/plan/page.tsx`
- **Design reference:** `redesign/audit/plan.html`

### GAP-AUDIT-PLAN-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was CONFIRM)

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main 7554d78c8 (PlanTable.tsx reads r.riskLevel). Tests: plan/PlanTable.columns.test.tsx 'renders Risk from riskLevel (High) even for a routine audit' and 'falls back to — when a row has no parent-plan risk level'; audit-service plan-routes.test.ts 'projects planNo, title and riskLevel from the parent audit_plans row'. Closed by #2058 ledger)
- **First-pass claim:** The Risk level chosen in the dialog (low/medium/high, PlanAuditButton.tsx:106-110) is posted but never shown: the table derives Risk from the audit type (special/compliance → High, performance → Medium, else Low; PlanTable.tsx:10-14). A planner who picks “High” for a routine audit sees “Low” after saving.
- **Verified evidence:** PlanAuditButton.tsx:21,51,106-111 collects riskLevel low/medium/high and posts it; PlanTable.tsx:8-12,30 derives displayed Risk solely from `type` (special/compliance -> High, performance -> Medium, else Low) and never reads any risk field; the dialog does not send `type` at all. Whether AuditPlanItem has a riskLevel field is cannot-verify (@civitasone/types absent). Theme CONFIRM wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/plan/PlanTable.tsx`, `apps/web/src/app/(app)/audit/plan/PlanAuditButton.tsx`, `apps/web/src/lib/audit/observationLabels.ts (new)`
- **Fix steps:**
  1. Backend/type: confirm plan list returns riskLevel (and audit type); add to AuditPlanItem/schema if missing.
  2. Change riskLevel column in PlanTable to read r.riskLevel with the shared risk pill; fall back to '—' not to a type-derived guess.
  3. Add an audit Type select to PlanAuditButton if `type` is a required input.
- **Acceptance:**
  - Create plan with High -> table shows High.
  - Row with no riskLevel shows '—'.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Planning priority misreported today.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-01

### GAP-AUDIT-PLAN-02  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: plan/page.test.tsx 'drops the hard-coded FY26 delta and the fabricated coverage/up badge' (tile is now an honest Non-routine share; no FY filter was built))
- **First-pass claim:** “FY26” is hard-coded in the Planned Audits delta (page.tsx:29) and the plan is not filtered by financial year; “Risk-based %” is simply 100 − routine share (page.tsx:19), not a coverage of the audit universe.
- **Verified evidence:** page.tsx:29 hard-codes delta='FY26' on Planned Audits; getAuditPlan (loaders.ts:3960) takes no FY parameter and page.tsx:11 counts all items. page.tsx:14 (not 19) riskBased = share of items whose type != 'routine'; page.tsx:32 renders it with delta='coverage' and `up`, showing an Increase arrow always - not coverage of an audit universe (no universe data on the page).
- **Files to change:** `apps/web/src/app/(app)/audit/plan/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Compute the current FY label from date (April-March) or an FY query param; filter items by plannedFrom within that FY (or add ?fy= to the endpoint if backend supports it).
  2. Rename tile to 'Non-routine share' or bind to a real coverage endpoint; drop hard-coded `up`/'coverage'.
  3. Show '—' when not available.
- **Acceptance:**
  - Tile delta reflects selected FY; items outside FY excluded.
  - No fixed 'FY26' string remains.
- **Needs:** decision  ·  **Effort:** S ~half day  ·  **Risk:** Reporting accuracy for audit plan.

### GAP-AUDIT-PLAN-03  ·  MEDIUM  ·  confirmed  ·  theme WIRING (was CONFIRM)

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (Plan no. and Title columns). Tests: plan/PlanTable.columns.test.tsx 'shows the Plan no. and Title entered by the planner'; added in #2058: 'two plans in one unit show distinct plan no. and title, and the filter box matches plan no.')
- **First-pass claim:** Title entered in the dialog is not a table column — rows are identified by auditUnit · department (PlanTable.tsx:29), so two engagements in one unit look identical; Plan no. is not shown either.
- **Verified evidence:** PlanTable.tsx:28 'Audit area' column shows `auditUnit · department`; no title or planNo column although both are collected (PlanAuditButton.tsx:46-48). Two engagements in one unit are indistinguishable. Whether AuditPlanItem exposes title/planNo is cannot-verify (types package absent). Theme CONFIRM wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/plan/PlanTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Confirm planNo and title exist in the plan payload/schema; add them to AuditPlanItem mapping.
  2. Add 'Plan no.' (mono) and 'Title' columns, keep area as secondary text.
- **Acceptance:**
  - Two plans in one unit show distinct plan no./title.
  - Filter box matches plan no.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-PLAN-04  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was CONFIRM)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: PlanAuditButton blocks planned-to before planned-from)
- **First-pass claim:** Period cell prints two formatted dates with no duration or overlap check; the dialog does not validate planned-to ≥ planned-from (PlanAuditButton.tsx:36-39).
- **Verified evidence:** Dialog has partial constraints: PlanAuditButton.tsx:99,103 set max/min on the date inputs from the other date, but submit() (36-39) checks only presence, so typed/pasted or programmatic values with to<from are posted (server-side check unverifiable). PlanTable.tsx:29 prints two dates only; no duration or overlap check exists. Theme CONFIRM wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/plan/PlanAuditButton.tsx`, `apps/web/src/app/(app)/audit/plan/PlanTable.tsx`
- **Fix steps:**
  1. In submit() add `if (periodTo < periodFrom) setError('Planned-to must be on or after planned-from')`.
  2. Show duration (days) in the Period cell; optionally flag overlapping engagements for the same auditUnit in the dialog.
  3. Backend: enforce the same rule in zod.
- **Acceptance:**
  - Submitting to<from is blocked with a message.
  - Period cell shows '12 days'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-PLAN-05  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (W2 audit: PARTIAL, INTERIM for the rest. Done in #2058: create now shows a confirm summary and sends nothing until confirmed (PlanAuditButton.test.tsx 'does not POST until the confirm dialog is confirmed, and the summary names the plan'). Not built: edit/defer/complete row actions; audit-service has only PATCH /v1/audit/plans/:id/start and no defer/complete endpoint or reason field, so a required 'defer reason' would be dropped silently. Needs owner/backend decision)
- **First-pass claim:** Create is unconfirmed, and audit-on-mutation cannot be verified (audit-service absent); no edit, defer or complete action exists for existing rows.
- **Verified evidence:** PlanAuditButton.tsx:34-70 posts to /api/proxy/v1/audit/plans with no ConfirmDialog; PlanTable.tsx has no rowHref/action column, while statuses deferred and completed exist in statusPill (15-18) - so no edit/defer/complete UI. Audit-on-mutation is cannot-verify (audit-service absent).
- **Files to change:** `apps/web/src/app/(app)/audit/plan/PlanAuditButton.tsx`, `apps/web/src/app/(app)/audit/plan/PlanTable.tsx`, `apps/web/src/app/(app)/audit/plan/PlanActions.tsx (new)`
- **Fix steps:**
  1. DECISION/backend: confirm update endpoints (PATCH plans/:id status, defer with reason).
  2. Add confirm step for create; add row actions Start / Defer (requireReason) / Complete using ConfirmDialog like ObservationActions.tsx.
  3. Role-gate the actions (audit_admin) and ensure the service emits audit events.
- **Acceptance:**
  - Defer requires a reason and shows Deferred pill.
  - Create shows a confirm summary.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Plan status changes are compliance records; audit event required.
- **Depends on:** GAP-AUDIT-OBSERVATIONS-DETAIL-02

### GAP-AUDIT-PLAN-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (emptyTitle/emptyMessage/emptyAction + RefreshErrorState). Tests: plan/page.test.tsx 'shows a guided empty prompt (not bare headers) for a tenant with no plans' and 'shows the error state and — KPIs on a fetch failure'. Closed by #2058 ledger)
- **First-pass claim:** Empty plan renders bare table headers, no EmptyState or “Plan your first audit” prompt.
- **Verified evidence:** DataTable supplies a generic EmptyState when there are no rows (DataTable.tsx:319-320), so it is not bare headers; PlanTable.tsx:26-39 gives no emptyTitle/emptyMessage/emptyAction so no 'Plan your first audit' prompt. An API error also shows KPIs 0 plus only DataSourceBadge (page.tsx:34).
- **Files to change:** `apps/web/src/app/(app)/audit/plan/PlanTable.tsx`, `apps/web/src/app/(app)/audit/plan/page.tsx`
- **Fix steps:**
  1. Pass emptyTitle/emptyMessage/emptyAction (PlanAuditButton) to DataTable.
  2. Use RefreshErrorState and '—' KPIs when source==='error'.
- **Acceptance:**
  - Empty tenant shows guided prompt; API error shows retry state.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-INVESTIGATION-01


---
## /audit/risk-register  —  `audit/risk-register.html`

- **Source:** `apps/web/src/app/(app)/audit/risk-register/page.tsx`
- **Design reference:** `redesign/audit/risk-register.html`

### GAP-AUDIT-RISK-REGISTER-01  ·  HIGH  ·  confirmed  ·  theme LABELS (was CONFIRM)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W1 SF-19 re-check against 9e34d2e4a: RiskTable shows the numeric score beside the band; the dialog previews likelihood x impact)
- **First-pass claim:** Rating shows only a band; riskScore (likelihood × impact) is never displayed (RiskTable.tsx:48-53) and the dialog gives no preview of the score it will produce (AddRiskButton.tsx:98-110), so the page cannot justify why a risk is High.
- **Verified evidence:** RiskTable.tsx:10-14,52 renders only the band pill from riskScore (>=15 High, >=6 Medium); the numeric score is not shown. AddRiskButton.tsx:96-110 shows likelihood/impact selects and the static note 'Risk score is computed server-side' (line 110) with no preview. page.tsx:12-14 duplicates thresholds 15/6. Theme CONFIRM wrong.
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`, `apps/web/src/app/(app)/audit/risk-register/AddRiskButton.tsx`, `apps/web/src/lib/audit/riskScoring.ts (new)`
- **Fix steps:**
  1. Create riskScoring.ts exporting LIKELIHOOD/IMPACT ordinal maps (1-5), band(score) with thresholds 15/6, used by page.tsx, RiskTable and the dialog.
  2. Show score (e.g. '12 - Medium') in the Rating cell.
  3. In dialog, preview score = L x I and band live; confirm mapping with backend (scale is not visible here).
- **Acceptance:**
  - Unit test: possible(3) x moderate(3) = 9 Medium.
  - Table shows numeric score; dialog preview matches server after save.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Preview must match server formula or it misleads.

### GAP-AUDIT-RISK-REGISTER-02  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** “Low / Controlled” tile counts score < 6 only (page.tsx:13) — closed/controlled risks with a high inherent score are counted as High; status and rating are conflated.
- **Verified evidence:** page.tsx:14 (not 13) low = riskScore < 6 and tile is labelled 'Low / Controlled'; high (line 12) counts riskScore >= 15 regardless of status, so closed ('Controlled', RiskTable.tsx:18) risks with high inherent score stay in High. Rating (inherent score) and status are conflated.
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/page.tsx`, `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`
- **Fix steps:**
  1. DECISION: whether tiles count only active risks (exclude status closed) or show residual.
  2. Rename tile to 'Low' or add separate 'Controlled' tile counting status==='closed'.
  3. Share thresholds via riskScoring.ts.
- **Acceptance:**
  - High tile excludes closed risks if chosen; totals sum to Total Risks.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low; reporting semantics.
- **Depends on:** GAP-AUDIT-RISK-REGISTER-01

### GAP-AUDIT-RISK-REGISTER-03  ·  MEDIUM  ·  partly  ·  theme LABELS (was ROLEGATE)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: lib/audit/riskScoring.test.ts 'maps each status one-to-one and keeps unknown statuses visible as raw neutral text')
- **First-pass claim:** Status labels are relabelled: “mitigated” → Mitigating (warn), “open” → Monitored (info) (RiskTable.tsx:16-21) — “mitigated” reads as still in progress and “open” as watched, not acted on.
- **Verified evidence:** RiskTable.tsx:16-21: 'mitigated' -> 'Mitigating' (warn), 'closed' -> 'Controlled', 'escalated' -> 'Escalated', everything else (incl. 'open' and any unknown) -> 'Monitored' (info). The relabelling is real and 'open'->'Monitored' hides unknown statuses. Nothing here is a role gate; theme is wrong (labels). The status enum values cannot be verified (types absent).
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`, `apps/web/src/lib/audit/riskScoring.ts (new)`
- **Fix steps:**
  1. Map statuses one-to-one: open -> Open, mitigated -> Mitigated, closed -> Closed/Controlled, escalated -> Escalated; unknown -> neutral pill with raw text.
  2. Confirm business wording (if 'mitigated' means in progress, backend should use 'mitigating').
- **Acceptance:**
  - Each status renders its own label; unknown status not shown as Monitored.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-AUDIT-RISK-REGISTER-04  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [ ] **Status** (W2 audit: PARTIAL, INTERIM for the rest. Done in #2058: create shows a confirm summary with the computed score and sends nothing until confirmed (AddRiskButton.test.tsx 'does not POST until the confirm dialog is confirmed, and the summary shows the score'); option labels were already fixed. Not built: Close/Change-status with required reason: PATCH /v1/audit/risks/:id accepts status but has no reason field (the body schema would strip it), so the reason would not be recorded. Needs backend change + owner decision; also there is no Controlled tile any more)
- **First-pass claim:** Dialog options show raw enum text (“it”, “almost certain”, lowercase) (AddRiskButton.tsx:94-106); no ConfirmDialog and no way to edit or close a risk from the page.
- **Verified evidence:** AddRiskButton.tsx:94 category options print raw enum value (`{c}`: 'it', 'financial'), 100 likelihood uses replace('_',' ') (lowercase 'almost certain'), 106 impact raw; no ConfirmDialog (submit at 38-71 posts directly); RiskTable.tsx has no rowHref or action column so risks cannot be edited or closed here (statuses closed/mitigated/escalated only arrive from elsewhere; endpoint unverified).
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/AddRiskButton.tsx`, `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`, `apps/web/src/app/(app)/audit/risk-register/RiskActions.tsx (new)`
- **Fix steps:**
  1. Add label maps (CATEGORY_LABELS: it -> 'IT', etc.; sentence-case likelihood/impact) and render them in the option text while keeping value enums.
  2. DECISION/backend: confirm update/close endpoints; add row actions Change status / Close with ConfirmDialog requireReason.
  3. Add confirm summary for create.
- **Acceptance:**
  - Options read 'IT', 'Almost certain'.
  - Closing a risk requires reason and updates Controlled tile.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Low for labels; actions need audit events.
- **Depends on:** GAP-AUDIT-RISK-REGISTER-01

### GAP-AUDIT-RISK-REGISTER-05  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W2 audit: closed by #2058. The All/High/Medium/Low band filter with ?band= was already in RiskTable.tsx on main but untested; test added: risk-register/RiskTable.test.tsx '?band=medium shows only the medium-band row' and 'picking Medium keeps the band in the URL'. Status filter (second fix step) not built; not in the acceptance)
- **First-pass claim:** Segmented offers All / High only (RiskTable.tsx:9) though the tiles expose three bands; no status filter.
- **Verified evidence:** RiskTable.tsx:8 FILTERS = ['All','High'] and rows filter at 28-31 handles only band=high; tiles in page.tsx:12-14 expose High/Medium/Low, and there is no status filter (free-text filterable only, line 57).
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`, `apps/web/src/app/(app)/audit/risk-register/page.tsx`
- **Fix steps:**
  1. Extend FILTERS to All/High/Medium/Low using the shared band() helper and ?band= param.
  2. Add a status Segmented or select (?status=) and make the page tiles link to the matching filter.
- **Acceptance:**
  - Selecting Medium shows only score 6-14 rows; URL keeps ?band=medium.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-RISK-REGISTER-01

### GAP-AUDIT-RISK-REGISTER-06  ·  LOW  ·  partly  ·  theme OTHER

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main. Tests: risk-register/page.test.tsx 'shows a guided empty prompt for an empty register' and 'shows the error state and — tiles on a fetch failure'. Closed by #2058 ledger)
- **First-pass claim:** Empty register shows bare table headers, no EmptyState.
- **Verified evidence:** DataTable renders its default EmptyState when no rows (DataTable.tsx:319-320) rather than bare headers; RiskTable.tsx:47-60 sets no emptyTitle/emptyMessage/emptyAction so no 'Add your first risk' prompt; API error also shows zero tiles plus only DataSourceBadge (page.tsx:34).
- **Files to change:** `apps/web/src/app/(app)/audit/risk-register/RiskTable.tsx`, `apps/web/src/app/(app)/audit/risk-register/page.tsx`
- **Fix steps:**
  1. Pass emptyTitle/emptyMessage/emptyAction (AddRiskButton) to DataTable.
  2. Use RefreshErrorState and '—' tiles on source==='error'.
- **Acceptance:**
  - Empty register shows guided prompt; error shows retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-AUDIT-INVESTIGATION-01


---
## /audit/vigilance  —  `audit/vigilance.html`

- **Source:** `apps/web/src/app/(app)/audit/vigilance/page.tsx`
- **Design reference:** `redesign/audit/vigilance.html`

### GAP-AUDIT-VIGILANCE-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: loaders.vigilance.test.ts 'a valid but EMPTY array is an empty register' and 'rows that ALL drop surface as an error'; vigilance/page.test.tsx 'shows the error state - not zero stat cards or the empty-state prompt')
- **First-pass claim:** Empty list → null → source "error" (loaders.ts:4050): “No vigilance cases found” (page.tsx:45-51) is unreachable; a department with no cases sees a failure card.
- **Verified evidence:** loaders.ts:4048 `return mapped.length > 0 ? mapped : null` and apiClient.ts:154-158 turn null into source:"error". So a valid 200 [] (or a payload where every row lacks id) becomes error, and page.tsx:37-42 shows RefreshErrorState; the EmptyState at page.tsx:43-50 is unreachable for a genuinely empty department. Page itself already null-gates KPIs (page.tsx:13-20) and uses RefreshErrorState, so the fault is in the loader, not the page. Same `length>0 ? mapped : null` idiom recurs in sibling audit loaders (e.g. getInvestigations).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/vigilance/page.tsx`
- **Fix steps:**
  1. In getVigilanceCases mapResponse (loaders.ts:4031-4049) return `mapped` (even when empty) whenever the payload was a valid array; keep null only when getArrayPayload(p) is null.
  2. If rows were received but ALL were dropped (missing id), still return null so the schema break surfaces as error, i.e. `rows.length>0 && mapped.length===0 ? null : mapped`.
  3. Grep loaders.ts for the same `mapped.length > 0 ? mapped : null` pattern and apply the same rule (systemic).
  4. Leave page.tsx branches as is; EmptyState becomes reachable.
- **Acceptance:**
  - Unit test on mapResponse: `[]` -> {source:'api', data:[]}; `[{no id}]` -> source 'error'.
  - Manual: mock GET /api/v1/audit/vigilance to return [] -> 'No vigilance cases found' card, KPI cards show 0.
  - Mock 500 -> RefreshErrorState and KPI cards show em dash.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; changes loader contract for empty lists, check other pages that rely on empty==error.

### GAP-AUDIT-VIGILANCE-02  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** DPDP: officer names and charge text (disciplinary data) are shown to every audit-layout role including finance_admin and dept_head, with no masking, no purpose/reveal gate and an unrestricted CSV export (VigilanceTable.tsx:26-35, layout.tsx:5).
- **Verified evidence:** audit/layout.tsx:6-8 ALLOWED includes finance_admin and dept_head alongside audit roles. VigilanceTable.tsx:28-29 renders officer and charges in clear, and DataTable exportable (VigilanceTable.tsx:38-39, DataTable.tsx:274-291 downloadCsv) exports all rows client-side with no audit event or role check. No <Masked> component exists in the ds barrel (only ad hoc secretMasked in admin/integrations). Whether the backend restricts /api/v1/audit/vigilance by role is not visible (no service in snapshot).
- **Files to change:** `apps/web/src/app/(app)/audit/vigilance/page.tsx`, `apps/web/src/app/(app)/audit/vigilance/VigilanceTable.tsx`, `apps/web/src/app/(app)/audit/layout.tsx`, `apps/web/src/app/_components/ds/Masked.tsx (new)`, `apps/web/src/app/_components/ds/index.ts`
- **Fix steps:**
  1. Decision: which roles may see officer/charges (suggest audit_officer, audit_admin, platform_admin, super_admin only) and whether dept_head sees own department only.
  2. Create ds <Masked value reveal> that shows initials/'••••' by default and reveals on click with a mandatory purpose; POST an audit event on reveal via an existing audit endpoint.
  3. In page.tsx read caller roles (lib/auth/roleGuard helper) and pass `canViewPII` to VigilanceTable; render officer/charges through <Masked> when false.
  4. Set exportable={canExport}; when exporting, exclude officer/charges unless permitted and log the export event.
  5. Backend must enforce the same field-level redaction (verify in audit service; cannot verify here).
- **Acceptance:**
  - Component test: finance_admin session -> officer cell masked, no export button.
  - audit_officer -> reveal requires purpose and triggers audit call.
  - API test (backend): finance_admin GET returns redacted officer/charges.
- **Needs:** decision  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure of disciplinary data; over-masking may block legitimate vigilance work, so get role matrix signed off.
- **Depends on:** Masked component

### GAP-AUDIT-VIGILANCE-03  ·  MEDIUM  ·  confirmed  ·  theme KPI-MISMATCH (was OTHER)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1872, verified on main 5a8bec9cc)
- **First-pass claim:** KPI gap: charge_sheet_issued cases are in neither “Under Investigation” nor “Inquiry Complete” (page.tsx:14-17) — the KPIs do not add up to Total Cases.
- **Verified evidence:** page.tsx:14-16 'Under Investigation' counts under_investigation + preliminary_enquiry only; :17 'Inquiry Complete' counts inquiry_complete only. charge_sheet_issued (a valid status, VigilanceTable.tsx:10) is in neither, so the two KPIs can sum to less than Total Cases (:13). Label 'Under Investigation' also absorbs preliminary enquiries.
- **Files to change:** `apps/web/src/app/(app)/audit/vigilance/page.tsx`
- **Fix steps:**
  1. Add a `chargeSheeted` count for inquiryStatus==='charge_sheet_issued' and a StatCard 'Charge Sheet Issued' (or fold into an 'Active' bucket with an explicit label).
  2. Rename first KPI to 'Preliminary / Under Investigation' or split preliminary_enquiry into its own card.
  3. Derive all buckets from one status->bucket map so they always sum to total; assert in a test.
- **Acceptance:**
  - Unit test: fixture with one case per status -> bucket counts sum to Total Cases.
  - Manual: a charge_sheet_issued case increments a visible KPI.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; display-only counts.

### GAP-AUDIT-VIGILANCE-04  ·  MEDIUM  ·  confirmed  ·  theme SILENTDEFAULT (was ROLEGATE)

- [x] **Status** (W2 audit: closed by #2058. loaders.ts maps unrecognised/missing inquiryStatus/outcome to 'unknown' (raw kept, no longer preliminary_enquiry/pending); VigilanceTable shows 'Unrecognised' (t(), en+hi) in a neutral pill with the raw code in the title; page adds an Unrecognised stage tile so buckets reconcile. Schema boundary relaxed so one new stage cannot fail the whole list. Tests: loaders.vigilance.test.ts 'inquiryStatus appeal_pending maps to unknown' and 'a null outcome maps to unknown', vigilance/VigilanceTable.test.tsx 'an unrecognised stage and a null outcome render Unrecognised'. Telemetry-once step not built (no per-value emitter in this loader))
- **First-pass claim:** Unknown inquiryStatus/outcome values silently default to preliminary_enquiry / pending (loaders.ts:4038-4043) — a new backend stage would display as the earliest stage.
- **Verified evidence:** loaders.ts:4041-4046 coerce missing/unknown inquiryStatus to 'preliminary_enquiry' and unknown outcome to 'pending' with no logging. A new backend stage (or a null) is displayed as the earliest stage and a possibly-penalised case as 'Pending'. The row's raw value is lost before VigilanceTable's `?? String(row.inquiryStatus)` fallback (VigilanceTable.tsx:30-31) can show it. Not a role-gate issue; the theme tag is wrong. Whether the Zod list schema (VigilanceCaseSummaryListSchema, imported loaders.ts:323) already rejects unknown values is not visible (package not in snapshot).
- **Files to change:** `apps/web/src/app/_data/loaders.ts`, `apps/web/src/app/(app)/audit/vigilance/VigilanceTable.tsx`
- **Fix steps:**
  1. Widen VigilanceCaseSummary.inquiryStatus/outcome to `Known | 'unknown'` and map unrecognised or missing values to 'unknown' (keep the raw string in a `rawInquiryStatus` field).
  2. Emit the existing telemetry (emitError-style) once per unknown value.
  3. In VigilanceTable label maps add 'unknown' -> 'Unrecognised (raw)' rendered with a neutral StatusPill; show raw code in title.
  4. Exclude 'unknown' from KPI buckets and show a count so totals still reconcile.
- **Acceptance:**
  - Unit test: row with inquiryStatus 'appeal_pending' -> status 'unknown', raw preserved, not counted as preliminary.
  - Row with null outcome renders 'Unrecognised', not 'Pending'.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; risk of mislabelled disciplinary stage today is the real business risk.
- **Depends on:** GAP-AUDIT-VIGILANCE-03

### GAP-AUDIT-VIGILANCE-05  ·  MEDIUM  ·  partly  ·  theme PROVENANCE (was FABRICATED)

- [x] **Status** (W0 closed by #1872; PROVISIONAL cleared by W2 audit re-check against 7554d78c8: vigilance/VigilanceTable.test.tsx 'GAP-AUDIT-VIGILANCE-05: offline cached data renders the offline badge' (added in #2058))
- **First-pass claim:** No DataSourceBadge though VigilanceTable seeds from a cache (VigilanceTable.tsx:26) — stale rows are unlabelled.
- **Verified evidence:** True: page.tsx has no DataSourceBadge and VigilanceTable.tsx:22 destructures only `data` from useSeededResource, discarding provenance/offline/cachedAt. Overstated: the page renders the table only when source!=='error' and rows non-empty (page.tsx:37-55), so useSeededResource's cache branch (resource.ts:232-249) never runs here (serverUsable is always true) and stale cached rows cannot actually appear; the cache is written but never read. Badge would always say 'live' except for offline state.
- **Files to change:** `apps/web/src/app/(app)/audit/vigilance/VigilanceTable.tsx`, `apps/web/src/app/(app)/audit/vigilance/page.tsx`
- **Fix steps:**
  1. Destructure `provenance, offline, cachedAt` in VigilanceTable and render <DataSourceBadge provenance={provenance ?? 'live'} cachedAt offline /> above the DataTable (pattern: citizen/alerts/AlertsTable.tsx:48).
  2. Decide: either let the page pass the table through on error so the cached fallback is usable, or drop useSeededResource here (cached PII in IndexedDB is also a DPDP concern, see -02).
- **Acceptance:**
  - Component test: offline=true renders offline badge.
  - Manual: with cached data and server error, table shows 'cached at' badge (only if error pass-through is implemented).
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low. Caching disciplinary records client-side deserves review.
- **Depends on:** GAP-AUDIT-VIGILANCE-02

### GAP-AUDIT-VIGILANCE-06  ·  LOW  ·  confirmed  ·  theme LOADING

- [x] **Status** (W0 2026-10-13 closed by #1872, verified on main 5a8bec9cc; re-confirmed W1 SF-11 #2025: loading skeleton now on shared token-based ds Skeleton)
- **First-pass claim:** loading.tsx is a single box (vigilance/loading.tsx) — layout shift compared with audit/loading.tsx.
- **Verified evidence:** vigilance/loading.tsx:2 is one `.skeleton` div with hard-coded English aria-label 'Loading…'. Nearest-segment rules mean it overrides audit/loading.tsx (header, 4 stat cards, table shimmer, audit/loading.tsx:15-37), so the page jumps from one box to header+KPIs+table. error.tsx already uses shared RouteError with back link (error.tsx:5-13) so that part of the fix text is already done.
- **Files to change:** `apps/web/src/app/(app)/audit/vigilance/loading.tsx`
- **Fix steps:**
  1. Extract audit/loading.tsx's shimmer Bar helpers to a shared `_components/PageSkeleton` (header, 4-card StatGrid, table rows) or simply delete vigilance/loading.tsx so the audit-level one applies.
  2. If kept, translate aria-label via getTranslations('msg').loading as citizen/alerts/loading.tsx does.
- **Acceptance:**
  - Throttled-network manual check: no layout shift between skeleton and content (CLS ~0).
  - aria-busy present on skeleton wrapper.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## Backend verification items (service code absent from snapshot)

### GAP-AUDIT-HOME-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: INTERIM, needs owner decision on audience (tenant_admin not in the /v1/audit/events role list; deliberately NOT changed). Verified on main: tests/events-routes.test.ts '403 for a role without audit access (employee)', '200 for audit_officer reading its own tenant', '403 for a non-admin role passing tenantId= a different tenant'; both /audit/events and /v1/audit/events routes exist. Gateway routing of the no-v1 path not verified)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/audit/events']`
- **Question:** Is GET /audit/events role- and tenant-scoped, and is the path /api/audit/events (no v1) routed by the gateway?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/audit/events; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-CAG-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main (verified against services/audit-service). Tests: tests/para-routes.test.ts 'GET /v1/audit/paras: 403 for role outside READER_ROLES (employee)' and '200 for audit_officer and contains the seeded row', plus cross-tenant isolation test. Closed by #2058 ledger)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/paras']`
- **Question:** Does GET /audit/paras require an audit role, and does the payload match CagParaSummary (para no., status enum, amount)?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/paras; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-COMPLIANCE-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. 403 for employee is tested (compliance.test.ts 'GET /v1/audit/compliance - 403 for employee role') but there is no test asserting the 200 response shape/status enum the page maps; needs a real-DB test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/compliance']`
- **Question:** Does GET /audit/compliance restrict to audit roles and return the item shape/status enum the page maps?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/compliance; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-DASHBOARD-06  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main. Tests: services/audit-service/tests/dashboard.test.ts '403 for a role without dashboard access (employee)' and 'GET /v1/audit/dashboard reflects the seeded open observation and risk for this tenant'. Closed by #2058 ledger)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/dashboard']`
- **Question:** Does GET /audit/dashboard restrict to audit roles and return counts matching the AuditDashboard shape, scoped to the caller's tenant?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/dashboard; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-EXPORTS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. Create/status/download/verify role gates and a wrong-token 403 are tested (exports-routes.test.ts), but single-use/expiring token and 'each export writes an audit row' have no test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/exports', 'POST /api/proxy/audit/exports', 'GET /api/proxy/v1/audit/exports/{id}', 'GET .../{id}/verify', 'GET .../{id}/download?token=']`
- **Question:** Are export create/verify/download role-gated, is the download token single-use/expiring, and is each export itself written to the audit log?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/exports; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
- **Impact if wrong:** Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-INVESTIGATION-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main. Tests: services/audit-service/tests/investigation.test.ts '403 for a role without read access (employee)', 'Tenant A sees the seeded investigation', 'Tenant B does NOT see Tenant A's investigation'. Closed by #2058 ledger)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/investigations']`
- **Question:** Is GET /audit/investigations restricted to vigilance/audit roles and matches InvestigationSummary shape?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/investigations; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-OBSERVATIONS-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. GET 403/200 and tenant isolation are tested (observation-routes.test.ts); POST severity/status enum validation and exactly-one audit event per mutation have no test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/observations', 'POST /api/proxy/v1/audit/observations']`
- **Question:** Does POST observations validate severity/status enums, restrict to audit_officer and write an audit event?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/observations; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
- **Impact if wrong:** Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-OBSERVATIONS-DETAIL-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. GET/reply/review role gates are tested (observation-routes.test.ts); draft-para role, audit event per mutation and status-transition enforcement have no route-level test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/observations/{id}', 'POST .../{id}/reply', 'POST .../{id}/draft-para']`
- **Question:** Do reply and draft-para require audit/auditee roles respectively, write an audit event, and enforce observation status transitions?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/observations/{id}; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
- **Impact if wrong:** Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-PLAN-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. GET 403/200 and POST 403/400 are tested (plan-routes.test.ts); POST date-range validation and 'records who created' have no test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/plan', 'POST /api/proxy/v1/audit/plans']`
- **Question:** Does POST plans validate dates/scope, restrict to audit_admin and record who created the plan?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/plan; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
- **Impact if wrong:** Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-RISK-REGISTER-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (W2 audit: NOT DONE. POST 403 and invalid-likelihood 400 are tested (risk-routes.test.ts, risk.test.ts); 'exactly one audit event per mutation' has no test)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/risks', 'POST /api/proxy/v1/audit/risks']`
- **Question:** Does POST risks validate likelihood/impact enums, restrict to audit roles and log the mutation?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/risks; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
- **Impact if wrong:** Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.

### GAP-AUDIT-VIGILANCE-07  ·  LOW  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 audit: closed by #2058, ALREADY-FIXED on main. Tests: services/audit-service/tests/vigilance.test.ts '403 when caller role is not a vigilance reader role', 'tenant A sees the seeded vigilance case', 'tenant B ... does NOT see tenant A's case'; clear officer/charges only via audited reveal (vigilance-reveal.test.ts), web masks in the RSC payload (vigilance/page.test.tsx). Closed by #2058 ledger)
- **First-pass claim:** services/audit-service is not in the snapshot (only services/hrms-service) — endpoint contract, RBAC and audit-on-mutation behaviour are undeterminable
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/vigilance']`
- **Question:** Is GET /audit/vigilance restricted to vigilance roles with case data masked for others?
- **How to verify:** In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
- **Test to add:** Given a user with only reader role; when calling GET /api/v1/audit/vigilance; then 403. Given audit_officer; then 200 with the documented shape.
- **Impact if wrong:** Sensitive audit findings visible to unauthorised roles.
- **Web change if wrong:** If roles differ, add requireAnyRole to the page/segment layout and hide mutation buttons; adapt mapper if shape differs.


---
## Cannot verify from the snapshot

### GAP-AUDIT-DASHBOARD-05 · /audit/dashboard
- **First-pass claim:** compliancePct.toFixed(1) will throw if the API returns a non-number and the response schema passes (page.tsx:36); mapResponse only checks isRecord (loaders.ts:3928).
- **Why cannot-verify:** Page calls data.compliancePct.toFixed(1) at dashboard/page.tsx:31 (not 36). apps/web/src/app/_data/loaders.ts:3928-3929 uses responseSchema AuditDashboardSchema plus mapResponse = isRecord(p) ? p as AuditDashboard : null (unsafe cast). Whether the schema enforces numeric fields is defined in @civitasone/types, absent from the snapshot; if it does, toFixed cannot throw. Hardening with Number.isFinite is cheap regardless.
