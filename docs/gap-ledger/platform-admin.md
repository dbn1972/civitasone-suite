# Detailed gap file — module `platform-admin`

**How Claude Code should use this file.** Each item below was re-checked against the real source in a second, deeper pass (verdict + evidence + files + steps + acceptance). Work `ACTION` items page by page. Do NOT implement `REFUTED` items (kept at the bottom for audit). `CANNOT-VERIFY` and `BACKEND-VERIFY` items need the named service or a decision — check, don't guess. Prefer the shared fixes in `SHARED_FIXES.md` first: many items here disappear once those land. Follow `CLAUDE.md` (paise money, audit events on mutations, zod at the boundary, no cross-module joins, no console.log). Model-verified, not human-reviewed: for money, approval and PII items, read the code yourself before merging.

Counts: ACTION 40, BACKEND-VERIFY 5



---
## /platform-admin  —  `platform-admin/home.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/page.tsx`
- **Design reference:** `redesign/platform-admin/home.html`

### GAP-PLATFORM-ADMIN-HOME-02  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat tiles are literals, not data: "4 sections", 5 org levels, 9 roles, "Live" audit stream (page.tsx:34-37). Roles page loads a real catalogue (roles/page.tsx:20-22) so 9 can disagree with it; "Live" is shown even when the audit API is failing.
- **Verified evidence:** platform-admin/page.tsx:31-34 StatCards are literals: 'System Settings' '4 sections', 'Org Levels' 5, 'Platform Roles' 9, 'Audit Stream' 'Live'. Real data exist elsewhere: roles/page.tsx uses getAdminRolesList, org-config/page.tsx uses getOrgHierarchyLevels; the page is a sync component with no fetch, so 'Live' is shown regardless of audit API health.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/page.tsx`
- **Fix steps:**
  1. Make PlatformAdminPage async; fetch getAdminRolesList, getOrgHierarchyLevels and getTenantAuditLog (Promise.all) and use lengths.
  2. Pass null (StatCard renders '—') when a source is 'error'; replace 'Live' with the latest event time (formatIndianDateTime) or drop the tile.
  3. Drop the '4 sections' tile or derive from the settings section list export.
- **Acceptance:**
  - Test: roles loader returns 3 -> tile shows 3; loader error -> '—'.
  - No numeric literals remain in the StatCard props.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; three extra server fetches on the home page (use revalidate).
- **Depends on:** GAP-PLATFORM-ADMIN-AUDIT-LOG-03

### GAP-PLATFORM-ADMIN-HOME-03  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Emoji glyphs are baked into the label strings (page.tsx:7-12) so they are read out by screen readers as part of the link name.
- **Verified evidence:** platform-admin/page.tsx:6-11 NAV_ITEMS labels embed emoji ('⚙️ System Settings' ...) and are rendered inside the link (:45), so screen readers announce 'gear System Settings'; strings are also hard-coded English, not next-intl. Same emoji-in-text pattern in StatCard icon props (not verified whether StatCard aria-hides them).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/page.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Split NAV_ITEMS into {icon,labelKey,descKey,href}; render icon in <span aria-hidden='true'>.
  2. Move labels/descriptions to next-intl keys (platformAdmin.nav.*) using getTranslations.
  3. Use next/link instead of <a> for client navigation.
- **Acceptance:**
  - Component: link accessible name equals 'System Settings' (no emoji).
  - hi.json contains all new keys.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-HOME-04  ·  LOW  ·  confirmed  ·  theme I18N

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** "Platform Roles 9" and the Users page ALL_ROLES list (UserManagementPage.tsx:20-24) name nine roles that differ from the ROLE_LABELS in (app)/layout.tsx:11-21.
- **Verified evidence:** UserManagementPage.tsx:23-27 ALL_ROLES = super_admin, platform_admin, tenant_admin, hr_admin, payroll_admin, finance_admin, audit_admin, dept_head, hr_staff; (app)/layout.tsx:11-21 ROLE_LABELS = super_admin, tenant_admin, finance_admin, finance_staff, hr_admin, hr_staff, procurement, auditor, viewer. Both nine, different sets; platform-admin/page.tsx:33 also hard-codes 9. The roles page loads the real catalogue from admin-service.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/platform-admin/page.tsx`, `apps/web/src/lib/auth/roles.ts (new)`
- **Fix steps:**
  1. Fetch role list via getAdminRolesList in users/page.tsx and pass to UserManagementPage instead of ALL_ROLES.
  2. Create lib/auth/roles.ts as single source of display labels; layout.tsx ROLE_LABELS falls back to the API role name.
  3. Drive the home 'Platform Roles' tile from the same loader (see HOME-02).
- **Acceptance:**
  - Test: role filter options equal loader output.
  - Grep: ALL_ROLES / ROLE_LABELS constants removed or derived.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; verify no role key used for authorization was removed from the filter.
- **Depends on:** GAP-PLATFORM-ADMIN-HOME-02

### GAP-PLATFORM-ADMIN-HOME-05  ·  LOW  ·  partly  ·  theme ERRORBOUNDARY (was LOADING)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** No error.tsx / not-found.tsx in platform-admin/, unlike the plugins segment which has both.
- **Verified evidence:** platform-admin/ has loading.tsx (skeleton) but no error.tsx/not-found.tsx of its own (dir listing). Errors still bubble to app/(app)/error.tsx (RouteError, back to /dashboard) and app/not-found.tsx, so pages are not unhandled - only the back link and area label are generic ('page'). plugins/ has its own error.tsx (RouteError, area 'Plugins page') and not-found.tsx.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/error.tsx (new)`, `apps/web/src/app/(app)/platform-admin/not-found.tsx (new)`
- **Fix steps:**
  1. Add platform-admin/error.tsx using RouteError with backHref='/platform-admin', area='Platform admin'.
  2. Add not-found.tsx mirroring plugins/not-found.tsx.
  3. Skip if the generic boundary is judged sufficient.
- **Acceptance:**
  - Throw in a platform-admin page in dev: error UI offers Retry and 'Back to Platform Admin'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /platform-admin/audit-log  —  `platform-admin/audit-log.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/audit-log/page.tsx`
- **Design reference:** `redesign/platform-admin/audit-log.html`

### GAP-PLATFORM-ADMIN-AUDIT-LOG-01  ·  HIGH  ·  confirmed  ·  theme FAILMASK

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Failed load reads as an empty audit trail: on source==="error" the page shows the badge (page.tsx:44) but stat cards render 0 and the table renders "No events match the current filters" (AuditLogTable.tsx:173) — for a security log this hides that events could not be fetched. No RefreshErrorState is used, unlike plugins/policy pages.
- **Verified evidence:** audit-log/page.tsx:9 destructures {data, source} from getTenantAuditLog (loaders.ts:4352, fetchJson fallback []); line 45 shows DataSourceBadge when source==='error' but stat cards (40-43) render 0 counts and AuditLogTable receives [] and shows 'No events match the current filters.' (AuditLogTable.tsx:162-164). RefreshErrorState is not used here (it is used in plugins/installed/page.tsx:54).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/page.tsx`, `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. In page.tsx branch on source==='error' and return <RefreshErrorState error={toHumanError('load',{area:'audit log'})} backHref='/platform-admin' /> in place of stat cards and table.
  2. Alternatively pass value={null}/'—' to StatCard (it renders '—' for null) when source is error, and pass an `errored` prop to AuditLogTable to show a load-failure row instead of the empty message.
  3. Distinguish 'zero events' from 'filters matched none' in the table empty state (two messages).
- **Acceptance:**
  - Test: mock getTenantAuditLog -> {data:[],source:'error'}; page shows retry state, no '0' stats and no 'No events match'.
  - Manual: stop audit API; page shows failure with Retry.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; security log should not read as empty.
- **Depends on:** Shared: RefreshErrorState

### GAP-PLATFORM-ADMIN-AUDIT-LOG-03  ·  MEDIUM  ·  confirmed  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** "Events (today)" compares timestamp.slice(0,10) with the UTC date (page.tsx:12,25) so between 00:00 and 05:30 IST it counts yesterday IST events as today or drops them; timestamps are shown in the browser locale (AuditLogTable.tsx:30).
- **Verified evidence:** page.tsx:11 today = new Date().toISOString().slice(0,10) (UTC) and :26 compares e.timestamp.slice(0,10) (UTC date of the event); so 'Events (today)' means UTC day, i.e. from 00:00 to 05:30 IST it still counts events of IST-yesterday afternoon/evening as today (and the count resets at 05:30 IST). AuditLogTable.tsx:24-28 formatWhen uses toLocaleString('en-IN', ...) with no timeZone, so it renders in the viewer's browser zone. lib/formatters.ts has formatIndianDate (dd/mm/yyyy, no timeZone, no time) only; no IST datetime helper exists (lib/fiscalYear.ts has an istYearMonth pattern to copy).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/page.tsx`, `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Add formatIndianDateTime(iso) to lib/formatters.ts using Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) and append ' IST'.
  2. Add istDateKey(date) helper (en-CA format with timeZone Asia/Kolkata) and use it for both `today` and each event in page.tsx.
  3. Replace formatWhen in AuditLogTable with formatIndianDateTime.
  4. Add unit tests for both helpers.
- **Acceptance:**
  - Unit: istDateKey(new Date('2026-09-28T19:00:00Z')) === '2026-09-29'.
  - Component: event at 2026-09-28T19:00Z counts as today when clock is 2026-09-29T01:00 IST.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; display only.

### GAP-PLATFORM-ADMIN-AUDIT-LOG-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Diff rows are only reachable by clicking a <tr> with onClick (AuditLogTable.tsx:181-184): no button, tabindex or key handler, so keyboard and screen-reader users cannot open before/after values.
- **Verified evidence:** AuditLogTable.tsx:171-176 the <tr> has onClick and aria-expanded but no tabIndex, role or onKeyDown; the chevron cell (209-211) is a plain span. Keyboard/screen-reader users cannot reach Diff (30-57). Also the last <th> (156) is empty with no accessible name.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Render the chevron as a <button type='button' aria-expanded aria-controls={`diff-${e.id}`} aria-label='Show changes for <action>'> inside the last cell, calling setExpandedId; keep the row click as a mouse convenience only.
  2. Give the diff row id={`diff-${e.id}`} and add a visually-hidden 'Details' header text to the last <th>.
  3. Only render the button when hasDiff.
- **Acceptance:**
  - Component test: Tab to the expander, press Enter, Diff is shown; aria-expanded toggles.
  - axe run on the page reports no interactive-row violation.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-AUDIT-LOG-05  ·  MEDIUM  ·  partly  ·  theme PAGING (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Client-side filtering and 20-row paging over the full fetched list; the date filter compares raw ISO strings (AuditLogTable.tsx:95-96), and "Export CSV (n)" exports only the filtered client copy, not the server log.
- **Verified evidence:** Confirmed: filtering/paging are client-side over the whole list (AuditLogTable.tsx:86-99, PAGE_SIZE 20 at :74); the loader (loaders.ts:4352) fetches /api/v1/audit/events?tenantScoped=true with no page/limit params, so a large log is all sent to the browser (server limits unknown - cannot verify). Date compare at :88-89 is raw string compare of ISO timestamps against 'YYYY-MM-DD' (works only for UTC 'Z' ISO strings; dateTo+'T23:59:59' drops events in the last second incl. milliseconds; dates are UTC not IST). exportCsv (:59-72) exports only `filtered` in memory, adds no audit event, has no role gate and does not neutralise CSV formula injection (cells starting = + - @) and includes IP addresses/actor names (PII). The 'PII/Masked' theme is a stretch; the real issues are pagination, export and date handling.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/page.tsx`, `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Verify audit API supports from/to/actor/actionType/page/limit; if so move filters and paging to searchParams handled in page.tsx and pass to getTenantAuditLog.
  2. Compare dates via Date objects at IST day boundaries (reuse istDateKey from AUDIT-LOG-03), not string compare.
  3. Label the export honestly ('Export current filtered view (n rows)') or call a server export endpoint that records an EXPORT audit event.
  4. Prefix cell values starting with = + - @ with a single quote in exportCsv; restrict the Export button to platform_admin/auditor roles (getSessionRoles).
- **Acceptance:**
  - Unit: exportCsv escaping - cell '=1+1' is exported as "'=1+1".
  - Test: dateTo filter includes an event at 23:59:59.500Z of that day.
  - Manual: exporting writes an audit event (needs backend).
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Medium: audit data exfiltration path; server-side paging changes API usage.
- **Depends on:** GAP-PLATFORM-ADMIN-AUDIT-LOG-03

### GAP-PLATFORM-ADMIN-AUDIT-LOG-06  ·  LOW  ·  partly  ·  theme REACTKEY (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Table has 8 columns (a blank chevron column) but the empty-state colSpan is 8 and headers list 7 (AuditLogTable.tsx:163-166); rendered fragment lacks a key on the wrapping <> (AuditLogTable.tsx:178).
- **Verified evidence:** colSpan claim is refuted: thead has 7 labels (AuditLogTable.tsx:153) plus one blank <th> (:156) = 8 columns and colSpan={8} at :162 and :215 is correct. True: the wrapping fragment `<>` at :170 has no key (the key is on the inner <tr>, so React warns about missing key in the list), and the blank <th> has no accessible label.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Import Fragment from react and use <Fragment key={e.id}> for the row pair; drop the key from the inner <tr>.
  2. Add visually-hidden text to the blank header (see AUDIT-LOG-04).
- **Acceptance:**
  - Run the component in dev: no 'unique key' console warning.
  - Snapshot: header count = 8 = empty-state colSpan.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PLATFORM-ADMIN-AUDIT-LOG-07  ·  LOW  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** actorRole defaults to "platform_admin" when the API omits it (page.tsx:16), which attributes unknown actors to the highest-privilege role.
- **Verified evidence:** audit-log/page.tsx:16 `actorRole: ... ?? "platform_admin"` - an event whose API record lacks actorRole is displayed as performed by platform_admin. (Note precedence: `x as string ?? 'platform_admin'`.) Same file also defaults actionType from action prefix (:18) and targetEntity to em dash.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/audit-log/page.tsx`, `apps/web/src/app/(app)/platform-admin/audit-log/AuditLogTable.tsx`
- **Fix steps:**
  1. Default actorRole to '' / undefined and show '—' (or 'Unknown') in AuditLogTable line ~185.
  2. Type PlatformAuditEvent.actorRole as optional; adjust CSV export to write blank.
  3. If TenantAuditEventSchema lacks actorRole, add it to the schema in loaders rather than casting.
- **Acceptance:**
  - Test: event without actorRole renders 'Unknown'/'—', never 'platform_admin'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; prevents misattribution in a forensic view.


---
## /platform-admin/org-config  —  `platform-admin/org-config.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/org-config/page.tsx`
- **Design reference:** `redesign/platform-admin/org-config.html`

### GAP-PLATFORM-ADMIN-ORG-CONFIG-01  ·  HIGH  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Reordering is drag-only: rows use HTML5 draggable with onDragStart/Enter/End (OrgConfigPage.tsx:57-79,186-193) and no keyboard or touch alternative, so the level order cannot be changed without a mouse; the handle cell is aria-hidden (OrgConfigPage.tsx:204).
- **Verified evidence:** OrgConfigPage.tsx:182-188 <tr draggable onDragStart/Enter/DragOver/End> is the only way to reorder (handlers :49-75); the handle cell (:197-199) is aria-hidden and has no button; HTML5 drag-and-drop also does not work on most touch browsers. The hint text at :155 says 'Drag rows to reorder'. No move-up/down control exists.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/OrgConfigPage.tsx`
- **Fix steps:**
  1. Add 'Move up' / 'Move down' icon Buttons per row (aria-label 'Move <label> up', disabled at ends) that call a shared moveLevel(from,to) reusing the reorder logic in onDragEnd.
  2. Refactor onDragEnd body into moveLevel() and set the notice; announce via existing aria-live notice ('<label> moved to position n').
  3. Change hint text to mention buttons; keep drag as an enhancement.
  4. Make the handle cell not aria-hidden if it becomes a control.
- **Acceptance:**
  - Component: click 'Move down' on L1 reorders levels and orders renumber 1..n.
  - Keyboard-only: Tab to move buttons, Enter reorders, live region announces.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-ORG-CONFIG-03  ·  MEDIUM  ·  confirmed  ·  theme OTHER

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Edit and reorder are local until "Save order"; there is no unsaved-changes guard on navigation (the settings page has one, SystemSettingsPage.tsx), so edits are lost silently. Notice says "Click Save order to persist" (OrgConfigPage.tsx:73,102).
- **Verified evidence:** OrgConfigPage.tsx keeps edits/reorder in local `levels` state (:34, :63-70, :93) and shows notices 'Click Save order to persist' (:69, :96); there is no dirty tracking, no beforeunload and no route-change guard. SystemSettingsPage.tsx:180-181 registers a beforeunload handler and :432 a discard ConfirmDialog. Save is behind ConfirmDialog (:261-269).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/OrgConfigPage.tsx`, `apps/web/src/lib/useUnsavedChangesGuard.ts (new, extract from SystemSettingsPage)`
- **Fix steps:**
  1. Track dirty = JSON of levels order/label/description/examples/color !== initialLevels (useMemo).
  2. Extract SystemSettingsPage's beforeunload logic into useUnsavedChangesGuard(dirty) and use in both.
  3. Show an 'Unsaved changes' pill next to Save order; reset dirty after successful persistOrder by updating the baseline.
- **Acceptance:**
  - Component: reorder then fire beforeunload -> preventDefault called; after save -> not called.
  - Manual: reorder, click browser reload -> confirm prompt.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low (next/link in-app navigation is not covered by beforeunload; note limitation).

### GAP-PLATFORM-ADMIN-ORG-CONFIG-04  ·  MEDIUM  ·  partly  ·  theme COLOR (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Level badge and chain tile colours come from level.color as raw hex with "18"/"40" alpha suffixes appended (OrgConfigPage.tsx:12-15,246): a colour like "rgb(...)" or a 3-digit hex breaks, and contrast on the tinted background is not checked.
- **Verified evidence:** Real: OrgConfigPage.tsx:12-15 badge uses color+'18' background and color+'40' border, and :249 preview uses color+'18' and color+'50'. A 3-digit hex ('#abc'+'18' = invalid), rgb()/hsl()/var() or named colour would fail silently. Loader defaults missing colour to '#334155' (loaders.ts:5073) but does not validate the string. No contrast check on the tinted background (lib/contrast.ts exists). The stored values live in admin-service migration 0033, not in this snapshot, so whether any non-6-digit-hex value actually occurs is cannot-verify. Theme I18N is wrong.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/OrgConfigPage.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. In getOrgHierarchyLevels validate colour with /^#[0-9a-fA-F]{6}$/ else fall back to '#334155'.
  2. Replace string concatenation with a helper tint(hex, alpha) that expands 3-digit hex and returns rgba(); or use CSS color-mix(in srgb, <color> 10%, transparent).
  3. Use lib/contrast.ts to choose text colour meeting 4.5:1 on the tint.
- **Acceptance:**
  - Unit: tint('#abc',0.1) -> valid rgba; invalid colour falls back to default.
  - Contrast check passes for the default palette.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-ORG-CONFIG-05  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Stat "Structure GFR 2017" and "Reporting chain Top-down" are literals (page.tsx:31-32) and do not reflect the tenant's configured levels (which the page says are editable).
- **Verified evidence:** org-config/page.tsx:29-31 (obs said 31-32): StatCard 'Structure' value 'GFR 2017', 'Reporting chain' 'Top-down', 'Editable' 'Name + Order' are literals; the subtitle (:25) also hard-codes 'Ministry -> Department -> Division -> Section -> Unit' regardless of configured levels. 'Editable: Name + Order' understates: description/examples/colour are also saved (OrgConfigPage.tsx:110-114).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/page.tsx`
- **Fix steps:**
  1. Build the subtitle from levels.map(l=>l.label).join(' -> ') (fallback generic text when empty/error).
  2. Replace 'Structure' and 'Reporting chain' tiles with data-driven ones (e.g. 'Top level' = first label, 'Lowest level' = last label) or remove them.
  3. Show '—' when source==='error'.
- **Acceptance:**
  - Test: levels [A,B] -> subtitle 'A -> B'.
  - Error source -> tiles show '—'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-ORG-CONFIG-06  ·  LOW  ·  confirmed  ·  theme VALIDATION

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Editing draft validates only that the name is non-empty (OrgConfigPage.tsx:97); duplicate names and empty description/examples are accepted.
- **Verified evidence:** OrgConfigPage.tsx:92 (obs said 97): saveEdit only checks draft.label.trim(); no duplicate-label check, no length limits, empty description/examples accepted; no zod at the form boundary (CLAUDE.md rule 9). Server-side validation cannot be seen (admin-service absent).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/OrgConfigPage.tsx`, `apps/web/src/lib/orgConfig.ts`
- **Fix steps:**
  1. Add a zod schema OrgLevelDraft (label 1-60 chars trimmed, description max 200, examples max 200) and validate the whole levels array (case-insensitive unique labels) before persistOrder.
  2. Show field-level errors with aria-invalid/aria-describedby in the edit row; keep Save disabled while invalid.
  3. Optionally decide whether empty description/examples are allowed (product).
- **Acceptance:**
  - Unit: schema rejects duplicate 'Division'/'division'.
  - Component: duplicate name shows error and Save (edit) does not close the row.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-ORG-CONFIG-07  ·  LOW  ·  partly  ·  theme HYGIENE (was OTHER)

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** Stale COMP-014 history comments occupy ~25 lines of page.tsx:6-19 and OrgConfigPage.tsx:37-47; harmless but noisy.
- **Verified evidence:** Comment blocks exist: org-config/page.tsx:6-16 (11 lines) and OrgConfigPage.tsx:24-32 plus 106-109 and 118-120 (about 17 lines); cited ranges off (OrgConfigPage 37-47 is state code). They describe the COMP-014 rationale; harmless. Low priority.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/org-config/page.tsx`, `apps/web/src/app/(app)/platform-admin/org-config/OrgConfigPage.tsx`
- **Fix steps:**
  1. Trim to a 2-line summary with the COMP-014 reference; move history to the changelog/commit.
- **Acceptance:**
  - Diff shows only comment changes; tests unchanged.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.


---
## /platform-admin/roles  —  `platform-admin/roles.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/roles/page.tsx`
- **Design reference:** `redesign/platform-admin/roles.html`

### GAP-PLATFORM-ADMIN-ROLES-02  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate for a page that rewrites RBAC: no requireAnyRole in roles/page.tsx:12-38 or a segment layout; every signed-in user gets the editable matrix for non-system roles. Only isSystem is checked (RolePermissionsMatrix.tsx:299).
- **Verified evidence:** roles/page.tsx has no requireAnyRole; there is no layout.tsx in platform-admin/ (dir listing) and middleware.ts only checks session/token (no role rules). The only role logic in the segment is page.tsx:15-16 (button visibility) and tenant-config/page.tsx:4-7. Contrast crm/document-types/layout.tsx which calls requireAnyRole. RolePermissionsMatrix only checks role.isSystem for editability (:335 `editable={!role.isSystem && !!perm}`; obs said 299). Any authenticated user can load the page and see the editable PATCH UI. Whether identity/admin-service rejects the PATCH for non-admins is cannot-verify (service absent), and CLAUDE.md requires server enforcement regardless.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/layout.tsx (new)`, `apps/web/src/app/(app)/platform-admin/roles/page.tsx`
- **Fix steps:**
  1. Create platform-admin/layout.tsx that calls requireAnyRole(['platform_admin','super_admin'], '/dashboard') (add tenant_admin only if product agrees) and renders children - protects all six pages incl. audit-log, users, system-settings.
  2. Keep the home-page isPlatformAdmin button logic or remove it as redundant.
  3. Verify admin-service PATCH /v1/admin/roles/:id/permissions rejects callers without the role (backend test).
- **Acceptance:**
  - Test: session roles ['hr_staff'] hitting /platform-admin/roles redirects to /dashboard.
  - Test: platform_admin gets the page.
- **Needs:** web+backend  ·  **Effort:** XS <1h  ·  **Risk:** Medium: which roles legitimately administer the platform must be confirmed (tenant_admin?), or admins get locked out.

### GAP-PLATFORM-ADMIN-ROLES-03  ·  HIGH  ·  confirmed  ·  theme PARTIALSAVE (was CONFIRM)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** N+1 fetches and partial-save semantics: one GET per role on mount (RolePermissionsMatrix.tsx:161-166) and one PATCH per dirty role in a loop; if role 2 of 3 fails, role 1 is already committed while the dialog shows an error (RolePermissionsMatrix.tsx:222-236). No audit reference is shown to the user for a permission change.
- **Verified evidence:** RolePermissionsMatrix.tsx:155-172 fires one GET /admin/roles/{id} per role via Promise.all (N+1); saveChanges (:213-236) loops dirtyRoleIds sequentially with await PATCH per role, on failure records the message and `continue`s, so earlier and later roles are committed while an error banner and the still-open dialog (errorMessage=saveError, :359) report the failures; baseline is updated per success so a retry only resends failed roles. The dialog (:353-362) is a plain ConfirmDialog - no required reason, and after success no audit reference is shown ('N permission changes saved.'). Whether the backend emits audit events cannot be verified. The suggested maker!=checker is an approval-workflow decision, not present in the API.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/roles/RolePermissionsMatrix.tsx`, `apps/web/src/app/_components/ds/ConfirmDialog.tsx`
- **Fix steps:**
  1. Use ConfirmDialog's existing reason props (requireReason/reasonLabel/minReasonLength) and send the reason in the PATCH body if the API accepts it (backend).
  2. Message on partial failure: list which roles saved and which failed ('2 saved, 1 failed') instead of only failures.
  3. Ask backend for a batch endpoint (GET all roles with permissions; PATCH many in one transaction) to remove N+1 and partial commits; interim: keep per-role PATCH.
  4. Show the audit/reference id from the response after save once the API returns one.
  5. Decide maker-checker for RBAC changes (product).
- **Acceptance:**
  - Component: role 2 PATCH fails -> summary shows roles 1 and 3 saved, role 2 failed; retry sends only role 2.
  - Component: confirm button disabled until reason is entered.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** High: partial RBAC changes can leave inconsistent permissions; changing sequencing/batching affects security.
- **Depends on:** GAP-PLATFORM-ADMIN-ROLES-02

### GAP-PLATFORM-ADMIN-ROLES-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was NAVUX)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Matrix toggles are buttons with aria-pressed but only "On/Off" text; SoD cells set disabled so they drop out of the tab order and their explanation is only a title tooltip (RolePermissionsMatrix.tsx:90-96).
- **Verified evidence:** RolePermissionsMatrix.tsx:91-106 ToggleCell renders <button aria-pressed disabled={!editable || sod}> with visible text 'On'/'Off'/'SoD'; disabled buttons leave the tab order, and the SoD explanation is only a title attribute (:97) that keyboard/touch/screen-reader users do not get. Read-only system-role cells are also disabled (all of them drop from tab order). aria-pressed with text 'On' has no cell/row/column context in its name (name is just 'On').
- **Files to change:** `apps/web/src/app/(app)/platform-admin/roles/RolePermissionsMatrix.tsx`
- **Fix steps:**
  1. Give each button aria-label `${module} ${action}: ${granted?'granted':'not granted'}` (and 'blocked by SoD' when sod).
  2. Use aria-disabled='true' instead of disabled for SoD cells, keep them focusable, and reference a visible/sr-only explanation via aria-describedby (plus the legend already at :275).
  3. Do not rely on colour alone: keep text 'SoD' and add an icon.
- **Acceptance:**
  - Component: Tab reaches an SoD cell and its accessible description contains the SoD rule.
  - axe: no button-name/duplicate-name violations.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-ROLES-05  ·  MEDIUM  ·  confirmed  ·  theme RESPONSIVE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Wide matrix relies on overflowX:auto with minWidth 580 (RolePermissionsMatrix.tsx:284-285); on phones columns scroll sideways with no sticky module column.
- **Verified evidence:** RolePermissionsMatrix.tsx:292 and :308 wrap in overflowX:auto; table has minWidth 580 (:309). The Module column (:312/:321) is not sticky, so on phones the module names scroll away from the toggles. Theme PII is wrong.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/roles/RolePermissionsMatrix.tsx`
- **Fix steps:**
  1. Make the first th/td position:sticky; insetInlineStart:0 with the card background and a right-edge shadow.
  2. Remove the duplicate outer overflowX wrapper at :292.
  3. Optionally below 640px render each module as a stacked list of action toggles.
- **Acceptance:**
  - Manual at 375px width: module name stays visible while scrolling horizontally.
  - Visual regression snapshot at 375px.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** None.

### GAP-PLATFORM-ADMIN-ROLES-06  ·  LOW  ·  partly  ·  theme I18N

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Role names shown with the raw key next to them (finance_clerk) and modules as raw lower-case keys (RolePermissionsMatrix.tsx:276,296): no human labels for modules/actions.
- **Verified evidence:** RolePermissionsMatrix.tsx:300-301 shows role.name plus the raw role.key in a mono span (this is intentional/helpful for admins; name is the human label). Modules render as raw lowercase keys (:322) and actions as raw keys uppercased by CSS (:314); there is no label map. The loader gives no module/action display names (cannot verify whether the permissions catalogue has a description field - AdminPermissionSummary in loaders.ts could be checked).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/roles/RolePermissionsMatrix.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/hi.json`
- **Fix steps:**
  1. Add next-intl keys platformAdmin.roles.module.<key> and .action.<key> with fallback to the raw key for unknown ones.
  2. Use permission description from the API when available for a tooltip/sr-only text.
  3. Keep role.key visible (useful) but visually secondary.
- **Acceptance:**
  - Component: module 'finance' renders 'Finance' via the map; unknown module falls back to key.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.


---
## /platform-admin/system-settings  —  `platform-admin/system-settings.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/system-settings/page.tsx`
- **Design reference:** `redesign/platform-admin/system-settings.html`

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01  ·  HIGH  ·  confirmed  ·  theme WIRING (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Settings are never loaded or really saved: every section starts from DEFAULT_GENERAL/EMAIL/SECURITY/INTEGRATIONS (SystemSettingsPage.tsx:47-83) and fakeSave PUTs { _placeholder: true } while tolerating 404/405 (SystemSettingsPage.tsx:146-156). The UI then says "<section> settings saved." (line 185). Reload restores the constants. Same silent-success class COMP-012/013/014 fixed on sibling pages.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:42-65 seed all four sections from DEFAULT_* constants with no load effect; fakeSave (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:146-156) PUTs {_placeholder:true} to /api/proxy/v1/admin/settings/<section>, swallows fetch rejection (.catch(()=>null)) and tolerates 404/405; saveSection (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:201-218) then closes the editor and shows '<section> settings saved.' (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:207). Form values are never sent. Note the sibling apps/web/src/app/(app)/admin/settings/page.tsx uses PATCH on the same /admin/settings/<section> paths with real values, so the verb also differs. Backend handler is not in the snapshot (only hrms-service present).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`, `apps/web/src/app/(app)/platform-admin/system-settings/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add a server loader getPlatformSettings() in _data/loaders.ts (fetchJson with LoaderResult) for the settings GET the backend exposes (confirm path/verb with backend; the /admin/settings page already PATCHes /api/proxy/v1/admin/settings/<section>) and pass results to SystemSettingsPage as initial props; drop DEFAULT_* as data.
  2. Rename fakeSave to saveSettingsSection(section, values) and send the real section state as the body using the same verb as admin/settings (PATCH); remove the 404/405 tolerance and the .catch(()=>null) so every failure surfaces via settingsSaveError().
  3. Validate the body with a zod schema per section (port, timeout range, URL, CIDR list) before sending; render field errors.
  4. On success, router.refresh() / replace state with the server response and show the saved-at time; never show 'saved' unless res.ok.
  5. When load fails render RefreshErrorState instead of defaults; delete the constants used as fake data.
- **Acceptance:**
  - Component test: mock fetch 404 on PUT/PATCH -> error alert shown, no 'saved' message, editor stays open.
  - Component test: save posts the edited orgName in the body.
  - Manual: edit Organisation name, save, hard reload -> new value persists.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Persisting real security/SMTP config for the first time; wrong verb or shape would break login policy. Ship behind the confirmed backend contract.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-03

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-02  ·  HIGH  ·  confirmed  ·  theme WIRING (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Security and Integrations edits (session timeout, MFA required, IP whitelist, NIC API key) look applied but change nothing; an admin could believe MFA is enforced or an IP allow-list is active when it is not (SystemSettingsPage.tsx:339-380).
- **Verified evidence:** Security/Integrations inputs at apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:337-427 only mutate local React state; because saving is a no-op (see -01) session timeout, MFA checkbox (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:357-364) and IP whitelist textarea (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:370-377) enforce nothing. Compounding it, apps/web/src/app/(app)/platform-admin/system-settings/page.tsx:17-19 hard-code stat cards 'MFA on' and '3 connected' and 'smtp.nic.in' regardless of any state. Whether any service reads these values is cannot-verify (no identity/gateway code in snapshot).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`, `apps/web/src/app/(app)/platform-admin/system-settings/page.tsx`
- **Fix steps:**
  1. After -01 wires real persistence, load actual values and derive the four StatCards in page.tsx from them (or show 'Not available').
  2. Remove the literal 'MFA on', '3 connected', 'Configured' values.
  3. Add a confirmation (ConfirmDialog with requireReason) before saving mfaRequired=false or a non-empty ipWhitelist, and warn to include the admin's own IP.
  4. Validate CIDR lines client-side and session timeout 5-480 as a number on save.
- **Acceptance:**
  - Manual: with backend down, toggling MFA and saving shows an error, stat card is not 'MFA on'.
  - Unit test: invalid CIDR blocks save with inline error.
  - Turning MFA off asks for a reason.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Lock-out risk if a bad IP allow-list is enforced; needs confirm step and server-side validation.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-03  ·  HIGH  ·  confirmed  ·  theme ROLEGATE

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** No role gate and no audit trail for what claims to be tenant-wide security configuration: no requireAnyRole in system-settings/page.tsx:6-23; no audit reference or "who changed what" after save.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/system-settings/page.tsx:6-23 renders with no requireAnyRole; middleware.ts (:90-107) only checks that a non-expired token cookie exists, and (app)/layout.tsx only hides nav. Sibling gate pattern exists (apps/web/src/lib/auth/roleGuard.ts requireAnyRole; apps/web/src/app/(app)/crm/document-types/layout.tsx). After save there is no audit reference or 'last changed by/at' (saveSection sets only a text message). Server-side enforcement is cannot-verify (service absent).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/page.tsx`, `apps/web/src/lib/auth/roleGuard.ts`, `apps/web/src/app/(app)/platform-admin/layout.tsx`
- **Fix steps:**
  1. Create apps/web/src/app/(app)/platform-admin/layout.tsx (server) calling requireAnyRole(['platform_admin','super_admin'],'/dashboard') so all platform-admin routes are gated (also covers tenant-config, users, roles).
  2. Keep Edit/Save buttons disabled for non-admins even if the gate is later relaxed (pass canEdit prop into SectionCard).
  3. Show 'Last changed by X on <date>' from the API response and link to /platform-admin/audit-log filtered to the settings event; require a reason via ConfirmDialog requireReason for Security saves.
  4. Ask backend to confirm the settings PATCH is role-guarded and emits an audit event (CLAUDE.md audit events rule).
- **Acceptance:**
  - Sign in as a non-admin role and open /platform-admin/system-settings -> redirected to /dashboard.
  - Admin saves security section -> audit-log shows an entry with actor and changed keys.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Gating the whole platform-admin segment may lock out roles that use it today (e.g. audit_admin on audit-log); confirm the allowed list with product.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-04  ·  MEDIUM  ·  partly  ·  theme SECRETS (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Secrets in the form: Password and NIC API key inputs are uncontrolled (no value/onChange, SystemSettingsPage.tsx:316,400-407) so typed secrets are never captured, and the default stat "smtp.nic.in" is a literal, not the configured host.
- **Verified evidence:** True: SMTP Password input (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:315-317) has no value/onChange, so nothing typed is captured; and page.tsx:17 'smtp.nic.in' is a literal StatCard, not the configured host. False: the NIC API key input IS controlled (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:400-409, value=integrations.nicApiKey with onChange); it is shown type=text while editing (plaintext secret on screen) and type=password otherwise.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`, `apps/web/src/app/(app)/platform-admin/system-settings/page.tsx`
- **Fix steps:**
  1. Add smtpPassword to EmailSettings state and bind value/onChange on the password input; send only if changed (blank = keep existing), never echo the stored secret from the API.
  2. Make NIC API key input type=password with an explicit Show toggle (autoComplete='new-password') and same 'leave blank to keep' semantics; mimic admin/integrations IntegrationDrawer (secretMasked).
  3. Derive the SMTP StatCard from loaded email.smtpHost.
  4. Never include secrets in JS state after save; clear on success.
- **Acceptance:**
  - Component test: typing a password and saving includes smtpPassword in the request body; blank omits it.
  - Key field is masked by default in edit mode.
- **Needs:** web+backend  ·  **Effort:** S ~half day  ·  **Risk:** Secret handling: must not log or round-trip the secret; backend must store encrypted.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-05  ·  MEDIUM  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Default organisation name "Government of India — Digital Services", from-name "CivitasOne Platform" and PFMS URL are hard-coded (SystemSettingsPage.tsx:47-70), unrelated to the signed-in tenant.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:42-65 defaults: orgName 'Government of India — Digital Services', smtpFromName 'CivitasOne Platform', smtpUser/from 'no-reply@nic.in', pfmsEndpoint 'https://pfms.nic.in/api/v1'. They are displayed as if configured (no sample label) and are not tied to the signed-in tenant (see getSessionTenantId in roleGuard).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`
- **Fix steps:**
  1. Remove pre-filled values from DEFAULT_*; use empty strings and placeholders.
  2. Render loaded tenant values; if load fails show RefreshErrorState.
  3. If a new tenant has no settings yet, show 'Not configured' rather than a government name.
- **Acceptance:**
  - Fresh tenant with empty settings shows blank/‘Not configured’ fields.
  - No literal 'Government of India' remains in SystemSettingsPage.tsx.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; only visible defaults change.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-06  ·  MEDIUM  ·  partly  ·  theme VALIDATION (was MONEY)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Currency select offers USD/EUR/GBP while money is stored as paise bigint (CLAUDE.md); changing currency would misprint every ₹ value. Session timeout is a free-text string with no numeric bounds (SecuritySettings.sessionTimeoutMin: string).
- **Verified evidence:** CURRENCIES = ['INR','USD','EUR','GBP'] (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:40) drive an editable Currency select (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:269-276); money formatters (lib/formatters.ts formatMoney/formatRupees) are INR-only and do not read this setting, so the misprint claim is speculative but the option is a dead/dangerous choice given paise money. sessionTimeoutMin is a string (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:22) but the edit input is type=number min=5 max=480 (apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:350); there is no <form>, so browser constraint validation never runs on Save and out-of-range values are accepted.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`
- **Fix steps:**
  1. Restrict CURRENCIES to ['INR'] and render currency as read-only text (or remove until multi-currency is designed).
  2. Change sessionTimeoutMin to number in state; on saveSection validate integer 5-480 (zod) and show inline error.
  3. Wrap sections in <form onSubmit> or validate in saveSection before fetch.
  4. Do not add any amount handling here; money stays paise via formatMoney.
- **Acceptance:**
  - Unit test: saving timeout 3 or 9999 blocked with error.
  - Currency select no longer offers USD/EUR/GBP.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; confirm no tenant currently relies on non-INR (none can, given INR-only formatters).

### GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-07  ·  LOW  ·  partly  ·  theme A11Y (was DEADROUTE)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Read-only view renders disabled-looking read-only text boxes instead of text, so screen readers announce 12+ editable-looking fields (SystemSettingsPage.tsx:113-131).
- **Verified evidence:** Read-only view renders <input readOnly> styled as boxes (e.g. apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx:248,255,266,275,296...) instead of text, ~14 fields across the four sections. They are labelled (<label htmlFor>) and readOnly, so screen readers announce 'read-only edit', not fully editable; overstated but still noisy. The line range 113-131 cited is wrong. Theme DEADROUTE is incorrect.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/system-settings/SystemSettingsPage.tsx`
- **Fix steps:**
  1. Refactor Field helper to take value + editing + render prop; when !editing render <dd>/<span> inside a <dl> (label as <dt>) instead of an input.
  2. Keep the input only in edit mode; move focus to first field on Edit.
  3. Reuse the pattern from TenantConfigCard Row.
- **Acceptance:**
  - axe scan on read view: no readonly textboxes.
  - Edit -> fields become inputs, focus on first input.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low; visual regression only.


---
## /platform-admin/tenant-config  —  `platform-admin/tenant-config.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx`
- **Design reference:** `redesign/platform-admin/tenant-config.html`

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-01  ·  HIGH  ·  confirmed  ·  theme FABRICATED

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Nothing is fetched: TenantConfigCard takes a config prop that page.tsx never passes, so every viewer sees the hard-coded DEFAULT_CONFIG (tenant "Government of India — Pilot Tenant", 1,243 of 5,000 seats, licence to 2027-03-31; TenantConfigCard.tsx:20-36, page.tsx:28-32). The licence-expiry and storage warnings can never fire for the real tenant.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx:28-31 renders <TenantConfigCard isPlatformAdmin/> with no config prop; apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:75-77 defaults config = DEFAULT_CONFIG (apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:22-36: tenant 'Government of India — Pilot Tenant', 1243/5000 seats, 72/500 GB, licensedUntil 2027-03-31). The page is a server component but fetches nothing, and the StatCards at apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx:16-19 are literals ('Active','Isolated','Enterprise'). Warnings computed at apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:85-86 are based on the constant. Backend endpoint for tenant config is cannot-verify (not in snapshot; getTenantSettings uses /api/v1/admin/tenant/modules which is modules only).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx`, `apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Add getTenantConfig() loader (fetchJson + zod schema for TenantConfig type in TenantConfigCard.tsx:6-20) against the endpoint backend confirms; return LoaderResult.
  2. In page.tsx await it and pass config; on source==='error' render RefreshErrorState, on missing show 'Not available'.
  3. Delete DEFAULT_CONFIG and default param; make config required.
  4. Derive StatCards from config (status, licenseType).
- **Acceptance:**
  - Test: with loader error the card shows RefreshErrorState, no 'Government of India' text.
  - With config licensedUntil in 10 days -> 'Expires in 10d' shown.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Endpoint may not exist; until then page should say unavailable rather than show fake licence data.

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-03  ·  MEDIUM  ·  confirmed  ·  theme COPY (was DEADROUTE)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** isPlatformAdmin is passed but only toggles a badge — there is no edit control for either audience, so "read-only mode ... Contact a platform admin to modify" is misleading (page.tsx:24-28).
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx:9,23-27 shows the 'read-only mode... Contact a platform admin to modify' banner for non-admins and apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:94 a Read-only pill; isPlatformAdmin has no other use. There is no edit control or edit route for admins either, so the message implies an ability that does not exist. Also no server gate (see SYSTEM-SETTINGS-03).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/tenant-config/page.tsx`, `apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx`
- **Fix steps:**
  1. Decide: if editing is out of scope, drop the banner/pill and state 'Tenant configuration is managed by the platform operations team.' for everyone.
  2. If editing is planned, add an Edit action gated on isPlatformAdmin wired to the tenant-config PATCH (needs backend).
  3. Gate the route via platform-admin layout requireAnyRole.
- **Acceptance:**
  - Non-admin no longer sees a 'contact an admin to modify' message unless an edit path exists.
  - Admin sees Edit only if the feature is wired.
- **Needs:** decision  ·  **Effort:** XS <1h  ·  **Risk:** Low.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-03

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-04  ·  MEDIUM  ·  confirmed  ·  theme A11Y (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Copy buttons are unstyled <button> elements labelled just "Copy" repeated three times, with no aria-label naming the value (TenantConfigCard.tsx:73-101).
- **Verified evidence:** Three plain <button type=button> with visible text 'Copy'/'Copied!' and inline styles only (apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:99-101, 112-114, 120-122; observation line range 73-101 is off). No aria-label naming the value; screen-reader users hear three identical 'Copy' buttons. No live announcement of 'Copied!'.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx`
- **Fix steps:**
  1. Extract a CopyButton({value,label}) that uses the ds Button (variant ghost, size sm) with aria-label={`Copy ${label}`}.
  2. Wrap 'Copied!' in an aria-live='polite' span.
  3. Handle navigator.clipboard rejection (insecure context) with a visible error.
- **Acceptance:**
  - Component test: getByRole('button',{name:'Copy tenant ID'}) exists for all three.
  - Clicking announces 'Copied' in a status region.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-05  ·  MEDIUM  ·  partly  ·  theme DATEFMT

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Licence expiry uses Date.now() at render on the server and Math.ceil of a timezone-naive date string (TenantConfigCard.tsx:73-75), so "days left" can be off by one and static-render caching can serve a stale "Valid".
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:85 computes Math.ceil((new Date(licensedUntil) - Date.now())/86400000) in a 'use client' component: date-only '2027-03-31' parses as UTC midnight so the count is off by up to a day in IST and expiry day itself reads 0/'Expires in 0d' rather than end-of-day; Date.now() differs between SSR and hydration (possible mismatch). Claim of static-render caching is wrong: the page calls cookies() so it is dynamic. formatDate (apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:68-72) uses toLocaleDateString('en-IN',{month:'long'}) with no timeZone, giving '31 March 2027' not the app-standard formatIndianDate.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx`, `apps/web/src/lib/formatters.ts`
- **Fix steps:**
  1. Replace formatDate with formatIndianDate from lib/formatters.ts.
  2. Compute days-left in Asia/Kolkata calendar days (compare date strings at IST midnight) in a small helper daysUntilIST(iso) with unit tests; treat expiry date as inclusive.
  3. Compute on the server in page.tsx and pass 'daysLeft' as a prop (avoids hydration mismatch).
- **Acceptance:**
  - Unit test: licensedUntil = today (IST) -> 0 days, status warn not expired.
  - Unit test: 2027-03-31 renders '31 Mar 2027'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low; licence-expiry wording only.
- **Depends on:** GAP-PLATFORM-ADMIN-TENANT-CONFIG-01

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-06  ·  LOW  ·  confirmed  ·  theme COPY (was OTHER)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Feature badges show raw keys with underscores replaced (pfms integration, hrms) rather than module names (TenantConfigCard.tsx:56-62).
- **Verified evidence:** FeatureBadge (apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx:60-66) renders feature.replace(/_/g,' ') so 'pfms_integration' becomes 'pfms integration', 'hrms', 'mfa' lower-case keys; no module-name mapping. Observation lines 56-62 are slightly off.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/tenant-config/TenantConfigCard.tsx`, `apps/web/src/lib/labels.ts`
- **Fix steps:**
  1. Add FEATURE_LABELS map (hrms->'HRMS', payroll->'Payroll', pfms_integration->'PFMS integration', digilocker->'DigiLocker', mfa->'Multi-factor authentication', ...) in lib/labels.ts.
  2. Use label ?? humanizeStatus(key) in FeatureBadge.
  3. Drive from the shared module registry if one exists (moduleVisibility.ts).
- **Acceptance:**
  - Unit test: 'pfms_integration' renders 'PFMS integration'.
  - Unknown key falls back to title-cased text.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## /platform-admin/users  —  `platform-admin/users.html`

- **Source:** `apps/web/src/app/(app)/platform-admin/users/page.tsx`
- **Design reference:** `redesign/platform-admin/users.html`

### GAP-PLATFORM-ADMIN-USERS-01  ·  HIGH  ·  confirmed  ·  theme PII

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** DPDP: full name, email, department, last-login and role of every user are shown and exportable via "Export all" CSV to any signed-in user (UserManagementPage.tsx:49-60,103-117); no role gate (no requireAnyRole in page.tsx:6-51) and no audit of the export.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/users/page.tsx:6-51 has no requireAnyRole; data comes from getAdminUsers() (/api/identity/users) and apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:57-71 exportCsv builds a Blob client-side with name, email, roles, status, department, MFA, last login and downloads it (buttons at apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:200-207); no fetch, no audit event, no permission check. Whether identity-service restricts the list endpoint by role is cannot-verify. CSV cells are also not protected against formula injection (=,+,-,@ prefixes).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/page.tsx`, `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`, `apps/web/src/app/(app)/platform-admin/layout.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Add platform-admin layout.tsx with requireAnyRole(['platform_admin','super_admin']) (shared with SYSTEM-SETTINGS-03).
  2. Show Export buttons only for those roles; route the export through a server endpoint (POST /api/proxy/v1/admin/users/export) that writes an audit event (actor, filter, row count) and returns the CSV; ask backend for it.
  3. Prefix cells beginning with = + - @ with an apostrophe in exportCsv.
  4. Mask email/department for non-full-access roles via a shared <Masked> (does not exist yet: create in _components/ds).
- **Acceptance:**
  - Non-admin gets redirected from /platform-admin/users.
  - Export click produces an audit-log entry with row count.
  - CSV with name '=HYPERLINK(..)' is neutralised.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** DPDP exposure; changing export path affects admins' bulk workflows.
- **Depends on:** GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-03

### GAP-PLATFORM-ADMIN-USERS-02  ·  HIGH  ·  confirmed  ·  theme STATE (was PII)

- [x] **Status** (W0 2026-10-13, W0-10 confirmed: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** One shared `error` string drives both dialogs (UserManagementPage.tsx:97) and is never cleared when a dialog closes, so a failed suspend leaves "Could not suspend user." in the reset-password dialog next time it opens.
- **Verified evidence:** Single state `error` (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:88) is set by confirmSuspend (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:139) and confirmReset and passed as errorMessage to both ConfirmDialogs (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:313,324). It is cleared only at the start of the next confirm call (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:120,146); onCancel handlers (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:315,326) just null the target. So a failed suspend leaves the message when the dialog is reopened (or the reset dialog opens). The suspend/reset catch blocks also discard errorMessageFromResponse text (fixed strings).
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`
- **Fix steps:**
  1. Split into suspendError and resetError, or clear error inside setSuspendTarget/setResetTarget openers and in both onCancel handlers.
  2. Add a helper openSuspend(user){setError('');setSuspendTarget(user)}.
  3. Use useFormError('user') for catalogued messages.
- **Acceptance:**
  - Test: fail suspend, cancel, open Reset -> no error text.
  - Reopen suspend after failure -> no stale error.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-USERS-03  ·  MEDIUM  ·  confirmed  ·  theme CONFIRM

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Suspend has no reason field and no self-suspend guard: an admin can suspend their own account or the last super_admin row (UserManagementPage.tsx:120-138). Copy says "reactivate from Keycloak" but the page has no Reactivate action for suspended users.
- **Verified evidence:** Suspend ConfirmDialog (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:307-316) has no requireReason although ConfirmDialog supports requireReason/reasonLabel/minReasonLength (ds/ConfirmDialog.tsx:30-56); body sends only {status:'suspended'} (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:130-134). No check of target id against the signed-in user (roleGuard.ts has no getSessionUserId though the JWT has sub) or against the last super_admin. Description says 'reactivate from Keycloak' (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:310) and the row action set (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:281-288) only offers Suspend when status!=='suspended', no Reactivate. Server-side guards are cannot-verify.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`, `apps/web/src/lib/auth/roleGuard.ts`
- **Fix steps:**
  1. Add getSessionUserId() to lib/auth/roleGuard.ts; pass currentUserId from users/page.tsx to UserManagementPage.
  2. Hide/disable Suspend for the current user and for the last active super_admin (count from users) with tooltip.
  3. Set requireReason on the suspend ConfirmDialog and include reason in the PATCH body (confirm field name with identity-service).
  4. Add Reactivate action calling PATCH .../status {status:'active'} with confirm, or change copy to state what admins should do.
  5. Ask backend to enforce self-suspend / last-admin guard and emit audit event.
- **Acceptance:**
  - Own row has no enabled Suspend.
  - Suspend cannot confirm without a >=N char reason.
  - Suspended row shows Reactivate and it flips status after refresh.
- **Needs:** web+backend  ·  **Effort:** M ~1-2d  ·  **Risk:** Account lock-out risk; authorisation-sensitive change.
- **Depends on:** GAP-PLATFORM-ADMIN-USERS-02

### GAP-PLATFORM-ADMIN-USERS-04  ·  MEDIUM  ·  confirmed  ·  theme DATA-INTEGRITY (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** id falls back to String(Math.random()) when the API omits id (page.tsx:12), so React keys and the checkbox selection change on every render and a suspend would target a fake id.
- **Verified evidence:** apps/web/src/app/(app)/platform-admin/users/page.tsx:12 `id: ... ?? String(Math.random())`. Page is dynamic so ids regenerate every request/refresh; the selected Set (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:83) and React keys hang off id, and Suspend/Reset would call /admin/users/<0.123..>/status. Also the seed is written to the useSeededResource cache (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:78) so fake ids can persist. Whether the API can omit id is cannot-verify but mapAdminUserSummaries is in a lib file not inspected.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/page.tsx`, `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`
- **Fix steps:**
  1. Filter out rows lacking a string id (and log a data-quality telemetry event) instead of inventing one.
  2. Better: validate rows with a zod UserSummary schema in the loader mapper so id is required.
  3. Disable actions/selection for any row without id.
- **Acceptance:**
  - Unit test: raw user without id is dropped, not given a random id.
  - Ids stable across two renders.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-USERS-05  ·  MEDIUM  ·  partly  ·  theme WIRING (was FABRICATED)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Edit links to /tenant-admin/users/:id (UserManagementPage.tsx:219): a different module's route; the row Edit for a user with no id 404s. Role filter offers 9 hard-coded roles that differ from the roles catalogue on /platform-admin/roles.
- **Verified evidence:** Edit link apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:280 goes to /tenant-admin/users/${user.id}; that route does exist (apps/web/src/app/(app)/tenant-admin/users/[id]), so it is not dead for real ids and only 404s for fake ids (see -04). It is an uncommon cross-module jump and uses <a href> (full reload) rather than next/link. ALL_ROLES (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:23-27) is a hard-coded list of 9 roles; the catalogue at /platform-admin/roles comes from getAdminRoles (/api/policy/roles), contents not verifiable here.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`, `apps/web/src/app/(app)/platform-admin/users/page.tsx`, `apps/web/src/app/_data/loaders.ts`
- **Fix steps:**
  1. Fetch getAdminRoles() in users/page.tsx and pass role names to the filter; delete ALL_ROLES (keep ROLE_COLORS with fallback).
  2. Use next/link for Edit.
  3. Keep hard-coded fallback only if loader errors.
- **Acceptance:**
  - Role filter options equal roles from /platform-admin/roles.
  - Edit navigates client-side.
- **Needs:** web  ·  **Effort:** S ~half day  ·  **Risk:** Low.
- **Depends on:** GAP-PLATFORM-ADMIN-USERS-04

### GAP-PLATFORM-ADMIN-USERS-06  ·  LOW  ·  partly  ·  theme STATE (was PII)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Row selection is per-page but "Export selected" counts across pages (selected Set persists across paging, UserManagementPage.tsx:87-96), so the count can exceed what is visible.
- **Verified evidence:** selected Set (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:83) persists across pages and filter changes; toggleAll (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:111-115) only acts on the current page. 'Export selected ({selected.size})' (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:198) exports users.filter(selected.has), i.e. exactly the counted rows, so the export matches its count; the issue is that selected rows may be off-screen or filtered out and there is no cue/clear. Also selection is never pruned after router.refresh removes users.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`
- **Fix steps:**
  1. Add 'Clear selection' button and text '{n} selected (across pages)'.
  2. Prune selected to ids in current users via useEffect.
  3. Optionally reset selection when filters change, or show '{visible} of {n} selected are in view'.
- **Acceptance:**
  - Select on page 1, go to page 2: footer shows total selected with Clear.
  - Filter hides selected rows -> count hint updates.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.

### GAP-PLATFORM-ADMIN-USERS-07  ·  LOW  ·  confirmed  ·  theme COPY (was I18N)

- [x] **Status** (W0 2026-10-13: closed by #1863, verified on main 9c5e9e9e9)
- **First-pass claim:** Status "pending" and unknown statuses print raw (UserManagementPage.tsx:211-212); the Dept column heading is abbreviated.
- **Verified evidence:** Status cell (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:272-276) renders {user.status} raw for anything other than active/suspended (e.g. 'pending', 'locked'); status filter offers Pending (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:178). Header array apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:116 contains 'Dept'; also 'Reset pwd' button text (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:287). Dates use per-file formatDate (apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx:50-55) with 'MMM' and 24h, acceptable.
- **Files to change:** `apps/web/src/app/(app)/platform-admin/users/UserManagementPage.tsx`, `apps/web/src/app/_components/ds/StatusPill.tsx`
- **Fix steps:**
  1. Replace the pill ternary with <StatusPill status={user.status}/> (humanizes) and add locked/deactivated tones to STATUS_MAP.
  2. Rename headers to 'Department' and button to 'Reset password'.
  3. Move labels to next-intl keys if adopted.
- **Acceptance:**
  - Unit test: status 'pending' renders 'Pending' warn pill.
  - Column reads 'Department'.
- **Needs:** web  ·  **Effort:** XS <1h  ·  **Risk:** Low.


---
## Backend verification items (service code absent from snapshot)

### GAP-PLATFORM-ADMIN-HOME-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: already-fixed on main — platform-admin/layout.tsx has requireAnyRole([...PLATFORM_ADMIN_ROLES,...PLATFORM_AUDIT_VIEW_ROLES],"/dashboard"); verified 2026-10-16)
- **First-pass claim:** No role gate on the segment: platform-admin/ has no layout.tsx and pages never call requireAnyRole; (app)/layout.tsx:53-66 only checks the access cookie. Any tenant user who types /platform-admin reaches links to System Settings, Roles and User Management; only the header button is hidden (page.tsx:12,26-30). Server-side enforcement undeterminable: admin-service/identity-service are not in the snapshot.
- **Service:** `admin-service / identity-service`  ·  **Endpoint(s):** `['GET/PUT /api/v1/admin/* (roles, settings, users)']`
- **Question:** Every /v1/admin/* endpoint must enforce platform_admin/tenant_admin server-side so that a user reaching /platform-admin sees only 403s.
- **How to verify:** In admin-service list all route files and check each has a role preHandler; curl GET /v1/admin/roles and /v1/admin/users as employee expecting 403.
- **Test to add:** Given employee JWT, when GET /v1/admin/roles, then 403.
- **Impact if wrong:** Broken access control to role/user administration.
- **Web change if wrong:** Add platform-admin/layout.tsx with requireAnyRole(platform_admin, tenant_admin, super_admin).

### GAP-PLATFORM-ADMIN-AUDIT-LOG-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: already-fixed on main — audit-log/page.tsx canExport gates Export CSV to AUDIT_EXPORT_ROLES; layout.tsx gates segment; verified 2026-10-16)
- **First-pass claim:** No role gate: segment has no layout/requireAnyRole; any signed-in user can open the audit log and Export CSV, which writes actor, IP and role for every event (AuditLogTable.tsx:60-71). The export itself is not audited from the UI. Server-side scoping undeterminable (audit-service not in snapshot).
- **Service:** `audit-service`  ·  **Endpoint(s):** `['GET /api/v1/audit/events?tenantScoped=true']`
- **Question:** GET audit/events must require an audit/admin role (tenant_admin, platform_admin, auditor), scope to the caller's tenant, and audit the read/export.
- **How to verify:** Open audit-service events route; check requireRoles and the tenantScoped handling. curl as employee expecting 403, as tenant_admin expecting tenant-only rows.
- **Test to add:** Given employee JWT, when GET audit/events?tenantScoped=true, then 403; given tenant_admin, only own-tenant events.
- **Impact if wrong:** Every user sees actor, IP and role of all events (privacy, security intel).
- **Web change if wrong:** Add requireAnyRole for audit roles in audit-log/page.tsx and hide Export CSV otherwise; consider server-side export endpoint that is itself audited.

### GAP-PLATFORM-ADMIN-ORG-CONFIG-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: already-fixed on main — org-config/page.tsx requireAnyRole(PLATFORM_ADMIN_ROLES,"/dashboard"); segment layout also gates; verified 2026-10-16)
- **First-pass claim:** No role gate: segment has no requireAnyRole; any signed-in user sees the editable table and Save order for a tenant-wide hierarchy taxonomy (page.tsx:13-36). Server RBAC undeterminable (admin-service not in snapshot).
- **Service:** `admin-service`  ·  **Endpoint(s):** `['GET/PUT /api/v1/admin/org-hierarchy-levels']`
- **Question:** PUT org-hierarchy-levels must require tenant_admin/platform_admin, be tenant-scoped, validate order/uniqueness, and emit audit.
- **How to verify:** Open admin-service org-hierarchy-levels route; curl PUT as employee expecting 403; as admin with duplicate level keys expecting 422.
- **Test to add:** Given employee JWT, when PUT levels, then 403 and unchanged; given admin, audit event emitted.
- **Impact if wrong:** Any user can reshape tenant org taxonomy.
- **Web change if wrong:** Gate org-config/page.tsx via requireAnyRole; render read-only for others.

### GAP-PLATFORM-ADMIN-ROLES-01  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [ ] **Status** (change to `[x]` when done, `[~]` if blocked + reason)
- **First-pass claim:** SoD guard is client-only and lossy: sod=true only disables the toggle button; a role that already holds submit+approve is shown as "SoD" but nothing revokes it, and saveRolePermissions PATCHes the whole permissionKeys array (RolePermissionsMatrix.tsx:37-49,225). The server-side rule cannot be verified (identity-service absent from snapshot).
- **Service:** `admin-service / identity-service`  ·  **Endpoint(s):** `['GET /api/v1/admin/roles/:id', 'PATCH /api/v1/admin/roles/:id/permissions']`
- **Question:** PATCH role permissions must enforce SoD server-side (reject any permissionKeys set containing both submit and approve for the same resource) and audit the diff.
- **How to verify:** Open admin-service role-permissions handler; look for an SoD conflict table check. curl PATCH with a set holding X.submit + X.approve expecting 409/422.
- **Test to add:** Given a role, when PATCH permissionKeys including both submit and approve, then 422 SOD_CONFLICT and role unchanged.
- **Impact if wrong:** A role can both raise and approve transactions, defeating maker-checker.
- **Web change if wrong:** Web must surface the server SoD error and flag already-conflicting roles for revocation; keep UI toggle disabling as convenience only.

### GAP-PLATFORM-ADMIN-TENANT-CONFIG-02  ·  HIGH  ·  unverified-service-absent  ·  theme BACKEND

- [x] **Status** (W2 PQ: already-fixed on main — TenantConfigCard.tsx showInfra = isPlatformAdmin && ...; dbSchema/keycloakRealm hidden for non-platform-admin; verified 2026-10-16)
- **First-pass claim:** Infrastructure identifiers exposed without a gate: DB schema name and Keycloak realm are shown, with Copy buttons, to every signed-in user; the non-admin path only adds a "Read-only" banner (page.tsx:24-28, TenantConfigCard.tsx:97-104). No requireAnyRole; server side undeterminable.
- **Service:** `admin-service`  ·  **Endpoint(s):** `['(none found: TenantConfigCard.tsx uses DEFAULT_CONFIG, no v1/ call)', 'tenant config endpoint TBD']`
- **Question:** Whichever endpoint supplies dbSchema and keycloakRealm must return them only to platform_admin/super_admin.
- **How to verify:** Find the tenant-config route in admin-service (grep tenant-config/tenants). If none, confirm the card is static (TenantConfigCard.tsx:22-24). curl as employee expecting the two fields absent or 403.
- **Test to add:** Given tenant_admin JWT, when GET tenant config, then response omits dbSchema and keycloakRealm.
- **Impact if wrong:** Infrastructure identifiers disclosed to all users.
- **Web change if wrong:** Render dbSchema/keycloakRealm and Copy buttons only when isPlatformAdmin; use server-provided values instead of DEFAULT_CONFIG.
